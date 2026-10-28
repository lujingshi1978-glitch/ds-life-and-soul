import {hash,json,parse} from './contracts.js';
const ACTIVE=['active','quiet','paused','contested'];
export function expectationPhases(body){return Object.entries({reconsider:body.reconsiderAfter,earliest:body.expectation?.earliest,latest:body.expectation?.latest}).filter(([,at])=>Number.isSafeInteger(at)).map(([phase,at])=>({phase,at,key:hash(phase==='reconsider'?{phase,at}:{phase,earliest:body.expectation?.earliest??null,latest:body.expectation?.latest??null})}));}

// A wording revision does not create a new expectation or replay its completed phase.
export function syncExpectation(inner,object,refs=[]){
 const db=inner.db,phases=ACTIVE.includes(object.status)?expectationPhases(object.body):[],keep=new Set(phases.map(p=>'due:'+object.object_id+':window:'+p.key));
 for(const row of db.prepare("SELECT id FROM v3_reconsider WHERE object_id=? AND status='pending'").all(object.object_id))if(!keep.has(row.id))db.prepare("UPDATE v3_reconsider SET status='cancelled' WHERE id=?").run(row.id);
 for(const p of phases){const id='due:'+object.object_id+':window:'+p.key;
   db.prepare(`INSERT INTO v3_reconsider VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET object_revision=excluded.object_revision WHERE v3_reconsider.status='pending'`).run(id,'concern',object.object_id,object.current_revision,Math.max(inner.now(),p.at),Math.max(inner.now(),p.at)+86400000,'pending',0,json({refs,phase:p.phase,windowKey:p.key}));
 }
}
export function migrateExpectations(inner){if(inner.meta('expectationWindowsVersion')===2)return;
 inner.store.atomic('v3-expectation-windows-migrated',()=>{
  // Preserve completed old phases, so startup never replays an already reviewed window.
  for(const row of inner.db.prepare("SELECT * FROM v3_reconsider WHERE id NOT LIKE '%:window:%' AND status IN ('complete','failed')").all()){
   const version=inner.db.prepare('SELECT body_json FROM v3_inner_versions WHERE object_id=? AND revision=?').get(row.object_id,row.object_revision);if(!version)continue;
   const phase=parse(row.body).phase||'reconsider',p=expectationPhases(parse(version.body_json)).find(p=>p.phase===phase);if(!p)continue;
   inner.db.prepare('INSERT OR IGNORE INTO v3_reconsider VALUES(?,?,?,?,?,?,?,?,?)').run('due:'+row.object_id+':window:'+p.key,row.kind,row.object_id,row.object_revision,row.due_at,row.expires_at,row.status,row.attempts,json({...parse(row.body),phase,windowKey:p.key,migratedFrom:row.id}));
  }
  for(const o of inner.objects({kind:'concern',limit:2000}))syncExpectation(inner,o);
  inner.db.prepare("UPDATE v3_reconsider SET status='cancelled' WHERE status='pending' AND NOT EXISTS(SELECT 1 FROM v3_inner_objects o WHERE o.object_id=v3_reconsider.object_id AND o.status IN ('active','quiet','paused','contested'))").run();
  inner.meta('expectationWindowsVersion',2);return {affected:[]};
 });
}
