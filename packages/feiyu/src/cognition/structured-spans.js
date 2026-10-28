// JSON source fields keep their own literal coordinates. Equal values under a
// different key do not count as unchanged evidence for the original field.
export function structuredLeaves(text){
  try{JSON.parse(text);}catch{return [];}
  const tokens=[...text.matchAll(/"(?:\\.|[^"\\])*"|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]:,]/g)],leaves=[];let i=0;
  function read(path){const token=tokens[i++];if(!token)throw Error('invalid');
    if(token[0]==='{'){while(tokens[i]?.[0]!=='}'){const key=JSON.parse(tokens[i++][0]);if(tokens[i++][0]!==':')throw Error('invalid');read([...path,key]);if(tokens[i]?.[0]===',')i++;else break;}i++;}
    else if(token[0]==='['){let index=0;while(tokens[i]?.[0]!==']'){read([...path,index++]);if(tokens[i]?.[0]===',')i++;else break;}i++;}
    else leaves.push({path:JSON.stringify(path),offset:token.index,length:token[0].length,literal:token[0]});
  }
  try{read([]);return leaves;}catch{return [];}
}
export function transferStructuredSpan(before,after,span){
  const old=structuredLeaves(before).find(v=>span.offset>=v.offset&&span.offset+span.length<=v.offset+v.length);if(!old)return null;
  const fresh=structuredLeaves(after).find(v=>v.path===old.path&&v.literal===old.literal);return fresh?{...span,offset:fresh.offset+span.offset-old.offset}:null;
}

export function sourceTextFormat(text){try{JSON.parse(text);return 'json-literal';}catch{return 'plain';}}

// Reversible JSON decoding, never fuzzy quote matching. The retained quotation
// and span are always the actual bytes/UTF-16 characters in the original source.
export function locateLiteralQuote(material,quote){
  let offset=material.text.indexOf(quote);if(offset>=0)return {offset,quote,encoding:'literal'};
  if((material.textFormat||sourceTextFormat(material.text))==='json-literal'){
    const escaped=JSON.stringify(quote).slice(1,-1);offset=material.text.indexOf(escaped);
    if(offset>=0)return {offset,quote:escaped,encoding:'json-string'};
  }return null;
}

export function locatePacketQuote(origin,materials,quote){
  const direct=locateLiteralQuote(origin,quote);if(direct)return {...direct,material:origin};
  // Chunk references are not source identities. Rejoin only contiguous main
  // text already shown in this very packet, with the same source/revision,
  // event, actor and outcome. Context-only text and other documents stay out.
  const pieces=materials.filter(m=>m.sourceId===origin.sourceId&&m.revision===origin.revision&&m.eventId===origin.eventId&&m.eventRoot===origin.eventRoot&&m.outcome===origin.outcome&&JSON.stringify(m.metadata)===JSON.stringify(origin.metadata)).sort((a,b)=>(a.sourceOffset||0)-(b.sourceOffset||0)),blocks=[];
  for(const m of pieces){const start=m.sourceOffset||0,prev=blocks.at(-1),end=prev?prev.sourceOffset+prev.text.length:0;
    if(prev&&start<=end){const overlap=Math.min(end-start,m.text.length);if(prev.text.slice(start-prev.sourceOffset,start-prev.sourceOffset+overlap)!==m.text.slice(0,overlap))return null;prev.text+=m.text.slice(overlap);}
    else blocks.push({...origin,text:m.text,sourceOffset:start});
  }
  const hits=blocks.flatMap(material=>{const found=locateLiteralQuote(material,quote);if(found&&material.text.indexOf(found.quote,found.offset+1)>=0)return [{ambiguous:true},{ambiguous:true}];return found?[{...found,material}]:[];});
  return hits.length===1?hits[0]:null;
}
