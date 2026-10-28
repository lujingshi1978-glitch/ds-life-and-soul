// Shared read-only SnowLuma status probe. qq_status uses this in the main QQ MCP.
// Direct execution remains a compatibility stdio entry for unmigrated DSH profiles.
//
// 工具：
//   snowluma_status   —— 检查网关是否在线（只读：HTTP get_login_info）与账号信息
//
// ── 为什么这里**没有**启停 SnowLuma 的工具（2026-09-20 移除，不要加回来）────────────
//
// 曾经有 `start_snowluma` / `stop_snowluma`（`spawn launcher.bat` / `taskkill`），默认关闭、
// 需要 `snowluma.allowProcessControl: true` 才注册。它们被移除，理由不是"危险"，而是**许可**：
//
//   SnowLuma EULA §5.4（中文为准）：「除事先取得著作权人的书面授权外，您仅可为 LICENSE 允许的
//   非商业用途，以专有组件随本软件提供的形式运行该组件；不得复制、修改、单独再分发或再许可该组件。
//   **将其并入第三方安装包或 Docker 镜像、通过自动化脚本部署**，或者将其用于任何商业用途，
//   均须事先取得书面授权。」
//
// 原生组件是**专有组件**；由本程序**程序化启动/结束**它，落在"通过自动化脚本部署"的射程内。
// 即便是"用户已装好、我们帮忙拉起"，也不值得为这点便利去踩一条需要书面授权的条款。
//
// 设计不变量 L6（见规划集 QSH_PLAN.md §6.0）：**QSH 只探测、不部署**——
// 永不安装、复制、打包或自动部署 SnowLuma 及其原生组件，也不程序化启停其进程。
// 用户在 QQ 侧不可用时得到的应该是**可操作的提示**（"请自行启动 SnowLuma"），而不是被代劳。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function loadConfig() {
  try {
    let text = fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function getHostConfig(c) {
  const httpUrl = (c.snowluma?.httpUrl ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
  return { httpUrl, token: c.snowluma?.accessToken ?? '' };
}

const unreachableHint='SnowLuma 网关不可达。请自行启动 SnowLuma，并检查 config.json 的 snowluma.httpUrl 是否为实际 OneBot HTTP API 地址。';
export async function gatewayInfo({config=loadConfig(),fetcher=fetch,includeStatus=false,method='GET',timeoutMs=5000}={}) {
  const { httpUrl, token } = getHostConfig(config);
  const request=action=>fetcher(`${httpUrl}/${action}`,{
    method,headers:{...(method==='POST'?{'content-type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(method==='POST'?{body:'{}'}:{}),signal:AbortSignal.timeout(timeoutMs)
  });
  try {
    const res = await request('get_login_info');
    if (!res.ok) {
      const hint = res.status === 426 ? 'HTTP 426：snowluma.httpUrl 可能指向了 WebSocket 端口，请改为 OneBot HTTP API 地址。' : '';
      return { reachable: false, httpStatus: res.status, hint:hint+unreachableHint };
    }
    const body = await res.json();
    if (body?.status === 'ok' && body?.retcode === 0) {
      const info=includeStatus?{...body.data,reachable:true,online:true}:{reachable:true,online:true,user_id:body.data?.user_id,nickname:body.data?.nickname};
      // A successful login probe stays useful when optional get_status is unavailable.
      if(includeStatus)try{
        const statusResponse=await request('get_status');
        if(statusResponse.ok){const status=await statusResponse.json();if(status?.status==='ok'&&status?.retcode===0){
          if(typeof status.data?.online==='boolean')info.online=status.data.online;
          if(status.data?.good!==undefined)info.good=status.data.good;
        }}
      }catch{}
      return info;
    }
    return { reachable: true, online: false, retcode: body?.retcode, wording: body?.wording };
  } catch (error) {
    return { reachable: false, error: String(error?.message ?? error),hint:unreachableHint };
  }
}

export function createHostStatusServer(){
 const server = new McpServer({ name: 'snowluma-host', version: '0.2.0-r4' });
 server.tool(
  'snowluma_status',
  '检查 SnowLuma OneBot 网关是否在线（只读探活 get_login_info）。返回网关可达性、QQ 在线状态与账号信息。网关不可达时返回可操作的提示（本程序不会代你启动 SnowLuma）。',
  {},
  async () => {
    const info = await gatewayInfo();
    // 只读工具：不再暴露本机路径/PID（那需要进程控制能力，而该能力已被移除）。
    return { content: [{ type: 'text', text: JSON.stringify(info, null, 2) }] };
  }
 );
 return server;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await createHostStatusServer().connect(new StdioServerTransport());
}
