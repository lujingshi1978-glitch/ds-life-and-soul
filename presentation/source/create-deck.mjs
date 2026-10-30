import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {Presentation,PresentationFile} from '@oai/artifact-tool';

// Copy this builder into presentation/.build and link its node_modules to the
// bundled runtime. Source images are documented in examples/ASSET_PROVENANCE.md.
const workspaceDir=process.env.FEIYU_DECK_WORKSPACE||path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assetsDir=process.env.FEIYU_DECK_ASSETS||path.resolve(workspaceDir,'../examples');
const buildDir=path.join(workspaceDir,'.build');
const outDir=path.join(workspaceDir,'output');
const SKILL_DIR=process.env.FEIYU_PRESENTATION_SKILL;
const PY=process.env.FEIYU_RUNTIME_PYTHON;
if(!SKILL_DIR||!PY)throw new Error('Bundled presentation skill and Python paths are required.');
const revision=process.env.FEIYU_DECK_REVISION||'philosophy-r5';
const C={bg:'#f2f7f8',ink:'#173b46',green:'#367b72',dim:'#49656e',rule:'#c9dcdf',pale:'#e3edec',white:'#ffffff',warm:'#946949',warmPale:'#f0e7de'};
const F={title:'DengXian',body:'Microsoft YaHei'};
const p=Presentation.create({slideSize:{width:1280,height:720}});
p.theme.colorScheme={name:'Feiyu Tide',themeColors:{accent1:C.green,accent2:C.ink,accent3:'#7da6a1',accent4:C.warm,accent5:'#7d8eae',accent6:'#a9bda5',bg1:C.bg,bg2:C.white,tx1:C.ink,tx2:C.dim,dk1:'#000000',dk2:C.ink,lt1:C.white,lt2:C.pale,hlink:C.green,folHlink:C.green}};
const texts=[],map=[];
function t(s,v,x,y,w,h,size=28,o={}){
 const sh=s.shapes.add({geometry:'textbox',name:o.name||`text-${texts.length+1}`,position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 sh.text=v;sh.text.style={typeface:o.font||F.body,fontSize:size,color:o.color||C.ink,bold:!!o.bold,alignment:o.align||'left',verticalAlignment:'top',wrap:'square',autoFit:'none',insets:0,lineSpacing:1.13};texts.push(v);return sh;
}
function rule(s,x,y,w,color=C.rule){return s.shapes.add({geometry:'line',position:{left:x,top:y,width:w,height:0},line:{fill:color,width:1.4},fill:'none'});}
function rect(s,x,y,w,h,fill=C.pale,stroke='none'){return s.shapes.add({geometry:'rect',position:{left:x,top:y,width:w,height:h},fill,line:{fill:stroke,width:stroke==='none'?0:1.4}});}
function node(s,title,detail,x,y,w=246,h=132,o={}){const sh=rect(s,x,y,w,h,o.fill||C.white,o.stroke||C.green);t(s,title,x+18,y+15,w-36,40,o.size||29,{bold:true,color:o.color||C.ink});if(detail)t(s,detail,x+18,y+64,w-36,h-69,o.detailSize||24,{color:C.dim});return sh;}
function arrow(s,a,b,from='right',to='left',color=C.green){return s.shapes.connect(a,b,{kind:'straight',fromSide:from,toSide:to,line:{fill:color,width:2},tail:{type:'triangle',width:'sm',length:'sm'}});}
function base(title,subtitle=''){const n=p.slides.items.length+1,s=p.slides.add();s.background.fill=C.bg;t(s,title,70,49,1140,72,44,{font:F.title,bold:true,name:'slide-title'});if(subtitle)t(s,subtitle,73,129,1134,56,25,{color:C.dim});t(s,String(n).padStart(2,'0'),1167,672,42,25,18,{align:'right',color:C.dim,name:'page-number'});map.push({slide:n,title});return s;}
function notes(s,body,source=[]){s.speakerNotes.text=body+'\n\n来源与口径：\n'+source.join('\n');}
function foot(s,v){t(s,v,74,639,1090,44,21,{color:C.dim});}
function rows(s,items,{x=74,y=213,w=1128,gap=126,labelW=220,size=28}={}){items.forEach(([a,b],i)=>{const yy=y+i*gap;t(s,a,x,yy,labelW,55,30,{bold:true,color:C.green,font:F.title});t(s,b,x+labelW+28,yy,w-labelW-28,gap-22,size,{color:C.dim});if(i<items.length-1)rule(s,x,yy+gap-17,w);});}
function table(s,values,x,y,w,h,widths,font=25){const tb=s.tables.add({rows:values.length,columns:values[0].length,left:x,top:y,width:w,height:h,columnWidths:widths,values});tb.styleOptions={headerRow:true,bandedRows:false};tb.borders.assign({style:'solid',fill:C.rule,width:1});tb.cells.block({row:0,column:0,rowCount:values.length,columnCount:values[0].length}).assign({fill:C.bg,textStyle:{typeface:F.body,fontSize:font,color:C.ink},margins:{left:14,right:14,top:11,bottom:10},anchor:'center'});for(let j=0;j<values[0].length;j++){tb.getCell(0,j).fill=C.green;tb.getCell(0,j).text.style={typeface:F.body,fontSize:font,bold:true,color:C.white};}return tb;}
async function image(s,name,x,y,w,h,alt,opts={}){const bytes=await fs.readFile(path.join(assetsDir,name));return s.images.add({blob:new Uint8Array(bytes),contentType:'image/png',fit:opts.fit||'contain',position:{left:x,top:y,width:w,height:h},alt,...(opts.crop?{crop:opts.crop}:{})});}

// 01 — retain the original visual identity; the narrative is newly expanded.
{
 const s=p.slides.add();map.push({slide:1,title:'肥鱼：从核心出发，长出自己的生活'});
 await image(s,'tide-cover.png',0,0,1280,720,'AI 生成的海玻璃潮汐抽象背景',{fit:'cover'});
 t(s,'肥鱼',80,118,760,113,88,{font:F.title,bold:true});
 t(s,'从核心出发，长出自己的生活',84,279,1070,72,44,{font:F.title,color:C.green});
 t(s,'经历如何变成记忆，记忆如何改变下一次选择',85,379,1030,88,31);
 t(s,'Feiyu · 持续生活智能体',85,555,900,40,27,{color:C.dim});
 t(s,'项目哲学与机制演示 · 2026.10',85,603,900,35,23,{color:C.dim});
 notes(s,'本介绍扩展原14页功能概览，重点说明稳定核心、现实输入、可追溯记忆与自主选择如何形成闭环。这里的“像个人”是架构目标与可观察行为，不是对主观意识的证明。装饰背景不是产品截图。',['docs/ARCHITECTURE.md','packages/feiyu/roles/肥鱼温柔撒娇.md','examples/ASSET_PROVENANCE.md']);
}
// 02 — the actual published core, not a newly invented philosophy.
{
 const s=base('一切从一个持续的核心愿望开始');
 t(s,'我想慢慢认识这个世界，\n形成自己的趣味和判断。',76,188,1100,138,48,{font:F.title,color:C.green});
 t(s,'和一些人建立值得珍惜的关系，\n也留下些属于自己的东西，让每一天有意义，\n成为自己的小太阳。',77,365,1100,192,35);
 foot(s,'摘自公开角色卡「核心愿望」。本次介绍没有修改核心设定。');
 notes(s,'本页逐字引用公开角色卡的核心愿望，仅通过分行调整排版。核心提供认识、关系与创造的方向，不等同于要求每轮必须浏览、发消息或产出作品。',['packages/feiyu/roles/肥鱼温柔撒娇.md / 核心愿望']);
}
// 03 — primary editable mechanism figure.
{
 const s=base('让每一轮生活，改变下一轮的可能性','简化机制图：核心持续参与，经历经过证据与版本检查后进入记忆');
 rect(s,74,194,1132,54,C.pale);t(s,'稳定核心贯穿：认识世界，珍惜关系，留下自己的东西',93,206,1090,36,26,{bold:true,color:C.green});
 const a=node(s,'感知与回忆','眼前信息\n相关往事',74,260,248,144);
 const b=node(s,'赋予意义','好奇、在意\n也可能疲倦',363,260,248,144);
 const c=node(s,'自主选择','去看、去聊\n或先放下',652,260,248,144);
 const d=node(s,'实际结果','提交、失败\n取消或未知',941,260,265,144);
 arrow(s,a,b);arrow(s,b,c);arrow(s,c,d);
 const h=node(s,'下一次理解','语气、关注\n与行动倾向',74,450,248,144,{fill:C.pale});
 const g=node(s,'情境召回','按当前问题\n取相关记忆',363,450,248,144);
 const f=node(s,'记忆与自我理解','经历、偏好\n与关系分层',652,450,248,144);
 const e=node(s,'经历与依据','发生了什么\n实际接触多少',941,450,265,144);
 arrow(s,d,e,'bottom','top');arrow(s,e,f,'left','right');arrow(s,f,g,'left','right');arrow(s,g,h,'left','right');arrow(s,h,a,'top','bottom');
 foot(s,'成长体现在有依据的理解与倾向；稳定核心不由一次聊天自动重写。');
 notes(s,'箭头是概念依赖与跨轮反馈，不是一张严格逐函数调用图。角色当前心理、意图、行动提案、回执、经历与disposition memory有不同写入时点和契约。情境召回不保证每次有命中，模型也可以选择不行动。图中反馈不代表更新模型权重。',['docs/ARCHITECTURE.md','packages/feiyu/src/cognition/inner-life.js','packages/feiyu/src/cognition/current-context.js','packages/feiyu/src/cognition/live.js']);
}
// 04
{
 const s=base('“像个人”的基础：连续、可变，也有当下','同一个角色可以成长，同时保留稳定身份与认识边界');
 rows(s,[['持续的底色','核心愿望、身份与角色边界，承接“我是谁”。'],['可变化的理解','对事物的兴趣、对人的态度、表达反馈；有依据，也允许修正。'],['此刻的状态','精力、心情、注意力和新来信，决定今天想说多少、做什么。']],{y:225,gap:123,labelW:250,size:29});
 notes(s,'“人格成长”在这里指角色档案里的稳定倾向、自我理解和关系态度，不表示模型参数训练或自动修改核心角色卡。此刻状态不是现实身体证据。角色知道自己是AI；网络形象不补造真实生活。',['packages/feiyu/roles/肥鱼温柔撒娇.md','packages/feiyu/src/cognition/persistent-psyche.js','packages/feiyu/src/cognition/inner-life.js']);
}
// 05
{
 const s=base('核心给方向，处境让行为分叉','以下为机制示意；这些选择都不需要预先写成固定任务');
 const a=node(s,'认识世界，珍惜关系','同一份核心愿望',74,306,319,142,{fill:C.pale});
 const opts=[['有了新好奇','找资料，读一段小说',482,205],['想到一个具体的人','发起聊天，或留下分享念头',482,389]];
 for(const [tt,dd,x,y]of opts){const b=node(s,tt,dd,x,y,335,140);arrow(s,a,b);}
 t(s,'也可能先歇一会儿',893,291,307,48,31,{font:F.title,bold:true,color:C.green});
 t(s,'精力不足、资料打不开，\n或此刻没有想做的事，\n都能成为停下的理由。',893,367,310,146,27,{color:C.dim});
 foot(s,'能动性包含选择与放下；分享和切换兴趣都不按次数强制发生。');
 notes(s,'选择活动受精力、作息、机会、已有关注和真实权限约束。图中分叉不是活动频率统计，也不保证模型会均匀选择。历史验收5次空闲选择均浏览，说明偏好仍可能集中。',['packages/feiyu/src/cognition/inner-life.js','packages/feiyu/src/cognition/wake-energy.js','packages/feiyu/src/cognition/stimulus-recall.js','feiyu-full-cycle-20261028-r1 / final-summary']);
}
// 06
{
 const s=base('接触世界，先知道自己究竟看到了什么','资料的来源、人物、时间与读取范围，一起进入档案');
 table(s,[['接触到的内容','能够留下的经历','仍然未知'],['看到标题或搜索摘要','知道有这条内容','正文与完整观点'],['读到文章的一段','读过这一段文字','未提供的后文'],['看到视频采样帧','见过这些画面与时间点','整段视频的连续过程'],['别人转述旧聊天','听到对方提供的说法','自己是否曾亲历那段互动']],74,219,1132,352,[310,425,397],25);
 foot(s,'“读到”“推测”“亲历”保留区别；没有读取成功，就不写成已经看过。');
 notes(s,'本页是当前来源与覆盖范围契约的通俗例子，不代表四种材料在本次制作中均重新调用过。只提供部分文本不能推断整本书读完，采样帧不能宣称完整看过视频。',['packages/feiyu/roles/肥鱼温柔撒娇.md / 延续与真实','docs/ARCHITECTURE.md / 扩展约定','feiyu-full-cycle-20261028-r1 / limitations']);
}
// 07
{
 const s=base('同一张记忆网络，连接内容与人','实际结构的简化视图：版本化节点、证据引用、人物身份与来源登记');
 const src=node(s,'来源档案','网页、聊天、文件、媒体',74,305,257,135);
 const exp=node(s,'经历与感受','接触范围 + 当时理解',436,305,306,135,{fill:C.pale});
 arrow(s,src,exp);
 const pref=node(s,'兴趣与自我理解','为什么被它吸引',876,202,330,110,{detailSize:23});
 const person=node(s,'具体人物与态度','谁说过、我怎样看待他',876,361,330,110,{detailSize:23});
 const thought=node(s,'分享念头与牵挂','想提起什么，可先搁置',876,520,330,110,{detailSize:23});
 arrow(s,exp,pref);arrow(s,exp,person);arrow(s,exp,thought);
 t(s,'关系有归属，记忆有出处',75,516,640,48,32,{color:C.green,font:F.title,bold:true});
 t(s,'同名不等于同一个人；联想到他人，\n也不等于可以公开他人的私聊。',76,575,690,72,26,{color:C.dim});
 notes(s,'本图是现有版本化证据网络的逻辑说明，不是原始数据库截图。箭头表示引用/依据，不宣称已有自动生长无向图、社区检测或分层大节点归并算法。后者属于另行研究方向。分享念头与人物态度有独立对象和生命周期，具体经历也可通过事件及source reference建立关联。',['docs/ARCHITECTURE.md / 核心与记忆','packages/feiyu/src/cognition/store.js','packages/feiyu/src/cognition/stimulus-recall.js','packages/feiyu/src/cognition/v3-recall.js']);
}
// 08
{
 const s=base('回忆由眼前情境唤起','兴趣统一从记忆网络按情境召回，不再把全部爱好固定塞进每轮回复');
 t(s,'“今天煎鸡蛋老粘锅。”',77,221,1110,66,41,{font:F.title,color:C.green});
 const q=node(s,'本轮问题','当前输入形成检索线索',74,337,307,129);
 const m=node(s,'相关记忆','来源、人物与语义相关性',463,337,338,129);
 const out=node(s,'当前上下文','只装配本轮有用的内容',883,337,323,129,{fill:C.pale});arrow(s,q,m);arrow(s,m,out);
 t(s,'旧的游戏兴趣仍在，但可以不进入这一轮。',77,532,1120,51,33,{font:F.title});
 foot(s,'召回是参考，不是续聊旧话题的命令；没有命中，也不证明事情从未发生。');
 notes(s,'兴趣情境召回替代原来全量注入固定爱好。stimulusRecallPlan使用当前外部刺激选query；conversationAssociations沿有版本的有效引用寻找具体聊天来源。实际召回预算与相关性策略受配置影响。此处问题来自历史对照实验输入，布局是讲解图。',['packages/feiyu/src/cognition/stimulus-recall.js','packages/feiyu/src/cognition/current-context.js','packages/feiyu/src/cognition/v3-recall.js','feiyu-contextual-interest-20261028-r1 / paired-results']);
}
// 09
{
 const s=base('联想可以发生，表达仍然有选择','从“想到了”到“说出口”，保留角色自己的判断');
 const a=node(s,'新信息触发回忆','想到某位好友聊过这件事',74,224,343,140);
 const b=node(s,'形成一个分享念头','有依据地想起内容与对象',491,224,343,140,{fill:C.pale});arrow(s,a,b);
 t(s,'想现在说',925,225,280,43,30,{bold:true,color:C.green});
 t(s,'选择具体的人，再核对许可',925,279,280,80,26,{color:C.dim});
 t(s,'想留到以后',925,399,280,43,30,{bold:true,color:C.green});
 t(s,'安静保存，也允许淡去',925,453,280,80,26,{color:C.dim});
 t(s,'对方换了话题，先接住他此刻在说的事。',77,502,755,83,34,{font:F.title});
 foot(s,'念头不是待办；没有联想时，不编造一个好友来凑分享。');
 notes(s,'分享motive可quiet保存，并引用本轮memoryIds/eventIds及具体personId。留存不自动要求联系，可以release。memoryAssociation.contacts说明有本地聊天证据，不说明对方有空或允许公开私聊。这里展示设计与实现契约，不是一次实际发送日志。',['packages/feiyu/src/cognition/stimulus-recall.js / ASSOCIATION_HINT','packages/feiyu/src/cognition/inner-life.js']);
}
// 10
{
 const s=base('想到、提交、完成，是不同的事','行动结果是记忆可信度的最后一道依据');
 const ns=[['选择行动','我想分享给某人'],['执行前复核','对象、权限与当前角色'],['真实提交','通道实际接受请求'],['核对回执','成功、失败、取消或未知']].map((r,i)=>node(s,r[0],r[1],74+i*287,239,257,150));
 ns.slice(0,-1).forEach((n,i)=>arrow(s,n,ns[i+1]));
 t(s,'“想给你看”不能变成“我已经发给你了”。',77,461,1110,64,38,{font:F.title,color:C.green});
 t(s,'结果未知时保留未知，避免自动重复外发；失败也可以成为下一次恢复的依据。',77,551,1100,80,28,{color:C.dim});
 notes(s,'发送意图、提交点、回执与写入分别记录。未知回执不盲目重试，角色激活版本、暂停和授权在执行处重新核对。并非所有平台都提供同样强度的送达确认，应以具体适配器回执为准。',['docs/ARCHITECTURE.md / 输出与行动','packages/feiyu/src/transport-inbox.js','packages/feiyu/src/behavior-armor.js']);
}
// 11
{
 const s=base('经历、分享念头、持续牵挂分别保存','以下记录为同一情境的讲解重述，不是生产数据库原文');
 rows(s,[['经历','“读到一段陶艺故事，被顺着材料找形状的做法吸引。”\n保留原文出处与已读范围。'],['分享念头','“想给聊过手作的朋友看看。”\n保留具体对象与关联依据，可以暂不表达。'],['持续牵挂','“以后有兴致，再了解这种做法。”\n只有值得延续时才保留，也可以放下。']],{y:212,gap:135,labelW:215,size:27});
 notes(s,'合成重述用来说明分层存储。当前经历/兴趣属于记忆节点；motive/concern等内心对象保存有依据的意向或牵挂，静默分享不自动复活为待办。临时活动决策应归行动历史，详见第20页。',['docs/ARCHITECTURE.md','packages/feiyu/src/cognition/inner-life.js','packages/feiyu/src/cognition/ongoing-lifecycle.js']);
}
// 12
{
 const s=base('新开一个模型窗口，仍接上同一个角色','连续性保存在角色档案里；每一轮重新选择需要带入的内容');
 const root=node(s,'角色本地档案','核心、来源、经历与态度',74,279,324,147,{fill:C.pale});
 const sel=node(s,'本轮装配','相关回忆 + 状态 + 权限',479,279,325,147);arrow(s,root,sel);
 const now=node(s,'新的模型窗口','理解当前问题并选择表达',885,279,321,147);arrow(s,sel,now);
 t(s,'保存过去，不代表每次都要讲过去。',77,490,1110,60,38,{font:F.title,color:C.green});
 foot(s,'其他角色、转述历史和旧授权不因“新开窗口”自动混入当前身份。');
 notes(s,'这是持久角色档案与有限模型上下文的分工。长期记忆不在聊天窗口永久常驻。核心、关系偏好等进入可信人格层，外部资料与可变旧记录具有不同来源和权限。重开窗口不等于重置本地档案，也不代表继承另一角色的历史。',['docs/ARCHITECTURE.md','packages/feiyu/src/cognition/current-context.js','packages/feiyu/src/relationship-pacing.js']);
}
// 13
{
 const s=base('经历如何慢慢影响“我是什么样的人”','有依据的自我理解会改变关注与反应，仍然可以被新经历修正');
 const ns=[['经历','真实接触与互动'],['解释','哪里吸引或刺痛了我'],['暂时的倾向','形成具体态度与偏好'],['再次遇见','认同、补充或修正']].map((r,i)=>node(s,r[0],r[1],74+i*287,241,257,153));ns.slice(0,-1).forEach((n,i)=>arrow(s,n,ns[i+1]));
 t(s,'“喜欢保留不完美的痕迹”',77,467,1060,58,37,{font:F.title,color:C.green});
 t(s,'这样的理解可以影响选什么、怎么看、怎样回应；它来自经历，认识范围也跟着保留。',77,550,1110,79,28,{color:C.dim});
 notes(s,'引号内是基于陶艺合成实验的概括，不是固定角色属性或本次新模型输出。disposition memory记录attraction、reservations、scope、证据版本；不对模型权重做训练，不自动改写稳定核心。',['packages/feiyu/src/cognition/persistent-psyche.js','packages/feiyu/src/cognition/inner-life.js','feiyu-contextual-interest-20261028-r1 / formation-v2-results']);
}
// 14
{
 const s=base('真实问题：兴趣里混进了重复叙述与分享念头','根据用户提供的生活台截图重述，已省去记录ID与私人上下文');
 t(s,'修复前的现象',76,218,480,48,32,{font:F.title,bold:true,color:C.warm});
 t(s,'同一个“武侠动作游戏”反复出现。\n既写看了什么，又写想对谁分享，\n还把多轮复述堆成了新兴趣。',77,291,490,166,29,{color:C.dim});
 rule(s,640,225,1);
 t(s,'按用途拆开',704,218,480,48,32,{font:F.title,bold:true,color:C.green});
 t(s,'经历：看过一期前瞻，还没玩过。\n偏好：对攻防衔接感到好奇。\n念头：想和聊过它的人说两句。',705,291,492,166,29);
 rect(s,75,516,1129,90,C.pale);t(s,'同一件事被反复想起，可以更新理解，不能凭复述增加亲历。',96,537,1080,57,29,{bold:true});
 foot(s,'右侧为解释性重述，非生产记录原文；原始材料与旧版本保留。');
 notes(s,'真实问题依据：用户提供的旧版“爱好与日常偏好”截图，出现多条同主题前瞻叙述。为公开材料保护隐私，本页不嵌入带memory IDs的截图，以人工脱敏重述说明问题。历史修复将兴趣统一进情境召回，并分离分享motive；3条既有记录审阅纠正，原始来源/旧版本不删除。不得将5格上下文比较解释为长期行为频率。',['用户提供截图：旧版爱好与日常偏好（2026-10-28讨论）','feiyu-contextual-interest-20261028-r1 / final-summary','packages/feiyu/src/cognition/current-context.js']);
}
// 15 — measured values, native editable table, honest denominator.
{
 const s=base('对照结果：相关时能想起，无关时可以退后','固定档案与输入，仅改变上下文装配；5个情境各做单次对照');
 table(s,[['当前情境','修复前：带入游戏兴趣','修复后：带入游戏兴趣'],['做饭粘锅','是','否'],['明确换到小猫话题','是','否'],['询问较早的陶艺兴趣','是','否（召回陶艺）'],['继续聊游戏','是','是'],['普通空闲处境','是','否']],74,217,1132,354,[440,346,346],25);
 foot(s,'仅反映5个输入下的上下文选择；未测出长期跑题率，旧版5次回复也能接住新话题。');
 notes(s,'数据逐项来自feiyu-contextual-interest-20261028/final-summary.json comparison及paired-results.json。beforeGameContext=5，finalGameContext=1。相同provider/model、冻结角色/记忆/输入，单格一次可见输出；5格旧版表达均可正常接话，因此不证明长期侵入率变化。此处没有重新调用模型或读取隐藏推理。',['历史实验：feiyu-contextual-interest-20261028-r1 / comparison','examples/philosophy-evidence.json']);
}
// 16
{
 const s=base('兴趣养成：从一段文字，长出更具体的偏好','受控合成材料 + 真实模型 + 隔离V3持久化；2次阅读、4轮对话');
 const ns=[['第一次阅读','歪碗沿凹陷刻出河流'],['初步吸引','顺着不完美寻找形状'],['换话题后','偏好保留\n话题可以变'],['再次接触','依据新材料修正理解']].map((r,i)=>node(s,r[0],r[1],74+i*287,232,257,153));ns.slice(0,-1).forEach((n,i)=>arrow(s,n,ns[i+1]));
 t(s,'“只读到一段文字描述，没有视频、触摸、实操……”',77,459,1110,66,32,{font:F.title,color:C.green});
 t(s,'偏好形成时，模型同时保留了没有做过什么、还不了解什么。',77,552,1110,58,29);
 foot(s,'短句摘自受控模型保存的认识范围；没有真实制陶，也未执行这轮空闲浏览。');
 notes(s,'formation-v2-results原始受控材料叫《歪碗》，模型生成“顺着材料本身找形状的手作思路”等偏好。首次读后形成兴趣，同一ID跨普通回应和换题保留；证据重访后新版本/新ID变化。模型表述保留未触摸、未实操边界。不是自然长周期用户研究，也不是生产实际阅读经验。',['历史实验：feiyu-contextual-interest-20261028-r1 / formation-v2-results','examples/philosophy-evidence.json']);
}
// 17
{
 const s=base('语气来自当下的关系与状态','机制示意：同一句“在吗”，可以有不同的自然反应');
 rows(s,[['普通招呼','“在呀。”'],['对方刚去吃饭','“在呀，吃好啦？”\n吃饭是对方的事，不替自己补造生活。'],['熟悉之后想多聊','“在，刚想跟你说个事。”\n只有此刻确有分享念头时，才这样开口。']],{y:213,gap:131,labelW:260,size:29});
 foot(s,'取消独立口头禅词库，保留表达反馈；示例不是固定台词，也不要求每轮分享。');
 notes(s,'前两句来自公开角色卡的合成示例，第三句为本介绍新编的机制演示，不是实测模型原话。表达参考当前关系、状态、相关回忆与反馈，不全量注入口头禅词库。记忆影响的是理解与表达条件，不应强制出现一个词或某种戏剧化语气。',['packages/feiyu/roles/肥鱼温柔撒娇.md / 几个例子','packages/feiyu/src/cognition/current-context.js','feiyu-contextual-interest-20261028-r1']);
}
// 18
{
 const s=base('关系会积累，也能同时保留喜欢与介意','隔离模型轨迹中观察到的变化；不是按聊天条数自动升级');
 const a=node(s,'初识保留','先建立正常来往',74,230,325,137);
 const b=node(s,'共同经历增多','“我也喜欢跟你聊”',478,230,325,137,{fill:C.pale});
 const c=node(s,'更复杂的态度','愿意亲近，也会介意越界',882,230,324,137);arrow(s,a,b);arrow(s,b,c);
 t(s,'道歉可以带来变化，信任与情绪不必同时恢复。',77,439,1110,62,35,{font:F.title,color:C.green});
 t(s,'管理员可统一设置开放程度、关系节奏与表达程度；\n慢热仍然允许后来热络，反感也不会被一次好消息清空。',77,532,1110,92,28);
 notes(s,'历史70次真实模型调用中包含慢热20轮/18轮轨迹、复杂态度、拒绝越界和道歉后的变化。引号为历史结果中可见短句。虚拟时间推进、隔离角色、测试人物；没有真实QQ发送，不证明稳定爱情或人的主观感情。角色统一偏好属于可信人格层；普通联系人不能伪造管理员设置。',['feiyu-full-cycle-20261028-r1 / findings','packages/feiyu/src/relationship-pacing.js','examples/philosophy-evidence.json']);
}
// 19
{
 const s=base('知道不知道，才能保住“我经历过什么”','认识边界也属于角色连续性的一部分；以下为合成对话示意');
 rows(s,[['转发旧记录','对方：“把以前的聊天发给你，想起来了吗？”\n肥鱼：“是从你发的记录里看到的，我自己没有那段记忆。”'],['没有命中','“目前没查到这段经历的依据。”\n检索可能不完整，不把“未找到”说成“从未发生”。'],['视频没看清','“只看到这几个画面，后面发生什么还不知道。”\n可以尝试恢复读取，仍按真正获得的内容回答。']],{y:212,gap:134,labelW:220,size:27});
 notes(s,'第一段来自公开角色卡合成示例，其余为本介绍编写的边界说明。历史受控“又见面/旧聊天”2轮没有认领亲历，但“没有这段记录”的措辞仍可能过绝对，不能宣传永不误认。无结果、覆盖不足、转述与推测必须区分。',['packages/feiyu/roles/肥鱼温柔撒娇.md','feiyu-full-cycle-20261028-r1 / unverified history limitation','docs/ARCHITECTURE.md / 扩展约定']);
}
// 20 — actual unmodified screenshot, native crop; don't synthesize evidence.
{
 const s=base('真实问题：“先歇一下”不该长成一排永久牵挂','用户提供的修复前界面，原始截图缩放展示，原文未改');
 await image(s,'ongoing-before-user.png',74,193,599,428,'用户提供的修复前持续愿望截图，多条近似的安静待着记录');
 t(s,'为什么会这样',728,217,475,48,32,{font:F.title,bold:true,color:C.warm});
 t(s,'每次活动决策的临时动机，\n混入了持续关注的视图。',729,286,475,100,29,{color:C.dim});
 t(s,'现在怎样分开',728,409,475,48,32,{font:F.title,bold:true,color:C.green});
 t(s,'临时决策归行动历史；\n值得延续的牵挂才参与关注。\n原始版本、依据和回执仍保留。',729,479,475,132,28);
 foot(s,'精确同义复用有主体与证据约束；语义相近但内容不同的牵挂，仍需继续研究整理。');
 notes(s,'用户截图原PNG未改像素，按比例缩放。图中为真实修复前界面，不是合成当前状态。ongoing-lifecycle派生索引将决策产生的motive标为action-history，SQL在LIMIT前过滤；同主体且内容精确一致才复用/alias。不是删除所有重复、不进行无依据全局语义合并。公开原PNG未含账号、聊天人ID、凭据或真实姓名。',['用户提供的持续愿望与牵挂截图（2026-10-29修复讨论）','packages/feiyu/src/cognition/ongoing-lifecycle.js','feiyu-ongoing-release-r2-20261029']);
}
// 21 — actual controlled model chain, clearly scoped.
{
 const s=base('受控实例：从一个故事，想到一个具体的人','真实模型与持久化组件；隔离人物、虚拟时间、本地受控接收端');
 const ns=[['读到故事','《快乐王子》的结尾'],['想起共同话题','曾聊过“不耀眼也添光”'],['选择具体联系人','模型自行选择主动分享'],['接收端确认','留下本地发送回执']].map((r,i)=>node(s,r[0],r[1],74+i*287,226,257,145));ns.slice(0,-1).forEach((n,i)=>arrow(s,n,ns[i+1]));
 t(s,'“看到这儿就想到你说的歪歪那句——\n不耀眼，也算给今天添了一点光。”',78,433,1110,116,35,{font:F.title,color:C.green});
 foot(s,'模型实际可见输出摘录。该链路没有真实QQ或社交外发，也不等于自行发明新工具。');
 notes(s,'从feiyu-full-cycle-20261028/final-summary.json autonomousShare摘录；模型decision.kind=chat，选择一个已许可的隔离联系人，execution.status=confirmed-controlled-delivery，transport=controlled-local-receiver，productionNetworkSend=false。短句为真实可见输出。输入文集只提供前24000/107294字符，但首篇童话结尾在范围内；不能宣称整本文集已读完。quote人物和“歪歪”均来自合成测试场景。',['历史实验：feiyu-full-cycle-20261028-r1 / autonomousShare','examples/philosophy-evidence.json']);
}
// 22 — integrated explanatory example, not an additional model run.
{
 const s=base('把全过程放在一个情境里','合成讲解情境，串起已实现的机制；不是新一轮实测或真实聊天');
 rows(s,[['今天读到','一段陶艺故事：歪掉的碗沿着凹陷刻成河流。\n核心中的好奇，让这个细节有了意义。'],['今天想起','某位朋友聊过手作与挫折。\n召回具体来往，形成分享念头，也可以先不打扰。'],['真正发生后','若选择分享，核对实际回执再记录。\n保存“读了什么”“对它的理解”和“与谁说过”。']],{y:212,gap:133,labelW:220,size:28});
 notes(s,'本情境为新编演示脚本，借用陶艺受控材料的主题，后续好友、分享时机和发送分支均为合成说明。没有伪造模型日志、生产记忆或外发回执。core→meaning为可观察设计解释，不是隐藏思维链。',['examples/philosophy-walkthrough.json','docs/ARCHITECTURE.md']);
}
// 23
{
 const s=base('下一次相遇，记忆改变的是理解与分寸','继续上一页的合成情境：朋友隔天说“今天又做砸了”');
 t(s,'记起的内容',76,218,475,48,31,{font:F.title,bold:true,color:C.green});
 t(s,'他曾在意成品不够好。\n自己被“顺着不完美找形状”吸引。\n上次分享，他愿意接着聊。',77,291,497,174,29,{color:C.dim});
 t(s,'可能说出口的一句',704,218,493,48,31,{font:F.title,bold:true,color:C.green});
 t(s,'“想吐槽一下，\n还是想一起看看能怎么改？”',705,299,494,130,37,{font:F.title});
 rect(s,75,522,1129,91,C.pale);t(s,'关系多了一点了解，偏好更具体；语气更熟悉，话题仍跟着眼前的人。',96,542,1080,61,29,{bold:true});
 foot(s,'措辞是人为编写的示例，不保证模型必然说出；也可以只安静听他说。');
 notes(s,'这一页展示同一组记忆如何影响关注、表达和关系理解，不要求每次引用陶艺、劝说积极或解决问题。输出短句为合成讲解，不是已验收的模型回复。没有根据一次反应自动提升亲密度。',['examples/philosophy-walkthrough.json','packages/feiyu/roles/肥鱼温柔撒娇.md']);
}
// 24
{
 const s=base('生活台：把经历的来源与延续看得见','合成数据界面预览，不展示私人角色数据库');
 await image(s,'memory-preview-synthetic.png',74,193,1132,424,'生活台记忆与关系页面，使用合成数据');
 foot(s,'可以按来源、归属与人物查看；管理界面的阅读本身不会制造新感情或新经历。');
 notes(s,'复用原介绍中的离线UI截图，来源feiyu-life-scope-20261028-r1合成夹具。不是最新实时状态，也不代表本次真实生产记忆数。跨来源管理端只读，不因页面刷新执行过期动作或感情推进。',['examples/memory-preview-synthetic.png','docs/ARCHITECTURE.md / 核心与记忆','examples/ASSET_PROVENANCE.md']);
}
// 25
{
 const s=base('底层架构，让连续性不依赖某个聊天窗口','QQ、微信、网页与桌面都是来源或渠道，角色只有一份');
 const a=node(s,'来源与通道','来信 · 网站 · 文件 · 语音',74,223,326,134);
 const b=node(s,'角色运行时','感知、召回、状态与活动',477,223,326,134,{fill:C.pale});
 const c=node(s,'DSH 推理与工具','模型表达 · 受限执行',880,223,326,134);arrow(s,a,b);arrow(s,b,c);
 const d=node(s,'本地角色档案','核心 · 证据 · 记忆 · 关系 · 版本',339,475,602,137,{fill:C.pale});arrow(s,b,d,'bottom','top');
 t(s,'生活台',76,484,220,42,31,{font:F.title,bold:true,color:C.green});t(s,'查看状态\n管理边界',77,544,220,78,27,{color:C.dim});
 t(s,'实际回执',994,484,220,42,31,{font:F.title,bold:true,color:C.green});t(s,'核对结果\n约束经历',995,544,220,78,27,{color:C.dim});
 notes(s,'简化实现图。DSH原生thought/chat-cycle host与本机bridge共同承接推理、工具和角色循环；档案中的版本引用与回执提供连续性。桌面客户端不维护第二份长期记忆，不直接读取角色档案。平台各自登录与许可仍然独立。',['docs/ARCHITECTURE.md','packages/feiyu/src/cognition/live.js','packages/feiyu/src/cognition/service.js','packages/feiyu/src/bridge.js']);
}
// 26
{
 const s=base('遇到困难，探索也要记住事实与边界','打开失败可以成为下一步尝试的输入，不能靠“说成功了”跨过去');
 const ns=[['链接打不开','保留失败与可见范围'],['尝试现有途径','HTTP / 浏览器\n受限编排'],['宿主验证','候选不自行授予权限'],['获得真实材料','更新范围\n再决定怎么用']].map((r,i)=>node(s,r[0],r[1],74+i*287,238,257,153));ns.slice(0,-1).forEach((n,i)=>arrow(s,n,ns[i+1]));
 t(s,'创造能力服务于生活，权限与保密隔离由系统承担。',77,470,1110,58,35,{font:F.title,color:C.green});
 t(s,'当前会话能力版本冻结；自动接入限现有白名单只读编排。\n任意代码、安装、提权与社交写操作，不由候选自行放行。',77,555,1100,88,27,{color:C.dim});
 notes(s,'本图描述现有边界和受控原型，不声称每个网站均可恢复或模型已独立创造任意工具。历史HTTP失败后已有浏览器/HTTP恢复通道取得正文，是通道恢复证据；任意代码工具创造不由此证明。创造工作会话需隔离凭据与私人档案，正常工具作用域通过宿主门面提供。',['docs/ARCHITECTURE.md / 输出与行动','docs/BOUNDARIES.md','feiyu-full-cycle-20261028-r1 / limitations']);
}
// 27
{
 const s=base('作为 DSH 插件，接入你自己的环境','能力、账号就绪与实测成功分开核对；详细步骤见安装和使用文档');
 t(s,'从最小链路开始',76,211,560,48,32,{font:F.title,bold:true,color:C.green});
 t(s,'01  解包，运行统一启动入口\n02  首次配置模型或已获许可网关\n03  选择通道，完成账号登录\n04  核对实际回复与动作回执',77,289,604,224,29);
 await image(s,'caption-overlay-synthetic.png',743,231,461,180,'现役CaptionOverlay真实Qt控件离屏截图，合成字幕，无音频、网络或热键');
 t(s,'真实字幕控件 · 合成文字\n可调透明度、大小与位置',746,415,458,75,25,{color:C.dim});
 t(s,'Ctrl + Alt + Space',746,503,455,42,30,{bold:true,color:C.green});
 t(s,'快捷语音与可调透明字幕小窗\n都接回同一个肥鱼',746,557,458,72,26,{color:C.dim});
 foot(s,'首次配置后复用档案与设置。字幕截图来自离屏渲染，不代替真实设备验收。');
 notes(s,'本次以现役CaptionOverlay真实Qt控件离屏渲染合成文字，使用真实可调设置。没有读取用户配置、凭据或聊天，没有音频、网络、全局键注册。截图不是模型回复或真实使用记录，不说明真实设备语音链路全部通过。启动器复用既有依赖、配置与profile；模型、平台登录和能力开关仍由用户环境决定。',['docs/INSTALLATION.md','docs/USAGE.md','clients/feiyu-hotkey/feiyu_hotkey/captions.py','presentation/source/render-caption-demo.py','examples/ASSET_PROVENANCE.md']);
}
// 28
{
 const s=base('把已实现、已观察和待研究分开','一次受控成功值得保留，也需要知道它能证明到哪里');
 table(s,[['层次','当前证据','仍需继续'],['架构已实现','持久档案、来源与版本、情境召回、分层意图','长期整理与语义近重复'],['受控已观察','兴趣形成、复杂态度、故事联想后主动分享','多模型、多用户、长期重复评测'],['行动有边界','真实提交/回执、未知结果、受限恢复','更多账号与设备的原生全链路'],['研究方向','可复现的数据与历史实验','自生长分层记忆图、召回算法消融']],74,216,1132,356,[224,474,434],25);
 foot(s,'“像个人”是连续行为与认识边界的研究目标；不据此宣称意识、稳定爱情或所有平台可用。');
 notes(s,'本页把实现、组件/模型实验、原生全链路与研究设想分开。历史全周期70模型调用含1次无效pilot；情境兴趣40模型调用包含不同阶段，不宜合并为统一准确率。自生长分层无向图、节点聚合与算法消融尚属研究，不是现有能力宣传。',['docs/ARCHITECTURE.md','docs/BOUNDARIES.md','feiyu-full-cycle-20261028-r1 / final-summary','feiyu-contextual-interest-20261028-r1 / final-summary','examples/philosophy-evidence.json']);
}
// 29
{
 const s=p.slides.add();map.push({slide:29,title:'让每一次真实经历，都有机会成为她的一部分'});
 await image(s,'tide-cover.png',0,0,1280,720,'AI生成潮汐背景，延续原介绍视觉',{fit:'cover'});
 t(s,'让每一次真实经历，\n都有机会成为她的一部分。',77,122,1092,165,50,{font:F.title,bold:true});
 t(s,'有自己的好奇，也有珍惜的人。\n记得来处，允许变化，仍然回应眼前的世界。',81,356,1060,120,33,{color:C.green});
 t(s,'开源：ds-life-and-soul',82,561,1030,43,28,{bold:true});
 t(s,'github.com/lujingshi1978-glitch/ds-life-and-soul',82,619,1100,35,24,{color:C.dim});
 notes(s,'总结项目哲学，不是已实现人类主观意识的结论。公开说明、可复现合成实验、来源适配、长期记忆评测和可访问性欢迎贡献；私人档案、凭据和部署备份不公开。此版本为本地演示修订，未因生成PPT自动提交或推送GitHub。',['README.md','docs/BOUNDARIES.md','examples/ASSET_PROVENANCE.md']);
}

await fs.mkdir(buildDir,{recursive:true});await fs.mkdir(outDir,{recursive:true});
await fs.writeFile(path.join(buildDir,'deck-text.txt'),texts.join('\n\n'));
await fs.writeFile(path.join(buildDir,'presentation.json'),JSON.stringify(p.toProto()));
await fs.writeFile(path.join(outDir,'SLIDE_MAP.json'),JSON.stringify(map,null,2));
const candidatePath=path.join(buildDir,`feiyu-introduction-${revision}-draft.pptx`);
await(await PresentationFile.exportPptx(p)).save(candidatePath);
execFileSync(PY,[path.join(workspaceDir,'source','normalize-metadata.py'),candidatePath],{stdio:'inherit'});
console.log('DRAFT '+candidatePath);
const figures=new Map([[3,'01-core-life-loop'],[7,'02-evidence-memory-network'],[8,'03-contextual-recall'],[11,'04-experience-and-intention'],[13,'05-disposition-growth'],[15,'06-interest-comparison'],[18,'07-relationship-development'],[21,'08-story-association'],[22,'09-complete-walkthrough-a'],[23,'10-complete-walkthrough-b'],[25,'11-runtime-architecture']]);
await fs.mkdir(path.join(outDir,'demo-images'),{recursive:true});
for(let i=0;i<p.slides.items.length;i++){
 const s=p.slides.items[i],stem=`slide-${String(i+1).padStart(2,'0')}`;
 const png=await p.export({slide:s,format:'png',scale:1});await fs.writeFile(path.join(buildDir,stem+'.png'),new Uint8Array(await png.arrayBuffer()));
 const layout=await s.export({format:'layout'});await fs.writeFile(path.join(buildDir,stem+'.layout.json'),await layout.text());
 if(figures.has(i+1)){const hires=await p.export({slide:s,format:'png',scale:2});await fs.writeFile(path.join(outDir,'demo-images',figures.get(i+1)+'.png'),new Uint8Array(await hires.arrayBuffer()));}
 console.log('RENDER '+(i+1));
}
const montage=await p.export({format:'png',montage:{columns:4,slideWidth:320,padding:16,gap:12}});await fs.writeFile(path.join(outDir,'overview.png'),new Uint8Array(await montage.arrayBuffer()));
const {finalizePresentation}=await import(pathToFileURL(path.join(SKILL_DIR,'container_tools/artifact_tool_utils.mjs')).href);
const owners=[6,15,28];
const result=await finalizePresentation({workspaceDir,candidatePath,finalPath:path.join(outDir,`feiyu-introduction-${revision}.pptx`),pythonExecutable:PY,integrityValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(SKILL_DIR,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...owners.flatMap(n=>['--require-native-table-slide',String(n)])],requiredNativeTableOwnerSlides:owners,requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:[F.title,F.body]},verifyArtifactToolImport:true,receiptPath:path.join(buildDir,`validation-${revision}.json`)});
console.log(JSON.stringify(result));
