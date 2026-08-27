---
id: decision-20260821-01
type: decision
status: active
version: v1
created_at: 2026-08-21
updated_at: 2026-08-21 03:03
refs: [decision-20260818-01, plan-20260818-02]
---

# Helper 自包含发布采用 Node SEA

## 决定

macOS arm64 发布包使用 Node Single Executable Applications，简称 SEA。

构建时把 Helper 打成一个 CommonJS bundle，注入固定版本的官方 Node 二进制，
再重新签名。Renderer 继续是独立的自包含 JavaScript bundle，与 Helper 放在同一
release 目录，并使用同一个 release version。

构建机可以使用 Node、pnpm、esbuild 和 postject。安装后的用户机器不需要 Node、
pnpm、Bun 或 Deno。

## 比较范围

只比较 Node API 兼容、包体、启动时间、签名、升级和调试。

| 方案 | Node API | arm64 包体 | ZIP | doctor 启动中位数 | 签名 | 升级与调试 |
|---|---:|---:|---:|---:|---|---|
| Node SEA 24.19.0 | 原生 | 121.6 MB | 38.6 MB | 48.0 ms | 注入后重新 codesign | 替换二进制；Node inspector 与 source map |
| Bun 1.3.14 compile | 兼容层 | 64.4 MB | 23.8 MB | 43.6 ms | 需要重新 codesign | 替换二进制；使用 Bun 调试语义 |
| Deno 2.8.2 compile | 兼容层 | 72.8 MB | 30.1 MB | 50.7 ms | 默认 ad-hoc，可重新 codesign | 替换二进制；使用 Deno 权限和调试语义 |

测量环境是 macOS arm64。三个产物都能运行 `doctor --json` 并建立 Helper Unix
socket。Bun 对当前入口执行了两次，产生并发 Helper 锁错误；这是运行时入口语义
不同的直接证据。Node SEA 与 Deno 没有该问题。

启动时间差异小于 8ms。Node SEA 的压缩包比 Bun 多约 15MB，比 Deno 多约 9MB。
这个差异不足以抵消原生 Node API 的兼容优势。

## 构建约束

- 固定 Node 主版本、次版本、平台和架构。
- 生成 SEA blob 和目标二进制必须使用同一 Node 版本。
- macOS 注入前移除旧签名，注入后重新签名并验证。
- CommonJS bundle 不使用 `import.meta.url` 查找 Renderer。
- Helper 从自身二进制旁边的 release 目录读取 Renderer bundle。
- 产物清单记录 release version、Node version、平台、架构、字节数和 SHA-256。
- Helper manifest 与 Renderer manifest 的 release version 必须相同。

## 未选择方案

### Bun compile

包体最小，交叉编译和资源嵌入简单。它使用 Bun runtime，不能生成
`--target=node` 的独立可执行文件。当前入口 POC 出现双执行，因此需要额外适配和
完整回归。

### Deno compile

命令简单，默认签名，权限可写入二进制。它仍通过 Node 兼容层运行本项目。切换后
需要在 Deno 下重跑 App Server、Unix socket、进程检查和全部故障恢复测试。

## 参考

- Node SEA：
  <https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html>
- Bun standalone executable：
  <https://bun.sh/docs/bundler/executables>
- Deno compile：
  <https://docs.deno.com/runtime/reference/cli/compile/>
