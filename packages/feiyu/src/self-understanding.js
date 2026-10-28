// Read-only self knowledge. These views describe facts; they never grant an
// execution capability, probe a provider, or turn a past receipt into authority.
import {SOCIAL_CAPABILITIES} from './social-platforms.js';
const ACTIVITIES = ['chat', 'browse', 'learn', 'rest', 'do_nothing'];
const PLATFORM_IDS = new Set(Object.keys(SOCIAL_CAPABILITIES));
const receiptStatuses = new Set(['confirmed','unknown','cancelled','failed','running']);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const label = value => typeof value === 'string' && /^[\w.:-]{1,100}$/.test(value) ? value : null;
const modelLabel = value => typeof value === 'string' && value.length <= 256 && /^[\w.-]+(?:\/[\w.-]+)?(?:@[\w.:-]+)?(?::[\w.:-]+)?$/.test(value) && !value.split(/[\/@:]/).some(part=>part==='.'||part==='..') ? value : null;
const timestamp = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const operations = value => Array.isArray(value) ? [...new Set(value.filter(x => typeof x === 'string' && /^[a-z-]{1,30}$/.test(x)))].slice(0,12) : [];

export function readSelfArchitecture(runtime) {
  const enabled = !!runtime && !runtime.closed && !runtime.closing && !runtime.store?.closed;
  const embedding = enabled ? runtime.retriever?.embedding : null;
  const views = enabled ? runtime.views?.status() : null;
  const archive = enabled ? runtime.archiveVectors?.status() : null;
  return {
    version: 1,
    implementation: enabled ? runtime.inner ? 'feiyu-cognition-v3' : 'feiyu-cognition-v2' : 'disabled',
    layers: {
      core: '角色核心与锁定边界；有证据和版本约束的成长不改模型权重。',
      inner: '同角色延续的当前内心、心理背景与关系兴趣；投影待核时不伪造正文。',
      evidence: '角色隔离的 SQLite 原文档案、加工记忆与有出处的类型关联；不保存隐藏思维链。',
      model: 'DSH 临时模型窗口负责理解与表达；窗口、模型和本地延续状态是不同层。',
      execution: 'QQ、微信、桌宠和网页适配器执行；身体状态和权限限制执行，实际结果以回执为准。'
    },
    memory: {
      storage: enabled ? 'role-local-sqlite' : null,
      lexical: enabled,
      embedding: {
        configured: !!embedding,
        model: modelLabel(embedding?.modelId),
        dimensions: count(embedding?.dimensions),
        locality: embedding ? embedding.remote === true ? 'external' : embedding.remote === false ? 'local' : 'unknown' : null,
        serviceReadiness: 'not-probed',
        memoryCoverage: views?.enabled ? {covered:count(views.covered),total:count(views.parents),chunks:count(views.chunks)} : null,
        archiveCoverage: archive?.enabled ? {covered:count(archive.covered),chunks:count(archive.chunks)} : null,
        coverageMeaning: '仅当前模型、当前版本的已索引内容；旧缓存或未索引历史不代表已覆盖。'
      },
      graph: {implemented:enabled,kind:'evidence-linked-typed-relations',completeWorldKnowledge:false}
    },
    limits: '这些是程序结构与状态机制，不证明生物身体、生命或意识；工作目录约束不等于操作系统沙箱。'
  };
}

function blockedReasons(state) {
  const reasons=[];
  if(state.roleChanging)reasons.push('role-changing');
  if(state.paused)reasons.push('paused');
  if(state.sleeping)reasons.push('resting');
  if(state.dshReady !== true)reasons.push('dsh-not-ready');
  if(state.activeMode === false)reasons.push('mode-inactive');
  if(state.scoped === true && state.sessionAllowed !== true)reasons.push('session-not-authorized');
  return reasons;
}

function eligibility(reasons, next='can-attempt') {
  return {state:reasons.length?'blocked':next,reasons};
}

export function buildCurrentCapabilities(facts={}) {
  const state=facts.execution||{},settings=facts.settings||{},services=facts.services||{};
  const blocked=blockedReasons(state), scoped=state.scoped===true;
  const delegation=[];
  if(!scoped||state.administrator!==true)delegation.push('administrator-session-required');
  if(state.currentRequest!==true)delegation.push('current-authenticated-request-required');
  const receipts=new Map();
  for(const row of (Array.isArray(facts.receipts)?facts.receipts:[]).slice(0,30)){
    if(!PLATFORM_IDS.has(row?.platform)||!receiptStatuses.has(row.status)||receipts.has(row.platform))continue;
    receipts.set(row.platform,{status:row.status,action:label(row.action),at:timestamp(row.at??row.created_at),historical:true});
  }
  const platforms=(Array.isArray(facts.platforms)?facts.platforms:[]).filter(p=>PLATFORM_IDS.has(p?.id)).slice(0,PLATFORM_IDS.size).map(p=>{
    const read=operations(p.read),write=operations(p.write),reasons=[...blocked];
    if(p.installed!==true)reasons.push('adapter-not-installed');
    if(p.enabled!==true)reasons.push('platform-disabled');
    const writeReasons=[...reasons];if(p.writesEnabled!==true)writeReasons.push('writes-disabled');
    if(scoped)writeReasons.push(...delegation);
    const login=['ready','login-required','extension-required','unchecked','unavailable','error'].includes(p.login)?p.login:'unchecked';
    if(login==='login-required')writeReasons.push('login-required');
    else if(login==='extension-required')writeReasons.push('browser-extension-required');
    else if(login==='unavailable'||login==='error')writeReasons.push('cached-login-unavailable');
    return {
      id:p.id,registered:{adapter:true,read,write},installed:p.installed===true,configured:{enabled:p.enabled===true,writesEnabled:p.writesEnabled===true},
      current:{read:eligibility(reasons),write:eligibility(writeReasons,scoped?'requires-current-delegation-check':'requires-current-inner-choice')},
      evidence:{login,checkedAt:timestamp(p.checkedAt),lastWrite:receipts.get(p.id)||null}
    };
  });
  const qqReasons=[...blocked];
  if(services.qq!==true)qqReasons.push('adapter-unavailable');
  if(state.qqConnected!==true)qqReasons.push('qq-not-connected');
  if(scoped&&state.sessionAllowed!==true)qqReasons.push('session-not-authorized');
  const voice=facts.voice||{},voiceReasons=[...qqReasons];
  if(services.voice!==true)voiceReasons.push('voice-adapter-unavailable');
  if(voice.enabled!==true)voiceReasons.push('synthesis-not-configured-for-scope');
  const delegated=(enabled,adapter)=>({registered:adapter===true,configured:enabled===true,current:eligibility([...blocked,...delegation,...(adapter===true?[]:['adapter-unavailable']),...(enabled===true?[]:['disabled'])],'requires-current-delegation-check')});
  const autonomyChatReasons=[...qqReasons,...(settings.autonomyChatEnabled===false?['proactive-disabled']:[])];
  const autonomyBrowseReasons=[...blocked,...(settings.autonomyBrowseEnabled===false?['internet-disabled']:[])];
  const autonomyEntries=(Array.isArray(facts.autonomyPlatforms)?facts.autonomyPlatforms:platforms.map(p=>({id:p.id,installed:p.installed,enabled:p.configured.enabled,read:p.registered.read,write:p.registered.write,writesEnabled:p.configured.writesEnabled,login:p.evidence.login}))).filter(p=>(PLATFORM_IDS.has(p?.id)||p?.id==='qzone'||p?.id==='web')&&p.installed===true&&p.enabled===true&&p.available!==false&&(operations(p.read).includes('feed')||p.id==='web'&&operations(p.read).includes('search'))).slice(0,16).map(p=>({id:p.id,read:operations(p.read),write:operations(p.write),writesEnabled:p.writesEnabled===true,login:['ready','unchecked','login-required','unavailable'].includes(p.login)?p.login:'unchecked'}));
  const autonomyPlatforms=autonomyBrowseReasons.length?[]:autonomyEntries.map(p=>p.id);
  const autonomy={chat:eligibility(autonomyChatReasons,'requires-target-check'),browse:eligibility(autonomyBrowseReasons.length?autonomyBrowseReasons:autonomyPlatforms.length?[]:['no-installed-feed-platform'],'requires-current-inner-choice'),browsePlatforms:autonomyPlatforms,platforms:autonomyEntries,activities:[...(autonomyChatReasons.length?[]:['chat']),...(autonomyPlatforms.length?['browse']:[]),...(!blocked.length?['learn']:[]),'rest','do_nothing']};
  return {
    version:1,observedAt:timestamp(facts.at),
    binding:{profileId:label(facts.binding?.profileId),activationEpoch:count(facts.binding?.activationEpoch),sessionEpoch:count(facts.binding?.sessionEpoch)},
    activities:[...ACTIVITIES],autonomy,reading:facts.reading||null,
    browsePlatforms:autonomyEntries.map(p=>p.id),
    registration:{adapters:'host-observed',dshToolSchema:'not-observed-use-current-tool-schema'},
    execution:{dshReady:state.dshReady===true,paused:state.paused===true,sleeping:state.sleeping===true,roleChanging:state.roleChanging===true,requiresExecutionRecheck:true},
    qq:{registered:services.qq===true,current:eligibility(qqReasons,scoped?'can-attempt':'requires-target-check')},
    voice:{registered:services.voice===true,configured:voice.enabled===true,provider:label(voice.provider),voice:label(voice.voice),current:eligibility(voiceReasons,scoped?'can-attempt':'requires-target-check')},
    delegated:{work:delegated(settings.complexTasks,services.work),creation:delegated(settings.creationEnabled,services.creation),wechatDesktop:delegated(settings.wechatDesktop,services.wechatDesktop)},
    platforms,
    lastCallHealth:(Array.isArray(facts.health)?facts.health:[]).slice(0,24).map(row=>({id:label(row.id),lastCall:row.status==='ready'?'succeeded':row.status==='degraded'?'failed-or-unconfirmed':'unchecked',lastSucceededAt:timestamp(row.last_ok),lastFailedAt:timestamp(row.last_failed)})).filter(row=>row.id),
    interpretation:'开关、适配器、缓存登录和过去调用均不授予权限或证明本次成功；dryRun/preflight 未发送，unknown 不重试；confirmed 也不证明已读或感受。'
  };
}

// The forebrain already receives the role core and real events. Selection needs
// present conditions, not another static architecture or past health/receipts.
export function actionCapabilityView(capabilities) {
  return {
    version:1,view:'action-choice',activities:capabilities.autonomy?.activities||capabilities.activities,browsePlatforms:capabilities.autonomy?.browsePlatforms||capabilities.browsePlatforms,autonomy:capabilities.autonomy,
    execution:capabilities.execution,reading:readingActionView(capabilities.reading),
    platforms:capabilities.platforms.map(p=>({id:p.id,installed:p.installed,enabled:p.configured.enabled,writesEnabled:p.configured.writesEnabled,login:p.evidence.login,loginCheckedAt:p.evidence.checkedAt,read:p.current.read.state,write:p.current.write.state,...(p.current.write.reasons.length?{blockedBy:p.current.write.reasons}:{})})),
    note:'可选范围与当前条件，不是行动指令或执行授权；缓存登录仍需执行时核对。'
  };
}

function readingActionView(reading){
 if(!reading)return null;
 return {enabled:reading.enabled,disabledReason:reading.disabledReason,revision:reading.revision,adapters:reading.adapters,adaptation:reading.adaptation,progressMeaning:reading.progressMeaning,
 recipes:(reading.recipes||[]).slice(-4),recent:(reading.recent||[]).slice(-4).map(r=>({id:r.id,adapter:r.adapter,state:r.state,available:r.available,httpStatus:r.httpStatus,...(r.url?.length<=700?{url:r.url}:{urlOmitted:true}),providedRange:r.providedRange||null,consumedPosition:null,comprehension:'unverified'}))};
}

export function createSelfUnderstandingGetter({runtime=null,profileId=null,readFacts=()=>({})}={}) {
  return (key,{view='full'}={}) => {
    const closed=runtime&&(runtime.closed||runtime.closing||runtime.store?.closed);
    let facts=closed?{binding:{profileId},execution:{roleChanging:true}}:readFacts(typeof key==='string'?key.replace(/^qq:(\d+)$/,'private:$1'):undefined,{details:view!=='action'});
    const stale=profileId!==null&&facts.binding?.profileId!==profileId;
    if(stale)facts={...facts,binding:{profileId},services:{},voice:{},health:[],receipts:[],execution:{...facts.execution,roleChanging:true,currentRequest:false}};
    const capabilities=buildCurrentCapabilities(facts);
    if(view==='action')return {currentCapabilities:actionCapabilityView(capabilities)};
    return {selfArchitecture:readSelfArchitecture(stale?null:runtime),currentCapabilities:capabilities};
  };
}
