import {validateChatPolicy} from '../../src/affinity-chat-policy.js';
import {validateBehaviorFrame} from '../../src/behavior-armor.js';
import { createHmac, timingSafeEqual } from 'node:crypto';
export const EVENT_PREFIX = 'QQ_DIALOGUE_EVENT/1\n';
export function encodeDialogueEvent(payload, secret) {
  if (!secret) throw Error('Dialogue signing key unavailable');
  const body = JSON.stringify(payload);
  return EVENT_PREFIX + JSON.stringify({ body, signature: createHmac('sha256', secret).update(body).digest('hex') });
}
export function decodeDialogueEvent(text, secret, sessionId) {
  if (!text.startsWith(EVENT_PREFIX)) return null;
  if (!secret || text.length > 4 * 1024 * 1024) throw Error('Invalid dialogue envelope');
  const outer = JSON.parse(text.slice(EVENT_PREFIX.length));
  if (typeof outer.body !== 'string' || !/^[a-f0-9]{64}$/.test(outer.signature)) throw Error('Invalid dialogue signature');
  const expected = createHmac('sha256', secret).update(outer.body).digest();
  if (!timingSafeEqual(expected, Buffer.from(outer.signature, 'hex'))) throw Error('Invalid dialogue signature');
  const p = JSON.parse(outer.body);
  if (p.version !== 1 || p.sessionId !== sessionId || !/^(private|group):\d+$/.test(p.key)
    || typeof p.context !== 'string' || typeof p.reason !== 'string' || p.reason.length > 100) throw Error('Invalid dialogue event');
  if(p.policy!=null&&!validateChatPolicy(p.policy))throw Error('Invalid affinity policy');
  if(p.behavior!==undefined&&(!validateBehaviorFrame(p.behavior)||p.behavior.key!==p.key))throw Error('Invalid dialogue behavior');
  if(p.naturalExpressionEnabled!==undefined&&typeof p.naturalExpressionEnabled!=='boolean')throw Error('Invalid dialogue expression setting');
  // Only the console admission path creates this signed field. Text inside a
  // friend's message, a webpage, or a historical snapshot cannot promote itself.
  if(p.operatorRequest!==undefined&&(p.reason!=='operator-note'||typeof p.operatorRequest!=='string'||!p.operatorRequest.trim()))throw Error('Invalid operator request');
  return p;
}
export function dialogueEventKind(reason) {
  if (reason === 'operator-note') return 'operator-request';
  if (reason.startsWith('proactive')) return 'proactive-opportunity';
  if (reason === 'poke') return 'poke';
  if (reason === 'bootstrap') return 'conversation-open';
  if (/sleep|timer|reply-check|timeout/.test(reason)) return 'conversation-check';
  return 'incoming-message';
}
