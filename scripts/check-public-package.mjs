import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { inflateRawSync, inflateSync } from 'node:zlib';

export const PUBLIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PLUGINS = ['feiyu-life', 'qq-contact-memory', 'qq-intimacy-judge', 'qq-agent-presets', 'qq-qzone-review', 'qq-mode-console', 'dsh-bili-scroll', 'dsh-read-animation'];
const nativePath = 'packages/feiyu/plugins/qq-agent-presets/creator-pipe-shim.node';
const sourceExtensions = new Set(['.js', '.mjs', '.cjs', '.py', '.c', '.cs', '.ps1', '.cmd', '.sh', '.sql', '.json', '.md', '.txt', '.yml', '.yaml', '.toml', '.html', '.css', '.svg']);
const rootFiles = new Set(['README.md', 'README.en.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'SECURITY.md', 'CONTRIBUTING.md', 'package.json', 'package-lock.json', '.gitignore', '.gitattributes', 'start.cmd', 'start.sh', 'stop.cmd', 'stop.sh', '启动肥鱼.cmd']);
const privateDirectories = new Set(['state', 'config', 'cognition-v3', 'audio', 'logs', 'log', 'cache', 'caches', '.cache', 'chat-history', 'conversations', 'credentials', 'cookies', '.ssh', '.aws', '.npm', '.pnpm-store']);
const ignoredDirectories = new Set(['.git', 'node_modules', '.local', '.runtime', 'work', '.venv', 'venv', '__pycache__', '.pytest_cache', '.ruff_cache', 'dist', '.build', '.scratch', 'models', '.models', '.uv', '.mypy_cache', '.tox', 'site-packages']);
const artifactExtensions = new Set(['.pptx', '.pdf', '.png', '.jpg', '.jpeg', '.webp']);
const sha = value => createHash('sha256').update(value).digest('hex');
const posix = value => value.split(path.sep).join('/');
const issue = (rule, relative, line = 1) => ({ rule, path: relative, line });

export function classifyPublicPath(relative, { directory = false } = {}) {
  const normalized = relative.replaceAll('\\', '/');
  const parts = normalized.split('/');
  if (!normalized || parts.some(p => p === '..' || p === '.') || path.posix.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) return 'unsafe-path';
  if (parts.some(p => ignoredDirectories.has(p.toLowerCase()) || /^\.venv(?:[-_].*)?$/i.test(p))) return 'excluded-runtime';
  if (parts.some(p => privateDirectories.has(p.toLowerCase()))) return 'private-directory';
  const basename = parts.at(-1);
  if (/^(?:\.env(?:\..*)?|config\.json|server\.local\.json|embedding\.local\.json|\.credentials.*|id_rsa|id_ed25519|(?:cookies?|credentials?|secrets?|tokens?|accounts?|sessions?)(?:[._-].*)?\.json)$/i.test(basename) || /(?:cookie|credentials|secret|token)[._-](?:backup|real|local)\b/i.test(basename)) return 'private-config';
  if (/\.(?:db|sqlite(?:3)?|sqlite-(?:wal|shm)|db-(?:wal|shm)|log|pyc|pyo|pem|key|p12|pfx|bak|dump|zip|7z|rar|exe|dll|so|dylib|whl|tar|gz)$/i.test(basename)) return 'non-source-artifact';
  if (directory) return null;
  if (normalized === nativePath) return null;
  if (normalized.endsWith('.node')) return 'unreviewed-native';
  if (rootFiles.has(normalized)) return null;
  const extension = path.posix.extname(basename).toLowerCase();
  const textFile = sourceExtensions.has(extension) || /^(?:LICENSE(?:[.-].*)?|.*-LICENSE|NOTICE(?:[.-].*)?|COPYING|\.gitignore)$/i.test(basename);
  if (/^(?:scripts|tests|templates|licenses|examples)\//.test(normalized) && textFile) return null;
  if (/^\.github\/(?:workflows\/[^/]+\.ya?ml|ISSUE_TEMPLATE\/[^/]+\.(?:md|yml)|pull_request_template\.md)$/.test(normalized)) return null;
  if (/^(?:docs|presentation|presentations|assets|examples)\//.test(normalized) && (textFile || artifactExtensions.has(extension))) return null;
  if (/^clients\/feiyu-hotkey\//.test(normalized) && textFile) return null;
  if (/^portable\/voice-runtime\//.test(normalized) && textFile) return null;
  const core = normalized.match(/^packages\/feiyu\/(.+)$/)?.[1];
  if (core) {
    if (/^(?:LICENSE|package(?:-lock)?\.json|config\.example\.json)$/.test(core)) return null;
    if (/^(?:src|scripts|dsh|public)\//.test(core) && textFile) return null;
    if (core === 'roles/肥鱼温柔撒娇.md') return null;
    if (/^vendor\/(?:czx-bilibili\/(?:keyframes\.js|LICENSE)|tencent-weixin\/(?:LICENSE|SOURCE\.md))$/.test(core)) return null;
    const plugin = core.match(/^plugins\/([^/]+)\//)?.[1];
    if (PLUGINS.includes(plugin) && textFile) return null;
  }
  return 'outside-source-allowlist';
}

// This is the only file enumerator for release validation and ZIP creation.
// It never follows links or reads ignored install/runtime trees.
export function enumeratePublicFiles(root = PUBLIC_ROOT) {
  const files = [], excluded = [], issues = [];
  function walk(relative = '') {
    const absolute = path.join(root, relative);
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = posix(path.join(relative, entry.name));
      if (entry.isSymbolicLink()) { issues.push(issue('symbolic-link', name)); continue; }
      const rule = classifyPublicPath(name, { directory: entry.isDirectory() });
      if (rule) {
        excluded.push({ path: name, rule });
        if (rule !== 'excluded-runtime') issues.push(issue(rule, name));
      } else if (entry.isDirectory()) walk(name);
      else if (entry.isFile()) files.push(name);
      else issues.push(issue('special-file', name));
    }
  }
  walk();
  return { files: files.sort(), excluded, issues };
}

const contentRules = [
  ['personal-windows-home', /[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b|Default\b|<|\$|%|YOUR_|username\b|yourname\b)[A-Za-z0-9_. -]+/gi],
  ['personal-unix-home', /\/(?:Users|home)\/(?!<|\$|YOUR_|username\b|yourname\b)[A-Za-z0-9_.-]+/g],
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['provider-api-key', /\b(?:sk|rk)-(?:proj-)?[A-Za-z0-9_-]{24,}\b/g],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['google-api-key', /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ['url-credentials', /https?:\/\/[^\s/:'"<>]+:[^\s/@'"<>]+@/g],
  ['qq-fixture-id', /\b(?:qq:|private:)[1-9][0-9]{6,12}\b/g],
  ['private-profile-id', /\bcharacters[\\/]+[a-f0-9]{16,64}\b/g],
];

function validatePrivateIdentifiers(privateIdentifiers) {
  if (!Array.isArray(privateIdentifiers) || privateIdentifiers.some(value => typeof value !== 'string' || value.length === 0)) throw new TypeError('privateIdentifiers must be an array of nonempty strings');
}

// Project-specific identities are supplied only by the caller's private local
// audit environment. They must never be embedded in the public scanner/tests.
export function scanPublicText(text, relative, { privateIdentifiers = [] } = {}) {
  validatePrivateIdentifiers(privateIdentifiers);
  const findings = [];
  for (const identifier of privateIdentifiers) {
    let offset = 0;
    while ((offset = text.indexOf(identifier, offset)) !== -1) {
      findings.push(issue('private-id', relative, text.slice(0, offset).split('\n').length));
      offset += identifier.length;
    }
  }
  for (const [rule, expression] of contentRules) {
    expression.lastIndex = 0;
    for (const match of text.matchAll(expression)) findings.push(issue(rule, relative, text.slice(0, match.index).split('\n').length));
  }
  // Literal account/credential values are forbidden. Empty/example/env references
  // and synthetic test tokens are allowed; findings never contain their values.
  const assignment = /\b(?:apiKey|api_key|accessToken|access_token|refreshToken|refresh_token|authorization|password|consoleToken|gatewayToken)\s*[:=]\s*(['"])([^'"\r\n]+)\1/gi;
  for (const match of text.matchAll(assignment)) {
    if (/^(?:\s*|example(?:[-_ ].*)?|change[-_ ].*|replace[-_ ].*|your[-_ ].*|fixture(?:[-_ ].*)?|synthetic(?:[-_ ].*)?|test(?:[-_ ].*)?|invalid|fake|Bearer\s+|\$\{.*\}|<.*>|0+)$/i.test(match[2])) continue;
    if (match[2].length >= 12 && !/^\s*(?:process\.env|os\.environ|env[.(])/i.test(match[2])) findings.push(issue('literal-credential', relative, text.slice(0, match.index).split('\n').length));
  }
  return [...new Map(findings.map(value => [`${value.rule}:${value.path}:${value.line}`, value])).values()];
}

// Read only textual XML/relations/metadata from a generated Office document.
// A small in-process ZIP reader avoids extracting paths or invoking Office.
function officeText(buffer) {
  const texts = [];
  let end = buffer.length - 22;
  while (end >= Math.max(0, buffer.length - 65557) && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < Math.max(0, buffer.length - 65557)) throw Error('Invalid Office archive');
  let offset = buffer.readUInt32LE(end + 16);
  const count = buffer.readUInt16LE(end + 10);
  for (let i = 0; i < count; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw Error('Invalid Office directory');
    const method = buffer.readUInt16LE(offset + 10), compressed = buffer.readUInt32LE(offset + 20), size = buffer.readUInt32LE(offset + 24);
    const length = buffer.readUInt16LE(offset + 28), extra = buffer.readUInt16LE(offset + 30), comment = buffer.readUInt16LE(offset + 32);
    const name = buffer.subarray(offset + 46, offset + 46 + length).toString('utf8');
    if (/\.(?:xml|rels|txt|json)$/i.test(name)) {
      if (size > 20 * 1024 * 1024) throw Error('Office part too large');
      const local = buffer.readUInt32LE(offset + 42), start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + compressed);
      const decoded = method === 0 ? data : method === 8 ? inflateRawSync(data, { maxOutputLength: 20 * 1024 * 1024 }) : null;
      if (!decoded) throw Error('Unsupported Office compression');
      texts.push(decoded.toString('utf8'));
    }
    offset += 46 + length + extra + comment;
  }
  return texts.join('\n');
}

function pdfText(buffer) {
  const raw = buffer.toString('latin1'), texts = [raw];
  // Generated PDFs use Flate for text and object streams. Inspect inflated
  // metadata/text without rendering, extracting files or touching links.
  const streams = /<<(?:[^>]|>(?!>))*\/Filter\s*(?:\/FlateDecode|\[\s*\/FlateDecode\s*\])(?:[^>]|>(?!>))*>>\s*stream\r?\n/g;
  for (const match of raw.matchAll(streams)) {
    const begin = match.index + match[0].length;
    const end = raw.indexOf('endstream', begin);
    if (end < 0 || end - begin > 30 * 1024 * 1024) throw Error('Invalid PDF stream');
    const decoded = inflateSync(buffer.subarray(begin, end).subarray(0, end - begin), { maxOutputLength: 30 * 1024 * 1024 });
    texts.push(decoded.toString('utf8'), decoded.toString('utf16le'));
    const bigEndian = Buffer.from(decoded); bigEndian.subarray(0, bigEndian.length - bigEndian.length % 2).swap16();
    texts.push(bigEndian.toString('utf16le'));
  }
  return texts.join('\n');
}

function sourceText(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString('utf16le');
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const text = Buffer.from(buffer.subarray(2));
    text.subarray(0, text.length - text.length % 2).swap16();
    return text.toString('utf16le');
  }
  return buffer.toString('utf8');
}

export function auditPublicPackage(root = PUBLIC_ROOT, { requireLicenses = true, inspectGit = true, privateIdentifiers = [] } = {}) {
  validatePrivateIdentifiers(privateIdentifiers);
  const enumeration = enumeratePublicFiles(root), issues = [...enumeration.issues], native = [];
  for (const relative of enumeration.files) {
    const buffer = fs.readFileSync(path.join(root, relative)), extension = path.extname(relative).toLowerCase();
    try {
      const text = extension === '.pptx' ? officeText(buffer) : extension === '.pdf' ? pdfText(buffer) : sourceText(buffer);
      issues.push(...scanPublicText(text, relative, { privateIdentifiers }));
      if (extension === '.node') {
        issues.push(...scanPublicText(buffer.toString('utf16le'), relative, { privateIdentifiers }));
        native.push(relative);
      }
    } catch { issues.push(issue('unreadable-public-content', relative)); }
    if (relative.endsWith('package.json') || relative.endsWith('package-lock.json')) {
      try {
        const json = JSON.parse(buffer.toString('utf8'));
        const entries = relative.endsWith('package-lock.json') ? Object.values(json.packages || {}) : [json];
        if (entries.some(pkg => Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }).some(key => key === '@snowluma/sdk' || /ds-ttshost/i.test(key)))) issues.push(issue('unapproved-third-party-dependency', relative));
        if (entries.some(pkg => Object.values({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies }).some(value => /^(?:file:|link:)|^[A-Za-z]:[\\/]/.test(String(value))))) issues.push(issue('machine-local-dependency', relative));
      } catch { issues.push(issue('invalid-package-json', relative)); }
    }
  }
  if (requireLicenses) {
    const required = ['LICENSE', 'packages/feiyu/LICENSE', 'licenses/ws-LICENSE', 'licenses/native-artifacts.json', 'licenses/third-party-manifest.json', 'clients/feiyu-hotkey/LICENSE', 'clients/feiyu-hotkey/THIRD_PARTY_NOTICES.md', 'packages/feiyu/vendor/czx-bilibili/LICENSE', 'packages/feiyu/vendor/tencent-weixin/LICENSE', 'packages/feiyu/plugins/dsh-bili-scroll/vendor/bilibili-mcp/LICENSE', ...PLUGINS.map(name => `packages/feiyu/plugins/${name}/LICENSE`)];
    if (enumeration.files.some(relative => relative.startsWith('portable/voice-runtime/'))) required.push('portable/voice-runtime/LICENSE', 'portable/voice-runtime/NOTICE.md');
    for (const relative of required) if (!enumeration.files.includes(relative)) issues.push(issue('missing-license-record', relative));
    const manifestPath = 'licenses/native-artifacts.json';
    if (fs.existsSync(path.join(root, manifestPath))) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, manifestPath), 'utf8'));
        for (const relative of native) {
          const entry = manifest.artifacts?.find(value => value.binary === relative);
          if (!entry || entry.license !== 'MIT' || !entry.build || !entry.source || !entry.licenseFile) { issues.push(issue('native-provenance-missing', relative)); continue; }
          for (const [file, expected] of [[entry.binary, entry.sha256], [entry.source, entry.sourceSha256], [entry.licenseFile, entry.licenseSha256]]) {
            if (!enumeration.files.includes(file) || !/^[a-f0-9]{64}$/.test(expected || '') || sha(fs.readFileSync(path.join(root, file))) !== expected) issues.push(issue('native-provenance-hash', relative));
          }
        }
      } catch { issues.push(issue('native-provenance-invalid', manifestPath)); }
    }
    const thirdPartyPath = 'licenses/third-party-manifest.json';
    if (fs.existsSync(path.join(root, thirdPartyPath))) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(root, thirdPartyPath), 'utf8'));
        if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.copied) || !manifest.copied.length) throw Error('Invalid license records');
        for (const entry of manifest.copied) {
          if (!entry.license || !entry.licenseFiles?.length) throw Error('Missing license record');
          for (const record of entry.licenseFiles) if (!enumeration.files.includes(record.path) || sha(fs.readFileSync(path.join(root, record.path))) !== record.sha256) issues.push(issue('third-party-license-hash', thirdPartyPath));
        }
        if (!enumeration.files.includes(manifest.npm?.lockFile) || sha(fs.readFileSync(path.join(root, manifest.npm.lockFile))) !== manifest.npm.lockSha256) issues.push(issue('third-party-lock-hash', thirdPartyPath));
      } catch { issues.push(issue('third-party-manifest-invalid', thirdPartyPath)); }
    }
  }
  if (inspectGit && fs.existsSync(path.join(root, '.git'))) {
    try {
      const tracked = execFileSync('git', ['-C', root, 'ls-files', '--cached', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
      const included = new Set(enumeration.files);
      for (const relative of tracked) if (!included.has(relative)) issues.push(issue('tracked-outside-public-allowlist', relative));
      // The inspected working tree must be the bytes that will be committed.
      // Otherwise an old staged blob could retain a value already removed here.
      const changed = execFileSync('git', ['-C', root, 'diff', '--name-only', '--no-ext-diff', '-z', '--'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean);
      for (const relative of changed) issues.push(issue('git-index-worktree-mismatch', relative));
    } catch { issues.push(issue('git-index-unreadable', '.git')); }
  }
  const deduplicated = [...new Map(issues.map(value => [`${value.rule}:${value.path}:${value.line}`, value])).values()].sort((a, b) => a.path.localeCompare(b.path, 'en') || a.line - b.line || a.rule.localeCompare(b.rule));
  return { ok: deduplicated.length === 0, policyVersion: 1, fileCount: enumeration.files.length, issues: deduplicated, excluded: enumeration.excluded, files: enumeration.files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), rootArg = args.find(value => value.startsWith('--root='));
  const result = auditPublicPackage(rootArg ? path.resolve(rootArg.slice(7)) : PUBLIC_ROOT);
  if (args.includes('--files')) {
    if (result.ok) process.stdout.write(result.files.join(args.includes('--null') ? '\0' : '\n') + (args.includes('--null') ? '\0' : '\n'));
    else process.stderr.write(JSON.stringify({ ...result, files: undefined }, null, 2) + '\n');
  } else console.log(JSON.stringify({ ...result, files: args.includes('--manifest') ? result.files : undefined }, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}
