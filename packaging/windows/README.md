# Windows 原生入口与发布控制器

这里保存 0.6.0 已验原生入口、管理器的对应源码。普通使用者请直接下载 [Windows 发行包](https://github.com/lujingshi1978-glitch/ds-life-and-soul/releases/tag/v0.6.0)，无需构建。

- `Bootstrap.cs`：稳定入口，选择当前版本的控制器。
- `Launcher.cs`：安装/升级界面与 Unicode Shell Link 接口。非输入动作不写 stdin，查询错误会显示；快捷方式保留指定实例路径并避免覆盖其他入口。
- `manager.mjs`：签名、精确文件成员与 SHA256 校验、私有运行环境、分期切换、升级快照和恢复。
- 仓库 `scripts/oneclick-worker.mjs`：调用部署与 DSH 原生接口，处理本机 API 设置、自检和启停。
- `RUNTIME-SOURCES.txt`：实际随包运行时、语音模型与第三方来源。

## 构建原生入口

需要 Windows 自带的 .NET Framework C# 编译器：

```powershell
powershell -NoProfile -File packaging/windows/build-ui.ps1
powershell -NoProfile -File packaging/windows/test-native.ps1
```

输出默认位于被 Git 忽略的 `.local/windows-ui`。第一条只编译界面和入口；第二条用合成管理器验证调用协议与 Unicode 快捷方式，不安装或启动真实肥鱼实例。

完整发行包还需要先准备 `payload/app` 与 `runtime`，参照公开 ZIP 的布局及运行时来源。Node、Python、DSH、Python 包和语音模型的准备不会由上面的原生编译命令自动完成；不能把一次编译当成完整包验收。

## 发布与校验

正式 `release.json` 列举所有分发文件的字节数和 SHA256，`release.sig` 对清单的原始 UTF-8 字节做 Ed25519 签名。控制器固定发行公钥；兼容升级需要同一信任链。维护者的私钥应留在仓库外，发行包与源码库不包含私钥。分叉项目需要自己的密钥与对应公钥。

```powershell
node packaging/windows/verify-release.mjs D:\Feiyu-Windows-0.6.0
```

校验工具使用仓库内的固定公钥管理器读取文件，不执行目标包内的代码。ZIP 必须使用 UTF-8 文件名；使用 7-Zip 打包时加 `-mcu=on`，并验证 Windows 自带解压器的实际结果。不要在 Git 中加入运行实例、模型缓存、凭据、签名私钥或整包 ZIP；大分发文件放在 Releases。

完整链路与限制见 [Windows 使用说明](../../docs/WINDOWS_ONECLICK.md) 和 [验收记录](../../docs/releases/0.6.0-validation.json)。
