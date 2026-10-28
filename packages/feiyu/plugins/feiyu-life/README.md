# Feiyu Life — DSH host bundle

This is a native DSH Cordis bundle tested against `0.2.0-rc.2`. `package.json`
declares `dsh.bundle.patch`; its patch mounts `lib/index.mjs` through the real
DSH loader. No transpilation is required.

The application is a composition installed by `feiyu-dsh.mjs`:

| Bundle | Responsibility |
| --- | --- |
| qq-agent-presets | Safe QQ presets, signed chat cycle host, ephemeral thought host, creator isolation source |
| qq-mode-console | Native DSH settings seam for bridge mode |
| qq-contact-memory | Separate portrait and image memory preset; no tools |
| qq-intimacy-judge | Separate relationship assessment preset; no tools |
| qq-qzone-review | Separate Qzone reading decision preset; no tools |
| feiyu-life | Read-only readiness tool, host service and local health route |

Existing bridge implementations under `../../src/` retain the actual cognition,
memory, QQ actions, activities, voice and companion gateway. DSH native MCP
client rows launch their safe stdio adapters. The launcher owns bridge processes.
The entry uses the same mind and does not read role cards or start social actions.

`GET /api/feiyu-life/health` accepts loopback clients and exposes minimal
plugin/bridge readiness. `feiyu_life_status` uses the DSH ToolRuntime output
contract and returns sanitized status. Bridge health defaults to
`http://127.0.0.1:3100`; a profile patch may set `config.bridgeUrl` to another
literal loopback HTTP origin. This read-only route returns no tokens, local
paths, messages or account IDs.

Cordis owns tool, service and route lifetime. Unloading removes all three and
aborts in-flight health requests. It never stops another plugin or the bridge.
The profile installer records exact before/after files and refuses automatic
rollback if the user changed those files or links after installation.

Optional bundles `dsh-bili-scroll` and `dsh-read-animation` retain their own
licenses. Bili automation/comment/DM is off by default. Python, uv, FFmpeg and
sharp/native dependencies are installed separately. DS official TTS source is
excluded because its upstream BSD declaration lacks a full license notice;
optional edge TTS in the bridge remains independent of it.

No existing DSH home, credentials, sessions, databases, role cards, runtime
binaries, node_modules or SnowLuma installation is included.
