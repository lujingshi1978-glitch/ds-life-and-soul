# 第三方来源与许可

肥鱼自身源码按根目录 [MIT 许可证](LICENSE) 分发。第三方组件保留各自的许可，根目录 MIT 声明不替代这些许可。

## 随源码包分发

- 肥鱼核心及八个 DSH 插件：各目录保留 `LICENSE`。
- `dsh-bili-scroll/vendor/bilibili-mcp`：保留上游 MIT 许可证及作者署名。
- `vendor/czx-bilibili` 和 `vendor/tencent-weixin`：保留改编来源与 MIT 许可证。
- 快捷语音客户端：保留 dsh-pet-indesktop 的 MIT 来源署名；未包含原角色动画、声音、字体或 Android 资源。详见 [客户端来源说明](clients/feiyu-hotkey/THIRD_PARTY_NOTICES.md)。
- 创造通道的 Windows 原生管道 shim：随包提供 MIT C 源码、构建说明及可复现二进制来源记录，详见 [原生构建记录](licenses/NATIVE_BUILD.md)。它不包含外部隔离运行时。
- 展示截图和示例数据由本项目构造；来源见 [展示素材说明](examples/ASSET_PROVENANCE.md)。

已分发组件的许可证文件哈希记录在 [第三方清单](licenses/third-party-manifest.json)。

## 部署时另行安装

源码包不包含 `node_modules`、DSH 运行时发行版、Python 环境、wheel、浏览器、模型权重或安装缓存。部署程序依据锁文件从上游安装依赖，安装后的第三方许可证和 NOTICE 应随依赖保留。

| 依赖范围 | 记录与主要许可 |
| --- | --- |
| 肥鱼核心 npm 依赖 | `packages/feiyu/package-lock.json`；完整版本和许可见第三方清单 |
| 微信二维码 qrcode 1.5.4 | MIT；作为锁定核心依赖安装，其传递依赖许可见第三方清单；不随源码包复制node_modules |
| 可选 OpenCLI 2.0.2 | Apache-2.0；依据 `templates/social-runtime/package-lock.json` 安装，保留上游依赖内 LICENSE；浏览器扩展需用户单独安装 |
| 可选 Playwright MCP 0.0.83 | Apache-2.0；安装于隔离的浏览器运行目录；不随源码包复制浏览器或运行时 |
| DSH 0.2.0-rc.2 及传递依赖 | `templates/dsh-runtime/package-lock.json`；610 个锁定条目，含平台可选项；详见 [DSH 依赖记录](licenses/dsh-runtime-dependencies.json) |
| DSH 内的 LibreOffice Kit | MPL-2.0；相关适配和引擎另有随包 NOTICE。并非全部按肥鱼的 MIT 许可分发 |
| DSH 内的 sharp / libvips 平台包 | Apache-2.0、LGPL-3.0-or-later 及相应组合许可，以实际安装包为准 |
| PySide6 / Qt / Shiboken | 发行版提供的 LGPL / GPL / 商业许可选项，详见客户端说明 |
| sounddevice、NumPy、faster-whisper、PyAV | 各自发行版及所含底层库的许可，详见 [语音运行时说明](portable/voice-runtime/NOTICE.md) |
| 可选 PyMuPDF | AGPL 或商业许可；独立显式选择，默认语音安装不包含 |

DSH 锁文件中的 610 个依赖条目均包含版本、registry.npmjs.org 的 HTTPS 来源、完整性校验和许可字段；这是一份发布时的元数据核对，不代表审计了每个第三方组件的全部源代码。首次部署批准的五个安装脚本均固定到精确版本，见运行时模板的 `allowScripts`。

SnowLuma、外部创造隔离运行时、服务账号和私人数据不随源码包分发。模型权重由使用者选用后另行下载，适用上游模型的许可及使用条款。若再次分发安装后的运行时或制作包含依赖的安装器，需要同时保留实际依赖的许可、NOTICE 与对应来源记录。
