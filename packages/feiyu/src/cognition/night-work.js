import {nightScope,NIGHT_KINDS} from './night-scope.js';
export function nightKinds(runtime){return NIGHT_KINDS.filter(k=>k!=='reflect'||runtime.jobHandlers?.reflect);}
export function nightWorkState(runtime,cutoff,day){const row=day?null:runtime.store.db.prepare('SELECT day FROM v3_night_scopes WHERE cutoff=? AND role_epoch=? LIMIT 1').get(cutoff,runtime.store.manifest().role_epoch);const scope=nightScope(runtime,day||row?.day||'cutoff:'+cutoff,{create:true,cutoff});return scope.state();}
