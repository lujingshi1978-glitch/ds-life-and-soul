import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { auditPublicPackage, enumeratePublicFiles, classifyPublicPath, scanPublicText } from '../scripts/check-public-package.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu-public-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (relative, value = 'export const synthetic = true;\n') => {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, value);
  };
  return { root, put };
}

test('release enumeration excludes installation trees without reading their contents', t => {
  const { root, put } = fixture(t);
  put('README.md', 'A portable source release.');
  put('packages/feiyu/src/main.js');
  put('packages/feiyu/src/cognition/schema.sql', 'CREATE TABLE synthetic(id TEXT);');
  put('node_modules/real-package/state/config.json', 'DO_NOT_SCAN_RUNTIME');
  put('packages/feiyu/node_modules/another/package.json', '{}');
  put('.local/private-state/config.json', 'DO_NOT_SCAN_RUNTIME');
  put('work/media/.venv/Scripts/python.exe', 'DO_NOT_SCAN_RUNTIME');
  const enumeration = enumeratePublicFiles(root);
  assert.deepEqual(enumeration.files, ['README.md', 'packages/feiyu/src/cognition/schema.sql', 'packages/feiyu/src/main.js']);
  assert.deepEqual(enumeration.issues, []);
  assert.equal(enumeration.excluded.length, 4);
  assert.equal(auditPublicPackage(root, { requireLicenses: false }).ok, true);
});

test('private state and unknown files cannot be silently packaged', t => {
  const { root, put } = fixture(t);
  put('packages/feiyu/state/chat.sqlite', 'synthetic fixture');
  put('clients/feiyu-hotkey/config.json', '{}');
  put('packages/feiyu/src/extra.node', Buffer.from('native fixture'));
  put('unreviewed-document.md', 'synthetic fixture');
  const result = auditPublicPackage(root, { requireLicenses: false });
  assert.equal(result.ok, false);
  assert.equal(result.files.length, 0);
  for (const rule of ['private-directory', 'private-config', 'unreviewed-native', 'outside-source-allowlist']) assert.ok(result.issues.some(item => item.rule === rule));
});

test('symlinks and junctions are rejected even when their targets contain source', t => {
  const { root, put } = fixture(t);
  put('scripts/safe.mjs');
  const link = path.join(root, 'scripts/linked');
  try { fs.symlinkSync(path.join(root, 'scripts'), link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('The platform does not permit temporary links'); return; } throw error; }
  const result = enumeratePublicFiles(root);
  assert.ok(result.issues.some(item => item.rule === 'symbolic-link'));
  assert.deepEqual(result.files, ['scripts/safe.mjs']);
});

test('traversal, arbitrary native binaries and account config are outside the policy', () => {
  for (const file of ['../README.md', '/README.md', 'C:/README.md', 'scripts/../main.mjs']) assert.equal(classifyPublicPath(file), 'unsafe-path');
  assert.equal(classifyPublicPath('packages/feiyu/plugins/qq-agent-presets/creator-pipe-shim.node'), null);
  assert.equal(classifyPublicPath('packages/feiyu/src/unreviewed.node'), 'unreviewed-native');
  assert.equal(classifyPublicPath('packages/feiyu/config.json'), 'private-config');
  assert.equal(classifyPublicPath('packages/feiyu/src/cookies.json'), 'private-config');
  assert.equal(classifyPublicPath('templates/config.example.json'), null);
  assert.equal(classifyPublicPath('docs/肥鱼项目介绍.pptx'), null);
});

test('caller-supplied synthetic private rules emit no values or content snippets', () => {
  const account = 'fixture-private-account-alpha';
  const windowsHome = ['C:', 'Users', 'private-account', 'credentials'].join('/');
  const key = ['sk', '-'].join('') + 'a'.repeat(36);
  const source = ['synthetic', account, windowsHome, key].join('\n');
  const findings = scanPublicText(source, 'scripts/example.mjs', { privateIdentifiers: [account] });
  assert.ok(findings.some(item => item.rule === 'private-id' && item.line === 2));
  assert.ok(findings.some(item => item.rule === 'personal-windows-home' && item.line === 3));
  assert.ok(findings.some(item => item.rule === 'provider-api-key' && item.line === 4));
  for (const finding of findings) assert.deepEqual(Object.keys(finding), ['rule', 'path', 'line']);
  for (const value of [account, windowsHome, key]) assert.equal(JSON.stringify(findings).includes(value), false);
});

test('private identifier rules are optional, literal, isolated and validated', t => {
  const { root, put } = fixture(t);
  const syntheticIdentity = 'fixture.private[identity]';
  put('README.md', `A fully synthetic identifier: ${syntheticIdentity}.`);
  assert.equal(auditPublicPackage(root, { requireLicenses: false }).ok, true);
  const result = auditPublicPackage(root, { requireLicenses: false, privateIdentifiers: [syntheticIdentity] });
  assert.deepEqual(result.issues, [{ rule: 'private-id', path: 'README.md', line: 1 }]);
  assert.equal(JSON.stringify(result.issues).includes(syntheticIdentity), false);
  assert.equal(auditPublicPackage(root, { requireLicenses: false }).ok, true, 'private caller rules must not persist globally');
  assert.throws(() => auditPublicPackage(root, { privateIdentifiers: [''] }), /array of nonempty strings/);
  assert.throws(() => scanPublicText('synthetic', 'README.md', { privateIdentifiers: 'invalid' }), /array of nonempty strings/);
});

test('synthetic identities and documented empty/example credentials pass', () => {
  const text = `const person = 'qq:100001';\nconst second = 'private:100002';\nconst timeout = 1000000000;\nconst apiKey = '';\nconst accessToken = 'fixture-integration-token';\nconst password = 'change-me';`;
  assert.deepEqual(scanPublicText(text, 'tests/fixture.mjs'), []);
});

test('literal authentication secrets and long QQ fixture identities fail', () => {
  const token = 'nonexample' + '-credential-constant';
  const findings = scanPublicText(`const accessToken = '${token}';\nconst peer = 'qq:${'6543' + '210987'}';`, 'scripts/example.mjs');
  assert.ok(findings.some(item => item.rule === 'literal-credential' && item.line === 1));
  assert.ok(findings.some(item => item.rule === 'qq-fixture-id' && item.line === 2));
});

test('missing copied licenses and native provenance block a release', t => {
  const { root, put } = fixture(t);
  put('packages/feiyu/plugins/qq-agent-presets/creator-pipe-shim.node', Buffer.from('synthetic binary'));
  put('licenses/native-artifacts.json', JSON.stringify({ artifacts: [] }));
  const result = auditPublicPackage(root);
  assert.ok(result.issues.some(item => item.rule === 'missing-license-record'));
  assert.ok(result.issues.some(item => item.rule === 'native-provenance-missing'));
});

test('local dependency paths and the removed third-party SDK are blocked', t => {
  const { root, put } = fixture(t);
  put('package.json', JSON.stringify({ dependencies: { '@snowluma/sdk': '1.0.0', local: 'file:../private' } }));
  const result = auditPublicPackage(root, { requireLicenses: false });
  assert.ok(result.issues.some(item => item.rule === 'unapproved-third-party-dependency'));
  assert.ok(result.issues.some(item => item.rule === 'machine-local-dependency'));
});

test('a Git index cannot sneak ignored runtime files into the initial snapshot', t => {
  const { root, put } = fixture(t);
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); }
  catch { t.skip('Git is not installed'); return; }
  put('README.md', 'synthetic release');
  put('.local/config.json', '{}');
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'add', '--', 'README.md', '.local/config.json'], { stdio: 'ignore' });
  const result = auditPublicPackage(root, { requireLicenses: false });
  assert.ok(result.issues.some(item => item.rule === 'tracked-outside-public-allowlist' && item.path === '.local/config.json'));
});

test('a fixed working tree cannot approve stale private bytes still staged for publication', t => {
  const { root, put } = fixture(t);
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); }
  catch { t.skip('Git is not installed'); return; }
  put('README.md', 'fixture-private-identity-staged');
  execFileSync('git', ['init', '-q', root], { stdio: 'ignore' });
  execFileSync('git', ['-C', root, 'add', '--', 'README.md'], { stdio: 'ignore' });
  put('README.md', 'A corrected synthetic release.');
  const result = auditPublicPackage(root, { requireLicenses: false, privateIdentifiers: ['fixture-private-identity-staged'] });
  assert.deepEqual(result.issues, [{ rule: 'git-index-worktree-mismatch', path: 'README.md', line: 1 }]);
  execFileSync('git', ['-C', root, 'add', '--', 'README.md'], { stdio: 'ignore' });
  assert.equal(auditPublicPackage(root, { requireLicenses: false, privateIdentifiers: ['fixture-private-identity-staged'] }).ok, true);
});

function storedOfficeDocument(name, xml) {
  const data = Buffer.from(xml), filename = Buffer.from(name);
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(filename.length, 26);
  const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(filename.length, 28);
  const central = Buffer.concat([directory, filename]);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + filename.length + data.length, 16);
  return Buffer.concat([local, filename, data, central, end]);
}

test('PowerPoint XML and author metadata are scanned inside the Office archive', t => {
  const { root, put } = fixture(t);
  const privatePath = ['C:', 'Users', 'private-account', 'demo.png'].join('/');
  put('docs/demo.pptx', storedOfficeDocument('docProps/core.xml', `<core><author>${privatePath}</author></core>`));
  const result = auditPublicPackage(root, { requireLicenses: false });
  assert.ok(result.issues.some(item => item.rule === 'personal-windows-home' && item.path === 'docs/demo.pptx'));
});

test('compressed PDF metadata is scanned without rendering or following its links', t => {
  const { root, put } = fixture(t);
  const privatePath = ['C:', 'Users', 'private-account', 'demo.png'].join('/');
  const data = deflateSync(Buffer.from('synthetic PDF metadata ' + privatePath));
  put('docs/demo.pdf', Buffer.concat([Buffer.from('%PDF-1.4\n1 0 obj\n<< /Length ' + data.length + ' /Filter /FlateDecode >>\nstream\n'), data, Buffer.from('\nendstream\nendobj\n%%EOF')]));
  const result = auditPublicPackage(root, { requireLicenses: false });
  assert.ok(result.issues.some(item => item.rule === 'personal-windows-home' && item.path === 'docs/demo.pdf'));
});

test('tampering with a copied license or dependency lock invalidates its manifest', t => {
  const { root, put } = fixture(t);
  put('LICENSE', 'Synthetic MIT license fixture');
  put('package-lock.json', JSON.stringify({ lockfileVersion: 3, packages: {} }));
  put('licenses/third-party-manifest.json', JSON.stringify({ schemaVersion: 1, copied: [{ license: 'MIT', licenseFiles: [{ path: 'LICENSE', sha256: '0'.repeat(64) }] }], npm: { lockFile: 'package-lock.json', lockSha256: '0'.repeat(64) } }));
  const result = auditPublicPackage(root);
  assert.ok(result.issues.some(item => item.rule === 'third-party-license-hash'));
  assert.ok(result.issues.some(item => item.rule === 'third-party-lock-hash'));
});
