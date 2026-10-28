import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalize, commandPlan, DEFAULTS, portOpen } from '../scripts/deploy.mjs';
import { identityHash, inspectProcess, stopOwned } from '../scripts/owned-processes.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => fs.readFileSync(file, 'utf8');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); };

// Every mutating test imports a copied controller whose REPO points into this
// disposable tree. No test writes config, profiles or process records in repo.
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feiyu 隔离 安装-'));
  for (const entry of ['scripts/deploy.mjs', 'packages/feiyu/scripts/feiyu-dsh.mjs', 'packages/feiyu/plugins']) {
    const destination = path.join(dir, entry);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(path.join(repo, entry), destination, { recursive: true });
  }
  fs.copyFileSync(path.join(repo, 'scripts/owned-processes.mjs'), path.join(dir, 'scripts/owned-processes.mjs'));
  fs.copyFileSync(path.join(repo, 'scripts/qq-setup.mjs'), path.join(dir, 'scripts/qq-setup.mjs'));
  fs.copyFileSync(path.join(repo, 'scripts/python-runtime.mjs'), path.join(dir, 'scripts/python-runtime.mjs'));
  const core = path.join(dir, 'packages/feiyu');
  const sourceCore = path.join(repo, 'packages/feiyu');
  if (!fs.existsSync(path.join(sourceCore, 'node_modules/js-yaml'))) {
    fs.rmSync(dir, { recursive: true, force: true });
    t.skip('Run npm ci in packages/feiyu first');
    return null;
  }
  fs.symlinkSync(path.join(sourceCore, 'node_modules'), path.join(core, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  for (const name of ['mcp-snowluma-safe.js', 'mcp-feiyu-apps.js', 'mcp-web-search-safe.js']) {
    const target = path.join(core, 'src', name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(sourceCore, 'src', name), target);
  }
  const api = await import(pathToFileURL(path.join(dir, 'scripts/deploy.mjs')).href);
  const lifecycle = await import(pathToFileURL(path.join(core, 'scripts/feiyu-dsh.mjs')).href);
  const dshInstall = path.join(dir, 'mock-dsh');
  write(path.join(dshInstall, 'package.json'), { version: '0.2.0-rc.2' });
  fs.mkdirSync(path.join(dshInstall, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(dshInstall, 'lib/bin.js'), 'throw Error("Fixture must never start DSH");\n');
  const config = { ...DEFAULTS, voice: false, browser: false, video: false, dshHome: path.join(dir, '独立 DSH home'), dshInstall };
  t.after(() => {
    // Unlink our dependency junction before removing the containing directory.
    const link = path.join(core, 'node_modules');
    if (fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) fs.unlinkSync(link);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, core, api, lifecycle, config };
}

test('normalization rejects ambiguous ports and invalid input', () => {
  assert.deepEqual(normalize(), DEFAULTS);
  for (const value of [0, 1023, 65536, '3081', NaN]) assert.throws(() => normalize({ dshPort: value }));
  assert.throws(() => normalize({ consolePort: DEFAULTS.dshPort }));
  assert.throws(() => normalize({ profile: '../outside' }));
  assert.throws(() => normalize({ voice: 'false' }));
  assert.throws(() => normalize({ ownerQQ: 'not-a-number' }));
  assert.throws(() => normalize({ model: 'model\n--flag' }));
});

test('plan is side effect free and states selected features', () => {
  const before = fs.existsSync(path.join(repo, '.local'));
  const plan = commandPlan({ voice: false, browser: false, video: false });
  assert.deepEqual(plan.features, { voice: false, browser: false, video: false });
  assert.equal(plan.profile, 'feiyu');
  assert.equal(fs.existsSync(path.join(repo, '.local')), before);
});

test('seeding in a Chinese path is idempotent and preserves local edits', async t => {
  const f = await fixture(t); if (!f) return;
  assert.equal(f.api.seedConfig(f.config).created, true);
  const file = path.join(f.core, 'config.json');
  const config = JSON.parse(read(file));
  assert.equal(config.dsh.authToken, '');
  assert.equal(config.consoleToken, '');
  assert.equal(config.social.enabled, false);
  assert.equal(config.socialV2.proactive.enabled, false);
  assert.equal(config.socialV2.voice.enabled, false);
  assert.equal(config.snowluma.enabled, false);
  assert.deepEqual(config.allow, { private: [], groups: [] });
  assert.equal(config.allowAllWhenEmpty, false);
  config.workspaceTitle = 'retain operator changes'; write(file, config);
  const customRole = path.join(f.core, 'state/current-role.json');
  write(customRole, { role: 'operator role', mode: 'normal' });
  const before = [read(file), read(customRole)];
  assert.equal(f.api.seedConfig(f.config).created, false);
  assert.deepEqual([read(file), read(customRole)], before);
});

test('invalid explicit Python fails voice preflight before install or config writes', async t => {
  const f = await fixture(t); if (!f) return;
  const previous = process.env.FEIYU_PYTHON;
  process.env.FEIYU_PYTHON = path.join(f.dir, 'missing-python.exe');
  try {
    await assert.rejects(f.api.install({...f.config,voice:true}), /FEIYU_PYTHON/);
    assert.equal(fs.existsSync(path.join(f.core,'config.json')),false);
    assert.equal(fs.existsSync(path.join(f.dir,'.local/installation.json')),false);
  } finally {
    if (previous === undefined) delete process.env.FEIYU_PYTHON; else process.env.FEIYU_PYTHON = previous;
  }
});

test('isolated install is idempotent and restores original profile bytes', async t => {
  const f = await fixture(t); if (!f) return;
  const locations = f.lifecycle.profilePaths({ dshHome: f.config.dshHome, profile: 'feiyu' });
  fs.mkdirSync(locations.dir, { recursive: true });
  const manifest = '{"name":"existing-profile","private":true,"custom":"preserved","dependencies":{},"dsh":{"profile":{"bundles":["another-bundle"]}}}\n';
  const patch = '- id: existing-entry\n  config:\n    retained: true\n';
  fs.writeFileSync(locations.manifest, manifest); fs.writeFileSync(locations.patch, patch);
  await f.api.install(f.config, { skipDependencies: true });
  assert.equal(f.lifecycle.inspectProfile(f.config).ok, true);
  const installed = JSON.parse(read(locations.manifest));
  assert.equal(installed.custom, 'preserved');
  assert.ok(installed.dsh.profile.bundles.includes('another-bundle'));
  const bytes = [read(locations.manifest), read(locations.patch), read(locations.journal)];
  await f.api.install(f.config, { skipDependencies: true });
  assert.deepEqual([read(locations.manifest), read(locations.patch), read(locations.journal)], bytes);
  assert.equal(f.lifecycle.uninstallProfile(f.config).removed, true);
  assert.equal(read(locations.manifest), manifest); assert.equal(read(locations.patch), patch);
  assert.equal(fs.existsSync(path.join(f.core, 'config.json')), true);
});

test('conflicting existing unmanaged bundles are left byte-for-byte intact', async t => {
  const f = await fixture(t); if (!f) return;
  const locations = f.lifecycle.profilePaths(f.config);
  write(locations.manifest, { dependencies: { 'feiyu-life': 'operator-version' }, dsh: { profile: { bundles: [] } } });
  fs.writeFileSync(locations.patch, '[]\n');
  const bytes = [read(locations.manifest), read(locations.patch)];
  await assert.rejects(f.api.install(f.config, { skipDependencies: true }), /conflict/);
  assert.deepEqual([read(locations.manifest), read(locations.patch)], bytes);
  assert.equal(fs.existsSync(locations.journal), false);
});

test('edited managed profiles are refused without overwriting operator edits', async t => {
  const f = await fixture(t); if (!f) return;
  await f.api.install(f.config, { skipDependencies: true });
  const locations = f.lifecycle.profilePaths(f.config);
  fs.appendFileSync(locations.patch, '\n# operator changed this\n');
  const bytes = read(locations.patch);
  await assert.rejects(f.api.install(f.config, { skipDependencies: true }), /外部修改/);
  assert.equal(read(locations.patch), bytes);
  assert.throws(() => f.lifecycle.uninstallProfile(f.config), /changed/);
});

test('installer gives every MCP and native plugin the selected bridge origin', async t => {
  const f = await fixture(t); if (!f) return;
  const config = { ...f.config, dshPort: 54121, consolePort: 54122, companionPort: 54123 };
  await f.api.install(config, { skipDependencies: true });
  const locations = f.lifecycle.profilePaths(config), patch = JSON.parse(read(locations.patch));
  assert.equal(patch.find(entry => entry.id === 'feiyu-life').config.bridgeUrl, 'http://127.0.0.1:54122');
  const mcp = patch.flatMap(entry => entry.insert || []).filter(entry => entry.name === '@deepseek-ai/dsh-mcp-client');
  assert.equal(mcp.length, 3);
  for (const entry of mcp) assert.equal(entry.config.env.FEIYU_BRIDGE_URL, 'http://127.0.0.1:54122');
});

test('occupied DSH port is refused without adopting or stopping its server', async t => {
  const f = await fixture(t); if (!f) return;
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const ports = [port, port === 65535 ? 65534 : port + 1, port > 65533 ? port - 2 : port + 2];
  await f.api.install({ ...f.config, dshPort: ports[0], consolePort: ports[1], companionPort: ports[2] }, { skipDependencies: true });
  await assert.rejects(f.api.start({ open: false, client: false }), /占用/);
  assert.equal(await portOpen(port), true);
  assert.equal(fs.existsSync(path.join(f.dir, '.local/processes.json')), false);
});

for (const blocked of ['consolePort', 'companionPort']) test('complete preflight refuses occupied ' + blocked + ' before launching DSH', async t => {
  const f = await fixture(t); if (!f) return;
  const names = ['dshPort', 'consolePort', 'companionPort'], servers = [];
  for (const name of names) { const server = net.createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); servers.push({ name, server }); }
  const selected = Object.fromEntries(servers.map(({ name, server }) => [name, server.address().port]));
  for (const { name, server } of servers) if (name !== blocked) await new Promise(resolve => server.close(resolve));
  const occupied = servers.find(item => item.name === blocked).server;
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  await f.api.install({ ...f.config, ...selected }, { skipDependencies: true });
  await assert.rejects(f.api.start({ open: false, client: false }), /占用/);
  assert.equal(await portOpen(selected[blocked]), true);
  assert.equal(fs.existsSync(path.join(f.dir, '.local/processes.json')), false);
});

test('stop refuses an unverified PID and preserves its record', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t); if (!f) return;
  const record = { id: 'not-owned', pid: process.pid, identityHash: 'invalid', command: process.execPath, entry: 'outside-fixture' };
  const file = path.join(f.dir, '.local/processes.json'); write(file, [record]);
  const result = f.api.stop();
  assert.equal(result.ok, false); assert.deepEqual(result.stopped, []); assert.deepEqual(result.unverified, ['not-owned']);
  assert.deepEqual(JSON.parse(read(file)), [record]);
  assert.doesNotThrow(() => process.kill(process.pid, 0));
});

function fakeProcesses() {
  const rows = [
    { ProcessId: 41, ParentProcessId: 1, ExecutablePath: 'node.exe', CommandLine: 'node isolated-dsh', CreationDate: 'first' },
    { ProcessId: 42, ParentProcessId: 41, ExecutablePath: 'node.exe', CommandLine: 'node isolated-mcp', CreationDate: 'second' },
    { ProcessId: 43, ParentProcessId: 42, ExecutablePath: 'node.exe', CommandLine: 'node isolated-grandchild', CreationDate: 'third' },
    { ProcessId: 99, ParentProcessId: 1, ExecutablePath: 'node.exe', CommandLine: 'node other-service', CreationDate: 'other' },
  ];
  const live = new Map(rows.map(row => [row.ProcessId, row]));
  const killed = [], backend = { inspect: pid => live.get(pid) || null, list: () => rows, terminate: record => { killed.push(record.pid); live.delete(record.pid); return 'stopped'; } };
  const record = { id: 'dsh', pid: 41, command: 'node.exe', entry: 'isolated-dsh', identityHash: identityHash(rows[0]) };
  return { rows, live, killed, backend, record };
}

test('owned stop snapshots verified descendants and stops children before parents', () => {
  const f = fakeProcesses(); const result = stopOwned([f.record], { backend: f.backend });
  assert.equal(result.ok, true); assert.deepEqual(f.killed, [43, 42, 41]);
  assert.deepEqual(result.remaining, []); assert.ok(f.live.has(99));
});

test('owned stop never adopts a tree whose parent identity changed', () => {
  const f = fakeProcesses(); f.live.set(41, { ...f.rows[0], CreationDate: 'reused-pid' });
  const result = stopOwned([f.record], { backend: f.backend });
  assert.equal(result.ok, false); assert.deepEqual(f.killed, []); assert.deepEqual(result.remaining, [f.record]);
});

test('owned stop preserves a child with a changed identity for later review', () => {
  const f = fakeProcesses();
  f.backend.list = () => { f.live.set(42, { ...f.rows[1], CreationDate: 'reused-child-pid' }); return f.rows; };
  const result = stopOwned([f.record], { backend: f.backend });
  assert.equal(result.ok, false); assert.deepEqual(f.killed, [43, 41]);
  assert.equal(result.remaining.length, 1); assert.equal(result.remaining[0].pid, 42);
  assert.equal(result.remaining[0].identityHash, identityHash(f.rows[1]));
  assert.ok(f.live.has(42)); assert.ok(f.live.has(99));
});

test('owned stop retains a record when final atomic identity comparison refuses it', () => {
  const f = fakeProcesses(); f.backend.terminate = record => record.pid === 42 ? 'changed' : (f.killed.push(record.pid), 'stopped');
  const result = stopOwned([f.record], { backend: f.backend });
  assert.equal(result.ok, false); assert.deepEqual(f.killed, [43, 41]);
  assert.deepEqual(result.unverified, ['dsh:child:42']);
});

test('owned stop preserves records when identity inspection is unavailable', () => {
  const f = fakeProcesses(); f.backend.inspect = () => { throw Error('inspection unavailable'); };
  const result = stopOwned([f.record], { backend: f.backend });
  assert.equal(result.ok, false); assert.deepEqual(f.killed, []); assert.deepEqual(result.remaining, [f.record]);
});

test('Windows Unicode identities survive CIM serialization and stop their own process tree', { skip: process.platform !== 'win32', timeout: 20000 }, async () => {
  // This child has no network or service behavior and expires by itself even
  // if a future regression makes the safe stop controller refuse its identity.
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},15000)', '隔离 中文 空格'], { windowsHide: true, stdio: 'ignore' });
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  child.unref();
  const current = inspectProcess(child.pid);
  assert.ok(current?.CommandLine.includes('隔离 中文 空格'));
  const record = { id: 'owned-unicode-test', pid: child.pid, command: process.execPath, entry: '-e', identityHash: identityHash(current) };
  const result = stopOwned([record]);
  assert.equal(result.ok, true); assert.deepEqual(result.remaining, []);
  assert.equal(inspectProcess(child.pid), null);
});
