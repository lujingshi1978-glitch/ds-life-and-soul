// Pure policy: a busy queue is never cancelled from a polling observation.
export function voiceRepairAction(status, { failed = false, probe = false } = {}) {
  if (status?.ok !== true) return 'unavailable';
  if (status.queue?.active || status.queue?.pending > 0) return 'busy';
  if (!status.browser?.connected || !status.ds?.pageFound) return 'reopen';
  if (!status.ds?.loggedIn) return 'login-required';
  return failed || probe ? 'probe' : 'healthy';
}
