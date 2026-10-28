// Recover native turns that did not deliver or acknowledge private incoming
// messages. Assistant text is never forwarded or treated as a delivery receipt.
export const REPLY_DELIVERY_RECOVERY_HINT = `【未完成的私聊投递】
上一轮没有成功发送QQ消息，也没有确认这批来信已处理；普通DSH文字没有送达对方。根据本次快照重新决定：想回复就调用QQ发送工具，然后确认实际处理水位；决定不接话就用qq_mark_read确认实际处理的throughSeq。允许沉默，不要求补完旧话题，不复述后台故障。不要只输出一段普通文字就结束。`;

export class ReplyDeliveryRecovery {
  constructor({snapshot, dispatch, log = () => {}, delayMs = 250, maxAttempts = 2,
    setTimer = setTimeout, clearTimer = clearTimeout}) {
    Object.assign(this, {snapshot, dispatch, log, delayMs, maxAttempts, setTimer, clearTimer});
    this.turns = new Map();
    this.batches = new Map();
  }
  begin(key, sessionId, turn, eligible = true) {
    if(!Number.isSafeInteger(turn))return;
    this.turns.set(sessionId, {key, turn, eligible, sendAttempted: false});
  }
  attemptedSend(sessionId) {
    const round = this.turns.get(sessionId);
    if (round) round.sendAttempted = true;
  }
  finish(sessionId, turn, {completed = true, sent = false} = {}) {
    const round = this.turns.get(sessionId);
    if (!round || round.turn !== turn) return false;
    this.turns.delete(sessionId);
    // Failed sends retain the existing backoff: an uncertain receipt must not
    // cause an immediate duplicate. Only a turn with no send attempt is repaired.
    if (!round.eligible || !completed || sent || round.sendAttempted) return false;
    const current = this.snapshot(round.key, sessionId);
    if (!current) return false;
    let batch = this.batches.get(round.key);
    if (!batch || batch.batch !== current.batch || batch.stamp !== current.stamp) {
      if (batch?.timer) this.clearTimer(batch.timer);
      batch = {batch: current.batch, stamp: current.stamp, attempts: 0, timer: null};
      this.batches.set(round.key, batch);
    }
    if (batch.timer || batch.attempts >= this.maxAttempts) return false;
    batch.attempts++;
    batch.timer = this.setTimer(async () => {
      batch.timer = null;
      if (this.batches.get(round.key) !== batch) return;
      const latest = this.snapshot(round.key, sessionId);
      if (!latest || latest.batch !== batch.batch || latest.stamp !== batch.stamp) return;
      this.log({key: round.key, action: 'retry', attempt: batch.attempts});
      try { await this.dispatch(round.key); }
      catch (error) { this.log({key: round.key, action: 'failed', error: String(error.message).slice(0, 160)}); }
    }, this.delayMs);
    batch.timer.unref?.();
    return true;
  }
  cancel(key) {
    const batch = this.batches.get(key);
    if (batch?.timer) this.clearTimer(batch.timer);
    this.batches.delete(key);
    for (const [sessionId, round] of this.turns) if (round.key === key) this.turns.delete(sessionId);
  }
  clear() {
    for (const key of this.batches.keys()) this.cancel(key);
    this.turns.clear();
  }
}
