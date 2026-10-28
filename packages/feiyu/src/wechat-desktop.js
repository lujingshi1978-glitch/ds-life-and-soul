import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

export const desktopWechatScope=name=>'wechat:'+createHash('sha256').update('desktop:'+name).digest('hex').slice(0,24);
const READS={info:'wechat_get_weixin_info',sessions:'wechat_get_recent_sessions',unread:'wechat_check_new_messages',contacts:'wechat_get_contacts',history:'wechat_get_chat_history',search:'wechat_search_chat_history',moments:'wechat_get_moments'};
const WRITES={send:'wechat_send_message',post:'wechat_post_moments'};
const text=(v,max,label)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw Error(label+'无效');return v.trim();};
export function desktopWechatArgs(action,p={}){
 if(!p||typeof p!=='object'||Array.isArray(p))throw Error('微信参数无效');
 const limit=Math.max(1,Math.min(30,Math.floor(Number(p.limit)||10)));
 const recent=['Today','Yesterday','Week','Month'].includes(p.recent)?p.recent:'Today';
 switch(action){
 case 'info':case 'unread':return {};
 case 'sessions':return {recent,chat_only:false};
 case 'contacts':return {kind:'friends',detail:false,limit};
 case 'moments':return {recent,number:limit,with_name:true};
 case 'search':return {keyword:text(p.query,100,'关键词'),number:limit,with_content:true};
 case 'history':return {to_user:text(p.target,100,'对象'),target_date:text(p.date||'今天',30,'日期'),max_messages:Math.min(300,Math.max(20,Number(p.limit)||100)),save_json:false,search_pages:0};
 case 'send':return {to_user:text(p.target,100,'对象'),message:text(p.text,2000,'消息'),search_pages:0};
 case 'post':return {text:text(p.text,1000,'朋友圈文案')};
 default:throw Error('未开放的微信客户端动作');
 }
}

// One role-local broker owns a single stdio MCP child. No unauthenticated HTTP sidecar.
export class WechatDesktop{
 constructor({root,profileDir,onRead=()=>{},onEvent=()=>{},connect,enabled=false}={}){
  Object.assign(this,{root,profileDir,onRead,onEvent,connect,enabled});this.python=path.resolve(root,'../../work/integration-runtime/wechat-desktop/.venv/Scripts/python.exe');
  this.db=new DatabaseSync(path.join(profileDir,'wechat-desktop.sqlite'));this.db.exec("CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,action TEXT,target TEXT,status TEXT,result TEXT,created INTEGER);UPDATE actions SET status='unknown' WHERE status='running';");this.tail=Promise.resolve();this.state='not-checked';
 }
 status(){return {installed:fs.existsSync(this.python),state:this.enabled?this.state:'paused',paused:!this.enabled,error:this.error||null,provider:'RungePei/wechat-mcp · pyweixin',read:Object.keys(READS),write:Object.keys(WRITES),automaticReplies:false,features:{files:false,likes:false,comments:false},history:this.db.prepare('SELECT id,action,target,status,created FROM actions ORDER BY created DESC LIMIT 12').all()};}
 async client(){
  if(!this.connection)this.connection=(async()=>{if(this.connect)return this.connect();if(!fs.existsSync(this.python))throw Error('微信客户端运行环境未安装');
   const c=new Client({name:'feiyu-wechat-desktop',version:'1'});const transport=new StdioClientTransport({command:this.python,args:['-m','wechat_mcp'],env:{...process.env,PYTHONIOENCODING:'utf-8',WECHAT_MCP_MAX_MESSAGES:'300',WECHAT_MCP_SEARCH_PAGES:'0',WECHAT_MCP_CLOSE_WECHAT:'false',WECHAT_MCP_LOG_LEVEL:'ERROR'},stderr:'pipe'});
   transport.stderr?.on('data',()=>{});await c.connect(transport);return c;
  })().catch(e=>{this.connection=null;throw e;});return this.connection;
 }
 async execute(action,params={}, {admin=false,guard=()=>{}}={}){
  if(!this.enabled)throw Error('桌面微信接入已暂停，原机器人通道保留');if(!admin)throw Error('仅管理员能读取或操作桌面微信');if(this.closed)throw Error('微信客户端连接已关闭');
  const name=READS[action]||WRITES[action],args=desktopWechatArgs(action,params);if(!name)throw Error('微信动作无效');
  if(WRITES[action]&&params.confirm!==true)throw Error('请先核对对象和内容，再确认发送');
  const job=async()=>{
   guard();const id=randomUUID();this.db.prepare('INSERT INTO actions VALUES(?,?,?,?,NULL,?)').run(id,action,args.to_user||'', 'running',Date.now());
   let started=false;
   try{
    const c=await this.client();guard();started=true;
    const result=await c.callTool({name,arguments:args},undefined,{timeout:120000});
    const body=(result.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('\n');let value;try{value=JSON.parse(body);}catch{throw Error('微信工具未返回有效JSON');}
    if(result.isError||value.status==='error')throw Error(String(value.message||value.error_type||'微信客户端操作失败').slice(0,400));
    if(action==='info'&&(value.running!==true||value.about_error))throw Error(value.about_error?'微信已运行，但登录信息或客户端界面不可用':'桌面微信未运行');
    // A GUI send returning success is not a remote delivery receipt.
    const status=WRITES[action]?'submitted':'complete';this.db.prepare('UPDATE actions SET status=?,result=? WHERE id=?').run(status,JSON.stringify(value).slice(0,100000),id);this.state='available';this.error=null;
    if(READS[action]&&action!=='info')await this.onRead({id,action,scope:args.to_user?desktopWechatScope(args.to_user):'self',target:args.to_user||'',value});
    this.onEvent({id,action,status,platform:'wechat-desktop'});return {id,status,value,deliveryVerified:false};
   }catch(e){const status=WRITES[action]&&started?'unknown':'failed';this.db.prepare('UPDATE actions SET status=?,result=? WHERE id=?').run(status,String(e.message).slice(0,500),id);this.state='unavailable';this.error=String(e.message).slice(0,400);this.onEvent({id,action,status,platform:'wechat-desktop'});throw Error(this.error+(status==='unknown'?'；可能已发送，禁止自动重试':''));}
  };
  const result=this.tail.then(job);this.tail=result.catch(()=>{});return result;
 }
 async close(){this.closed=true;await this.tail;try{await(await this.connection)?.close();}finally{this.db.close();}}
}
