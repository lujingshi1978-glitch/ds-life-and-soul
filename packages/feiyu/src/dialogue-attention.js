// One foreground QQ thought at a time. Waiting for people happens in bridge
// event handlers, outside this lane; ordinary DSH coding agents are unaffected.
export class DialogueAttention {
  constructor({ recover, log = () => {}, leaseMs = 300000 } = {}) {
    this.queue = []; this.active = null; this.recover = recover; this.log = log; this.leaseMs = leaseMs;
  }
  acquire(key) {
    return new Promise((resolve, reject) => { this.queue.push({ key, resolve, reject });if(this.active?.background)try{this.active.preempt();}catch{this.log('正在等待后台活动停止');}this.drain(); });
  }
  tryBackground(key,preempt){
    if(this.active||this.queue.length)return null;
    const slot={key,sessionId:null,startedAt:Date.now(),background:true,preempt};this.active=slot;
    slot.release=()=>{if(this.active!==slot)return;this.active=null;this.drain();};return slot;
  }
  drain() {
    if (this.active || !this.queue.length) return;
    const item = this.queue.shift();
    const slot = { key: item.key, sessionId: null, turns: new Set(), startedAt: Date.now() };
    this.active = slot;
    slot.release = () => {
      if (this.active !== slot) return;
      clearTimeout(slot.timer); this.active = null; this.drain();
    };
    slot.bind = sessionId => { slot.sessionId = sessionId; };
    const recover = async () => {
      if (this.active !== slot) return;
      try {
        // Never allow another thought while an old native turn can still send.
        if (!this.recover || !slot.sessionId) throw Error('No confirmed native session to recover');
        await this.recover(slot.sessionId);
        slot.release();
      } catch { this.log('聊天注意力恢复未确认，保留互斥并稍后重试'); if (this.active === slot) { slot.timer = setTimeout(recover, 15000); slot.timer.unref?.(); } }
    };
    slot.timer = setTimeout(recover, this.leaseMs); slot.timer.unref?.();
    item.resolve(slot);
  }
  observe(sessionId, event) {
    const slot = this.active; if (!slot || slot.background || slot.sessionId !== sessionId) return;
    const turn = event.data?.turn;
    if (event.type === 'turn/start') slot.turns.add(turn);
    if (event.type === 'turn/end' && slot.turns.has(turn)) {
      slot.turns.delete(turn); if (!slot.turns.size) slot.release();
    }
  }
  observeSnapshot(sessionId, records) {
    const slot = this.active;
    if (!slot || slot.background || slot.sessionId !== sessionId || !Array.isArray(records)) return false;
    let confirmed = false;
    for (const record of records) {
      const event = record?.type === 'event' ? record.event : record;
      // A partial snapshot with no open turn is not proof that our active turn
      // finished. Only exact endings for turns observed in this slot can settle.
      if (event?.type !== 'turn/end' || !slot.turns.has(event.data?.turn)) continue;
      slot.turns.delete(event.data.turn);
      confirmed = true;
    }
    if (confirmed && !slot.turns.size) { slot.release(); return true; }
    return false;
  }
  cancel(key) {
    const items = this.queue.filter(item => item.key === key);
    this.queue = this.queue.filter(item => item.key !== key);
    for (const item of items) item.reject(Error('会话已重置或权限已变化'));
    // Active work is released only by turn/end or confirmed native stop.
  }
  stopped(sessionId) { if (this.active?.sessionId === sessionId) this.active.release(); }
  status() { return { active: this.active ? { key: this.active.key, sessionId: this.active.sessionId, startedAt: this.active.startedAt,...(this.active.background?{background:true}:{}) } : null, queued: this.queue.map(item => item.key) }; }
}
