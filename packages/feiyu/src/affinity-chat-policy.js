import {canonicalQQToolName} from '../plugins/qq-agent-presets/qq-tool-restrict.mjs';
const TIERS=[
 {min:0,name:'疏远',effort:'low',activityChars:0,portraitChars:100,stateChars:160,hobbyLimit:3,phraseChars:220,snapshotChars:1400,recent:2,knowledgeChars:0,selfTopics:false},
 {min:40,name:'普通',effort:'low',activityChars:450,portraitChars:240,stateChars:260,hobbyLimit:5,phraseChars:350,snapshotChars:2200,recent:4,knowledgeChars:0,selfTopics:false},
 {min:60,name:'熟悉',effort:'high',activityChars:1200,portraitChars:500,stateChars:600,hobbyLimit:10,phraseChars:600,snapshotChars:3200,recent:6,knowledgeChars:900,selfTopics:true},
 {min:80,name:'亲近',effort:'high',activityChars:2400,portraitChars:800,stateChars:1000,hobbyLimit:20,phraseChars:1000,snapshotChars:4500,recent:10,knowledgeChars:1800,selfTopics:true},
 {min:95,name:'深厚',effort:'max',activityChars:4000,portraitChars:1000,stateChars:1000,hobbyLimit:35,phraseChars:1000,snapshotChars:6000,recent:16,knowledgeChars:2400,selfTopics:true},
];
export function innerChatPolicy(incoming='',{messageCount=1,hasSticker=false}={}){const nuanced=messageCount>=3||/收回|说过|你.{0,10}说我|刚才那句|不是那个意思|我没(?:有)?/.test(incoming)||/不是.{0,20}(?:生气|讨厌|怪你)|你(?:是不是|真的|还会|有没有)|(?:难受|委屈|失望|不想活|别误会)|(?:什么意思|什么梗|谐音|反话)/.test(incoming)||(hasSticker&&/生气|难过|算了|没事|别说了/.test(incoming));return {version:1,name:'内心与当前事件',selection:'inner-v3',effort:/收回|我(?:什么时候|哪句|哪里)说|你(?:刚才)?(?:哪句|什么时候)说/.test(incoming)?'max':nuanced||/解释|分析|为什么|怎么办|解题|题目|答案/.test(incoming)?'high':'low',stateChars:1000,activityChars:800,phraseChars:1000,portraitChars:600,hobbyLimit:10,snapshotChars:4500,recent:6,knowledgeChars:0,selfTopics:false,bili:true,recall:true,web:true,qzone:true,images:true,learning:true};}
export function affinityChatPolicy(score=45,incoming='',hasImages=false,hasForward=false){
 const n=Number(score),value=Number.isFinite(n)?Math.max(0,Math.min(100,n)):45;
 const tier=[...TIERS].reverse().find(t=>value>=t.min);const text=String(incoming).slice(-3000);
 return {...tier,version:1,score:value,bili:!!hasForward||/\[卡片消息\]|B站|哔哩哔哩|视频|转发|bilibili\.com|b23\.tv|BV[0-9A-Za-z]{10}/.test(text),recall:value>=60||/其他会话|别的好友|其他人|跨会话|骂你|吐槽你|记得|记不记|回忆|之前|上次|以前|历史|承诺|还记|说过/.test(text),web:value>=80||/https?:\/\/|查一下|搜一下|搜索|查查|查资料|上网|贴吧|知乎|小红书|微博|抖音|YouTube|youtube|最新|新闻|天气|下雨|现在.*(?:价格|版本|结果)|解释|解题|题目|答案/.test(text),qzone:value>=80||/动态|空间|说说|主页|qzone\.qq\.com/.test(text),images:hasImages||/图片|这张图|表情包|截图|照片|附件|文件|PDF|pdf|Word|word|文档|动图|视频/.test(text),learning:value>=80||/学一下|学这个|什么意思|什么梗|查意思|谐音|同音|读音|方言/.test(text)};
}
export function validateChatPolicy(p){return p&&p.version===1&&(p.bili===undefined||typeof p.bili==='boolean')&&(p.selection==='inner-v3'||Number.isFinite(p.score)&&p.score>=0&&p.score<=100)&&['low','high','max'].includes(p.effort)&&['recall','web','qzone','images','learning'].every(k=>typeof p[k]==='boolean');}
const basic=new Set(['qq_send_message','qq_reply','qq_send_burst','qq_mark_read','qq_get_unread_messages','qq_get_recent_messages','qq_wait_for_messages','qq_set_wake_config','qq_send_voice','qq_list_voices','qq_send_sticker','qq_send_face','qq_list_stickers','qq_get_sticker_image','qq_sticker_note','qq_send_poke','qq_social_state','qq_get_prompt','qq_update_mind_state']);
export function affinityToolAllowed(name,p,args){
 if(!p)return true;if(!validateChatPolicy(p))return false;
 const original=String(name).split('__').at(-1),canonical=canonicalQQToolName(name,args);
 // Assembly has no call arguments. Keep the combined schema if one of its
 // existing operations is visible, then classify actual arguments at execution.
 if(original==='qq_self_change'&&args===undefined)return canonicalQQToolName(name,{operation:'status'})!==null;
 if(['qq_self_change','qq_self_change_skill'].includes(original)&&!canonical)return false;
 const n=canonical??original;
 if(basic.has(n)||n==='qq_report_problem'||n==='qq_create_capability')return true;
 if(['qq_get_forward_msg','qq_get_message_detail'].includes(n))return p.bili===true||p.images||p.recall;
 if(n==='qq_read_file')return p.images||p.bili===true;
 if(n==='qq_social_read')return p.web||p.bili===true;
 if(['qq_read_webpage','qq_content_sources'].includes(n))return p.web;
 if(n==='qq_social_action')return p.web||p.bili===true;
 if(['qq_start_work','qq_work_status','qq_wechat_desktop'].includes(n))return true;
 if(['qq_read_bili_video','qq_bili_skill'].includes(n))return p.bili===true||p.web===true;
 if(p.images&&/^qq_get_(?:message_images|image|forward)/.test(n))return true;
 if(p.recall&&['qq_recall','qq_knowledge_recall','qq_search_resources','qq_read_resource','qq_memory_expand'].includes(n))return true;
 if(p.web&&(/^mcp__web-search-safe__/.test(name)||/^qq_(?:web_|search_web|fetch_url)/.test(n)))return true;
 if(p.qzone&&(/^qq_get_qzone_/.test(n)||n==='qq_comment_qzone'))return true;
 if(p.learning&&/^qq_(?:learning_|learn$|hobby_|record_experience|update_mind_state)/.test(n))return true;
 return false;
}
export function affinityPolicyHint(p){if(p?.selection==='inner-v3')return '【本轮投入】按话题需要与当下精力接话，关系态度和兴趣保留真实依据与矛盾，不用分数决定是否回应。已有材料够用就直接聊，涉及旧事或事实再调用工具。可以不想聊，但不要机械敷衍陌生人。\n';return `【本轮投入】${p.name}档，思考${p.effort}。${p.score<60?'普通闲聊直接接当前话，不为寒暄检索旧记录、上网或学习；问到旧事才查，不能假装记得。':'结合已提供的状态和关系接话，背景足够就不重复查。'}需要事实、图片、语音或旧事时使用本轮已开放的对应工具；没有结果就说不确定，不能编造。亲密度决定投入，不扩大账号权限。\n`;}
