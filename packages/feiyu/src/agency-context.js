// Present, bounded opportunities. This view grants no execution permission and
// does not read a provider, select an action, or manufacture a shared experience.
import {proactiveTargetAllowed} from './proactive-policy.js';
const clip=(v,n)=>[...String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ')].slice(0,n).join('').trim();
const at=v=>Number.isFinite(v)&&v>=0?v:0;
export function buildAutonomyOpportunities({now=Date.now(),execution={},ownerQQ,proactive={},internet={},applications={},platforms=[],contacts=[],readContactContext=()=>({})}={}){
 const blocked=[];
 if(execution.activeMode!==true)blocked.push('mode-inactive');
 if(execution.dshReady!==true)blocked.push('dsh-not-ready');
 if(execution.paused)blocked.push('paused');
 if(execution.sleeping)blocked.push('resting');
 if(execution.roleChanging)blocked.push('role-changing');
 const chatBlocked=[...blocked,...(execution.qqConnected===true?[]:['qq-not-connected']),...(proactive.enabled!==false?[]:['proactive-disabled'])];
 const browseBlocked=[...blocked,...(internet.enabled===true?[]:['internet-disabled']),...(applications.multiSiteActivity===true?[]:['multi-site-disabled'])];
 const candidates=chatBlocked.length?[]:contacts.filter(c=>/^private:\d+$/.test(c.key||'')&&c.allowed===true&&c.responseOnly!==true&&c.silent!==true&&!c.paused&&!(Number(c.snoozeUntil)>now)&&!c.unread&&proactiveTargetAllowed(c.key,ownerQQ,proactive));
 candidates.sort((a,b)=>Math.max(at(b.lastIncomingAt),at(b.lastOutgoingAt))-Math.max(at(a.lastIncomingAt),at(a.lastOutgoingAt))||a.key.localeCompare(b.key));
 const people=candidates.slice(0,6).map(c=>{
  let detail;try{detail=readContactContext(c.key)||{};}catch{detail={};}
  const recentTopic=clip(detail.recentTopic,120),lastInteractionAt=Math.max(at(c.lastIncomingAt),at(c.lastOutgoingAt));
  return {personId:'qq:'+c.key.slice(8),channel:c.key,relationshipCue:clip(detail.relationshipCue,120),...(clip(detail.label,40)?{label:clip(detail.label,40)}:{}),lastInteractionAt,lastIncomingAt:at(c.lastIncomingAt),lastOutgoingAt:at(c.lastOutgoingAt),...(recentTopic?{recentTopic}:{}),basis:{type:'recent-interaction',at:lastInteractionAt,text:recentTopic||'已有当前角色的互动记录；本轮是否联系由自己决定'},sourceRefs:(detail.sourceRefs||[]).slice(0,3).map(r=>({recordId:clip(r.recordId,160),at:at(r.at)})),observationOnly:true};
 });
 const enabledPlatforms=browseBlocked.length?[]:platforms.filter(p=>p.installed===true&&p.enabled===true&&p.available!==false&&Array.isArray(p.read)&&(p.read.includes('feed')||p.id==='web'&&p.read.includes('search')));
 const browse=enabledPlatforms.map(p=>({platform:p.id,modes:[...(p.read.includes('feed')?['feed']:[]),...(p.read.includes('search')?['search']:[]),...(p.read.includes('read')?['continue']:[])],basis:'现有已启用平台提供的探索路线，不代表已经看过内容',login:p.login||'unchecked',observationOnly:true}));
 return {version:1,at:now,available:people.length>0||browse.length>0,observationOnly:true,people,browse,topics:[],availability:{chat:{enabled:chatBlocked.length===0,eligibleCount:candidates.length,blockedBy:chatBlocked.length?chatBlocked:people.length?[]:['no-permitted-contact']},browse:{enabled:browseBlocked.length===0,platforms:browse.map(p=>p.platform),blockedBy:browseBlocked.length?browseBlocked:browse.length?[]:['no-installed-feed-platform']}},note:'候选和旧交流片段只作参考，不是本轮来信、未完任务或授权。可以探索、联系、休息或不行动；执行前仍刷新权限与拒绝边界。'};
}
