import {hash,json,parse} from './contracts.js';

export class InterestObservations {
  constructor(runtime){this.r=runtime;this.db=runtime.store.db;this.db.exec('CREATE TABLE IF NOT EXISTS v3_interest_observations(id TEXT PRIMARY KEY,body TEXT NOT NULL,status TEXT NOT NULL)');}
  observe(input){
    if(!input.evidence?.length)throw Error('INTEREST_EXPERIENCE_REQUIRED');
    const id=hash([input.topic,input.eventRoot,input.evidence,input.reaction]);this.db.prepare("INSERT OR IGNORE INTO v3_interest_observations VALUES(?,?,'pending')").run(id,json(input));this.flush();return {id,status:this.db.prepare('SELECT status FROM v3_interest_observations WHERE id=?').get(id).status};
  }
  flush(){
    const s=this.r.store;for(const row of this.db.prepare("SELECT * FROM v3_interest_observations WHERE status='pending' LIMIT 50").all()){
      const input=parse(row.body),sources=input.evidence.map(x=>String(x).split('@')[0]);
      const evidence=s.list({kinds:['experience'],limit:50000}).filter(m=>m.status==='active'&&(input.evidence.includes(m.id)||m.evidence.some(e=>sources.includes(e.sourceId)))).map(m=>m.id).slice(0,8);
      if(!evidence.length)continue;
      if(this.r.dispositions){const refs=evidence.flatMap(id=>s.get(id).evidence).map(e=>({sourceId:e.sourceId,revision:e.revision}));this.r.observe({adapter:'interest-cue',externalId:row.id,kind:'interest-cue',text:'活动留下了一个待理解的兴趣线索：'+input.topic+'；当时反应：'+(input.note||input.reaction)+'。这不自动证明长期喜欢，也不因重复出现而升级；由内心结合经历决定是否保留或不变。',metadata:{speakerId:this.r.characterId,scope:'self',notPrimaryEvidence:true,basisSources:refs}},{kind:'interest-cue',eventRoot:input.eventRoot});}else this.r.policy.maintainInterest({name:input.topic,evidence,reaction:input.reaction,note:input.note});this.db.prepare("UPDATE v3_interest_observations SET status='complete' WHERE id=?").run(row.id);
    }
  }
}
