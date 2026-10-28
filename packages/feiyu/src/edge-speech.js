import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { synthesizeQwenSpeech } from './qwen-speech.js';
import { synthesizeDeepSeekSpeech } from './deepseek-speech.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let busy = false;

export async function synthesizeEdgeSpeech(text, settings, library, style = '') {
  if (settings?.enabled !== true) throw new Error('语音合成未开启');
  if (typeof text !== 'string' || !text.trim()) throw new Error('语音文字不能为空');
  if (settings.provider === 'deepseek-official') return synthesizeDeepSeekSpeech(text, settings, library);
  if (settings.provider === 'qwen3-tts') return synthesizeQwenSpeech(text, settings, library, style);
  if (busy) throw new Error('正在合成另一条语音，请稍后重试');
  busy = true;
  const name = `tts-${Date.now()}-${crypto.randomUUID()}.mp3`;
  const output = path.join(library, name);
  try {
    await fs.mkdir(library, { recursive: true });
    const python = settings.python || path.join(ROOT, '.venv-tts', 'Scripts', 'python.exe');
    await new Promise((resolve, reject) => {
      const child = spawn(python, [path.join(ROOT, 'scripts', 'edge-speech.py')], {
        windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'], env: { ...process.env, PYTHONUTF8: '1' },
      });
      let error = '';
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
      child.stderr.on('data', chunk => { error = (error + chunk.toString()).slice(-2000); });
      child.stdin.on('error', () => {});
      child.once('error', err => { clearTimeout(timer); reject(err); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(timedOut ? 'Edge TTS 合成超时' : `Edge TTS 合成失败：${error.slice(-800) || code}`));
      });
      child.stdin.end(JSON.stringify({ text: text.trim(), output,
        voice: settings.voice || 'zh-CN-XiaoxiaoNeural', rate: settings.rate || '+0%', pitch: settings.pitch || '+0Hz' }));
    });
    const stat = await fs.stat(output);
    if (stat.size < 100 || stat.size > 20 * 1024 * 1024) throw new Error('合成音频大小异常');
    return name;
  } catch (error) {
    await fs.unlink(output).catch(() => {});
    throw error;
  } finally { busy = false; }
}
