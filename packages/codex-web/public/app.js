const APP_BUILD_ID = "__CODEX_WEB_BUILD_ID__";
const TOKEN_KEY = "codexWebToken";
const THEME_KEY = "codexWebTheme";
const SITE_TITLE_KEY = "codexWebSiteTitle";
const DEFAULT_THREAD_SETTINGS_KEY = "codexWebDefaultThreadSettings";
const DEFAULT_CWD_KEY = "codexWebDefaultCwd";

const zh = {
  "Log in": "登录",
  "Username": "账号",
  "Password": "密码",
  "No sessions found.": "还没有会话",
  "Loading session": "正在加载会话",
  "Turn running": "运行中",
  "Turn failed": "失败",
  "Turn stopped": "已停止",
  "Ready": "已完成",
  "Stream paused": "已暂停",
  "history": "历史",
  "preview": "预览",
  "sending": "发送中",
  "streaming": "生成中",
  "final": "完成",
  "failed": "失败",
};

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  siteTitle: normalizeSiteTitle(localStorage.getItem(SITE_TITLE_KEY) || "Codex"),
  authSession: null,
  sessions: [],
  currentSession: null,
  sessionId: "",
  timeline: [],
  models: [],
  reports: [],
  currentReport: null,
  reportContent: "",
  reportLoading: false,
  usage: null,
  settings: null,
  permissions: {},
  projects: [],
  admin: { settings: null, projects: [], roles: [], users: [] },
  adminLoading: false,
  adminSaving: false,
  model: "",
  view: "sessions",
  isMobile: window.innerWidth < 820,
  loading: false,
  sessionsLoading: false,
  loginError: "",
  status: "Ready",
  statusTone: "success",
  error: "",
  prompt: "",
  pendingTurn: false,
  turnId: "",
  streamAbortController: null,
  lastTurnEventSequence: null,
  settingsOpen: false,
  sessionToolsOpen: false,
  search: "",
  sortMode: "all",
  theme: localStorage.getItem(THEME_KEY) || "light",
  defaultThreadSettings: loadDefaultThreadSettings(),
  defaultCwd: localStorage.getItem(DEFAULT_CWD_KEY) || "",
  selectedFiles: [],
  notice: "",
  settingsSaving: false,
};

const app = document.querySelector("#app");
let lastFormControlInteractionAt = 0;
applyTheme(state.theme);
boot();

window.addEventListener("resize", () => {
  const next = window.innerWidth < 820;
  if (next !== state.isMobile) {
    state.isMobile = next;
    if (!next && state.view === "settings") state.view = "sessions";
    render();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.token) {
    if (isFormControlInteractionActive()) return;
    refreshSessions({ silent: true }).catch(() => null);
    if (state.sessionId) refreshCurrentSession({ silent: true }).catch(() => null);
  }
});

document.addEventListener("focusin", (event) => {
  if (isFormControl(event.target)) markFormControlInteraction();
}, true);

document.addEventListener("pointerdown", (event) => {
  if (isFormControl(event.target)) markFormControlInteraction();
}, true);

async function boot() {
  if (!state.token) {
    render();
    return;
  }
  await restoreAuth();
}

async function restoreAuth() {
  state.loading = true;
  render();
  try {
    const me = await apiFetch("/api/auth/me");
    state.authSession = me.session || null;
    await Promise.all([
      refreshSettings().catch(() => null),
      refreshModels().catch(() => null),
      refreshSessions({ silent: true }).catch(() => null),
    ]);
    state.error = "";
  } catch (error) {
    handleApiError(error, { auth: true });
  } finally {
    state.loading = false;
    render();
  }
}

async function apiFetch(path, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.skipAuth ? {} : state.token ? { Authorization: `Bearer ${state.token}` } : {}),
    ...(options.headers || {}),
  };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!response.ok) throw await buildApiError(response);
  if (response.status === 204) return null;
  return response.json();
}

async function buildApiError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch (_error) {
    payload = null;
  }
  const error = new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  error.status = response.status;
  error.payload = payload;
  return error;
}

function handleApiError(error, options = {}) {
  const message = error?.payload?.message || error?.message || "请求失败";
  if (error?.payload?.error === "setup_required") {
    state.error = `${message}\n请先在服务器执行 codex-web auth set-password`;
    state.token = "";
    localStorage.removeItem(TOKEN_KEY);
    render();
    return;
  }
  if (error?.status === 401 || options.auth) {
    stopStream();
    state.token = "";
    state.authSession = null;
    state.currentSession = null;
    state.sessionId = "";
    localStorage.removeItem(TOKEN_KEY);
    state.loginError = options.login ? message : "登录已过期，请重新登录";
    render();
    return;
  }
  state.error = message;
  state.status = "Turn failed";
  state.statusTone = "danger";
  render();
}

function render() {
  if (!app) return;
  if (!state.token) {
    app.innerHTML = renderLogin();
    bindLogin();
    return;
  }
  app.innerHTML = state.isMobile ? renderMobileApp() : renderDesktopApp();
  bindApp();
  requestAnimationFrame(scrollChatToBottom);
}

function renderLogin() {
  return `
    <main class="login-screen">
      <section class="login-brand">
        <div class="brand-orb">C</div>
        <h1>${escapeHtml(state.siteTitle)}</h1>
        <p>新一代 AI 编程代理。在浏览器中高效管理和执行复杂编程任务。</p>
        <div class="login-pills">
          <span>会话持续运行</span>
          <span>移动端可用</span>
          <span>任务状态追踪</span>
        </div>
      </section>
      <form class="login-card" id="login-form">
        <h2>欢迎使用</h2>
        <p class="muted">登录以管理你的 AI 编程任务</p>
        <label>
          <span>账号</span>
          <input name="username" autocomplete="username" placeholder="账号" value="">
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autocomplete="current-password" placeholder="密码" required>
        </label>
        ${state.loginError ? `<div class="error-note">${escapeHtml(state.loginError)}</div>` : ""}
        <button class="primary" type="submit">${state.loading ? "登录中..." : "登录"}</button>
        <div class="login-foot">
          <label class="check-row"><input type="checkbox" checked> <span>保持登录</span></label>
          <a href="#" tabindex="-1">忘记密码?</a>
        </div>
      </form>
    </main>
  `;
}

function bindLogin() {
  const form = document.querySelector("#login-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    state.loading = true;
    state.loginError = "";
    render();
    try {
      const payload = await apiFetch("/api/auth/login", {
        method: "POST",
        skipAuth: true,
        body: {
          username: String(data.get("username") || ""),
          password: String(data.get("password") || ""),
        },
      });
      state.token = payload.token || "";
      state.authSession = payload.session || null;
      localStorage.setItem(TOKEN_KEY, state.token);
      await restoreAuth();
    } catch (error) {
      state.loading = false;
      state.loginError = error?.payload?.message || error?.message || "账号或密码错误";
      render();
    }
  });
}

function renderDesktopApp() {
  return `
    <main class="desktop-shell">
      <aside class="session-pane">
        ${renderSessionHeader(false)}
        ${renderSessionList()}
      </aside>
      <section class="workspace-pane">
        ${renderWorkspace(false)}
      </section>
    </main>
  `;
}

function renderMobileApp() {
  const content = state.view === "sessions"
    ? `<section class="mobile-page">${renderSessionHeader(true)}${renderSessionList()}</section>`
    : renderWorkspace(true);
  return `
    <main class="mobile-shell">
      ${content}
      ${renderBottomNav()}
    </main>
  `;
}

function renderWorkspace(mobile) {
  if (state.view === "settings") return renderSettings(mobile);
  if (state.view === "reports") return renderReports(mobile);
  if (state.view === "admin") return renderAdmin(mobile);
  if (state.view === "capabilities") return renderCapabilities(mobile);
  return renderChatOrEmpty(mobile);
}

function renderSessionHeader(mobile) {
  return `
    <header class="sessions-head">
      <div class="title-row">
        <div>
          <h1>${escapeHtml(state.siteTitle)}</h1>
          <p>${mobile ? "移动 AI 编程代理" : "会话与任务"}</p>
        </div>
        <button class="icon-btn" id="open-settings" title="设置">${icon("user")}</button>
      </div>
      <label class="search-box">
        ${icon("search")}
        <input id="session-search" value="${escapeAttribute(state.search)}" placeholder="搜索会话或任务">
      </label>
      ${renderViewTabs(mobile)}
      <button class="new-session-btn" id="new-session-button">${icon("plus")}<span>新建任务</span></button>
      <div class="filter-row">
        ${filterButton("all", "全部")}
        ${filterButton("favorites", "收藏")}
        ${filterButton("archived", "归档")}
      </div>
    </header>
  `;
}

function renderViewTabs(mobile) {
  const items = mobile
    ? [["sessions", "会话"], ["capabilities", "能力"], ["reports", "报告"], ["settings", "设置"]]
    : [["sessions", "会话"], ["capabilities", "能力"], ["reports", "报告"], ["admin", "管理"], ["settings", "设置"]];
  return `<nav class="view-tabs">${items.map(([view, label]) => (
    `<button class="${state.view === view || (view === "sessions" && state.view === "chat") ? "active" : ""}" data-view="${view}">${label}</button>`
  )).join("")}</nav>`;
}

function filterButton(mode, label) {
  return `<button class="chip ${state.sortMode === mode ? "active" : ""}" data-filter="${mode}">${escapeHtml(label)}</button>`;
}

function renderSessionList() {
  if (state.sessionsLoading) return `<div class="session-list">${Array.from({ length: 5 }).map(() => skeletonCard()).join("")}</div>`;
  const sessions = filteredSessions();
  if (!sessions.length) {
    return `
      <div class="empty-list">
        <div class="empty-plus">+</div>
        <h2>${state.search ? "没有匹配会话" : "还没有会话"}</h2>
        <p>${state.search ? "换个关键词试试。" : "点击新建任务，开始第一段 Codex 会话。"}</p>
      </div>
    `;
  }
  return `<div class="session-list">${sessions.map(renderSessionCard).join("")}</div>`;
}

function renderSessionCard(session) {
  const status = sessionStatus(session);
  return `
    <article class="session-card ${state.sessionId === session.id ? "active" : ""}" data-session-id="${escapeAttribute(session.id)}">
      <button class="session-main" data-session-open="${escapeAttribute(session.id)}">
        <span class="session-title">${escapeHtml(sessionTitle(session))}</span>
        <span class="session-summary">${escapeHtml(sessionPreview(session))}</span>
        <span class="session-meta">${icon("clock")} ${escapeHtml(formatTime(session.updatedAt || session.lastInputAt))}</span>
      </button>
      <div class="session-side">
        ${statusBadge(status)}
        <button class="mini-btn" data-favorite="${escapeAttribute(session.id)}" title="收藏">${isFavorite(session) ? "★" : "☆"}</button>
        <button class="mini-btn" data-archive="${escapeAttribute(session.id)}" title="${session.archived ? "取消归档" : "归档"}">•••</button>
      </div>
    </article>
  `;
}

function renderChatOrEmpty(mobile) {
  if (!state.currentSession && !state.sessionId && !state.prompt && !state.sessionToolsOpen) {
    return `
      <section class="chat-pane empty-chat">
        <div class="empty-hero">
          <div class="empty-plus">+</div>
          <h2>开始新的会话</h2>
          <p>在左侧选择会话，或点击新建任务。</p>
          <button class="primary" id="empty-new-session-button">新建任务</button>
        </div>
      </section>
    `;
  }
  return `
    <section class="chat-pane">
      <header class="chat-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div class="chat-title">
          <h2>${escapeHtml(sessionTitle(state.currentSession || {}))}</h2>
          <div>${statusBadge(currentStatus())}</div>
        </div>
        <button class="icon-btn" id="toggle-session-tools" title="能力">${icon("sliders")}</button>
        ${state.currentSession?.id ? `<button class="icon-btn" id="share-session" title="分享">${icon("share")}</button>` : ""}
        <button class="icon-btn" id="refresh-session" title="刷新">${icon("refresh")}</button>
      </header>
      ${state.notice ? `<div class="notice-line">${escapeHtml(state.notice)}</div>` : ""}
      ${state.sessionToolsOpen ? renderSessionTools() : ""}
      <div class="messages" id="messages">
        ${renderTimeline()}
      </div>
      ${renderComposer()}
    </section>
  `;
}

function renderTimeline() {
  if (!state.timeline.length) {
    return `
      <div class="empty-inline">
        <h3>空白会话</h3>
        <p>向 Codex 描述你要完成的任务。</p>
      </div>
    `;
  }
  return state.timeline.map(renderTimelineItem).join("");
}

function renderTimelineItem(item) {
  if (item.kind === "batch" || item.kind === "approval" || item.kind === "step") {
    return `
      <article class="work-card">
        <div class="work-title">${escapeHtml(item.title || item.approvalKind || "工具调用")}</div>
        <pre>${escapeHtml(formatSummary(item.summary || item.text || item.status || ""))}</pre>
        ${item.kind === "approval" && item.approvalId ? renderApprovalActions(item.approvalId) : ""}
      </article>
    `;
  }
  const role = item.role || "assistant";
  const isUser = role === "user";
  const isError = item.severity === "error";
  return `
    <article class="message ${isUser ? "user" : "assistant"} ${isError ? "error" : ""}">
      <div class="message-label">${escapeHtml(isUser ? "你" : isError ? "错误" : "Codex")}${item.meta ? `<span>${escapeHtml(translate(item.meta))}</span>` : ""}</div>
      <div class="message-body">${renderMessageText(item.text || "")}</div>
      ${isError ? `<button class="retry-btn" id="retry-last">重试</button>` : ""}
    </article>
  `;
}

function renderApprovalActions(approvalId) {
  const id = escapeAttribute(approvalId);
  return `
    <div class="approval-actions">
      <button data-approval="${id}" data-approval-action="accept">允许一次</button>
      <button data-approval="${id}" data-approval-action="accept-for-session">本会话允许</button>
      <button data-approval="${id}" data-approval-action="deny">拒绝</button>
    </div>
  `;
}

function renderMessageText(text) {
  const value = String(text || "");
  if (!value.trim()) return "";
  const parts = value.split(/```/g);
  if (parts.length === 1) return `<p>${linkify(escapeHtml(value)).replace(/\n/g, "<br>")}</p>`;
  return parts.map((part, index) => {
    if (index % 2 === 0) return `<p>${linkify(escapeHtml(part)).replace(/\n/g, "<br>")}</p>`;
    const lines = part.replace(/^\w+\n/u, "").trimEnd();
    return `<pre class="code-block"><code>${escapeHtml(lines)}</code></pre>`;
  }).join("");
}

function renderComposer() {
  const disabled = state.pendingTurn ? "disabled" : "";
  return `
    <form class="composer" id="composer-form">
      <div class="quick-row">
        ${["修复报错", "解释代码", "运行测试", "总结改动"].map((item) => `<button type="button" data-quick="${escapeAttribute(item)}">${escapeHtml(item)}</button>`).join("")}
      </div>
      ${renderSelectedFiles()}
      <div class="composer-row">
        <button type="button" class="icon-btn" id="attach-button" title="附加操作">+</button>
        <input id="file-input" type="file" multiple hidden>
        <textarea id="prompt-input" rows="1" placeholder="向 Codex 描述你要完成的任务..." ${disabled}>${escapeHtml(state.prompt)}</textarea>
        ${state.pendingTurn
          ? `<button type="button" class="stop-btn" id="stop-button">${icon("stop")}</button>`
          : `<button class="send-btn" type="submit" ${state.prompt.trim() ? "" : "disabled"}>${icon("send")}</button>`}
      </div>
      ${state.error ? `<div class="composer-error">${escapeHtml(state.error)}</div>` : ""}
    </form>
  `;
}

function renderSelectedFiles() {
  if (!state.selectedFiles.length) return "";
  return `
    <div class="attachment-strip">
      ${state.selectedFiles.map((file, index) => `
        <span>
          ${escapeHtml(file.name)}
          <button type="button" data-remove-file="${index}" title="移除">×</button>
        </span>
      `).join("")}
    </div>
  `;
}

function renderSessionTools() {
  const settings = effectiveSessionSettings();
  const canPatch = Boolean(state.currentSession?.id || state.sessionId);
  const cwdValue = state.currentSession?.cwd || state.defaultCwd || "";
  return `
    <section class="session-tools">
      <div class="tool-head">
        <div>
          <strong>本会话能力</strong>
          <small>${escapeHtml(workspaceLabel())}</small>
        </div>
        <span>${escapeHtml(settings.model || modelLabel())}</span>
      </div>
      <form class="tool-grid" id="session-settings-form">
        <div class="tool-actions">
          <button type="button" id="save-session-settings">${canPatch ? "保存本会话" : "保存为默认"}</button>
          <button type="button" data-command="/help">/help</button>
          <button type="button" data-command="/goal">/goal</button>
          <button type="button" id="session-favorite">${isFavorite(state.currentSession) ? "取消收藏" : "收藏"}</button>
          <button type="button" id="session-archive">${state.currentSession?.archived ? "取消归档" : "归档"}</button>
        </div>
        ${compactInput(state.currentSession ? "当前目录" : "新会话目录", "session-cwd-input", cwdValue, "/opt/workday", Boolean(state.currentSession))}
        ${compactSelect("会话模型", "session-model-select", modelOptions(), settings.model || state.model)}
        ${compactSelect("推理", "session-reasoning-select", reasoningOptions(), settings.reasoningEffort || "medium")}
        ${compactSelect("沙箱", "session-sandbox-select", sandboxOptions(), settings.sandboxMode || "danger-full-access")}
        ${compactSelect("审批", "session-approval-select", approvalOptions(), settings.approvalPolicy || "never")}
        ${compactSelect("模式", "session-collab-select", collaborationOptions(), settings.collaborationMode || "default")}
        ${compactSelect("人格", "session-personality-select", personalityOptions(), settings.personality || "pragmatic")}
      </form>
    </section>
  `;
}

function compactSelect(title, id, options, value) {
  return `
    <label class="compact-field">
      <span>${escapeHtml(title)}</span>
      <select id="${escapeAttribute(id)}">
        ${options.map(([optionValue, label]) => `<option value="${escapeAttribute(optionValue)}" ${String(optionValue) === String(value) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
      </select>
    </label>
  `;
}

function compactInput(title, id, value, placeholder, disabled = false) {
  return `
    <label class="compact-field">
      <span>${escapeHtml(title)}</span>
      <input id="${escapeAttribute(id)}" value="${escapeAttribute(value)}" placeholder="${escapeAttribute(placeholder)}" ${disabled ? "disabled" : ""}>
    </label>
  `;
}

function renderSettings(mobile) {
  const defaults = {
    model: state.model || state.defaultThreadSettings.model || "",
    reasoningEffort: state.defaultThreadSettings.reasoningEffort || "medium",
    sandboxMode: state.defaultThreadSettings.sandboxMode || "danger-full-access",
    approvalPolicy: state.defaultThreadSettings.approvalPolicy || "never",
    accessPreset: state.defaultThreadSettings.accessPreset || "full-access",
    collaborationMode: state.defaultThreadSettings.collaborationMode || "default",
  };
  return `
    <section class="settings-page">
      <header class="settings-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div>
          <h1>设置</h1>
          <p>模型、权限、运行状态与管理入口</p>
        </div>
      </header>
      ${state.notice ? `<div class="notice-line settings-notice">${escapeHtml(state.notice)}</div>` : ""}
      <form class="settings-form" id="settings-form">
        <section class="open-section">
          <div class="section-kicker">连接</div>
          ${settingStatic("服务地址", location.origin, "link")}
          ${settingStatic("登录状态", state.authSession?.principal?.mode ? `已登录 · ${state.authSession.principal.mode}` : "已登录", "user")}
          ${settingInput("站点名称", "site-title-input", state.siteTitle, "Codex Web", !state.permissions?.canSetSiteTitle)}
        </section>
        <section class="open-section">
          <div class="section-kicker">默认运行参数</div>
          ${settingInput("默认工作目录", "default-cwd-input", state.defaultCwd, "留空使用服务器默认目录")}
          ${settingSelect("默认模型", "model-select", modelOptions(), defaults.model)}
          ${settingSelect("推理强度", "reasoning-select", reasoningOptions(), defaults.reasoningEffort)}
          ${settingSelect("沙箱", "sandbox-select", sandboxOptions(), defaults.sandboxMode)}
          ${settingSelect("审批", "approval-select", approvalOptions(), defaults.approvalPolicy)}
          ${settingSelect("协作模式", "collab-select", collaborationOptions(), defaults.collaborationMode)}
        </section>
        <section class="open-section">
          <div class="section-kicker">维护</div>
          ${settingStatic("用量", usageText(), "info")}
          ${settingStatic("版本", `Build ${APP_BUILD_ID}`, "code")}
          <div class="action-line">
            <button class="ghost-action" type="button" id="refresh-usage">刷新用量</button>
            <button class="ghost-action" type="button" id="reload-runtime">重载运行时</button>
            <button class="ghost-action danger" type="button" id="clear-cache">清理缓存</button>
          </div>
        </section>
        <div class="settings-actions">
          <button class="primary" type="submit">${state.settingsSaving ? "保存中..." : "保存设置"}</button>
          <button class="logout-btn" type="button" id="logout-button">退出登录</button>
        </div>
      </form>
    </section>
  `;
}

function settingStatic(title, desc, iconName) {
  return `
    <div class="setting-row">
      <span class="setting-icon">${icon(iconName)}</span>
      <span class="setting-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(desc)}</small></span>
    </div>
  `;
}

function settingInput(title, id, value, placeholder, disabled = false) {
  return `
    <label class="setting-row input-row">
      <span class="setting-copy"><strong>${escapeHtml(title)}</strong></span>
      <input id="${escapeAttribute(id)}" value="${escapeAttribute(value)}" placeholder="${escapeAttribute(placeholder)}" ${disabled ? "disabled" : ""}>
    </label>
  `;
}

function settingSelect(title, id, options, value) {
  return `
    <label class="setting-row input-row">
      <span class="setting-copy"><strong>${escapeHtml(title)}</strong></span>
      <select id="${escapeAttribute(id)}">
        ${options.map(([optionValue, label]) => `<option value="${escapeAttribute(optionValue)}" ${String(optionValue) === String(value) ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}
      </select>
    </label>
  `;
}

function renderCapabilities(mobile) {
  const current = state.currentSession || {};
  const settings = effectiveSessionSettings();
  const capabilities = [
    ["会话运行", currentStatusLabel(), "发送任务、流式输出、停止、恢复查看", "message", "chat"],
    ["工作目录", workspaceLabel(), "新建会话时传给 Codex CLI 的 cwd", "folder", "chat"],
    ["模型与推理", `${settings.model || modelLabel()} · ${settings.reasoningEffort || "medium"}`, "每个会话都可以单独调整模型、推理强度和协作模式", "sliders", "chat"],
    ["权限与沙箱", `${settings.sandboxMode || "danger-full-access"} · ${settings.approvalPolicy || "never"}`, "控制文件访问、命令执行和审批策略", "settings", "chat"],
    ["附件与文件上下文", state.selectedFiles.length ? `${state.selectedFiles.length} 个待发送文件` : "支持文件上传", "手机端可上传文件给 Codex 读取和处理", "doc", "chat"],
    ["目标与命令", "/help · /goal", "Codex Web slash 命令可直接插入输入框", "code", "chat"],
    ["报告", `${state.reports.length || "未加载"} 个`, "查看任务沉淀、帮助文档和报告内容", "doc", "reports"],
    ["运行时", usageText(), "刷新用量、重载运行时、清理缓存", "refresh", "settings"],
    ["用户与项目", state.admin.settings ? `${state.admin.users.length} 用户 · ${state.admin.projects.length} 项目` : "点击加载", "管理用户、角色、项目和多用户状态", "user", "admin"],
  ];
  return `
    <section class="capabilities-page">
      <header class="settings-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div>
          <h1>能力</h1>
          <p>手机端完整控制 Codex Web</p>
        </div>
      </header>
      <section class="capability-hero">
        <div>
          <span>当前会话</span>
          <strong>${escapeHtml(state.currentSession ? sessionTitle(state.currentSession) : "未选择会话")}</strong>
          <small>${escapeHtml(current.cwd || current.projectName || "选择会话后可调整本会话参数")}</small>
        </div>
        <button class="primary" id="cap-new-session">新建任务</button>
      </section>
      <section class="capability-list">
        ${capabilities.map(([title, value, desc, iconName, target]) => `
          <button class="capability-row" data-capability-target="${escapeAttribute(target)}">
            <span class="setting-icon">${icon(iconName)}</span>
            <span>
              <strong>${escapeHtml(title)}</strong>
              <small>${escapeHtml(desc)}</small>
            </span>
            <em>${escapeHtml(value)}</em>
          </button>
        `).join("")}
      </section>
      <section class="open-section command-section">
        <div class="section-kicker">常用 Codex 命令</div>
        <div class="command-grid">
          ${[
            ["/help", "查看帮助"],
            ["/goal", "查看目标"],
            ["/goal set ", "设置目标"],
            ["/goal clear", "清除目标"],
          ].map(([command, label]) => `<button type="button" data-command="${escapeAttribute(command)}"><strong>${escapeHtml(command)}</strong><small>${escapeHtml(label)}</small></button>`).join("")}
        </div>
      </section>
    </section>
  `;
}

function renderReports(mobile) {
  return `
    <section class="reports-page">
      <header class="settings-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div>
          <h1>报告</h1>
          <p>沉淀输出、帮助文档和任务记录</p>
        </div>
        <button class="icon-btn" id="refresh-reports" title="刷新">${icon("refresh")}</button>
      </header>
      ${state.reportLoading ? renderReportLoading() : renderReportBody()}
    </section>
  `;
}

function renderReportLoading() {
  return `<div class="open-section loading-lines"><span></span><span></span><span></span></div>`;
}

function renderReportBody() {
  if (!state.reports.length) {
    return `
      <div class="empty-hero report-empty">
        <div class="empty-plus">+</div>
        <h2>还没有报告</h2>
        <p>运行 Codex 任务后，报告会出现在这里。</p>
      </div>
    `;
  }
  return `
    <div class="report-layout">
      <section class="report-index">
        ${state.reports.map(renderReportItem).join("")}
      </section>
      <section class="report-reader">
        ${state.currentReport ? renderReportContent() : `<div class="empty-inline"><h3>选择报告</h3><p>打开左侧文档查看完整内容。</p></div>`}
      </section>
    </div>
  `;
}

function renderReportItem(report) {
  const active = state.currentReport?.id === report.id;
  return `
    <button class="report-item ${active ? "active" : ""}" data-report-open="${escapeAttribute(report.id)}">
      <span>
        <strong>${escapeHtml(report.title || report.id)}</strong>
        <small>${escapeHtml(report.project || "默认项目")} · ${escapeHtml(formatBytes(report.sizeBytes))}</small>
      </span>
      <span class="report-time">${escapeHtml(formatTime(report.updatedAt || report.createdAt))}</span>
    </button>
  `;
}

function renderReportContent() {
  return `
    <article class="report-content">
      <header>
        <div>
          <h2>${escapeHtml(state.currentReport.title || state.currentReport.id)}</h2>
          <p>${escapeHtml(state.currentReport.path || state.currentReport.id)}</p>
        </div>
        <button class="mini-btn" data-report-favorite="${escapeAttribute(state.currentReport.id)}" title="收藏">${state.currentReport.favorite ? "★" : "☆"}</button>
      </header>
      <pre>${escapeHtml(state.reportContent || "内容为空")}</pre>
    </article>
  `;
}

function renderAdmin(mobile) {
  return `
    <section class="admin-page">
      <header class="settings-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div>
          <h1>管理</h1>
          <p>用户、角色、项目和多用户开关</p>
        </div>
        <button class="icon-btn" id="refresh-admin" title="刷新">${icon("refresh")}</button>
      </header>
      ${state.adminLoading ? renderReportLoading() : renderAdminBody()}
    </section>
  `;
}

function renderAdminBody() {
  const settings = state.admin.settings || {};
  return `
    <div class="admin-layout">
      ${state.notice ? `<div class="notice-line settings-notice">${escapeHtml(state.notice)}</div>` : ""}
      <section class="open-section">
        <div class="section-kicker">系统</div>
        ${renderAdminSettingsForm(settings)}
        ${settingStatic("站点", settings.siteTitle || state.siteTitle, "link")}
      </section>
      <section class="open-section">
        <div class="section-kicker">用户</div>
        ${renderAdminUserForm()}
        ${state.admin.users.length ? state.admin.users.map((user) => `
          ${renderAdminUserForm(user)}
        `).join("") : `<p class="muted">暂无用户</p>`}
      </section>
      <section class="open-section">
        <div class="section-kicker">项目</div>
        ${renderAdminProjectForm()}
        ${state.admin.projects.length ? state.admin.projects.map((project) => `
          ${renderAdminProjectForm(project)}
        `).join("") : `<p class="muted">暂无项目。当前是单用户模式时可以直接创建默认会话。</p>`}
      </section>
      <section class="open-section">
        <div class="section-kicker">角色</div>
        ${renderAdminRoleForm()}
        ${state.admin.roles.map((role) => `
          ${renderAdminRoleForm(role)}
        `).join("")}
      </section>
    </div>
  `;
}

function renderAdminRoleForm(role = null) {
  const isExisting = Boolean(role?.id);
  const id = role?.id || "";
  const grants = Array.isArray(role?.projectGrants) ? role.projectGrants : [];
  return `
    <form class="admin-project-form admin-role-form" data-admin-role-form="${escapeAttribute(id)}">
      <div class="admin-form-head">
        <span>
          <strong>${escapeHtml(isExisting ? (role.name || role.id) : "新增角色")}</strong>
          <small>${escapeHtml(isExisting ? `${role.isAdmin ? "管理员" : "普通角色"} · ${grants.length} 个项目授权` : "用项目授权控制会话读写和创建权限")}</small>
        </span>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>角色 ID</span>
          <input name="id" value="${escapeAttribute(id)}" placeholder="role_operator" ${isExisting ? "disabled" : ""}>
        </label>
        <label>
          <span>名称</span>
          <input name="name" value="${escapeAttribute(role?.name || "")}" placeholder="Operator">
        </label>
      </div>
      ${renderRoleGrantMatrix(grants)}
      <div class="action-line">
        <button class="ghost-action" type="submit" ${state.adminSaving ? "disabled" : ""}>${isExisting ? "保存角色" : "创建角色"}</button>
      </div>
    </form>
  `;
}

function renderRoleGrantMatrix(grants) {
  const projects = state.admin.projects || [];
  if (!projects.length) return `<p class="muted">还没有项目，先创建项目再授权。</p>`;
  return `
    <div class="role-grant-list">
      ${projects.map((project) => {
        const grant = grants.find((item) => item.projectId === project.id) || {};
        return `
          <div class="role-grant-row" data-project-id="${escapeAttribute(project.id)}">
            <span>
              <strong>${escapeHtml(project.displayName || project.internalName || project.id)}</strong>
              <small>${escapeHtml(project.cwd || project.id)}</small>
            </span>
            <label><input type="checkbox" name="grant:${escapeAttribute(project.id)}:canRead" ${grant.canRead ? "checked" : ""}> 读</label>
            <label><input type="checkbox" name="grant:${escapeAttribute(project.id)}:canCreate" ${grant.canCreate ? "checked" : ""}> 建</label>
            <label><input type="checkbox" name="grant:${escapeAttribute(project.id)}:canWrite" ${grant.canWrite ? "checked" : ""}> 写</label>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderAdminSettingsForm(settings) {
  const multiUserEnabled = settings.multiUserEnabled === true;
  return `
    <form class="admin-project-form admin-system-form" id="admin-settings-form">
      <div class="admin-form-head">
        <span>
          <strong>多用户</strong>
          <small>${escapeHtml(multiUserEnabled ? "已开启：按用户、角色、项目授权访问" : "未开启：当前使用本地管理员单用户模式")}</small>
        </span>
        <label class="switch-row">
          <input type="checkbox" name="multiUserEnabled" ${multiUserEnabled ? "checked" : ""}>
          <span>${multiUserEnabled ? "开启" : "关闭"}</span>
        </label>
      </div>
      <div class="action-line">
        <button class="ghost-action" type="submit" ${state.adminSaving ? "disabled" : ""}>保存多用户开关</button>
      </div>
    </form>
  `;
}

function renderAdminUserForm(user = null) {
  const isExisting = Boolean(user?.id);
  const id = user?.id || "";
  const enabled = user?.enabled !== false;
  return `
    <form class="admin-project-form admin-user-form" data-admin-user-form="${escapeAttribute(id)}">
      <div class="admin-form-head">
        <span>
          <strong>${escapeHtml(isExisting ? user.username : "新增用户")}</strong>
          <small>${escapeHtml(isExisting ? `${enabled ? "启用" : "停用"} · ${roleLabel(user.roleId || user.roleIds?.[0] || "")}` : "创建后可登录 Codex Web")}</small>
        </span>
        <label class="switch-row">
          <input type="checkbox" name="enabled" ${enabled ? "checked" : ""}>
          <span>启用</span>
        </label>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>用户名</span>
          <input name="username" value="${escapeAttribute(user?.username || "")}" placeholder="operator" ${isExisting ? "disabled" : ""}>
        </label>
        <label>
          <span>邮箱</span>
          <input name="email" value="${escapeAttribute(user?.email || "")}" placeholder="可选">
        </label>
        <label>
          <span>角色</span>
          <select name="roleId">
            ${roleOptions(user?.roleId || user?.roleIds?.[0] || "role_admin")}
          </select>
        </label>
        ${isExisting ? "" : `
          <label>
            <span>初始密码</span>
            <input name="password" type="password" autocomplete="new-password" placeholder="至少 8 位">
          </label>
        `}
      </div>
      <div class="action-line">
        <button class="ghost-action" type="submit" ${state.adminSaving ? "disabled" : ""}>${isExisting ? "保存用户" : "创建用户"}</button>
      </div>
    </form>
  `;
}

function renderAdminProjectForm(project = null) {
  const isExisting = Boolean(project?.id);
  const id = project?.id || "";
  const enabled = project?.enabled !== false;
  const activeSessionLimit = project?.activeSessionLimit === null || project?.activeSessionLimit === undefined
    ? ""
    : String(project.activeSessionLimit);
  return `
    <form class="admin-project-form" data-admin-project-form="${escapeAttribute(id)}">
      <div class="admin-form-head">
        <span>
          <strong>${escapeHtml(isExisting ? (project.displayName || project.internalName || project.id) : "新增项目")}</strong>
          <small>${escapeHtml(isExisting ? (enabled ? "启用" : "停用") : "创建后可用于多用户项目会话")}</small>
        </span>
        <label class="switch-row">
          <input type="checkbox" name="enabled" ${enabled ? "checked" : ""}>
          <span>启用</span>
        </label>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>项目 ID</span>
          <input name="id" value="${escapeAttribute(id)}" placeholder="auto or workday" ${isExisting ? "disabled" : ""}>
        </label>
        <label>
          <span>内部名</span>
          <input name="internalName" value="${escapeAttribute(project?.internalName || "")}" placeholder="workday">
        </label>
        <label>
          <span>显示名</span>
          <input name="displayName" value="${escapeAttribute(project?.displayName || "")}" placeholder="Workday">
        </label>
        <label>
          <span>工作目录</span>
          <input name="cwd" value="${escapeAttribute(project?.cwd || "")}" placeholder="/opt/workday">
        </label>
        <label>
          <span>会话上限</span>
          <input name="activeSessionLimit" value="${escapeAttribute(activeSessionLimit)}" inputmode="numeric" placeholder="留空不限">
        </label>
      </div>
      <div class="action-line">
        <button class="ghost-action" type="submit" ${state.adminSaving ? "disabled" : ""}>${isExisting ? "保存项目" : "创建项目"}</button>
      </div>
    </form>
  `;
}

function renderBottomNav() {
  return `
    <nav class="bottom-nav">
      <button class="${state.view === "sessions" || state.view === "chat" ? "active" : ""}" data-mobile-tab="sessions">${icon("message")}<span>会话</span></button>
      <button data-mobile-tab="new">${icon("plus")}<span>新建</span></button>
      <button class="${state.view === "capabilities" ? "active" : ""}" data-mobile-tab="capabilities">${icon("sliders")}<span>能力</span></button>
      <button class="${state.view === "reports" ? "active" : ""}" data-mobile-tab="reports">${icon("doc")}<span>报告</span></button>
      <button class="${state.view === "settings" ? "active" : ""}" data-mobile-tab="settings">${icon("settings")}<span>设置</span></button>
    </nav>
  `;
}

function bindApp() {
  document.querySelector("#open-settings")?.addEventListener("click", () => {
    setView("settings");
  });
  document.querySelector("#back-to-sessions")?.addEventListener("click", () => {
    state.view = "sessions";
    render();
  });
  document.querySelector("#new-session-button")?.addEventListener("click", openNewSession);
  document.querySelector("#empty-new-session-button")?.addEventListener("click", openNewSession);
  document.querySelector("#refresh-session")?.addEventListener("click", () => refreshCurrentSession());
  document.querySelector("#share-session")?.addEventListener("click", shareCurrentSession);
  document.querySelector("#toggle-session-tools")?.addEventListener("click", () => {
    state.sessionToolsOpen = !state.sessionToolsOpen;
    render();
  });
  document.querySelector("#session-settings-form")?.addEventListener("submit", saveSessionSettings);
  document.querySelector("#save-session-settings")?.addEventListener("click", saveSessionSettings);
  document.querySelector("#session-favorite")?.addEventListener("click", () => {
    const sessionId = state.currentSession?.id || state.sessionId;
    if (sessionId) toggleFavorite(sessionId);
  });
  document.querySelector("#session-archive")?.addEventListener("click", () => {
    const sessionId = state.currentSession?.id || state.sessionId;
    if (sessionId) toggleArchive(sessionId);
  });
  document.querySelector("#cap-new-session")?.addEventListener("click", openNewSession);
  document.querySelector("#refresh-reports")?.addEventListener("click", () => refreshReports());
  document.querySelector("#refresh-admin")?.addEventListener("click", () => refreshAdmin());
  document.querySelector("#admin-settings-form")?.addEventListener("submit", saveAdminSettings);
  for (const form of document.querySelectorAll("[data-admin-user-form]")) {
    form.addEventListener("submit", saveAdminUser);
  }
  for (const form of document.querySelectorAll("[data-admin-role-form]")) {
    form.addEventListener("submit", saveAdminRole);
  }
  for (const form of document.querySelectorAll("[data-admin-project-form]")) {
    form.addEventListener("submit", saveAdminProject);
  }
  document.querySelector("#refresh-usage")?.addEventListener("click", () => refreshUsage());
  document.querySelector("#reload-runtime")?.addEventListener("click", reloadRuntime);
  document.querySelector("#logout-button")?.addEventListener("click", logout);
  document.querySelector("#clear-cache")?.addEventListener("click", clearLocalCache);
  document.querySelector("#settings-form")?.addEventListener("submit", saveSettingsForm);
  document.querySelector("#attach-button")?.addEventListener("click", () => document.querySelector("#file-input")?.click());
  document.querySelector("#file-input")?.addEventListener("change", (event) => {
    state.selectedFiles = [...state.selectedFiles, ...Array.from(event.target.files || [])].slice(0, 8);
    render();
  });

  const search = document.querySelector("#session-search");
  search?.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });
  for (const button of document.querySelectorAll("[data-filter]")) {
    button.addEventListener("click", async () => {
      state.sortMode = button.getAttribute("data-filter") || "all";
      await refreshSessions();
    });
  }
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => setView(button.getAttribute("data-view") || "sessions"));
  }
  for (const button of document.querySelectorAll("[data-capability-target]")) {
    button.addEventListener("click", () => {
      const target = button.getAttribute("data-capability-target") || "sessions";
      if (target === "chat") {
        state.sessionToolsOpen = true;
        state.view = state.currentSession || state.sessionId ? "chat" : "sessions";
        render();
        return;
      }
      setView(target);
    });
  }
  for (const button of document.querySelectorAll("[data-session-open]")) {
    button.addEventListener("click", () => selectSession(button.getAttribute("data-session-open") || ""));
  }
  for (const button of document.querySelectorAll("[data-report-open]")) {
    button.addEventListener("click", () => selectReport(button.getAttribute("data-report-open") || ""));
  }
  for (const button of document.querySelectorAll("[data-report-favorite]")) {
    button.addEventListener("click", () => toggleReportFavorite(button.getAttribute("data-report-favorite") || ""));
  }
  for (const button of document.querySelectorAll("[data-remove-file]")) {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-remove-file"));
      state.selectedFiles.splice(index, 1);
      render();
    });
  }
  for (const button of document.querySelectorAll("[data-approval]")) {
    button.addEventListener("click", () => resolveApproval(
      button.getAttribute("data-approval") || "",
      button.getAttribute("data-approval-action") || "deny",
    ));
  }
  for (const button of document.querySelectorAll("[data-favorite]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(button.getAttribute("data-favorite") || "");
    });
  }
  for (const button of document.querySelectorAll("[data-archive]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleArchive(button.getAttribute("data-archive") || "");
    });
  }
  for (const button of document.querySelectorAll("[data-mobile-tab]")) {
    button.addEventListener("click", () => {
      const tab = button.getAttribute("data-mobile-tab");
      if (tab === "new") return openNewSession();
      setView(tab || "sessions");
    });
  }
  for (const button of document.querySelectorAll("[data-quick]")) {
    button.addEventListener("click", () => {
      const text = button.getAttribute("data-quick") || "";
      state.prompt = state.prompt ? `${state.prompt}\n${text}` : text;
      render();
      document.querySelector("#prompt-input")?.focus();
    });
  }
  for (const button of document.querySelectorAll("[data-command]")) {
    button.addEventListener("click", () => insertCommand(button.getAttribute("data-command") || ""));
  }
  for (const button of document.querySelectorAll("[data-theme]")) {
    button.addEventListener("click", () => {
      applyTheme(button.getAttribute("data-theme") || "light", { persist: true });
      render();
    });
  }
  const textarea = document.querySelector("#prompt-input");
  textarea?.addEventListener("input", (event) => {
    state.prompt = event.target.value;
    autoGrowTextarea(textarea);
    updateSendButton();
  });
  textarea?.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      document.querySelector("#composer-form")?.requestSubmit();
    }
  });
  document.querySelector("#composer-form")?.addEventListener("submit", sendPrompt);
  document.querySelector("#stop-button")?.addEventListener("click", stopTurn);
  document.querySelector("#retry-last")?.addEventListener("click", retryLastUserMessage);
}

async function setView(view) {
  state.view = view === "reports" || view === "admin" || view === "settings" || view === "capabilities" ? view : "sessions";
  state.notice = "";
  render();
  if (state.view === "reports" && !state.reports.length) await refreshReports();
  if (state.view === "admin" && !state.admin.settings) await refreshAdmin();
  if (state.view === "capabilities") {
    return;
  }
  if (state.view === "settings") {
    await Promise.all([
      refreshModels().catch(() => null),
    ]);
    renderAfterBackgroundRefresh();
  }
}

async function refreshSettings() {
  const payload = await apiFetch("/api/settings");
  state.settings = payload?.settings || null;
  state.permissions = payload?.permissions || {};
  if (payload?.settings?.siteTitle || payload?.siteTitle) {
    state.siteTitle = normalizeSiteTitle(payload.settings?.siteTitle || payload.siteTitle);
    localStorage.setItem(SITE_TITLE_KEY, state.siteTitle);
  }
  return payload;
}

async function refreshModels() {
  const payload = await apiFetch("/api/models");
  state.models = Array.isArray(payload?.items) ? payload.items : [];
  state.model = state.defaultThreadSettings.model || state.models[0]?.id || state.models[0]?.name || "";
}

async function refreshUsage({ silent = false } = {}) {
  if (!silent) {
    state.notice = "正在刷新用量";
    render();
  }
  try {
    const payload = await apiFetch("/api/usage");
    state.usage = payload?.usage || payload || null;
    state.notice = silent ? state.notice : "用量已刷新";
  } catch (error) {
    state.usage = { error: error?.payload?.message || error?.message || "无法读取用量" };
    if (!silent) state.notice = state.usage.error;
  } finally {
    if (!silent) render();
  }
}

async function refreshReports() {
  state.reportLoading = true;
  render();
  try {
    const payload = await apiFetch("/api/reports");
    state.reports = Array.isArray(payload?.items) ? payload.items : [];
    if (!state.currentReport && state.reports[0]) await selectReport(state.reports[0].id, { silent: true });
  } finally {
    state.reportLoading = false;
    renderAfterBackgroundRefresh();
  }
}

async function selectReport(reportId, { silent = false } = {}) {
  const report = state.reports.find((item) => item.id === reportId);
  if (!report) return;
  state.currentReport = report;
  state.reportContent = "";
  if (!silent) {
    state.reportLoading = true;
    render();
  }
  try {
    const payload = await apiFetch(`/api/reports/${encodeURIComponent(reportId)}/content`);
    state.currentReport = payload?.report || report;
    state.reportContent = String(payload?.content || "");
  } finally {
    if (!silent) {
      state.reportLoading = false;
      render();
    }
  }
}

async function refreshAdmin() {
  state.adminLoading = true;
  render();
  try {
    const [settings, projects, roles, users] = await Promise.all([
      apiFetch("/api/admin/settings").catch(() => null),
      apiFetch("/api/admin/projects").catch(() => ({ items: [] })),
      apiFetch("/api/admin/roles").catch(() => ({ items: [] })),
      apiFetch("/api/admin/users").catch(() => ({ items: [] })),
    ]);
    state.admin = {
      settings: settings?.settings || null,
      projects: Array.isArray(projects?.items) ? projects.items : [],
      roles: Array.isArray(roles?.items) ? roles.items : [],
      users: Array.isArray(users?.items) ? users.items : [],
    };
  } finally {
    state.adminLoading = false;
    renderAfterBackgroundRefresh();
  }
}

async function refreshSessions({ silent = false } = {}) {
  if (!silent) {
    state.sessionsLoading = true;
    render();
  }
  const path = state.sortMode === "favorites"
    ? "/api/sessions?favorite=true"
    : state.sortMode === "archived"
      ? "/api/sessions?state=archived"
      : "/api/sessions";
  try {
    const payload = await apiFetch(path);
    state.sessions = normalizeSessions(payload, state.sortMode);
    inferDefaultCwdFromSessions();
  } finally {
    state.sessionsLoading = false;
    if (!silent) render();
    else renderAfterBackgroundRefresh();
  }
}

async function selectSession(sessionId) {
  const cached = state.sessions.find((session) => session.id === sessionId) || null;
  state.sessionId = sessionId;
  state.currentSession = cached;
  state.timeline = cached ? hydrateTimeline(cached) : [];
  state.view = state.isMobile ? "chat" : "sessions";
  state.status = "Loading session";
  state.statusTone = "warn";
  stopStream();
  render();
  await refreshCurrentSession();
}

async function refreshCurrentSession({ silent = false } = {}) {
  if (!state.sessionId) return null;
  if (!silent) {
    state.status = "Loading session";
    state.statusTone = "warn";
  }
  const payload = await apiFetch(`/api/sessions/${encodeURIComponent(state.sessionId)}`);
  if (payload?.session) {
    upsertSession(payload.session);
    state.currentSession = payload.session;
    state.timeline = hydrateTimeline(payload.session);
    const active = findActiveTurn(payload.session);
    if (active?.id) {
      state.pendingTurn = true;
      state.turnId = active.id;
      state.status = "Turn running";
      state.statusTone = "warn";
      streamTurn(active.id);
    } else {
      state.pendingTurn = false;
      state.turnId = "";
      state.status = statusFromSession(payload.session).status;
      state.statusTone = statusFromSession(payload.session).tone;
    }
  }
  render();
  return payload?.session || null;
}

async function openNewSession() {
  stopStream();
  state.currentSession = null;
  state.sessionId = "";
  state.timeline = [];
  state.prompt = "";
  state.pendingTurn = false;
  state.turnId = "";
  state.error = "";
  state.status = "Ready";
  state.statusTone = "success";
  state.sessionToolsOpen = true;
  state.view = "chat";
  render();
}

async function ensureSession() {
  if (state.sessionId) return state.sessionId;
  const payload = await apiFetch("/api/sessions", {
    method: "POST",
    body: { cwd: defaultCwdForCreate() || null, settings: collectSettings() },
  });
  const session = payload.session;
  state.sessionId = session.id;
  state.currentSession = session;
  upsertSession(session);
  return state.sessionId;
}

async function uploadSessionFiles(sessionId, files) {
  const form = new FormData();
  for (const file of files) form.append("files", file, file.name);
  const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/attachments`, {
    method: "POST",
    headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    body: form,
  });
  if (!response.ok) throw await buildApiError(response);
  const payload = await response.json();
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function sendPrompt(event) {
  event.preventDefault();
  const text = state.prompt.trim();
  if (!text || state.pendingTurn) return;
  state.error = "";
  state.prompt = "";
  state.pendingTurn = true;
  state.status = "Turn running";
  state.statusTone = "warn";
  appendTimeline({ id: `local_user_${Date.now()}`, kind: "message", role: "user", meta: "sending", text });
  render();
  try {
    const sessionId = await ensureSession();
    const attachments = state.selectedFiles.length ? await uploadSessionFiles(sessionId, state.selectedFiles) : [];
    state.selectedFiles = [];
    const turn = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      body: { text, attachments, settings: collectSettings() },
    });
    if (turn?.session) {
      state.currentSession = turn.session;
      upsertSession(turn.session);
    }
    state.turnId = turn.turnId || "";
    if (state.turnId) {
      streamTurn(state.turnId);
    } else {
      state.pendingTurn = false;
      await refreshCurrentSession();
    }
  } catch (error) {
    state.pendingTurn = false;
    appendTimeline({
      id: `error_${Date.now()}`,
      kind: "message",
      role: "system",
      severity: "error",
      meta: "failed",
      text: error?.payload?.message || error?.message || "任务发送失败",
    });
    handleApiError(error);
  }
}

function streamTurn(turnId) {
  stopStream(false);
  const controller = new AbortController();
  state.streamAbortController = controller;
  state.turnId = turnId;
  state.pendingTurn = true;
  state.lastTurnEventSequence = null;
  readSse(turnId, controller).catch((error) => {
    if (controller.signal.aborted) return;
    state.pendingTurn = false;
    state.status = "Turn failed";
    state.statusTone = "danger";
    appendTimeline({
      id: `stream_error_${Date.now()}`,
      kind: "message",
      role: "system",
      severity: "error",
      meta: "stream",
      text: error?.payload?.message || error?.message || "流式连接失败",
    });
    render();
  });
}

async function readSse(turnId, controller) {
  const response = await fetch(`/api/turns/${encodeURIComponent(turnId)}/events`, {
    headers: { Authorization: `Bearer ${state.token}`, Accept: "text/event-stream" },
    signal: controller.signal,
  });
  if (!response.ok || !response.body) throw await buildApiError(response);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      processSseFrame(frame);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) processSseFrame(buffer);
}

function processSseFrame(frame) {
  const lines = frame.split(/\r?\n/u);
  let eventName = "message";
  const data = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    if (line.startsWith("id:")) state.lastTurnEventSequence = line.slice(3).trim();
  }
  if (eventName !== "message" || !data.length) return;
  let payload;
  try {
    payload = JSON.parse(data.join("\n"));
  } catch (_error) {
    return;
  }
  applyTurnEvent(payload);
}

function applyTurnEvent(event) {
  if (event.sequence) state.lastTurnEventSequence = event.sequence;
  if (event.type === "turn.started") {
    state.status = "Turn running";
    state.statusTone = "warn";
  } else if (event.type === "assistant.delta") {
    const id = `assistant_${event.turnId || state.turnId}`;
    const current = state.timeline.find((item) => item.id === id);
    if (current) {
      current.text += event.text || "";
      current.meta = event.phase || "streaming";
    } else {
      appendTimeline({ id, kind: "message", role: "assistant", meta: event.phase || "streaming", text: event.text || "" });
    }
  } else if (event.type === "assistant.final") {
    replaceTimeline((item) => item.id === `assistant_${event.turnId || state.turnId}`, {
      id: `assistant_${event.turnId || state.turnId}`,
      kind: "message",
      role: "assistant",
      meta: "final",
      text: event.text || "",
    });
  } else if (event.type === "batch.started" || event.type === "batch.updated" || event.type === "batch.completed") {
    upsertTimelineWork(event.batchId || `${event.type}_${Date.now()}`, {
      id: `batch_${event.batchId || Date.now()}`,
      kind: "batch",
      title: event.title || "Codex 正在处理",
      status: event.status || event.type,
      summary: event.summary || event.raw || {},
    });
  } else if (event.type === "approval.requested") {
    upsertTimelineWork(event.approvalId || `${Date.now()}`, {
      id: `approval_${event.approvalId || Date.now()}`,
      approvalId: event.approvalId || "",
      kind: "approval",
      title: "需要确认",
      approvalKind: event.approvalKind,
      summary: event.summary || {},
    });
  } else if (event.type === "turn.completed") {
    state.pendingTurn = false;
    state.turnId = "";
    state.status = "Ready";
    state.statusTone = "success";
    stopStream(false);
    refreshCurrentSession({ silent: true }).catch(() => null);
  } else if (event.type === "turn.failed") {
    state.pendingTurn = false;
    state.turnId = "";
    state.status = "Turn failed";
    state.statusTone = "danger";
    appendTimeline({
      id: `failed_${event.turnId || Date.now()}`,
      kind: "message",
      role: "system",
      severity: "error",
      meta: "failed",
      text: event.details || event.message || "任务执行失败",
    });
    stopStream(false);
  }
  render();
}

async function stopTurn() {
  if (!state.turnId) return;
  try {
    await apiFetch(`/api/turns/${encodeURIComponent(state.turnId)}/interrupt`, { method: "POST" });
    state.status = "Turn stopped";
    state.statusTone = "warn";
  } catch (error) {
    handleApiError(error);
  }
  render();
}

async function resolveApproval(approvalId, action) {
  if (!approvalId) return;
  try {
    await apiFetch(`/api/approvals/${encodeURIComponent(approvalId)}/${encodeURIComponent(action)}`, { method: "POST" });
    state.notice = "审批已处理";
    state.timeline = state.timeline.filter((item) => item.approvalId !== approvalId);
  } catch (error) {
    handleApiError(error);
    return;
  }
  render();
}

async function shareCurrentSession() {
  const sessionId = state.currentSession?.id || state.sessionId;
  if (!sessionId) return;
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/share`, { method: "POST" });
    const url = new URL(payload.shareUrl || `/share/${payload.token}`, location.origin).toString();
    await copyText(url);
    state.notice = "分享链接已复制";
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "分享失败";
  }
  render();
}

async function toggleReportFavorite(reportId) {
  const report = state.reports.find((item) => item.id === reportId) || state.currentReport;
  if (!report) return;
  const payload = await apiFetch(`/api/reports/${encodeURIComponent(reportId)}/favorite`, {
    method: "PATCH",
    body: { favorite: !report.favorite },
  });
  const updated = payload?.report;
  if (updated) {
    state.reports = state.reports.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
    if (state.currentReport?.id === updated.id) state.currentReport = { ...state.currentReport, ...updated };
  }
  render();
}

async function reloadRuntime() {
  try {
    await apiFetch("/api/runtime/reload", { method: "POST" });
    state.notice = "运行时已重载";
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "重载失败";
  }
  render();
}

async function saveAdminSettings(event) {
  event.preventDefault();
  const form = event.currentTarget;
  state.adminSaving = true;
  state.notice = "";
  render();
  try {
    const payload = await apiFetch("/api/admin/settings", {
      method: "PATCH",
      body: { multiUserEnabled: new FormData(form).get("multiUserEnabled") === "on" },
    });
    if (payload?.settings) state.admin.settings = payload.settings;
    state.notice = "多用户设置已保存";
    await refreshAdmin({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "多用户设置保存失败";
  } finally {
    state.adminSaving = false;
    render();
  }
}

async function saveAdminUser(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const userId = String(form?.getAttribute("data-admin-user-form") || "").trim();
  const data = new FormData(form);
  const roleId = String(data.get("roleId") || "").trim();
  const payload = {
    username: String(data.get("username") || "").trim(),
    email: String(data.get("email") || "").trim(),
    password: String(data.get("password") || ""),
    enabled: data.get("enabled") === "on",
    roleId,
    roleIds: roleId ? [roleId] : [],
  };
  if (!userId && !payload.username) {
    state.notice = "用户名不能为空";
    render();
    return;
  }
  if (!userId && payload.password.length < 8) {
    state.notice = "初始密码至少 8 位";
    render();
    return;
  }
  state.adminSaving = true;
  state.notice = "";
  render();
  try {
    const endpoint = userId ? `/api/admin/users/${encodeURIComponent(userId)}` : "/api/admin/users";
    const body = userId
      ? { email: payload.email, enabled: payload.enabled, roleId: payload.roleId, roleIds: payload.roleIds }
      : payload;
    await apiFetch(endpoint, {
      method: userId ? "PATCH" : "POST",
      body,
    });
    state.notice = userId ? "用户已保存" : "用户已创建";
    await refreshAdmin({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "用户保存失败";
  } finally {
    state.adminSaving = false;
    render();
  }
}

async function saveAdminRole(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const roleId = String(form?.getAttribute("data-admin-role-form") || "").trim();
  const data = new FormData(form);
  const name = String(data.get("name") || "").trim();
  let id = String(data.get("id") || "").trim() || roleId;
  if (!id && name) {
    id = `role_${name.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "")}`;
  }
  if (!id) {
    state.notice = "角色 ID 或名称不能为空";
    render();
    return;
  }
  const projectGrants = state.admin.projects.map((project) => ({
    projectId: project.id,
    canRead: data.get(`grant:${project.id}:canRead`) === "on",
    canCreate: data.get(`grant:${project.id}:canCreate`) === "on",
    canWrite: data.get(`grant:${project.id}:canWrite`) === "on",
  })).filter((grant) => grant.canRead || grant.canCreate || grant.canWrite);
  state.adminSaving = true;
  state.notice = "";
  render();
  try {
    await apiFetch("/api/admin/roles", {
      method: "POST",
      body: {
        id,
        name: name || id,
        projectGrants,
      },
    });
    state.notice = roleId ? "角色已保存" : "角色已创建";
    await refreshAdmin({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "角色保存失败";
  } finally {
    state.adminSaving = false;
    render();
  }
}

async function saveAdminProject(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const projectId = String(form?.getAttribute("data-admin-project-form") || "").trim();
  const data = new FormData(form);
  const activeSessionLimitRaw = String(data.get("activeSessionLimit") || "").trim();
  const payload = {
    id: String(data.get("id") || "").trim(),
    internalName: String(data.get("internalName") || "").trim(),
    displayName: String(data.get("displayName") || "").trim(),
    cwd: String(data.get("cwd") || "").trim(),
    enabled: data.get("enabled") === "on",
    activeSessionLimit: activeSessionLimitRaw ? Number(activeSessionLimitRaw) : null,
  };
  if (!projectId && !payload.id && payload.internalName) {
    payload.id = payload.internalName.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-").replace(/^-+|-+$/gu, "");
  }
  if (!payload.id && !projectId) {
    state.notice = "项目 ID 或内部名不能为空";
    render();
    return;
  }
  if (!payload.cwd) {
    state.notice = "项目工作目录不能为空";
    render();
    return;
  }
  if (activeSessionLimitRaw && (!Number.isFinite(payload.activeSessionLimit) || payload.activeSessionLimit < 1)) {
    state.notice = "会话上限必须是正整数，或留空不限";
    render();
    return;
  }
  state.adminSaving = true;
  state.notice = "";
  render();
  try {
    const endpoint = projectId
      ? `/api/admin/projects/${encodeURIComponent(projectId)}`
      : "/api/admin/projects";
    const body = projectId ? { ...payload, id: undefined } : payload;
    await apiFetch(endpoint, {
      method: projectId ? "PATCH" : "POST",
      body,
    });
    state.notice = projectId ? "项目已保存" : "项目已创建";
    await refreshAdmin({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "项目保存失败";
  } finally {
    state.adminSaving = false;
    render();
  }
}

async function saveSettingsForm(event) {
  event.preventDefault();
  const siteTitle = document.querySelector("#site-title-input")?.value || state.siteTitle;
  const nextSettings = {
    ...state.defaultThreadSettings,
    model: document.querySelector("#model-select")?.value || "",
    reasoningEffort: document.querySelector("#reasoning-select")?.value || "medium",
    sandboxMode: document.querySelector("#sandbox-select")?.value || "danger-full-access",
    approvalPolicy: document.querySelector("#approval-select")?.value || "never",
    collaborationMode: document.querySelector("#collab-select")?.value || "default",
    accessPreset: document.querySelector("#sandbox-select")?.value === "danger-full-access" ? "full-access" : "default",
  };
  const defaultCwd = String(document.querySelector("#default-cwd-input")?.value || "").trim();
  state.settingsSaving = true;
  state.notice = "";
  render();
  try {
    state.defaultThreadSettings = nextSettings;
    state.defaultCwd = defaultCwd;
    state.model = nextSettings.model;
    localStorage.setItem(DEFAULT_THREAD_SETTINGS_KEY, JSON.stringify(nextSettings));
    persistDefaultCwd(defaultCwd);
    if (state.permissions?.canSetSiteTitle && siteTitle.trim() && siteTitle.trim() !== state.siteTitle) {
      await apiFetch("/api/settings", { method: "PATCH", body: { siteTitle: siteTitle.trim() } });
      state.siteTitle = normalizeSiteTitle(siteTitle);
      localStorage.setItem(SITE_TITLE_KEY, state.siteTitle);
    }
    state.notice = "设置已保存";
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "保存失败";
  } finally {
    state.settingsSaving = false;
    render();
  }
}

async function saveSessionSettings(event) {
  event?.preventDefault?.();
  const sessionId = state.currentSession?.id || state.sessionId;
  const nextSettings = readSessionSettingsControls();
  const nextCwd = String(document.querySelector("#session-cwd-input")?.value || "").trim();
  if (!sessionId) {
    state.defaultThreadSettings = { ...state.defaultThreadSettings, ...nextSettings };
    state.defaultCwd = nextCwd;
    state.model = nextSettings.model;
    localStorage.setItem(DEFAULT_THREAD_SETTINGS_KEY, JSON.stringify(state.defaultThreadSettings));
    persistDefaultCwd(nextCwd);
    state.notice = "默认会话设置已保存";
    render();
    return;
  }
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/settings`, {
      method: "PATCH",
      body: nextSettings,
    });
    if (payload?.session) {
      state.currentSession = payload.session;
      upsertSession(payload.session);
    } else if (state.currentSession) {
      state.currentSession.settings = { ...(state.currentSession.settings || {}), ...nextSettings };
    }
    if (nextCwd && nextCwd !== state.currentSession?.cwd) {
      state.defaultCwd = nextCwd;
      persistDefaultCwd(nextCwd);
      state.notice = "本会话设置已保存，工作目录将用于新会话";
    } else {
      state.notice = "本会话设置已保存";
    }
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "保存本会话失败";
  }
  render();
}

function readSessionSettingsControls() {
  const sandboxMode = document.querySelector("#session-sandbox-select")?.value || "danger-full-access";
  return {
    model: document.querySelector("#session-model-select")?.value || "",
    reasoningEffort: document.querySelector("#session-reasoning-select")?.value || "medium",
    sandboxMode,
    approvalPolicy: document.querySelector("#session-approval-select")?.value || "never",
    collaborationMode: document.querySelector("#session-collab-select")?.value || "default",
    personality: document.querySelector("#session-personality-select")?.value || "pragmatic",
    accessPreset: sandboxMode === "danger-full-access" ? "full-access" : sandboxMode === "read-only" ? "read-only" : "default",
  };
}

function insertCommand(command) {
  if (!command) return;
  state.prompt = command.endsWith(" ") ? command : command;
  state.view = "chat";
  render();
  const input = document.querySelector("#prompt-input");
  if (input) {
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
  }
}

function stopStream(clear = true) {
  if (state.streamAbortController) {
    state.streamAbortController.abort();
    state.streamAbortController = null;
  }
  if (clear) {
    state.turnId = "";
  }
}

async function toggleFavorite(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  const favorite = !isFavorite(session);
  const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/favorite`, {
    method: "PATCH",
    body: { favorite },
  });
  if (payload?.session) upsertSession(payload.session);
  render();
}

async function toggleArchive(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  const path = session.archived ? "unarchive" : "archive";
  const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/${path}`, { method: "POST" });
  if (payload?.session) upsertSession(payload.session);
  await refreshSessions({ silent: true });
}

async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch (_error) {
  }
  stopStream();
  state.token = "";
  state.authSession = null;
  state.currentSession = null;
  state.sessionId = "";
  localStorage.removeItem(TOKEN_KEY);
  render();
}

function clearLocalCache() {
  for (const key of ["codexWebSessionsCache", "codexWebTimelineCache", "codexWebQueuedMessages"]) {
    localStorage.removeItem(key);
  }
  state.error = "";
  refreshSessions().catch(handleApiError);
}

function retryLastUserMessage() {
  const last = [...state.timeline].reverse().find((item) => item.role === "user" && item.text);
  if (!last) return;
  state.prompt = last.text;
  render();
}

function normalizeSessions(payload, scope) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.filter((session) => session?.id).map((session) => ({
    ...session,
    cwd: typeof session.cwd === "string" ? session.cwd : "",
    title: typeof session.title === "string" ? session.title : "",
    preview: typeof session.preview === "string" ? session.preview : "",
    firstUserInput: typeof session.firstUserInput === "string" ? session.firstUserInput : "",
    lastUserInput: typeof session.lastUserInput === "string" ? session.lastUserInput : "",
    updatedAt: normalizeDateValue(session.updatedAt),
    lastInputAt: normalizeDateValue(session.lastInputAt),
    archived: scope === "archived" || session.archived === true,
  }));
}

function hydrateTimeline(session) {
  const direct = normalizeTimeline(session?.timeline);
  if (direct.length) return direct;
  const items = [];
  for (const turn of Array.isArray(session?.thread?.turns) ? session.thread.turns : []) {
    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      const role = inferThreadRole(item);
      const text = extractThreadText(item);
      if (!role || !text) continue;
      items.push({
        id: `history_${turn.id || items.length}_${items.length}`,
        kind: "message",
        role,
        meta: "history",
        text,
      });
    }
    if (isFailureStatus(turn.status)) {
      items.push({
        id: `error_${turn.id || items.length}`,
        kind: "message",
        role: "system",
        severity: "error",
        meta: "failed",
        text: turn.details || turn.error || turn.message || "任务执行失败",
      });
    }
  }
  if (!items.length && sessionPreview(session)) {
    items.push({ id: `preview_${session.id}`, kind: "message", role: "user", meta: "preview", text: sessionPreview(session) });
  }
  return items;
}

function normalizeTimeline(items) {
  return (Array.isArray(items) ? items : []).map((item) => {
    if (!item || item.kind !== "message") return null;
    const role = item.role === "user" || item.role === "assistant" || item.role === "system" ? item.role : "assistant";
    const text = typeof item.text === "string" ? item.text : "";
    if (!text) return null;
    return {
      id: item.id || `timeline_${Date.now()}_${Math.random()}`,
      kind: "message",
      role,
      meta: item.meta || "",
      text,
      severity: item.severity === "error" ? "error" : undefined,
    };
  }).filter(Boolean);
}

function inferThreadRole(item) {
  const value = String(item?.role || item?.author || item?.source || item?.type || item?.kind || "").toLowerCase();
  if (value.includes("user") || value.includes("human")) return "user";
  if (value.includes("system") || value.includes("error")) return "system";
  if (value.includes("assistant") || value.includes("agent") || value.includes("message")) return "assistant";
  return item?.text ? "assistant" : "";
}

function extractThreadText(item) {
  if (typeof item?.text === "string") return item.text.trim();
  if (typeof item?.content === "string") return item.content.trim();
  if (typeof item?.message === "string") return item.message.trim();
  if (Array.isArray(item?.content)) {
    return item.content.map((part) => part?.text || part?.content || "").filter(Boolean).join("\n").trim();
  }
  return "";
}

function appendTimeline(item) {
  state.timeline = [...state.timeline, item];
}

function replaceTimeline(match, next) {
  const index = state.timeline.findIndex(match);
  if (index >= 0) {
    state.timeline[index] = next;
  } else {
    appendTimeline(next);
  }
}

function upsertTimelineWork(id, item) {
  replaceTimeline((entry) => entry.id === item.id || entry.batchId === id, item);
}

function upsertSession(session) {
  if (!session?.id) return;
  const normalized = normalizeSessions({ items: [session] }, state.sortMode)[0] || session;
  const index = state.sessions.findIndex((item) => item.id === session.id);
  if (index >= 0) {
    state.sessions[index] = { ...state.sessions[index], ...normalized };
  } else {
    state.sessions.unshift(normalized);
  }
  if (state.currentSession?.id === session.id) {
    state.currentSession = { ...state.currentSession, ...session };
  }
}

function filteredSessions() {
  const q = state.search.trim().toLowerCase();
  return state.sessions.filter((session) => {
    if (!q) return true;
    return [sessionTitle(session), sessionPreview(session), session.cwd].join(" ").toLowerCase().includes(q);
  });
}

function sessionTitle(session) {
  return session?.title
    || firstLine(session?.lastUserInput)
    || firstLine(session?.firstUserInput)
    || cwdLeafName(session?.projectDisplayName)
    || cwdLeafName(session?.projectName)
    || cwdLeafName(session?.cwd)
    || "新会话";
}

function sessionPreview(session) {
  return session?.preview
    || session?.lastUserInput
    || session?.firstUserInput
    || session?.cwd
    || "等待下一条指令";
}

function sessionStatus(session) {
  const value = statusFromSession(session).status;
  if (value === "Turn running") return "running";
  if (value === "Turn failed") return "error";
  if (value === "Turn stopped") return "waiting";
  if (session?.archived) return "archived";
  return "completed";
}

function currentStatus() {
  if (state.pendingTurn) return "running";
  if (state.status === "Turn failed") return "error";
  if (state.status === "Turn stopped") return "waiting";
  return "completed";
}

function statusFromSession(session) {
  const active = findActiveTurn(session);
  if (active) return { status: "Turn running", tone: "warn" };
  const turns = Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
  const latest = [...turns].reverse().find((turn) => turn?.id || turn?.status);
  if (isFailureStatus(latest?.status)) return { status: "Turn failed", tone: "danger" };
  if (isInterruptedStatus(latest?.status)) return { status: "Turn stopped", tone: "warn" };
  return { status: "Ready", tone: "success" };
}

function findActiveTurn(session) {
  const activeId = String(session?.activeTurnId || "");
  if (!activeId) return null;
  const turns = Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
  return [...turns].reverse().find((turn) => turn?.id === activeId && !isTerminalStatus(turn.status)) || { id: activeId, status: "running" };
}

function statusBadge(status) {
  const map = {
    running: ["运行中", "blue"],
    completed: ["已完成", "green"],
    error: ["失败", "red"],
    waiting: ["等待中", "purple"],
    archived: ["已归档", "gray"],
  };
  const [label, tone] = map[status] || map.completed;
  return `<span class="status-badge ${tone}">${status === "running" ? "<i></i>" : ""}${label}</span>`;
}

function isFavorite(session) {
  return session?.favorite === true || session?.isFavorite === true || session?.starred === true;
}

function defaultCwdForCreate() {
  const fromInput = String(document.querySelector("#session-cwd-input")?.value || "").trim();
  return fromInput || state.defaultCwd || firstSessionCwd() || "";
}

function workspaceLabel() {
  return state.currentSession?.cwd
    || state.currentSession?.projectName
    || state.defaultCwd
    || firstSessionCwd()
    || "服务器默认目录";
}

function firstSessionCwd() {
  return state.sessions.find((session) => session.cwd)?.cwd || "";
}

function inferDefaultCwdFromSessions() {
  if (state.defaultCwd) return;
  const cwd = firstSessionCwd();
  if (!cwd) return;
  state.defaultCwd = cwd;
  persistDefaultCwd(cwd);
}

function persistDefaultCwd(value) {
  const cwd = String(value || "").trim();
  if (cwd) localStorage.setItem(DEFAULT_CWD_KEY, cwd);
  else localStorage.removeItem(DEFAULT_CWD_KEY);
}

function collectSettings() {
  const settings = effectiveSessionSettings();
  return {
    ...settings,
    model: settings.model || state.model || state.defaultThreadSettings.model || undefined,
  };
}

function effectiveSessionSettings() {
  return {
    ...state.defaultThreadSettings,
    ...(state.currentSession?.settings || {}),
  };
}

function currentStatusLabel() {
  const map = {
    running: "运行中",
    completed: "已完成",
    error: "失败",
    waiting: "等待中",
    archived: "已归档",
  };
  return map[currentStatus()] || "已完成";
}

function reasoningOptions() {
  return [["minimal", "minimal"], ["low", "low"], ["medium", "medium"], ["high", "high"], ["xhigh", "xhigh"]];
}

function sandboxOptions() {
  return [["read-only", "只读"], ["workspace-write", "工作区写入"], ["danger-full-access", "完整访问"]];
}

function approvalOptions() {
  return [["never", "不打断"], ["on-request", "按需确认"], ["on-failure", "失败时确认"], ["untrusted", "严格确认"]];
}

function collaborationOptions() {
  return [["default", "执行"], ["plan", "计划"]];
}

function personalityOptions() {
  return [["pragmatic", "务实"], ["friendly", "友好"], ["none", "无"]];
}

function roleOptions(selectedRoleId = "") {
  const roles = state.admin.roles.length ? state.admin.roles : [{ id: "role_admin", name: "Admin", isAdmin: true }];
  return roles.map((role) => {
    const id = role.id || "";
    const label = role.name || role.id || "角色";
    return `<option value="${escapeAttribute(id)}" ${id === selectedRoleId ? "selected" : ""}>${escapeHtml(label)}</option>`;
  }).join("");
}

function roleLabel(roleId) {
  const role = state.admin.roles.find((item) => item.id === roleId);
  return role?.name || roleId || "未分配角色";
}

function loadDefaultThreadSettings() {
  try {
    return JSON.parse(localStorage.getItem(DEFAULT_THREAD_SETTINGS_KEY) || "{}") || {};
  } catch (_error) {
    return {};
  }
}

function applyTheme(theme, options = {}) {
  state.theme = theme === "glass" ? "glass" : "light";
  document.documentElement.dataset.theme = state.theme;
  if (options.persist) localStorage.setItem(THEME_KEY, state.theme);
}

function modelLabel() {
  return state.model || state.models[0]?.id || state.models[0]?.name || "默认模型";
}

function modelOptions() {
  const items = state.models.length ? state.models : [{ id: state.model || "gpt-5.5", displayName: state.model || "默认模型" }];
  return items.map((model) => [
    model.id || model.model || model.name || "",
    model.displayName || model.name || model.model || model.id || "模型",
  ]).filter(([id]) => id);
}

function usageText() {
  if (!state.usage) return "按需刷新";
  if (state.usage.error) return state.usage.error;
  if (typeof state.usage === "string") return state.usage;
  const parts = [];
  for (const [key, value] of Object.entries(state.usage)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    parts.push(`${key}: ${value}`);
  }
  return parts.slice(0, 3).join(" · ") || "已连接";
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function skeletonCard() {
  return `<div class="session-card skeleton"><span></span><span></span><span></span></div>`;
}

function markFormControlInteraction() {
  lastFormControlInteractionAt = Date.now();
}

function isFormControlInteractionActive() {
  return isFormControl(document.activeElement) || Date.now() - lastFormControlInteractionAt < 1800;
}

function renderAfterBackgroundRefresh() {
  if (isFormControlInteractionActive()) return;
  render();
}

function isFormControl(element) {
  if (!(element instanceof Element)) return false;
  return Boolean(element.closest("input, select, textarea, [contenteditable='true']"));
}

function scrollChatToBottom() {
  const messages = document.querySelector("#messages");
  if (messages) messages.scrollTop = messages.scrollHeight;
}

function autoGrowTextarea(textarea) {
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(160, Math.max(44, textarea.scrollHeight))}px`;
}

function updateSendButton() {
  const button = document.querySelector(".send-btn");
  if (button) button.disabled = !state.prompt.trim();
}

function normalizeSiteTitle(value) {
  const title = String(value || "").trim();
  return title || "Codex";
}

function translate(value) {
  return zh[value] || value || "";
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/u)[0].trim();
}

function cwdLeafName(value) {
  const text = String(value || "").replace(/\\/g, "/").replace(/\/+$/u, "");
  return text.split("/").filter(Boolean).pop() || "";
}

function normalizeDateValue(value) {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function formatTime(value) {
  const time = normalizeDateValue(value);
  if (!time) return "刚刚";
  const diff = Date.now() - time;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(time).toLocaleDateString("zh-CN");
}

function isTerminalStatus(status) {
  return isSuccessStatus(status) || isFailureStatus(status) || isInterruptedStatus(status);
}

function isSuccessStatus(status) {
  return ["completed", "complete", "succeeded", "success", "finished"].includes(normalizeStatus(status));
}

function isFailureStatus(status) {
  return ["failed", "error", "timedout", "timeout"].includes(normalizeStatus(status));
}

function isInterruptedStatus(status) {
  return ["cancelled", "canceled", "interrupted", "aborted"].includes(normalizeStatus(status));
}

function normalizeStatus(status) {
  return String(status || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function formatSummary(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value || "");
  }
}

function linkify(text) {
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>');
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function icon(name) {
  const icons = {
    search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>',
    plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/><path d="M12 5v14"/></svg>',
    message: '<svg viewBox="0 0 24 24"><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M12 3v3"/><path d="M12 18v3"/><path d="m5.64 5.64 2.12 2.12"/><path d="m16.24 16.24 2.12 2.12"/><path d="M3 12h3"/><path d="M18 12h3"/><path d="m5.64 18.36 2.12-2.12"/><path d="m16.24 7.76 2.12-2.12"/><circle cx="12" cy="12" r="3"/></svg>',
    user: '<svg viewBox="0 0 24 24"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    back: '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    refresh: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>',
    send: '<svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    code: '<svg viewBox="0 0 24 24"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>',
    sliders: '<svg viewBox="0 0 24 24"><path d="M4 7h8"/><path d="M16 7h4"/><circle cx="14" cy="7" r="2"/><path d="M4 17h4"/><path d="M12 17h8"/><circle cx="10" cy="17" r="2"/></svg>',
    folder: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    doc: '<svg viewBox="0 0 24 24"><path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z"/><path d="M14 2v5h5"/><path d="M9 13h6"/><path d="M9 17h6"/></svg>',
    share: '<svg viewBox="0 0 24 24"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 16V4"/><path d="m7 9 5-5 5 5"/></svg>',
    info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
  };
  return icons[name] || icons.info;
}
