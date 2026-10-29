# 肥鱼快捷语音客户端

按 **Ctrl+Alt+Space** 开始说话，再按一次结束。检测到说话后静音 1.4 秒发送；无声 8 秒停止；单次最多 59 秒。快捷键只启动语音，状态、识别文字和回复显示为不抢焦点的小字幕。托盘设置可调透明度、字号、宽度、坐标、停留时间和鼠标穿透；备用文字窗仍可从托盘打开。它调用同一个肥鱼，记忆、身份和上下文由后端维护。

没有桌宠动画、角色包、识屏、桌面控制或另一套自主活动。客户端不会自动发探活消息，不自动重试聊天，不保存聊天记录或复制令牌。

## 首次运行

使用整合包时，安装 Windows Python 3.11，然后双击仓库根目录的 `启动肥鱼.cmd`，选择快捷语音。根部署器会安装共享运行环境、配置后端与客户端并启动托盘入口，不需要再运行本目录的 `install.cmd`。重复安装保留字幕偏好与自定义快捷键。

整合包的网关默认为 `http://127.0.0.1:3117/pet`，配置保存在根目录 `.local/hotkey-config.json`；客户端只读取后端 `state/companion-gateway.json` 中的 `pet` 字段。按 Ctrl+Alt+Space，或点击“开始说话”，再次按键、点击“结束录音”或停顿结束录音。

若要单独运行客户端，可用本目录的 `install.cmd` 创建客户端 `.venv`，先启动自行配置的肥鱼后端，再运行本目录 `start.cmd` 并在“设置”中选择对应凭据文件。独立客户端示例的端口为3116，接入整合包时应改为实际的3117或自定义端口。这条手动路径只安装窗口与录音依赖，不安装后端识别模型。Python版本组合仅在3.11验收；Tk备用文字窗还需要 Tcl/Tk 组件。

后端本地语音识别运行时和 Whisper 模型由 DSH 插件包安装/配置；TTS 沿用后端所选语音服务。语音后端缺失时会显示原因；语音合成失败不会清掉文字回复。首次使用麦克风时，Windows 的麦克风访问权限由用户管理。

录音只在用户按快捷键或点按钮后开始，结束后上传到选定的本机后端。后端如何调用模型、识别和语音服务，取决于后端配置。这里不另设云端模型、账号或记忆库。

## 使用

- 语音：Ctrl+Alt+Space 开始 / 结束录音；可在设置中修改组合键。
- 文字：输入后点“发送文字”或按 Ctrl+Enter。
- 取消：停止录音、当前 HTTP 请求和本机播放。已送到后端的文字可能已被后端收到，取消不承诺撤回历史。
- 播放：默认播放语音对话的回复，可在设置中关闭；TTS 每段最多 450 字。文字入口保留文字显示。
- 窗口：拖动标题区域移动；“隐藏”或 Esc 隐藏；托盘单击恢复。热键失败且无托盘时最小化到任务栏，避免无法找回。
- 退出：点“退出”、托盘“退出”或 Ctrl+Q。关闭按钮/隐藏不等于退出。

快捷键注册冲突会在窗口显示，不会抢占已有注册。采用 Windows RegisterHotKey 的第二次按键结束模式，没有全局键盘监听器或按键记录。

## 部署器接口

工作目录设为本客户端目录，运行：

```powershell
.venv\Scripts\pythonw.exe -m feiyu_hotkey --config "C:\chosen-folder\client.json"
```

`start.cmd --config "..."` 也会转交参数。配置示例见 `config.example.json`；仅保存网关、凭据路径、热键、等待时间和是否播放。默认配置路径是 `%APPDATA%/FeiyuHotkey/config.json`，也可由 `FEIYU_HOTKEY_CONFIG` 指定。`FEIYU_PET_TOKEN` 可由启动环境提供，优先于凭据文件；不要把真实值写进启动脚本或发行包。

配置可先指向尚不存在的凭据文件；启动会显示缺失原因，不发送任何请求。每次发送会重新读取，后端生成凭据后无需重启窗口。客户端不自动扫描其他项目或读取旧桌宠私人配置。

连接仅允许 literal IPv4 `127.0.0.1`、显式端口、HTTP `/pet` 路径，不走系统代理、不跟随重定向。API：

| 请求 | JSON 输入 | JSON / SSE 输出 |
|---|---|---|
| `POST /pet/v1/audio/transcriptions` | `{audio: base64(WAV)}` | `{text}` |
| `POST /pet/v1/chat/completions` | `{model: "feiyu", stream: true, messages: [{role: "user", content: 本轮文字}]}` | OpenAI 风格 SSE；也兼容 JSON |
| `POST /pet/v1/audio/speech` | `{text: 单段文字}` | `{audio: base64, format: "wav"或"mp3"}` |

全部使用同一个 `Authorization: Bearer <pet capability>`，不使用 `utility` 或管理端凭据。音频为 16kHz 单声道 16bit PCM WAV。回复的语音文件仅写入本次会话的临时目录，正常退出删除，不创建持久录音库。当前后端在最终审查后发送 SSE 内容；窗口会显示等待状态，不把它描述成模型逐 token 流。

## 验证

```powershell
py -3 -m unittest discover -s tests -v
.venv\Scripts\python.exe tests/qt_voice_smoke.py --output "..\audit-hotkey"
```

21 项单元/本机 HTTP 夹具测试覆盖 WAV、语音链路、文字 SSE、错误、取消、迟到事件、配置安全、热键边界、字幕参数与退出清理。Qt 冒烟测试使用合成 WAV、本机临时 HTTP 和离屏真实控件渲染，并验证语音过程不打开聊天大窗；不打开麦克风、不播放声音、不注册全局快捷键、不调用生产后端或外网。**真实麦克风、扬声器和全局按键尚未实测。**

`--no-hotkey` 用于窗口验收；`--text-window` 显式打开保留的 Tk 备用文字窗。未安装 PySide6 时也会显示备用文字窗及安装提示。源码和继承的 MIT 归属见 `LICENSE`、`THIRD_PARTY_NOTICES.md`。
