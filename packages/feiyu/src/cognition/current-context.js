import {psycheBackground} from './feeling-protocol.js';
import {parse} from './contracts.js';
import {tuningFor} from '../runtime-tuning.js';
import {expressionFeelingScope} from './expression-feeling-scope.js';

// One synchronous SQLite read view supplies both the live mirror and consumers.
// A missing/invalidated summary stays missing; residual threads are not a prose
// substitute and are never concatenated to manufacture a current feeling.
export function readCurrentInner(owner,{scope}={}){
 const runtime=owner.runtime,inner=runtime.inner,db=runtime.store.db;
 const ownTransaction=!db.isTransaction;
 if(ownTransaction)db.exec('BEGIN DEFERRED');
 try{
  const head=inner.head(),projection=inner.psyche.current?.({includeInvalid:true});
  const psychological=head.mental_summary,psycheRevision=projection?.revision||0;
  const state={...owner.store.state(),psychological,generation:head.generation,psycheRevision};
  const value={state,psychological,generation:head.generation,psycheRevision,
   psychology:psycheBackground(inner,{limit:tuningFor(runtime).text.dialoguePsycheThreads,maxChars:tuningFor(runtime).text.dialoguePsycheChars,attentionOnly:true}),
   psyche:{attention:parse(head.attention_json||'[]').slice(0,2),emotionalTensions:parse(head.emotional_tensions_json||'[]').slice(0,2)}};
  const view=scope?expressionFeelingScope(inner,scope).view(value):value;
  if(ownTransaction)db.exec('COMMIT');return view;
 }catch(error){if(ownTransaction&&db.isTransaction)db.exec('ROLLBACK');throw error;}
}
