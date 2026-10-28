import {json,parse} from './contracts.js';

// Versioned, once-only recovery. Never replay obsolete affect patches.
export function recoverV3Jobs(runtime){
  const s=runtime.store,db=s.db,version='v3-repair-2026-10-24-1';
  db.exec('CREATE TABLE IF NOT EXISTS v3_job_recovery(job_id TEXT NOT NULL,version TEXT NOT NULL,disposition TEXT NOT NULL,prior_report TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(job_id,version))');
  return s.atomic('v3-failed-jobs-reconciled',()=>{
    let retried=0,retired=0;
    for(const j of db.prepare("SELECT j.*,r.report_json FROM jobs j LEFT JOIN maintenance_reports r USING(character_id,job_id) WHERE j.character_id=? AND j.status='failed' AND NOT EXISTS(SELECT 1 FROM v3_job_recovery x WHERE x.job_id=j.job_id AND x.version=?)").all(runtime.characterId,version)){
      if(!['encode','dream','reflect','history-v3','embed-views','link-v3'].includes(j.kind))continue;
      const obsolete=j.kind==='reflect'||j.role_epoch!==s.manifest().role_epoch,disposition=obsolete?'retired-obsolete-no-affect-replay':'retry-current-evidence-once';
      db.prepare('INSERT INTO v3_job_recovery VALUES(?,?,?,?,?)').run(j.job_id,version,disposition,j.report_json||'{}',runtime.now());
      if(obsolete){db.prepare("UPDATE jobs SET status='cancelled',lease_owner=NULL,lease_until=NULL WHERE job_id=?").run(j.job_id);retired++;}
      else {db.prepare("UPDATE jobs SET status='pending',attempts=0,retry_at=?,lease_owner=NULL,lease_until=NULL WHERE job_id=?").run(runtime.now(),j.job_id);retried++;}
      db.prepare('INSERT OR REPLACE INTO maintenance_reports VALUES(?,?,?,?)').run(runtime.characterId,j.job_id,json({kind:j.kind,status:obsolete?'cancelled':'pending',recovery:disposition,prior:parse(j.report_json||'{}'),preservesCurrentFeelings:true}),runtime.now());
    }
    return {retried,retired,affected:[]};
  });
}
