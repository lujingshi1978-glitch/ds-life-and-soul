// This planner allocates room for an already qualified evidence view. It never
// grants source access, changes ranking, or instructs the character to speak.
// The caller must estimate complete conflict/source bundles, not loose facts.
const invalid=field=>{throw Object.assign(Error('RECALL_BUDGET_INVALID:'+field),{code:'RECALL_BUDGET_INVALID'});};
const chars=(value,field,{optional=false,min=0}={})=>{if(value==null&&optional)return null;if(!Number.isSafeInteger(value)||value<min)invalid(field);return value;};

export function planRecallBudget({baseChars,requestedChars,elastic=true,maxExpansionRatio=3,contextAllowanceChars,callerCeilingChars,demandChars,bundles=[],overheadChars=0,demandIsEstimate=true}={}){
 const base=chars(baseChars,'baseChars',{min:1}),requested=chars(requestedChars,'requestedChars',{optional:true}),context=chars(contextAllowanceChars,'contextAllowanceChars',{optional:true}),caller=chars(callerCeilingChars,'callerCeilingChars',{optional:true}),overhead=chars(overheadChars,'overheadChars');
 if(typeof elastic!=='boolean'||!Number.isFinite(maxExpansionRatio)||maxExpansionRatio<1||maxExpansionRatio>32||!Array.isArray(bundles))invalid('policy');
 const seen=new Set(),qualified=[];
 for(const b of bundles){if(!b||typeof b.id!=='string'||!b.id||seen.has(b.id))invalid('bundle.id');seen.add(b.id);const size=chars(b.chars,'bundle.chars');if(typeof b.relevance!=='number'||!Number.isFinite(b.relevance)||b.relevance<0)invalid('bundle.relevance');if(b.relevance>0)qualified.push({id:b.id,chars:size});}
 const evidenceDemand=demandChars==null?qualified.reduce((n,b)=>n+b.chars,0):chars(demandChars,'demandChars'),demand=overhead+evidenceDemand;if(!Number.isSafeInteger(demand))invalid('demand-overflow');
 const preferred=requested??base,ratioCeiling=Math.floor(base*maxExpansionRatio);if(!Number.isSafeInteger(ratioCeiling))invalid('ceiling-overflow');
 // Caller ceiling is an explicit envelope. requested is an observable soft
 // preference in elastic mode; fixed mode preserves the old min semantics.
 const ceiling=Math.min(ratioCeiling,context??Number.MAX_SAFE_INTEGER,caller??Number.MAX_SAFE_INTEGER),initial=Math.min(ceiling,elastic?preferred:Math.min(base,preferred));
 const effective=elastic?Math.min(ceiling,Math.max(initial,evidenceDemand>0?demand:initial)):initial;
 const reasons=[];if(!elastic)reasons.push('fixed-policy');else if(effective>initial)reasons.push('qualified-whole-evidence-demand');else reasons.push(evidenceDemand?'base-sufficient':'no-qualified-expansion-demand');
 if(context!=null&&context<Math.max(preferred,demand))reasons.push('host-context-envelope');if(caller!=null&&caller<Math.max(preferred,demand))reasons.push('explicit-caller-ceiling');if(ratioCeiling<Math.max(preferred,demand))reasons.push('configured-expansion-ceiling');
 let projected=overhead;const selectedIds=[],omitted=[];for(const b of qualified){if(projected+b.chars<=effective){selectedIds.push(b.id);projected+=b.chars;}else omitted.push({id:b.id,reason:'whole-bundle-exceeds-remaining-envelope',chars:b.chars});}
 return {version:1,unit:'serialized-js-characters-not-model-tokens',elastic,requested,base,preferred,ceiling,effective,demand,actual:null,overhead,expanded:effective>initial,contextAllowanceKnown:context!==null,tokenAllowanceKnown:false,demandIsEstimate:!!demandIsEstimate,selectedIds,omitted,reasons};
}

export function finishRecallBudget(plan,{actualChars,omittedForBudget=false}={}){
 const actual=chars(actualChars,'actualChars');if(!plan||!Number.isSafeInteger(plan.effective)||actual>plan.effective)invalid('actual-exceeds-allocation');
 return {...plan,actual,unused:plan.effective-actual,omittedForBudget:!!omittedForBudget};
}
