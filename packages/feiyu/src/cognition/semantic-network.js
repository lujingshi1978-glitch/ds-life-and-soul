import {hash,json,parse,cosine,assertSignal} from './contracts.js';

// Similarity edges mean association only. They cannot supersede a fact, prove
// a promise, assert causality or become independent evidence for core growth.
export class SemanticNetwork {
  constructor(runtime){this.r=runtime;this.s=runtime.store;this.db=this.s.db;this.db.exec('CREATE TABLE IF NOT EXISTS v3_semantic_link_coverage(memory_id TEXT NOT NULL,model TEXT NOT NULL,revision INTEGER NOT NULL,PRIMARY KEY(memory_id,model))');}
  missing(limit=48){const model=this.r.retriever.embedding?.modelId;if(!model)return [];return this.db.prepare(`SELECT v.memory_id id,v.revision FROM v2_vectors v JOIN memory_nodes n ON n.memory_id=v.memory_id AND n.current_revision=v.revision LEFT JOIN v3_semantic_link_coverage c ON c.memory_id=v.memory_id AND c.model=v.model WHERE v.model=? AND n.status IN ('active','faded') AND (c.revision IS NULL OR c.revision<>v.revision) ORDER BY n.recorded_at LIMIT ?`).all(model,limit);}
  schedule(){if(this.db.prepare("SELECT 1 FROM jobs WHERE kind='link-local-v3' AND status IN ('pending','running')").get())return;const nodes=this.missing();if(nodes.length)this.s.enqueue('link-local-v3',{nodes,model:this.r.retriever.embedding.modelId},{fingerprint:hash([this.r.retriever.embedding.modelId,nodes])});}
  process(job,signal){
    const model=this.r.retriever.embedding?.modelId;if(model!==job.payload.model)throw Error('EMBEDDING_MODEL_CHANGED');
    const rows=this.db.prepare(`SELECT v.* FROM v2_vectors v JOIN memory_nodes n ON n.memory_id=v.memory_id AND n.current_revision=v.revision WHERE v.model=? AND n.status IN ('active','faded') LIMIT 50000`).all(model).map(row=>({...row,vector:parse(row.vector)}));
    const sketch=v=>Array.from({length:32},(_,n)=>v[Math.floor(n*v.length/32)]),sketches=new Map(rows.map(v=>[v.memory_id,sketch(v.vector)]));let linked=0,reviewed=0;
    return this.s.atomic('semantic-network-indexed',()=>{this.s.assertJob(job);for(const ref of job.payload.nodes){assertSignal(signal);const m=this.s.get(ref.id),v=rows.find(x=>x.memory_id===ref.id);if(!m||m.revision!==ref.revision||!v)continue;
      const q=sketches.get(m.id),candidates=rows.filter(x=>x.memory_id!==m.id).map(x=>({x,score:cosine(q,sketches.get(x.memory_id))})).sort((a,b)=>b.score-a.score).slice(0,24).map(({x})=>({x,score:cosine(v.vector,x.vector)})).filter(x=>x.score>=.82).sort((a,b)=>b.score-a.score).slice(0,2);
      for(const {x,score}of candidates){const other=this.s.get(x.memory_id);if(!other||other.revision!==x.revision||m.event_root===other.event_root)continue;if(this.s.edges(m.id).some(e=>(e.from_id===other.id||e.to_id===other.id)&&['semantic','contradicts','supersedes'].includes(e.relation)))continue;this.s.addEdge(m.id,other.id,'semantic',{provenance:'deterministic',confidence:Math.min(.6,score*.6),evidence:[]});linked++;}
      this.db.prepare('INSERT OR REPLACE INTO v3_semantic_link_coverage VALUES(?,?,?)').run(m.id,model,m.revision);reviewed++;
    }const report={kind:'link-local-v3',linked,reviewed,inferenceOnly:true};this.s.finish(job,report);return {...report,affected:job.payload.nodes.map(n=>n.id)};});
  }
  status(){const model=this.r.retriever.embedding?.modelId;return {model,covered:!model?0:this.db.prepare('SELECT count(*) n FROM v3_semantic_link_coverage c JOIN memory_nodes n ON n.memory_id=c.memory_id AND n.current_revision=c.revision WHERE c.model=?').get(model).n,missing:this.missing(50000).length,semanticEdges:this.db.prepare("SELECT count(*) n FROM memory_edges WHERE relation='semantic'").get().n};}
}
