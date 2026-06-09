# Codex 远程工作台完整上线规划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 把 Codex Phone Hub 做成完整可上线的个人 Codex 远程工作台，让手机和网页可以稳定操作服务器上的 Codex CLI / Codex app-server，并尽量承载桌面端常用能力。

**架构判断：** 浏览器不应该成为第二套 agent runtime，它只做远程控制台。Codex CLI / app-server 继续是会话、turn、审批、命令、文件事件的事实来源；Web 侧补齐状态持久化、多设备同步、移动端交互、工作区可视化、生态管理、运维诊断。当前最大风险不是后端能力，而是前端单文件整页重绘导致输入、搜索、切页、刷新恢复互相踩状态。

**技术栈：** Node.js / TypeScript / npm workspaces / vanilla JS 前端逐步模块化 / SSE / systemd / nginx / `~/.codex-web` 本地状态目录。

---

## 0. 当前结论

### 已经具备的基础

- `packages/codex-web/src/runtime.ts` 已经接入 Codex app-server，并能处理 session、turn、审批、事件归一化、远程命令、active turn。
- `packages/codex-web/src/server.ts` 已经有 auth、session、turn、workspace、report、admin、ecosystem 相关 API 雏形。
- `packages/codex-web/src/active_turn_store.ts`、`workspace_event_bus.ts`、`workspace_inspector.ts`、`remote_commands.ts` 已存在，说明后端已经不是空白。
- 生产部署路径明确：`/opt/codex-web`、`codex-web.service`、nginx 反代到 `127.0.0.1:43210`。
- 用户场景明确：这是个人工具，前端默认不展示团队 / 多角色复杂 UI；后端可保留 RBAC 兼容。

### 必须承认的问题

- `packages/codex-web/public/app.js` 约 3800 行，承担状态、渲染、事件绑定、网络请求、SSE、移动端、管理页等所有职责。
- 主渲染仍依赖 `app.innerHTML = ...` + `bindApp()`，这会让输入框聚焦、输入、搜索、点击侧边栏、前后台恢复时都有机会触发整页 DOM 替换。
- `packages/codex-web/public/styles.css` 约 2700 行，页面风格、旧管理 UI、新个人工作台 UI 混在一起。
- `packages/codex-web/test/public_ui.test.ts` 约 10800 行，很多测试是字符串级 harness，能防回归但不能证明真实浏览器不卡。
- 所以接下来不能继续在巨型 `app.js` 上堆功能，必须先做前端稳定性重构，否则每加一个页面都会继续出现“点一下卡死”的问题。

---

## 1. 产品边界

### v1.0 必须做到

- 手机 / 网页可以创建、继续、搜索、收藏、归档 Codex 会话。
- 会话流式输出稳定，页面刷新、手机切后台、网络断开重连后不丢当前 turn 状态。
- 运行中的 turn 可以停止、审批、追加指令，也就是远程 steering。
- 可以看到当前 cwd、模型、推理强度、sandbox、approval、collaboration mode、goal、provider 状态。
- 可以查看工作区 Git 状态、变更文件、diff、文件内容预览。
- 可以运行受控终端命令，看输出，并把输出附加到下一条 Codex 指令。
- 可以管理 Skills、Plugins、MCP、Apps/connectors、运行时 reload、配置诊断。
- 支持第三方 API 模式，不把 OpenAI 官方登录 / usage 不可用当作核心功能失败。
- PWA / 移动端有任务队列、审批优先视图、重连状态、失败提示。
- 有健康检查、日志、备份、恢复、回滚、部署脚本。

### v1.0 不做

- 不在浏览器里重新实现 Codex agent。
- 不把桌面端 UI 一比一复制到网页。
- 不默认展示团队管理、角色管理、多人协作入口。
- 不让网页任意访问服务器文件系统，所有文件/终端都必须绑定项目 cwd。

---

## 2. 总体架构

### 后端分层

- `codex-native-api`
  - 只负责和 Codex app-server / CLI 能力通讯。
  - 暴露 session、turn、steer、approval、skills、plugins、MCP、apps、config。
- `codex-web/src/runtime.ts`
  - Web 对 Codex runtime 的业务门面。
  - 负责 turn 生命周期、远程命令、active turn 持久化、事件归一化。
- `codex-web/src/server.ts`
  - HTTP API、auth、权限、SSE、静态资源。
  - 后续需要继续拆路由，避免单文件过大。
- `~/.codex-web`
  - 保存 Web 专属状态：auth、identity、session metadata、active turns、artifact index、audit、device sessions。

### 前端目标结构

先保持原生 JS，不急着引入复杂框架。第一阶段目标是把一个巨型文件拆成稳定模块。

- `packages/codex-web/public/src/state.js`
  - 单一状态容器、状态更新 helper、选择器。
- `packages/codex-web/public/src/services/api.js`
  - 所有 HTTP 请求。
- `packages/codex-web/public/src/services/sse.js`
  - turn stream、workspace stream、重连、last event sequence。
- `packages/codex-web/public/src/render/shell.js`
  - 桌面 / 移动外壳，只在登录、视口模式、主 view 改变时重绘。
- `packages/codex-web/public/src/views/sessions.js`
  - 会话列表、搜索、收藏、归档。
- `packages/codex-web/public/src/views/chat.js`
  - timeline、composer、approval、stream 状态。
- `packages/codex-web/public/src/views/workbench.js`
  - 工作区、diff、终端、artifact、生态入口。
- `packages/codex-web/public/src/views/settings.js`
  - 个人设置、provider、诊断。
- `packages/codex-web/public/src/components/composer.js`
  - 输入框独立生命周期，输入和聚焦绝不能触发 shell 重绘。
- `packages/codex-web/public/src/ui/dom.js`
  - 局部 patch、事件委托、focus guard。
- `packages/codex-web/public/app.js`
  - 只作为 bootstrap，逐步瘦身到 200 行以内。

---

## 3. 稳定性红线

这些规则在所有后续功能之前生效：

- 聚焦输入框不得触发 `#app` 整体重绘。
- 输入文字不得触发 session read、workspace refresh、admin refresh。
- 会话搜索只能更新结果容器，不能替换整个 app shell。
- 切到工作台 / 设置页不能保留透明遮罩、全屏 loading 或 pointer-blocking 元素。
- `pageshow`、`focus`、`visibilitychange` 恢复逻辑必须检测当前是否在输入、选择、拖拽、滚动。
- SSE 重连只补事件，不清空 timeline。
- 任意按钮失败必须显示错误并释放 loading 状态。
- 真实浏览器 E2E 必须捕捉 console error、unhandled rejection、failed request、长任务。

---

## 4. 分阶段实施计划

### Phase 0: 建立真实浏览器回归门槛

**目的：** 先能稳定复现“点输入框卡死、点搜索卡死、点设置页卡死、刷新卡死”这类问题。

**文件：**

- Create: `packages/codex-web/test/e2e/frontend_stability.e2e.ts`
- Create: `packages/codex-web/test/e2e/helpers/server.ts`
- Modify: `packages/codex-web/package.json`
- Create: `docs/FRONTEND_STABILITY_QA.zh-CN.md`

**任务：**

- [ ] 引入 Playwright 或等价真实浏览器测试命令：`npm run test:e2e --workspace packages/codex-web`。
- [ ] 添加桌面 viewport：1440x900。
- [ ] 添加手机 viewport：390x844。
- [ ] 覆盖登录后进入首页、打开会话、聚焦输入框、输入文字、回车发送、点击输入框下方按钮。
- [ ] 覆盖侧边栏会话点击、搜索连续输入、清空搜索、新建对话。
- [ ] 覆盖工作台、设置页、报告页、能力页往返切换。
- [ ] 覆盖浏览器刷新、`pageshow`、前后台恢复。
- [ ] 测试失败条件包括：页面无响应、按钮无法点击、输入无法进入 input、console error、网络请求 pending 超时。

**验收：**

- 本地和生产预览都能跑同一套关键路径。
- 后续所有前端改动都必须先过这套稳定性测试。

### Phase 1: 前端 shell / view / component 拆分

**目的：** 消除整页重绘造成的卡死根因。

**文件：**

- Create: `packages/codex-web/public/src/state.js`
- Create: `packages/codex-web/public/src/services/api.js`
- Create: `packages/codex-web/public/src/services/sse.js`
- Create: `packages/codex-web/public/src/render/shell.js`
- Create: `packages/codex-web/public/src/views/sessions.js`
- Create: `packages/codex-web/public/src/views/chat.js`
- Create: `packages/codex-web/public/src/views/workbench.js`
- Create: `packages/codex-web/public/src/views/settings.js`
- Create: `packages/codex-web/public/src/components/composer.js`
- Create: `packages/codex-web/public/src/ui/dom.js`
- Modify: `packages/codex-web/public/app.js`
- Modify: `packages/codex-web/test/admin_render_stability.test.ts`
- Modify: `packages/codex-web/test/public_ui.test.ts`

**任务：**

- [ ] 先抽 `api.js`，让所有 fetch 走同一层，统一 loading/error/abort。
- [ ] 抽 `state.js`，禁止 view 直接乱改全局 state。
- [ ] 抽 `composer.js`，输入框独立 mount/update，输入内容由 input 自己保存，只有发送时同步到全局。
- [ ] 抽 `sessions.js`，会话搜索局部更新 `#mobile-session-results` / sidebar results。
- [ ] 抽 `chat.js`，timeline 追加事件用局部 append/patch，不重绘 shell。
- [ ] 抽 `shell.js`，只有登录状态、移动/桌面布局、主 view 切换才替换 shell。
- [ ] 抽 `workbench.js` 和 `settings.js`，移除旧 admin UI 对个人模式的影响。
- [ ] 把 `app.js` 缩成 bootstrap、路由、顶层事件协调。

**验收：**

- `app.innerHTML = ...` 不再出现在高频交互路径。
- 聚焦/输入/搜索/stream event 不会调用全局 `renderApp()`。
- 输入框连续打字时，侧边栏、timeline、工作台不会重建。

### Phase 2: 交互状态机和防卡死机制

**目的：** 从“点击触发一堆异步刷新”改成可解释的状态流。

**文件：**

- Create: `packages/codex-web/public/src/state/machines.js`
- Modify: `packages/codex-web/public/src/services/sse.js`
- Modify: `packages/codex-web/public/src/components/composer.js`
- Modify: `packages/codex-web/public/src/views/chat.js`

**任务：**

- [ ] 定义 turn 状态：`idle | starting | streaming | waiting_approval | reconnecting | steering | stopping | completed | failed`。
- [ ] 定义页面恢复状态：`visible | hidden | resuming | recovered | recover_failed`。
- [ ] 定义 composer 状态：`idle | composing | sending | steering | disabled`。
- [ ] 所有按钮根据状态机启停，禁止多个异步操作抢同一个按钮。
- [ ] 每个 async action 都必须有 finally 释放 loading。
- [ ] 对点击、搜索、刷新增加 abort controller，旧请求被新请求取消。
- [ ] 禁止一个失败请求触发整页重载。

**验收：**

- 连点搜索、新对话、工作台、设置页不会产生 pending 请求堆积。
- 输入中触发前后台恢复不会抢焦点。
- 网络断开时 UI 显示 reconnecting，不变成不可点击。

### Phase 3: 会话、turn、stream、steering 完整化

**目的：** 达到远程操作 Codex 的核心体验。

**文件：**

- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/src/active_turn_store.ts`
- Modify: `packages/codex-web/src/workspace_event_bus.ts`
- Modify: `packages/codex-web/public/src/services/sse.js`
- Modify: `packages/codex-web/public/src/views/chat.js`
- Test: `packages/codex-web/test/runtime.test.ts`
- Test: `packages/codex-web/test/server_auth.test.ts`
- Test: `packages/codex-web/test/server_multi_user.test.ts`
- Test: `packages/codex-web/test/e2e/frontend_stability.e2e.ts`

**任务：**

- [ ] turn SSE 使用 `after` / `Last-Event-ID` 补事件。
- [ ] active turn 写入 `~/.codex-web/active-turns.json`，服务重启后能显示 recoverable 状态。
- [ ] workspace SSE 推送 session created/updated、turn started/completed/failed、approval requested/resolved。
- [ ] composer 在 running turn 时变成“追加指令”，调用 `/api/turns/:turnId/steer`。
- [ ] steering 不支持时显示明确提示，不停止当前 turn。
- [ ] stop / interrupt 和 approval 都能在另一台设备上操作。

**验收：**

- 两个浏览器打开同一会话，一个发送任务，另一个能看到流式状态并审批/停止/追加指令。
- 手机刷新后仍能看到当前 turn 的真实状态。

### Phase 4: 工作区能力完整化

**目的：** 让远程工作台不只是聊天，而是能看清项目状态。

**文件：**

- Modify: `packages/codex-web/src/workspace_inspector.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/src/views/workbench.js`
- Modify: `packages/codex-web/public/styles.css`
- Test: `packages/codex-web/test/workspace_inspector.test.ts`

**任务：**

- [ ] 工作区状态显示 cwd、branch、upstream、dirty count、staged/unstaged/untracked、last commit。
- [ ] diff viewer 支持文件列表、hunk 展示、复制路径。
- [ ] 文件预览只允许项目 cwd 内路径，拒绝 `..` 和 symlink escape。
- [ ] 工作台 UI 适配当前前端风格，避免旧 admin 页面残留。
- [ ] 会话页和工作台共享同一个 workspace 状态，不重复请求。

**验收：**

- 能在手机上看清变更文件和 diff。
- 点工作台不会卡死，返回会话输入框仍可立即输入。

### Phase 5: 终端 / 进程监控

**目的：** 在网页里完成验证命令和长任务观察。

**文件：**

- Create: `packages/codex-web/src/terminal_manager.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/src/views/workbench.js`
- Test: `packages/codex-web/test/terminal_manager.test.ts`

**任务：**

- [ ] 终端只能绑定 session/project cwd，不能任意 root shell。
- [ ] API：创建命令、读取事件、输入、resize、stop、列出进程。
- [ ] 初版可以先做 command runner，PTY 后置到稳定后。
- [ ] 输出有大小上限和历史截断。
- [ ] 支持复制输出、附加输出到下一条 Codex prompt。
- [ ] 所有 terminal start/stop/input 写入 audit metadata。

**验收：**

- 能从手机运行测试命令、看输出、停止命令。
- 命令输出不会撑爆 DOM 或导致页面卡死。

### Phase 6: 生态控制台和第三方 API 模式

**目的：** 承载 Codex CLI / 桌面端生态能力。

**文件：**

- Modify: `packages/codex-native-api/src/codex_app_client.ts`
- Modify: `packages/codex-web/src/runtime.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/src/views/workbench.js`
- Modify: `packages/codex-web/public/src/views/settings.js`

**任务：**

- [ ] Skills：列表、启用/禁用、搜索、来源展示。
- [ ] Plugins：列表、详情、安装、卸载、启用状态。
- [ ] MCP：状态、启用/禁用、OAuth start、reload。
- [ ] Apps/connectors：列表、启用/禁用、授权状态。
- [ ] Config：安全写入白名单配置项，敏感值只显示是否存在。
- [ ] Provider health：区分 `provider ok`、`official usage unavailable`、`auth missing`、`unsupported`。
- [ ] 第三方 API 下不要求 OpenAI 登录，不把 usage 获取失败显示成主错误。

**验收：**

- 用户能在网页确认当前 Codex runtime 到底启用了哪些 skill/plugin/MCP。
- 第三方 API 模式下页面不再误导用户“必须登录 OpenAI”。

### Phase 7: Artifact / 报告 / 文件交付

**目的：** 让 Codex 生成的文件成为可管理结果。

**文件：**

- Create: `packages/codex-web/src/artifact_store.ts`
- Modify: `packages/codex-web/src/report_store.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/src/views/workbench.js`

**任务：**

- [ ] 建立 artifact index：sessionId、projectId、path、mime、size、createdAt、favorite。
- [ ] 支持文本、Markdown、图片、PDF、通用下载。
- [ ] report 作为 artifact 的一种来源，而不是独立孤岛。
- [ ] 路径读取必须限制在 artifact root / report root / 项目 cwd 内。
- [ ] 会话页显示“本次产物”，工作台显示“项目产物”。

**验收：**

- 手机能直接打开报告、图片、PDF。
- artifact 缺失、过大、权限不足都有明确提示。

### Phase 8: PWA 和移动端完整体验

**目的：** 让手机成为主使用场景，而不是桌面页面缩小。

**文件：**

- Modify: `packages/codex-web/public/manifest.webmanifest`
- Modify: `packages/codex-web/public/service-worker.js`
- Modify: `packages/codex-web/public/src/views/mobile.js`
- Modify: `packages/codex-web/public/styles.css`
- Create: `docs/MOBILE_REMOTE_WORKBENCH_E2E.zh-CN.md`

**任务：**

- [ ] 移动端首页优先显示任务队列：运行中、待审批、失败、最近完成。
- [ ] 待审批视图优先展示命令/文件摘要和 allow/deny。
- [ ] 添加连接状态：connected、reconnecting、offline、server unavailable。
- [ ] 添加后台恢复提示：正在恢复、已补齐、恢复失败。
- [ ] 输入框固定但不遮挡内容，键盘弹起时不触发整体重绘。
- [ ] PWA 缓存只缓存静态资源，不缓存登录态 API 响应。

**验收：**

- iPhone/Android 浏览器完成登录、发任务、切后台、回来审批、看 diff、看 artifact。
- 移动端连续点击不会出现刷新一直转圈。

### Phase 9: 安全、审计、设备管理

**目的：** 个人工具也要有可追踪和可恢复能力。

**文件：**

- Create: `packages/codex-web/src/audit_store.ts`
- Modify: `packages/codex-web/src/auth_store.ts`
- Modify: `packages/codex-web/src/hybrid_auth_store.ts`
- Modify: `packages/codex-web/src/server.ts`
- Modify: `packages/codex-web/public/src/views/settings.js`

**任务：**

- [ ] 设备 session 列表：当前设备、last seen、revoke。
- [ ] 审计 JSONL：login、logout、turn start/stop/steer、approval、terminal、plugin/MCP/config 写入、artifact 分享读取。
- [ ] 审计不得保存密码、token、文件内容、命令输出。
- [ ] 单用户模式下 UI 简化为“我的设备”和“操作记录”。
- [ ] 多用户 RBAC 保留在后端和隐藏高级入口，不占主界面。

**验收：**

- 可以踢掉其他浏览器登录。
- 出问题时能看出是谁在什么时候做了什么操作。

### Phase 10: 运维、诊断、备份、回滚

**目的：** 真正能上线运行，不靠手工记命令。

**文件：**

- Create: `scripts/install/install-codex-web-linux-systemd.sh`
- Create: `scripts/service/status-codex-web-linux.sh`
- Create: `scripts/service/backup-codex-web-state.sh`
- Create: `scripts/service/restore-codex-web-state.sh`
- Create: `scripts/service/rollback-codex-web-release.sh`
- Create: `packages/codex-web/src/diagnostics.ts`
- Modify: `docs/DEPLOYMENT.md`
- Modify: `docs/HANDOVER.zh-CN.md`

**任务：**

- [ ] 一键 status：Node/npm/Codex CLI 版本、service active、端口、nginx、state dir、provider 状态。
- [ ] `/api/diagnostics/summary` 输出可复制诊断报告。
- [ ] backup 包含源码 commit、`~/.codex-web`、service env、nginx 配置摘要。
- [ ] restore 支持 dry-run，默认要求 service stopped。
- [ ] rollback 支持回到上一个部署目录并重启服务。
- [ ] 文档写清楚：升级、健康检查、失败回滚、系统重启提醒如何处理。

**验收：**

- 每次部署前能自动备份。
- 部署失败能回滚。
- “系统需要重启 / 100+ 包可升级”被记录为 OS 维护项，不和 app 故障混淆。

---

## 5. 上线验收门槛

### 必跑命令

```bash
npm test --workspace packages/codex-web
npm run typecheck --workspace packages/codex-web
npm test --workspace packages/codex-native-api
npm run typecheck --workspace packages/codex-native-api
npm run build --workspaces --if-present
npm run test:e2e --workspace packages/codex-web
node --check packages/codex-web/public/app.js
```

### 必测真实流程

- 桌面浏览器：登录、打开会话、搜索、创建新会话、输入、回车发送、停止、追加指令。
- 手机浏览器：输入、切后台、回来、刷新、审批、打开工作台、看 diff。
- 双浏览器：同一会话同步 turn、approval、steer、stop。
- 生产部署：`systemctl restart codex-web.service` 后，当前 session 不显示假死。
- 第三方 API：无 OpenAI 官方登录时，核心会话功能仍正常。

---

## 6. 执行顺序

1. Phase 0：真实浏览器稳定性测试。
2. Phase 1：前端模块化，移除高频整页重绘。
3. Phase 2：交互状态机，解决点击/输入/刷新卡死。
4. Phase 3：session/turn/stream/steering 完整化。
5. Phase 4：工作区 UI 和 diff。
6. Phase 5：终端 / 进程监控。
7. Phase 6：生态控制台和第三方 API 模式。
8. Phase 7：artifact / 报告 / 文件交付。
9. Phase 8：PWA / 移动端完整体验。
10. Phase 9：安全、审计、设备管理。
11. Phase 10：运维、诊断、备份、回滚。

这个顺序不能反过来。当前页面卡顿没有解决前，不应该继续大规模加 UI，否则每个新功能都会变成新的卡死入口。

---

## 7. 最近一次执行建议

下一步不要直接做终端、artifact 或更多生态页面。应该先开一个“前端稳定性重构”执行分支，按下面小步走：

1. 增加 Playwright 稳定性 E2E，先让现有卡死路径可复现。
2. 抽出 `api.js` 和 `composer.js`，保证输入框不被全局 render 控制。
3. 抽出 `sessions.js`，保证搜索和新建会话只局部更新。
4. 抽出 `chat.js`，保证 stream event 只追加 timeline。
5. 抽出 `shell.js`，限制 `#app` 重绘场景。
6. 跑本地测试、真实浏览器测试。
7. 推送部署到生产，让 `https://cockpit.codexgu.website/` 做验收。

完成这一步后，再进入工作台功能补全。否则继续补功能会持续消耗时间在同一类前端卡死问题上。
