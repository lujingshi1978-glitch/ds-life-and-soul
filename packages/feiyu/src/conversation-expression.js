import {defaultNaturalExpression} from './natural-expression.js';
import {speakingStyleContext} from './speaking-style.js';

// The same small view serves QQ, WeChat and the desktop companion. Transport
// capabilities, the authoritative core and current inner state belong to their
// own providers; none is copied into this expression-only block.
export const EXPRESSION_BLOCK_MAX_CHARS=1400;
export function buildExpressionContext({card='',incoming='',expressionBlock='',naturalExpression=defaultNaturalExpression,frontendReactionInSystem=false,roleStyleInSystem=false}={}){
  if(typeof roleStyleInSystem!=='boolean')throw Error('Invalid role style placement');
  const supplied=typeof card==='string'&&card.trim(),style=supplied?card:String(naturalExpression.style?.()||'');
  // Optional feedback is already packed upstream. Never cut its structured
  // text into a partial instruction when an invalid caller exceeds the budget.
  const expression=typeof expressionBlock==='string'&&expressionBlock.length<=EXPRESSION_BLOCK_MAX_CHARS?expressionBlock:'';
  return [naturalExpression.prompt('chat',{frontendReactionInSystem}),roleStyleInSystem?'':speakingStyleContext(style,{selection:'inner-v3',incoming,styleOnly:!supplied}),expression]
    .filter(part=>typeof part==='string'&&part.trim()).join('\n');
}
