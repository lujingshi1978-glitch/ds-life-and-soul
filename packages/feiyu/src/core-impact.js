// Impact starts an assessment; it is not an instruction to change personality.
export const CORE_IMPACT_POLICY=Object.freeze({threshold:60,legacyEventImpact:20,maxEventImpact:100,layerCoefficient:5});
const unit=(v,f=.5)=>Number.isFinite(Number(v))?Math.max(0,Math.min(1,Number(v))):f;
export function experienceImpact({intensity,confidence,lastingness}={}){
  return Math.round(100*unit(intensity)*unit(confidence)*(.4+.6*unit(lastingness))*100)/100;
}
export function calculateCoreImpact(memories,eventScores=new Map(),usedRoots=new Set()){
  const parent=memories.map((_,i)=>i),find=i=>parent[i]===i?i:(parent[i]=find(parent[i]));
  const seen=new Map();
  memories.forEach((m,i)=>{for(const k of ['root:'+m.event_root,...m.evidence.map(r=>'ref:'+r)]){if(seen.has(k))parent[find(i)]=find(seen.get(k));else seen.set(k,i);}});
  const groups=new Map();memories.forEach((m,i)=>{const k=find(i);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(m);});
  let impact=0,independentEvents=0;const roots=new Set();
  for(const rows of groups.values()){
    const r=[...new Set(rows.map(m=>m.event_root))];r.forEach(x=>roots.add(x));
    if(r.some(x=>usedRoots.has(x)))continue;
    independentEvents++;impact+=Math.max(...r.map(x=>eventScores.has(x)?eventScores.get(x):CORE_IMPACT_POLICY.legacyEventImpact));
  }
  return {impact:Math.round(impact*100)/100,threshold:CORE_IMPACT_POLICY.threshold,independentEvents,roots:[...roots],eligible:impact>=CORE_IMPACT_POLICY.threshold};
}
