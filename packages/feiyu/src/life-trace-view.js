import {createLifeMemoryView} from './life-memory-view.js';

// This is an on-demand projection of already persisted evidence. It never
// constructs a cognition runtime, invokes a model, or modifies a lifecycle.
const parse=value=>{try{return JSON.parse(value)||{};}catch{return {};}};
const fail=(code,statusCode=400)=>{throw Object.assign(Error(code),{code,statusCode});};
const clean=(value,max=700)=>typeof value==='string'?value
  .replace(/\b(?:sk-(?:or-v1-|nous-)?[A-Za-z0-9_-]{12,}|Bearer\s+[^\s,;]+)/gi,'[凭据已隐藏]')
  .replace(/\b(?:token|password|passwd|secret|api[_-]?key|cookie|authorization)["']?\s*[:=：]\s*(?:"[^"]*"|'[^']*'|[^\s,，;；]+)/gi,'[凭据已隐藏]')
  .slice(0,max):'';
const int=(value,min,max,fallback)=>{if(value==null||value==='')return fallback;const n=Number(value);if(!Number.isSafeInteger(n)||n<min||n>max)fail('TRACE_LIMIT_INVALID');return n;};
const ref=(type,id,revision)=>({type,id,revision:revision??null});
// Verification may inspect more dependencies than the rendered graph. Never
// expose derived prose unless the complete dependency set fits and passes.
const PROJECTION_DEPENDENCY_LIMIT=4096;
const types=new Set(['action','memory','event','source','inner','mood','psyche','execution','outcome','core','trait']);
const key=r=>r.type+':'+r.id+(r.revision==null?'':'@'+r.revision);
const labels={supports:'支持依据',contradicts:'相反依据',context:'参考背景',stimulus:'触发材料',source:'来源记录',
  motive:'形成动机',from_state:'当时的理解',selected:'行动候选',execution:'执行记录',outcome:'实际反馈',
  deposited:'沉淀的记忆',derived_from:'据此理解',stimulated_by:'受到触动',revises:'修订',supersedes:'替代旧理解',
  responds_to:'回应',before:'时间先后',same_entity:'共同人物',semantic:'语义关联',abstracts:'概括',
  continues:'延续',compresses:'压缩承接',resolves:'解决',basis:'保存的依据',version:'前一版本',value_context:'价值方向参考',causes:'记录标为因果',pursues:'追求',expresses:'承接方向',legacy_trait_basis:'记忆ID引用 · 历史版本未固定'};

export function normalizeTraceFilters(input={}){
  const mode=input.mode||'graph';if(!['graph','index','source'].includes(mode))fail('TRACE_MODE_INVALID');
  const type=input.type||'mood';if(!types.has(type))fail('TRACE_TYPE_INVALID');
  const id=input.id??(type==='mood'?'current':'');
  if(typeof id!=='string'||id.length>240||/[\x00-\x1f\x7f]/.test(id)||mode!=='index'&&!id)fail('TRACE_ID_INVALID');
  if(mode==='source'&&(type!=='source'||input.revision==null||input.revision===''))fail('TRACE_SOURCE_VERSION_REQUIRED');
  if(type==='trait'&&id!=='personality_growth')fail('TRACE_TRAIT_FIELD_DENIED',403);
  return {mode,type,id,revision:int(input.revision,1,100000000,null),
    maxNodes:int(input.maxNodes,8,100,60),maxDepth:int(input.maxDepth,1,6,4),
    limit:int(input.limit,1,40,20),offset:int(input.offset,0,10000000,0),textOffset:int(input.textOffset,0,10000000,0),textChars:int(input.textChars,200,6000,2000)};
}

// Internal host API for controlled experiments. HTTP callers must use
// createLifeTraceView so both console authority and role activation are checked.
export function buildTrace(runtime,input={}){
  const f=normalizeTraceFilters(input),db=runtime?.store?.db,archive=runtime?.archive?.db,cid=runtime?.characterId;
  if(!db||!archive||!cid)fail('TRACE_UNAVAILABLE',503);
  if(db.prepare('SELECT character_id FROM character_manifest WHERE singleton=1').get()?.character_id!==cid||archive.prepare('SELECT character_id FROM owner WHERE id=1').get()?.character_id!==cid)fail('TRACE_CHARACTER_MISMATCH',409);
  const table=name=>!!db.prepare("SELECT 1 FROM sqlite_master WHERE type IN ('table','view') AND name=?").get(name);
  const get=(sql,...args)=>db.prepare(sql).get(...args);
  const all=(sql,...args)=>db.prepare(sql).all(...args);
  const optional=(name,sql,...args)=>table(name)?all(sql,...args):[];
  const blockedSource=new Map();
  function source(id,revision){
    const r=revision==null?get('SELECT source_id,revision,adapter,source_kind,status,privacy_label FROM sources WHERE character_id=? AND source_id=? ORDER BY revision DESC LIMIT 1',cid,id):
      get('SELECT source_id,revision,adapter,source_kind,status,privacy_label FROM sources WHERE character_id=? AND source_id=? AND revision=?',cid,id,revision);
    if(!r)return null;
    const k=id+'@'+r.revision;
    if(blockedSource.has(k))return blockedSource.get(k);
    const d=archive.prepare(`SELECT status,kind,adapter,occurred_at,observed_at,
      json_extract(metadata,'$.scope') scope,json_extract(metadata,'$.platform') platform,
      json_extract(metadata,'$.diagnostic') diagnostic,json_extract(metadata,'$.learningExcluded') excluded,
      json_extract(metadata,'$.historical') historical,json_extract(metadata,'$.role') speaker_role,
      json_extract(metadata,'$.notPrimaryEvidence') derived FROM documents WHERE source_id=? AND revision=?`).get(id,r.revision);
    const excluded=archive.prepare('SELECT 1 FROM learning_exclusions WHERE source_id=? AND revision=?').get(id,r.revision);
    const suppressed=get("SELECT 1 FROM suppression WHERE character_id=? AND target_type='source' AND target_id=?",cid,id);
    const result={...r,...d,blocked:!d||d.status==='deleted'||r.status==='deleted'||!!suppressed||!!excluded||!!d?.diagnostic||!!d?.excluded};
    blockedSource.set(k,result);return result;
  }
  const evidenceSourceBlocked=rows=>rows.some(e=>e.source_id&&(!source(e.source_id,e.source_revision)||source(e.source_id,e.source_revision).blocked));
  if(f.mode==='source'){
    const result={ok:true,mode:'source',sourceId:f.id,revision:f.revision,readOnly:true,newCapture:false,modelCalls:0};
    let count=0;const verified=new Set();
    function eligible(id,revision,trail=new Set()){
      const k=id+'@'+revision;if(trail.has(k)||trail.size>=32||++count>PROJECTION_DEPENDENCY_LIMIT)return false;if(verified.has(k))return true;
      const s=source(id,revision);if(!s||s.blocked)return false;
      const row=archive.prepare('SELECT metadata FROM documents WHERE source_id=? AND revision=?').get(id,revision),meta=parse(row?.metadata),parents=meta.basisSources||[];
      if(!Array.isArray(parents)||parents.length>PROJECTION_DEPENDENCY_LIMIT)return false;
      const next=new Set(trail);next.add(k);
      if(parents.some(p=>typeof p?.sourceId!=='string'||!Number.isSafeInteger(p.revision)||p.revision<1||!eligible(p.sourceId,p.revision,next)))return false;
      verified.add(k);return true;
    }
    if(!eligible(f.id,f.revision))return {...result,available:false,text:'',reason:'来源已撤销、被隔离、未记录或无法完整核验；不展开原文。'};
    const row=archive.prepare('SELECT body FROM documents WHERE source_id=? AND revision=?').get(f.id,f.revision),chars=String(row.body||'').split('');
    const spans=optional('v3_forget_spans','SELECT offset,length FROM v3_forget_spans WHERE source_id=? AND revision=?',f.id,f.revision);
    for(const span of spans)for(let i=Math.max(0,span.offset);i<Math.min(chars.length,span.offset+span.length);i++)chars[i]=' ';
    // Redact the complete stored record before paging so a split credential
    // cannot escape across page boundaries. No remote URL is opened here.
    const masked=chars.join(''),safe=clean(masked,masked.length),end=f.textOffset+f.textChars,s=source(f.id,f.revision);
    return {...result,available:true,text:safe.slice(f.textOffset,end),offset:f.textOffset,nextOffset:end<safe.length?end:null,totalChars:safe.length,redacted:spans.length>0||safe!==masked,
      sourceKind:s.source_kind||s.kind,at:s.occurred_at??s.observed_at,scope:clean(s.scope,180),notice:'保存的原文片段；不自动认定为亲历，未重新访问外部网站。'};
  }
  function memoryBlocked(id,revision){
    const m=get(`SELECT n.status,n.invalidated_at,n.event_root,v.metadata_json FROM memory_nodes n JOIN memory_versions v
      ON v.character_id=n.character_id AND v.memory_id=n.memory_id WHERE n.character_id=? AND n.memory_id=? AND v.revision=coalesce(?,n.current_revision)`,cid,id,revision??null);
    if(!m||m.invalidated_at||['forgotten','redacted'].includes(m.status))return true;
    if(get('SELECT count(*) n FROM memory_evidence WHERE character_id=? AND memory_id=? AND memory_revision=coalesce(?,(SELECT current_revision FROM memory_nodes WHERE character_id=? AND memory_id=?))',cid,id,revision??null,cid,id).n>25)return true;
    const meta=parse(m.metadata_json);
    return !!(meta.diagnostic||meta.learningExcluded||get("SELECT 1 FROM suppression WHERE character_id=? AND ((target_type='memory' AND target_id=?) OR (target_type='event_root' AND target_id=?))",cid,id,m.event_root)||
      evidenceSourceBlocked(all('SELECT source_id,source_revision FROM memory_evidence WHERE character_id=? AND memory_id=? AND memory_revision=coalesce(?,(SELECT current_revision FROM memory_nodes WHERE character_id=? AND memory_id=?)) LIMIT 25',cid,id,revision??null,cid,id)));
  }
  function eventBlocked(id){
    const e=get('SELECT event_root FROM cognitive_events WHERE character_id=? AND event_id=?',cid,id);
    if(get('SELECT count(*) n FROM event_sources WHERE character_id=? AND event_id=?',cid,id).n>25)return true;
    return !e||!!get("SELECT 1 FROM suppression WHERE character_id=? AND target_type='event_root' AND target_id=?",cid,e.event_root)||evidenceSourceBlocked(all('SELECT source_id,source_revision FROM event_sources WHERE character_id=? AND event_id=? LIMIT 25',cid,id));
  }
  // Validate the full recorded derivation before exposing a derived summary.
  // A truncated graph may omit a dependency visually, but may not omit its
  // deletion/withdrawal check. Cyclic or oversized derivations fail closed.
  const visibility=new Map(),visibilityReason=new Map();let checkedDependencies=0;
  function derivedBlocked(type,id,revision,trail=new Set()){
    const k=key(ref(type,id,revision));if(visibility.has(k))return visibility.get(k);
    if(trail.has(k)){visibilityReason.set(k,'dependency-cycle');return true;}
    if(trail.size>=16||++checkedDependencies>256){visibilityReason.set(k,'verification-limit');return true;}
    const next=new Set(trail);next.add(k);
    let dependencyReason=null;
    const finish=(value,reason)=>{visibility.set(k,!!value);if(value)visibilityReason.set(k,reason||dependencyReason||'unverifiable-dependency');return !!value;};
    const childBlocked=(type,id,revision)=>{
      const blocked=type==='source'?(!source(id,revision)||source(id,revision).blocked):
        type==='memory'?memoryBlocked(id,revision):type==='event'?eventBlocked(id):derivedBlocked(type,id,revision,next);
      if(blocked)dependencyReason=visibilityReason.get(key(ref(type,id,revision)))||'restricted-or-unavailable-evidence';
      return blocked;
    };
    if(type==='inner'||type==='action'){
      if(!table('v3_inner_objects'))return finish(true,'missing-record');
      const o=get(`SELECT o.kind,o.status,o.invalidated_at,v.revision,v.body_json FROM v3_inner_objects o JOIN v3_inner_versions v
        ON v.character_id=o.character_id AND v.object_id=o.object_id WHERE o.character_id=? AND o.object_id=? AND v.revision=coalesce(?,o.current_revision)`,cid,id,revision??null);
      if(!o)return finish(true,'missing-record');
      if(o.invalidated_at||['redacted','forgotten'].includes(o.status))return finish(true,'invalidated-or-restricted');
      if(optional('v3_inner_invalidations','SELECT 1 FROM v3_inner_invalidations WHERE object_id=? AND revision=? LIMIT 1',id,o.revision).length)return finish(true,'invalidated-or-restricted');
      if(get('SELECT count(*) n FROM v3_inner_evidence WHERE character_id=? AND object_id=? AND object_revision=?',cid,id,o.revision).n>25)return finish(true,'verification-limit');
      const es=all('SELECT source_id,source_revision,memory_id,memory_revision,event_id FROM v3_inner_evidence WHERE character_id=? AND object_id=? AND object_revision=? LIMIT 25',cid,id,o.revision);
      if(evidenceSourceBlocked(es)||es.some(e=>e.memory_id&&memoryBlocked(e.memory_id,e.memory_revision)||e.event_id&&eventBlocked(e.event_id)))return finish(true,'restricted-or-unavailable-evidence');
      const ds=optional('v3_inner_dependencies',`SELECT parent_inner_id,parent_inner_revision,parent_memory_id,parent_memory_revision,parent_source_id,parent_source_revision,relation,invalidated_at
        FROM v3_inner_dependencies WHERE character_id=? AND child_id=? AND child_revision=? LIMIT 129`,cid,id,o.revision);
      if(ds.length>128)return finish(true,'verification-limit');
      // `continues` is chronological navigation, not an assertion that this
      // summary inherited all prior prose. Each old endpoint is checked when
      // expanded. Actual psychology/source/memory derivations remain mandatory,
      // so a withdrawn historical basis cannot be laundered through this edge.
      if(ds.filter(d=>d.relation!=='continues').some(d=>d.invalidated_at||d.parent_inner_id&&childBlocked('inner',d.parent_inner_id,d.parent_inner_revision)||d.parent_memory_id&&childBlocked('memory',d.parent_memory_id,d.parent_memory_revision)||d.parent_source_id&&childBlocked('source',d.parent_source_id,d.parent_source_revision)))return finish(true);
      if(o.kind==='inner_state'){
        const b=parse(o.body_json),threads=b.psychologyThreads||[],projection=b.psychologyProjection;
        if(!Array.isArray(threads)||threads.length>128||threads.some(t=>childBlocked('psyche',t.id,t.revision))||projection?.revision>0&&childBlocked('mood','current',projection.revision))return finish(true);
      }
      if(o.kind==='motive'){
        const m=get('SELECT from_state_id,from_state_revision FROM v3_inner_motives WHERE character_id=? AND object_id=? AND revision=?',cid,id,o.revision);
        if(!m||childBlocked('inner',m.from_state_id,m.from_state_revision))return finish(true);
      }
      if(o.kind==='action'){
        const a=get('SELECT motive_id,motive_revision FROM v3_action_proposals WHERE character_id=? AND object_id=? AND revision=?',cid,id,o.revision);
        if(!a||childBlocked('inner',a.motive_id,a.motive_revision))return finish(true);
        for(const p of optional('v3_action_provenance','SELECT body_json FROM v3_action_provenance WHERE character_id=? AND action_id=? AND revision=?',cid,id,o.revision)){
          const b=parse(p.body_json),ms=b.recalledMemoryRefs||[],es=b.freshEventIds||b.eventIds||[];
          if(!Array.isArray(ms)||!Array.isArray(es)||ms.length>128||es.length>128||ms.some(m=>memoryBlocked(m.id,m.revision))||es.some(eventBlocked))return finish(true);
        }
      }
      return finish(false);
    }
    if(type==='mood'||type==='psyche'){
      const projection=type==='mood',t=projection?'v3_psyche_projection_versions':'v3_psyche_versions';if(!table(t))return finish(true);
      const p=get(`SELECT revision,status,body FROM ${t} WHERE id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1`,id,revision??null,revision??null);
      if(!p)return finish(true,'missing-record');
      if(p.status==='needs-review')return finish(true,'review-required');
      if(['redacted','invalid','forgotten'].includes(p.status))return finish(true,'invalidated-or-restricted');
      const b=parse(p.body),ss=b.sourceRefs||[],ms=b.memoryRefs||[],os=b.objectRefs||[];
      if([ss,ms,os].some(v=>!Array.isArray(v)||v.length>128)||ss.some(s=>childBlocked('source',s.sourceId,s.revision))||ms.some(m=>memoryBlocked(m.id,m.revision))||os.some(o=>childBlocked('inner',o.id,o.revision)))return finish(true);
      const ds=projection?optional('v3_psyche_projection_dependencies','SELECT kind,target_id,target_revision FROM v3_psyche_projection_dependencies WHERE revision=? LIMIT '+(PROJECTION_DEPENDENCY_LIMIT+1),p.revision):[];
      if(ds.length>PROJECTION_DEPENDENCY_LIMIT)return finish(true,'verification-limit');
      if(ds.some(d=>['source','memory','inner','psyche'].includes(d.kind)&&childBlocked(d.kind,d.target_id,d.target_revision)))return finish(true);
      return finish(false);
    }
    return finish(true);
  }
  const unavailable=(r,label='依据不可用',reason=visibilityReason.get(key(r))||'restricted-or-unverifiable')=>({node:{...r,key:key(r),label,status:'unavailable',text:reason==='review-required'?'此处感受或依据待复核，正文暂不展示；其他独立有效记录仍可核对。':reason==='verification-limit'?'本次核验达到边界，无法安全展示正文；不推断记录不存在。':reason==='dependency-cycle'?'保存的证据依赖形成环路，正文暂不展示。':'原记录已失效、被隔离或无法安全核对；不显示其内容。',unavailable:true,gap:{kind:reason,contentWithheld:true}},links:[]});
  const missing=r=>({node:{...r,key:key(r),label:'这一步未记录',status:'unknown',text:'没有找到可以核对的记录；不推断它从未发生。',unavailable:true,gap:{kind:'missing-record',contentWithheld:true}},links:[]});
  const edge=(to,relation='basis',extra={})=>({to,relation,label:labels[relation]||relation,provenance:'persisted-reference',causal:false,...extra});
  function load(r){
    if(r.type==='source'){
      const s=source(r.id,r.revision);if(!s)return missing(r);r={...r,revision:s.revision};if(s.blocked)return unavailable(r);
      return {node:{...r,key:key(r),label:'来源 · '+clean(s.source_kind||s.kind,60),text:'已保存的来源记录；选中后可按需查看原文片段。',readable:true,status:s.status,
        at:s.occurred_at??s.observed_at,sourceKind:s.source_kind,adapter:s.adapter,scope:clean(s.scope,180),platform:clean(s.platform,60),
        epistemic:s.derived?'派生资料，非独立亲历证据':s.speaker_role==='user'?'对方提供的内容':s.historical?'历史资料':'保留原始来源，不自动认定亲历'},links:[]};
    }
    if(r.type==='memory'){
      const m=get(`SELECT n.memory_id,n.kind,n.current_revision,n.status,n.event_root,n.invalidated_at,n.occurred_at,n.recorded_at,n.epistemic,
        v.revision,v.gist,v.metadata_json FROM memory_nodes n JOIN memory_versions v ON v.character_id=n.character_id AND v.memory_id=n.memory_id
        WHERE n.character_id=? AND n.memory_id=? AND v.revision=coalesce(?,n.current_revision)`,cid,r.id,r.revision);
      if(!m)return missing(r);r={...r,revision:m.revision};
      const suppressed=get("SELECT 1 FROM suppression WHERE character_id=? AND ((target_type='memory' AND target_id=?) OR (target_type='event_root' AND target_id=?))",cid,r.id,m.event_root);
      const es=all('SELECT source_id,source_revision,role FROM memory_evidence WHERE character_id=? AND memory_id=? AND memory_revision=? LIMIT 25',cid,r.id,r.revision),meta=parse(m.metadata_json);
      if(memoryBlocked(r.id,r.revision)||['forgotten','redacted'].includes(m.status)||m.invalidated_at||suppressed||meta.diagnostic||meta.learningExcluded||evidenceSourceBlocked(es))return unavailable(r);
      const links=es.map(e=>edge(ref('source',e.source_id,e.source_revision),e.role||'basis'));
      for(const e of optional('memory_edges','SELECT from_id,to_id,relation,provenance,confidence FROM memory_edges WHERE character_id=? AND (from_id=? OR to_id=?) ORDER BY confidence DESC LIMIT 14',cid,r.id,r.id)){
        const other=e.from_id===r.id?e.to_id:e.from_id;
        links.push(edge(ref('memory',other),e.relation,{provenance:e.provenance,confidence:e.confidence,direction:e.to_id===r.id?'incoming':'outgoing',causal:false}));
      }
      const older=get('SELECT max(revision) revision FROM memory_versions WHERE character_id=? AND memory_id=? AND revision<?',cid,r.id,r.revision);
      if(older?.revision)links.push(edge(ref('memory',r.id,older.revision),'version'));
      for(const e of optional('v3_memory_events',`SELECT DISTINCT m.event_id FROM v3_memory_events m JOIN memory_nodes n ON n.character_id=? AND n.memory_id=m.memory_id
        JOIN cognitive_events e ON e.character_id=n.character_id AND e.event_id=m.event_id WHERE m.memory_id=? AND m.memory_revision=? LIMIT 8`,cid,r.id,r.revision))links.push(edge(ref('event',e.event_id),'deposited',{direction:'incoming'}));
      // Legacy core evidence stores only memory IDs. A matching ID is a saved
      // reference, not a pin to this historical memory revision or proof of growth.
      let traitReferencesPartial=false;
      if(table('v2_core')&&table('v2_core_versions')&&get("SELECT 1 FROM v2_core WHERE field='personality_growth' AND locked=0")){
        const traits=all(`SELECT field,revision FROM v2_core_versions WHERE field='personality_growth'
          AND EXISTS(SELECT 1 FROM json_each(CASE WHEN json_valid(evidence) AND json_type(evidence)='array' THEN evidence ELSE '[]' END)
            WHERE type='text' AND value=?) ORDER BY revision DESC LIMIT 9`,r.id);
        traitReferencesPartial=traits.length>8;
        for(const t of traits.slice(0,8))links.push(edge(ref('trait',t.field,t.revision),'legacy_trait_basis',{
          provenance:'legacy-id-reference',direction:'incoming',historicalMemoryRevisionPinned:false,referenceMemoryId:r.id,
          note:'仅记录了记忆ID；此图中记忆版本不代表倾向形成时使用的历史版本。'}));
      }
      return {node:{...r,key:key(r),label:meta.disposition?.kind==='interest'?'兴趣与自我理解':meta.disposition?.kind==='attitude'?'对人的印象':m.kind==='experience'?'经历与感受':'记忆 · '+m.kind,
        text:clean(m.gist),reason:clean(meta.disposition?.reason,240),status:r.revision===m.current_revision?m.status:'historical-version',at:m.occurred_at??m.recorded_at,
        epistemic:meta.disposition?'主观理解，不是对方的客观属性':m.epistemic,scope:clean(meta.scope,180),
        people:all('SELECT entity_id,role FROM memory_entities WHERE character_id=? AND memory_id=? LIMIT 12',cid,r.id).map(p=>({id:clean(p.entity_id,180),role:p.role})),sourceCount:es.length,
        ...(traitReferencesPartial?{note:'本次最多展开8个倾向存档引用，仍有更早版本未展开。'}:{})},links};
    }
    if(r.type==='event'){
      const e=get('SELECT event_id,kind,event_root,occurred_at,recorded_at,outcome FROM cognitive_events WHERE character_id=? AND event_id=?',cid,r.id);
      if(!e)return missing(r);
      const es=all('SELECT source_id,source_revision FROM event_sources WHERE character_id=? AND event_id=? LIMIT 25',cid,r.id);
      if(eventBlocked(r.id)||get("SELECT 1 FROM suppression WHERE character_id=? AND target_type='event_root' AND target_id=?",cid,e.event_root)||evidenceSourceBlocked(es))return unavailable(r);
      const links=es.map(s=>edge(ref('source',s.source_id,s.source_revision),'source'));
      for(const m of optional('v3_memory_events',`SELECT DISTINCT m.memory_id,m.memory_revision FROM v3_memory_events m JOIN cognitive_events e ON e.character_id=? AND e.event_id=m.event_id
        JOIN memory_nodes n ON n.character_id=e.character_id AND n.memory_id=m.memory_id WHERE m.event_id=? LIMIT 12`,cid,r.id))links.push(edge(ref('memory',m.memory_id,m.memory_revision),'deposited'));
      for(const x of optional('v3_inner_intake','SELECT state_id,state_revision FROM v3_inner_intake WHERE character_id=? AND event_id=? LIMIT 3',cid,r.id))links.push(edge(ref('inner',x.state_id,x.state_revision),'derived_from'));
      return {node:{...r,key:key(r),label:'事件 · '+clean(e.kind,80),text:'发生范围与来源分别核对；事件结果不代表完整理解。',status:e.outcome,at:e.occurred_at??e.recorded_at},links};
    }
    if(r.type==='inner'||r.type==='action'){
      if(!table('v3_inner_objects'))return missing(r);
      const o=get(`SELECT o.kind,o.current_revision,o.status,o.invalidated_at,v.revision,v.body_json,v.interpretation,v.recorded_at
        FROM v3_inner_objects o JOIN v3_inner_versions v ON v.character_id=o.character_id AND v.object_id=o.object_id
        WHERE o.character_id=? AND o.object_id=? AND v.revision=coalesce(?,o.current_revision)`,cid,r.id,r.revision);
      if(!o)return missing(r);r={...r,revision:o.revision};const b=parse(o.body_json);
      if(get('SELECT count(*) n FROM v3_inner_evidence WHERE character_id=? AND object_id=? AND object_revision=?',cid,r.id,r.revision).n>25)return unavailable(r,'依据超出本次核对范围');
      const es=all('SELECT source_id,source_revision,memory_id,memory_revision,event_id,role FROM v3_inner_evidence WHERE character_id=? AND object_id=? AND object_revision=? LIMIT 25',cid,r.id,r.revision);
      if(derivedBlocked(r.type,r.id,r.revision))return unavailable(r);
      const links=es.map(e=>edge(e.source_id?ref('source',e.source_id,e.source_revision):e.memory_id?ref('memory',e.memory_id,e.memory_revision):ref('event',e.event_id),e.role));
      for(const d of optional('v3_inner_dependencies',`SELECT parent_inner_id,parent_inner_revision,parent_memory_id,parent_memory_revision,parent_source_id,parent_source_revision,relation,confidence,invalidated_at FROM v3_inner_dependencies WHERE character_id=? AND child_id=? AND child_revision=? LIMIT 16`,cid,r.id,r.revision)){
        if(d.invalidated_at)continue;links.push(edge(d.parent_inner_id?ref('inner',d.parent_inner_id,d.parent_inner_revision):d.parent_memory_id?ref('memory',d.parent_memory_id,d.parent_memory_revision):ref('source',d.parent_source_id,d.parent_source_revision),d.relation,{confidence:d.confidence,provenance:'persisted-dependency'}));
      }
      // Goal links are host-recorded directions, not factual derivations and
      // never grounds to expand source withdrawal. Both endpoints must belong
      // to this physical role and the pinned object versions must exist.
      for(const g of optional('v3_goal_links',`SELECT l.to_id,l.to_revision,l.relation,t.kind FROM v3_goal_links l
        JOIN v3_inner_objects s ON s.character_id=? AND s.object_id=l.from_id
        JOIN v3_inner_versions sv ON sv.character_id=s.character_id AND sv.object_id=s.object_id AND sv.revision=l.from_revision
        JOIN v3_inner_objects t ON t.character_id=s.character_id AND t.object_id=l.to_id
        JOIN v3_inner_versions tv ON tv.character_id=t.character_id AND tv.object_id=t.object_id AND tv.revision=l.to_revision
        WHERE l.from_id=? AND l.from_revision=? LIMIT 16`,cid,r.id,r.revision)){
        links.push(edge(ref(g.kind==='anchor'?'core':'inner',g.to_id,g.to_revision),['pursues','expresses'].includes(g.relation)?g.relation:'context',{provenance:'host-recorded-goal-reference'}));
      }
      if(o.kind==='wish'){
        const w=get('SELECT anchor_id,anchor_revision FROM v3_inner_wishes WHERE character_id=? AND object_id=? AND revision=?',cid,r.id,r.revision);
        if(w)links.push(edge(ref('core',w.anchor_id,w.anchor_revision),'expresses',{provenance:'host-recorded-wish-anchor-reference'}));
      }
      if(o.kind==='motive'){
        const m=get('SELECT from_state_id,from_state_revision,decision,motive_kind FROM v3_inner_motives WHERE character_id=? AND object_id=? AND revision=?',cid,r.id,r.revision);
        if(m)links.push(edge(ref('inner',m.from_state_id,m.from_state_revision),'from_state'));
      }
      let node={...r,key:key(r),label:({inner_state:'当时的理解',motive:'想做的事',wish:'持续愿望',concern:'牵挂',anchor:'核心与边界',action:'行动选择'})[o.kind]||'内心记录 · '+o.kind,
        text:clean(b.title||b.summary||b.text||b.intent||b.meaning||''),detail:clean(b.meaning||b.reason||'',500),status:r.revision===o.current_revision?o.status:'historical-version',epistemic:o.interpretation,at:o.recorded_at};
      if(o.kind==='inner_state'){
        const s=get('SELECT mental_summary,attention_json,emotional_tensions_json FROM v3_inner_states WHERE character_id=? AND object_id=? AND revision=?',cid,r.id,r.revision);
        if(s)node.text=clean(s.mental_summary);
        if(b.psychologyProjection?.revision>0)links.push(edge(ref('mood','current',b.psychologyProjection.revision),'basis',{provenance:'pinned-psychology-projection'}));
        for(const t of (b.psychologyThreads||[]).slice(0,16))links.push(edge(ref('psyche',t.id,t.revision),'basis',{provenance:'pinned-psychology-thread'}));
      }
      const a=o.kind==='action'?get('SELECT motive_id,motive_revision,action_kind,bounded_intent,status,target_person_id FROM v3_action_proposals WHERE character_id=? AND object_id=? AND revision=?',cid,r.id,r.revision):null;
      if(a){
        node={...node,label:'行动 · '+a.action_kind,text:clean(a.bounded_intent),status:a.status,targetPersonId:clean(a.target_person_id,180)};
        links.push(edge(ref('inner',a.motive_id,a.motive_revision),'motive'));
        for(const e of all('SELECT execution_id FROM v3_action_executions WHERE character_id=? AND action_id=? AND action_revision=? ORDER BY attempt DESC LIMIT 5',cid,r.id,r.revision))links.push(edge(ref('execution',e.execution_id),'execution'));
        for(const p of optional('v3_action_provenance','SELECT body_json FROM v3_action_provenance WHERE character_id=? AND action_id=? AND revision=?',cid,r.id,r.revision)){
          const v=parse(p.body_json);for(const m of (v.recalledMemoryRefs||[]).slice(0,10))links.push(edge(ref('memory',m.id,m.revision),'context',{provenance:'host-recorded-recall'}));
          for(const id of (v.freshEventIds||v.eventIds||[]).slice(0,8))links.push(edge(ref('event',id),'stimulus',{provenance:'host-recorded-intake'}));
        }
      }
      if(o.revision>1)links.push(edge(ref('inner',r.id,o.revision-1),'version'));
      return {node,links};
    }
    if(r.type==='execution'){
      const x=get('SELECT execution_id,action_id,action_revision,status,attempt,started_at,finished_at,receipt_json FROM v3_action_executions WHERE character_id=? AND execution_id=?',cid,r.id);
      if(!x)return missing(r);if(derivedBlocked('action',x.action_id,x.action_revision))return unavailable(r);const stored=parse(x.receipt_json),receipt=stored.receipt&&typeof stored.receipt==='object'?stored.receipt:stored;
      const observation=clean(receipt.status||receipt.state||receipt.error||receipt.reason||'',180);
      const links=[edge(ref('action',x.action_id,x.action_revision),'selected',{direction:'incoming'})];
      for(const o of all('SELECT outcome_id FROM v3_experience_outcomes WHERE character_id=? AND execution_id=? LIMIT 8',cid,r.id))links.push(edge(ref('outcome',o.outcome_id),'outcome'));
      return {node:{...r,key:key(r),label:'实际执行 · '+x.status,status:x.status,at:x.finished_at??x.started_at,text:observation||'已保存执行状态；没有单独的可展示回执摘要。',attempt:x.attempt,
        detail:clean(typeof receipt.text==='string'?receipt.text:'',500),transport:clean(receipt.transport,80),productionNetworkSend:receipt.productionNetworkSend===true,
        executionSucceeded:x.status==='succeeded',note:x.status==='unknown'?'回执未知，不能当作成功，也不应据此盲目重试。':x.status==='succeeded'?'宿主记为执行成功；不等同对方已经阅读、认可或产生感情。':null},links};
    }
    if(r.type==='outcome'){
      const o=get('SELECT execution_id,event_id,outcome_kind,observation_summary,interpretation_summary,observed_at FROM v3_experience_outcomes WHERE character_id=? AND outcome_id=?',cid,r.id);
      if(!o)return missing(r);const execution=get('SELECT action_id,action_revision FROM v3_action_executions WHERE character_id=? AND execution_id=?',cid,o.execution_id);
      if(eventBlocked(o.event_id)||!execution||derivedBlocked('action',execution.action_id,execution.action_revision))return unavailable(r);return {node:{...r,key:key(r),label:'反馈 · '+o.outcome_kind,status:o.outcome_kind,text:clean(o.observation_summary),detail:clean(o.interpretation_summary,300),at:o.observed_at,
        epistemic:'观察与主观解释分开，不能据此认定对方的心理事实'},links:[edge(ref('execution',o.execution_id),'execution',{direction:'incoming'}),edge(ref('event',o.event_id),'outcome')]};
    }
    if(r.type==='mood'||r.type==='psyche'){
      const projection=r.type==='mood',t=projection?'v3_psyche_projection_versions':'v3_psyche_versions';if(!table(t))return missing(r);
      const p=get(`SELECT id,revision,status,body,at FROM ${t} WHERE id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1`,r.id,r.revision,r.revision);
      if(!p)return missing(r);r={...r,revision:p.revision};const b=parse(p.body);
      if(derivedBlocked(r.type,r.id,r.revision))return unavailable(r,'感受依据需要复核');
      if(['redacted','needs-review','invalid','forgotten'].includes(p.status))return unavailable(r,'感受依据需要复核');
      if((b.sourceRefs||[]).length>128||(b.memoryRefs||[]).length>128)return unavailable(r,'感受依据超出本次核对范围');
      if((b.sourceRefs||[]).some(s=>{const v=source(s.sourceId,s.revision);return !v||v.blocked;})||(b.memoryRefs||[]).some(m=>memoryBlocked(m.id,m.revision)))return unavailable(r,'感受依据需要复核');
      const links=[];
      for(const s of (b.sourceRefs||[]).slice(0,16)){const v=source(s.sourceId,s.revision);if(!v||v.blocked)return unavailable(r,'感受依据需要复核');links.push(edge(ref('source',s.sourceId,s.revision),'basis'));}
      for(const m of (b.memoryRefs||[]).slice(0,16)){if(memoryBlocked(m.id,m.revision))return unavailable(r,'感受依据需要复核');links.push(edge(ref('memory',m.id,m.revision),'basis'));}
      for(const o of (b.objectRefs||[]).slice(0,12))links.push(edge(ref('inner',o.id,o.revision),'basis'));
      if(projection){const dependencies=optional('v3_psyche_projection_dependencies','SELECT kind,target_id,target_revision FROM v3_psyche_projection_dependencies WHERE revision=? LIMIT '+(PROJECTION_DEPENDENCY_LIMIT+1),p.revision);
        if(dependencies.length>PROJECTION_DEPENDENCY_LIMIT||dependencies.some(d=>d.kind==='source'&&(!source(d.target_id,d.target_revision)||source(d.target_id,d.target_revision).blocked)||d.kind==='memory'&&memoryBlocked(d.target_id,d.target_revision)))return unavailable(r,'感受依据需要复核');
        for(const d of dependencies.slice(0,30)){
        const type={source:'source',memory:'memory',inner:'inner',psyche:'psyche'}[d.kind];if(type)links.push(edge(ref(type,d.target_id,d.target_revision),'basis'));
      }}
      if(p.revision>1)links.push(edge(ref(r.type,r.id,p.revision-1),'version'));
      return {node:{...r,key:key(r),label:projection?'此刻保存的心情':'背景感受',text:clean(b.text||b.summary),detail:clean(b.reason,240),status:p.status,at:b.feltAt??p.at,
        epistemic:'角色的可见感受摘要，不是隐藏推理或生理测量'},links};
    }
    if(r.type==='trait'){
      if(r.id!=='personality_growth')return unavailable(r);
      if(!table('v2_core')||!table('v2_core_versions'))return missing(r);
      const current=get('SELECT field,revision,locked,body,evidence FROM v2_core WHERE field=?',r.id);
      if(!current)return missing(r);if(current.locked)return unavailable(r,'锁定字段不通过倾向视图展开');
      const v=get('SELECT field,revision,body,evidence,at FROM v2_core_versions WHERE field=? AND revision=coalesce(?,?)',r.id,r.revision,current.revision);
      if(!v)return missing(r);r={...r,revision:v.revision};
      if(v.revision===current.revision&&(v.body!==current.body||JSON.stringify(parse(v.evidence))!==JSON.stringify(parse(current.evidence))))return unavailable(r,'当前倾向与存档版本不一致');
      let ids;try{ids=JSON.parse(v.evidence);}catch{return unavailable(r,'倾向依据需要复核');}
      if(!Array.isArray(ids)||ids.length>25||ids.some(id=>typeof id!=='string'||!id||id.length>240))return unavailable(r,'倾向依据超出本次核对范围或格式不可用');
      ids=[...new Set(ids)];
      // With no historical version pins, a corrected current memory cannot
      // certify that old derived prose no longer contains a withdrawn source.
      // Check all bounded archived versions conservatively; missing/oversized
      // provenance stays unknown instead of revealing an unverifiable summary.
      let inspected=0;const links=[];
      for(const id of ids){
        const m=get('SELECT current_revision,status FROM memory_nodes WHERE character_id=? AND memory_id=?',cid,id);
        const versions=all('SELECT revision FROM memory_versions WHERE character_id=? AND memory_id=? ORDER BY revision LIMIT 26',cid,id);
        if(!m||!['active','faded','outdated','contested'].includes(m.status)||!versions.length||versions.length>25||!versions.some(x=>x.revision===m.current_revision)||(inspected+=versions.length)>128||versions.some(x=>memoryBlocked(id,x.revision)))return unavailable(r,'倾向依据已失效或历史来源无法完整核对');
        for(const x of versions){
          if(table('v3_source_effects')&&get(`SELECT 1 FROM memory_evidence e JOIN v3_source_effects s
            ON s.source_id=e.source_id AND s.revision=e.source_revision WHERE e.character_id=? AND e.memory_id=?
            AND e.memory_revision=? AND s.status<>'available' LIMIT 1`,cid,id,x.revision))return unavailable(r,'倾向引用的来源已失效或待复核');
          const dependencies=optional('memory_source_dependencies','SELECT source_id,source_revision FROM memory_source_dependencies WHERE character_id=? AND memory_id=? AND memory_revision=? LIMIT 26',cid,id,x.revision);
          if(dependencies.length>25||evidenceSourceBlocked(dependencies)||dependencies.some(d=>table('v3_source_effects')&&get("SELECT 1 FROM v3_source_effects WHERE source_id=? AND revision=? AND status<>'available'",d.source_id,d.source_revision)))return unavailable(r,'倾向引用的派生来源无法完整核对');
        }
        links.push(edge(ref('memory',id),'legacy_trait_basis',{
          provenance:'legacy-id-reference',historicalMemoryRevisionPinned:false,referenceMemoryId:id,
          note:'历史记录未固定记忆版本；展开的是当前可用记忆，仅供核对。'}));
      }
      const older=get('SELECT max(revision) revision FROM v2_core_versions WHERE field=? AND revision<?',r.id,r.revision);
      if(older?.revision)links.push(edge(ref('trait',r.id,older.revision),'version',{provenance:'persisted-field-version',note:'版本先后不等同已通过成长审查。'}));
      const initial=v.revision===1,hasEvidence=ids.length>0;
      return {node:{...r,key:key(r),label:'稳定倾向存档版本',text:clean(v.body,900),
        status:initial?'initial-setting':r.revision===current.revision?'current-version':'historical-version',at:v.at,
        formation:initial?'initial-setting':hasEvidence?'recorded-reference-change':'unattributed-revision',growthReview:'unknown',
        sourceCount:ids.length,historicalMemoryRevisionPinned:false,
        detail:initial?'这是初始可变设定，尚无经历形成的版本记录。':hasEvidence?'这一版本保存了记忆ID引用；没有固定历史记忆版本，形成与审查步骤仍须逐项核对。':'这一版本没有保存记忆依据；形成过程未知。',
        epistemic:'保存的倾向文本；版本变化也可能来自管理或遗忘，不能单凭版本认定成长成功。',
        note:hasEvidence?'历史记忆版本未固定。连线只表示ID引用，当前可用记忆仅供对照。':'没有可核对的记忆依据；不补造成长过程。'},links};
    }
    if(r.type==='core'){
      const a=get('SELECT text,locked,authority,revision FROM v3_inner_anchors WHERE character_id=? AND object_id=? AND (? IS NULL OR revision=?) ORDER BY revision DESC LIMIT 1',cid,r.id,r.revision,r.revision);
      if(!a)return missing(r);r={...r,revision:a.revision};
      return {node:{...r,key:key(r),label:'核心价值方向',text:clean(a.text,900),status:a.locked?'locked':'active',epistemic:'管理员确认的方向；不等同某次选择的实证因果'},links:[]};
    }
    return missing(r);
  }
  if(f.mode==='index'){
    const list=table('v3_action_proposals')?all(`SELECT a.object_id id,a.revision,a.action_kind,a.bounded_intent,a.status,v.recorded_at
      FROM v3_action_proposals a JOIN v3_inner_versions v ON v.character_id=a.character_id AND v.object_id=a.object_id AND v.revision=a.revision
      JOIN v3_inner_objects o ON o.character_id=a.character_id AND o.object_id=a.object_id AND o.current_revision=a.revision
      WHERE a.character_id=? AND o.invalidated_at IS NULL AND o.status<>'redacted' ORDER BY v.recorded_at DESC,a.object_id LIMIT ? OFFSET ?`,cid,f.limit+1,f.offset):[];
    const total=table('v3_action_proposals')?get('SELECT count(*) n FROM v3_action_proposals a JOIN v3_inner_objects o ON o.character_id=a.character_id AND o.object_id=a.object_id AND o.current_revision=a.revision WHERE a.character_id=? AND o.invalidated_at IS NULL AND o.status<>?',cid,'redacted').n:0;
    const items=list.slice(0,f.limit).map(a=>load(ref('action',a.id,a.revision)).node).filter(n=>!n.unavailable);
    return {ok:true,mode:'index',items,total,totalKind:'host-current-candidates-before-visibility-filter',visibleCount:items.length,offset:f.offset,nextOffset:list.length>f.limit?f.offset+f.limit:null,readOnly:true,newCapture:false,modelCalls:0};
  }
  const nodes=new Map(),edges=[],visited=new Set(),queue=[{r:ref(f.type,f.id,f.revision),depth:0}],budget={truncated:false,missingSteps:0};let focusKey=null;
  while(queue.length&&nodes.size<f.maxNodes){
    const {r,depth}=queue.shift(),requestKey=key(r);if(visited.has(requestKey))continue;visited.add(requestKey);
    const item=load(r),node=item.node,old=nodes.get(node.key);if(!focusKey)focusKey=node.key;if(!old)nodes.set(node.key,node);
    if(node.unavailable){budget.missingSteps++;continue;}
    if(depth>=f.maxDepth){if(item.links.length)budget.truncated=true;continue;}
    for(const e of item.links){
      if(!types.has(e.to.type)||!e.to.id)continue;
      edges.push({from:node.key,toRef:e.to,relation:e.relation,label:e.label,provenance:e.provenance,causal:false,...(e.confidence==null?{}:{confidence:e.confidence}),direction:e.direction||'outgoing',
        ...(e.historicalMemoryRevisionPinned===false?{historicalMemoryRevisionPinned:false,referenceMemoryId:e.referenceMemoryId}:{}),...(e.note?{note:e.note}:{})});
      queue.push({r:e.to,depth:depth+1});
    }
  }
  if(queue.length)budget.truncated=true;
  const resolved=new Map();for(const n of nodes.values()){resolved.set(key(ref(n.type,n.id,n.revision)),n.key);if(!resolved.has(key(ref(n.type,n.id))))resolved.set(key(ref(n.type,n.id)),n.key);}
  const uniqueEdges=new Map();for(const e of edges){const target=resolved.get(key(e.toRef));if(!target||target===e.from)continue;const value={...e,to:target};delete value.toRef;uniqueEdges.set([value.from,value.to,value.relation].join('|'),value);}
  // The current core is contextual, not proof that a historical choice used it.
  if(table('v3_inner_anchors')&&nodes.size<f.maxNodes){
    const anchor=get("SELECT object_id,revision FROM v3_inner_anchors WHERE character_id=? AND anchor_kind='core_wish' ORDER BY revision DESC LIMIT 1",cid);
    if(anchor){const node=load(ref('core',anchor.object_id,anchor.revision)).node;nodes.set(node.key,node);uniqueEdges.set('core-context',{from:node.key,to:focusKey,relation:'value_context',label:labels.value_context,provenance:'current-host-context',causal:false});}
  }
  const gapKinds={};for(const n of nodes.values())if(n.gap)gapKinds[n.gap.kind]=(gapKinds[n.gap.kind]||0)+1;
  return {ok:true,mode:'graph',focus:focusKey,nodes:[...nodes.values()],edges:[...uniqueEdges.values()],partial:budget.missingSteps>0||budget.truncated,gapKinds,limits:{maxNodes:f.maxNodes,maxDepth:f.maxDepth,...budget},
    notices:['这是既有记录的来源与关联图，不是模型隐藏思维链。','连线表示保存的引用或关系；即使记录标为因果，也不等同已验证的心理因果。','追求/承接方向是宿主保存的愿望与核心版本引用，不证明某次选择的真实心理因果。','版本延续只表示时间上的承接，不证明全文继承；来源撤销以宿主失效记录和直接依据核对。','倾向存档只记录记忆ID，未固定历史记忆版本；当前可用记录只供核对，版本变化不等同成长成功。','没有记录的步骤保持未知；时间相近或同时出现不会自动连成因果。'],
    readOnly:true,newCapture:false,modelCalls:0};
}

export function createLifeTraceView(options){
  const authorization=createLifeMemoryView(options);
  return Object.freeze({read(request={}){
    const before=authorization.assertContext(request),result=buildTrace(options.runtime,request.filters),after=authorization.assertContext(request);
    if(JSON.stringify(before)!==JSON.stringify(after))fail('TRACE_VIEW_CHANGED',409);
    return {...result,profile:{id:options.profile.id,name:options.profile.name},binding:after};
  }});
}
