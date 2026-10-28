import {parse} from './contracts.js';

// A later state update must never erase the fact that an earlier claim was
// explicitly corrected. Keep that boundary independently of the latest head.
export function installCorrectionBarriers(r){
 const db=r.store.db;db.exec('CREATE TABLE IF NOT EXISTS v3_correction_barriers(source_id TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(source_id,revision))');
 if(r.inner.meta('correctionBarriersVersion')===1)return;
 let previous;for(const d of r.archive.db.prepare('SELECT source_id,revision,kind,body,metadata FROM documents ORDER BY source_id,revision').all()){
  const meta=parse(d.metadata),same=previous?.source_id===d.source_id,old=same?parse(previous.metadata):{},identityChanged=same&&['speakerId','forwardedAuthorId','conversationPeerId'].some(k=>meta[k]!==old[k]);
  const kind=meta.changeKind||(same?(previous.body===d.body&&!identityChanged?'annotation':!d.body.trim()?'retraction':['homepage','post'].includes(d.kind)?'state-change':'correction'):'observation');
  if(['correction','retraction'].includes(kind))db.prepare('INSERT OR IGNORE INTO v3_correction_barriers VALUES(?,?)').run(d.source_id,d.revision);previous=d;
 }r.inner.meta('correctionBarriersVersion',1);
}
export function reconcileCorrectionBarriers(r){
 const s=r.store,db=s.db;let quarantined=0;
 for(const m of s.list({includeInactive:true,limit:50000})){if(!['active','faded','outdated','contested'].includes(m.status))continue;
  const refs=db.prepare('SELECT source_id,source_revision FROM memory_source_dependencies WHERE memory_id=? AND memory_revision=?').all(m.id,m.revision);
  const oldBasis=refs.some(e=>db.prepare('SELECT 1 FROM v3_correction_barriers WHERE source_id=? AND revision>? LIMIT 1').get(e.source_id,e.source_revision));
  const transferred=!m.metadata.correctionReviewed&&refs.some(e=>db.prepare('SELECT 1 FROM v3_correction_barriers WHERE source_id=? AND revision=?').get(e.source_id,e.source_revision)&&db.prepare('SELECT 1 FROM memory_evidence e JOIN memory_versions v ON v.memory_id=e.memory_id AND v.revision=e.memory_revision WHERE e.memory_id=? AND e.memory_revision<? AND e.source_id=? AND e.source_revision<? AND v.gist=? LIMIT 1').get(m.id,m.revision,e.source_id,e.source_revision,m.gist));
  if(!oldBasis&&!transferred)continue;
  db.prepare("UPDATE memory_nodes SET status='candidate' WHERE memory_id=?").run(m.id);s.index(m.id);
  db.prepare("INSERT OR REPLACE INTO v3_repair_queue VALUES('memory',?,?,'pending')").run(m.id,oldBasis?'source-correction':'correction-context-unverified');r.inner.invalidateMemories([m.id],{reason:'historical-correction-reconciled'});quarantined++;
 }return {quarantined};
}
