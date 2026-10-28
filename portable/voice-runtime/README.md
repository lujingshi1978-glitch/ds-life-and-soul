# 可选语音运行时

可导入的 Node 安装器和只读健康检查。**导入模块不执行任何操作；未显式选择语音时，安装函数不创建目录、不运行 Python、不安装包、不下载模型。**

## 部署器接入

```js
import {installVoiceRuntime, inspectVoiceRuntime, voiceLaunchEnvironment}
  from './portable/voice-runtime/install.mjs';

// 必须由用户明确选择语音后调用；这里仅展示部署器接入方式。
const result = await installVoiceRuntime({
  repoRoot,                     // 发行包的绝对根目录，core位于packages/feiyu
  voice: true,
  pythonCommand: ['py', '-3.11'], // 也可为Python3.11解释器绝对路径
  run: installRun,              // 可省略，使用模块内置spawn实现
});

const health = await inspectVoiceRuntime({repoRoot, run: installRun});
const env = voiceLaunchEnvironment(repoRoot, {clientConfigPath: absoluteClientConfig});
```

DI `run(command, args, options)` 接口：

- `options` 含 `cwd, env, capture:true, timeoutMs, phase, allowNetwork`。
- 返回 `{code:0, stdout, stderr?}` 或 `{exitCode:0, stdout}`；若适配器在非零退出时抛错，也可只返回 `{stdout}`。
- 命令和参数分开传入，默认实现 `shell:false, windowsHide:true`。`phase` 为 `venv / dependencies / model-download / health`。
- 错误状态只存阶段和错误码，不存pip输出、路径异常原文或账户令牌。

可以注入 `downloadModel({python, destination, paths, run, source})` 验证流程。它应把四个模型文件写入 `destination`，安装器随后独立校验。`modelSource + allowFixtureModel:true` 仅用于合成权重测试；生产部署器不传这两项。夹具 manifest 明确写 `fixture:true`，不能作为真模型已安装的证据。

共享运行时固定在：

```text
repo/work/integration-runtime/media/.venv/
repo/work/integration-runtime/media/voice-runtime.json
repo/.local/models/whisper-small/
repo/.local/models/whisper-small/feiyu-model.json
```

Windows解释器为 `.venv/Scripts/python.exe`，其他平台为 `.venv/bin/python`。`voiceRuntimePaths()` 可直接取得这些路径。

## 启动环境

`voiceLaunchEnvironment(repoRoot, {clientConfigPath})` 返回：

```text
FEIYU_MEDIA_PYTHON=<repo>/work/integration-runtime/media/.venv/Scripts/python.exe
FEIYU_ASR_MODEL=<repo>/.local/models/whisper-small
FEIYU_ASR_SCRIPT=<repo>/portable/voice-runtime/local-asr.py
FEIYU_HOTKEY_CONFIG=<部署器选定的绝对客户端config路径>
PYTHONUTF8=1
```

将它合并到肥鱼后端和客户端的启动环境。客户端用同一共享Python执行 `-m feiyu_hotkey --config <绝对配置路径>`，工作目录设为 `clients/feiyu-hotkey`，无需再给客户端安装一套 `.venv`。本模块不修改冻结的客户端源码。

后端可直接使用 `FEIYU_ASR_SCRIPT`，或把独立 `local-asr.py` 复制到 `packages/feiyu/scripts/local-asr.py` 后传对应路径：

```text
<共享python> -B <local-asr.py> asr <绝对WAV路径>
```

也接受省略 `asr` 的单个WAV参数。输入仅允许本地16kHz单声道16bit PCM WAV，0.1至60秒。输出JSON `{source, language, segments, text}`；失败仅输出 `{"error":"错误类名"}`，不回显私人路径或凭据。

ASR在导入faster-whisper之前强制离线/禁隐式token，且只接受 `FEIYU_ASR_MODEL` 的显式绝对目录。不使用模型名称 `small`，不读用户 `~/.dsh`、Bili凭据或原账号配置；缺四个必需文件中的任一个直接失败。尤其必须有 `tokenizer.json`：上游即使 `local_files_only=True`，缺tokenizer时仍存在 `Tokenizer.from_pretrained(...)` 回退，见[官方1.2.1源码](https://github.com/SYSTRAN/faster-whisper/blob/v1.2.1/faster_whisper/transcribe.py#L700-L708)。独立ASR进程另外禁止Python socket连接；这不是对原生依赖的系统级网络沙箱。

## 依赖选择

| 组 | 内容 | 默认语音是否安装 |
|---|---|---|
| `voice` | PySide6、sounddevice、numpy、faster-whisper、PyAV、huggingface-hub、edge-tts | 显式 `voice:true` 才安装 |
| `media-files` | Pillow、python-docx | 否，需 `groups:['media-files']` |
| `pdf-agpl` | PyMuPDF | 否，需 `groups:['pdf-agpl']` |

精确范围见各 `requirements-*.txt` 与导出的 `DEPENDENCY_GROUPS`。faster-whisper1.2.1本身依赖 `av>=11`，所以PyAV属于ASR默认链，不能把它当成完全可选媒体组件。PyMuPDF单独保留显式选择，避免把其AGPL/商业许可分支默认带进语音安装。

pip固定官方 `https://pypi.org/simple`，禁用户pip配置和额外index。模型下载固定官方Hugging Face endpoint，并使用 `token=False`、独立repo内HF缓存，清除继承的HF token。不会复制用户的HF缓存或账户文件进发行包。

## 固定模型与完整性

- 官方仓库：[Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small/tree/main)。
- 固定完整revision：[536b0662742c02347bc0e980a01041f333bce120](https://huggingface.co/Systran/faster-whisper-small/commit/536b0662742c02347bc0e980a01041f333bce120)。
- 只下载 `config.json, model.bin, tokenizer.json, vocabulary.txt`。
- `model.bin` 固定SHA256：`3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671`，见[该revision的官方文件页](https://huggingface.co/Systran/faster-whisper-small/blob/536b0662742c02347bc0e980a01041f333bce120/model.bin)。

下载先落到repo内staging目录，检查文件无symlink、非空、JSON可读、权重强校验，然后给全部四文件写size+SHA256 manifest，最后改名为正式缓存。原有不完整目录会保留为 `.previous-<id>`，不删除用户数据。失败保留 `voice-runtime.json` 的 `status:'failed'`、阶段和代码，部分staging保留以便排查；不会冒充ready。

`inspectVoiceRuntime()` 只读，不下载、不创建目录、不执行推理、不打开麦克风。结果分 `runtimeReady`（依赖可导入）与 `cacheReady`（四文件完整）。默认重新SHA256验证模型文件；`verifyHashes:false` 是较快的manifest+size检查，返回 `integrity:'manifest-and-size'`，不宣称已重新校验哈希。实际验收已完成真模型的完整哈希校验，未单独报告磁盘校验耗时。

锁文件 `.voice-install.lock` 防止同目录并发安装。若安装进程异常退出留下锁，健康报告仍可只读查看；应确认没有安装进程后再由用户处理该锁，模块不自动抢占。

## 交付验证与限制

```powershell
node --test test-runtime.mjs
py -3 -B -m unittest discover -p 'test_*.py' -v
```

14项Node测试和6项Python测试通过，全部使用合成文件、DI命令执行器和假模型工厂。覆盖默认不安装、只读检查、阶段顺序、stdout适配器、完整manifest、失败/重试、缓存复用/篡改、旧数据保留、锁、可选依赖、官方下载参数与ASR离线边界。

后续实际验收另在全新Windows/Python3.11隔离环境完成了官方哈希核验wheel缓存续装、固定官方模型首次下载、完整哈希校验和真实模型对合成静音的推理。该结果不表示纯网络从零安装已通过，也未使用真实麦克风、扬声器或全局热键。完整范围见 [语音实际验证](../../docs/VOICE_VALIDATION.md)。

这份源码包不包含venv、模型、用户数据或私人配置。模块源文件范围见 `file-whitelist.json`，最终公开包再经仓库根门禁检查，排除 `.ruff_cache`、`__pycache__`、测试临时目录及运行时 `work/`、`.local/`。

## 已验证的Windows版本组合

`constraints-voice-windows-py311.txt`列出隔离Windows/Python3.11成功安装并验证的44个运行包。Windows安装默认使用该约束；请使用Python3.11。版本来自官方hash核验缓存续装，不代表该机器完成了从零纯网络下载。实际范围见仓库`docs/VOICE_VALIDATION.md`。
