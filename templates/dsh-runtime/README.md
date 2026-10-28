# 官方 DSH 运行时锁

固定 DSH 0.2.0-rc.2 及其官方 npm 完整依赖树。源码包只含 manifest/lock，不含第三方运行时二进制。`allowScripts` 仅批准本轮验证过的五个精确版本安装脚本，不使用通配批准。首次部署复制到 `.runtime/dsh` 并运行 `npm ci`。更新依赖时需要重新核对 lock、许可证和原生构建，不直接放宽批准列表。
