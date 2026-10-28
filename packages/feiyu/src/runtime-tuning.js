const field=(group,key,label,value,min,max,unit,description,extra={})=>({path:group+'.'+key,group,label,type:'number',default:value,recommended:value,min,max,step:Number.isInteger(value)?1:0.01,unit,description,apply:'immediate',...extra});
export const TUNING_GROUPS=[
 {key:'life',label:'生活节奏与精力',description:'机会与身体状态影响选择；调快唤醒不强制她行动。时间采用北京时间。'},
 {key:'memory',label:'记忆检索与注入',description:'控制本轮选用多少资料；不改变原始记录、来源边界和人物归属。'},
 {key:'text',label:'文本与持续内心',description:'调整可用篇幅，不要求写满。缩短配置不会直接删除历史文本。'},
 {key:'budget',label:'每日花费与收尾',description:'按北京时间自然日累计已知模型费用。达到软上限后停止发起新自主活动，当前有界工作收尾，来信仍可回复。'}
];
export const TUNING_FIELDS=[
 field('life','wakeIntervalMs','后台唤醒间隔',60000,5000,3600000,'毫秒','处理后台记忆工人的最短唤醒间隔。'),
 field('life','idleChangedIntervalMs','新机会后的自由思考间隔',300000,10000,86400000,'毫秒','有新信息或机会时，多久可以再考虑自己的下一步。'),
 field('life','idleUnchangedIntervalMs','安静时的自由思考间隔',1800000,60000,86400000,'毫秒','没有新变化时的自由思考间隔。'),
 field('life','foregroundIdleMs','前台安静期',120000,0,3600000,'毫秒','最近交谈后，为前台保留注意力的时间。'),
 field('life','awakeDrainPerHour','活动时每小时精力消耗',0.04,0,2,'满格/小时','1代表一整格精力。'),
 field('life','idleRecoveryPerHour','发呆时每小时精力恢复',0.06,0,2,'满格/小时','不活动时缓慢恢复。'),
 field('life','restRecoveryPerHour','休息时每小时精力恢复',0.08,0,2,'满格/小时','主动休息的恢复速度。'),
 field('life','sleepRecoveryPerHour','睡眠时每小时精力恢复',0.12,0.001,2,'满格/小时','睡眠恢复速度；保留正值防止永远无法恢复。',{step:0.001}),
 field('life','wakeEnergy','精力恢复到多少后醒来',0.25,0.01,1,'满格比例','耗尽后恢复到此阈值才结束精力睡眠。'),
 field('life','actionCostScale','单次行动精力消耗倍率',1,0,10,'倍','同时缩放聊天、网页、视频、学习和工具动作的精力成本。',{step:0.05}),
 field('life','minimumSleepMs','精力睡眠最短时长',0,0,86400000,'毫秒','即使精力已恢复，也至少休息这么久；0沿用达到阈值即醒。'),
 field('life','nightStartHour','夜间休眠开始',0,0,23,'时','北京时间；开始与结束相同代表取消固定夜间窗口。'),
 field('life','nightEndHour','夜间休眠结束',8,0,23,'时','允许跨午夜；管理员交互继续保留原有豁免。'),
 field('memory','recallBudgetChars','普通回忆文本预算',2200,200,30000,'字','本轮普通回忆打包可占用的字数。'),
 field('memory','deepRecallBudgetChars','深入回忆文本预算',6000,500,60000,'字','明确需要深入查忆时的打包预算。'),
 field('memory','associationBudgetChars','联想检索预算',2400,200,30000,'字','从当前情境寻找相关经历时的资料预算。'),
 field('memory','dialogueBudgetChars','聊天联想注入预算',3600,300,40000,'字','检索结果整理后放进聊天上下文的总预算。'),
 field('memory','maxRecallItems','回忆最多候选条目',40,1,200,'条','预算允许范围内最多选用多少候选，不能保证每条都相关。'),
 field('memory','associationMaxItems','聊天联想最多条目',5,1,30,'条','当前聊天允许选用的关联记忆数量。'),
 field('memory','detailChars','单条记忆详情预算',800,100,10000,'字','模型阅读单条记忆细节时的上限。'),
 field('memory','resourceReadChars','单次原文阅读预算',16000,500,60000,'字','查询原始资料时一次可读取的篇幅。'),
 field('memory','recentContextChars','近期经历注入预算',1800,200,12000,'字','近期经历作为背景时的篇幅。'),
 field('memory','portraitContextChars','人物背景注入预算',1800,200,12000,'字','当前人物画像作为背景时的篇幅。'),
 {path:'memory.embeddingProfile',group:'memory',label:'向量记忆适配',type:'select',default:'existing',recommended:'existing',apply:'restart',description:'512维适配保留V3记忆结构，只切换相符的向量模型。不会截断1024维、混用旧索引或自动下载模型。',options:[{value:'existing',label:'沿用当前本地模型'},{value:'bge-small-512',label:'BGE-small中文 · 512维'},{value:'bge-large-1024',label:'BGE-large中文 · 1024维'},{value:'lexical',label:'仅词法与关联图，不使用向量'}]},
 field('text','psycheChars','当前心理摘要预算',1000,200,12000,'字','下一次有效整理采用新上限，保留原始心理历史。'),
 field('text','psycheThreadChars','单条心理线索预算',600,100,4000,'字','一条持续想法或牵挂的篇幅。'),
 field('text','psycheBackgroundChars','心理背景整理篇幅阈值',6000,1000,48000,'字','累计背景感受超过此篇幅后考虑整理；不是普通聊天常驻注入预算，也不会直接删掉旧感受。'),
 field('text','psycheBackgroundThreads','心理背景整理条数阈值',16,4,128,'条','累计背景线索超过此数量后考虑整理；聊天与内部理解选用多少条在下面分别设置。'),
 field('text','psycheContextChars','内部理解的心理背景预算',2400,200,24000,'字','内部整理和理解选用的心理背景篇幅；与聊天注入及整理阈值分别设置。'),
 field('text','psycheContextThreads','内部理解的心理背景条数',8,1,64,'条','内部理解选用的心理背景条数。'),
 field('text','dialoguePsycheChars','聊天中的心理背景预算',600,100,12000,'字','只选与眼前注意力相关的心理背景，增大可能使旧话题更粘滞。'),
 field('text','dialoguePsycheThreads','聊天中的心理背景条数',2,1,32,'条','聊天默认只参考两条相关背景，不把所有牵挂常驻注入。'),
 field('text','liveChatChars','自动注入对话快照预算',4500,1000,30000,'字','当前窗口自动注入的近期原话预算；保留未读水位与部分结果标记，额外查原文使用独立阅读预算。'),
 field('text','memoryGistChars','单条记忆摘要预算',600,100,5000,'字','向模型展示单条记忆摘要时的篇幅。'),
 field('text','thoughtInputChars','内部思考材料预算',48000,2000,80000,'字','内部认知单次可接受的结构化材料总量；超过时明确退回，不截坏JSON或删掉证据。'),
 field('text','thoughtOutputChars','内部思考结果预算',24000,1000,100000,'字','内部认知单次可接受的结构化结果总量。'),
 field('text','modelTimeoutMs','内部思考等待时间',90000,5000,600000,'毫秒','影响新发起的认知调用；不改变已经开始的请求。'),
 field('text','roleInjectChars','角色卡注入预算',6000,1000,20000,'字','角色卡用于对话的篇幅，不修改核心愿望。'),
 field('text','replyChunkChars','单条聊天消息长度',500,50,2000,'字','超过此长度按原有输出流程分段，完整回复仍保留。'),
 field('budget','dailySoftLimitCny','每天模型花费软上限',0,0,100000,'元/天','0表示暂不启用。推荐先用10元观察；未知价格与未上报费用会单独标明。',{step:0.1,recommended:10}),
 field('budget','windDownGraceMs','已开始工作的收尾窗口',120000,0,1800000,'毫秒','达到上限后，已开始的有界工作可继续收尾；不强杀正在返回的回复。')
];
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const invalid=message=>{throw Object.assign(new Error(message),{code:'RUNTIME_TUNING_INVALID',statusCode:400});};
export const readTuningPath=(value,path)=>path.split('.').reduce((o,k)=>o?.[k],value);
export function defaultRuntimeTuning(){const out={};for(const f of TUNING_FIELDS)(out[f.group]??={})[f.path.split('.')[1]]=f.default;return out;}
export function normalizeRuntimeTuning(input={}, {legacyConfig}={}){
 if(!plain(input))invalid('运行参数必须是对象');const out=defaultRuntimeTuning();
 if(legacyConfig){out.text.roleInjectChars=legacyConfig.role?.maxInjectChars??out.text.roleInjectChars;out.text.replyChunkChars=legacyConfig.social?.maxReplyChars??out.text.replyChunkChars;if(legacyConfig.nightRest?.enabled===false)out.life.nightEndHour=out.life.nightStartHour;}
 const known=new Map(TUNING_FIELDS.map(f=>[f.path,f]));
 for(const [g,values] of Object.entries(input)){if(!Object.hasOwn(out,g)||!plain(values))invalid('未知参数分组');for(const [k,value]of Object.entries(values)){const f=known.get(g+'.'+k);if(!f)invalid('未知运行参数');if(f.type==='select'){if(!f.options.some(o=>o.value===value))invalid(f.label+'选项无效');}else if(typeof value!=='number'||!Number.isFinite(value)||value<f.min||value>f.max||(f.step===1&&!Number.isSafeInteger(value)))invalid(f.label+'超出允许范围');out[g][k]=value;}}
 for(const f of TUNING_FIELDS){const v=readTuningPath(out,f.path);if(f.type==='number'&&(typeof v!=='number'||!Number.isFinite(v)||v<f.min||v>f.max))invalid(f.label+'旧配置超出允许范围');}
 return out;
}
export function mergeRuntimeTuning(current,patch){const before=normalizeRuntimeTuning(current);if(!plain(patch))invalid('参数修改必须是对象');const merged={...before};for(const [g,v]of Object.entries(patch)){if(!Object.hasOwn(before,g)||!plain(v))invalid('未知参数分组');merged[g]={...before[g],...v};}return normalizeRuntimeTuning(merged);}
export function tuningFor(source){const seen=new Set();function find(s,depth=0){if(!s||depth>6||seen.has(s))return null;if(typeof s==='function')return find(s(),depth+1);if(typeof s!=='object')return null;seen.add(s);if(s.runtimeTuning!==undefined)return typeof s.runtimeTuning==='function'?s.runtimeTuning():s.runtimeTuning;if(s.life&&s.memory&&s.text&&s.budget)return s;for(const k of ['runtime','r','store','owner','cfg','config']){const value=find(s[k],depth+1);if(value)return value;}return null;}return normalizeRuntimeTuning(find(source)||{});}
const preset=(id,label,description,patch)=>({id,label,description,values:mergeRuntimeTuning(defaultRuntimeTuning(),patch)});
export const TUNING_PRESETS=[
 preset('balanced','日常推荐','保持当前节奏和1000字心理；每天10元开始收尾。',{budget:{dailySoftLimitCny:10}}),
 preset('economy','节省模式','放慢自由思考，精简当轮记忆；每天3元开始收尾。',{life:{wakeIntervalMs:120000,idleChangedIntervalMs:600000,idleUnchangedIntervalMs:3600000},memory:{recallBudgetChars:1600,associationBudgetChars:1600,dialogueBudgetChars:2400,associationMaxItems:3},budget:{dailySoftLimitCny:3}}),
 preset('rich','丰富记忆','更大的记忆与心理篇幅会增加费用；每天20元开始收尾。',{memory:{recallBudgetChars:4500,deepRecallBudgetChars:12000,associationBudgetChars:5000,dialogueBudgetChars:7000,associationMaxItems:8},text:{psycheChars:2000,psycheBackgroundChars:12000},budget:{dailySoftLimitCny:20}})
];
export function runtimeTuningView(values,{revision=0,effective={}}={}){return {ok:true,schemaVersion:1,revision,values:normalizeRuntimeTuning(values),fields:TUNING_FIELDS,groups:TUNING_GROUPS,presets:TUNING_PRESETS,effective};}
