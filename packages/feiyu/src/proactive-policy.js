export function responseOnlyWakeBlocked(state, reason) {
  return state.responseOnly === true && !state.unread?.length && ['timeout', 'replyCheck', 'proactiveCheck', 'admin', 'bootstrap'].includes(reason);
}
// Decide when an idle conversation may be contacted without an incoming message.
export function proactiveTargetAllowed(key, ownerQQ, settings = {}) {
  if (!/^private:\d+$/.test(key)) return false;
  if(settings.contacts?.[key.slice(8)]?.enabled===false)return false;
  if (/^private:\d+$/.test(key) && settings.contacts?.[key.slice(8)]?.enabled === true) return true;
  return settings.ownerOnly !== true || key === `private:${ownerQQ}`;
}

export function proactiveRoundPlan(state, settings = {}) {
  const completed = Math.max(0, Number(state.proactiveUnansweredCount) || 0);
  if (completed >= 3) return null;
  const round = completed + 1;
  const [min, max] = [[10, 30], [30, 60], [60, 120]][completed];
  const score = Math.max(0, Math.min(100, Number(state.intimacy?.score ?? 45)));
  const threshold = Number(settings.intimacyThreshold ?? 60);
  const anchor = Math.max(Number(state.lastIncomingAt) || 0, Number(state.lastAiReplyAt) || 0, completed ? Number(state.lastProactiveAt) || 0 : 0);
  // Stable across polling and restarts; higher intimacy always shortens the interval.
  let hash = 2166136261;
  for (const c of `${anchor}:${round}`) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const jitter = (hash >>> 0) / 0xffffffff;
  const distance = Math.min(1, Math.max(0, (100 - score) / Math.max(1, 100 - threshold)));
  const intervalMs = Math.round((min + (max - min) * (distance * 0.8 + jitter * 0.2)) * 60_000);
  const hint = [
    '第一轮：自然提起一个具体话题，可接上次兴趣或一个小念头。不要问在吗，不复述旧请求。用1～3条中等长度短消息。',
    '第二轮：上次主动消息尚未得到回复。轻轻问一句“在吗”或类似问候，再接一个具体小话题。最多2条，不责问、不施压。',
    '第三轮：前两轮尚未得到回复。只发1条很短的在线问候，例如“在嘛”。不要附带话题、解释、委屈或催促。这轮之后停止主动联系，直到对方回复。'
  ][completed];
  return { round, minMinutes: min, maxMinutes: max, intervalMs, dueAt: anchor ? anchor + intervalMs : null, hint };
}

export function recordProactiveSend(state, now = Date.now()) {
  if (!state.proactiveRoundPending) return false;
  state.proactiveRoundPending = false;
  state.proactiveUnansweredCount = Math.min(3, (Number(state.proactiveUnansweredCount) || 0) + 1);
  state.lastProactiveAt = now;
  return true;
}

export function proactiveOpportunity({ key, ownerQQ, settings = {}, state, now = Date.now() }) {
  if (settings.enabled === false || !proactiveTargetAllowed(key, ownerQQ, settings)) return false;
  if (state.responseOnly || state.unread?.length || Number(state.intimacy?.score ?? 45) < Number(settings.intimacyThreshold ?? 60)) return false;
  if (state.relationship?.paused || Number(state.relationship?.snoozeUntil) > now) return false;
  const plan = proactiveRoundPlan(state, settings);
  return !!plan?.dueAt && now >= plan.dueAt;
}
