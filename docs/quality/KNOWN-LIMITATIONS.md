---
id: other-20260821-07
type: other
status: active
version: v1
created_at: 2026-08-21
updated_at: 2026-08-26 18:37
refs: [requirement-20260818-01, plan-20260818-02]
---
# KNOWN LIMITATIONS

## Release status

`0.1.2` 是当前 Preview。源码、校验和、安装器和本地完整性检查可用；预构建 Helper
仍缺少 Developer ID 签名和 Apple notarization。

## 入口和生命周期

- 没有伪造的原生 slash 短别名。
- 原生 Goal 行“开启进度”按钮尚未发布。入口是 Goal Progress Plugin Skill。
- 宿主没有带 compare-and-swap 的原生 Goal 替换工具。目标冲突时安全停止，要求
  用户先使用受验证的原生控件。
- active tracking header 没有暴露所有 hide/detach 控件；底层偏好和生命周期 API
  已存在。

## Agent 和 checklist

- 子 Agent 写保护仍由 Skill 规则约束。宿主没有稳定的 child-agent PreToolUse
  标记，不能在 Hook 中可靠强制。
- 没有 end-user checklist 编辑器。
- 没有外部 checklist 文件 watcher。外部文件移动或删除不会自动映射到另一份清单。
- arbitrary local test/file evidence 不会自动绑定到 checklist 项；当前模型或受信任
  validator 需要提交明确 target ID。

## UI 和 Token

- hidden Preference 可持久化，但没有单独的可见 hide 按钮。
- A 是默认位置，C 是可选位置；C 空间不足时会临时显示 A。
- 从长进度条模式切换到浮动模式后再切换 Codex 主题，已挂载的浮动组件可能继续
  使用切换前的主题变量。该问题已记录，下一轮单独修复。
- Light、Dark、用户强调色和 reduced motion 已验证。主题映射依赖当前 Codex 内部
  CSS token 名称；变量缺失时使用中性 fallback，不从附近元素猜主题。
- 界面内置简体中文、英文、冰岛语和阿拉伯语。其他 Codex 语言会继续跟随文字方向，
  但文案暂时回退英文。
- 主界面只显示 Goal 累计 Token。当前 turn 和 context-window 详情未显示。

## 平台和发布

- release 仅提供 macOS arm64。
- DOM Adapter 只支持 Codex Desktop `26.818.21641 (6849)` 和
  `26.818.31338 (6892)`、`26.818.41509 (6962)`、`26.818.61809 (7019)`、
  `26.820.60940 (7119)`。
- install 会注册 `com.codexgoalprogress.helper` launchd 后台项并保持本地 Helper
  运行；uninstall 会删除该后台项。
- 功能运行需要本机 loopback CDP。install/upgrade 只有用户同意重启后才开启；
  restore 和 uninstall 会关闭。
- Plugin Hook 必须由用户审核。安装器不会自动信任。
- 当前 Preview Release 为 `0.1.2`，当前只提供 macOS arm64。
- Helper 仍是 ad-hoc codesign，没有 Developer ID 和 Apple notarization。
