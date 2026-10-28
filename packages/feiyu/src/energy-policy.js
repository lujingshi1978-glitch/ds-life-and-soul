import {tuningFor} from './runtime-tuning.js';
const clamp=n=>Math.max(0,Math.min(1,Number.isFinite(n)?n:0.7));
// Fractions of a full energy bar, not percentage points.
export const ENERGY_POLICY=Object.freeze({idlePerHour:0.06,awakePerHour:0.04,restPerHour:0.08,sleepPerHour:0.12,wakeEnergy:0.25,wakeIntervalMs:60000,
  actions:Object.freeze({chat:0.004,qzone:0.006,bili:0.012,web:0.008,learn:0.01,organize:0.003,dream:0,tool:0.0003,cognition:0.002})});
export const energyBehavior=state=>state.behavior?.energyExempt?(state.behavior.energyKind||'idle'):(state.behavior?.kind||'idle');
export function energyPolicy(source){const life=tuningFor(source).life;return {idlePerHour:life.idleRecoveryPerHour,awakePerHour:life.awakeDrainPerHour,restPerHour:life.restRecoveryPerHour,sleepPerHour:life.sleepRecoveryPerHour,wakeEnergy:life.wakeEnergy,wakeIntervalMs:life.wakeIntervalMs,minimumSleepMs:life.minimumSleepMs,actionCostScale:life.actionCostScale,actions:Object.fromEntries(Object.entries(ENERGY_POLICY.actions).map(([kind,cost])=>[kind,cost*life.actionCostScale]))};}
export function lifeNightAt(source,at=Date.now()){const life=tuningFor(source).life,start=life.nightStartHour,end=life.nightEndHour;if(start===end)return false;const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',hourCycle:'h23'}).format(at));return start<end?hour>=start&&hour<end:hour>=start||hour<end;}
export function energyRate(kind,policy=ENERGY_POLICY){return ['dream','sleep'].includes(kind)?policy.sleepPerHour:kind==='rest'?policy.restPerHour:kind==='idle'?policy.idlePerHour:-policy.awakePerHour;}
export function advanceEnergy(state,at,policy=ENERGY_POLICY){
  const since=Number.isFinite(state.energyUpdatedAt)?state.energyUpdatedAt:at,elapsed=Math.max(0,at-since)/3600000;
  const rate=energyRate(energyBehavior(state),policy);
  return {energy:clamp(clamp(state.energy)+elapsed*rate),energyUpdatedAt:Math.max(since,at)};
}
export function energyFactor(energy=1){return 0.15+0.85*clamp(energy);}
export function scaleReplyPlan(base,score,energy=1){
  const e=clamp(energy),factor=energyFactor(e),maxMessages=Math.max(1,Math.floor(base.maxMessages*factor+1e-9));
  const baseChars=score<20?8:score<40?15:score<60?25:score<80?30:35;
  const suggestedMaxChars=Math.max(3,Math.round(baseChars*(0.35+0.65*e)));
  return {...base,minMessages:e<0.4?1:Math.min(base.minMessages,maxMessages),maxMessages,suggestedMaxChars,energy:e,
    length:e>=0.999?base.length:`每条约${Math.max(2,Math.round(suggestedMaxChars*0.4))}～${suggestedMaxChars}字，少铺垫少重复；必要信息仍说清楚`};
}
export function energyTextLimit(configured,energy=1){return Math.max(1,Math.floor(configured*(0.25+0.75*clamp(energy))));}
export function arousalHint(state){
  const a=clamp(state.arousal),e=clamp(state.energy),level=a<0.25?'低':a<0.65?'中':'高';
  const influence=a<0.25?'反应幅度小，不硬制造兴奋，不为了热场连续补话；低唤醒也能冷着脸烦、生闷气，不等于友好或已经消气。':a<0.65?'正常接话，表达有起伏，按具体内容和当前心情回应。':'反应和表达可以更鲜明；开心、愤怒或紧张由情绪与事件决定，不能把激动一律写成开心。';
  return `【本轮情绪唤醒影响】唤醒程度${a.toFixed(2)}（${level}）。${influence}唤醒高不等于精力充足，不提高精力预算，按实际想表达的内容决定长短与条数。序列化和真实平台返回仍由工具处理。${e<0.3?'当前精力低，即使情绪强烈也用短而有力的话表达，不强行长聊。':''}不向对方报告这些内部数值。\n`;
}
