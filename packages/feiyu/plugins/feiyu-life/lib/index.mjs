// Native Cordis plugin. It owns only a health route, a read-only tool and a
// host service. Bridge/MCP processes remain owned by the bundle launcher.
export const name = 'feiyu-life';
export const inject = ['tools', 'webServer'];
export const VERSION = '0.3.0';
export const HEALTH_PATH = '/api/feiyu-life/health';
export const TOOL_NAME = 'feiyu_life_status';

const loopback = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function bridgeOrigin(value = 'http://127.0.0.1:3100') {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Feiyu health bridge must be an HTTP loopback origin');
  }
  return url.origin;
}

export async function readBridgeHealth(origin, signal) {
  try {
    const response = await fetch(`${origin}/health/ready`, {
      method: 'GET', redirect: 'error',
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(1500)]),
    });
    // Discard the body: do not expose bridge pid, paths or account state.
    await response.body?.cancel();
    return response.status === 200 ? 'ready' : response.status === 503 ? 'starting' : 'unavailable';
  } catch {
    signal?.throwIfAborted();
    return 'offline';
  }
}

export function apply(ctx, config = {}) {
  const origin = bridgeOrigin(config.bridgeUrl);
  const active = new Set();
  let loaded = true;
  const snapshot = async signal => {
    signal?.throwIfAborted();
    const abort = new AbortController();
    active.add(abort);
    try {
      return {
        implementation: 'dsh-cordis-bundle', version: VERSION, loaded,
        bridge: await readBridgeHealth(origin, AbortSignal.any([abort.signal, signal ?? new AbortController().signal])),
        socialActions: false,
      };
    } finally { active.delete(abort); }
  };
  ctx.provide('feiyuLife', { version: VERSION, snapshot });
  ctx.on('dispose', () => {
    loaded = false;
    for (const abort of active) abort.abort();
    active.clear();
  });
  ctx.tools.register({
    name: TOOL_NAME,
    description: 'Read Feiyu Life plugin and local bridge readiness. Returns no account data and performs no social action.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          implementation: { type: 'string' }, version: { type: 'string' },
          loaded: { type: 'boolean' }, bridge: { type: 'string', enum: ['ready', 'starting', 'offline', 'unavailable'] },
          socialActions: { type: 'boolean' },
        }, required: ['implementation', 'version', 'loaded', 'bridge', 'socialActions'],
      },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    timeoutMs: 2500,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => {
      if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length) throw new Error('No arguments accepted');
      return snapshot(exec.signal);
    },
  });
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: HEALTH_PATH,
    handler: async (req, res) => {
      const reply = (status, value) => {
        if (res.destroyed) return;
        res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify(value));
      };
      if (!loopback.has(req.socket.remoteAddress) || req.headers['sec-fetch-site'] === 'cross-site'
          || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) {
        return reply(403, { ok: false });
      }
      if (req.method !== 'GET') return reply(405, { ok: false });
      const abort = new AbortController();
      res.once('close', () => { if (!res.writableEnded) abort.abort(); });
      try { return reply(200, { ok: true, ...await snapshot(abort.signal) }); }
      catch { return reply(503, { ok: false, loaded }); }
    },
  }), 'feiyu-life.health');
}
