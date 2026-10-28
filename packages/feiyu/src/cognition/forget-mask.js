// Mask automatic extraction material without moving UTF-16 source coordinates.
// Explicit archive lookup remains a separate, clearly labelled resource tool.
export function maskForgottenText(store,sourceId,revision,text,offset=0){
  if(!store.inner)return text;const spans=store.db.prepare('SELECT offset,length FROM v3_forget_spans WHERE source_id=? AND revision=? AND offset<? AND offset+length>?').all(sourceId,revision,offset+text.length,offset);if(!spans.length)return text;
  const chars=text.split('');for(const span of spans)for(let i=Math.max(0,span.offset-offset);i<Math.min(chars.length,span.offset+span.length-offset);i++)chars[i]=' ';return chars.join('');
}
