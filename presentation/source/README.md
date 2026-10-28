# 介绍演示源文件

`create-deck.mjs` 使用 `@oai/artifact-tool` 创建14页中文介绍，16:9。文字、表格和架构图均为可编辑对象。装饰背景与生活台截图在仓库根的 `examples/`，来源见该目录的 `ASSET_PROVENANCE.md`。

源文件应复制到 `presentation/.build/` 运行，并在该目录下把 `node_modules` 链接到已配置的 Artifact Tool 运行时。构建产物写入 `.build/`，验证后的 PPTX、PDF 与总览写入 `output/`。

本次交付修订为 `r5`。finalizer 不会覆盖既有输出，重建时请设置新的修订号，例如 `FEIYU_DECK_REVISION=r6`。`.build/` 包含临时构建与验证材料，不应随公开源码打包。

需要的运行环境：Node.js、`@oai/artifact-tool`、等线（DengXian）与微软雅黑（Microsoft YaHei），以及 presentations skill 的本地 finalizer。必须设置 `FEIYU_PRESENTATION_SKILL`、`FEIYU_RUNTIME_PYTHON`、`FEIYU_RUNTIME_NODE_MODULES`。修订文件名使用 `FEIYU_DECK_REVISION`。

`create-pdf-preview.py` 只把已渲染的整页 PNG 放入14页 PDF，不绘制或生成图像。本次 Artifact Tool 的原生 PDF 导出缺少 `#standard-fonts/Helvetica` 资源，所以 PDF 是浏览预览，编辑请使用 PPTX。

生成文档的作者统一为 `Feiyu Contributors`。PPTX 导出后会调用 `normalize-metadata.py`；PDF 生成脚本设置相同的作者与创建者。该元数据辅助脚本处理 PDF 时需要 `pypdf`。

`release-status.json` 记录插件分发和快捷键客户端的实际交付状态。它只能根据真实实现与验收更新，不能把工具注册或打包成功当作真实模型聊天通过。

事实基线为 `feiyu-life-scope-20261028-r1` 与现役认知、活动、权限源码。旧设计文档、生产私有计数、私人聊天和实验人物原话没有进入演示。
