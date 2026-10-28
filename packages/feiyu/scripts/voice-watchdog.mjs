#!/usr/bin/env node
// Local runtime watchdog. Never sends QQ messages or retries QQ delivery.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverDshSessionCookie } from '../src/dsh-client.js';
import { voiceRepairAction } from '../src/voice-watchdog-policy.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const stateDir = path.join(root, 'state');
const lockPath = path.join(stateDir, 'voice-watchdog.lock');
const reportPath = path.join(stateDir, 'voice-watchdog.json');
const logPath = path.join(stateDir, 'voice-watchdog.jsonl');
const callsPath = path.join(stateDir, 'tool-calls.jsonl');
const base = 'http://127.0.0.1:3080';
const once = process.argv.includes('--once');
let probe = process.argv.includes('--probe');
let stopping = false;
let offset = 0;
let partial = '';
let failed = false;
let failures = 0;
let nextRepairAt = 0;
let lastState = '';

await fs.mkdir(stateDir, { recursive: true });
try {
  const previous = JSON.parse(await fs.readFile(reportPath, 'utf8'));
  failed = previous.needsProbe === true;
  nextRepairAt = Number(previous.nextRepairAt) || 0;
  failures = Number(previous.failures) || 0;
} catch { /* first run */ }
// Start at EOF: historical failed attempts must never trigger old-message replay.
try { offset = (await fs.stat(callsPath)).size; } catch { /* not created yet */ }

async function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.writeFile(String(process.pid));
      await handle.close();
      return true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let pid;
      try { pid = Number(await fs.readFile(lockPath, 'utf8')); } catch { return false; }
      if (!Number.isInteger(pid) || pid < 1) return false;
      try { process.kill(pid, 0); return false; } catch (e) {
        if (e.code !== 'ESRCH') return false;
      }
      await fs.unlink(lockPath).catch(() => {});
    }
  }
  return false;
}
if (!await acquireLock()) { console.error('voice watchdog already running'); process.exit(2); }

async function request(route, body, timeout = 20000) {
  const cookie = discoverDshSessionCookie(base);
  const response = await fetch(base + route, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(cookie ? { cookie } : {}), 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout),
  });
  const result = await response.json();
  if (!response.ok || result.ok !== true) throw new Error(`DS TTS request failed (${response.status}, ${result.code || 'UNKNOWN'})`);
  return result;
}

async function readFailures() {
  const handle = await fs.open(callsPath, 'r').catch(() => null);
  if (!handle) return;
  try {
    const size = (await handle.stat()).size;
    if (size < offset) { offset = 0; partial = ''; }
    // Buffer incomplete UTF-8 lines as bytes; do not retain private message bodies.
    const remaining = size - offset;
    if (!remaining) return;
    const bytes = Buffer.alloc(Math.min(remaining, 4 * 1024 * 1024));
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
    offset += bytesRead;
    const combined = Buffer.concat([Buffer.from(partial, 'base64'), bytes.subarray(0, bytesRead)]);
    const lastNewline = combined.lastIndexOf(10);
    if (lastNewline < 0) { partial = combined.toString('base64'); return; }
    partial = combined.subarray(lastNewline + 1).toString('base64');
    for (const line of combined.subarray(0, lastNewline).toString('utf8').split('\n')) {
      try {
        const event = JSON.parse(line);
        if (event.type === 'result' && event.tool === 'mcp__snowluma__qq_send_voice' && event.ok === false) failed = true;
      } catch { /* truncated/foreign line */ }
    }
  } finally { await handle.close(); }
}

async function report(status, extra = {}) {
  const row = { at: new Date().toISOString(), pid: process.pid, status, needsProbe: failed,
    failures, nextRepairAt, ...extra };
  await fs.writeFile(reportPath + '.tmp', JSON.stringify(row, null, 2));
  await fs.rename(reportPath + '.tmp', reportPath);
  if (status !== lastState || extra.repaired) {
    await fs.appendFile(logPath, JSON.stringify(row) + '\n');
    console.log(JSON.stringify(row));
  }
  lastState = status;
}

async function tick() {
  await readFailures();
  const status = await request('/api/ds-tts/status');
  const action = voiceRepairAction(status, { failed, probe });
  if (['busy', 'healthy', 'login-required', 'unavailable'].includes(action)) {
    await report(action);
    return;
  }
  if (Date.now() < nextRepairAt) { await report('cooldown'); return; }
  failed = true;
  await report('repairing');
  // voices(force) reopens a missing dedicated browser through the existing engine.
  // Synthesis exercises real delivery and its fresh-chat retry, never QQ send.
  await request('/api/ds-tts/voices?force=1', undefined, 45000);
  const latest = await request('/api/ds-tts/status');
  if (latest.queue?.active || latest.queue?.pending > 0) { await report('busy'); return; }
  const result = await request('/api/ds-tts/synthesize', {
    text: '语音恢复检查。', mode: 'echo', format: 'pcm', voice: 'stella', regenerate: true,
  }, 180000);
  if (!(result.seconds > 0) || !result.url) throw new Error('Invalid synthesis result');
  const audioUrl = new URL(result.url, base);
  if (audioUrl.origin !== base || !/^\/api\/ds-tts\/audio\/[a-f0-9]{16}\.wav$/.test(audioUrl.pathname)) throw new Error('Invalid probe audio URL');
  const audio = await fetch(audioUrl, { headers: { cookie: discoverDshSessionCookie(base) }, signal: AbortSignal.timeout(20000) });
  const bytes = Buffer.from(await audio.arrayBuffer());
  if (!audio.ok || bytes.length < 44 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid probe audio');
  failed = false; probe = false; failures = 0; nextRepairAt = Date.now() + 300000;
  await report('healthy', { repaired: true, seconds: result.seconds });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });
try {
  do {
    try { await tick(); }
    catch {
      failures++;
      failed = true;
      nextRepairAt = Date.now() + Math.min(1800000, 300000 * 2 ** Math.min(3, failures - 1));
      // Do not persist API error text: it can contain account/browser details.
      await report('repair-failed');
    }
    if (!once && !stopping) {
      // Short slices also let termination release the PID lock promptly.
      for (let i = 0; i < 60 && !stopping; i++) await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } while (!once && !stopping);
} finally {
  if ((await fs.readFile(lockPath, 'utf8').catch(() => '')).trim() === String(process.pid)) await fs.unlink(lockPath).catch(() => {});
}
