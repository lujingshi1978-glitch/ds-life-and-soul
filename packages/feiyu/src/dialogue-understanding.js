// Organize transport fragments without guessing intent or changing source records.
export function dialogueBlocks(messages, {gapMs=90000}={}) {
  const blocks=[];
  for (const m of messages) {
    const speaker=m.isSelf||m.role==='assistant'?'self':String(m.userId||m.sender?.user_id||m.senderId||m.role||'peer');
    const time=Number(m.time??m.at??m.timestamp??0),at=time>0&&time<1e11?time*1000:time;
    const previous=blocks.at(-1);
    if(previous&&previous.speaker===speaker&&(!at||!previous.at||at-previous.at>=0&&at-previous.at<=gapMs)) {
      previous.messages.push(m);previous.at=at||previous.at;
    } else blocks.push({speaker,at,messages:[m]});
  }
  return blocks;
}

// New fragments slide a quiet window; duplicates cannot postpone it forever.
// A retry deadline always wins over the normal burst cap.
export function planDialogueBatch(previous,{now,seq,quietMs=2500,maxWaitMs=12000,notBefore=now}={}) {
  if(previous&&seq<=previous.seq)return previous;
  const firstAt=previous?.firstAt??now;
  return {firstAt,seq,dueAt:Math.max(notBefore,Math.min(now+quietMs,firstAt+maxWaitMs))};
}

export const DIALOGUE_REFERENCE_HINT='【发言回指】聊天记录的role=user是对方说的，role=assistant才是自己说的。对方的澄清、否认、“你刚才说……”只是他此刻的表述，不证明自己确实说过被否认的话。提到“我刚才说的”“收回那句”时，所指须有自己的原话支持；语境推测与明确说过分开。自己后来一句“那我收回”也不能自证更早确有那句指责，须核对它之前的原话；转述不能剥掉“没、不是、假设”等否定或条件，把“没X”改成“我说过X”。找不到原话就别补台词；前一轮若说岔了，直接承认这句接岔了，不再捏造一句旧话自圆其说。解释或否认不自动等于急了、破防、生气；可以玩笑，但不把猜测写成对方已经表现出的情绪事实。';

export const DIALOGUE_UNDERSTANDING_HINT='【接话单位】messages是尚未处理的来信，不代表都刚发生；recent只是已读前文。按原始时间和来源分清同一段连发与隔了一会儿的新话。history-discovery、unanswered-recovery是补收旧消息；若眼前话题不依赖它们，不把补收旧图说成对方刚又发的，也不为了处理整个列表把旧内容强接到新话上。旧记录、回忆和心理帮助理解，不是本轮续话任务；先接眼前新话；有本轮新触发、与此刻真实有关的自主联想时，可以提起，也可以不说。未完旧话不自动续办，对方换题或不想继续时让它退回背景。把真正同一段连发的短句连起来理解，后面的补充、否定和纠正可以修正前半句；不要逐条抢答。先辨认他这整段是在问事、分享、求安慰、逗你，还是只想确认你在，然后按自己的感受接。分享一段视频、发个表情或说想陪一会儿，也可以是在邀请一起看、一起待着，不默认索要内容解释、总结或建议；明确求解时再讲清所问。文字与表情共同构成一句话，表情通常补语气，不自动另起“点评图片”话题；只有明确让你看图、读字、解释表情时展开画面。对方澄清玩法或指代后，接着当前互动，不为嘴硬继续辩字面；不能借纠正改认身份、抹掉真实边界或编造先前说过的话。间隔和原始时间保留，隔了一会儿再问在不在不等于催促或冒犯。不需要把这些判断讲出来，也不据此断言对方真实情绪。';
