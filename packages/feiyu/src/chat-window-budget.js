const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:400});};
const textFields=row=>['text','content'].filter(key=>typeof row[key]==='string');
const countText=row=>textFields(row).reduce((sum,key)=>sum+[...row[key]].length,0);

// Input order is oldest to newest. This is a detached presentation window:
// storage, identity fields and message order are never rewritten by budgeting.
// JSON framing and escaping count toward the budget, not only visible prose.
export function chatWindowView(rows,budgetChars){
 if(!Array.isArray(rows))fail('INVALID_CHAT_WINDOW_ROWS');
 if(!Number.isSafeInteger(budgetChars)||budgetChars<1000)fail('INVALID_CHAT_WINDOW_BUDGET');
 let source;try{source=rows.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row))fail('INVALID_CHAT_WINDOW_ROW');return JSON.parse(JSON.stringify(row));});}catch{fail('INVALID_CHAT_WINDOW_ROW');}
 const originalChars=source.reduce((sum,row)=>sum+countText(row),0),messages=[];
 const view=list=>{const visibleChars=list.reduce((sum,row)=>sum+countText(row),0),omittedMessages=source.length-list.length;return {messages:list,partial:omittedMessages>0||list.some(row=>row.partial===true),totalMessages:source.length,omittedMessages,originalChars,visibleChars,omittedChars:Math.max(0,originalChars-visibleChars)};};
 const fits=list=>JSON.stringify(view(list)).length<=budgetChars;
 for(let index=source.length-1;index>=0;index--){
  const row=source[index];if(fits([row,...messages])){messages.unshift(row);continue;}
  const fields=textFields(row),texts=fields.map(key=>({key,chars:[...row[key]]})),total=texts.reduce((sum,t)=>sum+t.chars.length,0);
  if(!total)continue;
  const excerpt=keep=>{
   const next={...row,partial:true,originalChars:total,omittedPrefixChars:{}};let remaining=keep;
   for(let n=texts.length-1;n>=0;n--){const {key,chars}=texts[n],take=Math.min(chars.length,remaining);remaining-=take;next[key]=chars.slice(chars.length-take).join('');next.omittedPrefixChars[key]=chars.length-take;}
   return next;
  };
  // If even intact identity metadata cannot fit, omit that complete message.
  // Cropping a sender, role or source ID would invent a different attribution.
  if(!fits([excerpt(0),...messages]))continue;
  let low=0,high=total;while(low<high){const mid=Math.ceil((low+high)/2);if(fits([excerpt(mid),...messages]))low=mid;else high=mid-1;}
  if(low>0)messages.unshift(excerpt(low));
  break;
 }
 const result=view(messages);if(JSON.stringify(result).length>budgetChars)fail('CHAT_WINDOW_CANNOT_FIT_METADATA');return result;
}
