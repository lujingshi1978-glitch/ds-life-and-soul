// Decide recovery for a finished incoming-message turn. This module owns no
// timers, counters, credentials or effects. The host still binds a retry to the
// exact session/role/input batch and enforces a finite attempt limit.
//
// These are semantic Harness LlmError codes, not provider-message substrings.
// MALFORMED_RESPONSE is emitted when the response cannot be parsed; an empty
// provider response is EMPTY_RESPONSE. Neither implies that a send happened.
const FORMAT_FAILURES = new Set(['MALFORMED_RESPONSE', 'EMPTY_RESPONSE']);

/**
 * `sent` requires a real successful delivery receipt. `acknowledged` means an
 * explicit decision to leave the observed batch unanswered, not an empty buffer
 * inferred from a failed send. `hasSeenPending` means unfinished incoming input
 * was actually offered to the model; merely arriving does not establish that.
 *
 * `schedule` asks the host to retain a recovery route for remaining input. It
 * does not authorize replay. In particular, `receipt-review` may inspect real
 * receipts but must never repeat the failed turn's outbound effects.
 */
export function planModelFailureRecovery({
  error, hasPending = false, hasSeenPending = false,
  sendAttempted = false, sent = false, acknowledged = false,
} = {}) {
  const pending = hasPending === true;
  const base = {fast: false, schedule: pending, applyBackoff: false, replay: false, reviewReceipts: false};

  // An error in a later bookkeeping/final-text step cannot turn a confirmed
  // delivery into an outage or penalize the next genuine incoming message.
  if (sent === true) return {...base, kind: 'settled', reason: 'delivery-confirmed'};

  // A missing/failed send receipt is ambiguous. Even if an old path incorrectly
  // cleared unread afterwards, do not reinterpret it as deliberate silence.
  if (sendAttempted === true) return {
    ...base, kind: 'receipt-review', reason: 'delivery-unconfirmed', reviewReceipts: true,
  };
  if (acknowledged === true) return {...base, kind: 'settled', reason: 'explicit-no-reply'};
  if (!pending) return {...base, kind: 'settled', reason: 'no-pending-input'};

  if (FORMAT_FAILURES.has(error?.code) && hasSeenPending === true) return {
    ...base, kind: 'fast', reason: 'invalid-or-empty-response', fast: true, replay: true,
  };

  // Preserve outage backoff for unknown failures and cases without an observed
  // unfinished batch. Unlike the old error branch, the host must arm a timer.
  return {
    ...base, kind: 'backoff',
    reason: FORMAT_FAILURES.has(error?.code) ? 'pending-input-not-observed' : 'model-error',
    applyBackoff: true, replay: true,
  };
}
