import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function startQwenSpeechWorker() {
  const configPath = path.join(ROOT, 'state/qwen-tts-service.json');
  const worker = JSON.parse(await fs.readFile(configPath, 'utf8'));
  try {
    const response = await fetch(`http://127.0.0.1:${worker.port || 3101}/health`, {
      headers: { authorization: `Bearer ${worker.token}` }, signal: AbortSignal.timeout(2000),
    });
    if (response.ok) return;
  } catch {}
  const pidFile = path.join(ROOT, 'state/qwen-tts-worker.pid');
  try {
    const pid = Number((await fs.readFile(pidFile, 'utf8')).trim());
    if (Number.isInteger(pid) && pid > 0) { process.kill(pid, 0); return; }
  } catch {}
  if (process.platform === 'win32') {
    // A detached Node child can receive Windows window-CLOSE when the short-lived
    // launcher exits (Intel runtime abort 200). Start-Process owns a hidden console.
    const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
    const args = [path.join(ROOT, 'scripts/qwen-speech-server.py'), '--config', configPath]
      .map(value => quote('"' + value + '"')).join(',');
    const command = `$p = Start-Process -FilePath ${quote(worker.python)} -ArgumentList @(${args}) -WorkingDirectory ${quote(ROOT)} -WindowStyle Hidden -RedirectStandardOutput ${quote(path.join(ROOT, 'state/qwen-tts.stdout.log'))} -RedirectStandardError ${quote(path.join(ROOT, 'state/qwen-tts.stderr.log'))} -PassThru; $p.Id`;
    const pid = await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
      });
      let output = '', errors = '';
      child.stdout.on('data', chunk => { output += chunk.toString(); });
      child.stderr.on('data', chunk => { errors += chunk.toString(); });
      child.once('error', reject);
      child.once('exit', async code => {
        // Start-Process can leave inherited pipe handles open in the worker.
        // The launcher exit is sufficient; do not wait for every pipe to close.
        await new Promise(resolve => setTimeout(resolve, 100));
        child.stdout.destroy();
        child.stderr.destroy();
        const value = Number(output.trim());
        if (code === 0 && Number.isInteger(value) && value > 0) resolve(value);
        else reject(new Error('无法启动 Qwen3-TTS 本地进程：' + errors.slice(-400)));
      });
    });
    await fs.writeFile(pidFile, String(pid));
    return;
  }
  const stdout = fsSync.openSync(path.join(ROOT, 'state/qwen-tts.stdout.log'), 'a');
  const stderr = fsSync.openSync(path.join(ROOT, 'state/qwen-tts.stderr.log'), 'a');
  try {
    const child = spawn(worker.python, [path.join(ROOT, 'scripts/qwen-speech-server.py'), '--config', configPath], {
      cwd: ROOT, windowsHide: true, detached: true, stdio: ['ignore', stdout, stderr],
      env: { ...process.env, PYTHONUTF8: '1', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1' },
    });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    await fs.writeFile(pidFile, String(child.pid));
    child.unref();
  } finally { fsSync.closeSync(stdout); fsSync.closeSync(stderr); }
}

export async function synthesizeQwenSpeech(text, settings, library, style = '') {
  if (typeof style !== 'string' || style.length > 200) throw new Error('语气描述最多 200 字');
  await startQwenSpeechWorker();
  const worker = JSON.parse(await fs.readFile(path.join(ROOT, 'state/qwen-tts-service.json'), 'utf8'));
  let ready = false;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      const health = await fetch(`http://127.0.0.1:${worker.port || 3101}/health`, {
        headers: { authorization: `Bearer ${worker.token}` }, signal: AbortSignal.timeout(2000),
      });
      if (health.ok && (await health.json()).ready) { ready = true; break; }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error('Qwen3-TTS 启动未就绪，请检查本地服务日志');
  const response = await fetch(`http://127.0.0.1:${worker.port || 3101}/speech`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${worker.token}` },
    body: JSON.stringify({ text, style }), signal: AbortSignal.timeout(300000),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Qwen3-TTS 返回 ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length < 100 || buffer.length > 20 * 1024 * 1024 || buffer.toString('ascii', 0, 4) !== 'RIFF') throw new Error('Qwen3-TTS 音频格式异常');
  await fs.mkdir(library, { recursive: true });
  const name = `tts-${Date.now()}-${crypto.randomUUID()}.wav`;
  await fs.writeFile(path.join(library, name), buffer);
  return name;
}
