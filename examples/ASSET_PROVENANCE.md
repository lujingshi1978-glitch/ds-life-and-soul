# 演示素材与归属

本目录仅保存公开演示素材，不包含私人聊天、真实角色数据库、账号凭据或部署备份。

| 文件 | 来源与用途 | 说明 |
| --- | --- | --- |
| `memory-preview-synthetic.png` | 肥鱼生活台 `feiyu-life-scope-20261028-r1` 离线预览 | 合成数据截图，保留原比例。当前介绍第24页。不能视为生产数据或实时状态。 |
| `voice-overlay-synthetic.png` | 旧版快捷键客户端的真实 Qt 控件离屏渲染 | 旧版14页介绍的文字小窗。合成 WAV 与本机 HTTP 夹具；未实录、未播放、未注册全局键。不是现行字幕图。 |
| `caption-overlay-synthetic.png` | 当前 `CaptionOverlay` 真实 Qt 控件离屏渲染 | 当前介绍第27页，合成文字；未读取用户配置、未启动音频、网络或全局键。脚本见 `presentation/source/render-caption-demo.py`。 |
| `ongoing-before-user.png` | 用户提供的修复前「持续的愿望与牵挂」截图 | 当前介绍第20页，真实问题截图，按比例缩放，像素未改。无账号、凭据、真实姓名或联系人ID。它不是当前实时界面。截图内第三方图标不因此获得新的再分发授权。 |
| `philosophy-evidence.json` | 已完成历史实验的人工脱敏摘要 | 第15、16、18、21页的实验口径及第14、20页的真实问题来源。不含私人原始日志、数据库或隐藏推理，也不是可导入角色的记忆。 |
| `philosophy-walkthrough.json` | 本次新编的完整讲解情境 | 第22—23页，合成故事与人为编写的示例回复，不是模型日志或实测回执。 |
| `cross-source-demo.json` | 旧版介绍编写 | 旧版14页介绍中的合成流程，不是模型日志或实测回执。 |
| `tide-cover.png` | OpenAI 内置 imagegen 工具生成 | 抽象装饰背景，用于封面和结尾。不是产品截图。 |

潮汐背景使用内置工具模式生成，未使用外部照片。提示词：

> Use case: productivity-visual. Asset type: 16:9 presentation cover background for an open-source personal life agent called Feiyu. Primary request: a quiet abstract ocean tide seen through sea glass, sophisticated editorial minimalism, pale tidal white #f2f7f8, muted sea glass green #367b72 and deep teal #173b46. Wide composition. Leave the left two thirds nearly plain pale tidal white for editable Chinese title. Place a softly flowing, translucent ripple of sea glass on the far right and bottom edge, subtle paper grain and natural light. No fish characters, no icons, no logos, no UI, no diagrams, no text, no letters, no watermark. This is purely abstract decorative artwork, not a real project screenshot.

代码许可证与第三方素材授权分别核对。本清单不为任何上游商标、第三方素材或二进制追加授权。

`presentation/demo-images/` 的11张图片由对应PPT原生机制图整页渲染而来，2560×1440；文字、表格和连接线在PPT中可编辑。它们是解释图，不能当成运行界面。第6张为5个输入下的上下文装配对照；第7—8张引用隔离模型实验；第9—10张为合成讲解情境。真实/合成口径及来源同时保留在图片与讲稿备注里。
