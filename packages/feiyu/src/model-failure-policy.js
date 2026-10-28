// Model outages are transport state, not social messages or deliberate silence.
export function modelRetryDelay(state, now = Date.now()) {
  const until = Number(state?.modelRetryAt);
  return Number.isFinite(until) ? Math.max(0, Math.min(900000, until - now)) : 0;
}
export function noteModelFailure(state, now = Date.now()) {
  const previous = now - Number(state.modelFailureAt || 0) > 1800000 ? 0 : Number(state.modelFailureCount) || 0;
  state.modelFailureCount = Math.min(10, Math.max(0, previous) + 1);
  state.modelFailureAt = now;
  state.modelRetryAt = now + Math.min(900000, 30000 * 2 ** (state.modelFailureCount - 1));
  return modelRetryDelay(state, now);
}
export function resetModelFailure(state) {
  state.modelFailureCount = 0; state.modelFailureAt = 0; state.modelRetryAt = 0;
}
export function shouldForwardAgentFailure(mode, key, ownerQQ) {
  return mode === 'closed-agent' && key === `private:${ownerQQ}`;
}
