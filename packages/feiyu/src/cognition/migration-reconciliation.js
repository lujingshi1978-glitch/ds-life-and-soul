import {json,parse,hash} from './contracts.js';
import {HISTORY_VERSION} from './v3-history-review.js';
import {refreshProjections} from './projections.js';
import {coverDirectEncoding} from './coverage-repair.js';

// Reuse completed extraction only when its byte ranges and literal evidence
// still verify. This does not invent new memories, feelings or a dream.
export function reconcileCompletedHistory(r){
  const s=r.store,db=s.db,report={verifiedExisting:0,verifiedEmpty:0,skipped:0,needsReview:0,invalidClaims:[]};
  const docs=r.archive.db.prepare('SELECT rowid sequence,* FROM documents ORDER BY rowid').all();
  const events=db.prepare('SELECT e.*,es.source_id,es.source_revision FROM cognitive_events e JOIN event_sources es USING(character_id,event_id)').all(),eventMap=new Map();for(const e of events){const key=e.source_id+'@'+e.source_revision,list=eventMap.get(key)||[];list.push(e);eventMap.set(key,list);}
  const evidence=db.prepare('SELECT e.*,n.status,n.kind,n.current_revision,v.metadata_json FROM memory_evidence e JOIN memory_nodes n USING(character_id,memory_id) JOIN memory_versions v ON v.memory_id=n.memory_id AND v.revision=n.current_revision WHERE e.memory_revision=n.current_revision').all(),memoryMap=new Map();for(const e of evidence){const key=e.source_id+'@'+e.source_revision,list=memoryMap.get(key)||[];list.push(e);memoryMap.set(key,list);}
  s.atomic('v3-history-verified-adoption',()=>{
    for(const d of docs){
      const meta=parse(d.metadata),key=d.source_id+'@'+d.revision;let status,reason;
      if(d.status==='deleted'||s.suppressed(d.source_id)||meta.notPrimaryEvidence||d.adapter==='inner-config'||!d.body.trim()){status='skipped';reason='nonprimary-or-unavailable';report.skipped++;}
      else{
        const es=eventMap.get(key)||[],units=es.flatMap(e=>db.prepare('SELECT * FROM v3_extract_units WHERE event_id=? AND source_id=? AND source_revision=? ORDER BY start').all(e.event_id,d.source_id,d.revision));
        const complete=units.filter(u=>['complete','adopted-v2-complete'].includes(u.status));let end=0;for(const u of complete.sort((a,b)=>a.start-b.start))if(u.start<=end)end=Math.max(end,u.start+u.length);
        const claims=(memoryMap.get(key)||[]).filter(e=>!['forgotten','candidate'].includes(e.status)&&e.role!=='context'&&e.kind!=='pattern'&&!parse(e.metadata_json).derived),invalid=claims.filter(e=>{const span=parse(e.span_json);return !span.length||span.offset<0||span.offset+span.length>d.body.length||parse(e.metadata_json).attributionMismatch;});
        // Legacy summaries with no literal spans require actual re-extraction.
        if(end>=d.body.length&&!invalid.length){status='complete';reason=claims.length?'verified-existing-byte-coverage-and-claims':'verified-completed-empty-extraction';if(claims.length)report.verifiedExisting++;else report.verifiedEmpty++;}
        else{report.needsReview++;for(const e of invalid)if(!report.invalidClaims.includes(e.memory_id))report.invalidClaims.push(e.memory_id);continue;}
      }
      const old=db.prepare('SELECT status FROM v3_history_coverage WHERE source_id=? AND revision=? AND version=?').get(d.source_id,d.revision,HISTORY_VERSION);
      if(old&&['complete','skipped'].includes(old.status))continue;
      const jobs=db.prepare('SELECT job_ids FROM v3_history_coverage WHERE source_id=? AND revision=? AND version=?').get(d.source_id,d.revision,HISTORY_VERSION);
      // Do not cancel a mixed job which still has genuinely uncovered sources.
      db.prepare('INSERT OR REPLACE INTO v3_history_coverage VALUES(?,?,?,?,?,?,?)').run(d.source_id,d.revision,HISTORY_VERSION,status,0,jobs?.job_ids||'[]',reason);
    }
    refreshProjections(s,s.list({limit:50000}).map(m=>m.id));return {affected:[],...report};
  });
  for(const j of db.prepare("SELECT * FROM jobs WHERE kind='history-v3' AND status='pending'").all()){
    const parts=parse(j.payload_json).parts||[];if(parts.length&&parts.every(p=>['complete','skipped'].includes(db.prepare('SELECT status FROM v3_history_coverage WHERE source_id=? AND revision=? AND version=?').get(p.sourceId,p.revision,HISTORY_VERSION)?.status))){db.prepare("UPDATE jobs SET status='complete',payload_json='{}' WHERE job_id=?").run(j.job_id);db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(r.characterId,j.job_id,json({kind:'history-v3',verifiedAdoption:true,sources:parts.map(p=>p.sourceId),inputHash:hash(parts)}),r.now());}
  }
  r.inner.meta('unifiedHistoryReconciliation',report);return report;
}

export function adoptExplicitOwnExperiences(r){
  const s=r.store;let adopted=0,structuredCoverage=0;
  s.atomic('explicit-experience-evidence-adopted',()=>{
    for(const m of s.list({kinds:['experience'],limit:50000})){
      if(m.metadata.source!=='explicit-v1-experience')continue;
      const ref=m.evidence.find(e=>e.role!=='context');if(!ref)continue;const d=r.archive.get(ref.sourceId,ref.revision);if(!d.metadata.explicitExperience||d.metadata.speakerId!==r.characterId)continue;
      const note=parse(d.text),expected=[note.subject,note.feeling].filter(Boolean).join('：');if(m.gist!==[...expected].slice(0,800).join('')||!note.feeling)continue;
      const literal=json(note.feeling),at=d.text.indexOf(literal);if(at<0)continue;
      if(!m.metadata.legacyRevalidated){r.lifecycle.revise(m.id,m.revision,{metadata:{...m.metadata,legacyRevalidated:true,evidenceAdoption:'exact-structured-self-record'}});
        s.db.prepare('UPDATE memory_evidence SET span_json=? WHERE memory_id=? AND memory_revision=? AND source_id=? AND source_revision=? AND role<>?').run(json({offset:at,length:literal.length}),m.id,m.revision+1,ref.sourceId,ref.revision,'context');
        s.db.prepare('DELETE FROM v3_memory_snapshots WHERE memory_id=? AND revision=?').run(m.id,m.revision+1);s.v3AfterWrite?.(m.id);adopted++;
      }
      // Reuse an exact full structured self-record, including its existing
      // decision summary. No model is needed to invent a second interpretation.
      const allowed=new Set(['subject','feeling','preference','confidence','decisionSummary','epistemic','evidence','impact','intensity','lastingness','notReasoningTrace','source']);
      if(m.detail===d.text&&Object.keys(note).every(k=>allowed.has(k))&&!s.db.prepare('SELECT 1 FROM v3_history_coverage WHERE source_id=? AND revision=? AND version=?').get(ref.sourceId,ref.revision,HISTORY_VERSION)){
        s.db.prepare('INSERT INTO v3_history_coverage VALUES(?,?,?,?,?,?,?)').run(ref.sourceId,ref.revision,HISTORY_VERSION,'complete',1,'[]','verified-full-structured-own-experience');coverDirectEncoding(r,[ref],null);structuredCoverage++;
      }
    }return {affected:[],adopted,structuredCoverage};
  });return {adopted,structuredCoverage,newExperiences:0};
}
