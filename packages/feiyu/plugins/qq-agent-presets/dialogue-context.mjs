// Host controller publishes authenticated context before native prompt assembly.
// DSH assembles context BEFORE agent/pre-step, so publishing in pre-step alone
// would leave the first model request without the new conversation snapshot.
import {validateBehaviorFrame} from '../../src/behavior-armor.js';
const contexts=new Map();
export function publishDialogueContext(event,agentId=event?.sessionId){
 if(!event||typeof event.sessionId!=='string'||!event.sessionId||agentId!==event.sessionId||!/^(private|group):\d+$/.test(event.key))throw Error('Dialogue context session mismatch');
 if(event.behavior!==undefined&&(!validateBehaviorFrame(event.behavior)||event.behavior.key!==event.key))throw Error('Invalid dialogue behavior');
 if(event.naturalExpressionEnabled!==undefined&&typeof event.naturalExpressionEnabled!=='boolean')throw Error('Invalid dialogue expression setting');
 const previous=contexts.get(event.sessionId);
 if(previous&&previous.key!==event.key)throw Error('Dialogue context contact mismatch');
 // Keep the authenticated identity immutable even if a caller retains its
 // parsed envelope. No permission-bearing object is shared with tool args.
 const behavior=event.behavior===undefined?undefined:Object.freeze({...event.behavior,freshSeqs:Object.freeze([...event.behavior.freshSeqs]),historySeqs:Object.freeze([...event.behavior.historySeqs])});
 const snapshot=Object.freeze({...event,behavior,naturalExpressionEnabled:event.naturalExpressionEnabled??true});
 contexts.set(event.sessionId,snapshot);
 return ()=>{if(contexts.get(snapshot.sessionId)===snapshot){if(previous)contexts.set(snapshot.sessionId,previous);else contexts.delete(snapshot.sessionId);}};
}
export function dialogueContextFor(sessionId){return contexts.get(sessionId)?.context;}
export function dialogueScopeFor(sessionId){return contexts.get(sessionId)?.key;}
export function clearDialogueContext(sessionId){contexts.delete(sessionId);}

export function dialoguePolicyFor(sessionId){return contexts.get(sessionId)?.policy;}
export function dialogueBehaviorFor(sessionId){return contexts.get(sessionId)?.behavior;}
export function dialogueExpressionEnabledFor(sessionId){return contexts.get(sessionId)?.naturalExpressionEnabled;}
