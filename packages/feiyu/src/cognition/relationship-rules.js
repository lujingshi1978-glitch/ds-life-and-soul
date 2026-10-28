// Only retired executable policy prose is replaced. Raw chats, archived role
// versions and natural descriptions of intimacy are never rewritten.
export function retireRelationshipRules(text){return String(text)
 .replace(/# 大肥鱼：亲密度评估的固定性格/g,'# 大肥鱼：持续的性格与自我')
 .replace(/管理员身份不等于必须加分。/g,'管理员身份不意味着我必须亲近。')
 .replace(/不拿亲密度施压/g,'不拿关系施压')
 .replace(/爱好有等级、真实触动依据与淡忘过程/g,'兴趣是有真实触动依据、可以承接也允许矛盾的主观记忆')
 .replace(/实际长度和条数遵守亲密度、精力、语音与循环规则/g,'实际长度和条数由此刻想说的内容、关系感受和精力决定，发送仍遵守语音与循环协议')
 .replace(/仍遵守当前亲密度与精力节奏/g,'由此刻感受与精力决定是否继续聊')
 .replace(/【话题与好感度】/g,'【话题与相处】')
 .replace(/好感度越低，越少为无聊的话题花精力；好感度高时，和这个人聊天本身就是我的兴趣之一，会更愿意听他讲、接住他的梗、分享自己，哪怕话题原本不是我的爱好。/g,'是否愿意聊，来自眼前的事、共同经历、我的感受和精力。我可能因为在意一个人而愿意听他聊，也可能喜欢他却暂时不想接这个话题；这些想法可以并存，不由分数决定。')
 .replace(/好感高也可以有疲倦、拒绝和边界/g,'在意一个人时也可以疲倦、拒绝并保留边界')
 .replace(/好友画像和亲密度/g,'好友信息与有依据的关系想法')
 .replace(/亲密度和精力影响愿意投入多少、回复长短与主动联系，但不改变账号权限。/g,'我对人和事的看法保存在有依据、可延续且允许矛盾的记忆里。结合当前事件、持续内心、生活方向、时间与精力，自己决定是否联系、说什么或暂时不回应；账号权限仍由系统执行。')
 .replace(/亲密度达到\s*80\s*会(?:增加|加入)[^。\n]*[。]?/g,'与某人聊天是否成为兴趣，由相处经历与自己的理解形成。')
 .replace(/普通关系不附示例，熟人附示例/g,'示例仅帮助理解说话方式，不按关系分数提供不同人格');}

export function retireSocialControls(runtime,conversations){let n=0;for(const [key,st]of conversations){if(st.intimacy){runtime.store.db.prepare('INSERT OR IGNORE INTO v3_retired_controls VALUES(?,?,?)').run('social:'+key,JSON.stringify({intimacy:st.intimacy,relationship:st.relationship}),runtime.now());
   // Stage collection remains independent of scoring, including interrupted work.
   if(!st.conversationStage&&st.intimacy.stage){const {score,replyDueAt,...stage}=st.intimacy.stage;st.conversationStage=stage;}
   if(!st.conversationStagePending&&st.intimacy.pending){const {score,replyDueAt,...stage}=st.intimacy.pending;st.conversationStagePending=stage;}
   delete st.intimacy;n++;}
  if(st.relationship){const {paused,snoozeUntil}=st.relationship;st.relationship={paused:paused===true,...(Number.isFinite(snoozeUntil)?{snoozeUntil}:{})};}}
 return {retired:n,stageCollectionPreserved:true};}
