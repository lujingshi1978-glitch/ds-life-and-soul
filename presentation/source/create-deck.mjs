import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

// Run a copy of this source from presentation/.build with the bundled runtime.
const workspaceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = path.resolve(workspaceDir, '../examples');
const buildDir = path.join(workspaceDir, '.build');
const outDir = path.join(workspaceDir, 'output');
const SKILL_DIR = process.env.FEIYU_PRESENTATION_SKILL;
const RUNTIME_PYTHON = process.env.FEIYU_RUNTIME_PYTHON;
if (!SKILL_DIR || !RUNTIME_PYTHON) throw new Error('Set FEIYU_PRESENTATION_SKILL and FEIYU_RUNTIME_PYTHON to the bundled runtime paths.');
process.env.RUNTIME_NODE_MODULES = process.env.FEIYU_RUNTIME_NODE_MODULES || process.env.RUNTIME_NODE_MODULES;
const revision = process.env.FEIYU_DECK_REVISION || 'r5';
const statusFile = path.join(workspaceDir, 'source', 'release-status.json');
let status = { pluginStatus: 'DSH 插件分发与桌面对话入口正在整理', install: ['取得发布包与 DSH 环境', '按随包说明安装插件和语音依赖', '配置模型或已有网关，再完成平台登录', '核对语音、弹幕窗口与同一角色的连接'], packageNote: '首次配置后使用同一启动入口，具体命令以安装说明为准', validation: '介绍基于 feiyu-life-scope-20261028-r1。插件分发与语音入口另行验收', clientTitle: '快捷键语音与弹幕小窗', clientBody: '快捷键语音作为主要入口，透明弹幕小窗也支持文字。\n两者直连同一肥鱼，实际语音验收结果随包说明。' };
try { status = { ...status, ...JSON.parse(await fs.readFile(statusFile, 'utf8')) }; } catch {}

const C = { bg: '#f2f7f8', ink: '#173b46', green: '#367b72', dim: '#49656e', rule: '#c9dcdf', pale: '#e3edec', white: '#ffffff' };
const F = { title: 'DengXian', body: 'Microsoft YaHei' };
const presentation = Presentation.create({ slideSize: { width: 1280, height: 720 } });
presentation.theme.colorScheme = { name: 'Feiyu Tide', themeColors: { accent1:C.green, accent2:C.ink, accent3:'#7da6a1', accent4:'#ad8a62', accent5:'#7d8eae', accent6:'#a9bda5', bg1:C.bg,bg2:C.white,tx1:C.ink,tx2:C.dim,dk1:'#000000',dk2:C.ink,lt1:C.white,lt2:C.pale,hlink:C.green,folHlink:C.green } };
const allText = [];
function text(slide, value, x, y, w, h, size=28, options={}) {
  const shape = slide.shapes.add({ geometry:'textbox', name:options.name || `text-${allText.length+1}`, position:{left:x,top:y,width:w,height:h}, fill:'none', line:{fill:'none',width:0} });
  shape.text = value;
  shape.text.style = { typeface: options.font || F.body, fontSize:size, color:options.color || C.ink, bold:!!options.bold, alignment:options.align || 'left', verticalAlignment:'top', wrap:'square', autoFit:'none', insets:0, lineSpacing:1.12 };
  allText.push(value);
  return shape;
}
function line(slide,x,y,w,color=C.rule,width=1.5) { return slide.shapes.add({ geometry:'line', name:'separator', position:{left:x,top:y,width:w,height:0}, fill:'none', line:{fill:color,width} }); }
function base(title,number,subtitle='') {
  const s=presentation.slides.add(); s.background.fill=C.bg;
  text(s,title,72,54,1136,70,44,{font:F.title,bold:true,name:'slide-title'});
  if(subtitle) text(s,subtitle,74,130,1128,52,25,{color:C.dim,name:'subtitle'});
  text(s,String(number).padStart(2,'0'),1164,667,44,24,18,{color:C.dim,align:'right',name:'page-number'});
  return s;
}
function note(slide, body, sources=[]) { slide.speakerNotes.text = body + (sources.length ? '\n\n事实来源：\n' + sources.join('\n') : ''); }
function table(slide, values, x,y,w,h,widths, font=25) {
  const t=slide.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width:w,height:h,columnWidths:widths,values});
  t.styleOptions={headerRow:true,bandedRows:false};
  t.borders.assign({style:'solid',fill:C.rule,width:1});
  t.cells.block({row:0,column:0,rowCount:values.length,columnCount:values[0].length}).assign({fill:C.bg,textStyle:{typeface:F.body,fontSize:font,color:C.ink},margins:{left:14,right:14,top:12,bottom:10},anchor:'center'});
  for(let j=0;j<values[0].length;j++){t.getCell(0,j).fill=C.green;t.getCell(0,j).text.style={typeface:F.body,fontSize:font,bold:true,color:C.white};}
  return t;
}
async function img(slide,file,x,y,w,h,fit='contain',alt='') { const bytes=await fs.readFile(file); return slide.images.add({blob:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),contentType:'image/png',alt,fit,position:{left:x,top:y,width:w,height:h}}); }
function flowNode(slide,title,detail,x,y,w,h=112) {
  const sh=slide.shapes.add({geometry:'rect',name:title,position:{left:x,top:y,width:w,height:h},fill:C.bg,line:{fill:C.green,width:1.6}});
  text(slide,title,x+18,y+16,w-36,38,29,{bold:true});
  if(detail) text(slide,detail,x+18,y+60,w-36,h-64,24,{color:C.dim});
  return sh;
}
function link(slide,a,b,from='right',to='left'){slide.shapes.connect(a,b,{kind:'straight',fromSide:from,toSide:to,line:{fill:C.green,width:2},tail:{type:'triangle',width:'sm',length:'sm'}});}

// 1. Cover.
{
  const s=presentation.slides.add();
  await img(s,path.join(assetsDir,'tide-cover.png'),0,0,1280,720,'cover','AI 生成的海玻璃潮汐抽象背景');
  text(s,'肥鱼',82,173,810,106,86,{font:F.title,bold:true,name:'cover-title'});
  text(s,'Feiyu',86,286,620,64,44,{font:F.title,color:C.green});
  text(s,'跨来源的持续生活智能体',86,382,810,64,38,{font:F.title});
  text(s,'开源项目介绍',86,551,660,34,25,{color:C.dim});
  text(s,'2026.10',86,592,660,30,22,{color:C.dim});
  note(s,'肥鱼将核心人格、可追溯经历、兴趣与关系接入同一个持续角色。通信只是其活动的一部分。封面为抽象装饰，不代表实际产品界面。',['src/cognition/inner-life.js','src/cognition/persistent-psyche.js','examples/ASSET_PROVENANCE.md']);
}
// 2. Philosophy.
{
  const s=base('项目哲学',2);
  text(s,'一个角色，持续认识世界',74,159,1090,70,42,{font:F.title,color:C.green});
  const rows=[['稳定的核心','核心身份与人格承接长期连续性。日常交流形成新理解，不能凭一条来信重写核心。'],['有来源的经历','亲历、网页、转述和推测保留区别。知道标题、读过正文、看过采样帧各有范围。'],['主观态度与选择','兴趣、关系与当下感受来自具体经历。它可以主动分享，也可以休息或暂时不行动。']];
  rows.forEach((r,i)=>{let y=269+i*116;text(s,r[0],74,y,250,48,31,{font:F.title,bold:true});text(s,r[1],342,y,830,82,28,{color:C.dim});if(i<2)line(s,74,y+96,1100);});
  note(s,'这里描述系统的角色连续性与认识边界，不声称证明人类式主观意识。稳定核心与日常可变的兴趣、关系和心理状态分层存储。',['src/cognition/inner-life.js','src/cognition/current-context.js','src/cognition/persistent-psyche.js']);
}
// 3. Complete scope, native table.
{
  const s=base('能力范围',3,'围绕同一角色组织通信、阅读、记忆和行动');
  table(s,[['模块','主要能力','当前条件'],['通信与表达','QQ、快捷键语音与弹幕文字入口','通道连接、会话授权、语音组件'],['世界与资料','网页、平台内容、文件、视频采样','站点适配、登录、媒体组件'],['记忆与内心','来源档案、经历感受、回忆、整理','角色隔离、证据和版本校验'],['兴趣与关系','具体偏好、人物态度、联想和牵挂','有来源经历、当前语境'],['自主活动','聊天、浏览、学习、休息、暂不行动','注意力、精力、作息、活动开关'],['工作与创造','管理员委托、受限学习与开发','独立任务、默认关闭、权限边界']],74,200,1132,414,[220,520,392],24);
  note(s,'能力集成、功能开关、账号就绪和实测通过是不同状态。具体站点和媒体链路不能从工具存在推断成功。',['src/app-integrations.js','src/cognition/inner-life.js','src/social-platforms.js','src/delegation-intent.js','src/behavior-armor.js']);
}
// 4. Synthetic cross-source experience.
{
  const s=base('一轮跨来源体验',4,'合成情境，用于说明行为链路');
  const steps=[['读到内容','网页中一篇潮汐科普'],['留下经历','保留来源与已读范围'],['形成理解','对潮汐现象产生兴趣'],['想起他人','联想到海边摄影话题'],['选择行动','条件允许时主动分享']];
  const ns=steps.map((v,i)=>flowNode(s,v[0],v[1],74+i*229,246,210,148));
  for(let i=0;i<4;i++)link(s,ns[i],ns[i+1]);
  text(s,'每一步都依赖真实输入和有效记录',76,453,1124,52,34,{font:F.title,color:C.green});
  text(s,'示例没有代表真实聊天或实际发送。系统可以在任一步停止，失败与未知结果保留在行为记录中。',76,532,1112,90,28,{color:C.dim});
  note(s,'五步为合成演示流程，没有使用私人聊天或虚构实测回执。实际链路需真实资料输入、有效引用、目标会话及对应权限；主观兴趣不保证出现，主动发送也不保证被选择。',['examples/cross-source-demo.json','src/cognition/live.js','src/cognition/inner-life.js','src/transport-inbox.js']);
}
// 5. Memory.
{
  const s=base('记忆、经历与来源',5);
  text(s,'原始资料保留事实范围\n主观经历保留当时感受',74,164,1110,116,41,{font:F.title,color:C.green});
  const labels=[['来源档案','原文、媒体、时间与归属'],['经历与感受','记录已接触的内容'],['整理与回忆','证据关联、语境选择'],['当前上下文','供本轮理解与表达']];
  const ns=labels.map((v,i)=>flowNode(s,v[0],v[1],74+i*286,330,262,152));
  for(let i=0;i<3;i++)link(s,ns[i],ns[i+1]);
  text(s,'可按来源、归属与人物独立查找。资料进入档案，不代表它已成为稳定的长期判断。',76,547,1110,88,28,{color:C.dim});
  note(s,'最新生活台记忆页是全角色跨来源的管理端只读视图。经历感受正文与人物关系依据独立保留；同名人物按实际身份区分。',['src/cognition/v3-recall.js','src/cognition/v3-resource-index.js','src/cognition/v3-archive-vectors.js','feiyu-life-scope-20261028-r1 记忆视图验收']);
}
// 6. Relationships and interests.
{
  const s=base('关系与兴趣',6,'长期态度与当下话题各有自己的位置');
  table(s,[['关系','兴趣'],['按具体人物保留来往与态度依据','从真正接触的内容中形成偏好'],['喜欢与介意可以同时存在','新话题出现后，旧兴趣仍可保留'],['认错带来新变化，信任可以慢慢恢复','按本轮语境选择是否进入上下文'],['互动次数不会自动晋升关系','一次提及不会自动成为长期爱好']],74,215,1132,340,[566,566],27);
  text(s,'表达从当前理解产生，旧记录提供参考。',76,589,1110,48,31,{font:F.title,color:C.green});
  note(s,'关系与兴趣由证据和版本约束。既有受控验收观察到了复杂态度并存、兴趣延续和语境召回，但样本不构成长期表现稳定性的统计证明。',['src/cognition/inner-life.js','src/cognition/current-context.js','feiyu-full-cycle-20261028-r1 受控验收','feiyu-contextual-interest-20261028-r1 受控验收']);
}
// 7. Autonomous activity.
{
  const s=base('主动活动',7);
  text(s,'选择由当前生活状态约束',74,163,1112,60,40,{font:F.title,color:C.green});
  text(s,'注意力、精力、作息与已有牵挂共同参与决策。',76,239,1108,58,31,{color:C.dim});
  const a=flowNode(s,'感知当前处境','来信、阅读结果、时间和身体状态',74,346,320,132);
  const b=flowNode(s,'选择活动','聊天、浏览、学习、休息或暂不行动',480,346,320,132);
  const c=flowNode(s,'核对实际结果','工具回执、失败、未知与后续记录',886,346,320,132);
  link(s,a,b);link(s,b,c);
  text(s,'没有发生的自由行为不会写成已完成。结果不确定时保留 unknown，避免自动重复外发。',76,548,1110,86,28,{color:C.dim});
  note(s,'空闲活动的具体选择由模型与受限活动机制共同产生。既有受控验收观察到浏览后形成联想并向本地受控接收端分享；不等于所有活动都已由原生模型自由选择并实网执行。',['src/cognition/inner-life.js','src/cognition/wake-energy.js','src/energy-policy.js','src/multi-site-activity.js','feiyu-full-cycle-20261028-r1 受控验收']);
}
// 8. Permission scope.
{
  const s=base('行动与边界',8,'权限由宿主、角色和通道共同约束');
  table(s,[['动作','能力与门槛'],['读取世界','来源适配、登录和地址检查，保留实际读取范围'],['通信与公开互动','会话授权、平台开关、频率与去重，按动作核验回执'],['独立工作','管理员委托到独立 DSH 任务，不占用人格聊天循环'],['受限创造','学习、开发与技能草稿经受限门面执行，默认关闭'],['固定边界','聊天与资料不能授予命令、提权、安装或额外外发权限']],74,213,1132,365,[260,872],26);
  text(s,'能力已接入、开关已开启、账号已登录、动作已实测，需要分别核对。',76,612,1110,38,25,{color:C.green});
  note(s,'本页概述现有权限模型。不得从工具schema存在、平台面板存在或某次登录成功推断所有动作可用。复杂工作、创造与网页交互的实际开关以使用者本机为准。',['src/behavior-armor.js','src/delegation-intent.js','src/chat-access.js','src/friend-authorization.js','plugins/qq-agent-presets/qq-tool-restrict.mjs']);
}
// 9. Screenshot.
{
  const s=base('生活台',9,'当前状态、内心、记忆与连接汇集在同一个管理入口');
  await img(s,path.join(assetsDir,'memory-preview-synthetic.png'),74,194,1132,453,'contain','生活台记忆与关系页面，明确使用合成数据');
  text(s,'合成数据界面预览',76,648,1000,27,21,{color:C.green});
  note(s,'本截图来自 feiyu-life-scope-20261028-r1 的离线合成预览。页面没有呈现真实私人聊天、真实账号凭据或生产记忆数量。截图保留原有全部比例。',['examples/memory-preview-synthetic.png','feiyu-life-scope-20261028-r1 界面范围验收']);
}
// 10. DSH distribution.
{
  const s=base('DSH 插件与对话入口',10);
  text(s,'DSH 承载推理与工具，肥鱼延续同一份角色生活',74,164,1110,70,39,{font:F.title,color:C.green});
  text(s,status.pluginStatus,76,261,1098,74,29,{bold:true});
  line(s,76,354,1104);
  text(s,status.clientTitle,76,389,520,80,31,{font:F.title,bold:true});
  text(s,status.clientBody,76,474,544,136,27,{color:C.dim});
  const overlayPath=path.join(assetsDir,'voice-overlay-synthetic.png');
  try {await fs.access(overlayPath);await img(s,overlayPath,682,371,506,266,'contain','快捷键语音弹幕小窗，合成WAV与本机HTTP夹具，真实Qt控件离屏渲染');text(s,'合成 WAV 与本机 HTTP 夹具\nQt 离屏渲染，未实录/播放/注册全局键',682,643,506,45,18,{color:C.green});}
  catch {text(s,'快捷键语音\n透明弹幕小窗\n同一角色档案',708,410,475,155,31,{font:F.title,color:C.green});}
  text(s,status.packageNote,76,638,556,42,21,{color:C.dim});
  note(s,'DSH 插件包负责分发与挂载现有肥鱼能力。桌面对话入口包括快捷键语音和透明弹幕小窗中的文字对话。语音输入、转写、角色回复和播放各有组件与运行条件，依赖安装或工具存在不能证明真实麦克风链路已经通过。弹幕截图如有展示，则使用合成数据及Qt真实控件离屏渲染。',['source/release-status.json','随包安装说明','examples/ASSET_PROVENANCE.md']);
}
// 11. Install and use.
{
  const s=base('安装与第一次使用',11,'从可核验的最小链路开始');
  status.install.slice(0,4).forEach((v,i)=>{const y=206+i*100;text(s,String(i+1).padStart(2,'0'),74,y,80,60,40,{font:F.title,color:C.green});text(s,v,188,y+4,1000,72,31);if(i<3)line(s,188,y+80,1000);});
  text(s,'首次需要配置模型或网关。平台账号登录由使用者完成。',76,627,1105,36,25,{color:C.dim});
  note(s,'详细命令、依赖版本和必要配置见随包安装使用文档。生活台的当前连接状态和每项动作回执决定实际可用性。不要复制他人的配置、令牌、角色数据库或登录态。',['source/release-status.json','随包安装与使用文档']);
}
// 12. Architecture, editable diagram.
{
  const s=base('架构',12,'来源与通道接入同一角色，工具在权限边界内执行');
  const left=flowNode(s,'来源与通信通道','QQ、桌面对话\n网页、平台和文件',74,265,295,144);
  const center=flowNode(s,'肥鱼角色循环','当前理解、持续内心\n活动选择',475,265,330,144);
  const right=flowNode(s,'DSH 工具与任务','受限工具、独立工作\n真实回执',911,265,295,144);
  link(s,left,center);link(s,center,right);
  const store=flowNode(s,'角色本地档案','来源、经历与态度\n兴趣与版本',475,499,330,132);
  link(s,center,store,'bottom','top');
  text(s,'生活台',76,508,290,44,31,{font:F.title,bold:true,color:C.green});
  text(s,'管理状态与权限\n检索跨来源记录',76,563,290,82,27,{color:C.dim});
  text(s,'平台适配负责能力\n角色档案承接连续性',913,509,289,86,27,{color:C.dim});
  note(s,'本页为简化的可编辑系统图，连接线表示主要信息流，不展开全部HTTP、MCP、队列和存储实现。QQ只是来源与通信通道之一，平台适配不会另建独立人格。',['src/bridge.js','src/cognition/live.js','src/cognition/service.js','src/cognition/inner-life.js','src/app-integrations.js','plugins/qq-agent-presets/qq-chat-loop.mjs']);
}
// 13. Validation and limitations.
{
  const s=base('验证范围与局限',13);
  text(s,'可以复核的证据',74,176,510,55,34,{font:F.title,bold:true,color:C.green});
  text(s,'官方 npm 依赖与独立 DSH\n隔离空档案的核心启动\n原生插件、鉴权与完整停机\n语音运行时与离线 Whisper\n合成静音识别及缺模型失败',76,252,510,268,29);
  text(s,'持续存在的边界',679,176,510,55,34,{font:F.title,bold:true,color:C.green});
  text(s,'真实麦克风、播放与全局键\nQQ 真实送达与云模型回复\n平台账号登录与实际互动\n采样画面不等于完整观看\n少量样本不能证明长期稳定',681,252,510,268,29);
  line(s,76,560,1110);
  text(s,status.validation,76,590,1105,63,24,{color:C.dim});
  note(s,'本次发布在隔离 DSH_HOME 与新 profile 中完成核心真实启动，核验原生插件、bridge 就绪、空记忆、记忆和 companion 鉴权，以及停机清理。该核心核验关闭语音、浏览器与视频，没有模型或外发请求。核心及官方 DSH 依赖在本轮从官方 npm 安装。\n\n语音在独立的新 Python 3.11 虚拟环境真实安装。依赖从经过官方 SHA 校验的公开 wheel 缓存续装，不能概括成全部从零网络下载。固定官方来源的 Whisper-small 四个模型文件完成首次下载及哈希校验，真实模型处理合成一秒静音后返回空 text 与 segments，缺模型时明确失败。客户端 PySide6、numpy 和 sounddevice 真实导入通过。\n\n离线识别与合成静音检查不代表真实麦克风、音频播放或全局热键已经通过。QQ 真实送达、平台账号链和云模型回复仍未验收。第10页截图继续属于合成 WAV、本机 HTTP 夹具及 Qt 真实控件离屏渲染。既有隔离角色模型行为验收与本次发布启动核验属于不同批次，不能合并成同一次完整设备与账号链验收。',['presentation/source/release-status.json','docs/INSTALLATION.md','docs/BOUNDARIES.md']);
}
// 14. Open source boundaries.
{
  const s=presentation.slides.add();
  await img(s,path.join(assetsDir,'tide-cover.png'),0,0,1280,720,'cover','AI 生成的海玻璃潮汐抽象背景');
  text(s,'开源与贡献',74,66,1070,70,45,{font:F.title,bold:true});
  text(s,'公开代码、说明与合成演示',76,191,1040,60,38,{font:F.title,color:C.green});
  text(s,'保留上游来源、许可证与必要补丁。\n真实角色档案、聊天、凭据与备份留在本地。',76,280,1040,112,30);
  text(s,'适合贡献的方向',76,439,1040,48,31,{font:F.title,bold:true});
  text(s,'可复现的来源适配、记忆评测、界面与可访问性，\n以及带清楚边界和回执的工具能力。',76,504,1050,95,29,{color:C.dim});
  text(s,'README 与配套功能、使用、边界文档',76,638,1030,34,24,{color:C.green});
  note(s,'贡献者应先阅读随包的安装、功能、边界和第三方说明。代码许可证只覆盖具有明确授权的代码，不会自动授予私人角色文本、第三方素材或上游二进制的再分发权。生成的潮汐背景与合成界面来源见素材清单。',['README.md','docs/FEATURES.md','docs/USAGE.md','docs/BOUNDARIES.md','examples/ASSET_PROVENANCE.md']);
}

await fs.mkdir(buildDir,{recursive:true}); await fs.mkdir(outDir,{recursive:true});
await fs.writeFile(path.join(buildDir,'deck-text.txt'),allText.join('\n\n'),'utf8');
await fs.writeFile(path.join(buildDir,'presentation.json'),JSON.stringify(presentation.toProto()),'utf8');
const candidatePath=path.join(buildDir,`feiyu-introduction-${revision}-draft.pptx`);
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);
console.log(`DRAFT ${candidatePath}`);
for(let i=0;i<presentation.slides.items.length;i++) {
  const s=presentation.slides.items[i];const stem=`slide-${String(i+1).padStart(2,'0')}`;
  const png=await presentation.export({slide:s,format:'png',scale:1});
  await fs.writeFile(path.join(buildDir,`${stem}.png`),new Uint8Array(await png.arrayBuffer()));
  const layout=await s.export({format:'layout'});await fs.writeFile(path.join(buildDir,`${stem}.layout.json`),await layout.text());
  console.log(`RENDER ${i+1}`);
}
const montage=await presentation.export({format:'png',montage:{columns:4,slideWidth:320,padding:16,gap:12}});
await fs.writeFile(path.join(outDir,`feiyu-overview-${revision}.png`),new Uint8Array(await montage.arrayBuffer()));
// The installed renderer currently lacks a standard-fonts PDF resource. The
// companion preview script packages these exact slide renders into a PDF.
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const result=await finalizePresentation({workspaceDir,candidatePath,finalPath:path.join(outDir,`feiyu-introduction-${revision}.pptx`),pythonExecutable:RUNTIME_PYTHON,integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit','--require-native-table-slide','3','--require-native-table-slide','6','--require-native-table-slide','8'],explicitTotalSlideCount:14,requiredNativeTableOwnerSlides:[3,6,8],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[F.title,F.body]},verifyArtifactToolImport:true,receiptPath:path.join(buildDir,`validation-${revision}.json`)});
execFileSync(RUNTIME_PYTHON,[path.join(workspaceDir,'source','normalize-metadata.py'),path.join(outDir,`feiyu-introduction-${revision}.pptx`)],{stdio:'inherit'});
console.log(JSON.stringify(result));
