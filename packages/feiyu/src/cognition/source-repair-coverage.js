import {basisSources} from './basis-sources.js';
import {EXTRACTOR_VERSION} from './v3-extraction.js';

// Full provenance is host-owned. Citation slots remain small and model-facing.
export function memorySources(runtime,memory,{includeCache=true}={}){
  const db=runtime.store.db,todo=[{id:memory.id,revision:memory.revision}],seen=new Set(),refs=[];
  while(todo.length){const m=todo.pop(),key=m.id+'@'+m.revision;if(seen.has(key))continue;seen.add(key);
    if(includeCache)refs.push(...db.prepare('SELECT source_id sourceId,source_revision revision FROM memory_source_dependencies WHERE memory_id=? AND memory_revision=?').all(m.id,m.revision));
    refs.push(...db.prepare('SELECT source_id sourceId,source_revision revision FROM memory_evidence WHERE memory_id=? AND memory_revision=?').all(m.id,m.revision));
    todo.push(...db.prepare('SELECT parent_id id,parent_revision revision FROM dependencies WHERE child_id=? AND child_revision=?').all(m.id,m.revision));
  }return basisSources(runtime,refs);
}

export function correctionTargets(runtime,memory){
  const refs=memorySources(runtime,memory),db=runtime.store.db,targets=new Map();
  for(const ref of refs){const head=db.prepare('SELECT * FROM v3_source_heads WHERE source_id=?').get(ref.sourceId);
    if(head&&head.revision>ref.revision&&head.status!=='deleted'&&runtime.store.sourceUsable({sourceId:ref.sourceId,revision:head.revision}))targets.set(ref.sourceId,{sourceId:ref.sourceId,revision:head.revision});
  }return [...targets.values()];
}

export function fullyEncoded(runtime,ref){
  if(!runtime.store.sourceUsable(ref))return false;
  const doc=runtime.archive.get(ref.sourceId,ref.revision),rows=runtime.store.db.prepare("SELECT start AS offset,length,status FROM v3_extract_units WHERE source_id=? AND source_revision=? AND extractor_version=? ORDER BY start,length DESC").all(ref.sourceId,ref.revision,EXTRACTOR_VERSION);
  let end=0;for(const row of rows){if(!['complete','adopted-v2-complete'].includes(row.status))continue;if(row.offset>end)break;end=Math.max(end,row.offset+row.length);}
  return rows.length>0&&end>=doc.text.length;
}

export function settleSourceRepairs(runtime){
  const db=runtime.store.db;
  for(const q of db.prepare("SELECT * FROM v3_repair_queue WHERE kind='memory' AND status='reextract-scheduled'").all()){
    const memory=runtime.store.get(q.target,{includeInactive:true});if(!memory)continue;
    const targets=correctionTargets(runtime,memory);
    if(targets.length&&targets.every(ref=>fullyEncoded(runtime,ref)))db.prepare("UPDATE v3_repair_queue SET status='complete' WHERE kind='memory' AND target=? AND status='reextract-scheduled'").run(q.target);
  }
}
