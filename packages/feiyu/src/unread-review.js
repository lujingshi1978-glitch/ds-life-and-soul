// History discovery owns scan cursors only. Incoming payloads belong to the
// durable InboundLedger; archived unanswered messages remain ReplyRepair's job.
export function historyTime(message) {
  const value = Number(message.time);
  return Number.isFinite(value) && value > 0 ? (value < 1e12 ? value * 1000 : value) : 0;
}

export function pendingHistory(messages, {selfId, peerId, known = new Set(), after = 0, now = Date.now()} = {}) {
  const rows = messages.map((message, index) => ({message, index, at: historyTime(message)}))
    .filter(row => row.at && row.at <= now + 60000)
    .sort((a, b) => a.at - b.at || (Number(a.message.message_seq) || 0) - (Number(b.message.message_seq) || 0) || a.index - b.index);
  const author = message => String(message.sender?.user_id ?? message.user_id ?? '');
  const seen = new Set();
  return rows.filter(({message}) => {
    const id = String(message.message_id ?? message.msg_id ?? '');
    if (!id || id === '0' || seen.has(id) || known.has(id) || author(message) !== String(peerId)) return false;
    seen.add(id); return true;
  }).map(({message, at}) => ({...message, message_id: String(message.message_id ?? message.msg_id), _historyAt: at}));
}

// QQ returns device-transfer endpoints in get_friend_list; they have no person UID.
export function isDevicePeer(id) { return ['2113929217', '2113929218', '2113929219'].includes(String(id)); }

export class UnreadReview {
  constructor(dependencies) {
    this.d = dependencies;
    this.now = dependencies.now || Date.now;
    this.receive = dependencies.receive || dependencies.discover;
    this.data = dependencies.load() || {version: 3, accounts: {}};
    this.data.accounts ??= {};
    this.requested = true;
    this.running = null;
    this.lastRun = 0;
    this.draining = false;
    this.report = {phase: this.receive ? 'waiting' : 'disabled', source: 'durable-inbound-history'};
    if (!this.receive) this.report.reason = 'durable-receive-required';
  }

  status() {
    const pending = this.accountId && this.d.pendingCount ? Number(this.d.pendingCount(this.accountId)) : 0;
    return {...this.report, running: !!this.running, requested: this.requested, pending};
  }

  request(reason = 'startup') {
    if (!this.receive) return this.status();
    // An open page and a just-started bridge share one scan.
    if (reason !== 'manual' && this.lastRun && this.now() - this.lastRun < 30000 && !this.requested) return this.status();
    this.requested = true;
    this.reason = reason;
    void this.tick().catch(error => this.d.log('[unread-review] deferred', error.message));
    return this.status();
  }

  async tick() {
    if (!this.receive || this.running || !this.d.ready()) return this.status();
    if (!this.requested && this.lastRun && this.now() - this.lastRun >= (this.d.periodicMs ?? 300000)) {
      this.requested = true; this.reason = 'periodic-reconcile';
    }
    if (!this.requested) { await this.drain(); return this.status(); }
    this.requested = false;
    this.lastRun = this.now();
    this.running = this.scan();
    try { return await this.running; } finally { this.running = null; }
  }

  async checkpoint() { await this.d.save(this.data); }

  async requireAccount(expected) {
    const current = String(await (this.d.currentAccount ? this.d.currentAccount() : this.d.account()));
    if (current === expected) return;
    this.accountId = /^\d+$/.test(current) ? current : null;
    this.requested = true;
    throw Error('QQ account changed during history discovery');
  }

  async persist(account, key, message) {
    const id = message?.message_id ?? message?.msg_id;
    if (id == null || !String(id).trim() || String(id) === '0') throw Error('History message has no durable message ID');
    const receipt = await this.receive.call(this.d, String(account), key, message);
    // A returned ID means the ledger has inserted this message or already owns
    // the same key. A rejected/empty receipt never permits cursor advancement.
    if (receipt !== true && receipt !== String(id)) throw Error('History message was not durably received');
  }

  async migrateLegacyInbox() {
    for (const [accountId, account] of Object.entries(this.data.accounts)) {
      if (!account.inbox) continue;
      if (!/^\d+$/.test(accountId)) throw Error('Legacy inbox has an invalid account');
      for (const [key, queue] of Object.entries(account.inbox)) {
        if (!/^private:\d+$/.test(key) || !Array.isArray(queue)) throw Error('Legacy inbox has an invalid contact queue');
        while (queue.length) {
          // Keep the original JSON payload until SQLite has acknowledged it.
          // A crash after receive but before save replays the same durable key.
          await this.persist(accountId, key, queue[0]);
          queue.shift();
          if (!queue.length) delete account.inbox[key];
          await this.checkpoint();
        }
      }
      delete account.inbox;
      await this.checkpoint();
    }
    if (this.data.version !== 3) { this.data.version = 3; await this.checkpoint(); }
  }

  async scan() {
    const report = this.report = {phase: 'scanning', startedAt: this.now(), reason: this.reason || 'startup', source: 'durable-inbound-history', contacts: 0, discovered: 0, scheduled: 0, failed: 0, partial: 0, devicesSkipped: 0, cooldownSkipped: 0};
    try {
      const selfId = String(await this.d.account());
      if (!/^\d+$/.test(selfId)) throw Error('QQ account not loaded');
      this.accountId = selfId;
      const account = this.data.accounts[selfId] ??= {};
      await this.migrateLegacyInbox();
      await this.requireAccount(selfId);
      // Local projected unread is woken independently from upstream discovery.
      for (const key of this.d.localKeys()) if (!isDevicePeer(key.slice(8)) && this.d.allowed(key) && this.d.hasUnread(key) && this.d.wake(key)) report.scheduled++;
      await this.drain();
      const friends = await this.d.friends();
      if (!Array.isArray(friends)) throw Error('Invalid friend list');
      report.devicesSkipped = friends.filter(friend => isDevicePeer(friend.user_id)).length;
      const keys = new Set(friends.filter(friend => !isDevicePeer(friend.user_id)).map(friend => 'private:' + String(friend.user_id ?? '')));
      account.historyFailures ??= {};
      report.localOnly = this.d.localKeys().filter(key => !isDevicePeer(key.slice(8)) && !keys.has(key) && this.d.allowed(key)).length;
      for (const key of keys) {
        if (!this.d.ready()) { this.requested = true; break; }
        if (!/^private:\d+$/.test(key) || key === 'private:' + selfId || !this.d.allowed(key)) continue;
        report.contacts++;
        const retry = account.historyFailures[key];
        if (this.reason !== 'manual' && retry?.nextAt > this.now()) { report.cooldownSkipped++; continue; }
        try {
          const context = this.d.context(key);
          account.historyScans ??= {};
          const scan = account.historyScans[key] ??= {anchor: null, coverageHead: null, generation: 0};
          let anchor = scan.anchor ?? null, complete = false, head = scan.head ?? null;
          const pageIds = new Set();
          // Bounded history pages resume from the saved upstream anchor, even
          // across days. Timestamps never replace an unfinished page cursor.
          for (let page = 0; page < 20; page++) {
            await this.requireAccount(selfId);
            const result = await this.d.history(key, anchor), rows = result?.messages;
            await this.requireAccount(selfId);
            if (!Array.isArray(rows)) throw Error('History response missing messages');
            const fresh = rows.filter(message => {
              const id = String(message.message_id ?? message.msg_id ?? '');
              if (!id || pageIds.has(id)) return false;
              pageIds.add(id); return true;
            });
            head ??= fresh[0]?.message_id ?? fresh[0]?.msg_id ?? null;
            const incoming = pendingHistory(fresh, {selfId, peerId: key.slice(8), known: new Set(context.known || []), now: this.now()})
              .filter(message => !context.floor || message._historyAt >= context.floor);
            for (const message of incoming) {
              if (!this.d.ready() || !this.d.allowed(key)) {
                this.requested = true;
                throw Error('History discovery paused before durable receipt');
              }
              await this.persist(selfId, key, message);
              report.discovered++;
            }
            // Only durable receipt of the entire page permits saving its cursor.
            if (result.has_more === false || result.hasMore === false || rows.length === 0 ||
                (rows.length < 100 && result.has_more !== true && result.hasMore !== true) ||
                (scan.coverageHead && fresh.some(message => String(message.message_id ?? message.msg_id) === String(scan.coverageHead))) ||
                (context.floor && fresh.every(message => historyTime(message) < context.floor))) {
              complete = true; scan.coverageHead = head; scan.head = null; scan.anchor = null; scan.generation++;
              await this.checkpoint(); break;
            }
            if (!fresh.length) break;
            const oldest = fresh.slice().sort((a, b) => historyTime(a) - historyTime(b) || (Number(a.message_seq) || 0) - (Number(b.message_seq) || 0))[0];
            const next = result.next_anchor ?? result.nextAnchor ?? oldest.message_id ?? oldest.msg_id;
            if (String(next) === String(anchor)) break;
            anchor = String(next); scan.anchor = anchor; scan.head = head;
            await this.checkpoint();
          }
          if (!complete) { report.partial++; this.requested = true; }
          delete account.historyFailures[key];
          await this.checkpoint();
        } catch (error) {
          report.failed++;
          this.requested = true;
          const message = String(error.message);
          if (/failed to resolve UID for UIN/i.test(message)) {
            const failures = Math.min(5, (retry?.failures || 0) + 1);
            account.historyFailures[key] = {failures, nextAt: this.now() + Math.min(6 * 3600000, 30 * 60000 * 2 ** (failures - 1))};
          }
          this.d.log('[unread-review] contact scan failed', key, message.slice(0, 120));
        }
      }
      await this.drain();
      report.phase = report.failed || report.partial || report.cooldownSkipped || this.requested ? 'partial' : 'complete';
    } catch (error) {
      report.phase = 'deferred'; report.error = String(error.message).slice(0, 150); this.requested = true;
      this.d.log('[unread-review] scan deferred', report.error);
    }
    report.finishedAt = this.now();
    await this.checkpoint();
    this.d.log('[unread-review] scan', JSON.stringify(report));
    return this.status();
  }

  async drain() {
    if (this.draining || !this.receive || !this.d.ready() || !this.accountId) return;
    this.draining = true;
    try {
      await this.requireAccount(this.accountId);
      if (this.d.deliver) await this.d.deliver(this.accountId);
    } finally { this.draining = false; }
  }
}
