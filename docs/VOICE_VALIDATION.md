# 语音运行时实际验证摘要

2026-10-28，Windows / Python 3.11.15 的全新隔离运行环境通过依赖健康、固定官方模型完整性、本地合成静音推理及缺模型错误检查。

依赖使用逐个核对官方PyPI文件名、大小和SHA256的公开wheel缓存续装：43个复用wheel共346,329,974字节，另从官方PyPI下载并校验94,895字节的小wheel。实际安装44个运行包，用时27.447秒。**这证明缓存续装可用，不代表本机从零纯网络安装已通过；此前纯网络尝试受到官方文件CDN低吞吐影响，未在预算内完成。**

首次模型下载来自固定官方仓库 [Systran/faster-whisper-small](https://huggingface.co/Systran/faster-whisper-small/tree/main)，revision为 `536b0662742c02347bc0e980a01041f333bce120`。权重483,546,902字节，下载277.964秒；实际SHA256 `3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671` 与[该revision官方文件页](https://huggingface.co/Systran/faster-whisper-small/blob/536b0662742c02347bc0e980a01041f333bce120/model.bin)一致。四个运行文件均生成并重新核验完整SHA256 manifest，`ready/runtimeReady/cacheReady`均为true。

| 实际检查 | 结果 |
|---|---|
| 共享Python导入客户端模块 | 通过；PySide6 6.12.0、numpy2.4.6、sounddevice0.5.6 |
| 真实本地模型处理合成1秒静音WAV | 3.556秒；空文本、空segments，未使用麦克风 |
| 缺模型 | 明确失败；exit1、LocalModelIncomplete，无隐式补下载 |
| 缓存续装＋首次模型下载＋上述检查 | 318.323秒；不含先前网络尝试与缓存校验时间 |

完整运行版本已导出为 `constraints-voice-windows-py311.txt`，只列44个运行包的名称和版本，不含直接文件URL；bootstrap工具单独记录。此组合仅在Windows/Python3.11验证，不能据此推断其他平台或Python版本已验收。

没有真实人声、麦克风权限/设备选择、扬声器播放、TTS云服务、全局热键、生产肥鱼或云LLM调用。透明窗口配图仍是合成数据的Qt离屏渲染，不能标为实录截图。未读取或导出账户、用户配置或用户HF缓存；未复制旧venv。模型权重、wheel、环境和合成音频不随开源源码包分发。
