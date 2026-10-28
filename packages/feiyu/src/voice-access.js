// Default remains restricted unless the operator explicitly opens synthesis.
export function speechScopeAllowed(key, ownerQQ, tts = {}) {
  return tts.ownerOnly === false || key === `private:${ownerQQ}`;
}

export function speechConfiguration(key, cfg) {
  const voice = cfg.socialV2?.voice ?? {};
  const enabled = voice.enabled === true && voice.tts?.enabled === true && cfg.socialV2?.tools?.sendVoice !== false && speechScopeAllowed(key, cfg.ownerQQ, voice.tts);
  const provider=['deepseek-official','qwen3-tts'].includes(voice.tts?.provider)?voice.tts.provider:'edge-tts';
  return {enabled,provider,voice:provider==='deepseek-official'?voice.tts?.dsVoice||null:provider==='qwen3-tts'?null:voice.tts?.voice||'zh-CN-XiaoxiaoNeural'};
}

export function speechCapabilityHint(key, cfg) {
  const {enabled,provider,voice}=speechConfiguration(key,cfg);
  if (!enabled) return '【当前语音能力】本会话目前未开启即时语音合成。\n\n';
  const configured=[provider,voice].filter(value=>typeof value==='string'&&/^[\w.:-]{1,100}$/.test(value)).join(' / ')||'未标识';
  return '【当前语音能力：已开启】本会话配置允许 qq_send_voice(key, token, text="要说的话")，不需要管理员代发。配置音源：'+configured+'；配置不证明服务当前可用，实际仍受本轮工具与发送守卫限制。历史说法不能替代当前配置和真实回执。每轮回复前判断表达方式：对方明确要听语音、情绪明确强烈，或回答需要较长解释时，优先调用语音工具。例如“解释一下题目答案”、讲解解题步骤、说明原因或复杂过程，确实需要多句话才能讲清时主动发语音，不必等对方说“发语音”。不要把本来简短的答案故意拉长来触发。这类长讲解直接只发语音，不先发开场白、不说“我语音给你讲”、不配公式文字、不另发文字总结。公式和关键数字在语音中讲清楚；只有对方明确要求文字或文字版公式时才补文字。对方明确只要文字或不方便听时用文字。长回答按完整意思拆成多段语音，长度和条数按内容与交流意愿决定，不凑段数，不省略必要解释，也不拿短敷衍代替。关系感受影响语气，不应让必要的题目解释缺失。成功后不重复发送整段转写，不汇报触发规则。普通短答仍可文字。服务是否可用以实际回执为准；未知时不能声称已成功。只能发送到当前会话；语音失败时本轮立即停止重试，不等待冷却、不连续换文字重试。可只用一句短文字说明语音暂时失败后收尾，不能补发整段讲解；保留失败记录，不伪称发送成功，已成功的部分不重复。\n\n';
}
