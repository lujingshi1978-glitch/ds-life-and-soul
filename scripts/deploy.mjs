#!/usr/bin/env node
// Local deployment controller. Importing has no I/O or process side effects.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash, randomBytes } from "node:crypto";
import { stopOwned, inspectProcess } from "./owned-processes.mjs";
import { createInterface } from "node:readline/promises";
import { saveQqConfig, probeQqGateway, qqErrorMessage, createQqPrompts } from "./qq-setup.mjs";
import { resolvePython311 } from "./python-runtime.mjs";
export const REPO = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  ),
  CORE = path.join(REPO, "packages/feiyu");
const local = path.join(REPO, ".local"),
  setupFile = path.join(local, "installation.json"),
  registryFile = path.join(local, "processes.json");
export const DEFAULTS = Object.freeze({
  profile: "feiyu",
  dshPort: 3081,
  consolePort: 3110,
  companionPort: 3117,
  ownerQQ: "1",
  voice: true,
  browser: true,
  video: false,
  model: "deepseek-flash",
  provider: "deepseek-official",
});
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8")),
  write = (file, value) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", {
      mode: 0o600,
    });
    fs.renameSync(tmp, file);
  };
const exists = (file) => fs.existsSync(file),
  delay = (ms) => new Promise((r) => setTimeout(r, ms));
export function normalize(input = {}) {
  const c = { ...DEFAULTS, ...input };
  if (!/^[a-zA-Z0-9_-]{1,50}$/.test(c.profile)) throw Error("profile名称无效");
  for (const key of ["dshPort", "consolePort", "companionPort"])
    if (!Number.isInteger(c[key]) || c[key] < 1024 || c[key] > 65535)
      throw Error("端口需在1024至65535之间");
  if (new Set([c.dshPort, c.consolePort, c.companionPort]).size !== 3)
    throw Error("服务端口不能重复");
  if (!/^\d{1,15}$/.test(String(c.ownerQQ))) throw Error("管理员标识须为数字");
  for (const k of ["voice", "browser", "video"])
    if (typeof c[k] !== "boolean") throw Error("安装选项必须为布尔值");
  for (const k of ["model", "provider"])
    if (typeof c[k] !== "string" || !/^[\w./:-]{1,100}$/.test(c[k]))
      throw Error("模型名称无效");
  return c;
}
export function commandPlan(c) {
  c = normalize(c);
  return {
    profile: c.profile,
    dshHome: c.dshHome || path.join(local, "dsh-home"),
    dshPort: c.dshPort,
    consolePort: c.consolePort,
    companionPort: c.companionPort,
    features: { voice: c.voice, browser: c.browser, video: c.video },
    externalGateway: "OneBot服务和平台登录由用户自行准备；不下载或启动SnowLuma",
    actions: [
      "安装锁定的核心依赖",
      "安装官方DSH或验证显式选择的现有安装",
      "建立独立feiyu profile",
      "生成全新的角色档案和本机凭据",
      "安装所选语音/浏览器依赖",
      "启动DSH和肥鱼并打开生活台",
    ],
  };
}
export function locateNpm() {
  const candidates = [
    process.env.FEIYU_NPM_CLI,
    path.join(
      path.dirname(process.execPath),
      "node_modules/npm/bin/npm-cli.js",
    ),
  ];
  if (process.platform === "win32") {
    try {
      for (const file of execFileSync("where.exe", ["npm.cmd"], {
        encoding: "utf8",
        windowsHide: true,
      })
        .trim()
        .split(/\r?\n/))
        candidates.push(
          path.join(path.dirname(file), "node_modules/npm/bin/npm-cli.js"),
        );
    } catch {}
  }
  for (const file of candidates)
    if (file && path.isAbsolute(file) && exists(file)) return file;
  throw Error("未找到npm，请安装包含npm的Node.js 24 LTS");
}
export function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || REPO,
      env: options.env || process.env,
      windowsHide: true,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let out = "",
      err = "";
    let timedOut = false,
      childIdentity = null;
    child.once("spawn", () => {
      if (process.platform === "win32")
        childIdentity = inspectProcess(child.pid);
    });
    const timer = setTimeout(
      () => {
        timedOut = true;
        if (process.platform === "win32" && childIdentity) {
          const result = stopOwned([
            {
              id: "dependency-install",
              pid: child.pid,
              command,
              entry: args[0],
              identityHash: identityHash(childIdentity),
            },
          ]);
          if (!result.ok)
            reject(
              Error("安装超时，部分进程身份变化，请核对本机安装进程后重试"),
            );
        } else child.kill();
      },
      options.timeoutMs || 15 * 60 * 1000,
    );
    timer.unref();
    if (options.capture) {
      child.stdout.on("data", (b) => (out += b));
      child.stderr.on("data", (b) => (err = (err + b).slice(-6000)));
    }
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut)
        reject(
          Error(
            "依赖安装或命令等待超时" +
              (options.phase ? "：" + options.phase : ""),
          ),
        );
      else if (code === 0) resolve({ stdout: out });
      else
        reject(
          Error(
            "依赖或命令执行失败，退出码 " +
              code +
              (options.capture ? "（详情见本机日志）" : ""),
          ),
        );
    });
  });
}
async function npm(args, cwd) {
  return run(
    process.execPath,
    [
      locateNpm(),
      ...args,
      "--no-audit",
      "--fund=false",
      "--registry=https://registry.npmjs.org",
    ],
    { cwd },
  );
}
export function pythonPath() {
  return path.join(
    REPO,
    "work/integration-runtime/media/.venv",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
}
export function buildEnvironment(c) {
  const env = {
    ...process.env,
    DSH_HOME: c.dshHome,
    FEIYU_BRIDGE_URL: "http://127.0.0.1:" + c.consolePort,
    FEIYU_MEDIA_PYTHON: pythonPath(),
    FEIYU_ASR_MODEL: path.join(local, "models/whisper-small"),
    HF_HOME: path.join(local, "hf-cache"),
    FEIYU_CREATOR_RUNTIME: path.join(CORE, "work/creator-runtime/runtime-v1"),
    FEIYU_BILI_HOME: path.join(c.dshHome, "bili-duty"),
    PYTHONUTF8: "1",
  };
  delete env.DSH_LAUNCH_TOKEN;
  return env;
}
export function seedConfig(c) {
  c = normalize(c);
  const configFile = path.join(CORE, "config.json");
  if (exists(configFile)) return { created: false };
  fs.mkdirSync(path.join(CORE, "state"), { recursive: true });
  const config = {
    dsh: {
      baseUrl: "http://127.0.0.1:" + c.dshPort,
      provider: c.provider,
      model: c.model,
      installRoot: c.dshInstall,
      profile: c.profile,
      reasoningEffort: "high",
      authToken: "",
      allowRemote: false,
    },
    ownerQQ: Number(c.ownerQQ),
    sessionCwd: path.join(CORE, "work/session"),
    consolePort: c.consolePort,
    consoleToken: "",
    companion: { port: c.companionPort },
    snowluma: {
      enabled: false,
      wsUrl: "ws://127.0.0.1:3001",
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "",
      followDiscoveredEndpoint: false,
      homeDir: "",
    },
    agentPreset: "qq-chat",
    workspaceTitle: "肥鱼的通信",
    allow: { private: [], groups: [] },
    deny: { private: [], groups: [] },
    allowAllWhenEmpty: false,
    role: { maxInjectChars: 6000 },
    social: { enabled: false },
    slang: { enabled: false, autoResearch: false },
    socialV2: {
      enabled: true,
      agentPreset: "qq-chat-v2",
      proactive: { enabled: false, ownerOnly: true },
      mind: { enabled: true, version: 3, v2Root: "cognition-v3" },
      tools: {
        sendMessage: true,
        reply: true,
        sendBurst: true,
        sendVoice: false,
      },
      voice: {
        enabled: c.voice,
        tts: {
          enabled: c.voice,
          provider: "edge-tts",
          python: pythonPath(),
          voice: "zh-CN-XiaoxiaoNeural",
          ownerOnly: true,
        },
      },
    },
    webSearch: { provider: "deepseek" },
    nightRest: { enabled: true },
  };
  fs.mkdirSync(config.sessionCwd, { recursive: true });
  write(configFile, config);
  write(path.join(CORE, "state/current-role.json"), {
    role: "肥鱼温柔撒娇",
    mode: "normal",
  });
  write(path.join(CORE, "state/mode.json"), { mode: "reserved2" });
  write(path.join(CORE, "state/app-integrations.json"), {
    creationEnabled: false,
    complexTasks: false,
    browserInteract: false,
    openbiliclaw: false,
    multiSiteActivity: false,
  });
  return { created: true };
}
export async function install(
  raw,
  { skipDependencies = false, installRun = run } = {},
) {
  const c = normalize(raw);
  const voicePython = c.voice && !skipDependencies
    ? resolvePython311({env:exists(pythonPath()) ? {...process.env, FEIYU_PYTHON:pythonPath()} : process.env})
    : null;
  c.dshHome = path.resolve(c.dshHome || path.join(local, "dsh-home"));
  if (
    c.dshInstall &&
    !exists(path.join(path.resolve(c.dshInstall), "lib/bin.js"))
  )
    throw Error("显式指定的DSH安装不存在");
  c.dshInstall = path.resolve(
    c.dshInstall ||
      path.join(REPO, ".runtime/dsh/node_modules/@deepseek-ai/dsh"),
  );
  console.log(JSON.stringify(commandPlan(c), null, 2));
  if (!skipDependencies) {
    await npm(["ci", "--ignore-scripts"], CORE);
    if (!exists(path.join(c.dshInstall, "lib/bin.js"))) {
      const home = path.join(REPO, ".runtime/dsh");
      fs.mkdirSync(home, { recursive: true });
      for (const name of ["package.json", "package-lock.json"]) {
        const dest = path.join(home, name);
        if (!exists(dest))
          fs.copyFileSync(path.join(REPO, "templates/dsh-runtime", name), dest);
      }
      await npm(["ci"], home);
    }
  }
  if (
    !exists(path.join(c.dshInstall, "package.json")) ||
    json(path.join(c.dshInstall, "package.json")).version !== "0.2.0-rc.2"
  )
    throw Error("需要已验证的DSH 0.2.0-rc.2安装");
  seedConfig(c);
  const consoleSecret = path.join(CORE, "state/console-token");
  if (!exists(consoleSecret))
    fs.writeFileSync(consoleSecret, randomBytes(32).toString("hex"), {
      mode: 0o600,
      flag: "wx",
    });
  const lifecycle = await import(
    pathToFileURL(path.join(CORE, "scripts/feiyu-dsh.mjs")).href
  );
  const state = lifecycle.inspectProfile({
    dshHome: c.dshHome,
    profile: c.profile,
  });
  if (state.installed && !state.ok)
    throw Error("已有profile被外部修改，请先核对并手动解决");
  if (!state.installed)
    lifecycle.installProfile({
      root: CORE,
      dshHome: c.dshHome,
      profile: c.profile,
      optional: c.video ? ["dsh-bili-scroll", "dsh-read-animation"] : [],
      bridgeUrl: "http://127.0.0.1:" + c.consolePort,
    });
  if (c.browser && !skipDependencies) {
    const dir = path.join(REPO, "work/integration-runtime/browser");
    fs.mkdirSync(dir, { recursive: true });
    await npm(["install", "--save-exact", "@playwright/mcp@0.0.83"], dir);
  }
  if (c.video && !skipDependencies)
    for (const name of ["dsh-bili-scroll", "dsh-read-animation"])
      await npm(
        ["install", "--ignore-scripts"],
        path.join(CORE, "plugins", name),
      );
  if (c.voice && !skipDependencies) {
    const module = await import(
      pathToFileURL(path.join(REPO, "portable/voice-runtime/install.mjs")).href
    );
    const voice = await module.installVoiceRuntime({
      repoRoot: REPO,
      voice: true,
      pythonCommand: voicePython,
      run: installRun,
    });
    if (!voice.ready)
      throw Error(
        "语音运行时未就绪：" +
          (voice.failure?.code || voice.status || "unknown") +
          "；可查看work/integration-runtime/media/voice-runtime.json后重试，或先选文字模式",
      );
  }
  write(path.join(local, "hotkey-config.json"), {
    version: 1,
    gateway_url: "http://127.0.0.1:" + c.companionPort + "/pet",
    credentials_file: path.join(CORE, "state/companion-gateway.json"),
    hotkey: "Ctrl+Alt+Space",
    timeout_seconds: 180,
    voice_playback: true,
  });
  write(setupFile, c);
  return { ok: true, installed: true, profile: c.profile };
}
export async function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(700, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}
function processIdentity(pid) {
  if (process.platform !== "win32") return null;
  try {
    const script =
      '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$p=Get-CimInstance Win32_Process -Filter "ProcessId = ' +
      Number(pid) +
      '";if($p){$p|Select-Object ProcessId,ExecutablePath,CommandLine,CreationDate|ConvertTo-Json -Compress}';
    return JSON.parse(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-WindowStyle",
          "Hidden",
          "-Command",
          script,
        ],
        { encoding: "utf8", windowsHide: true },
      ).trim(),
    );
  } catch {
    return null;
  }
}
function identityHash(p) {
  return createHash("sha256").update(JSON.stringify(p)).digest("hex");
}
function registry() {
  return exists(registryFile) ? json(registryFile) : [];
}
function launch(id, command, args, { cwd, env }) {
  const state = path.join(local, "logs");
  fs.mkdirSync(state, { recursive: true });
  const out = fs.openSync(path.join(state, id + ".stdout.log"), "a"),
    err = fs.openSync(path.join(state, id + ".stderr.log"), "a");
  try {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
      detached: true,
      stdio: ["ignore", out, err],
    });
    return new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("spawn", () => {
        child.unref();
        const identity = processIdentity(child.pid),
          items = registry().filter((x) => x.id !== id);
        items.push({
          id,
          pid: child.pid,
          command,
          entry: args[0],
          identityHash: identity ? identityHash(identity) : null,
        });
        write(registryFile, items);
        resolve(child.pid);
      });
    });
  } finally {
    fs.closeSync(out);
    fs.closeSync(err);
  }
}
async function waitPort(port, pid) {
  for (let n = 0; n < 120; n++) {
    if (pid)
      try {
        process.kill(pid, 0);
      } catch {
        throw Error("服务启动进程已退出，请查看.local/logs；端口 " + port);
      }
    if (await portOpen(port)) return;
    await delay(500);
  }
  throw Error("服务未启动，请查看.local/logs；端口 " + port);
}
export function ownDshLaunchToken(log, port) {
  if (typeof log !== "string") return null;
  const matches = [
    ...log.matchAll(
      /http:[/][/](?:127[.]0[.]0[.]1|localhost):([0-9]+)[/][?]token=([A-Za-z0-9_-]{16,512})(?![A-Za-z0-9_-])/g,
    ),
  ];
  for (const match of matches.reverse())
    if (Number(match[1]) === port) return match[2];
  return null;
}
export async function start({ open = true, client = true } = {}) {
  if (!exists(setupFile)) throw Error("请先运行 setup");
  const c = normalize(json(setupFile)),
    env = buildEnvironment(c),
    dshEntry = path.join(c.dshInstall, "lib/bin.js");
  const owned = registry();
  for (const [id, port] of [
    ["dsh", c.dshPort],
    ["feiyu", c.consolePort],
    ["feiyu", c.companionPort],
  ]) {
    if (await portOpen(port)) {
      const record = owned.find((p) => p.id === id),
        current = record && processIdentity(record.pid);
      if (!current || identityHash(current) !== record.identityHash)
        throw Error("端口已被其他实例占用，不接管已有服务：" + port);
    }
  }
  for (const [id, port] of [
    ["dsh", c.dshPort],
    ["feiyu", c.consolePort],
  ]) {
    if (await portOpen(port)) {
      const known = owned.find((p) => p.id === id),
        current = known && processIdentity(known.pid);
      if (!known || !current || identityHash(current) !== known.identityHash)
        throw Error("端口已被其他实例占用，不接管已有服务：" + port);
      continue;
    }
    if (id === "feiyu") {
      const log = path.join(local, "logs/dsh.stdout.log");
      if (exists(log)) {
        const token = ownDshLaunchToken(
          fs.readFileSync(log, "utf8").slice(-1000000),
          c.dshPort,
        );
        if (token) env.DSH_LAUNCH_TOKEN = token;
      }
    }
    const pid = await launch(
      id,
      process.execPath,
      id === "dsh"
        ? [
            dshEntry,
            "--profile",
            c.profile,
            "--port",
            String(c.dshPort),
            "--host",
            "127.0.0.1",
            "--no-open",
          ]
        : [path.join(CORE, "src/bridge.js")],
      { cwd: id === "dsh" ? REPO : CORE, env },
    );
    await waitPort(port, pid);
  }
  if (client && c.voice && exists(pythonPath())) {
    const known = registry().find((p) => p.id === "hotkey"),
      current = known && processIdentity(known.pid);
    if (!current || identityHash(current) !== known.identityHash)
      await launch(
        "hotkey",
        pythonPath(),
        [
          "-m",
          "feiyu_hotkey",
          "--config",
          path.join(local, "hotkey-config.json"),
        ],
        { cwd: path.join(REPO, "clients/feiyu-hotkey"), env },
      );
  }
  if (open) {
    const tokenFile = path.join(CORE, "state/console-token");
    for (let n = 0; n < 20 && !exists(tokenFile); n++) await delay(300);
    if (!exists(tokenFile)) throw Error("等待生活台令牌生成，请稍后重试");
    const token = fs.readFileSync(tokenFile, "utf8").trim();
    const url =
      "http://127.0.0.1:" +
      c.consolePort +
      "/?token=" +
      encodeURIComponent(token) +
      "#overview";
    if (process.platform === "win32") {
      const edge = [
        process.env["ProgramFiles(x86)"],
        process.env.ProgramFiles,
        process.env.LOCALAPPDATA,
      ]
        .filter(Boolean)
        .map((d) => path.join(d, "Microsoft/Edge/Application/msedge.exe"))
        .find(exists);
      if (edge) {
        const child = spawn(edge, [url], {
          stdio: "ignore",
          detached: true,
          windowsHide: false,
        });
        child.unref();
      } else console.log("请打开本机生活台并使用本机生成的控制台令牌。");
    } else
      console.log(
        "生活台就绪。访问令牌保存在packages/feiyu/state/console-token。",
      );
  }
  return {
    ok: true,
    console: "http://127.0.0.1:" + c.consolePort,
    modelLogin: "http://127.0.0.1:" + c.dshPort,
    profile: c.profile,
  };
}
export function stop() {
  const result = stopOwned(registry());
  write(registryFile, result.remaining);
  return result;
}
export async function doctor() {
  const c = exists(setupFile) ? json(setupFile) : null;
  return {
    ok: !!c,
    node: process.version,
    configured: !!c,
    coreDependencies: exists(path.join(CORE, "node_modules/js-yaml")),
    services: c
      ? {
          dsh: await portOpen(c.dshPort),
          feiyu: await portOpen(c.consolePort),
          voiceGateway: await portOpen(c.companionPort),
        }
      : {},
    voiceRuntime: exists(pythonPath()),
    profile: c?.profile || null,
    privateDataIncluded: false,
    qq: await checkQq(),
  };
}
export async function checkQq() {
  const file = path.join(CORE, "config.json");
  if (!exists(file)) return {ok:true,configured:false,enabled:false};
  let cfg; try { cfg = json(file); } catch { return {ok:false,enabled:false,message:"本机配置无法解析，请先核对JSON格式。"}; }
  if (cfg.snowluma?.enabled !== true) return {ok:true,configured:true,enabled:false};
  try { return {enabled:true,...await probeQqGateway({...cfg.snowluma,ownerQQ:cfg.ownerQQ,privateIds:cfg.allow?.private,groupIds:cfg.allow?.groups})}; }
  catch (e) { return {ok:false,enabled:true,message:qqErrorMessage(e)}; }
}
async function wizard() {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log(
      "肥鱼首次配置。平台登录和模型密钥在各自本机界面完成，不在这里收集。",
    );
    const owner =
      (await rl.question("管理员QQ（仅桌面使用可留空）: ")).trim() || "1";
    const voice =
      (await rl.question("安装Ctrl+Alt+空格语音和透明小窗？[Y/n] "))
        .trim()
        .toLowerCase() !== "n";
    const browser =
      (await rl.question("安装网页读取适配器（需要本机Edge）？[Y/n] "))
        .trim()
        .toLowerCase() !== "n";
    const video =
      (await rl.question("安装B站/动图可选插件？[y/N] "))
        .trim()
        .toLowerCase() === "y";
    const qqWizard = (await rl.question("安装完成后配置QQ接入？需先自行安装并登录网关 [y/N] ")).trim().toLowerCase() === "y";
    return { ...DEFAULTS, ownerQQ: owner, voice, browser, video, qqWizard };
  } finally {
    rl.close();
  }
}
export async function configureQq() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw Error("QQ向导需要交互终端，请双击 scripts/配置QQ.cmd。");
  const configFile = path.join(CORE, "config.json");
  if (!exists(configFile)) throw Error("请先运行启动肥鱼完成安装。");
  const before = fs.readFileSync(configFile); let current;
  try { current = JSON.parse(before); } catch { throw Error("本机配置无法解析，请先核对JSON格式。"); }
  const prompts = createQqPrompts(), ask = prompts.ask;
  try {
    console.log("QQ接入：先在网关登录账号，开启本机HTTP服务端和正向WebSocket服务端，两个服务设置相同令牌。\n支持按OneBot11协议连接；不同实现的扩展功能仍需实际验证。\n不下载网关、不发送测试消息、不开放所有好友或自主联系权限。");
    await ask("网关名称（仅用于本次确认）", "NapCat / SnowLuma / 其他OneBot11");
    const wsUrl = await ask("正向WebSocket根地址", current.snowluma?.wsUrl || "ws://127.0.0.1:3001");
    const httpUrl = await ask("HTTP根地址", current.snowluma?.httpUrl || "http://127.0.0.1:3000");
    const accessToken = await prompts.secret("连接令牌（不回显，留空保留已有值）", current.snowluma?.accessToken || "");
    const ownerQQ = await ask("管理员QQ（不是肥鱼登录的账号）", String(current.ownerQQ || ""));
    const privateText = await ask("允许回复的其他QQ，逗号分隔；填 - 清空，管理员会单独保留", (current.allow?.private || []).filter(x => String(x) !== String(ownerQQ)).join(","));
    const groupText = await ask("允许回复的群号，逗号分隔；填 - 清空", (current.allow?.groups || []).join(","));
    const input = {wsUrl,httpUrl,accessToken,ownerQQ,privateIds:privateText === "-" ? [] : privateText,groupIds:groupText === "-" ? [] : groupText};
    console.log("将仅启用QQ连接并保存上述聊天范围。现有黑名单、核心、记忆与自主联系开关保留。\n检查只调用查询登录和在线状态的接口；通过后才保存，并备份旧配置。");
    if ((await ask("检查并保存？输入 yes 确认", "no")).toLowerCase() !== "yes") return {ok:true,saved:false,cancelled:true};
    const c = exists(setupFile) ? json(setupFile) : DEFAULTS;
    const result = await saveQqConfig({root:REPO,input,expectedBytes:before,isRunning:async()=>await portOpen(Number(current.consolePort || c.consolePort)) || await portOpen(Number(current.companion?.port || c.companionPort))});
    console.log("QQ连接和登录检查通过，已保存。请重新运行启动肥鱼；登录账号与双方令牌不写入本次输出。");
    return result;
  } catch (e) { throw Error(qqErrorMessage(e)); }
  finally { prompts.close(); }
}
export async function main(argv = process.argv.slice(2)) {
  const [action = "launch", ...flags] = argv;
  const configArg = flags.find((x) => x.startsWith("--config="));
  const supplied = configArg ? json(path.resolve(configArg.slice(9))) : null;
  if (action === "plan") return commandPlan(supplied || DEFAULTS);
  if (action === "doctor") return doctor();
  if (action === "qq") return configureQq();
  if (action === "qq-check") return checkQq();
  if (action === "stop") return stop();
  if (action === "uninstall") {
    if (!exists(setupFile)) return { ok: true, removed: false };
    const c = json(setupFile);
    const api = await import(
      pathToFileURL(path.join(CORE, "scripts/feiyu-dsh.mjs")).href
    );
    return api.uninstallProfile({ dshHome: c.dshHome, profile: c.profile });
  }
  if (action === "setup") {
    const c = supplied || await wizard(), result = await install(c);
    if (c.qqWizard) result.qq = await configureQq();
    return result;
  }
  if (!["launch", "start"].includes(action))
    throw Error("使用 launch|setup|start|stop|doctor|plan|qq|qq-check|uninstall");
  if (!exists(setupFile)) {
    const c = supplied || await wizard(); await install(c);
    if (c.qqWizard) await configureQq();
  }
  return start({
    open: !flags.includes("--no-open"),
    client: !flags.includes("--no-client"),
  });
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main()
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    });
