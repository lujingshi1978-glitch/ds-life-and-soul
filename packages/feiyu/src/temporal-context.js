// A read-only temporal envelope. Only transport/program timestamps are accepted;
// never parse dates from a peer's text or infer feelings from an elapsed interval.
export const TEMPORAL_ZONE='Asia/Shanghai';
const MIN_STAMP=Date.UTC(2000,0,1),MINUTE=60000;
const clockFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:TEMPORAL_ZONE,
  year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const weekdayFormatter=new Intl.DateTimeFormat('zh-CN',{timeZone:TEMPORAL_ZONE,weekday:'long'});
const stamp=value=>typeof value==='number'&&Number.isFinite(value)&&value>=MIN_STAMP&&value<=8640000000000000?value:null;
const period=hour=>hour<6?'凌晨':hour<9?'早晨':hour<12?'上午':hour<14?'中午':hour<18?'下午':'晚上';

function clock(at){
  const parts=Object.fromEntries(clockFormatter.formatToParts(at).map(p=>[p.type,p.value]));
  const hour=Number(parts.hour);
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`,
    weekday:weekdayFormatter.format(at),period:period(hour),restWindow:hour<8};
}

export function temporalEnvelope({now=Date.now(),state}={}){
  const nowAt=stamp(now);
  if(nowAt===null)return {timeZone:TEMPORAL_ZONE,nowAt:null,clock:null,clockAnomaly:true};
  let clockAnomaly=false;
  const timeOf=value=>{
    const at=stamp(value);
    if(at===null)return null;
    if(at>nowAt){if(at-nowAt>2*MINUTE)clockAnomaly=true;return null;}
    return at;
  };
  const messageTime=m=>timeOf(m?.time??m?.at);
  const recent=(Array.isArray(state?.recentMessages)?state.recentMessages:[]).slice(-200);
  const unread=(Array.isArray(state?.unread)?state.unread:[]).slice(-100).filter(m=>m&&m.isSelf!==true);
  const current=unread.map(m=>({message:m,at:messageTime(m)})).filter(m=>m.at!==null);
  const allCurrentTimes=current.map(m=>m.at);
  const firstAt=allCurrentTimes.length?Math.min(...allCurrentTimes):null;
  const latestAt=allCurrentTimes.length?Math.max(...allCurrentTimes):null;
  const unreadIds=new Set(unread.flatMap(m=>[
    Number.isSafeInteger(m.seq)&&m.seq>0?`seq:${m.seq}`:null,
    m.messageId!=null&&String(m.messageId)?`id:${m.messageId}`:null,
  ]).filter(Boolean));
  const isPending=m=>unread.includes(m)||(Number.isSafeInteger(m.seq)&&unreadIds.has(`seq:${m.seq}`))||
    (m.messageId!=null&&unreadIds.has(`id:${m.messageId}`));
  const visible=recent.map(message=>({message,at:messageTime(message)})).filter(m=>m.at!==null);
  const beforeBatch=visible.filter(m=>!isPending(m.message)&&(firstAt===null||m.at<firstAt));
  const latest=items=>items.length?Math.max(...items):null;
  let previousIncomingAt=latest(beforeBatch.filter(m=>m.message.isSelf===false).map(m=>m.at));
  const incomingFallback=timeOf(state?.lastIncomingAt);
  if(previousIncomingAt===null&&incomingFallback!==null&&(firstAt===null||incomingFallback<firstAt))previousIncomingAt=incomingFallback;
  let previousInteractionAt=latest(beforeBatch.filter(m=>typeof m.message.isSelf==='boolean').map(m=>m.at));
  const lastSentAt=latest([timeOf(state?.lastAiReplyAt),...visible.filter(m=>m.message.isSelf===true).map(m=>m.at)].filter(v=>v!==null));
  if(lastSentAt!==null&&(firstAt===null||lastSentAt<firstAt))previousInteractionAt=Math.max(previousInteractionAt??0,lastSentAt);
  if(previousIncomingAt!==null)previousInteractionAt=Math.max(previousInteractionAt??0,previousIncomingAt);
  return {timeZone:TEMPORAL_ZONE,nowAt,clock:clock(nowAt),clockAnomaly,
    pending:current.length?{count:current.length,firstAt,latestAt,oldestAgeMs:nowAt-firstAt,latestAgeMs:nowAt-latestAt}:null,
    previousIncoming:previousIncomingAt===null?null:{at:previousIncomingAt,agoMs:nowAt-previousIncomingAt},
    previousInteraction:previousInteractionAt===null?null:{at:previousInteractionAt,agoMs:nowAt-previousInteractionAt},
    conversationGapMs:firstAt!==null&&previousInteractionAt!==null?firstAt-previousInteractionAt:null,
    lastSent:lastSentAt===null?null:{at:lastSentAt,agoMs:nowAt-lastSentAt}};
}

export function elapsedText(ms){
  if(!Number.isFinite(ms)||ms<0)return null;
  if(ms<MINUTE)return '不到1分钟';
  if(ms<60*MINUTE)return `${Math.floor(ms/MINUTE)}分钟`;
  if(ms<24*60*MINUTE){const hours=Math.floor(ms/(60*MINUTE)),minutes=Math.floor(ms/MINUTE)%60;return `${hours}小时${minutes?`${minutes}分钟`:''}`;}
  const days=Math.floor(ms/(24*60*MINUTE)),hours=Math.floor(ms/(60*MINUTE))%24;
  return `${days}天${hours?`${hours}小时`:''}`;
}

export function temporalContext({now=Date.now(),state,compact=false,nightRestEnabled=true,nightWindow}={}){
  const e=temporalEnvelope({now,state});
  if(!e.clock)return '【时间情境】当前系统时钟不可用；不推算间隔，未回复不能证明对方拒绝或伤心。自己的感受结合已有期待和活动理解，允许无聊或失落，不凭空生成情绪。';
  const c=e.clock,lines=[`【时间情境】${c.date} ${c.time} ${c.weekday} ${c.period}（${TEMPORAL_ZONE}）`];
  if(e.pending){
    const p=e.pending;
    if(p.oldestAgeMs>=5*MINUTE){
      const start=clock(p.firstAt),end=clock(p.latestAt);
      // Legacy state does not distinguish platform send time from its receive-time
      // fallback, so label it a record time, never promise precise original time.
      lines.push(`本批来信记录时间${start.date} ${start.time}${p.latestAt!==p.firstAt?`～${end.date} ${end.time}`:''}；最早距今${elapsedText(p.oldestAgeMs)}${p.latestAt!==p.firstAt?`，最近距今${elapsedText(p.latestAgeMs)}`:''}。旧消息的“今天/刚才”不自动算成处理时的现在，准确发送时间以原文为准。`);
    }else lines.push(`本批最近来信距今${elapsedText(p.latestAgeMs)}。`);
    if(e.conversationGapMs!==null&&e.conversationGapMs>=(compact?30:5)*MINUTE)
      lines.push(`本批开始距上次可见互动${elapsedText(e.conversationGapMs)}。`);
  }
  if(!compact&&e.previousIncoming?.agoMs>=5*MINUTE)lines.push(`${e.pending?'本批之前的':'可见的最近一次'}来信距今${elapsedText(e.previousIncoming.agoMs)}。`);
  if(!e.pending&&e.lastSent?.agoMs>=(compact?30:5)*MINUTE)lines.push(`上次已发回复距今${elapsedText(e.lastSent.agoMs)}。`);
  if(e.clockAnomaly)lines.push('部分记录时间晚于当前时钟，已略去异常间隔；不据此判断久别或失联。');
  if(nightRestEnabled&&(nightWindow?.night??c.restWindow))lines.push('当前处于'+(nightWindow?.hours||'00:00–08:00')+'休息时段；实际收发由系统控制。');
  lines.push('时间帮助接续、久别或休息；未回复不能证明对方拒绝或伤心。自己的感受结合已有期待和活动理解，允许无聊或失落，不凭空生成情绪，不自动追问，不汇报计时。');
  return lines.join('\n');
}
