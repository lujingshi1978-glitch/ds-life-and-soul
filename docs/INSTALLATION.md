# 安装与部署

## 环境

主要验证平台为 Windows 10/11 x64。需要 Node.js 24 LTS 与 npm。快捷语音使用 Python 3.11，客户端依赖 PySide6、sounddevice 和 NumPy。启动器会从官方 npm 安装独立的 DSH 0.2.0-rc.2，无需预先安装另一份 DSH。

Windows优先检查 `py -3.11`；若无法选择，会从Python Launcher列表查找已登记的解释器（含uv/Astral登记项），再检查PATH候选。每个候选都核对实际版本，只接受Python 3.11，不会因为默认Python是3.14就直接用它。也可以用环境变量 `FEIYU_PYTHON` 显式指定Python 3.11解释器的绝对路径；显式选择无效时会报错，不静默换用另一版本。已有语音虚拟环境继续复用；未找到合适解释器时会在安装依赖前提示，不自动下载Python。

将源码包解压到短路径，例如 `D:\Feiyu`，不要直接在压缩包中运行。Windows SQLite 对很深的目录可能报无法打开数据库。启动器与客户端支持中文和空格路径；仍建议避免多层嵌套。

## 首次运行

1. 双击根目录 `启动肥鱼.cmd`。
2. 输入管理员 QQ，或留空仅使用本机桌面入口。留空时数字 `1` 仅作为本机管理员的内部标识，不会自动联系任何 QQ 用户。
3. 选择是否安装快捷语音、网页读取以及视频/动图插件。
4. 等待官方 npm/PyPI 依赖安装。选择语音后，还会下载固定官方版本的本地 Whisper 模型。首次耗时受网络影响。
5. 打开本机 DSH 界面，配置模型提供方与凭据。生活台与语音窗口共用这份角色运行时。

首次配置需要网络。后续使用同一启动入口复用已有依赖与数据，不会每次重建档案。

### 后续启动与首次设置的区别

普通 `launch` / `start` 读取 `.local/installation.json`，启动或复用本目录已登记的服务，不重新运行安装向导，不执行 npm/Python 安装，不重置模型登录、角色、记忆、网站登录或字幕设置。启动时核对依赖、端口所有权与私人目录权限，属于每次运行的检查。

显式运行 `setup` 才会重新进入安装流程。已有配置却缺少安装记录时，普通启动会停下并提示恢复 `.local`，不会把它当成全新安装。更新源码时要保留原目录的 `.local`、`.runtime`、`work/integration-runtime`、`packages/feiyu/config.json` 和私人数据目录；不要每次解压到新目录后丢弃这些文件。

0.5.2 修复了另一种看似“每次初始化”的慢启动：历史思考明细归档后，重放日志会重复入账并重写账本。现在按不可变的单次调用ID去重，历史仍可读取，新记录照常追加；不会因此重算或清空旧账本。

## 脚本部署

先查看计划：

```powershell
node scripts/deploy.mjs plan
```

自动化部署可准备一份本机配置文件，例如 `setup.local.json`，然后运行：

```powershell
node scripts/deploy.mjs setup --config=setup.local.json
node scripts/deploy.mjs start
```

示例仅包含非秘密参数：

```json
{
  "profile": "feiyu",
  "dshPort": 3081,
  "consolePort": 3110,
  "companionPort": 3117,
  "ownerQQ": "1",
  "voice": true,
  "browser": true,
  "video": false,
  "provider": "deepseek-official",
  "model": "deepseek-flash"
}
```

模型名称必须是本机 DSH 中实际可用的模型。配置文件不要提交 API 密钥、OneBot 令牌或真实管理员标识到公开仓库。可通过 `dshInstall` 显式使用已有的 DSH 安装目录，版本需为已验证的 `0.2.0-rc.2`；无效目录会直接拒绝，不替你改另一份安装。

## 独立 profile 与目录

启动器默认使用 `.local/dsh-home` 下的独立 `feiyu` profile，不修改已有 `web` profile，也不复制原 DSH 凭据。首次安装会创建本包自己的角色档案。

| 目录 | 用途 | 进入公开包 |
| --- | --- | --- |
| `packages/feiyu/src`、`plugins` | 核心源码与原生插件 | 是 |
| `clients/feiyu-hotkey` | 语音与透明小窗客户端 | 是 |
| `.local` | 本机设置、模型、日志、进程记录 | 否 |
| `.runtime` | 官方 DSH 的本机安装 | 否 |
| `work/integration-runtime` | 语音/浏览器依赖 | 否 |
| `packages/feiyu/state`、`cognition-v3` | 凭据、角色状态、数据库与记忆 | 否 |
| `packages/feiyu/config.json` | 本机连接与权限配置 | 否 |

## 可选能力

网页读取需要本机 Edge 和 Playwright MCP。网站适配器由安装向导或平台卡片安装，OpenCLI 浏览器扩展按官方说明手动安装。网站登录由使用者在打开生活台的浏览器中完成，步骤见[网站接入说明](PLATFORM_CONNECTIONS.md)。通用浏览器交互、网站互动和自主活动分别授权。

B站/动图插件是可选原生 bundle。它们的本机运行环境与账号需按各插件说明配置；安装源码不代表已经登录或看过任何内容。

本地向量检索的源码与服务脚本包含在包内。未配置向量服务时，记忆使用现有词法召回及降级路径；不要把这理解为已经安装了本地向量模型。

Windows 受限创造需要额外准备可验证的 LPAC 运行时。缺少运行时会拒绝创造执行，不会回退到宿主 Shell。默认保持关闭，见 [边界说明](BOUNDARIES.md)。

## QQ 与其他账号

本包不下载、不分发、不启动QQ网关。先单独安装并登录网关，开启本机HTTP服务端与正向WebSocket服务端，再使用首次安装中的QQ接入选项，或停止本包后双击 `scripts/配置QQ.cmd`。向导会检查令牌、在线状态和两条连接的账号一致性，通过后备份并保存配置。具体地址、聊天范围与排错见 [QQ接入指南](QQ_SETUP.md)。

命令行入口为 `node scripts/deploy.mjs qq`；只读检查为 `node scripts/deploy.mjs qq-check`。配置字段仍沿用历史名称 `snowluma`，不表示只能连接SnowLuma。向导不会开启原本关闭的主动联系或其他平台行动权限。

没有配置 QQ 时，桌面聊天仍使用同一份角色记忆。不要为了测试而把现有账号或他人的真实记录复制进公开目录。

## 检查与停止

```powershell
node scripts/deploy.mjs doctor
node scripts/deploy.mjs stop
```

停止只处理本包记录且身份再次核对的进程，保留数据库和用户设置。卸载 DSH 插件配置可运行 `node scripts/deploy.mjs uninstall`。若安装后 profile 已被用户修改，自动卸载会拒绝覆盖，需先人工核对。

## 更新

保留当前目录的本机数据，先停止本包进程，再更新源码、安装锁定依赖并复核插件配置。不要用全目录覆盖来清空 `state`、`.local` 或账号目录。开源发布包始终是干净源码包，不能代替个人数据备份。

更新源码后，可双击 `scripts/修复核心依赖.cmd`（或运行 `node scripts/deploy.mjs repair-core`）安装锁定的核心依赖，再重新启动。该入口不重建角色或账号，不安装语音模型；配置中的服务端口仍被占用时会拒绝修复。旧版微信扫码错误的具体升级步骤见[修复说明](WECHAT_QR_FIX.md)。
