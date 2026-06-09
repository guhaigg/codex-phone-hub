# Codex Phone Hub 项目接手文档

本文档面向后续接手开发、运维和部署的工程师。它描述当前项目结构、生产部署方式、服务器配置要点、验证方式、已知风险和后续开发路线。

> 安全说明：本仓库是公开仓库。服务器 IP、SSH 密码、Web 登录密码、真实域名、root 凭据、`.codex`/`.codex-web` 状态文件等敏感信息不得写入 Git。交接时请通过密码管理器或私有渠道单独传递。

## 1. 项目定位

Codex Phone Hub 是一个自托管移动端 Web 控制台，用于从手机、平板或桌面浏览器控制服务器/主机上的已登录 Codex runtime。

核心原则：

- 浏览器只是远程 UI。
- Codex 凭据、文件读写、shell 执行、会话状态都留在宿主机。
- 所有主要按钮必须真实调用后端或 Codex runtime，不做假 UI。
- 前端设计继续遵循 `design-taste-frontend / taste-skill`：轻分隔、少卡片、Apple/Codex 风格、移动端优先。

## 2. 仓库信息

- GitHub：<https://github.com/guhaigg/codex-phone-hub>
- 默认分支：`main`
- Node 要求：`>=24`
- 包管理：npm workspaces
- 根包名：`codex-phone-hub`
- 主要包：
  - `packages/codex-web`：Web UI、HTTP API、认证、RBAC、Codex runtime bridge
  - `packages/codex-native-api`：本地 Codex app-server 集成、OpenAI-compatible API facade、daemon 辅助能力

## 3. 目录结构

```text
packages/codex-web
  public/                 手机端/桌面端前端静态资源
  src/server.ts           HTTP API、静态资源、SSE、认证入口
  src/runtime.ts          Codex session/turn/runtime bridge
  src/identity_store.ts   多用户、项目、角色、session 映射持久化
  src/auth_store.ts       单用户密码与 session token 存储
  src/hybrid_auth_store.ts 单用户/多用户混合认证
  test/                   后端、runtime、认证、RBAC、UI 快照测试

packages/codex-native-api
  src/codex_app_client.ts Codex app-server 客户端
  src/native_api_server.ts OpenAI-compatible HTTP facade
  src/daemon_manager.ts   systemd/launchd/Windows service 规划

docs/
  API_MAP.md              UI/API/runtime 调用链映射
  DEPLOYMENT.md           部署说明
  MOBILE_E2E.md           移动端 E2E 检查清单
  HANDOVER.zh-CN.md       本接手文档

scripts/
  install/                macOS 自动安装脚本
  service/                launchd 服务辅助脚本

skills/
  codex-mobile-report     手机端报告生成 skill
  codex-web-user-context  Web 用户/项目上下文 skill
```

## 4. 生产服务器设置

### 4.1 敏感信息交接

以下内容必须通过私有渠道交接，不要写入 GitHub、issue、PR、README、日志截图：

- 服务器公网 IP / SSH 主机名
- SSH 用户名和密码或私钥
- Web 控制台登录账号和密码
- 真实生产域名
- Cloudflare/Nginx/反向代理 token
- `~/.codex/auth.json`
- `~/.codex-web/auth.json`
- `~/.codex-web/identity.json`
- 上传文件、报告、日志、备份目录

建议在密码管理器中保存为：

```text
Codex Phone Hub / Production SSH
Codex Phone Hub / Web Admin
Codex Phone Hub / Reverse Proxy
```

### 4.2 生产目录约定

当前生产部署建议保持以下目录约定：

```text
/opt/codex-web/             应用代码 checkout 或发布目录
/opt/codex-web/backups/     手工备份目录，不提交 Git
/opt/workday/               默认/示例项目工作目录
~/.codex/                   Codex CLI 登录态与配置
~/.codex-web/               Codex Phone Hub 状态目录
~/.codex-web/reports/       手机端报告目录
~/.codex-web/uploads/       上传文件 fallback 目录
~/.codex-web/logs/          应用日志
```

如果后续改目录，需要同步：

- systemd service 的 `WorkingDirectory`
- 环境变量 `CODEX_WEB_DEFAULT_CWD`
- 多用户项目配置里的 `cwd`
- 反向代理 upstream 端口

### 4.3 systemd 服务

生产推荐使用 systemd 管理服务。服务名可继续使用：

```text
codex-web.service
```

典型配置：

```ini
[Unit]
Description=Codex Phone Hub mobile console
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/codex-web
Environment=NODE_ENV=production
Environment=CODEX_WEB_HOST=127.0.0.1
Environment=CODEX_WEB_PORT=43210
Environment=CODEX_WEB_DEFAULT_CWD=/opt/workday
ExecStart=/usr/bin/env npm run serve --workspace packages/codex-web
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

常用命令：

```bash
systemctl status codex-web.service
systemctl restart codex-web.service
journalctl -u codex-web.service -f
```

如果以 user service 方式部署，使用：

```bash
systemctl --user status codex-web.service
systemctl --user restart codex-web.service
journalctl --user -u codex-web.service -f
```

### 4.4 Web 登录密码设置

首次部署或重置 Web 登录密码：

```bash
cd /opt/codex-web
npm run codex-web -- auth set-password
systemctl restart codex-web.service
```

不要通过命令历史保存明文密码。若必须非交互设置，使用临时环境变量后立即清理 shell history 或在受控自动化环境中执行：

```bash
CODEX_WEB_PASSWORD='REDACTED' npm run codex-web -- auth set-password
```

### 4.5 多用户/RBAC 状态

多用户、项目、角色和 session 映射保存在状态目录，默认：

```text
~/.codex-web/identity.json
```

关键概念：

- `users`：Web 用户
- `roles`：角色
- `projects`：可授权工作区
- `projectGrants`：角色对项目的授权矩阵
- `sessions`：Web app session 到 Codex thread 的映射

角色项目授权必须保持三个独立布尔值：

```text
canRead
canCreate
canWrite
```

不要再把这三个值归一化成全部 `true`，否则只读角色会被错误提升。

### 4.6 反向代理/TLS

本仓库不管理反向代理。推荐策略：

- Codex Phone Hub 只监听 `127.0.0.1:<port>`
- 由 Nginx/Caddy/Cloudflare Tunnel/其他网关负责公网入口和 TLS
- 反向代理必须支持：
  - WebSocket/SSE 长连接或至少不缓冲 SSE
  - 大请求体上传限制按实际附件需求配置
  - 合理 idle timeout，避免长 turn 被中断

Nginx 示例片段：

```nginx
location / {
  proxy_pass http://127.0.0.1:43210;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;
  proxy_read_timeout 3600s;
  client_max_body_size 50m;
}
```

## 5. 本地开发

### 5.1 安装依赖

```bash
npm install
```

### 5.2 类型检查

```bash
npm run typecheck --workspaces --if-present
```

### 5.3 默认测试

```bash
npm test --workspaces --if-present
```

当前默认测试包含后端、runtime、认证、RBAC、文档和服务脚本测试。

### 5.4 UI 快照测试

历史 UI 快照测试单独运行：

```bash
npm run test:ui --workspace packages/codex-web
```

说明：

- 该测试覆盖大量旧版 DOM/CSS 字符串断言。
- 当前生产前端已经重构为移动端优先实现，部分旧断言不再代表真实验收标准。
- 新增或重写前端测试时，优先围绕真实用户路径、API 调用和移动端交互稳定性。

### 5.5 启动开发服务

```bash
npm run serve --workspace packages/codex-web
```

或使用根脚本：

```bash
npm run codex-web -- serve
```

## 6. 当前已实现能力

### 6.1 手机端工作台

- 移动端底部导航
- 会话列表
- 新建会话
- 会话聊天
- turn SSE 流式输出
- 附件上传
- 报告列表与报告查看
- 设置页
- 能力页
- 管理页

### 6.2 真实 Codex runtime 链路

已确认核心链路：

```text
POST /api/sessions
  -> runtime.createSession()
  -> client.startThread()

POST /api/sessions/:id/turns
  -> runtime.startTurn()
  -> client.startTurn()
```

新建会话和 turn 支持传递：

- `cwd`
- `model`
- `reasoningEffort`
- `sandboxMode`
- `approvalPolicy`
- `collaborationMode`
- `personality`
- attachments
- developer instructions

### 6.3 管理能力

管理页已支持：

- 项目新增/编辑/启停/会话上限
- 用户新增/启停/邮箱/角色
- 多用户开关
- 角色新增/编辑
- 项目授权矩阵：
  - `canRead`
  - `canCreate`
  - `canWrite`
- 管理员 session audit
- observer/read-only 查看

### 6.4 移动端稳定性修复

已修复设置页/管理页下拉框闪屏、卡住、打不开问题：

- 表单控件交互期间不触发会破坏 DOM 的后台刷新
- `visibilitychange` 不打断 active select/input/textarea
- 能力页不再预加载 admin 数据，避免跨页后台刷新重建管理页 DOM

关键函数/模式：

```text
isFormControlInteractionActive()
renderAfterBackgroundRefresh()
```

后续修改移动端刷新逻辑时，必须保留这个保护。

## 7. 验证清单

### 7.1 发布前必跑

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

### 7.2 安全扫描

提交前执行：

```bash
rg -n "真实密码|真实IP|真实域名|PRIVATE KEY|BEGIN RSA|auth\\.json|identity\\.json" -S .
```

实际使用时请把 `真实密码/真实IP/真实域名` 替换为本次交接中的真实值。

允许出现在文档中的说明性路径：

```text
~/.codex/auth.json
~/.codex-web/auth.json
~/.codex-web/identity.json
```

不允许提交这些文件本体或其中内容。

### 7.3 移动端 E2E

参考：

```text
docs/MOBILE_E2E.md
```

关键验收点：

```text
console errors: []
badResponses: []
settings select: sameNode=true, activeAfter=true
admin role select: sameNode=true, activeAfter=true
```

## 8. 部署/升级流程

推荐升级步骤：

```bash
cd /opt/codex-web
scripts/service/backup-codex-web-state.sh
git pull --ff-only origin main
npm install
npm run build --workspaces --if-present
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
systemctl restart codex-web.service
scripts/service/status-codex-web-linux.sh
```

如果生产目录不是 Git checkout，而是手工发布目录：

1. 在本地或 CI 生成发布包。
2. 排除 `node_modules`、`.git`、`backups`、状态文件。
3. 上传到 `/opt/codex-web`。
4. 在服务器执行 `npm install`。
5. 重启服务。

升级前建议备份：

```bash
cd /opt/codex-web
scripts/service/backup-codex-web-state.sh \
  --app-dir /opt/codex-web \
  --state-dir /root/.codex-web \
  --env-path /root/.config/codex-web/service.env
```

线上状态检查：

```bash
cd /opt/codex-web
scripts/service/status-codex-web-linux.sh
```

Web 端设置页会调用 `GET /api/diagnostics/summary` 展示系统重启标记、可升级包数量、service 状态、状态目录可写性、最近备份和 provider/usage 状态。`/var/run/reboot-required` 为 `yes` 只表示 Linux 内核或基础包更新后建议安排维护窗口重启，不表示 `codex-web.service` 本身异常；第三方 API 模式下官方用量不可读也不影响 Codex CLI 运行。

状态恢复：

```bash
cd /opt/codex-web
systemctl stop codex-web.service
scripts/service/restore-codex-web-state.sh \
  --backup /opt/codex-web/backups/YYYYMMDD-HHMMSS \
  --state-dir /root/.codex-web \
  --env-path /root/.config/codex-web/service.env
systemctl start codex-web.service
scripts/service/status-codex-web-linux.sh
```

版本回滚：

```bash
cd /opt/codex-web
scripts/service/rollback-codex-web-release.sh \
  --backup /opt/codex-web/backups/YYYYMMDD-HHMMSS \
  --app-dir /opt/codex-web
scripts/service/status-codex-web-linux.sh
```

`restore-codex-web-state.sh --dry-run` 只预览动作；默认服务仍在 `active` 时会拒绝覆盖状态目录，除非明确传 `--force`。

## 9. 后续开发路线

### 9.1 高优先级

1. 重写移动端 UI 自动化测试
   - 用真实浏览器/Playwright 路径替代旧字符串快照。
   - 覆盖登录、新建会话、设置 select、管理角色授权、报告查看。
2. 增强管理页可观测性
   - 每次项目/用户/角色保存后显示明确成功/失败状态。
   - session audit 支持更细的筛选和导出。
3. 完善生产部署脚本
   - Linux systemd 安装脚本已加入：`scripts/install/install-codex-web-linux-systemd.sh`。
   - 一键健康检查脚本已加入：`scripts/service/status-codex-web-linux.sh`。
4. 加强备份/恢复
   - 备份脚本已加入：`scripts/service/backup-codex-web-state.sh`。
   - 恢复脚本已加入：`scripts/service/restore-codex-web-state.sh`。
   - 回滚脚本已加入：`scripts/service/rollback-codex-web-release.sh`。
   - 仍需定期在生产备份上做人工演练。

### 9.2 中优先级

1. 前端设计继续统一
   - 所有新增页面继续走 `design-taste-frontend / taste-skill`。
   - 减少普通后台表格，多用移动端友好的行、分组、轻量 sheet。
2. 权限体验优化
   - 普通用户看不到不可操作入口。
   - 只读角色明确显示只读状态。
3. 报告系统增强
   - 报告搜索、标签、项目过滤。
   - HTML 报告安全渲染策略继续收紧。
4. PWA 增强
   - 离线提示。
   - 新版本检测提示。
   - iOS 安装引导优化。

### 9.3 低优先级

1. 主题系统扩展
   - 深色模式细节。
   - 站点品牌色配置。
2. 多语言补齐
   - 英文 UI 完整性。
   - 动态内容不参与批量翻译。
3. 原生 API facade 扩展
   - OpenAI-compatible responses 兼容更多字段。
   - daemon 管理命令完善。

## 10. 开发约束

### 10.1 前端约束

- 前端设计必须使用 `design-taste-frontend / taste-skill`。
- 不要做普通后台表格堆叠。
- 手机端优先。
- 下拉框、输入框、textarea 交互期间不能被后台刷新重建。
- 所有按钮必须有真实后端作用。

### 10.2 后端约束

- 不要绕过 `runtime.ts` 直接伪造 Codex 结果。
- 新 API 必须有认证和权限判断。
- 多用户模式下必须检查 session owner、project grant、observer mode。
- 上传文件必须限制在允许目录内。
- report path 必须防止目录穿越和 symlink 逃逸。

### 10.3 Git/安全约束

- 不提交：
  - `.codex/`
  - `.codex-web/`
  - `node_modules/`
  - `dist/`
  - `backups/`
  - `.env`
  - 日志
  - 服务器凭据
- 提交前跑敏感信息扫描。
- 生产密码重置后不要把密码写入 issue、commit message 或文档。

## 11. 常见故障

### 11.1 登录提示未配置密码

现象：

```text
Password not configured. Run codex-web auth set-password.
```

处理：

```bash
cd /opt/codex-web
npm run codex-web -- auth set-password
systemctl restart codex-web.service
```

### 11.2 手机端下拉框打不开或闪屏

重点检查：

- 是否在 `select/input/textarea` active 时调用了全量 `render()`
- 是否新增了跨页面预加载并修改了 admin/settings 状态
- 是否绕过了 `isFormControlInteractionActive()`

### 11.3 新建会话没有使用选择的配置

检查：

- 前端 `POST /api/sessions` payload
- `runtime.createSession()` 参数
- `client.startThread()` 参数
- `docs/API_MAP.md` 中对应字段

### 11.4 角色只读权限失效

检查：

- `normalizeRoleProjectGrants()`
- `identity.json` 中 `projectGrants`
- 是否错误把 `canRead/canCreate/canWrite` 全部归一化为 `true`

### 11.5 SSE/长任务中断

检查：

- systemd 是否重启服务
- 反向代理 `proxy_read_timeout`
- 是否开启了 proxy buffering
- 浏览器网络是否切换

## 12. 接手人第一天建议

1. 克隆仓库。
2. 阅读：
   - `README.zh-CN.md`
   - `docs/API_MAP.md`
   - `docs/DEPLOYMENT.md`
   - `docs/MOBILE_E2E.md`
   - 本文档
3. 本地执行：

   ```bash
   npm install
   npm run typecheck --workspaces --if-present
   npm test --workspaces --if-present
   ```

4. 通过私有渠道拿到生产 SSH/Web 登录信息。
5. 登录服务器只读检查：

   ```bash
   systemctl status codex-web.service
   journalctl -u codex-web.service -n 100 --no-pager
   ```

6. 手机浏览器验证：
   - 登录
   - 打开设置页 select
   - 打开管理页角色授权 select
   - 新建一个测试 session
   - 查看 reports 页面

完成以上步骤后，再开始修改代码。
