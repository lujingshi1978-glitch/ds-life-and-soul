export const privateDialogue = key => /^private:\d+$/.test(String(key));

// Automatic checks remain rate limited. A real private incoming message is not
// an unsolicited opportunity and must not wait behind an hourly wake quota.
export function reactivePrivateWake(key, reason, unread) {
  return privateDialogue(key) && unread?.length > 0
    && !['proactiveCheck', 'timeout', 'admin'].includes(reason);
}

// Budget a response to messages actually shown to the model, not the entire
// native tool loop. Merely arriving (but still unseen) does not grant a refill.
export function reserveResponseBudget(budgets, key, { throughSeq, limit, count }) {
  let budget = budgets.get(key);
  if (!budget) return () => {};
  if (throughSeq > (budget.throughSeq || 0)) {
    budget = { ...budget, throughSeq, used: 0, limit };
    budgets.set(key, budget);
  }
  budget.limit=null; // Accounting only; the character chooses length and message count.
  budget.used += count;
  let finished = false;
  return actual => {
    if (!finished) { finished = true; budget.used -= count - actual; }
  };
}

export const PRIVATE_CYCLE_HINT = `【私聊短周期】
按真实兴趣、当下内容和对方反应决定互动，不按日/小时次数、消息条数或字数配额表达。看过、觉得还行或工具可用都不等于需要点赞评论；只有真的欣赏才点赞，有自己想说的内容才评论，可以两者都不做。正常接话，有内容再展开，没有新内容就停，不用反复追问、刷屏或换句话重复。不为了证明能动性主动打招呼、贴链接或强制换兴趣。对方拒绝、忙碌或明确换题就留空间；已成功或结果未知的同一操作不重复提交。
当前对象只由本快照的 key 与来信署名确定。先理解本轮来信，正事先回应；闲聊时可以接上自己的兴趣、小念头或近况，不必只复述对方再反问。同一人连续的补充合在一起理解。
前面回合的背景快照已经过期，以本次快照为准；旧内容只作参考，未完话题可以放下，不自动续办，也不把历史背景当作新来信。
发完这次想说的内容，用 qq_mark_read(throughSeq=实际处理的readThroughSeq)确认已处理消息，结束本轮即可。允许根据性格选择不回复，但仍确认实际看过的消息。
不需要调用 qq_get_prompt 重读已有规则，不为收尾等待五分钟，不循环检查是否在线。新来信由桥接重新唤起，不会因为结束这次思考而漏收。确实需要合并补充时只用 purpose="reply" 短静默。
新的未处理消息不能随上一批一起标读。每次新来信有独立回应预算；本次话少不等于不再回应之后的来信。
共享的是肥鱼的身份、兴趣、情绪和精力。其他好友的具体事件、称呼、秘密及关系不属于当前对象，不把旧活动当作对方刚说的话。当前对象没有说过的内容不能归给他；精确原话另查资源。`;
