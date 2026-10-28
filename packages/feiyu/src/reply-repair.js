// Archive presence is not a delivery receipt. Review unanswered local tails even
// when an old agent incorrectly cleared the in-memory unread buffer.
export class ReplyRepair {
  constructor(d) {
    this.d=d;this.db=d.store.db;this.running=false;this.report={phase:'waiting'};
    this.db.exec(`CREATE TABLE IF NOT EXISTS reply_repair_receipts(
      account TEXT NOT NULL,record_id TEXT NOT NULL,qq TEXT NOT NULL,status TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,retry_at INTEGER NOT NULL DEFAULT 0,error TEXT,
      delivery_receipt TEXT,delivered_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(account,record_id));
      CREATE INDEX IF NOT EXISTS reply_repair_pending ON reply_repair_receipts(account,status,retry_at);`);
    const columns=new Set(this.db.prepare('PRAGMA table_info(reply_repair_receipts)').all().map(row=>row.name));
    if(!columns.has('delivery_receipt'))this.db.exec('ALTER TABLE reply_repair_receipts ADD COLUMN delivery_receipt TEXT');
    if(!columns.has('delivered_at'))this.db.exec('ALTER TABLE reply_repair_receipts ADD COLUMN delivered_at INTEGER NOT NULL DEFAULT 0');
    this.migrateLegacy();
  }
  migrateLegacy(account=String(this.d.account()||'')){
    const bound=this.db.prepare("SELECT value FROM contact_meta WHERE key='reply-repair-account'").get()?.value;if(bound&&bound!==account)return;
    // Old archive rows have no proof of model attention. Keep them searchable,
    // but do not turn an upgrade into a mass replay of years of messages.
    if(!this.db.prepare("SELECT 1 FROM contact_meta WHERE key='inbound-legacy-migration'").get()){
      if(/^\d+$/.test(account)){
        const pending=new Set(this.d.legacyPending?.()||[]);
        this.db.exec('BEGIN IMMEDIATE');try{for(const row of this.db.prepare("SELECT id,qq,message_id FROM chat_records WHERE role='user'").all())if(!pending.has(row.id)&&!this.db.prepare("SELECT 1 FROM inbound_ledger WHERE (record_id=? OR peer=? AND message_id=?) AND decision='pending'").get(row.id,row.qq,row.message_id))this.db.prepare("INSERT OR IGNORE INTO reply_repair_receipts(account,record_id,qq,status,updated_at) VALUES(?,?,?,'legacy-unverified',?)").run(account,row.id,row.qq,this.now());this.db.prepare("INSERT INTO contact_meta VALUES('inbound-legacy-migration','1')").run();this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
      }
    }
  }
  now(){return this.d.now?.()??Date.now();}
  readAccount(){
    const account=String(this.d.account()||'');if(!/^\d+$/.test(account))return null;
    const owner=this.db.prepare("SELECT value FROM contact_meta WHERE key='reply-repair-account'").get()?.value;
    return owner&&owner!==account?null:account;
  }
  account(){
    const account=this.readAccount();if(!account)return null;
    const owner=this.db.prepare("SELECT value FROM contact_meta WHERE key='reply-repair-account'").get()?.value;
    if(owner&&owner!==account)return null; // Old role data cannot migrate to another logged-in QQ implicitly.
    if(!owner)this.db.prepare('INSERT INTO contact_meta VALUES(?,?)').run('reply-repair-account',account);
    this.migrateLegacy(account);return account;
  }
  status(){return {...this.report,running:this.running,receipts:this.db.prepare('SELECT status,count(*) count FROM reply_repair_receipts GROUP BY status').all()};}
  failedSend(key,error,{records}={}){
    const account=this.account();if(!account||!/^private:\d+$/.test(key))return;
    const permanent=/result=16|先添加对方为好友|被拉黑|拒收/.test(String(error));
    const uncertain=!permanent&&/timeout|timed out|ETIMEDOUT|ECONNRESET|超时|fetch failed|结果不明|result unknown|transport.*unknown|aborted/i.test(String(error));
    const reason=permanent?'QQ上游拒绝发送：非好友或拒收，需恢复好友关系后再审查':'发送工具失败，尚未确认成功';
    const rows=Array.isArray(records)?this.db.prepare("SELECT * FROM chat_records WHERE qq=? AND role='user' AND id IN (SELECT value FROM json_each(?))").all(key.slice(8),JSON.stringify(records.filter(Boolean))):this.db.prepare("SELECT * FROM chat_records c WHERE qq=? AND role='user' AND body NOT LIKE '/%' AND at>coalesce((SELECT max(at) FROM chat_records WHERE qq=c.qq AND role='assistant'),0)").all(key.slice(8));
    for(const row of rows)this.db.prepare(`INSERT INTO reply_repair_receipts(account,record_id,qq,status,attempts,updated_at,retry_at,error) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(account,record_id) DO UPDATE SET status=excluded.status,attempts=CASE WHEN excluded.status IN('blocked','unknown') THEN 3 ELSE max(1,attempts) END,updated_at=excluded.updated_at,retry_at=CASE WHEN excluded.status IN('blocked','unknown') THEN 0 ELSE max(retry_at,excluded.retry_at) END,error=excluded.error`)
      .run(account,row.id,row.qq,permanent?'blocked':uncertain?'unknown':'retry',permanent||uncertain?3:1,this.now(),permanent||uncertain?0:this.now()+120000,reason);
    this.d.log?.('reply-repair',{key,action:permanent?'blocked':uncertain?'receipt-review':'retry',reason});
  }
  assertCanAcknowledge(key,records){
    // This is a preflight: in particular, do not call account(), which may write
    // account binding or migration metadata before the caller clears unread.
    const account=this.readAccount();if(!account||!/^private:\d+$/.test(key))return true;
    for(const id of new Set(records.filter(Boolean))){
      const row=this.db.prepare("SELECT r.status,r.error FROM reply_repair_receipts r JOIN chat_records c ON c.id=r.record_id WHERE r.account=? AND r.record_id=? AND r.qq=? AND c.qq=? AND c.role='user'").get(account,id,key.slice(8),key.slice(8));
      if(row&&(row.error||['retry','failed','unknown'].includes(row.status)))throw Object.assign(Error('QQ_DELIVERY_UNRESOLVED: 发送失败或送达结果未确认，不能把这批来信标为已处理'),{code:'QQ_DELIVERY_UNRESOLVED',statusCode:409});
    }
    return true;
  }
  confirmDelivered(key,records,receipt){
    const raw=receipt?.messageId;
    const messageId=typeof raw==='number'&&Number.isSafeInteger(raw)?String(raw):typeof raw==='string'?raw.trim():'';
    if(!receipt||receipt.status==='unknown'||receipt.ok===false||!/^\-?\d+$/.test(messageId)||/^\-?0+$/.test(messageId))throw Object.assign(Error('INVALID_QQ_DELIVERY_RECEIPT'),{code:'INVALID_QQ_DELIVERY_RECEIPT',statusCode:400});
    const account=this.readAccount();if(!account||!/^private:\d+$/.test(key))return 0;
    const rows=[];
    for(const id of new Set(records.filter(Boolean))){
      const row=this.db.prepare("SELECT id,qq,message_id FROM chat_records WHERE id=? AND qq=? AND role='user'").get(id,key.slice(8));
      if(!row)throw Object.assign(Error('DELIVERY_RECORD_SCOPE_MISMATCH'),{code:'DELIVERY_RECORD_SCOPE_MISMATCH'});
      if(!row.message_id||!this.db.prepare('SELECT 1 FROM inbound_seen WHERE account=? AND peer=? AND message_id=?').get(account,row.qq,row.message_id))throw Object.assign(Error('UNSEEN_INBOUND_DELIVERY'),{code:'UNSEEN_INBOUND_DELIVERY'});
      rows.push(row);
    }
    if(!rows.length)return 0;
    this.account();
    const at=this.now(),proof=JSON.stringify({channel:key,messageId});
    this.db.exec('BEGIN IMMEDIATE');
    try{
      for(const row of rows)this.db.prepare(`INSERT INTO reply_repair_receipts(account,record_id,qq,status,updated_at,retry_at,error,delivery_receipt,delivered_at) VALUES(?,?,?,'delivered',?,0,NULL,?,?)
        ON CONFLICT(account,record_id) DO UPDATE SET status='delivered',updated_at=excluded.updated_at,retry_at=0,error=NULL,delivery_receipt=excluded.delivery_receipt,delivered_at=excluded.delivered_at`).run(account,row.id,row.qq,at,proof,at);
      this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    return rows.length;
  }
  acknowledge(key,records){
    this.assertCanAcknowledge(key,records);
    const account=this.account();if(!account||!/^private:\d+$/.test(key))return;
    for(const id of new Set(records.filter(Boolean))){
      const row=this.db.prepare("SELECT id,at,qq FROM chat_records WHERE id=? AND qq=? AND role='user'").get(id,key.slice(8));if(!row)continue;
      const entry=this.db.prepare('SELECT message_id,peer FROM inbound_ledger WHERE record_id=? AND account=?').get(id,account);if(entry&&!this.db.prepare('SELECT 1 FROM inbound_seen WHERE account=? AND peer=? AND message_id=?').get(account,entry.peer,entry.message_id))continue;
      const delivery=this.db.prepare('SELECT status,delivery_receipt,delivered_at FROM reply_repair_receipts WHERE account=? AND record_id=?').get(account,id);
      const replied=['delivered','answered'].includes(delivery?.status)&&!!delivery.delivery_receipt&&delivery.delivered_at>0;
      this.db.prepare(`INSERT INTO reply_repair_receipts(account,record_id,qq,status,updated_at) VALUES(?,?,?,?,?)
        ON CONFLICT(account,record_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at,retry_at=0,error=NULL`)
        .run(account,id,row.qq,replied?'answered':'reviewed-no-reply',this.now());
    }
  }
  async tick({force=false}={}){
    if(this.running||!this.d.ready())return {...this.status(),skipped:true};
    const account=this.account();if(!account)return {...this.status(),skipped:true,reason:'QQ account unavailable or changed'};
    this.running=true;
    const report=this.report={phase:'scanning',startedAt:this.now(),force,contacts:0,messages:0,scheduled:0,busy:0,backoff:0,blocked:0,failed:0};
    try{
      this.scanCursor??=Number(this.db.prepare('SELECT value FROM contact_meta WHERE key=?').get('reply-scan:'+account)?.value)||0;
      const rows=this.db.prepare(`SELECT c.* FROM chat_records c LEFT JOIN reply_repair_receipts r ON r.record_id=c.id AND r.account=? WHERE c.role='user' AND c.at>=? AND (c.body<>'' OR c.media_json<>'[]') AND c.body NOT LIKE '/%'
        AND NOT EXISTS(SELECT 1 FROM inbound_ledger l WHERE l.account=? AND (l.record_id=c.id OR l.peer=c.qq AND l.message_id=c.message_id) AND l.decision<>'pending')
        AND (r.status IS NULL OR r.status NOT IN ('answered','delivered','unknown','reviewed-no-reply','legacy-unverified')) AND (?=1 OR (coalesce(r.attempts,0)<3 AND coalesce(r.retry_at,0)<=?)) AND c.rowid>? ORDER BY c.rowid LIMIT 256`).all(account,this.d.store.notBefore||0,account,force?1:0,this.now(),this.scanCursor||0);
      this.scanCursor=rows.length===256?this.db.prepare('SELECT rowid n FROM chat_records WHERE id=?').get(rows.at(-1).id).n:0;
      report.blocked=this.db.prepare("SELECT count(*) n FROM reply_repair_receipts WHERE account=? AND attempts>=3 AND status NOT IN ('answered','delivered','reviewed-no-reply')").get(account).n;
      this.db.prepare('INSERT OR REPLACE INTO contact_meta VALUES(?,?)').run('reply-scan:'+account,String(this.scanCursor));
      const groups=new Map();
      for(const row of rows){
        const key='private:'+row.qq;if(!this.d.allowed(key))continue;
        const receipt=this.db.prepare('SELECT * FROM reply_repair_receipts WHERE account=? AND record_id=?').get(account,row.id);
        if(!force){
          if(receipt&&['answered','delivered','reviewed-no-reply'].includes(receipt.status))continue;
          if(receipt?.retry_at>this.now()||this.now()-row.at<(this.d.graceMs??45000)){report.backoff++;continue;}
          if(receipt?.attempts>=3){this.db.prepare("UPDATE reply_repair_receipts SET status='blocked' WHERE account=? AND record_id=?").run(account,row.id);report.blocked++;continue;}
        }
        const list=groups.get(key)||[];list.push(row);groups.set(key,list);
      }
      for(const [key,records]of groups){
        if(!this.d.ready())break;
        report.contacts++;report.messages+=records.length;
        if(this.d.busy(key)){report.busy++;continue;}
        try{
          const queued=await this.d.enqueue(key,records);if(!queued.length)continue;
          for(const row of queued){
            const old=this.db.prepare('SELECT attempts FROM reply_repair_receipts WHERE account=? AND record_id=?').get(account,row.id);
            const attempts=force?1:(old?.attempts||0)+1;
            this.db.prepare(`INSERT INTO reply_repair_receipts(account,record_id,qq,status,attempts,updated_at,retry_at,error) VALUES(?,?,?,?,?,?,?,NULL)
              ON CONFLICT(account,record_id) DO UPDATE SET status=excluded.status,attempts=excluded.attempts,updated_at=excluded.updated_at,retry_at=excluded.retry_at`)
              .run(account,row.id,row.qq,'queued',attempts,this.now(),this.now()+[120000,300000,900000][Math.min(attempts-1,2)]);
          }
          if(!this.d.wake(key))throw Error('Recovered messages were not scheduled');report.scheduled++;
          this.d.log?.('reply-repair', {key,messages:queued.length,action:'scheduled',manual:force});
        }catch(error){report.failed++;this.d.log?.('reply-repair',{key,action:'failed',error:String(error.message).slice(0,160)});}
      }
      report.phase=report.failed||report.busy||report.blocked?'partial':'complete';
    }finally{report.finishedAt=this.now();this.running=false;}
    return this.status();
  }
}
