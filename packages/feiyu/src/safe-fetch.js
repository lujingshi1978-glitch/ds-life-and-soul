// 只读 HTTP(S) 安全抓取工具：供 qq-bridge / MCP 共用。
// 设计目标与 mcp-web-search-safe 一致：
// - 仅 http/https
// - 禁止 localhost / .local / 私有 IP / 环回 / 链路本地 / CGNAT 等内网地址
// - 域名先 DNS 解析并检查全部解析结果，避免 DNS rebinding
// - 手动跟随重定向，每一跳重新校验
// - 响应体限量读取，每次请求有包含响应体的总时限
import dns from 'node:dns';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import { StringDecoder } from 'node:string_decoder';

const dnsLookup = dns.promises.lookup;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`操作超时(${ms}ms)：${label}`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function ipv4FromLast32(lower) {
  const parts = String(lower || '').split(':');
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  const secondLast = parts[parts.length - 2];
  if (/^\d+\.\d+\.\d+\.\d+$/.test(last)) return last;
  if (/^[0-9a-f]{1,4}$/.test(secondLast) && /^[0-9a-f]{1,4}$/.test(last)) {
    const num = (parseInt(secondLast, 16) << 16) + parseInt(last, 16);
    return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
  }
  return null;
}

function parseEmbeddedIpv4(h) {
  const lower = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!lower.includes(':')) return null;
  const dotted = lower.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const m = lower.match(/^::(?:ffff:)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (m) {
    const num = (parseInt(m[1], 16) << 16) + parseInt(m[2], 16);
    return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
  }
  // 兼容 ::ffff:0:7f00:1、::ffff:0:c0a8:101、::c0a8:101 等非规范 IPv4-mapped/compatible 写法。
  if (lower.startsWith('::ffff:') || lower.startsWith('::')) {
    const embedded = ipv4FromLast32(lower);
    if (embedded) return embedded;
  }
  // NAT64 前缀（64:ff9b::/96 与 64:ff9b:1::/48）内嵌 IPv4，例如 64:ff9b::c0a8:101 -> 192.168.1.1
  if (lower.startsWith('64:ff9b')) {
    const embedded = ipv4FromLast32(lower);
    if (embedded) return embedded;
  }
  const nat64 = lower.match(/^64:ff9b:(?:::)?(?:([0-9a-f]{1,4}):([0-9a-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/i);
  if (nat64) {
    if (nat64[3]) return nat64[3];
    const num = (parseInt(nat64[1], 16) << 16) + parseInt(nat64[2], 16);
    return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
  }
  return null;
}

export function isPrivateIp(ip) {
  let h = String(ip || '').toLowerCase().replace(/^\[|\]$/g, '');
  const family = net.isIP(h);
  // DNS 返回值也必须是有效 IP；不能把非法地址当成公网地址。
  if (!family || h.includes('%')) return true;
  if (family === 6) h = new URL(`http://[${h}]/`).hostname.slice(1, -1);

  if (net.isIP(h) === 4) {
    const parts = h.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    if (parts[0] === 198 && parts[1] >= 18 && parts[1] <= 19) return true;
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true;
    if (parts[0] >= 224) return true;
    return false;
  }

  if (net.isIP(h) === 6) {
    if (h === '::' || h === '::1') return true;
    if (h.startsWith('fc') || h.startsWith('fd')) return true;
    if (/^fe[89ab]/.test(h)) return true;
    if (h.startsWith('fec') || h.startsWith('fed') || h.startsWith('fee') || h.startsWith('fef')) return true;
    // 本地 NAT64 前缀的 IPv4 位布局不等同 /96；整个本地前缀均不可供公网抓取。
    if (h.startsWith('64:ff9b:1:')) return true;
    const embedded = parseEmbeddedIpv4(h);
    if (embedded) return isPrivateIp(embedded);
    if (h.startsWith('2001:db8')) return true;
    if (h.startsWith('2001:2:') || h.startsWith('2001:10:') || h.startsWith('2001:20:')) return true;
    const sixth4 = h.match(/^2002:([0-9a-f]{1,4}):([0-9a-f]{1,4}):/i);
    if (sixth4) {
      const num = (parseInt(sixth4[1], 16) << 16) + parseInt(sixth4[2], 16);
      const ipv4 = `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
      if (isPrivateIp(ipv4)) return true;
    }
    if (h.startsWith('ff')) return true;
    return false;
  }

  return true;
}

/**
 * 把校验过的地址排成「尝试顺序」。
 *
 * 为什么不能只取第一个：DNS 返回顺序是**轮转/不确定**的，而本机常常只有 IPv4 出口。
 * QQ 的表情 CDN（gxh.vip.qq.com / p.qpic.cn / multimedia.nt.qq.com.cn）和
 * raw.githubusercontent.com 都同时有 AAAA/A 记录 —— 抢到第一个 AAAA 的那次请求会一路
 * 连到 20 秒超时，其余请求正常，于是表现为「**部分**表情包/图片/网页时好时坏」。
 * 这里优先 IPv4，并把两个族交替排布：v4 全部不可用时还能试 v6（v6-only 主机同理）。
 * @param {{address: string, family: number}[]} addresses
 * @returns {string[]} 地址字符串（已按尝试顺序排列）
 */
function orderAddresses(addresses) {
  const v4 = addresses.filter((item) => Number(item?.family) === 4).map((item) => item.address);
  const v6 = addresses.filter((item) => Number(item?.family) === 6).map((item) => item.address);
  const ordered = [];
  const max = Math.max(v4.length, v6.length);
  for (let i = 0; i < max; i += 1) {
    if (v4[i]) ordered.push(v4[i]);
    if (v6[i]) ordered.push(v6[i]);
  }
  return ordered;
}

/** 解析主机名并校验**全部**解析结果，返回可尝试的地址列表（IPv4 优先）。 */
export function isProxyFakeAddress(address) {
  return /^198\.(?:18|19)\./.test(address) || /^2001:2:/i.test(address);
}
// Only image CDN names already used by QQ, never arbitrary user-supplied domains.
const QQ_IMAGE_HOSTS = new Set(['multimedia.nt.qq.com.cn', 'gxh.vip.qq.com', 'p.qpic.cn', 'c2cpicdw.qpic.cn', 'c2cpicdw2.qpic.cn', 'c2cpicdw3.qpic.cn', 'q1.qlogo.cn', 'q2.qlogo.cn']);
const publicDnsCache = new Map();
export async function recoverQqImageAddresses(hostname, lookupAddresses, request = fetch) {
  if (!QQ_IMAGE_HOSTS.has(hostname) || !lookupAddresses.length || !lookupAddresses.every(x => isProxyFakeAddress(x.address))) throw Error('域名解析到内网/本机地址，已阻止');
  return recoverPublicProxyAddresses(hostname,lookupAddresses,request);
}
/** Opt-in recovery for public web learning under fake-IP DNS proxies. Real private
 * or mixed answers still fail closed; TLS and pinned-IP checks remain unchanged. */
export async function recoverPublicProxyAddresses(hostname,lookupAddresses,request=fetch){
  if(!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)
    ||/\.(?:localhost|local|internal|lan|home|arpa)$/i.test(hostname)
    ||!lookupAddresses.length||!lookupAddresses.every(x=>isProxyFakeAddress(x.address)))throw Error('域名解析到内网/本机地址，已阻止');
  const cached = publicDnsCache.get(hostname);
  if (cached?.expires > Date.now()) return cached.addresses;
  // Fixed HTTPS resolver endpoint, TLS verified, redirects refused. DNS results are
  // still checked and pinned by requestOnce; fake/private addresses are never fetched.
  const response = await request('https://dns.alidns.com/resolve?name=' + encodeURIComponent(hostname) + '&type=A', {
    headers: { accept: 'application/dns-json' }, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw Error('公共 DNS 查询失败');
  let body = ''; for await (const chunk of response.body) {
    body += Buffer.from(chunk).toString('utf8'); if (body.length > 16384) throw Error('DNS 响应过大');
  }
  const data = JSON.parse(body);
  const answers = data.Answer?.filter(x => x.type === 1) || [];
  const addresses = [...new Set(answers.map(x => x.data))];
  if (data.Status !== 0 || !addresses.length || addresses.some(isPrivateIp)) throw Error('公共 DNS 未返回安全公网地址');
  const ttl = Math.max(1, Math.min(60, ...answers.map(x => Number(x.TTL) || 1)));
  publicDnsCache.set(hostname, { addresses, expires: Date.now() + ttl * 1000 });
  return addresses;
}
export async function resolveSafeAddresses(hostname, { recoverQqImages = false,recoverProxyDns=false } = {}) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!h) throw new Error('主机名为空');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) {
    throw new Error('禁止访问内网/本机地址');
  }
  if (net.isIP(h)) {
    if (isPrivateIp(h)) throw new Error('禁止访问内网/本机地址');
    return [h];
  }
  let addresses;
  try {
    addresses = await withTimeout(dnsLookup(h, { all: true, verbatim: true }), 5000, `DNS 解析 ${h}`);
  } catch (error) {
    throw new Error(`域名解析失败：${error?.message ?? error}`);
  }
  if (!addresses.length) throw new Error('域名没有解析结果');
  if (recoverQqImages && addresses.some(x => isPrivateIp(x.address))) return recoverQqImageAddresses(h, addresses);
  if (recoverProxyDns && addresses.some(x => isPrivateIp(x.address))) return recoverPublicProxyAddresses(h,addresses);
  for (const { address } of addresses) {
    if (isPrivateIp(address)) {
      throw new Error('域名解析到内网/本机地址，已阻止');
    }
  }
  const ordered = orderAddresses(addresses);
  return ordered.length ? ordered : [addresses[0].address];
}

export async function resolveSafeHost(hostname) {
  const [first] = await resolveSafeAddresses(hostname);
  return first;
}

export async function validateFetchUrl(raw, options) {
  let url;
  try {
    url = new URL(String(raw ?? '').trim());
  } catch {
    throw new Error('URL 无效');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('仅允许 http/https');
  if (url.username || url.password) throw new Error('URL 不能包含凭据');
  const addresses = await resolveSafeAddresses(url.hostname, options);
  return { url, ip: addresses[0], addresses };
}

const REQUEST_TIMEOUT_MS = 20000;
// 多地址时的单次尝试预算：够一次 TCP+TLS+首字节，又不至于让「第一个地址是坏的 IPv6」
// 把整个 20 秒总预算耗光。
const ATTEMPT_TIMEOUT_MS = 8000;
const MAX_ADDRESS_ATTEMPTS = 4;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function validateLimit(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} 必须为正整数`);
}

/**
 * 用**一个**已校验的地址发起一次尝试，保留原始 Host/SNI（禁止重新解析 DNS）。
 * 返回 `{ok:true,result}` 或 `{ok:false,error,retryable}`；retryable 只标记网络层失败
 * （连接失败/超时/正文中断），大小与图片签名等策略性拒绝不重试。
 */
function attemptOnce(url, address, limit, binary, budgetMs) {
  return new Promise((resolve) => {
    let settled = false;
    let req;
    let response;
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const fail = (error, retryable) => settle({ ok: false, error, retryable: retryable === true });
    const done = (result) => settle({ ok: true, result });
    const timer = setTimeout(() => {
      const error = new Error(`请求超时：${url.hostname}`);
      fail(error, true);
      req?.destroy(error);
      response?.destroy();
    }, budgetMs);
    const mod = url.protocol === 'https:' ? https : http;
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    try {
      req = mod.request({
        hostname: address,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        headers: {
          host: url.host,
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
          accept: binary ? 'image/*,*/*;q=0.8' : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'zh-CN,zh;q=0.9',
          ...(/(?:^|\.)(?:hdslb\.com|bilivideo\.com|bilivideo\.cn)$/.test(hostname)?{referer:'https://www.bilibili.com/'}:{}),
        },
        servername: url.protocol === 'https:' && !net.isIP(hostname) ? hostname : undefined,
        rejectUnauthorized: url.protocol === 'https:',
        timeout: budgetMs,
      }, (res) => {
        response = res;
        res.on('error', (error) => fail(error, true));
        res.on('aborted', () => fail(new Error('响应体读取中断'), true));
        res.on('close', () => {
          if (!res.complete) fail(new Error('响应体读取中断'), true);
        });
        if (settled) { res.destroy(); return; }
        const statusCode = res.statusCode || 0;
        if (REDIRECT_STATUSES.has(statusCode)) {
          done({ statusCode, redirect: String(res.headers.location || '') });
          // 不下载重定向正文：攻击者可以发送无限正文消耗连接和带宽。
          res.destroy();
          return;
        }
        const chunks = [];
        const decoder = binary ? null : new StringDecoder('utf8');
        let size = 0;
        const appendText = (text) => {
          const points = Array.from(text);
          const remaining = limit - size;
          chunks.push(points.slice(0, remaining).join(''));
          size += Math.min(points.length, remaining);
          if (size >= limit) {
            done({ statusCode, body: chunks.join(''), truncated: true });
            res.destroy();
          }
        };
        res.on('data', (chunk) => {
          if (settled) return;
          if (!binary) { appendText(decoder.write(chunk)); return; }
          size += chunk.length;
          if (size > limit) {
            fail(new Error(`图片超过大小限制（${limit} 字节）`), false);
            res.destroy();
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => {
          if (settled) return;
          if (binary) done({ statusCode, buffer: Buffer.concat(chunks) });
          else {
            appendText(decoder.end());
            done({ statusCode, body: chunks.join(''), truncated: false });
          }
        });
      });
      req.on('timeout', () => {
        const error = new Error(`请求超时：${url.hostname}`);
        fail(error, true);
        req.destroy(error);
        response?.destroy();
      });
      req.on('error', (error) => fail(error, true));
      req.end();
    } catch (error) {
      fail(error, true);
      req?.destroy();
    }
  });
}

/**
 * 依次尝试已校验的地址（IPv4 优先，见 orderAddresses）。
 *
 * 单地址时沿用原来的「整个 20 秒总预算」，多地址时才启用单次尝试预算与失败切换：
 * 这样「只有一个地址、对方慢慢滴流」仍然会等满总时限（由总 deadline 兜底），
 * 而「第一个地址是坏的 IPv6」不会再白等 20 秒。
 * 所有地址都失败时抛最后一个错误（保留原始错误文案，便于日志排查）。
 */
async function requestOnce(url, addresses, limit, binary = false) {
  const list = (Array.isArray(addresses) ? addresses : [addresses]).filter(Boolean);
  if (!list.length) throw new Error(`没有可用地址：${url.hostname}`);
  const deadline = Date.now() + REQUEST_TIMEOUT_MS;
  let lastError = null;
  const attempts = Math.min(list.length, MAX_ADDRESS_ATTEMPTS);
  for (let i = 0; i < attempts; i += 1) {
    const remaining = deadline - Date.now();
    if (remaining <= 250) break;
    const budget = list.length === 1
      ? REQUEST_TIMEOUT_MS
      : Math.min(ATTEMPT_TIMEOUT_MS, remaining);
    const outcome = await attemptOnce(url, list[i], limit, binary, budget);
    if (outcome.ok) return outcome.result;
    lastError = outcome.error;
    if (!outcome.retryable) throw outcome.error;
    if (i < attempts - 1) {
      // 换地址重试：只换连接目标，Host/SNI/路径全部不变（同一个站点）。
      continue;
    }
  }
  if (lastError && attempts > 1) {
    lastError.message = `${lastError.message}（已尝试 ${attempts} 个地址）`;
  }
  throw lastError ?? new Error(`请求失败：${url.hostname}`);
}

export async function safeFetch(urlString, maxChars = 50000, options) {
  validateLimit(maxChars, 'maxChars');
  const MAX_REDIRECTS = 5;
  let { url, addresses } = await validateFetchUrl(urlString,options);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const result = await requestOnce(url, addresses, maxChars);
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      if (!result.redirect) throw new Error(`重定向缺少 Location: ${result.statusCode}`);
      const next = new URL(result.redirect, url).toString();
      ({ url, addresses } = await validateFetchUrl(next,options));
      continue;
    }
    const body = result.body || '';
    return {
      url: url.toString(),
      statusCode: result.statusCode,
      truncated: result.truncated,
      body,
    };
  }
  throw new Error('重定向次数过多，已停止');
}

/** 仅接受 DSH 支持的四种图片格式：PNG/JPEG/GIF/WebP。 */
export function looksLikeImageBuffer(buf) {
  if (!buf || buf.length < 12) return false;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return true;
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  return false;
}

/** 抓取图片字节并返回 Buffer（带 SSRF 防护，且校验确实为图片）。 */
export async function safeFetchResourceBuffer(urlString,maxBytes=32*1024*1024){
  validateLimit(maxBytes,'maxBytes');if(maxBytes>128*1024*1024)throw Error('附件超过128MB限制');
  let {url,addresses}=await validateFetchUrl(urlString,{recoverQqImages:true,recoverProxyDns:true});
  for(let i=0;i<=5;i++){const r=await requestOnce(url,addresses,maxBytes,true);if([301,302,303,307,308].includes(r.statusCode)){if(!r.redirect)throw Error('附件重定向无地址');({url,addresses}=await validateFetchUrl(new URL(r.redirect,url).href,{recoverQqImages:true,recoverProxyDns:true}));continue;}if(r.statusCode<200||r.statusCode>=300)throw Error('附件下载HTTP '+r.statusCode);return {url:url.href,buffer:r.buffer};}throw Error('附件重定向过多');
}

export async function safeFetchBuffer(urlString, maxBytes = 8 * 1024 * 1024) {
  validateLimit(maxBytes, 'maxBytes');
  const MAX_REDIRECTS = 5;
  let { url, addresses } = await validateFetchUrl(urlString, { recoverQqImages: true });
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    const result = await requestOnce(url, addresses, maxBytes, true);
    if ([301, 302, 303, 307, 308].includes(result.statusCode)) {
      if (!result.redirect) throw new Error(`重定向缺少 Location: ${result.statusCode}`);
      const next = new URL(result.redirect, url).toString();
      ({ url, addresses } = await validateFetchUrl(next, { recoverQqImages: true }));
      continue;
    }
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(`图片抓取失败：HTTP ${result.statusCode}`);
    }
    if (!looksLikeImageBuffer(result.buffer)) {
      throw new Error(`抓取内容不是有效图片（PNG/JPEG/GIF/WebP）`);
    }
    return { url: url.toString(), statusCode: result.statusCode, buffer: result.buffer };
  }
  throw new Error('重定向次数过多，已停止');
}

export function biliMediaUrl(value){
  const u=new URL(String(value).startsWith('//')?'https:'+value:String(value));
  if(u.protocol==='http:'&&!u.port)u.protocol='https:';
  if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||!/(?:^|\.)(?:hdslb\.com|bilivideo\.com|bilivideo\.cn)$/.test(u.hostname))throw Error('仅允许B站官方媒体CDN');
  return u.href;
}
// Same pinned-DNS and redirect validation as web fetch, bounded bytes, no cookies.
export async function safeFetchBiliMedia(value,maxBytes=8*1024*1024){
  validateLimit(maxBytes,'maxBytes');let target=biliMediaUrl(value);
  for(let i=0;i<=5;i++){
    const {url,addresses}=await validateFetchUrl(target,{recoverProxyDns:true}),r=await requestOnce(url,addresses,maxBytes,true);
    if([301,302,303,307,308].includes(r.statusCode)){if(!r.redirect)throw Error('媒体重定向缺少地址');target=biliMediaUrl(new URL(r.redirect,url).href);continue;}
    if(r.statusCode<200||r.statusCode>=300||r.truncated)throw Error('媒体下载失败或超过大小限制：'+r.statusCode);
    return r.buffer;
  }throw Error('媒体重定向过多');
}
