// Read-only, role-local topic material. It never creates memories or sends messages.
export function selfTopicContext({scope,coreFields=[],hobbies=[],state={},experiences=[],behaviors=[],recentOwn=[],incoming='',score=45,threshold=60,reason='private',proactiveRound,now=Date.now(),compact=false}){
 const asked=/你(?:最近|现在|刚才)?(?:在干|喜欢|想聊|想看|想干|有啥|有什么)|你呢|说说你|聊点你的|最近怎么样/.test(incoming);
 const farewell=/^(?:那我)?(?:先)?(?:晚安|拜拜|睡了|再见|不聊了|去忙了)[啊呀啦哦吧。!！~～\s]*$/.test(incoming.trim());
 const focused=/帮我|解题|题目|求解|解释一下|先别换话题|急事|我很难受|我好难过/.test(incoming);
 const check=(reason==='proactiveCheck'&&(!proactiveRound||proactiveRound>=3))||['timeout','replyCheck','unansweredRepair','startupUnread'].includes(reason);
 const opportunity=!farewell&&!check&&(asked||(!focused&&score>=threshold));
 const interests=coreFields.filter(r=>/^(interest|hobby|taste)(?:[_-]|$)/.test(r.id)).slice(0,6).map(r=>({id:r.id,text:r.body,source:'core-interest'}));
 const seed=coreFields.find(r=>r.id==='identity')?.body.match(/【兴趣与自己的话题】([\s\S]*?)(?=\n\n|$)/)?.[1];
 if(seed)interests.unshift(...seed.split('。')[0].split('，').filter(t=>t.trim()).slice(0,4).map((text,i)=>({id:'identity-interest-'+i,text:text.trim(),source:'role-card-initial-interests'})));
 interests.unshift(...hobbies.filter(h=>h.level>0).slice(0,8).map(h=>({id:h.id,text:h.topic+' · '+h.label,source:'character-hobby',peer:h.peer,level:h.level})));
 const feelings=experiences.filter(e=>['like','dislike','mixed'].includes(e.preference)&&e.confidence>=.5).slice(0,3).map(e=>({id:e.id,scope:e.scope,subject:e.subject,feeling:e.feeling,preference:e.preference,source:e.source,at:e.at}));
 const recent=[];const seen=new Set();for(const event of behaviors){if(event.at<now-90*60000)continue;const b=event.before;if(!b?.id||['idle','chat'].includes(b.kind)||b.id===event.after?.id||seen.has(b.id))continue;seen.add(b.id);recent.push({id:b.id,scope:b.scope,kind:b.kind,label:b.label,at:event.at,note:'运行记录只证明参与过这项活动，不证明成功或学会了具体知识'});if(recent.length===2)break;}
 const repeatedRest=recentOwn.slice(-3).some(t=>/困|瘫|犯懒|发呆|躺着/.test(t));
 const casual=/无聊|在吗|嗨|你好|随便聊|你说|聊点|没啥事|没什么事/.test(incoming);
 const asksActualPastActivity=/刚.*(?:看|刷|学|睡)|看了什么|刷了什么|睡醒|睡过|学会/.test(incoming);
 const history=recentOwn.join('\n');const overlap=text=>{const words=String(text).match(/[\p{Script=Han}]{2,}/gu)||[];let n=0;for(const w of words)for(let i=0;i<w.length-1;i++)if(history.includes(w.slice(i,i+2)))n++;return n;};
 const selectedInterest=[...interests].sort((a,b)=>overlap(a.text)-overlap(b.text))[0];
 const preferredTopic=asked&&recent.length?{kind:'actual-recent-activity',material:recent[0]}:selectedInterest?{kind:'core-interest',material:selectedInterest}:feelings.length?{kind:'explicit-own-feeling',material:feelings[0]}:null;
 const openOwnTopicNow=opportunity&&!!preferredTopic&&(asked||casual);
 const data={currentContact:scope,opportunity,openOwnTopicNow,preferredTopic,asksActualPastActivity,invitedToTalkAboutSelf:asked,interests,ownFeelings:feelings,recentActivities:recent,
   energy:state.energy,mood:state.mood,psychologicalSource:state.psychologicalScope,restIsGrounded:state.energy<.35,restAlreadyMentioned:repeatedRest,
   recentOwnPhrases:recentOwn.slice(-4).map(t=>String(t).slice(0,120))};
 const guidance='你有自己的兴趣、情绪和想聊的内容，不必每轮等对方出题、复述对方再反问。opportunity=true时，闲聊、寒暄、话题到头或被问近况，可自然抛一个自己在意的具体小话头，分享一点感受或吐槽，再让对方选择接不接；不用总问“你想聊什么”。同一轮最多带一个自己的话题，不要求每轮都带。opportunity=false时先照顾对方本轮事情或收尾，不另找理由补发。\n'
  +'openOwnTopicNow=true表示本轮已经选定自己的话题入口：按preferredTopic先说出自己对它的一个具体小想法、偏好或好奇点，或一条有证据的近况；可以搭一句对方容易接的话，但不能把话题起头全交给对方。具体话头放在第一条完整消息里，不先单发“无聊啊/那正好”等铺垫；精力低、预算只有一条时也能用一句短话表达自己的想法，不靠增加条数。只说“没干嘛/瘫着/你呢/你说点啥/想聊什么”不算抛出自己的话题；不要列兴趣清单或照读设定。兴趣小想法可以是当下形成的看法，不必伪装成刚看过的具体案例。\n'
  +'asksActualPastActivity=true时，对方在问实际发生过的事，不能用兴趣代替证据。本快照的兴趣条目不证明刚刷过怪图或视频；没有具体的活动记录、回忆或工具结果，就直接说明没有可确认的那段观看/学习经历，或说眼下想看什么。不能先默认自己刚做过，再用“具体记不清”“反正不正经”等话掩盖证据缺口。若确有其他活动可照实说，但不捏造具体结果。\n'
  +'先用实际核心兴趣、明确的自身感受或最近活动。兴趣只证明喜欢或想了解，可以说“我有点想看看/琢磨”，不证明已经做过。活动记录只证明参与过，未知结果不说学会、看完或做成了；没有资料不能编造刚解过题、刷过视频、吃饭、睡醒或做梦。正在休息可以说想歇会；低精力可以说困或懒，但不等于真实睡过。后台整理不是生活中不断发生的新鲜大事，不报队列、数据库和任务完成进度。restAlreadyMentioned=true时别再把困、瘫着当万能回复。\n'
  +'有兴趣但缺少具体材料时，可以按需用已启用的搜索、浏览或回忆工具了解，再分享实际读到的东西；不用每轮检索，没有工具结果就只表达好奇，不能编造近期新闻、视频或学习成果。自己和别人聊天带来的感受可以延续，scope仍指向实际来源人，不把别人的话或承诺归给当前好友。对方认真求助、难过或告别时别硬扯爱好；不靠卖惨、索要照顾或连发追问维持话题。仍遵守亲密度、精力、发送预算和主动联系授权。\n';
 if(compact){
   data.interests=data.interests.slice(0,2).map(x=>({text:String(x.text).slice(0,100),peer:x.peer}));
   data.ownFeelings=data.ownFeelings.slice(0,1).map(x=>({scope:x.scope,subject:String(x.subject).slice(0,60),feeling:String(x.feeling).slice(0,100),preference:x.preference}));
   data.recentActivities=data.recentActivities.slice(0,1).map(x=>({scope:x.scope,kind:x.kind,label:x.label}));
   data.recentOwnPhrases=data.recentOwnPhrases.slice(-2).map(x=>x.slice(0,60));
   if(data.preferredTopic){const m=data.preferredTopic.material;data.preferredTopic={kind:data.preferredTopic.kind,material:{scope:m.scope,peer:m.peer,text:String(m.text||m.feeling||m.label||'').slice(0,120)}};}
   for(const field of ['recentOwnPhrases','interests','ownFeelings','recentActivities'])while(data[field].length&&JSON.stringify(data).length+guidance.length>2350)data[field].pop();
 }
 return '【自己的话题与生活连续性】\n'+JSON.stringify(data)+'\n'+guidance;

}
