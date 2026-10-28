import {hash} from './contracts.js';

const ROOT_FIELDS=new Set(['summary','changes','psychology','psyche','feeling','decision','dispositions','reviewSummary']);
const reasoningKeys=new Set(['analysis','analysiscontent','reasoning','reasoningcontent','reasoningtrace','thinking','thought','thoughts','thoughtprocess','chainofthought','internalreasoning','internalthought','internalthoughts','hiddenreasoning','hiddenthoughts','scratchpad','rationale','cot','思维链','思考过程','推理过程','内部推理','内部思考','分析过程']);
const normalizedKey=key=>key.normalize('NFKC').replace(/[\s_.-]/g,'').toLowerCase();
const isReasoningKey=key=>reasoningKeys.has(normalizedKey(key));

// A repair may use the explicit rejected JSON in memory, never provider/model
// reasoning fields or unrelated top-level output. This does not persist it.
export function explicitInnerPatch(value){
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const seen=new WeakSet();
  const clean=(input,depth=0)=>{
    if(input===null||typeof input==='string'||typeof input==='boolean')return input;
    if(typeof input==='number')return Number.isFinite(input)?input:null;
    if(!input||typeof input!=='object'||depth>64||seen.has(input))return undefined;
    seen.add(input);
    const out=Array.isArray(input)?input.map(item=>clean(item,depth+1)??null):Object.fromEntries(Object.entries(input).filter(([key])=>!isReasoningKey(key)).map(([key,item])=>[key,clean(item,depth+1)]).filter(([,item])=>item!==undefined));
    seen.delete(input);return out;
  };
  return Object.fromEntries(Object.entries(value).filter(([key])=>ROOT_FIELDS.has(key)).map(([key,item])=>[key,clean(item)]).filter(([,item])=>item!==undefined));
}

const IDs=new Set(['id','ids','memoryId','memoryIds','eventId','eventIds','objectId','objectIds','personId','people','previousId','threadId','sourceId','subjectId','targetId','target','wishId','chapterId']);
const validId=value=>/^(?:inner|psyche|memory|legacy|event|source|character|qq|wechat|bili|topic):[A-Za-z0-9_.:@-]{1,180}$/.test(value)||/^\d{5,16}$/.test(value);
const enums={
  kind:['concern','relationship_cue','chapter','wish','motive','chat','browse','learn','rest','do_nothing','attitude','interest','feeling','integrated-feeling','tension','curiosity','care','promise','unfinished_conversation','creative_interest','expectation'],
  status:['active','quiet','paused','contested','resolved','released','candidate','outdated','faded','forgotten','superseded','merged','redacted'],
  transition:['add','continue','coexist','release'],operation:['add','update','merge','resolve','release'],
  mode:['feed','search','continue'],platform:['bilibili','youtube','douyin','weibo','xiaohongshu','zhihu','tieba'],
  concernKind:['curiosity','care','promise','unfinished_conversation','creative_interest','tension','expectation'],
  cueKind:['shared_story','shared_interest','interaction_habit','unfinished_topic','repair','trust','boundary','care'],
  motiveKind:['share','care','explore','learn','create','repair','rest','stay_with_feeling','decline'],
  impulse:['stay','share','tease','pushback','ask','help','avoid','disengage']
};
const KNOWN_KEYS=new Set([...ROOT_FIELDS,...IDs,...Object.keys(enums),
  'add','update','merge','resolve','release','text','reason','title','meaning','facet','expectedRevision','expectedRevisions','revision','importance','intensity',
  'attention','emotionalTensions','focus','trigger','emotions','appraisal','mood','valence','arousal','energy','anger','hurt','amusement','embarrassment','interest',
  'durationMinutes','intent','query','expectation','nextStep','reconsiderAfter','earliest','latest','precision','knownFacts','uncertainties','decision',
  'occurredAt','validFrom','validTo','confidence','horizon','revisitConditions','narrative','possibleContinuations','scope','origin','interpretation','historical'
]);

// Persistent diagnostics retain shape, counts, hashes, known IDs and enums.
// No natural-language value or unknown object key becomes another prose copy
// outside the character's correction/forgetting graph.
export function diagnosticPatch(value){
  const visit=(input,key='')=>{
    if(typeof input==='string')return IDs.has(key)&&validId(input)||enums[key]?.includes(input)?input:{chars:[...input].length,hash:hash(input)};
    if(input===null||typeof input!=='object')return input;
    if(Array.isArray(input))return input.map(item=>visit(item,key));
    return Object.fromEntries(Object.entries(input).map(([field,item])=>[KNOWN_KEYS.has(field)?field:'field:'+hash(field),visit(item,field)]));
  };
  return visit(explicitInnerPatch(value));
}
