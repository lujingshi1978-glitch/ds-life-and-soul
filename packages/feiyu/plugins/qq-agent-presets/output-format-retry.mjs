// A malformed model request has not committed a new assistant/tool-call batch.
// Ask the native retry extension to retry that request in place; do not resubmit
// the whole QQ wake, replay completed tools, or try to repair invalid JSON here.
export const QQ_OUTPUT_FORMAT_RETRY_POLICY = Object.freeze({
  mode: 'normal',
  maxRetries: 2,
  retryableCodes: Object.freeze(['MALFORMED_RESPONSE']),
  initialDelayMs: 250,
  maxDelayMs: 1000,
  jitterRatio: 0,
});

export function installOutputFormatRetry(ctx, {isAdmitted = () => false} = {}) {
  return ctx.on('agent/request-error', async (payload, next) => {
    const agent = payload.agent;
    if (agent?.session?.header?.agentPreset !== 'qq-chat-v2'
      || payload.failure?.code !== 'MALFORMED_RESPONSE'
      || payload.signal?.aborted
      || !isAdmitted(agent.id, payload)) return next();

    // This payload is scoped to one failed native request. The adapter's
    // provider-wide policy remains unchanged. Delegate the wait, durable retry
    // receipts, cancellation and per-step budget to the existing llm-retry.
    const original = payload.retryPolicy;
    payload.retryPolicy = QQ_OUTPUT_FORMAT_RETRY_POLICY;
    try { return await next(); }
    finally { payload.retryPolicy = original; }
  }, {prepend: true});
}
