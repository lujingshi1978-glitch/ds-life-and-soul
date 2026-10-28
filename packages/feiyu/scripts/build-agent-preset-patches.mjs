#!/usr/bin/env node
// build-agent-preset-patches.mjs — 把 dsh/agent-presets/<preset>/ 的 preset 源文件
// 渲染成 DSH 0.1.7 的 bundle patch 文件（plugins/qq-agent-presets/presets/<preset>.patch.yml）。
//
// 背景（为什么需要「生成」这一步）：
//   0.1.5：preset = ~/.dsh/.agent-presets/<preset>/{preset.yml,agent.cordis.yml} 目录，DSH 扫目录。
//   0.1.7：注册表既不扫目录也不接受 preset 路径，preset 变成一条普通 loader 行
//          （@deepseek-ai/dsh-agent-preset），它的 config.plugins 必须是**内联的行列表**，
//          只能由 bundle 的 patch 文件插入。于是同一份行列表必然存在两种表示：
//            源（人写/控制台改）：dsh/agent-presets/<preset>/{preset.yml,agent.cordis.yml}
//            装（DSH 读）：      plugins/qq-agent-presets/presets/<preset>.patch.yml
//          本脚本是两者之间**唯一**的转换器：源是唯一权威，产物是纯生成物（文件头写明「请勿手工编辑」）。
//          setup-dsh.mjs 在安装时会重新生成；test-agent-preset-patches.mjs 用 --check 钉住不漂移。
//
// 用法：
//   node scripts/build-agent-preset-patches.mjs           # 生成/刷新 patch 文件
//   node scripts/build-agent-preset-patches.mjs --check    # 只校验产物与源一致（不一致 exit 1）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {renderAgentPresetPatch,GUARD_SPECIFIER,presetRowId} from '../src/preset-prompt.js';
export {GUARD_SPECIFIER,presetRowId};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(__dirname, '..');

/** 由桥接托管的两个 preset（顺序即 patch 层顺序）。 */
export const PRESETS = ['qq-chat', 'qq-chat-v2'];

// Rendering and row validation are shared with the console writer.
export const BUNDLE_DIR = path.join(REPO_ROOT, 'plugins', 'qq-agent-presets');
export function patchFileFor(name) {
  return path.join(BUNDLE_DIR, 'presets', `${name}.patch.yml`);
}
function readYaml(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`读取失败 ${file}：${error?.message ?? error}`);
  }
  try {
    return yaml.load(text);
  } catch (error) {
    throw new Error(`${file} 不是合法 YAML：${error?.message ?? error}`);
  }
}

/** Render from the supplied app root; imports never generate or write files. */
export function renderPatch(name, {root = REPO_ROOT} = {}) {
  const dir = path.join(root, 'dsh', 'agent-presets', name);
  return renderAgentPresetPatch(name, readYaml(path.join(dir, 'preset.yml')), readYaml(path.join(dir, 'agent.cordis.yml')));
}

/** 生成（或校验）全部 patch 文件。@returns {{file:string,changed:boolean}[]} */
export function buildPatches({ check = false, log = () => {} } = {}) {
  const results = [];
  for (const name of PRESETS) {
    const file = patchFileFor(name);
    const content = renderPatch(name);
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
    const changed = current !== content;
    if (changed && !check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
    log(`${changed ? (check ? '✗ 需重新生成' : '✓ 已生成') : '· 已是最新'} ${path.relative(REPO_ROOT, file)}`);
    results.push({ file, changed });
  }
  return results;
}

// 直接执行时：默认生成，--check 只校验。
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const check = process.argv.includes('--check');
  const results = buildPatches({ check, log: (line) => console.log(`[preset-patches] ${line}`) });
  const stale = results.filter((r) => r.changed);
  if (check && stale.length > 0) {
    console.error(`[preset-patches] ERROR: ${stale.length} 个 patch 文件与源不一致；请运行 node scripts/build-agent-preset-patches.mjs`);
    process.exit(1);
  }
  console.log('[preset-patches] Done');
}
