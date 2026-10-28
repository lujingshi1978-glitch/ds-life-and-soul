# 许可与归属

本客户端按随包 `LICENSE` 的 MIT 条款分发，并保留 `Copyright (c) 2026 Merzlin`。

保留与改编的上游实现来自 dsh-pet-indesktop 4.4.0：

- `feiyu_hotkey/hotkey_spec.py` 基于原 `pet/hotkey_spec.py`，保留快捷键文本解析口径。
- `feiyu_hotkey/voice.py` 的 WAV 封装、16kHz mono int16 / 1600-frame sounddevice 输入、RMS 阈值 350、1.4 秒停顿、8 秒无声、59 秒限和 450 字 TTS 分段，基于原 MIT `pet/feiyu_voice.py`。对取消、错误和界面生命周期做了独立适配。
- 语音端点沿用原肥鱼网关，没有复制模型权重、用户记忆或第三方角色素材。

为保留来源记录，原项目完整第三方声明原样归档于 `licenses/dsh-pet-THIRD_PARTY_NOTICES.md`。其中角色、音效、图标和 Android 资源的声明不表示本客户端包含那些资源；本客户端未分发这些资产。

运行依赖通过用户的 Python 环境安装，许可证以所安装发行版随附的原文为准：

| 组件 | 本机核对版本 / 归属 | 许可记录 |
|---|---|---|
| PySide6 / Qt / Shiboken | Qt Company 与贡献者，验证 6.12.0 | wheel 元数据列 LGPL-3.0-only / GPL-2.0-only / GPL-3.0-only；商业许可另行提供 |
| sounddevice | Matthias Geier 与贡献者，验证 0.5.6 | MIT；PortAudio 随平台 wheel 的声明另附于该 wheel |
| numpy | NumPy Developers，验证 2.4.6 | BSD-3-Clause；wheel 内其他数值库声明随其发行版 |
| cffi（sounddevice 的依赖） | Armin Rigo、Maciej Fijalkowski 与贡献者 | MIT；以安装发行版为准 |
| Python / Tcl/Tk | Python Software Foundation / Tcl/Tk 贡献者 | 用户安装的解释器自身许可与通知 |

本源码包不内置 Python 解释器、Qt 二进制、PortAudio DLL、字体或模型权重。若另行制作二进制发行版，应随复制件保留实际捆绑依赖的许可文件。本机离屏验收只临时加载系统已安装的微软雅黑进行中文渲染，不复制字体文件。
