const HOUR = 3_600_000;
export const shanghaiDay = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
export function relationshipPlan(score = 50) {
  score = Math.max(0, Math.min(100, Number(score) || 0));
  if (score < 35) return { level: '疏远', minIntervalMs: 24 * HOUR, maxIntervalMs: 48 * HOUR, dailyLimit: 1, maxUnanswered: 1, style: '克制友好，只聊具体话题，不强行调侃' };
  if (score < 65) return { level: '熟悉', minIntervalMs: 6 * HOUR, maxIntervalMs: 12 * HOUR, dailyLimit: 2, maxUnanswered: 1, style: '保留屑女仆的轻微嘴欠，熟人式接梗，不擅自亲密' };
  if (score < 85) return { level: '亲近', minIntervalMs: 3 * HOUR, maxIntervalMs: 6 * HOUR, dailyLimit: 3, maxUnanswered: 2, style: '更放松地分享和逗趣，认真接住情绪，不纠缠' };
  return { level: '很熟', minIntervalMs: 2 * HOUR, maxIntervalMs: 4 * HOUR, dailyLimit: 3, maxUnanswered: 2, style: '自然分享小念头，玩笑更熟络，尊重边界，不假定恋爱关系' };
}
export function normalizeRelationship(value = {}) {
  return { ...value, score: Math.max(0, Math.min(100, Number(value.score ?? 50) || 0)), paused: value.paused === true,
    dailyContacts: Math.max(0, Number(value.dailyContacts) || 0), events: Array.isArray(value.events) ? value.events.slice(-30) : [] };
}
export function updateRelationship(value, { text, messageId, now = Date.now(), lastAiReplyAt = 0 }) {
  const r = normalizeRelationship(value);
  if (!String(text || '').trim() || (messageId && r.lastMessageId === String(messageId))) return r;
  const day = shanghaiDay(now), gained = r.gainDay === day ? Number(r.dailyGain) || 0 : 0;
  let delta = 0, reason = '普通互动';
  if (/(别再.{0,4}(联系|找|发)|不要.{0,4}(联系|找我|发消息|打扰)|别(烦|打扰)我|不想和你聊)/.test(text)) {
    delta = -15; reason = '明确要求停止联系'; r.paused = true;
  } else if (/(先别找我|晚点再聊|在忙|忙着呢)/.test(text)) {
    r.snoozeUntil = now + 12 * HOUR; reason = '对方忙碌，延后主动联系';
  } else if (lastAiReplyAt > 0 && now - lastAiReplyAt < 48 * HOUR) {
    delta = Math.max(0, Math.min(4 - gained, /[?？]|哈哈|好啊|行啊|一起|喜欢|好玩|有意思/.test(text) ? 2 : 1));
    reason = delta ? '有回应的双向互动' : '当日升分已达上限';
  }
  r.score = Math.max(0, Math.min(100, r.score + delta));
  r.lastMessageId = String(messageId || ''); r.gainDay = day; r.dailyGain = gained + Math.max(0, delta);
  r.events.push({ at: now, delta, reason, evidence: String(text).slice(0, 100), messageId: String(messageId || '') });
  r.events = r.events.slice(-30); return r;
}
export function relationshipOpportunity(value, state, now = Date.now()) {
  const r = normalizeRelationship(value), plan = relationshipPlan(r.score);
  if (r.paused || Number(r.snoozeUntil) > now || Number(r.nextContactAt) > now) return false;
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  if (hour < 9 || hour >= 23) return false;
  if (r.contactDay === shanghaiDay(now) && r.dailyContacts >= plan.dailyLimit) return false;
  if ((Number(state.proactiveUnansweredCount) || 0) >= plan.maxUnanswered) return false;
  const latest = Math.max(Number(state.lastIncomingAt) || 0, Number(state.lastAiReplyAt) || 0, Number(state.lastProactiveAt) || 0);
  return latest > 0 && now - latest >= plan.minIntervalMs;
}
export function recordRelationshipContact(value, now = Date.now(), roll = Math.random()) {
  const r = normalizeRelationship(value), p = relationshipPlan(r.score), day = shanghaiDay(now);
  r.dailyContacts = (r.contactDay === day ? r.dailyContacts : 0) + 1; r.contactDay = day;
  r.nextContactAt = now + p.minIntervalMs + Math.floor(Math.max(0, Math.min(1, roll)) * (p.maxIntervalMs - p.minIntervalMs)); return r;
}
export function relationshipHint(value) {
  if (!value) return '';
  const r = normalizeRelationship(value), p = relationshipPlan(r.score);
  return `【此联系人的互动偏好】好感度 ${r.score}/100（内部互动倾向，并非对方真实心理）：${p.level}。${p.style}。主动联系间隔约 ${p.minIntervalMs / HOUR}～${p.maxIntervalMs / HOUR} 小时，每天最多 ${p.dailyLimit} 次，连续 ${p.maxUnanswered} 次没回应就停止主动联系。${r.paused ? '对方要求停止联系，禁止主动发消息。' : ''}只参考本人的聊天记录，不透露管理员或其他人的聊天。不向对方透露分数，不拿好感度施压或索要回应。\n\n`;
}
