# 介绍演示源文件

当前介绍为29页、16:9的中文项目哲学与机制演示。它扩展原14页功能概览，主线是稳定核心如何参与感知、回忆、意义、选择、行动与经历，再由记忆影响下一轮的兴趣、关系和表达。核心设定未改。

`create-deck.mjs` 使用 `@oai/artifact-tool`。文字、3张表格与流程/架构图保留原生可编辑对象；图片用于明确的产品控件截图、真实问题截图和装饰背景。素材与口径见仓库 `examples/ASSET_PROVENANCE.md`、`examples/philosophy-evidence.json` 和 `examples/philosophy-walkthrough.json`。

将构建脚本复制到 `presentation/.build/`，在该目录链接已配置的 Artifact Tool `node_modules` 后运行。需要设置 `FEIYU_PRESENTATION_SKILL`、`FEIYU_RUNTIME_PYTHON`、`RUNTIME_NODE_MODULES`。可选的 `FEIYU_DECK_WORKSPACE` 指向工作根目录，`FEIYU_DECK_ASSETS` 指向素材目录；默认分别为脚本父目录与仓库 `examples/`。使用已安装的等线（DengXian）和微软雅黑（Microsoft YaHei）。

本次交付修订为 `philosophy-r5`。重建前设置新的 `FEIYU_DECK_REVISION`，finalizer 不覆盖已有文件。输出分为私有 `.build/` 与验证后 `output/`。作者元数据在最终验证前由 `normalize-metadata.py` 设为 `Feiyu Contributors`，验证后的文件不再修改。

构建会导出每页PNG、总览与11张2560×1440机制图。随后运行 `render-final.mjs`（与构建脚本相同的目录和环境），将最终PPTX重新导入并逐页渲染到 `.build/final-renders/slide-01.png` 等路径。`create-pdf-preview.py <revision>` 只将这29张整页渲染封装成PDF预览，不绘制或编辑截图像素。编辑请使用PPTX，PDF是栅格预览。

`render-caption-demo.py <repository-root> <output-png>` 使用现役 `CaptionOverlay` 的真实Qt控件离屏渲染合成字幕。需要已经安装PySide6的Python；不会读取用户配置、启动麦克风、注册快捷键、连接网络或发送消息。

第15页的5格实验比较的是上下文是否带入游戏兴趣，不是长期跑题率。第16、18、21页的真实模型行为使用历史隔离实验，合成人物、虚拟时间和本地受控接收端；不代表真实QQ外发、意识或稳定爱情。第22—23页为人为编写的完整情境，不是额外模型测试。第14、20页保留真实问题而不冒充已解决全部语义近重复。自生长分层记忆图仍为研究方向。

生产私人档案、聊天记录、凭据、原始实验日志和隐藏推理不进入公开材料。演示摘要与合成对话也不能被当作角色真实经历导入。`release-status.json` 留作旧版交付历史，当前演示不从中推断账号、设备或站点已经通过全链路验收。
