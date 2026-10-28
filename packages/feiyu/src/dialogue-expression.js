import fs from 'node:fs';
export const PUN_HINT='【理解玩梗】遇到字面古怪、故意错字或答非所问时，多试一个读音角度：同音近音、方言音译、拆字、反话或接前一句的梗；先在心里读一遍、比较上下文，不急着当新物品问用途。已有解释优先，最多考虑两种含义；不确定用试探语气核对，不编出处，不把所有正经话硬解释成梗，不输出推理过程。';
export const CROSS_CONTACT_HINT='【跨会话关联】当前角色的其他聊天也是自己的经历。被问及有没有被别人吐槽、如何接梗或相关经历时，先实际查本角色记忆/原文，再据证据概括自己的经历与感受。不用“别人的事、商业机密、不方便说”泛拒普通经历，也不能没查就声称读得到或记得。标清是谁、谁说的，不挪用承诺；真实敏感资料仍不外传。';
export class DialogueExpression {
 constructor(file){this.file=file;this.writable=true;this.data={enabled:false,focusPeers:[],events:[]};try{if(fs.existsSync(file))this.data={...this.data,...JSON.parse(fs.readFileSync(file,'utf8'))};}catch{this.writable=false;}}
 save(){if(!this.writable)return;fs.writeFileSync(this.file+'.tmp',JSON.stringify(this.data));fs.renameSync(this.file+'.tmp',this.file);}
 configure(p){if(!this.writable)throw Error('表达配置损坏，只读降级');if(p.enabled!==undefined&&typeof p.enabled!=='boolean')throw Error('enabled须为布尔值');if(p.focusPeers!==undefined&&(!Array.isArray(p.focusPeers)||p.focusPeers.length>20||p.focusPeers.some(v=>!/^\d+$/.test(v))))throw Error('重点学习QQ号无效');if(p.enabled!==undefined)this.data.enabled=p.enabled;if(p.focusPeers)this.data.focusPeers=[...new Set(p.focusPeers)];this.save();return this.status();}
 record(key,kind){this.data.events.push({key,kind,at:Date.now()});this.data.events=this.data.events.slice(-100);this.save();}
 status(){const events=this.data.events,total=events.length,reactions=events.filter(e=>e.kind==='reaction').length;return{enabled:this.data.enabled,focusPeers:this.data.focusPeers,total,reactions,share:total?reactions/total:0,advisoryOnly:true,minShare:null,due:false,writable:this.writable};}
 hint(){const s=this.status();return s.enabled?'【表情使用统计】最近'+s.total+'条实际发出消息中表情'+s.reactions+'条，QQ系统表情与收藏表情都计入。语境合适且想表达时可用qq_send_face或qq_send_sticker，也可以只说文字或不回应。严肃话题不强塞表情，不为补比例增加动作，收尾不受比例影响。\n':'';}
 // Compatibility for older callers: the counter never creates a send duty.
 needsReaction(){return false;}
}
