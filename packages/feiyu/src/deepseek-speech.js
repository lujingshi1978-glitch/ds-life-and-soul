import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { discoverDshSessionCookie } from './dsh-client.js';

// Reuse ds-tts's official read-aloud channel. Browser login is managed by ds-tts;
// this adapter never reads or persists the DeepSeek account token.
export async function synthesizeDeepSeekSpeech(text, settings, library) {
  const base = new URL(settings.dshBaseUrl || 'http://127.0.0.1:3080');
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('DSH 语音接口必须是本机地址');
  const cookie = discoverDshSessionCookie(base.origin);
  const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) };
  const response = await fetch(new URL('/api/ds-tts/synthesize', base), {
    method: 'POST', headers,
    body: JSON.stringify({ text, mode: 'echo', format: 'pcm', ...(settings.dsVoice ? { voice: settings.dsVoice } : {}) }),
    signal: AbortSignal.timeout(65000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok !== true) throw new Error(result.error || 'DeepSeek 官方语音合成失败，请检查专用浏览器登录状态');
  const audioUrl = new URL(result.url, base);
  if (audioUrl.origin !== base.origin || !/^\/api\/ds-tts\/audio\/[a-f0-9]{16}\.wav$/.test(audioUrl.pathname)) throw new Error('DeepSeek 语音返回了无效音频地址');
  const audio = await fetch(audioUrl, { headers: cookie ? { cookie } : {}, signal: AbortSignal.timeout(30000) });
  if (!audio.ok) throw new Error('无法读取 DeepSeek 生成的音频');
  const buffer = Buffer.from(await audio.arrayBuffer());
  if (buffer.length < 44 || buffer.length > 20 * 1024 * 1024 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('DeepSeek 音频格式或大小异常');
  await fs.mkdir(library, { recursive: true });
  const name = `tts-${Date.now()}-${crypto.randomUUID()}.wav`;
  await fs.writeFile(path.join(library, name), buffer);
  return name;
}
