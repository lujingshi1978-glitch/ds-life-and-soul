import {parentPort,workerData} from 'node:worker_threads';
import {cosine} from './contracts.js';
const results=workerData.rows.map(r=>({id:r.id,score:cosine(workerData.query,r.vector)})).filter(r=>r.score>=workerData.threshold).sort((a,b)=>b.score-a.score).slice(0,workerData.limit);
parentPort.postMessage(results);
