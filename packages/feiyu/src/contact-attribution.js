import {createHash} from 'node:crypto';

export const ATTRIBUTION_RULES='【人物与承诺归属】QQ号是人物主键，不能靠昵称、相似话题或熟悉感合并两个人。同一角色可记得并查询所有好友的经历；跨好友材料按scope和conversationPeerId认人，不能把来源好友换成当前对象。向某人归属承诺、欠账、礼物、约定必须有该人本人原话支持；肥鱼自己的旧回复只证明曾经说过，不证明对方承诺过。不得把自己曾说错的话整理成双方共同事实。已标记的归属更正优先于旧回复、画像和摘要。没有证据时查相关人物原文，仍不确定就不作肯定断言，不假装记得或用不方便说来掩盖没查。玩笑中的投喂、提议和已经兑现的话不能升级成现实欠款。';

// Role-local, contact-bound factual repairs. Not writable by chat tools.
export class ContactAttribution {
  constructor(store){
    this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS contact_attributions(id TEXT PRIMARY KEY,qq TEXT NOT NULL,topic TEXT NOT NULL,
      kind TEXT NOT NULL,statement TEXT NOT NULL,evidence_json TEXT NOT NULL,invalid_refs_json TEXT NOT NULL,at INTEGER NOT NULL);`);
  }
  add({scope,topic,kind='correction',statement,evidence,invalidRefs=[]}){
    if(!/^private:\d+$/.test(scope)||!['correction','supported'].includes(kind)||typeof topic!=='string'||!topic.trim()||topic.length>80||typeof statement!=='string'||!statement.trim()||statement.length>1000)throw Error('Invalid attribution correction');
    const qq=scope.slice(8);
    const resolve=ref=>{if(typeof ref!=='string'||!ref.startsWith('chat:'))throw Error('Attribution needs original chat evidence');const row=this.db.prepare('SELECT id,qq,role,body FROM chat_records WHERE id=? AND qq=?').get(ref.slice(5),qq);if(!row)throw Error('Attribution evidence contact mismatch');return row;};
    if(!Array.isArray(evidence)||!evidence.length||evidence.length>12||!evidence.map(resolve).some(r=>r.role==='user'))throw Error('Attribution cannot be supported by assistant echoes alone');
    if(!Array.isArray(invalidRefs)||invalidRefs.length>30||invalidRefs.map(resolve).some(r=>r.role!=='assistant'))throw Error('Only confirmed assistant misattributions may be disputed');
    const id='attribution:'+createHash('sha256').update(JSON.stringify([scope,topic,kind,statement,evidence,invalidRefs])).digest('hex').slice(0,24);
    this.db.prepare('INSERT OR IGNORE INTO contact_attributions VALUES(?,?,?,?,?,?,?,?)').run(id,qq,topic,kind,statement,JSON.stringify(evidence),JSON.stringify(invalidRefs),Date.now());
    return {id,scope,topic,kind,statement,evidence,invalidRefs};
  }
  list(scope){if(!/^private:\d+$/.test(scope))return[];return this.db.prepare('SELECT * FROM contact_attributions WHERE qq=? ORDER BY at DESC LIMIT 12').all(scope.slice(8)).map(r=>({id:r.id,scope:'private:'+r.qq,topic:r.topic,kind:r.kind,statement:r.statement,evidence:JSON.parse(r.evidence_json),invalidRefs:JSON.parse(r.invalid_refs_json)}));}
  context(scope){const rows=this.list(scope);return ATTRIBUTION_RULES+(rows.length?'\n【已核实的当前对象归属；优先于旧聊天摘要】\n'+JSON.stringify(rows.map(({invalidRefs,...r})=>r)):'\n没有归属条目不等于没有发生，需按当前QQ号查原文核实。')+'\n';}
  warning(scope,ref){return this.list(scope).find(r=>r.invalidRefs.includes(ref))?.statement||null;}
  sanitizePortrait(scope,p){
    const corrections=this.list(scope).filter(r=>r.kind==='correction');if(!corrections.length)return p;
    const valid=text=>{try{this.assertOutbound(scope,text);return true;}catch{return false;}};
    const clean=text=>String(text||'').split(/[。！？\n]/).filter(s=>s.trim()&&valid(s)).join('。');
    return {...p,summary:clean(p.summary)||'已有记录存在归属纠错，按本人原话继续了解。',interactionStyle:clean(p.interactionStyle),
      facts:p.facts.filter(f=>valid(f.text)),openTopics:p.openTopics.filter(t=>!corrections.some(r=>t.includes(r.topic)))};
  }
  assertOutbound(scope,text){
    const s=String(text||'');
    for(const row of this.list(scope)){
      if(row.kind!=='correction'||!s.includes(row.topic))continue;
      // Explicit retractions may acknowledge the old error without repeating it
      // as a demand. Ordinary mentions of the subject are not blocked.
      if(/不是你|不欠|不该.{0,12}(算|找|要)|记错|认错|弄错|搞错|别人|另一个|没承诺|没答应|被你.{0,8}纠正/.test(s))continue;
      if(/欠|账|承诺|答应|说好|约好|你那|你给|给我|等你|收到|还没.{0,8}(来|给|端)/.test(s))throw Error('人物归属校验未通过：'+row.statement+' 请核对当前对象原话，不要把自己的旧错误当作对方承诺。');
    }
  }
}
