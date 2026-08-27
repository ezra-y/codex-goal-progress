---
id: other-20260821-04
type: other
status: active
version: v1
created_at: 2026-08-21
updated_at: 2026-08-24 14:35
refs: [requirement-20260818-01, decision-20260818-01, plan-20260818-02]
---
# PERFORMANCE BUDGET

预算来自 2026-08-21 的 macOS arm64 实测。超过预算时先定位变化来源，再决定调整
预算或修复代码。

## 预算

| 项目 | 预算 |
|---|---:|
| Helper 空闲平均 CPU | ≤ 0.5% |
| Helper 稳态 RSS | ≤ 128 MiB |
| Renderer 12 项 Shadow DOM 节点 | ≤ 180 |
| Renderer 粒子 / sparkle | 12 / 4，不随目标数量增加 |
| Renderer bundle | ≤ 111,000 bytes |
| active App Server 请求 | ≤ 39 / 分钟 |
| collapsed/background 请求 | ≤ 14 / 分钟 |
| paused 请求 | ≤ 7 / 分钟 |
| hidden、detached、complete 请求 | 0 / 分钟 |
| Goal DOM 恢复重挂载 | ≤ 2,000ms |
| reload 后挂载 | ≤ 2,000ms |
| 30 分钟长时运行 | Shadow DOM、timer、observer、socket 和子进程不增长 |

## 实测

### Helper

使用自包含 Node SEA Helper，临时 root，无 CDP、无 Goal watcher。

| 时间 | CPU time | RSS | 子进程 |
|---|---:|---:|---:|
| 28 秒 | 0.13s | 91.7 MiB | 0 |
| 2 分 44 秒 | 0.13s | 44.8 MiB | 0 |
| 31 分 39 秒 | 0.14s | 44.8 MiB | 0 |

31 分钟平均 CPU 低于 0.01%。停止后 helper.sock 和 PID 文件被删除；日志和
runtime proof secret 按设计保留。

### Renderer

单页 headless Chrome，12 个顶层目标，真实 CSS 动画，连续 30 分钟。

| 指标 | 开始 | 30 分钟 | 变化 |
|---|---:|---:|---:|
| JS heap | 3,161,992 bytes | 2,240,972 bytes | -921,020 |
| 浏览器 Nodes | 1,150 | 986 | -164 |
| Shadow DOM 节点 | 164 | 164 | 0 |
| 目标行 | 12 | 12 | 0 |
| 粒子 | 12 | 12 | 0 |
| sparkle | 4 | 4 | 0 |

Renderer 初次 mount 为 137ms。2026-08-21 的生产 bundle 为 61,434 bytes。

2026-08-23 增加布局来源诊断、稳定锚点连续性和浮动位置恢复后，生产 bundle 从
97,050 bytes 增至 101,644 bytes。Esbuild metafile 显示增量主要来自
`sidecar-mount.ts` 和 `page-host.ts`，没有新增依赖或远程代码。当前原始 bundle
预算更新为 104,000 bytes，保留约 2.3 KB 余量。

2026-08-23 增加新 Goal 绘制前身份隔离和 100% frontier 对勾后，生产 bundle 为
104,493 bytes。增量仍来自现有 `sidecar-mount.ts`、`page-host.ts` 和 Renderer
组件，没有新增依赖或远程代码。预算更新为 105,000 bytes。

2026-08-23 增加等宽文字状态、缩放三竖 loader、`LOADING` 扫光和范围提示几何
测试后，生产 bundle 为 107,230 bytes。没有新增依赖或远程代码。预算更新为
108,000 bytes。

2026-08-23 将文字状态改为中性小点、降低扫光频率，并修复同一 Goal 的锚点连续性
后，生产 bundle 为 105,903 bytes。没有新增依赖或远程代码，继续满足
108,000 bytes 预算。

2026-08-23 增大状态点、收紧小目标文字和范围提示间距后，生产 bundle 为
106,069 bytes。没有新增依赖或远程代码，继续满足 108,000 bytes 预算。

2026-08-23 将状态点替换为连续编号，并把活动扫光扩展到完整小目标标题后，生产
bundle 为 105,187 bytes。没有新增依赖或远程代码，继续满足 108,000 bytes 预算。

2026-08-23 为连续编号增加英文句点后，生产 bundle 为 105,188 bytes。没有新增
依赖或远程代码，继续满足 108,000 bytes 预算。

2026-08-23 修复浮动坐标稳定性、扩展 Checklist 障碍识别并调整浮动视觉后，生产
bundle 为 105,335 bytes。没有新增依赖或远程代码，继续满足 108,000 bytes 预算。

2026-08-23 增加浮动胶囊与面板整组纵向避让后，生产 bundle 为 105,841 bytes。
没有新增依赖或远程代码，继续满足 108,000 bytes 预算。

2026-08-23 移除浮动胶囊黑色外壳、恢复前景球、增加图片附件重新锚定和左右停靠后，
生产 bundle 为 106,441 bytes。没有新增依赖或远程代码，继续满足 108,000 bytes
预算。

2026-08-24 增加 max-height Textbox、祖先裁切、Host 可见交集和 Observer 原因的
只读诊断后，生产 bundle 为 110,031 bytes。增量只来自现有 Sidecar/Page Host
诊断，没有新增依赖、远程代码或 UI 行为。预算更新为 111,000 bytes，保留约
969 bytes 余量。

### 路由和 reload

在 Sidecar DOM 重建测试中：

- Goal DOM 恢复到 Host 出现：499.6ms
- reload 到重新挂载：145.6ms

两项都包含页面操作和 Playwright 轮询时间。

### App Server 请求

按最短 10% jitter 计算最坏请求频率：

| 模式 | 最短间隔 | 最大请求/分钟 |
|---|---:|---:|
| active | 1,575ms | 39 |
| collapsed/background | 4,500ms | 14 |
| paused | 9,000ms | 7 |
| stopped | 无 timer | 0 |

ViewModel 指纹未变化时 Publisher 不重复推送。页面稳定时 MutationObserver 不做全
DOM 轮询。

## 验证

- `tests/unit/performance-budget.test.ts`
- `tests/unit/app-server-runtime.test.ts`
- `tests/unit/view-model-publisher.test.ts`
- `tests/e2e/renderer.spec.ts`
- `tests/e2e/sidecar-mount.spec.ts`
