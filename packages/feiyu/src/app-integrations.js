import {secureStatePath} from './strict-state-acl.mjs';
import {CreatorSandbox,CREATOR_PRESET} from '../plugins/qq-agent-presets/creator-runtime.mjs';
import {createBrowserEgress} from './browser-egress.js';
import {inlineSnapshots,fetchReadablePage} from './web-reading.js';
import {ReadingRuntime,inspectReading} from './reading-runtime.js';
import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';import {unwrap} from './dsh-client.js';
import {normalizeTaskHost,taskDescriptor} from './task-center.js';
export const APP_NAME='肥鱼生活台';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const parsed=value=>JSON.parse(value);
const terminal=new Set(['complete','failed','cancelled','interrupted','deferred']);
const reason=error=>String(error?.code||error?.message||'TASK_OPERATION_FAILED').replace(/(?:[A-Z]:[\\/])[^\s;]+/gi,'[local-path]').replace(/((?:token|password|secret|api[_-]?key)\s*[=:]\s*)[^\s;]+/gi,'$1[redacted]').slice(0,180);
const nativeFailure=response=>response?.result?.ok===false;
export class AppIntegrations{
 pendingTaskRuns=new Map();
 closed=false;
 constructor({root,profileDir,cfg,api,onEvent=()=>{},getTaskHost=()=>({}),onTaskOutcome,creatorSandbox,assertWorkAdmission=()=>{}}={}){
  if(typeof assertWorkAdmission!=='function')throw TypeError('assertWorkAdmission must be a host callback');
  Object.assign(this,{root,profileDir,cfg,api,onEvent,getTaskHost,onTaskOutcome,assertWorkAdmission});this.creatorSandbox=creatorSandbox||new CreatorSandbox({root});
  this.file=path.join(root,'state','app-integrations.json');this.settings={creationEnabled:false,complexTasks:false,browserInteract:false,openbiliclaw:false,multiSiteActivity:false,...(fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{})};
  this.reading=new ReadingRuntime({dir:path.join(profileDir,'reading'),browser:(url,options)=>this.browserRendered('open',{url},{...options,contextKey:options.contextKey||options.scope||'self'}),http:(url,options)=>fetchReadablePage(url,undefined,{offset:options.offset||0})});
  this.db=new DatabaseSync(path.join(profileDir,'application-tasks.sqlite'));
  this.db.exec(`CREATE TABLE IF NOT EXISTS app_tasks(id TEXT PRIMARY KEY,requester TEXT NOT NULL,prompt TEXT NOT NULL,session_id TEXT,status TEXT NOT NULL,error TEXT,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS app_task_results(id TEXT PRIMARY KEY,text TEXT NOT NULL,updated INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS app_task_events(session_id TEXT NOT NULL,event_key TEXT NOT NULL,PRIMARY KEY(session_id,event_key));
   CREATE TABLE IF NOT EXISTS app_task_meta(task_id TEXT PRIMARY KEY,kind TEXT NOT NULL,host_json TEXT NOT NULL,request_key TEXT UNIQUE,input_hash TEXT NOT NULL,phase TEXT NOT NULL,cwd TEXT,native_request_id TEXT NOT NULL,turn INTEGER,last_seq INTEGER,recovered INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS app_task_outbox(receipt_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,receipt_json TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,error TEXT);`);
  this.atomic(()=>{
   // A legacy row's database location is not proof of its original role epoch.
   for(const row of this.db.prepare('SELECT * FROM app_tasks WHERE id NOT IN (SELECT task_id FROM app_task_meta)').all())this.db.prepare("INSERT INTO app_task_meta VALUES(?,?,?,NULL,?,'legacy',NULL,?,NULL,NULL,1,?)").run(row.id,'work',JSON.stringify(normalizeTaskHost({},{ownerScope:row.requester})),digest(row.prompt),row.id,row.created_at);
   this.db.prepare('UPDATE app_task_meta SET recovered=1').run();
   for(const row of this.db.prepare("SELECT a.*,m.phase,m.turn FROM app_tasks a JOIN app_task_meta m ON m.task_id=a.id WHERE status IN ('creating','running','waiting')").all()){
    if(row.status!=='creating'){
     if(row.turn==null){this.db.prepare("UPDATE app_tasks SET status='unknown',error='Work recovered without a durable native turn; not resubmitted' WHERE id=?").run(row.id);this.outcome(row.id);}
     continue;
    }
    const uncertain=['create-submitting','prompt-submitting'].includes(row.phase)||row.phase==='legacy';
    this.db.prepare('UPDATE app_tasks SET status=?,error=? WHERE id=?').run(uncertain?'unknown':'interrupted','Bridge interrupted; native work is not resubmitted',row.id);
    this.outcome(row.id);
   }
  });
  for(const task of this.db.prepare("SELECT cwd FROM app_task_meta WHERE kind='creation-draft'").all())if(task.cwd)this.creatorSandbox.revoke(task.cwd);
  for(const task of this.db.prepare("SELECT * FROM app_tasks WHERE session_id IS NOT NULL AND status IN ('running','waiting','unknown')").all())this.api.events?.follow(task.session_id);
 }
 atomic(fn){this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value;}catch(error){this.db.exec('ROLLBACK');throw error;}}
 taskRow(id){return this.db.prepare('SELECT a.*,m.* FROM app_tasks a JOIN app_task_meta m ON m.task_id=a.id WHERE a.id=?').get(id);}
 taskView(row){if(!row)return null;const receipt=this.db.prepare('SELECT receipt_json FROM app_task_outbox WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(row.id),task=taskDescriptor({id:row.id,kind:row.kind,host:parsed(row.host_json),status:row.status,phase:row.phase,executor:'dsh',executionBoundary:this.creationBoundary(row),executorId:row.native_request_id,sessionId:row.session_id,receipt:receipt?parsed(receipt.receipt_json).receipt:null,recovered:row.recovered,createdAt:row.created_at,updatedAt:row.updated_at});return {id:row.id,requester:row.requester,session_id:row.session_id,status:row.status,error:row.error,created_at:row.created_at,phase:row.phase,task,...(row.kind==='creation-draft'?{kind:row.kind,installed:false}:{})};}
 phase(id,phase){this.db.prepare('UPDATE app_task_meta SET phase=?,updated_at=? WHERE task_id=?').run(phase,Date.now(),id);}
 outcome(id,{nativeStatus=null,eventKey=null}={}){
  const row=this.taskRow(id),receiptId='task-receipt:'+digest([id,row.status,nativeStatus,eventKey||row.phase]);
  const receipt={id:receiptId,status:row.status,nativeStatus,at:Date.now(),phase:row.phase,...(row.kind==='creation-draft'?{installed:false}:{})};
  const task=taskDescriptor({id,kind:row.kind,host:parsed(row.host_json),status:row.status,phase:row.phase,executor:'dsh',executionBoundary:this.creationBoundary(row),executorId:row.native_request_id,sessionId:row.session_id,receipt,recovered:row.recovered,createdAt:row.created_at,updatedAt:row.updated_at});
  const result=this.db.prepare('SELECT text FROM app_task_results WHERE id=?').get(id)?.text||'';
  this.db.prepare('INSERT OR IGNORE INTO app_task_outbox(receipt_id,task_id,receipt_json) VALUES(?,?,?)').run(receiptId,id,JSON.stringify({id,task,receipt,result}));return receipt;
 }
 notify(value){try{this.onEvent(value);}catch{/* A logging failure cannot revoke an actual native receipt. */}}
 outcomeContext(task){const isCurrent=()=>{if(this.closed)return false;let current;try{current=this.getTaskHost();}catch{return false;}const row=this.taskRow(task.id),old=parsed(row.host_json);return !row.recovered&&!['cancelled','interrupted'].includes(row.status)&&['profileId','characterId','roleEpoch','activationEpoch'].every(key=>old[key]!=null&&current?.[key]===old[key]);};return {recovered:!isCurrent(),isCurrent};}
 kickTaskOutcomes(){void this.flushTaskOutcomes().catch(error=>{this.outcomeFlushError=reason(error);});}
 flushTaskOutcomes(){
  if(this.outcomeFlush)return this.outcomeFlush;
  if(this.closed||typeof this.onTaskOutcome!=='function')return Promise.resolve({delivered:0,pending:this.closed?0:this.db.prepare('SELECT count(*) n FROM app_task_outbox WHERE delivered=0').get().n});
  this.outcomeFlush=(async()=>{let delivered=0;const attempted=new Set();
   while(!this.closed){const row=this.db.prepare('SELECT * FROM app_task_outbox WHERE delivered=0 ORDER BY rowid').all().find(r=>!attempted.has(r.receipt_id));if(!row)break;attempted.add(row.receipt_id);
    try{const payload=parsed(row.receipt_json),ack=await this.onTaskOutcome(payload,this.outcomeContext(payload.task));if(ack!==true&&ack?.recorded!==true)throw Error('TASK_OUTCOME_NOT_ACKNOWLEDGED');this.db.prepare('UPDATE app_task_outbox SET delivered=1,error=NULL WHERE receipt_id=?').run(row.receipt_id);delivered++;}
    catch(error){this.db.prepare('UPDATE app_task_outbox SET attempts=attempts+1,error=? WHERE receipt_id=?').run(reason(error),row.receipt_id);}
   }return {delivered,pending:this.db.prepare('SELECT count(*) n FROM app_task_outbox WHERE delivered=0').get().n};
  })().finally(()=>{this.outcomeFlush=null;});return this.outcomeFlush;
 }
 update(input){const allowed=['creationEnabled','complexTasks','browserInteract','openbiliclaw','multiSiteActivity'];if(!input||Object.keys(input).some(k=>!allowed.includes(k)||typeof input[k]!=='boolean'))throw Error('应用设置无效');if(input.creationEnabled===false)for(const row of this.db.prepare("SELECT cwd FROM app_task_meta WHERE kind='creation-draft'").all())if(row.cwd)this.creatorSandbox.revoke(row.cwd);this.settings={...this.settings,...input};fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.settings,null,2));fs.renameSync(this.file+'.tmp',this.file);return this.settings;}
 async sources(command='capabilities',argv=[]){if(!this.settings.openbiliclaw)throw Error('多网站来源已关闭');if(!['capabilities','recommend','saved-list','get-item','activity-feed','get-profile','platform-availability','runtime-status'].includes(command))throw Error('该来源命令未开放');if(!Array.isArray(argv)||argv.length>20||argv.some(x=>typeof x!=='string'||x.length>1000))throw Error('来源参数无效');const r=await fetch('http://127.0.0.1:8420/api/agent-bridge',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command,argv}),signal:AbortSignal.timeout(60000)});const d=await r.json();if(!r.ok||!d.ok)throw Error('多网站来源未就绪：'+String(d.error||r.status).slice(0,160));return d.data;}
 async browser(action,args={},options={}){if(action==='open'&&this.reading)return this.reading.read(args.url,{...options,offset:args.offset||0,scope:options.contextKey||'self',windowId:options.windowId||'operator:'+randomUUID()});try{const result=await this.browserRendered(action,args,options);return this.reading?await this.reading.observe(result,{...options,scope:options.contextKey||'self',windowId:options.windowId||'operator:'+randomUUID()}):result;}catch(error){if(action!=='open')throw error;try{return await fetchReadablePage(args.url);}catch{throw error;}}}
 async readPublic(url,options={}){return this.browser('open',{url,offset:options.offset||0},options);}
 async searchPublic(query,options={}){if(typeof query!=='string'||!query.trim()||query.length>300||/[\r\n@＠]|https?:|\b\d{7,}\b|(?:password|token|api[_-]?key)\s*[:=]/i.test(query))throw Error('请用简短公开主题搜索');return this.readPublic('https://www.bing.com/search?q='+encodeURIComponent(query),options);}
 async browserRendered(action,args={}, {admin=false,contextKey='public',signal,guard=()=>{}}={}){signal?.throwIfAborted();guard();const names={open:'browser_navigate',snapshot:'browser_snapshot',tabs:'browser_tabs',click:'browser_click',type:'browser_type',back:'browser_navigate_back',scroll:'browser_press_key'};if(!names[action]||(!['open','snapshot','tabs','back','scroll'].includes(action)&&(!admin||!this.settings.browserInteract)))throw Error('网页动作未授权');if(action==='open'){const u=new URL(args.url);const {validateFetchUrl}=await import('./safe-fetch.js');await validateFetchUrl(u.href,{recoverProxyDns:true});args={url:u.href};}if(action==='tabs')args={action:'list'};if(action==='scroll')args={key:args.direction==='up'?'PageUp':'PageDown'};const client=await this.browserClient(admin?'admin':contextKey);signal?.throwIfAborted();guard();const response=await client.callTool({name:names[action],arguments:args},undefined,{signal});signal?.throwIfAborted();guard();if(response.isError)throw Error('浏览器操作失败：'+(response.content||[]).filter(p=>p.type==='text').map(p=>p.text).join(' ').replace(/(?:[A-Z]:[\\/])[^\n]+/g,'[本地路径]').slice(0,300));const runtime=path.resolve(this.root,'../../work/integration-runtime/browser'),profile=path.join(runtime,'profiles',createHash('sha256').update(this.profileDir+(admin?'admin':contextKey)).digest('hex').slice(0,24));return inlineSnapshots(response,path.join(profile,'output'));}
 async browserClient(contextKey='public'){this.browserConnections??=new Map();if(this.browserConnections.has(contextKey))return this.browserConnections.get(contextKey);const connection=(async()=>{const runtime=path.resolve(this.root,'../../work/integration-runtime/browser'),cli=path.join(runtime,'node_modules/@playwright/mcp/cli.js'),profile=path.join(runtime,'profiles',createHash('sha256').update(this.profileDir+contextKey).digest('hex').slice(0,24));if(!fs.existsSync(cli))throw Error('网页操作服务尚未安装');fs.mkdirSync(profile,{recursive:true});if(!secureStatePath(profile).ok)throw Error('PRIVATE_BROWSER_ACL_REQUIRED');if(this.closed)throw Error('应用连接已关闭');this.browserEgress??=createBrowserEgress().catch(e=>{this.browserEgress=null;throw e;});const egress=await this.browserEgress;if(this.closed)throw Error('应用连接已关闭');const client=new Client({name:'feiyu-web',version:'1'});await client.connect(new StdioClientTransport({command:process.execPath,args:[cli,'--browser','msedge',...(contextKey==='admin'&&this.browserVisible?[]:['--headless']),'--user-data-dir',profile,'--output-dir',path.join(profile,'output'),'--proxy-server',egress.server,'--proxy-bypass','<-loopback>','--block-service-workers','--init-page',path.join(this.root,'scripts/browser-network-guard.cjs'),'--idle-timeout','300000'],env:{...process.env,FEIYU_BROWSER_READONLY:contextKey==='admin'?'0':'1'},stderr:'pipe'}));return client;})().catch(e=>{this.browserConnections.delete(contextKey);throw e;});this.browserConnections.set(contextKey,connection);return connection;}

 async loginBrowser(url,{done=false}={}){const existing=this.browserConnections?.get('admin');if(existing){try{await (await existing).close();}catch{}this.browserConnections.delete('admin');}this.browserVisible=!done;if(done)return {background:true};return this.browser('open',{url},{admin:true});}
 creationBoundary(row){try{return row.kind==='creation-draft'?this.creatorSandbox.describe(row.cwd,row.session_id).boundary:undefined;}catch{return undefined;}}
 tasks(){return this.db.prepare('SELECT id FROM app_tasks ORDER BY created_at DESC,rowid DESC LIMIT 40').all().map(row=>this.taskView(this.taskRow(row.id)));}
 taskList(requester){return requester==='private:'+this.cfg.ownerQQ?this.tasks().filter(row=>row.requester===requester):[];}
 checkWorkAdmission(requester,creation,phase){
  const verdict=this.assertWorkAdmission({requester,kind:creation?'creation-draft':'work',phase});
  if(verdict&&typeof verdict.then==='function'){void Promise.resolve(verdict).catch(()=>{});throw Object.assign(Error('WORK_ADMISSION_MUST_BE_SYNCHRONOUS'),{code:'WORK_ADMISSION_MUST_BE_SYNCHRONOUS'});}
  if(verdict===false||verdict?.allowed===false)throw Object.assign(Error('今日费用已达到软上限，暂缓新建工作与创造会话。'),{code:'DAILY_SOFT_LIMIT_WIND_DOWN',statusCode:429,retryAt:verdict?.nextResetAt});
  return verdict;
 }
 async createCapability(requester,prompt,{guard,host}={}){
  if(requester!=='private:'+this.cfg.ownerQQ)throw Error('只有管理员能使用创造工具');
  if(!this.settings.creationEnabled)throw Error('创造工具默认关闭，请由管理员在应用中心开启后明确委托');
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>10000)throw Error('创造需求无效');
  if(this.closed)throw Error('应用连接已关闭，工作委托已撤销');
  guard?.();
  const request='为肥鱼开发一个工具或DSH插件草稿。需求：'+prompt+'\n本次只产出草稿、说明与测试，不安装、不注册、不热加载，不修改生产配置、角色人格、记忆数据库或现有插件。不对社交网站执行写操作。所有新文件和测试产物保存在当前工作目录，列明依赖、权限、测试命令、结果与待验证项，生成manifest.json。资料不得包含本机凭据和私人聊天原文。现有接口通过工作区内的只读 reference 快照提供。';
  return {...await this.startTask(requester,request,{creation:true,guard,host}),kind:'creation-draft',installed:false};
 }
 async startTask(requester,prompt,{creation=false,cwd,guard,host}={}){
  if(requester!=='private:'+this.cfg.ownerQQ)throw Error('只有管理员能唤醒工作会话');
  if(creation?!this.settings.creationEnabled:!this.settings.complexTasks)throw Error('该工作入口默认关闭，请在应用中心开启');
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>12000)throw Error('任务内容无效');
  let revoked=false,sessionId;
  const check=()=>{try{if(this.closed)throw Error('应用连接已关闭，工作委托已撤销');if(requester!=='private:'+this.cfg.ownerQQ)throw Error('管理员归属已变更，工作委托已撤销');if(creation?!this.settings.creationEnabled:!this.settings.complexTasks)throw Error('该工作入口已关闭，工作委托已撤销');guard?.();}catch(error){revoked=true;throw error;}};
  check();
  const identity=normalizeTaskHost(host??this.getTaskHost(),{ownerScope:requester}),kind=creation?'creation-draft':'work';
  const requestKey=identity.requestId?digest([identity.profileId,identity.characterId,identity.roleEpoch,identity.activationEpoch,requester,kind,identity.requestId]):null,inputHash=digest([prompt,identity]);
  if(requestKey){const prior=this.db.prepare('SELECT task_id,input_hash FROM app_task_meta WHERE request_key=?').get(requestKey);if(prior){if(prior.input_hash!==inputHash)throw Object.assign(Error('TASK_REQUEST_CONFLICT'),{code:'TASK_REQUEST_CONFLICT'});return this.workResponse(prior.task_id);}}
  this.checkWorkAdmission(requester,creation,'new-task');
  const id=randomUUID(),createdAt=Date.now(),workingDirectory=cwd||(creation?path.join(this.root,'work','creations',id):this.cfg.sessionCwd||path.resolve(this.root,'../..'));
  this.atomic(()=>{this.db.prepare("INSERT INTO app_tasks VALUES(?,?,?,NULL,'creating',NULL,?)").run(id,requester,prompt,createdAt);this.db.prepare("INSERT INTO app_task_meta VALUES(?,?,?,?,?,'staged',?,?,NULL,NULL,0,?)").run(id,kind,JSON.stringify(identity),requestKey,inputHash,workingDirectory,id,createdAt);});
  let settleRun;const finished=new Promise(resolve=>{settleRun=resolve;});this.pendingTaskRuns.set(id,finished);
  try{
   if(creation){check();this.phase(id,'sandbox-preparing');await this.creatorSandbox.prepare(workingDirectory);check();this.phase(id,'sandbox-prepared');}
   check();
   this.checkWorkAdmission(requester,creation,'session-create');
   this.phase(id,'create-submitting');
   const created=await this.taskRpc('session.create',()=>this.api.sessions.create({cwd:workingDirectory,agentPreset:creation?CREATOR_PRESET:'standard'}));
   if(typeof created?.sessionId!=='string'||!created.sessionId||created.sessionId.length>256)throw Error('INVALID_SESSION_CREATION_RECEIPT');
   // Save the returned identity before checking cancellation, so a session that
   // was created during a role switch can still be stopped and audited.
   sessionId=created.sessionId;this.atomic(()=>{this.db.prepare('UPDATE app_tasks SET session_id=? WHERE id=?').run(sessionId,id);this.phase(id,'session-created');});check();this.checkWorkAdmission(requester,creation,'session-created');if(creation){if(created.agentPreset!==CREATOR_PRESET)throw Error('CREATION_PRESET_UNVERIFIED');this.creatorSandbox.bindSession(workingDirectory,sessionId);check();}
   this.api.events?.follow(sessionId);
   if(creation){
    check();this.phase(id,'sandbox-pinning');
    this.checkWorkAdmission(requester,creation,'permission-pin');
    const pinned=await this.taskRpc('commands.execute',()=>this.api.callUnary('commands/execute',{agentId:sessionId,line:'/permission workspace-write',submittedAttachments:[]}));check();
    if(pinned?.result?.kind!=='success')throw Error('CREATION_SANDBOX_PIN_FAILED');
    const policy=await this.taskRpc('session.projections',()=>this.api.callUnary('session/projections',{sessionId}));check();
    if(policy?.values?.permissions?.currentValue!=='workspace-write')throw Error('CREATION_SANDBOX_UNVERIFIED');
    this.phase(id,'sandbox-verified');
   }
   check();this.checkWorkAdmission(requester,creation,'model-selection');this.phase(id,'model-selecting');await this.taskRpc('session.selectModel',()=>this.api.sessions.selectModel({sessionId,provider:this.cfg.dsh?.provider||'deepseek-official',model:this.cfg.dsh?.model||'deepseek-flash',reasoningEffort:'high'}));this.phase(id,'model-selected');check();
   check();this.checkWorkAdmission(requester,creation,'prompt-submit');this.phase(id,'prompt-submitting');const accepted=await this.taskRpc('session.prompt',()=>this.api.sessions.prompt({sessionId,requestId:id,mode:'queue',content:[{type:'text',text:'这是管理员从肥鱼聊天中明确委托的独立工作任务。与日常人格聊天分开执行，不向QQ或其他社交渠道自行发消息。完成后在此会话给出结果。\n'+prompt}]}));check();
   this.atomic(()=>{const row=this.taskRow(id);if(row.status==='creating'){this.db.prepare("UPDATE app_tasks SET status='running' WHERE id=?").run(id);this.phase(id,'accepted');}if(Number.isSafeInteger(accepted?.turn)&&accepted.turn>=0&&row.turn==null)this.db.prepare('UPDATE app_task_meta SET turn=? WHERE task_id=?').run(accepted.turn,id);});
   this.notify({kind:'task',id,sessionId,status:this.taskRow(id).status});
   return this.workResponse(id);
  }catch(error){
   if(!revoked){try{check();}catch(revokedError){error=revokedError;}}
   const row=this.taskRow(id);
   // Native events can prove acceptance even if the unary prompt ACK was lost.
   if(!revoked&&['executing','complete','failed','cancelled','waiting'].includes(row.phase))return this.workResponse(id);
   const costDeferred=error.code==='DAILY_SOFT_LIMIT_WIND_DOWN',uncertain=!error.taskDefinitive&&['create-submitting','prompt-submitting'].includes(row.phase),status=revoked?'cancelled':costDeferred?'deferred':uncertain?'unknown':'failed';
   this.atomic(()=>{this.db.prepare('UPDATE app_tasks SET status=?,error=? WHERE id=?').run(status,reason(error),id);if(costDeferred)this.phase(id,'daily-cost-deferred');this.outcome(id);});
   if(creation)this.creatorSandbox.revoke(workingDirectory);
   if((revoked||creation||costDeferred)&&sessionId){try{await this.api.stopSessionWork?.(sessionId);}catch(stopError){this.db.prepare("UPDATE app_tasks SET error=substr(error||'; stopSessionWork: '||?,1,180) WHERE id=?").run(reason(stopError),id);}}
   this.kickTaskOutcomes();
   error.taskId=id;error.taskStatus=status;
   throw error;
  }finally{this.pendingTaskRuns.delete(id);settleRun();}
 }
 async taskRpc(label,invoke){const response=await invoke();try{return unwrap(response,label);}catch(error){if(nativeFailure(response))error.taskDefinitive=true;throw error;}}
 workResponse(id){const row=this.taskRow(id);return {...this.taskView(row),sessionId:row.session_id,...(row.session_id?{url:(this.cfg.dsh?.baseUrl||'http://127.0.0.1:3080').replace(/\/$/,'')+'/?session='+encodeURIComponent(row.session_id)}:{})};}
 taskResult(requester,id){if(requester!=='private:'+this.cfg.ownerQQ)throw Error('只有管理员可以查询工作结果');const row=this.taskRow(id);if(!row||row.requester!==requester)throw Error('找不到工作任务');return {...this.taskView(row),result:this.db.prepare('SELECT text FROM app_task_results WHERE id=?').get(id)?.text||''};}
 observeSnapshot(sessionId,snapshot){for(const record of snapshot?.records||[])if(record.type==='event'&&record.event)this.observe(sessionId,record.event,{recovered:true});}
 observe(sessionId,event,{recovered=false}={}){
  if(this.closed)return;
  const selected=this.db.prepare('SELECT id FROM app_tasks WHERE session_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1').get(sessionId),task=selected&&this.taskRow(selected.id);if(!task||!event||!['turn/start','assistant/message','turn/end'].includes(event.type))return;
  const turn=event.data?.turn,requestId=event.data?.requestId??event.data?.source?.requestId,seq=event.seq;
  if(turn!=null&&(!Number.isSafeInteger(turn)||turn<0)||seq!=null&&(!Number.isSafeInteger(seq)||seq<0))return;
  if(requestId!=null&&requestId!==task.native_request_id)return;
  if(['cancelled','unknown'].includes(task.status)&&task.turn==null)return;
  if(task.turn!=null&&turn!=null&&turn!==task.turn)return;
  if(Number.isSafeInteger(seq)&&task.last_seq!=null&&seq<=task.last_seq)return;
  // A new exclusive session has one submitted request. Only a persisted native
  // turn binds recovery: the installed event contract does not guarantee a
  // requestId field, and a snapshot cannot manufacture the missing binding.
  if((recovered||task.recovered)&&(task.turn==null||turn!==task.turn))return;
  if(['staged','create-submitting','session-created','model-selecting','model-selected'].includes(task.phase))return;
  if(terminal.has(task.status)&&task.status!=='cancelled')return;
  const eventKey=digest([event.type,seq??null,event.data]);let notification;
  this.atomic(()=>{
   if(!this.db.prepare('INSERT OR IGNORE INTO app_task_events VALUES(?,?)').run(sessionId,eventKey).changes)return;
   if(Number.isSafeInteger(seq))this.db.prepare('UPDATE app_task_meta SET last_seq=? WHERE task_id=?').run(seq,task.id);
   if(task.turn==null&&Number.isSafeInteger(turn))this.db.prepare('UPDATE app_task_meta SET turn=? WHERE task_id=?').run(turn,task.id);
   if(recovered)this.db.prepare('UPDATE app_task_meta SET recovered=1 WHERE task_id=?').run(task.id);
   if(event.type==='assistant/message'){const text=(event.data?.message?.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n');if(text){const old=this.db.prepare('SELECT text FROM app_task_results WHERE id=?').get(task.id)?.text||'';this.db.prepare('INSERT OR REPLACE INTO app_task_results VALUES(?,?,?)').run(task.id,(old+'\n'+text).slice(-20000),Date.now());}}
   if(event.type==='turn/start'&&task.status!=='cancelled'){this.db.prepare("UPDATE app_tasks SET status='running' WHERE id=?").run(task.id);this.phase(task.id,'executing');}
   if(event.type==='turn/end'){const kind=event.data?.reason?.kind,nativeStatus=kind==='error'?'failed':kind==='aborted'?'cancelled':['completed','stop'].includes(kind)?'complete':'waiting',status=task.status==='cancelled'?'cancelled':nativeStatus;this.db.prepare('UPDATE app_tasks SET status=? WHERE id=?').run(status,task.id);this.phase(task.id,status==='cancelled'?'cancelled':nativeStatus);if(status!=='waiting')this.outcome(task.id,{nativeStatus,eventKey});notification={kind:'task',id:task.id,sessionId,status};}
  });
  if(notification){this.notify(notification);this.kickTaskOutcomes();}
 }

 async status(){let obc;try{const r=await fetch('http://127.0.0.1:8420/api/ping',{signal:AbortSignal.timeout(1200)});obc=r.ok;}catch{obc=false;}return {reading:this.reading?.view('self'),name:APP_NAME,build:'2026-10-23-apps-v1',settings:this.settings,applications:[{id:'wechat',name:'微信',description:'iLink 机器人文字聊天 · 桌面控制暂缓',configured:true,login:this.wechat?.status().connected?'ready':'login-required'}, {id:'qq',name:'QQ',description:'私聊、动态与语音',manage:'#access',configured:true},{id:'bilibili-legacy',name:'哔哩哔哩',description:'视频、搜索与兴趣活动',manage:'#apps',configured:true},{id:'openbiliclaw',name:'多网站',description:'小红书、抖音、YouTube、X、知乎、Reddit、微博等',manage:'http://127.0.0.1:8420/web',online:obc},{id:'browser',name:'网页',description:'Edge页面读取与可选交互',configured:fs.existsSync(path.resolve(this.root,'../../work/integration-runtime/browser/node_modules/@playwright/mcp/cli.js'))},{id:'files',name:'文件',description:'PDF、Word、视频和动图',configured:true},{id:'pet',name:'语音与弹幕',description:'Ctrl+Alt+空格语音，同一角色的透明聊天窗',configured:fs.existsSync(path.resolve(this.root,'../../clients/feiyu-hotkey/feiyu_hotkey/__main__.py'))},{id:'creation',name:'创造',description:'开发工具和插件草稿；默认关闭、不自动安装',enabled:this.settings.creationEnabled},{id:'work',name:'DSH工作',description:'管理员复杂任务，独立会话',enabled:this.settings.complexTasks},...(this.social?.status()||[]).map(p=>({id:p.id,name:p.name,description:p.provider+' · '+p.read.length+'种读取 / '+p.write.length+'种互动',login:p.login,enabled:p.enabled,configured:p.installed}))].filter(a=>a.id!=='bilibili-legacy'),tasks:this.tasks(),social:this.social?.status()||[],socialHistory:this.social?.history()||[]};}
 async close(){
  if(this.closePromise)return this.closePromise;
  this.closed=true;
  for(const row of this.db.prepare("SELECT a.*,m.cwd,m.kind FROM app_tasks a JOIN app_task_meta m ON m.task_id=a.id WHERE m.kind='creation-draft'").all())if(row.cwd)this.creatorSandbox.revoke(row.cwd);
  // Keep the role-local task database alive until any late session identity can
  // be stopped. Mark cancellation first, including shutdown's bounded exit path.
  for(const id of this.pendingTaskRuns.keys())this.db.prepare("UPDATE app_tasks SET status='cancelled',error='应用连接关闭，工作委托已撤销' WHERE id=?").run(id);
  this.closePromise=(async()=>{
   const adapters=[()=>this.wechatDesktop?.close(),()=>this.wechat?.close(),()=>this.social?.close(),
    ...[...(this.browserConnections?.values()||[])].map(c=>async()=>(await c).close())];
   await Promise.allSettled([...this.pendingTaskRuns.values(),...(this.outcomeFlush?[this.outcomeFlush]:[]),...adapters.map(close=>Promise.resolve().then(close))]);if(this.browserEgress)try{await (await this.browserEgress).close();}catch{}this.db.close();
  })();
  return this.closePromise;
 }
}
