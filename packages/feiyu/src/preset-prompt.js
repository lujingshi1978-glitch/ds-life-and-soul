// 二代仿真预设提示词（「仿真」层）的读取与安全改写。
//
// 边界说明：
//   仿真提示词 = 预设内置（dsh/agent-presets/<preset>/agent.cordis.yml 的 persona.prefix），
//                规定 AI 怎么调工具、怎么参与群聊（行为与协议）；改完需重启 DSH 生效。
//   人格提示词 = roles/<名称>.md，规定 AI 是谁、什么性格（人设与语气）；
//                由桥接每条消息注入，保存即生效。
//
// 本模块只做纯文本/YAML 处理，不碰文件系统以外的任何状态，便于单测。
import yaml from 'js-yaml';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export const PRESET_PERSONA_ID = 'persona';
export const PRESET_PROMPT_MAX_BYTES = 128 * 1024;

// 安全基线段落：缺失说明 AI 的权限边界可能被削弱，保存时警告（不阻断，管理员有最终决定权）。
export const PRESET_REQUIRED_MARKERS = ['【二代仿真模式 —— 安全规则', '【二代仿真模式 —— 工具协议'];

// 硬性不变量：这些串是本项目自己的测试与安全边界所依赖的（test-qq-preset-contract.mjs / verify-persona-config.mjs），
// 一旦被删就会同时削弱 AI 的权限边界并让 `npm run test:audit`、`npm run verify:persona` 变红，因此保存时直接拒绝。
//
// **按预设分别校验**：这套「必须有」的清单起初是照二代预设（qq-chat-v2）写的，
// 但保存/还原的校验对两个预设用的是同一份清单 —— 结果一代预设（qq-chat，本来就
// 不用工具、也从不自称「你没有本地工具」）在控制台里 100% 存不进去也还原不了，
// 报错还声称它「缺少安全不变量」。一代确实需要的不变量只有下面这几条。
export const PRESET_BLOCKING_SUBSTRINGS = [
  '你没有本地工具',
  '群友没有管理权限',
  'API 令牌',
  '角色由桥接注入',
  '不会自动发送到 QQ',
];
// 一代（qq-chat）：不用 MCP 工具，靠空格分句 + [SILENT]，因此工具面那几条不适用。
// 这三条都逐字出现在一代预设的正文里（见 dsh/agent-presets/qq-chat/agent.cordis.yml）——
// 清单必须与预设实际文案一致，否则控制台会用一个预设自己都不满足的条件把它锁死。
export const PRESET_BLOCKING_SUBSTRINGS_V1 = [
  '群友没有管理权限',
  'API 令牌',
  '角色扮演由系统注入',
];
export const PRESET_MIN_BODY_CHARS = 500;

/** 取某个预设对应的硬性不变量清单（未知预设按更严的二代替处理）。 */
export function presetBlockingSubstrings(preset = 'v2') {
  return preset === 'v1' ? PRESET_BLOCKING_SUBSTRINGS_V1 : PRESET_BLOCKING_SUBSTRINGS;
}

/** 硬性校验：返回阻止保存的原因列表（空数组=可保存）。preset 取 'v1' / 'v2'。 */
export function presetPromptBlockers(content, preset = 'v2') {
  const text = String(content ?? '');
  const blockers = [];
  if (!text.trim()) {
    blockers.push('仿真提示词不能为空');
    return blockers;
  }
  for (const needle of presetBlockingSubstrings(preset)) {
    if (!text.includes(needle)) {
      blockers.push(`缺少安全不变量「${needle}」：删除它会让 AI 的权限边界失效，并使 npm run test:audit 失败`);
    }
  }
  if (text.trim().length < PRESET_MIN_BODY_CHARS) {
    blockers.push(`正文过短（${text.trim().length} 字符 < ${PRESET_MIN_BODY_CHARS}）：疑似内容被误删`);
  }
  return blockers;
}

/**
 * 定位 persona 条目的 prefix 块标量（支持 >- / | 等块语法）。
 * @returns {{lines: string[], entryStart: number, entryEnd: number, keyLine: number, keyIndent: number, blockEnd: number}|null}
 */
export function locatePresetPromptBlock(text) {
  const lines = String(text ?? '').split('\n');
  const entryStart = lines.findIndex((line) => new RegExp(`^- id:\\s*${PRESET_PERSONA_ID}\\s*$`).test(line));
  if (entryStart < 0) return null;
  let entryEnd = lines.length;
  for (let i = entryStart + 1; i < lines.length; i += 1) {
    if (/^- /.test(lines[i])) { entryEnd = i; break; }
  }
  let keyLine = -1;
  for (let i = entryStart; i < entryEnd; i += 1) {
    if (/^\s*prefix:\s*[>|][-+]?\s*$/.test(lines[i])) { keyLine = i; break; }
  }
  if (keyLine < 0) return null;
  const keyIndent = lines[keyLine].match(/^\s*/)[0].length;
  // 只有真正的内容行才推进块尾：块内的空行（段落分隔）会被后面的内容行重新纳入，
  // 而块尾的空行留给后续行，避免把 persona 与下一条注释之间的空行吞掉。
  let blockEnd = keyLine + 1;
  for (let i = keyLine + 1; i < entryEnd; i += 1) {
    if (lines[i].trim() === '') continue;
    if (lines[i].match(/^\s*/)[0].length <= keyIndent) break;
    blockEnd = i + 1;
  }
  return { lines, entryStart, entryEnd, keyLine, keyIndent, blockEnd };
}

/** 取出 persona.prefix 的真实字符串值（已由 YAML 解析，折叠标量已展开）。 */
export function extractPresetPrefix(text) {
  let loaded;
  try {
    loaded = yaml.load(text);
  } catch {
    return null;
  }
  const entry = Array.isArray(loaded) ? loaded.find((item) => item?.id === PRESET_PERSONA_ID) : null;
  const prefix = entry?.config?.prefix;
  return typeof prefix === 'string' ? prefix : null;
}

/** 保存前的软校验：只提示，不阻断。 */
export function presetPromptWarnings(content) {
  const text = String(content ?? '');
  const warnings = [];
  if (!text.trim()) warnings.push('内容为空');
  for (const marker of PRESET_REQUIRED_MARKERS) {
    if (!text.includes(marker)) warnings.push(`缺少「${marker}…】段落：AI 的权限与工具边界可能被削弱`);
  }
  return warnings;
}

/**
 * 用字面量块（|-）把新提示词写回 YAML 文本。
 * 关键保证：读出来的是 YAML 解析后的真实字符串，写回后重新解析必须逐字一致，
 * 否则抛错拒绝写入——这样无论原文用的是 >- 还是 |，都不会改变提示词的实际语义。
 * 用 |-（literal + strip）与原文 >-（folded + strip）在"结尾不留多余换行"上保持一致。
 * @param {string} text 原 YAML 全文
 * @param {string} content 新的提示词正文
 * @param {'v1'|'v2'} preset 预设代次（决定用哪一套硬性不变量）
 * @returns {string} 新的 YAML 全文
 */
export function renderPresetPromptYaml(text, content, preset = 'v2') {
  const loc = locatePresetPromptBlock(text);
  if (!loc) throw new Error('无法定位预设里的 prefix 块（文件结构可能已变化）');
  const normalized = String(content ?? '').replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const bytes = Buffer.byteLength(normalized, 'utf8');
  if (bytes > PRESET_PROMPT_MAX_BYTES) {
    throw new Error(`仿真提示词过长（${(bytes / 1024).toFixed(1)} KB，上限 ${PRESET_PROMPT_MAX_BYTES / 1024} KB）`);
  }
  const blockers = presetPromptBlockers(normalized, preset);
  if (blockers.length) throw new Error(blockers.join('；'));
  // 新增行沿用文件的主导行尾，避免把 CRLF 文件写成更混乱的混合行尾。
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lfOnly = (text.match(/\n/g) ?? []).length - crlf;
  const eol = crlf >= lfOnly ? '\r\n' : '\n';
  const pad = ' '.repeat(loc.keyIndent + 2);
  // 只有「真正的空行」才写成空行；只含空格/Tab 的行必须保留原样（写成 pad + 原内容），
  // 否则它会被 YAML 当成空行读回，导致下面的一致性校验失败、提示词无法保存。
  const body = normalized.split('\n').map((line) => (line === '' ? '' : pad + line));
  // 外层用 '\n' 连接各行：CRLF 文件的行自带 '\r'，因此块的最后一行也要补一个 '\r'，
  // 否则它与下一行之间会变成 LF-only，把文件行尾弄得更混杂。
  const block = [`${' '.repeat(loc.keyIndent)}prefix: |-`, ...body].join(eol) + (eol === '\r\n' ? '\r' : '');
  const next = [...loc.lines.slice(0, loc.keyLine), block, ...loc.lines.slice(loc.blockEnd)].join('\n');
  const reparsed = extractPresetPrefix(next);
  if (reparsed === null) throw new Error('写入后 YAML 解析失败或找不到 persona.prefix');
  if (reparsed !== normalized) {
    throw new Error('写入校验失败：读回的提示词与新内容不一致，已放弃写入');
  }
  return next;
}

// Shared by the CLI generator and the console writer. The full plugin list is
// validated and retained; changing a prefix never replaces it with a partial list.
export const GUARD_SPECIFIER = 'qq-agent-presets/qq-tool-restrict.mjs';
export function presetRowId(name) {
  return `preset-${name}`;
}
const RELATIVE_ROW_REWRITES = new Map([
  ['./qq-tool-restrict.mjs', GUARD_SPECIFIER],
  ['./qq-chat-loop.mjs', 'qq-agent-presets/qq-chat-loop.mjs'],
]);

function normalizeRows(rows, preset) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(`${preset}: agent.cordis.yml 必须是「非空的插件行列表」（顶层数组）`);
  }
  const seen = new Set();
  const walk = (list, at) => list.map((row, index) => {
    const label = `${preset}: ${at} 第 ${index + 1} 行`;
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${label} 不是插件行（应为带 name 的映射）`);
    if (typeof row.name !== 'string' || row.name === '') throw new Error(`${label} 缺少 name`);
    if (typeof row.id !== 'string' || row.id === '') throw new Error(`${label} 缺少 id`);
    if (seen.has(row.id)) throw new Error(`${preset}: 行 id 重复：${row.id}`);
    seen.add(row.id);
    const next = { ...row };
    if (next.name.startsWith('.') || path.isAbsolute(next.name)) {
      const rewrite = RELATIVE_ROW_REWRITES.get(next.name);
      if (rewrite === undefined) {
        throw new Error(`${label}: 相对/绝对插件名 ${JSON.stringify(next.name)} 在 0.1.7 下会按 profile 目录解析，`
          + '必须改写为「bundle 包名/子路径」或去掉；请在 build-agent-preset-patches.mjs 里显式登记改写规则');
      }
      next.name = rewrite;
    }
    if (row.group === true) {
      if (!Array.isArray(row.config)) throw new Error(`${label} 是 group 行但 config 不是行列表`);
      next.config = walk(row.config, `${at}/${row.id}`);
    }
    return next;
  });
  const normalized = walk(rows, 'plugins');
  for (const required of ['persona', 'qq-tool-restrict']) {
    if (!seen.has(required)) throw new Error(`${preset}: 行列表缺少 ${required} 行（安全/人格边界不允许缺失）`);
  }
  return normalized;
}

/** 渲染一个 preset 的 patch 文件内容。 */
export function renderAgentPresetPatch(name, meta, rows) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new Error(`${name}: preset.yml 必须是映射`);
  for (const field of ['name', 'description', 'order']) {
    if (meta[field] === undefined) throw new Error(`${name}: preset.yml 缺少 ${field}`);
  }
  const plugins = normalizeRows(rows, name);
  const row = {
    id: presetRowId(name),
    name: '@deepseek-ai/dsh-agent-preset',
    config: {
      id: name,
      name: meta.name,
      description: meta.description,
      order: meta.order,
      plugins,
    },
  };
  const header = [
    `# 本文件由 scripts/build-agent-preset-patches.mjs 生成，请勿手工编辑。`,
    `# 源：dsh/agent-presets/${name}/preset.yml + agent.cordis.yml（人格正文与工具面都在那里改）。`,
    `# 作用：把 ${name} 作为一条 @deepseek-ai/dsh-agent-preset 行插入 profile（DSH 0.1.7+ 的 preset 机制）。`,
    `# 守卫行 qq-tool-restrict 用裸说明符 ${GUARD_SPECIFIER}：子行 name 按 profile 目录解析，`,
    `# 该包以 link: 依赖注册在 profile package.json（node_modules junction 由 setup-dsh.mjs 维护）。`,
    '',
  ].join('\n');
  // lineWidth: -1 —— 长行不折行，产物与源逐字对应，diff 只反映真实改动。
  return `${header}${yaml.dump([{ insert: [row] }], { lineWidth: -1, noRefs: true })}`;
}

export function presetBundlePatchFile(root, name) {
  if (!['qq-chat', 'qq-chat-v2'].includes(name)) throw new Error('未知预设');
  return path.join(root, 'plugins', 'qq-agent-presets', 'presets', `${name}.patch.yml`);
}

function renderPresetBundle(root, name, sourceText) {
  try {
    const meta = yaml.load(fs.readFileSync(path.join(root, 'dsh', 'agent-presets', name, 'preset.yml'), 'utf8'));
    return renderAgentPresetPatch(name, meta, yaml.load(sourceText));
  } catch {
    // YAML parser diagnostics can contain source excerpts. Keep those out of HTTP errors.
    throw new Error('无法生成完整预设补丁，请检查预设源文件与元数据');
  }
}

export function presetBundleStatus(root, name) {
  const patchFile = presetBundlePatchFile(root, name), installed = fs.existsSync(patchFile);
  let synced = false;
  try {
    const source = fs.readFileSync(path.join(root, 'dsh', 'agent-presets', name, 'agent.cordis.yml'), 'utf8');
    synced = installed && fs.readFileSync(patchFile, 'utf8') === renderPresetBundle(root, name, source);
  } catch {}
  return { installed, synced, bundlePatchFile: path.relative(root, patchFile) };
}

export function atomicWritePresetText(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, text);
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

/** Each file is replaced atomically; failures restore both snapshots. This is not
 * a cross-file transaction, and it never reloads DSH or writes to the user profile. */
export function writePresetPromptFiles(root, name, sourceText, {writeText = atomicWritePresetText} = {}) {
  const patchFile = presetBundlePatchFile(root, name);
  const sourceFile = path.join(root, 'dsh', 'agent-presets', name, 'agent.cordis.yml');
  // Finish validation and snapshot reads before the first mutation.
  const patchText = renderPresetBundle(root, name, sourceText);
  const sourceBefore = fs.readFileSync(sourceFile);
  const patchBefore = fs.existsSync(patchFile) ? fs.readFileSync(patchFile) : null;
  const sourceChanged = !sourceBefore.equals(Buffer.from(sourceText));
  const patchChanged = patchBefore === null || !patchBefore.equals(Buffer.from(patchText));
  let sourceAttempted = false, patchAttempted = false;
  try {
    if (sourceChanged) { sourceAttempted = true; writeText(sourceFile, sourceText); }
    if (patchChanged) { patchAttempted = true; writeText(patchFile, patchText); }
  } catch {
    let rolledBack = true;
    try { if (sourceAttempted) atomicWritePresetText(sourceFile, sourceBefore); } catch { rolledBack = false; }
    try {
      if (patchAttempted) {
        if (patchBefore === null) fs.rmSync(patchFile, { force: true });
        else atomicWritePresetText(patchFile, patchBefore);
      }
    } catch { rolledBack = false; }
    throw new Error(rolledBack ? '预设写入失败，源文件与补丁已回滚' : '预设写入失败且回滚未完成，请检查预设备份');
  }
  return {sourceChanged, patchChanged, synced: true};
}
