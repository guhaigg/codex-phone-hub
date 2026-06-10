const APP_BUILD_ID = "__CODEX_WEB_BUILD_ID__";
const TOKEN_KEY = "codexWebToken";
const THEME_KEY = "codexWebTheme";
const SITE_TITLE_KEY = "codexWebSiteTitle";
const DEFAULT_THREAD_SETTINGS_KEY = "codexWebDefaultThreadSettings";
const DEFAULT_CWD_KEY = "codexWebDefaultCwd";
const QUEUED_MESSAGES_KEY = "codexWebQueuedMessages";
const SIDEBAR_RECENTS_LIMIT = 30;
const SIDEBAR_SESSION_TITLE_LIMIT = 96;
const SIDEBAR_SESSION_PREVIEW_LIMIT = 140;
const TIMELINE_RENDER_LIMIT = 80;
const TIMELINE_RENDER_STEP = 80;
const TIMELINE_TEXT_LIMIT = 8000;
const TERMINAL_OUTPUT_LIMIT = 24000;

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
  "steering": "追加指令",
  "streaming": "生成中",
  "final": "完成",
  "failed": "失败",
};

const state = {
  token: localStorage.getItem(TOKEN_KEY) || "",
  siteTitle: normalizeSiteTitle(localStorage.getItem(SITE_TITLE_KEY) || "Codex 远程工作台"),
  authSession: null,
  sessions: [],
  currentSession: null,
  sessionId: "",
  draftSessionActive: false,
  timeline: [],
  models: [],
  reports: [],
  currentReport: null,
  reportContent: "",
  reportLoading: false,
  artifacts: [],
  currentArtifact: null,
  artifactContent: null,
  artifactLoading: false,
  artifactError: "",
  ecosystem: {
    loading: false,
    loaded: false,
    tab: "skills",
    skills: { cwd: null, skills: [], errors: [] },
    plugins: { featuredPluginIds: [], marketplaceLoadErrors: [], marketplaces: [] },
    apps: [],
    mcp: [],
    oauthUrl: "",
    configKey: "",
    configValue: "",
    error: "",
  },
  usage: null,
  settings: null,
  permissions: {},
  projects: [],
  admin: { settings: null, projects: [], roles: [], users: [] },
  adminLoading: false,
  adminSaving: false,
  runtimeHealth: null,
  runtimeHealthLoading: false,
  diagnostics: null,
  diagnosticsLoading: false,
  authSessions: [],
  auditItems: [],
  securityLoading: false,
  contextPackageLoading: false,
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
  workspaceAbortController: null,
  lastWorkspaceEventSequence: null,
  workspaceReconnectTimer: null,
  streamStartedAt: 0,
  streamLastEventAt: 0,
  streamWasBackgrounded: false,
  timelineShouldFollowLatest: true,
  timelineRenderLimit: TIMELINE_RENDER_LIMIT,
  lastTimelineViewportSnapshot: null,
  workspaceOpen: false,
  workspaceLoading: false,
  workspaceStatus: null,
  workspaceDiff: null,
  workspaceFile: null,
  workspaceError: "",
  terminalCommand: "",
  terminalCurrent: null,
  terminalOutput: "",
  terminalError: "",
  terminalLoading: false,
  terminalAbortController: null,
  lastTerminalEventSequence: null,
  settingsOpen: false,
  sessionToolsOpen: false,
  search: "",
  sortMode: "all",
  theme: localStorage.getItem(THEME_KEY) || "light",
  defaultThreadSettings: loadDefaultThreadSettings(),
  defaultCwd: localStorage.getItem(DEFAULT_CWD_KEY) || "",
  selectedFiles: [],
  queuedMessages: loadQueuedMessages(),
  notice: "",
  settingsSaving: false,
};

const app = document.querySelector("#app");
let lastFormControlInteractionAt = 0;
let promptFocusLayoutTimer = null;
let promptFocusRestoreTimer = null;
let appVersionCheckInFlight = false;
let pageResumeRecoveryTimer = null;
let workspaceEventsDeferredTimer = null;
let workspaceEventsConnectAfterLoadAttached = false;
const workspaceRefreshQueue = {
  sessions: false,
  currentSessionIds: new Set(),
  reports: false,
  scheduled: false,
  promise: null,
  resolve: null,
};
applyTheme(state.theme);
setupServiceWorker();
setupAppVersionRefresh();
setupPwaPullToRefresh();
boot();

window.addEventListener("resize", () => {
  const next = window.innerWidth < 820;
  if (next !== state.isMobile) {
    state.isMobile = next;
    if (!next && state.view === "settings") state.view = "sessions";
    render();
  }
});

document.addEventListener('visibilitychange', onVisibilityChange);
window.addEventListener('pageshow', onPageResume);
window.addEventListener('focus', onPageResume);
window.addEventListener('pagehide', () => {
  stopWorkspaceEvents();
  stopTerminalStream();
});
window.addEventListener('beforeunload', () => {
  stopWorkspaceEvents();
  stopTerminalStream();
});

document.addEventListener("focusin", (event) => {
  if (isFormControl(event.target)) markFormControlInteraction();
}, true);

document.addEventListener("pointerdown", (event) => {
  if (isFormControl(event.target)) markFormControlInteraction();
}, true);

function setupServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (isLocalPreviewHost()) {
    window.addEventListener('load', () => {
      void unregisterLocalPreviewServiceWorkers();
    });
    void unregisterLocalPreviewServiceWorkers();
    return;
  }
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/service-worker.js');
  });
}

function isLocalPreviewHost() {
  const hostname = window.location?.hostname || "";
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function unregisterLocalPreviewServiceWorkers() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch (_error) {
  }
}

function setupAppVersionRefresh() {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void checkForAppUpdate();
  });
  window.addEventListener('pageshow', () => {
    void checkForAppUpdate();
  });
}

async function checkForAppUpdate() {
  if (!APP_BUILD_ID || APP_BUILD_ID === "__CODEX_WEB_BUILD_ID__" || appVersionCheckInFlight) return;
  appVersionCheckInFlight = true;
  try {
    const response = await fetch(`/app.js?version-check=${Date.now()}`, {
      cache: "no-store",
      headers: { Accept: "application/javascript" },
    });
    if (!response.ok) return;
    const script = await response.text();
    const match = script.match(/const APP_BUILD_ID = ["']([^"']+)["'];/u);
    const nextBuildId = match?.[1] || "";
    if (nextBuildId && nextBuildId !== "__CODEX_WEB_BUILD_ID__" && nextBuildId !== APP_BUILD_ID) {
      window.location.reload();
    }
  } catch (_error) {
  } finally {
    appVersionCheckInFlight = false;
  }
}

function isStandalonePwa() {
  return navigator.standalone === true
    || (typeof matchMedia === "function" && matchMedia('(display-mode: standalone)').matches === true);
}

function setupPwaPullToRefresh() {
  if (!isStandalonePwa() || !window.CodexPullToRefresh?.init) return;
  window.CodexPullToRefresh.init({
    threshold: 120,
    onRefresh: () => refreshCurrentView(),
    getScrollContainer: ({ target } = {}) => {
      const element = target?.closest?.('#timeline, #sidebar-recents, .mobile-page, .report-reader, .settings-page, .admin-page, .capabilities-page');
      return element || document.scrollingElement || document.documentElement;
    },
  });
}

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
    scheduleWorkspaceEventsConnect();
    state.error = "";
  } catch (error) {
    handleApiError(error, { auth: true });
  } finally {
    state.loading = false;
    renderAuthenticatedAfterBackgroundRefresh();
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
    stopWorkspaceEvents({ clearCursor: true });
    stopTerminalStream({ clearCursor: true });
    state.token = "";
    state.authSession = null;
    state.currentSession = null;
    state.sessionId = "";
    state.draftSessionActive = false;
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

function render(options = {}) {
  if (!app) return;
  const composerSnapshot = options.preserveComposer === false ? null : captureFocusedComposerState();
  if (!state.token) {
    app.innerHTML = renderLogin();
    bindLogin();
    return;
  }
  app.innerHTML = state.isMobile ? renderMobileApp() : renderDesktopApp();
  bindApp();
  restoreFocusedComposerState(composerSnapshot);
  requestAnimationFrame(scrollChatToBottom);
}

function renderWorkspaceOnly() {
  if (state.isMobile) {
    return false;
  }
  const pane = document.querySelector(".workspace-pane");
  if (!pane) {
    return false;
  }
  const composerSnapshot = captureFocusedComposerState();
  pane.innerHTML = renderWorkspace(false);
  bindApp(pane);
  restoreFocusedComposerState(composerSnapshot);
  requestAnimationFrame(scrollChatToBottom);
  return true;
}

function renderLogin() {
  return `
    <main class="login-screen">
      <section class="login-brand">
        <div class="brand-orb">C</div>
        <h1>${escapeHtml(state.siteTitle)}</h1>
        <p>在手机和浏览器中接管 Codex CLI 与桌面端会话。</p>
        <div class="login-pills">
          <span>会话持续运行</span>
          <span>移动端可用</span>
          <span>任务状态追踪</span>
        </div>
      </section>
      <form class="login-card" id="login-form">
        <h2>欢迎使用</h2>
        <p class="muted">登录后操作 Codex 远程会话</p>
        <label>
          <span>账号</span>
          <input name="username" autocomplete="username" placeholder="admin" value="admin" required>
        </label>
        <label>
          <span>密码</span>
          <input name="password" type="password" autocomplete="current-password" placeholder="密码" required>
        </label>
        ${state.loginError ? `<div class="error-note">${escapeHtml(state.loginError)}</div>` : ""}
        <button class="primary" type="submit">${state.loading ? "登录中..." : "登录"}</button>
        <div class="login-foot">
          <label class="check-row"><input type="checkbox" checked> <span>保持登录</span></label>
          <span>账号由服务器配置管理</span>
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
    <main class="desktop-shell notebook-shell">
      <aside class="session-pane notebook-sidebar">
        ${renderNotebookSidebar()}
      </aside>
      <section class="workspace-pane notebook-workspace">
        ${renderWorkspace(false)}
      </section>
    </main>
  `;
}

function renderMobileApp() {
  const content = state.view === "sessions"
    ? `<section class="mobile-page">${renderSessionHeader(true)}<div id="mobile-session-results">${renderSessionList()}</div></section>`
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
          <p>${mobile ? "手机 Codex 工作台" : "会话与任务"}</p>
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

function renderNotebookSidebar() {
  return `
    <header class="sidebar-brand">
      <h1>${escapeHtml(state.siteTitle)}</h1>
      <button class="sidebar-collapse" type="button" id="open-settings" title="设置">${icon("panel")}</button>
    </header>
    <nav class="sidebar-nav" aria-label="主导航">
      <button class="sidebar-nav-item" type="button" id="new-session-button">${icon("plus")}<span>新对话</span></button>
      <label class="sidebar-nav-item sidebar-search">
        ${icon("search")}
        <input id="session-search" value="${escapeAttribute(state.search)}" placeholder="搜索">
      </label>
      ${sidebarNavButton("sessions", "对话", "message")}
      ${sidebarNavButton("capabilities", "工作台", "grid")}
      ${sidebarNavButton("reports", "报告", "clipboard")}
      ${sidebarNavButton("settings", "设置", "settings")}
    </nav>
    <section class="sidebar-section">
      <div class="sidebar-section-title">
        <span>项目</span>
      </div>
      <div class="sidebar-project">${icon("folder")}<span>${escapeHtml(workspaceLabel())}</span></div>
    </section>
    <section class="sidebar-section sidebar-recents" id="sidebar-recents">
      ${renderSidebarRecentsContent()}
    </section>
    ${renderSidebarAccount()}
  `;
}

function renderSidebarRecentsContent() {
  const sessions = filteredSessions();
  return `
    <div class="sidebar-section-title"><span>最近</span></div>
    ${renderSessionList({
      sessions,
      limit: SIDEBAR_RECENTS_LIMIT,
      compact: true,
      moreLabel: state.search ? "" : "会话",
    })}
  `;
}

function sidebarNavButton(view, label, iconName) {
  const active = state.view === view || (view === "sessions" && state.view === "chat");
  return `
    <button class="sidebar-nav-item ${active ? "active" : ""}" type="button" data-view="${escapeAttribute(view)}">
      ${icon(iconName)}
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function renderSidebarAccount() {
  const principal = state.authSession?.principal || {};
  const name = principal.displayName || principal.username || principal.userId || "管理员";
  const accountDetail = principal.email || principal.username || principal.userId || "本地账户";
  return `
    <footer class="sidebar-account">
      <span class="account-avatar">${escapeHtml(initialForName(name))}</span>
      <span class="account-copy">
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml(accountDetail)}</small>
      </span>
      <span class="sidebar-account-menu" aria-hidden="true">⌄</span>
    </footer>
  `;
}

function initialForName(name) {
  const value = String(name || "").trim();
  return value ? value.slice(0, 1).toUpperCase() : "C";
}

function renderViewTabs(mobile) {
  const items = mobile
    ? [["sessions", "会话"], ["capabilities", "能力"], ["reports", "报告"], ["settings", "设置"]]
    : [["sessions", "会话"], ["capabilities", "能力"], ["reports", "报告"], ["settings", "设置"]];
  return `<nav class="view-tabs">${items.map(([view, label]) => (
    `<button class="${state.view === view || (view === "sessions" && state.view === "chat") ? "active" : ""}" data-view="${view}">${label}</button>`
  )).join("")}</nav>`;
}

function filterButton(mode, label) {
  return `<button class="chip ${state.sortMode === mode ? "active" : ""}" data-filter="${mode}">${escapeHtml(label)}</button>`;
}

function renderSessionList(options = {}) {
  if (state.sessionsLoading) return `<div class="session-list">${Array.from({ length: 5 }).map(() => skeletonCard()).join("")}</div>`;
  const sessions = options.sessions || filteredSessions();
  if (!sessions.length) {
    return `
      <div class="empty-list">
        <div class="empty-plus">+</div>
        <h2>${state.search ? "没有匹配会话" : "还没有会话"}</h2>
        <p>${state.search ? "换个关键词试试。" : "使用顶部入口开始第一段 Codex 会话。"}</p>
      </div>
    `;
  }
  const limit = Number.isFinite(options.limit) ? Math.max(0, Number(options.limit)) : sessions.length;
  const visible = sessions.slice(0, limit);
  const hiddenCount = Math.max(0, sessions.length - visible.length);
  const more = hiddenCount && options.moreLabel
    ? `<div class="session-list-more">还有 ${hiddenCount} 个${escapeHtml(options.moreLabel)}</div>`
    : "";
  return `<div class="session-list">${visible.map((session) => renderSessionCard(session, { compact: options.compact === true })).join("")}${more}</div>`;
}

function renderSessionCard(session, options = {}) {
  const compact = options.compact === true;
  const status = sessionStatus(session);
  const title = compact
    ? truncateText(sessionTitle(session), SIDEBAR_SESSION_TITLE_LIMIT)
    : sessionTitle(session);
  const preview = compact
    ? truncateText(sessionPreview(session), SIDEBAR_SESSION_PREVIEW_LIMIT)
    : sessionPreview(session);
  const side = compact ? "" : `
      <div class="session-side">
        ${statusBadge(status)}
        <button class="mini-btn" data-favorite="${escapeAttribute(session.id)}" title="收藏">${isFavorite(session) ? "★" : "☆"}</button>
        <button class="mini-btn" data-archive="${escapeAttribute(session.id)}" title="${session.archived ? "取消归档" : "归档"}">•••</button>
      </div>
  `;
  return `
    <article class="session-card ${compact ? "compact" : ""} ${state.sessionId === session.id ? "active" : ""}" data-session-id="${escapeAttribute(session.id)}">
      <button class="session-main" data-session-open="${escapeAttribute(session.id)}">
        <span class="session-title">${escapeHtml(title)}</span>
        <span class="session-summary">${escapeHtml(preview)}</span>
        <span class="session-meta">${icon("clock")} ${escapeHtml(formatTime(session.updatedAt || session.lastInputAt))}</span>
      </button>
      ${side}
    </article>
  `;
}

function renderChatOrEmpty(mobile) {
  if (!state.currentSession && !state.sessionId && !state.prompt && !state.draftSessionActive && !state.sessionToolsOpen) {
    return `
      <section class="chat-pane notebook-chat empty-chat">
        <div class="empty-hero">
          <div class="empty-plus">+</div>
          <h2>开始新的会话</h2>
          <p>${mobile ? "在会话列表选择会话，或新建一段 Codex 会话。" : "在左侧侧边栏选择会话，或从侧边栏开始新的会话。"}</p>
          ${mobile ? `<button class="primary" id="empty-new-session-button">新建任务</button>` : ""}
        </div>
      </section>
    `;
  }
  const panelContent = [
    state.notice ? `<div class="notice-line">${escapeHtml(state.notice)}</div>` : "",
    state.sessionToolsOpen ? renderSessionTools() : "",
    state.workspaceOpen ? renderWorkspaceInspector() : "",
  ].filter(Boolean).join("");
  return `
    <section class="chat-pane notebook-chat">
      <header class="chat-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div class="chat-title">
          <h2>${escapeHtml(sessionTitle(state.currentSession || {}))}</h2>
          <div>${statusBadge(currentStatus())}</div>
        </div>
        <button class="icon-btn" id="toggle-session-tools" title="能力">${icon("sliders")}</button>
        <button class="icon-btn" id="toggle-workspace" title="工作区">${icon("folder")}</button>
        <button class="icon-btn" type="button" data-context-package-action="insert" title="插入交接包" ${state.contextPackageLoading ? "disabled" : ""}>${icon("clipboard")}</button>
        ${state.currentSession?.id ? `<button class="icon-btn" id="share-session" title="分享">${icon("share")}</button>` : ""}
        <button class="icon-btn" id="refresh-session" title="刷新">${icon("refresh")}</button>
      </header>
      <div class="chat-panels">${panelContent}</div>
      <main class="timeline chat-canvas" id="timeline">
        ${renderTimeline()}
      </main>
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
  const { items, hiddenCount } = visibleTimelineItems();
  const historyNotice = hiddenCount ? renderTimelineHistoryNotice(hiddenCount) : "";
  return `${historyNotice}${items.map(renderTimelineItem).join("")}`;
}

function visibleTimelineItems() {
  const limit = Math.max(
    TIMELINE_RENDER_LIMIT,
    Number.isFinite(state.timelineRenderLimit) ? Number(state.timelineRenderLimit) : TIMELINE_RENDER_LIMIT,
  );
  const start = Math.max(0, state.timeline.length - limit);
  return {
    hiddenCount: start,
    items: state.timeline.slice(start),
  };
}

function renderTimelineHistoryNotice(hiddenCount) {
  return `
    <div class="timeline-history-note">
      <span>较早 ${hiddenCount} 条已折叠</span>
      <button type="button" id="show-more-timeline">加载更早记录</button>
    </div>
  `;
}

function resetTimelineRenderLimit() {
  state.timelineRenderLimit = TIMELINE_RENDER_LIMIT;
}

function showMoreTimelineHistory() {
  const current = Number.isFinite(state.timelineRenderLimit) ? Number(state.timelineRenderLimit) : TIMELINE_RENDER_LIMIT;
  state.timelineRenderLimit = Math.min(state.timeline.length, current + TIMELINE_RENDER_STEP);
  render();
}

function renderTimelineItem(item) {
  if (item.kind === "batch" || item.kind === "approval" || item.kind === "step") {
    return `
      <article class="work-card">
        <div class="work-title">${escapeHtml(item.title || item.approvalKind || "工具调用")}</div>
        <pre>${escapeHtml(truncateTimelineText(formatSummary(item.summary || item.text || item.status || "")))}</pre>
        ${item.kind === "approval" && item.approvalId ? renderApprovalActions(item.approvalId) : ""}
      </article>
    `;
  }
  const role = item.role || "assistant";
  const isUser = role === "user";
  const isError = item.severity === "error";
  const label = item.label || (isUser ? "你" : isError ? "错误" : "Codex");
  return `
    <article class="message ${isUser ? "user" : "assistant"} ${isError ? "error" : ""}">
      <div class="message-label">${escapeHtml(label)}${item.meta ? `<span>${escapeHtml(translate(item.meta))}</span>` : ""}</div>
      <div class="message-body">${renderMessageText(truncateTimelineText(item.text || ""))}</div>
      ${isError ? `<button class="retry-btn" id="retry-last">重试</button>` : ""}
    </article>
  `;
}

function truncateTimelineText(value) {
  const text = String(value || "");
  if (text.length <= TIMELINE_TEXT_LIMIT) return text;
  const hidden = text.length - TIMELINE_TEXT_LIMIT;
  return `${text.slice(0, TIMELINE_TEXT_LIMIT).trimEnd()}\n\n[内容过长，已截断 ${hidden} 字]`;
}

function renderWorkspaceInspector() {
  const status = state.workspaceStatus || {};
  const counts = status.counts || {};
  const files = Array.isArray(status.files) ? status.files : [];
  return `
    <section class="workspace-inspector">
      <header>
        <div>
          <strong>工作区</strong>
          <small>${escapeHtml(status.cwd || state.currentSession?.cwd || workspaceLabel())}</small>
        </div>
        <button type="button" class="mini-btn context-package-mini" data-context-package-action="insert" title="插入交接包" ${state.contextPackageLoading ? "disabled" : ""}>${icon("clipboard")}交接包</button>
        <button type="button" class="mini-btn" id="refresh-workspace" title="刷新">${icon("refresh")}</button>
      </header>
      ${state.workspaceLoading ? `<div class="workspace-muted">正在读取工作区...</div>` : ""}
      ${state.workspaceError ? `<div class="workspace-error">${escapeHtml(state.workspaceError)}</div>` : ""}
      ${renderWorkspaceTerminalPanel()}
      ${renderArtifactPanel("workspace")}
      ${state.workspaceStatus ? `
        <div class="workspace-status-line">
          <span>${escapeHtml(status.isGitRepository ? (status.branch || "detached") : "非 Git 目录")}</span>
          ${status.upstream ? `<span>${escapeHtml(status.upstream)}</span>` : ""}
          <span>${status.diskWritable ? "可写" : "只读"}</span>
          ${status.lastCommit?.shortHash ? `<span>${escapeHtml(status.lastCommit.shortHash)} ${escapeHtml(status.lastCommit.message || "")}</span>` : ""}
        </div>
        <div class="workspace-counts">
          <span>已暂存 ${escapeHtml(counts.staged ?? 0)}</span>
          <span>未暂存 ${escapeHtml(counts.unstaged ?? 0)}</span>
          <span>未跟踪 ${escapeHtml(counts.untracked ?? 0)}</span>
        </div>
        <div class="workspace-layout">
          <div class="workspace-files">
            ${files.length ? files.map(renderWorkspaceFileButton).join("") : `<div class="workspace-muted">没有文件变更</div>`}
          </div>
          <div class="workspace-diff">
            ${renderWorkspaceDiff()}
          </div>
        </div>
        ${state.workspaceFile ? renderWorkspaceFilePreview() : ""}
      ` : !state.workspaceLoading && !state.workspaceError ? `<div class="workspace-muted">打开后读取当前会话工作区状态。</div>` : ""}
    </section>
  `;
}

function renderWorkspaceTerminalPanel() {
  const terminal = state.terminalCurrent || {};
  const running = terminal.status === "running";
  const busy = state.terminalLoading === true;
  const hasSession = Boolean(state.currentSession?.id || state.sessionId);
  const output = state.terminalOutput || "命令输出会显示在这里。";
  const statusLabel = terminalStatusLabel(terminal.status || (busy ? "starting" : "idle"));
  return `
    <section class="workspace-terminal" aria-label="终端">
      <header>
        <div>
          <strong>终端</strong>
          <small>${escapeHtml(statusLabel)}${terminal.cwd ? ` · ${escapeHtml(terminal.cwd)}` : ""}</small>
        </div>
        <button type="button" class="mini-btn" id="clear-terminal" title="清空输出">${icon("refresh")}</button>
      </header>
      <form class="terminal-form" id="terminal-form">
        <input id="terminal-command" type="text" autocomplete="off" spellcheck="false" placeholder="npm test --workspace packages/codex-web" value="${escapeAttribute(state.terminalCommand)}" ${busy || running || !hasSession ? "disabled" : ""}>
        <button type="submit" class="icon-btn terminal-run" title="运行" ${busy || running || !hasSession ? "disabled" : ""}>${icon("send")}</button>
        <button type="button" class="icon-btn terminal-stop" id="stop-terminal" title="停止" ${running ? "" : "disabled"}>${icon("stop")}</button>
      </form>
      <div class="terminal-actions">
        <button type="button" class="mini-btn" id="copy-terminal-output" ${state.terminalOutput ? "" : "disabled"}>${icon("clipboard")}复制</button>
        <button type="button" class="mini-btn" id="append-terminal-output" ${state.terminalOutput ? "" : "disabled"}>${icon("plus")}附加到输入</button>
      </div>
      ${state.terminalError ? `<div class="workspace-error">${escapeHtml(state.terminalError)}</div>` : ""}
      <pre class="terminal-output" id="terminal-output"><code>${escapeHtml(output)}</code></pre>
    </section>
  `;
}

function renderWorkspaceFileButton(file) {
  const badge = `${String(file.indexStatus || " ").trim() || "-"}${String(file.worktreeStatus || " ").trim() || "-"}`;
  return `
    <button type="button" data-workspace-file="${escapeAttribute(file.path || "")}">
      <span>${escapeHtml(file.path || "")}</span>
      <em>${escapeHtml(badge)}</em>
    </button>
  `;
}

function renderWorkspaceDiff() {
  const diff = state.workspaceDiff || {};
  const files = Array.isArray(diff.files) ? diff.files : [];
  if (!files.length && !diff.raw) {
    return `<div class="workspace-muted">没有 diff</div>`;
  }
  if (files.length) {
    return files.map((file) => `
      <article class="workspace-diff-file">
        <strong>${escapeHtml(file.path || file.newPath || "")}</strong>
        ${(Array.isArray(file.hunks) ? file.hunks : []).map((hunk) => `
          <pre><code>${escapeHtml([hunk.header, ...(Array.isArray(hunk.lines) ? hunk.lines : [])].join("\n"))}</code></pre>
        `).join("")}
      </article>
    `).join("");
  }
  return `<pre><code>${escapeHtml(truncateTimelineText(diff.raw || ""))}</code></pre>`;
}

function renderWorkspaceFilePreview() {
  return `
    <article class="workspace-file-preview">
      <header>
        <strong>${escapeHtml(state.workspaceFile.relativePath || "文件")}</strong>
        <small>${escapeHtml(formatBytes(state.workspaceFile.sizeBytes || 0))}</small>
      </header>
      <pre><code>${escapeHtml(truncateTimelineText(state.workspaceFile.content || ""))}</code></pre>
    </article>
  `;
}

function renderArtifactPanel(context = "workspace") {
  const isReports = context === "reports";
  const title = isReports ? "项目产物" : "本次产物";
  const subtitle = currentSessionId()
    ? `${state.artifacts.length} 个文件`
    : "打开会话后显示";
  const classes = [
    "artifact-panel",
    isReports ? "artifact-panel-page" : "artifact-panel-inline",
  ].join(" ");
  return `
    <section class="${classes}" data-artifact-panel="${escapeAttribute(context)}">
      <header>
        <div>
          <strong>${escapeHtml(title)}</strong>
          <small>${escapeHtml(subtitle)}</small>
        </div>
        <button type="button" class="mini-btn" data-refresh-artifacts title="刷新">${icon("refresh")}</button>
      </header>
      ${state.artifactError ? `<div class="workspace-error">${escapeHtml(state.artifactError)}</div>` : ""}
      ${state.artifactLoading && !state.artifacts.length ? renderArtifactLoading() : renderArtifactBody(isReports)}
    </section>
  `;
}

function renderArtifactLoading() {
  return `<div class="artifact-loading"><span></span><span></span><span></span></div>`;
}

function renderArtifactBody(isReports) {
  if (!currentSessionId()) {
    return `<div class="workspace-muted">先打开一个会话，再查看这次任务产物。</div>`;
  }
  if (!state.artifacts.length) {
    return `<div class="workspace-muted">还没有可展示的产物。支持 Markdown、文本、图片、PDF 和下载文件。</div>`;
  }
  return `
    <div class="artifact-layout ${isReports ? "wide" : ""}">
      <div class="artifact-list">
        ${state.artifacts.map(renderArtifactItem).join("")}
      </div>
      <div class="artifact-preview">
        ${renderArtifactPreview()}
      </div>
    </div>
  `;
}

function renderArtifactItem(artifact) {
  const active = state.currentArtifact?.id === artifact.id;
  return `
    <article class="artifact-item ${active ? "active" : ""}">
      <button type="button" class="artifact-main" data-artifact-open="${escapeAttribute(artifact.id)}">
        <span class="artifact-kind">${escapeHtml(artifactKindLabel(artifact.kind))}</span>
        <span class="artifact-title">${escapeHtml(artifact.displayPath || artifact.title || "产物")}</span>
        <span class="artifact-meta">${escapeHtml(artifact.source === "report" ? "报告" : "工作区")} · ${escapeHtml(formatBytes(artifact.sizeBytes))}</span>
      </button>
      <div class="artifact-actions">
        <button type="button" class="mini-btn" data-artifact-favorite="${escapeAttribute(artifact.id)}" title="收藏">${artifact.favorite ? "★" : "☆"}</button>
        <button type="button" class="mini-btn" data-artifact-download="${escapeAttribute(artifact.id)}" title="下载">${icon("download")}</button>
      </div>
    </article>
  `;
}

function renderArtifactPreview() {
  const artifact = state.currentArtifact;
  if (!artifact) {
    return `<div class="empty-inline"><h3>选择产物</h3><p>打开左侧文件查看内容或下载。</p></div>`;
  }
  if (state.artifactLoading) {
    return renderArtifactLoading();
  }
  const content = state.artifactContent;
  const actions = `
    <div class="artifact-preview-actions">
      <button type="button" class="mini-btn" data-artifact-download="${escapeAttribute(artifact.id)}">${icon("download")}下载</button>
      <button type="button" class="mini-btn" data-artifact-favorite="${escapeAttribute(artifact.id)}">${artifact.favorite ? "★ 已收藏" : "☆ 收藏"}</button>
    </div>
  `;
  const header = `
    <header>
      <div>
        <strong>${escapeHtml(artifact.title || artifact.displayPath || "产物")}</strong>
        <small>${escapeHtml(artifact.displayPath || "")} · ${escapeHtml(formatBytes(artifact.sizeBytes))}</small>
      </div>
      ${actions}
    </header>
  `;
  if (!artifact.previewable || artifact.kind === "download") {
    return `<article class="artifact-content">${header}<div class="workspace-muted">此文件不支持在线预览，请下载查看。</div></article>`;
  }
  if (artifact.kind === "pdf") {
    return `<article class="artifact-content">${header}<div class="workspace-muted">PDF 可在手机或浏览器中下载后打开。</div></article>`;
  }
  if (!content) {
    return `<article class="artifact-content">${header}<div class="workspace-muted">选择文件后显示预览。</div></article>`;
  }
  if (content.kind === "image" && content.contentBase64) {
    const src = `data:${artifact.mimeType || "application/octet-stream"};base64,${content.contentBase64}`;
    return `<article class="artifact-content">${header}<img class="artifact-image" src="${escapeAttribute(src)}" alt="${escapeAttribute(artifact.title || artifact.displayPath || "产物图片")}"></article>`;
  }
  return `
    <article class="artifact-content">
      ${header}
      <pre><code>${escapeHtml(truncateTimelineText(content.content || ""))}</code></pre>
    </article>
  `;
}

function artifactKindLabel(kind) {
  const labels = {
    text: "TXT",
    markdown: "MD",
    html: "HTML",
    image: "IMG",
    pdf: "PDF",
    download: "FILE",
  };
  return labels[kind] || "FILE";
}

function terminalStatusLabel(status) {
  const labels = {
    idle: "待运行",
    starting: "启动中",
    running: "运行中",
    completed: "已完成",
    failed: "失败",
    stopped: "已停止",
  };
  return labels[status] || "待运行";
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
  if (parts.length === 1) return `<p>${renderInlineMessageText(value).replace(/\n/g, "<br>")}</p>`;
  return parts.map((part, index) => {
    if (index % 2 === 0) return `<p>${renderInlineMessageText(part).replace(/\n/g, "<br>")}</p>`;
    const lines = part.replace(/^\w+\n/u, "").trimEnd();
    return `<pre class="code-block"><code>${escapeHtml(lines)}</code></pre>`;
  }).join("");
}

function renderInlineMessageText(text) {
  const value = String(text || "");
  const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/gu;
  let html = "";
  let cursor = 0;
  for (const match of value.matchAll(linkPattern)) {
    html += renderPlainInline(value.slice(cursor, match.index));
    html += renderMessageLink(match[1], match[2]);
    cursor = match.index + match[0].length;
  }
  html += renderPlainInline(value.slice(cursor));
  return html;
}

function renderPlainInline(text) {
  return linkReportPaths(linkify(escapeHtml(text)))
    .replace(/`([^`<]+)`/gu, "<code>$1</code>");
}

function renderMessageLink(label, href) {
  if (isReportPath(href)) {
    return reportPathLink(href, label);
  }
  if (/^https?:\/\//u.test(href)) {
    return `<a href="${escapeAttribute(href)}" target="_blank" rel="noreferrer">${renderPlainInline(label)}</a>`;
  }
  return renderPlainInline(`[${label}](${href})`);
}

function linkReportPaths(html) {
  return String(html || "").replace(/\/[^\s<>()"']*\/\.codex-web\/reports\/[^\s<>()"']+\.md/gu, (path) => reportPathLink(path));
}

function reportPathLink(path, label = "") {
  const text = label || path.split("/").filter(Boolean).pop() || path;
  return `<a href="#" class="report-link" data-report-path="${escapeAttribute(path)}">${escapeHtml(text)}</a>`;
}

function isReportPath(path) {
  return /\/\.codex-web\/reports\/[^\s<>()"']+\.md$/u.test(String(path || ""));
}

function renderComposer() {
  const sendLabel = state.pendingTurn ? "追加指令" : "";
  const sendButtonClass = `send-btn${state.pendingTurn ? " with-label" : ""}`;
  return `
    <form class="composer composer-tray" id="composer-form">
      ${renderComposerStatus()}
      ${renderQueuedMessages()}
      ${renderSelectedFiles()}
      <div class="composer-row">
        <input id="file-input" type="file" multiple hidden>
        <textarea id="prompt-input" rows="1" placeholder="输入任务或追加指令">${escapeHtml(state.prompt)}</textarea>
        <div class="composer-tool-row">
          <div class="composer-leading-tools">
            <button type="button" class="icon-btn" id="attach-button" title="附加文件">+</button>
            <button type="button" class="icon-btn" data-command="/help" title="帮助">${icon("settings")}</button>
            <button type="button" class="icon-btn" data-quick="总结改动" title="总结改动">${icon("sparkles")}</button>
            <button type="button" class="icon-btn" data-quick="运行测试" title="运行测试">${icon("grid")}</button>
          </div>
          <div class="composer-actions">
            <span class="composer-model-pill">${escapeHtml(modelLabel())}</span>
            ${state.pendingTurn ? `<button type="button" class="queue-btn" id="queue-message-button" ${state.prompt.trim() ? "" : "disabled"} title="加入排队">${icon("clock")}<span>排队</span></button>` : ""}
            ${state.pendingTurn ? `<button type="button" class="stop-btn" id="stop-button" title="停止">${icon("stop")}</button>` : ""}
            <button class="${sendButtonClass}" id="send-button" type="submit" ${state.prompt.trim() ? "" : "disabled"} title="${state.pendingTurn ? "追加指令" : "发送"}">${icon("send")}${sendLabel ? `<span>${escapeHtml(sendLabel)}</span>` : ""}</button>
          </div>
        </div>
      </div>
      ${state.error ? `<div class="composer-error">${escapeHtml(state.error)}</div>` : ""}
    </form>
  `;
}

function renderComposerStatus() {
  const statusMap = {
    "Turn running": ["work", "Running"],
    "Stream paused": ["warn", "Paused"],
    "Turn failed": ["danger", "Failed"],
    "Turn stopped": ["warn", "Stopped"],
    Ready: ["success", "Done"],
  };
  const [tone, label] = statusMap[state.status] || (state.pendingTurn ? statusMap["Turn running"] : statusMap.Ready);
  return `<div class="composer-status" data-tone="${tone}"><span>${label}</span></div>`;
}

function renderQueuedMessages() {
  const messages = queuedMessagesForCurrentSession().filter((message) => !message.sending);
  if (!state.pendingTurn && !messages.length) return "";
  const guide = state.pendingTurn
    ? `<div class="queue-guide"><strong>正在运行</strong><span>Enter 追加到当前任务；点“排队”会在本轮完成后自动发送。</span></div>`
    : "";
  const rows = messages.map((message) => `
    <div class="queued-message-row" data-queued-message-id="${escapeAttribute(message.id)}">
      <span class="queued-message-text">${escapeHtml(message.text)}</span>
      <button type="button" data-remove-queued-message="${escapeAttribute(message.id)}" title="删除排队消息">删除</button>
    </div>
  `).join("");
  return `<div class="queued-messages">${guide}${rows}</div>`;
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
          <button type="button" data-context-package-action="insert" ${canPatch && !state.contextPackageLoading ? "" : "disabled"}>插入交接包</button>
          <button type="button" data-context-package-action="copy" ${canPatch && !state.contextPackageLoading ? "" : "disabled"}>复制交接包</button>
          <button type="button" data-context-package-action="new" ${canPatch && !state.contextPackageLoading ? "" : "disabled"}>新会话继续</button>
          <button type="button" id="session-favorite">${isFavorite(state.currentSession) ? "取消收藏" : "收藏"}</button>
          <button type="button" id="session-archive">${state.currentSession?.archived ? "取消归档" : "归档"}</button>
        </div>
        ${compactInput(state.currentSession ? "当前目录" : "新会话目录", "session-cwd-input", cwdValue, "/srv/codex-workbench", Boolean(state.currentSession))}
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
    <section class="settings-page workbench-page">
      <header class="settings-head tool-page-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div>
          <h1>设置</h1>
          <p>模型、权限、运行状态与个人维护</p>
        </div>
      </header>
      ${state.notice ? `<div class="notice-line settings-notice">${escapeHtml(state.notice)}</div>` : ""}
      <form class="settings-form" id="settings-form">
        <section class="open-section">
          <div class="section-kicker">连接</div>
          ${settingStatic("服务地址", location.origin, "link")}
          ${settingStatic("登录状态", state.authSession?.principal?.mode ? `已登录 · ${state.authSession.principal.mode}` : "已登录", "user")}
          ${settingInput("站点名称", "site-title-input", state.siteTitle, "Codex 远程工作台", !state.permissions?.canSetSiteTitle)}
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
          ${settingStatic("Provider", runtimeHealthText(), runtimeHealthIcon())}
          ${renderDiagnosticsSummary()}
          ${settingStatic("用量", usageText(), "info")}
          ${settingStatic("版本", `Build ${APP_BUILD_ID}`, "code")}
          <div class="action-line">
            <button class="ghost-action" type="button" id="refresh-runtime-health">${state.runtimeHealthLoading ? "刷新中..." : "刷新状态"}</button>
            <button class="ghost-action" type="button" id="refresh-diagnostics">${state.diagnosticsLoading ? "检查中..." : "系统诊断"}</button>
            <button class="ghost-action" type="button" id="refresh-usage">刷新用量</button>
            <button class="ghost-action" type="button" id="reload-runtime">重载运行时</button>
            <button class="ghost-action danger" type="button" id="clear-cache">清理缓存</button>
          </div>
        </section>
        ${renderSecuritySummary()}
        <div class="settings-actions">
          <button class="primary" type="submit">${state.settingsSaving ? "保存中..." : "保存设置"}</button>
          <button class="logout-btn" type="button" id="logout-button">退出登录</button>
        </div>
      </form>
    </section>
  `;
}

function renderSecuritySummary() {
  const authSessions = Array.isArray(state.authSessions) ? state.authSessions : [];
  const auditItems = Array.isArray(state.auditItems) ? state.auditItems : [];
  return `
    <section class="open-section">
      <div class="section-kicker">安全</div>
      <div class="security-head">
        <div>
          <strong>我的设备</strong>
          <small>${authSessions.length ? `${authSessions.length} 个已登录设备` : "按需加载设备会话"}</small>
        </div>
        <button class="ghost-action" type="button" id="refresh-security">${state.securityLoading ? "刷新中..." : "刷新安全状态"}</button>
      </div>
      <div class="security-list">
        ${authSessions.length ? authSessions.map(renderAuthSessionRow).join("") : `
          <div class="setting-row">
            <span class="setting-icon">${icon("user")}</span>
            <span class="setting-copy"><strong>我的设备</strong><small>暂无设备记录</small></span>
          </div>
        `}
      </div>
      <div class="security-head security-audit-head">
        <div>
          <strong>操作记录</strong>
          <small>${auditItems.length ? "最近安全操作" : "暂无审计记录"}</small>
        </div>
      </div>
      <div class="security-list">
        ${auditItems.length ? auditItems.slice(0, 8).map(renderAuditRow).join("") : `
          <div class="setting-row">
            <span class="setting-icon">${icon("clipboard")}</span>
            <span class="setting-copy"><strong>操作记录</strong><small>登录、退出和设备撤销会显示在这里</small></span>
          </div>
        `}
      </div>
    </section>
  `;
}

function renderAuthSessionRow(session) {
  const current = session?.current === true;
  return `
    <div class="setting-row security-row">
      <span class="setting-icon">${icon(current ? "check" : "user")}</span>
      <span class="setting-copy">
        <strong>${escapeHtml(session?.deviceName || "Unknown device")}</strong>
        <small>${current ? "当前设备" : "其他设备"} · 最近 ${escapeHtml(formatTime(session?.lastSeenAt))}</small>
      </span>
      ${current ? "" : `<button class="ghost-action danger compact-action" type="button" data-revoke-auth-session="${escapeAttribute(session?.id || "")}">撤销</button>`}
    </div>
  `;
}

function renderAuditRow(item) {
  return `
    <div class="setting-row security-row">
      <span class="setting-icon">${icon(auditIcon(item?.action))}</span>
      <span class="setting-copy">
        <strong>${escapeHtml(auditActionLabel(item?.action))}</strong>
        <small>${escapeHtml(formatTime(item?.timestamp))}${item?.targetSessionId ? ` · ${escapeHtml(item.targetSessionId)}` : ""}</small>
      </span>
    </div>
  `;
}

function renderDiagnosticsSummary() {
  const diagnostics = state.diagnostics;
  if (!diagnostics) {
    return settingStatic(
      "系统",
      state.diagnosticsLoading ? "检查中" : "按需检查重启、升级包、磁盘、服务和备份",
      state.diagnosticsLoading ? "refresh" : "info",
    );
  }
  return [
    settingStatic("系统", systemDiagnosticsText(diagnostics), systemDiagnosticsIcon(diagnostics)),
    settingStatic("服务", serviceDiagnosticsText(diagnostics), diagnostics.service?.active === true ? "check" : "info"),
    settingStatic("存储", storageDiagnosticsText(diagnostics), storageDiagnosticsIcon(diagnostics)),
    settingStatic("最近备份", backupDiagnosticsText(diagnostics), diagnostics.backup?.latest ? "doc" : "info"),
    settingStatic("第三方 API", diagnosticsProviderText(diagnostics), "refresh"),
  ].join("");
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
    ["目标与命令", "/status · /model · /plan", "远程工作台命令可直接插入输入框", "code", "chat"],
    ["报告", `${state.reports.length || "未加载"} 个`, "查看任务沉淀、帮助文档和报告内容", "doc", "reports"],
    ["运行时", runtimeHealthText(), "Provider 状态、用量、重载运行时、清理缓存", "refresh", "settings"],
    ["项目与服务", state.admin.settings ? `${state.admin.projects.length} 个项目` : "点击加载", "维护个人项目目录和服务状态", "folder", "projects"],
  ];
  return `
    <section class="capabilities-page workbench-page">
      <header class="settings-head tool-page-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div>
          <h1>工作台</h1>
          <p>远程会话、运行参数、命令和管理入口</p>
        </div>
      </header>
      <section class="capability-hero tool-hero">
        <div>
          <span>当前会话</span>
          <strong>${escapeHtml(state.currentSession ? sessionTitle(state.currentSession) : "未选择会话")}</strong>
          <small>${escapeHtml(current.cwd || current.projectName || "选择会话后可调整本会话参数")}</small>
        </div>
        <button class="primary" id="cap-new-session">新建任务</button>
      </section>
      <section class="capability-list tool-list">
        ${capabilities.map(([title, value, desc, iconName, target]) => `
          <button class="capability-row tool-row" data-capability-target="${escapeAttribute(target)}">
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
          ${remoteCommandButtons().map(([command, label]) => `<button type="button" data-command="${escapeAttribute(command)}"><strong>${escapeHtml(command)}</strong><small>${escapeHtml(label)}</small></button>`).join("")}
        </div>
      </section>
      ${renderPersonalProjectsPanel()}
      ${renderEcosystemPanel()}
    </section>
  `;
}

function renderPersonalProjectsPanel() {
  const settings = state.admin.settings || {};
  const visibleProjects = state.admin.projects.slice(0, 40);
  const hiddenCount = Math.max(0, state.admin.projects.length - visibleProjects.length);
  return `
    <section class="open-section personal-projects-panel" id="personal-projects-panel">
      <div class="ecosystem-head">
        <div>
          <div class="section-kicker">个人项目</div>
          <p>常用 Codex 工作目录和会话上限</p>
        </div>
        <button class="ghost-action" type="button" id="refresh-admin">${state.adminLoading ? "刷新中..." : "刷新项目"}</button>
      </div>
      ${state.adminLoading ? renderReportLoading() : `
        ${state.notice ? `<div class="notice-line settings-notice">${escapeHtml(state.notice)}</div>` : ""}
        ${renderPersonalAdminSummary(settings)}
        ${renderAdminProjectForm()}
        ${visibleProjects.length ? visibleProjects.map((project) => renderAdminProjectForm(project)).join("") : `<p class="muted">暂无项目。当前是个人模式，可以直接创建默认会话。</p>`}
        ${hiddenCount ? `<p class="muted">还有 ${hiddenCount} 个项目未在本页展开，避免页面过重。</p>` : ""}
      `}
    </section>
  `;
}

function renderEcosystemPanel() {
  const ecosystem = normalizeEcosystemState();
  const tabs = [
    ["skills", "Skills"],
    ["plugins", "Plugins"],
    ["mcp", "MCP"],
    ["apps", "Apps"],
    ["config", "Config"],
  ];
  return `
    <section class="ecosystem-panel open-section">
      <div class="ecosystem-head">
        <div>
          <div class="section-kicker">生态控制台</div>
          <p>Skills、Plugins、MCP、Apps 和 Codex 配置</p>
        </div>
        <button class="ghost-action" type="button" id="refresh-ecosystem">${ecosystem.loading ? "刷新中..." : "刷新生态"}</button>
      </div>
      ${ecosystem.error ? `<div class="notice-line settings-notice">${escapeHtml(ecosystem.error)}</div>` : ""}
      ${ecosystem.oauthUrl ? `
        <div class="ecosystem-oauth">
          <span>OAuth URL</span>
          <a href="${escapeAttribute(ecosystem.oauthUrl)}" target="_blank" rel="noreferrer">${escapeHtml(ecosystem.oauthUrl)}</a>
          <button class="ghost-action" type="button" data-copy-text="${escapeAttribute(ecosystem.oauthUrl)}">复制链接</button>
        </div>
      ` : ""}
      <div class="ecosystem-metrics">
        ${renderEcosystemMetric("Skills", ecosystem.skills.skills.length, sampleSkillNames(ecosystem))}
        ${renderEcosystemMetric("Plugins", ecosystemPlugins(ecosystem).length, samplePluginNames(ecosystem))}
        ${renderEcosystemMetric("MCP", ecosystem.mcp.length, sampleMcpNames(ecosystem))}
        ${renderEcosystemMetric("Apps", ecosystem.apps.length, sampleAppNames(ecosystem))}
      </div>
      <div class="ecosystem-tabs">
        ${tabs.map(([tab, label]) => `<button type="button" class="${ecosystem.tab === tab ? "active" : ""}" data-ecosystem-tab="${escapeAttribute(tab)}">${escapeHtml(label)}</button>`).join("")}
      </div>
      <div class="ecosystem-content">
        ${ecosystem.loading && !ecosystem.loaded ? renderReportLoading() : renderEcosystemTab(ecosystem)}
      </div>
    </section>
  `;
}

function normalizeEcosystemState() {
  const ecosystem = state.ecosystem || {};
  return {
    loading: ecosystem.loading === true,
    loaded: ecosystem.loaded === true,
    tab: ["skills", "plugins", "mcp", "apps", "config"].includes(ecosystem.tab) ? ecosystem.tab : "skills",
    skills: {
      cwd: ecosystem.skills?.cwd || null,
      skills: Array.isArray(ecosystem.skills?.skills) ? ecosystem.skills.skills : [],
      errors: Array.isArray(ecosystem.skills?.errors) ? ecosystem.skills.errors : [],
    },
    plugins: {
      featuredPluginIds: Array.isArray(ecosystem.plugins?.featuredPluginIds) ? ecosystem.plugins.featuredPluginIds : [],
      marketplaceLoadErrors: Array.isArray(ecosystem.plugins?.marketplaceLoadErrors) ? ecosystem.plugins.marketplaceLoadErrors : [],
      marketplaces: Array.isArray(ecosystem.plugins?.marketplaces) ? ecosystem.plugins.marketplaces : [],
    },
    apps: Array.isArray(ecosystem.apps) ? ecosystem.apps : [],
    mcp: Array.isArray(ecosystem.mcp) ? ecosystem.mcp : [],
    oauthUrl: String(ecosystem.oauthUrl || ""),
    configKey: String(ecosystem.configKey || ""),
    configValue: String(ecosystem.configValue || ""),
    error: String(ecosystem.error || ""),
  };
}

function renderEcosystemMetric(label, count, sample) {
  return `
    <div class="ecosystem-metric">
      <strong>${escapeHtml(String(count))}</strong>
      <span>${escapeHtml(label)}</span>
      <small>${escapeHtml(sample || "未加载")}</small>
    </div>
  `;
}

function renderEcosystemTab(ecosystem) {
  if (ecosystem.tab === "plugins") return renderPluginRows(ecosystem);
  if (ecosystem.tab === "mcp") return renderMcpRows(ecosystem);
  if (ecosystem.tab === "apps") return renderAppRows(ecosystem);
  if (ecosystem.tab === "config") return renderConfigPanel(ecosystem);
  return renderSkillRows(ecosystem);
}

function renderSkillRows(ecosystem) {
  const skills = ecosystem.skills.skills.slice(0, 80);
  if (!skills.length) return `<p class="muted ecosystem-empty">还没有读取到 Skills。</p>`;
  return `
    <div class="ecosystem-list">
      ${skills.map((skill) => `
        <div class="ecosystem-row">
          <span class="setting-icon">${icon("sparkles")}</span>
          <span>
            <strong>${escapeHtml(skill.displayName || skill.name || "Skill")}</strong>
            <small>${escapeHtml(skill.shortDescription || skill.description || skill.path || "")}</small>
          </span>
          <em>${escapeHtml(skill.scope || "user")}</em>
          <button class="ghost-action" type="button" data-skill-toggle="${escapeAttribute(skill.name || "")}" data-skill-enabled="${skill.enabled ? "false" : "true"}">${skill.enabled ? "停用" : "启用"}</button>
        </div>
      `).join("")}
    </div>
    ${ecosystem.skills.errors.length ? `<div class="ecosystem-errors">${escapeHtml(`${ecosystem.skills.errors.length} 个 Skill 读取错误`)}</div>` : ""}
  `;
}

function renderPluginRows(ecosystem) {
  const plugins = ecosystemPlugins(ecosystem).slice(0, 80);
  if (!plugins.length) return `<p class="muted ecosystem-empty">还没有读取到 Plugins。</p>`;
  return `
    <div class="ecosystem-list">
      ${plugins.map((plugin) => `
        <div class="ecosystem-row">
          <span class="setting-icon">${icon("layers")}</span>
          <span>
            <strong>${escapeHtml(plugin.displayName || plugin.name || plugin.id || "Plugin")}</strong>
            <small>${escapeHtml(plugin.shortDescription || plugin.category || plugin.marketplaceName || "")}</small>
          </span>
          <em>${escapeHtml(plugin.installed ? "已安装" : plugin.installPolicy || "可用")}</em>
          <button class="ghost-action" type="button"
            ${plugin.installed ? `data-plugin-uninstall="${escapeAttribute(plugin.id || plugin.name || "")}"` : `data-plugin-install="${escapeAttribute(plugin.name || plugin.id || "")}"`}
            data-plugin-marketplace="${escapeAttribute(plugin.marketplaceName || "")}"
            data-plugin-marketplace-path="${escapeAttribute(plugin.marketplacePath || "")}">
            ${plugin.installed ? "卸载" : "安装"}
          </button>
        </div>
      `).join("")}
    </div>
    ${ecosystem.plugins.marketplaceLoadErrors.length ? `<div class="ecosystem-errors">${escapeHtml(`${ecosystem.plugins.marketplaceLoadErrors.length} 个 Marketplace 读取错误`)}</div>` : ""}
  `;
}

function renderMcpRows(ecosystem) {
  const servers = ecosystem.mcp.slice(0, 80);
  if (!servers.length) return `<p class="muted ecosystem-empty">还没有读取到 MCP server。</p>`;
  return `
    <div class="ecosystem-list">
      ${servers.map((server) => `
        <div class="ecosystem-row">
          <span class="setting-icon">${icon("grid")}</span>
          <span>
            <strong>${escapeHtml(server.name || "MCP")}</strong>
            <small>${escapeHtml(`${server.authStatus || "unknown"} · ${server.toolCount || 0} tools`)}</small>
          </span>
          <em>${server.isEnabled ? "启用" : "停用"}</em>
          <button class="ghost-action" type="button" data-mcp-toggle="${escapeAttribute(server.name || "")}" data-mcp-enabled="${server.isEnabled ? "false" : "true"}">${server.isEnabled ? "停用" : "启用"}</button>
          <button class="ghost-action" type="button" data-mcp-oauth="${escapeAttribute(server.name || "")}">OAuth</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderAppRows(ecosystem) {
  const apps = ecosystem.apps.slice(0, 80);
  if (!apps.length) return `<p class="muted ecosystem-empty">还没有读取到 Apps。</p>`;
  return `
    <div class="ecosystem-list">
      ${apps.map((appInfo) => `
        <div class="ecosystem-row">
          <span class="setting-icon">${icon("panel")}</span>
          <span>
            <strong>${escapeHtml(appInfo.name || appInfo.id || "App")}</strong>
            <small>${escapeHtml(appInfo.description || (Array.isArray(appInfo.pluginDisplayNames) ? appInfo.pluginDisplayNames.join(", ") : ""))}</small>
          </span>
          <em>${appInfo.isEnabled ? "启用" : appInfo.isAccessible ? "可用" : "不可用"}</em>
          <button class="ghost-action" type="button" data-app-toggle="${escapeAttribute(appInfo.id || "")}" data-app-enabled="${appInfo.isEnabled ? "false" : "true"}">${appInfo.isEnabled ? "停用" : "启用"}</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderConfigPanel(ecosystem) {
  return `
    <form class="ecosystem-config-form" id="ecosystem-config-form">
      <label>
        <span>配置路径</span>
        <input name="keyPath" value="${escapeAttribute(ecosystem.configKey)}" placeholder="model_provider 或 mcp_servers.github.enabled">
      </label>
      <label>
        <span>JSON 值</span>
        <textarea name="value" rows="4" placeholder='"third-party" 或 true'>${escapeHtml(ecosystem.configValue)}</textarea>
      </label>
      <div class="action-line">
        <button class="ghost-action" type="submit">写入配置</button>
      </div>
    </form>
  `;
}

function ecosystemPlugins(ecosystem) {
  return ecosystem.plugins.marketplaces.flatMap((marketplace) => (
    Array.isArray(marketplace.plugins)
      ? marketplace.plugins.map((plugin) => ({
        ...plugin,
        marketplaceName: plugin.marketplaceName || marketplace.name || "",
        marketplacePath: plugin.marketplacePath || marketplace.path || null,
      }))
      : []
  ));
}

function sampleSkillNames(ecosystem) {
  return ecosystem.skills.skills.slice(0, 3).map((skill) => skill.displayName || skill.name).filter(Boolean).join(", ");
}

function samplePluginNames(ecosystem) {
  return ecosystemPlugins(ecosystem).slice(0, 3).map((plugin) => plugin.displayName || plugin.name || plugin.id).filter(Boolean).join(", ");
}

function sampleMcpNames(ecosystem) {
  return ecosystem.mcp.slice(0, 3).map((server) => server.name).filter(Boolean).join(", ");
}

function sampleAppNames(ecosystem) {
  return ecosystem.apps.slice(0, 3).map((appInfo) => appInfo.name || appInfo.id).filter(Boolean).join(", ");
}

function remoteCommandButtons() {
  return [
    ["/help", "帮助"],
    ["/status", "状态"],
    ["/model", "当前模型"],
    ["/model ", "切换模型"],
    ["/permissions", "权限"],
    ["/permissions full-access", "完整访问"],
    ["/permissions read-only", "只读"],
    ["/plan ", "计划模式"],
    ["/goal", "目标"],
    ["/goal set ", "设置目标"],
    ["/goal clear", "清除目标"],
    ["/resume ", "恢复 thread"],
    ["/fork ", "Fork thread"],
    ["/mcp", "MCP"],
    ["/skills", "Skills"],
    ["/plugins", "Plugins"],
  ];
}

function renderReports(mobile) {
  return `
    <section class="reports-page workbench-page">
      <header class="settings-head tool-page-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div>
          <h1>产物</h1>
          <p>当前会话输出、报告和可下载文件</p>
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
  if (currentSessionId() || state.artifacts.length || state.artifactLoading || state.artifactError) {
    return renderArtifactPanel("reports");
  }
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
    <section class="admin-page workbench-page">
      <header class="settings-head tool-page-head">
        ${mobile ? `<button class="icon-btn" id="back-to-sessions">${icon("back")}</button>` : ""}
        <div>
          <h1>个人项目</h1>
          <p>个人服务、项目目录和运行维护</p>
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
        <div class="section-kicker">个人服务</div>
        ${renderPersonalAdminSummary(settings)}
        ${settingStatic("站点", settings.siteTitle || state.siteTitle, "link")}
      </section>
      <section class="open-section">
        <div class="section-kicker">项目</div>
        ${renderAdminProjectForm()}
        ${state.admin.projects.length ? state.admin.projects.map((project) => `
          ${renderAdminProjectForm(project)}
        `).join("") : `<p class="muted">暂无项目。当前是个人模式，可以直接创建默认会话。</p>`}
      </section>
    </div>
  `;
}

function renderPersonalAdminSummary(settings) {
  const mode = "个人使用";
  return `
    <div class="admin-project-form admin-system-form">
      <div class="admin-form-head">
        <span>
          <strong>访问模式</strong>
          <small>${escapeHtml(mode)}</small>
        </span>
        <span class="status-badge green">简化</span>
      </div>
    </div>
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
          <small>${escapeHtml(isExisting ? (enabled ? "启用" : "停用") : "添加一个常用 Codex 工作目录")}</small>
        </span>
        <label class="switch-row">
          <input type="checkbox" name="enabled" ${enabled ? "checked" : ""}>
          <span>启用</span>
        </label>
      </div>
      <div class="admin-form-grid">
        <label>
          <span>项目 ID</span>
          <input name="id" value="${escapeAttribute(id)}" placeholder="自动或 codex-workbench" ${isExisting ? "disabled" : ""}>
        </label>
        <label>
          <span>内部名</span>
          <input name="internalName" value="${escapeAttribute(project?.internalName || "")}" placeholder="codex-workbench">
        </label>
        <label>
          <span>显示名</span>
          <input name="displayName" value="${escapeAttribute(project?.displayName || "")}" placeholder="Codex 工作台">
        </label>
        <label>
          <span>工作目录</span>
          <input name="cwd" value="${escapeAttribute(project?.cwd || "")}" placeholder="/srv/codex-workbench">
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
      <button class="${state.view === "capabilities" ? "active" : ""}" data-mobile-tab="capabilities">${icon("sliders")}<span>工作台</span></button>
      <button class="${state.view === "reports" ? "active" : ""}" data-mobile-tab="reports">${icon("doc")}<span>报告</span></button>
      <button class="${state.view === "settings" ? "active" : ""}" data-mobile-tab="settings">${icon("settings")}<span>设置</span></button>
    </nav>
  `;
}

function bindApp(root = document) {
  const qs = (selector) => root.querySelector?.(selector) || null;
  const qsa = (selector) => Array.from(root.querySelectorAll?.(selector) || []);

  qs("#open-settings")?.addEventListener("click", () => {
    setView("settings");
  });
  qs("#back-to-sessions")?.addEventListener("click", () => {
    state.view = "sessions";
    renderWorkspaceOnly() || render();
  });
  qs("#new-session-button")?.addEventListener("click", openNewSession);
  qs("#empty-new-session-button")?.addEventListener("click", openNewSession);
  qs("#refresh-session")?.addEventListener("click", () => refreshCurrentSession());
  qs("#share-session")?.addEventListener("click", shareCurrentSession);
  qs("#toggle-session-tools")?.addEventListener("click", () => {
    state.sessionToolsOpen = !state.sessionToolsOpen;
    render();
  });
  qs("#toggle-workspace")?.addEventListener("click", toggleWorkspaceInspector);
  qs("#refresh-workspace")?.addEventListener("click", () => refreshWorkspaceInspector());
  qs("#show-more-timeline")?.addEventListener("click", showMoreTimelineHistory);
  qs("#session-settings-form")?.addEventListener("submit", saveSessionSettings);
  qs("#save-session-settings")?.addEventListener("click", saveSessionSettings);
  qs("#session-favorite")?.addEventListener("click", () => {
    const sessionId = state.currentSession?.id || state.sessionId;
    if (sessionId) toggleFavorite(sessionId);
  });
  qs("#session-archive")?.addEventListener("click", () => {
    const sessionId = state.currentSession?.id || state.sessionId;
    if (sessionId) toggleArchive(sessionId);
  });
  qs("#cap-new-session")?.addEventListener("click", openNewSession);
  qs("#refresh-reports")?.addEventListener("click", () => refreshReports());
  qs("[data-refresh-artifacts]")?.addEventListener("click", () => refreshArtifacts());
  qs("#refresh-admin")?.addEventListener("click", () => refreshAdmin());
  qs("#refresh-ecosystem")?.addEventListener("click", () => refreshEcosystem());
  qs("#ecosystem-config-form")?.addEventListener("submit", writeEcosystemConfig);
  for (const form of qsa("[data-admin-project-form]")) {
    form.addEventListener("submit", saveAdminProject);
  }
  qs("#refresh-usage")?.addEventListener("click", () => refreshUsage());
  qs("#refresh-runtime-health")?.addEventListener("click", () => refreshRuntimeHealth());
  qs("#refresh-diagnostics")?.addEventListener("click", () => refreshDiagnostics());
  qs("#refresh-security")?.addEventListener("click", () => refreshSecurityState());
  qs("#reload-runtime")?.addEventListener("click", reloadRuntime);
  qs("#logout-button")?.addEventListener("click", logout);
  qs("#clear-cache")?.addEventListener("click", clearLocalCache);
  qs("#settings-form")?.addEventListener("submit", saveSettingsForm);
  for (const button of qsa("[data-revoke-auth-session]")) {
    button.addEventListener("click", () => revokeAuthSession(button.getAttribute("data-revoke-auth-session") || ""));
  }
  qs("#attach-button")?.addEventListener("click", () => qs("#file-input")?.click());
  qs("#file-input")?.addEventListener("change", (event) => {
    state.selectedFiles = [...state.selectedFiles, ...Array.from(event.target.files || [])].slice(0, 8);
    render();
  });

  const search = qs("#session-search");
  search?.addEventListener("input", handleSessionSearchInput);
  for (const button of qsa("[data-filter]")) {
    button.addEventListener("click", async () => {
      state.sortMode = button.getAttribute("data-filter") || "all";
      await refreshSessions();
    });
  }
  for (const button of qsa("[data-view]")) {
    button.addEventListener("click", () => setView(button.getAttribute("data-view") || "sessions"));
  }
  for (const button of qsa("[data-capability-target]")) {
    button.addEventListener("click", async () => {
      const target = button.getAttribute("data-capability-target") || "sessions";
      if (target === "chat") {
        state.sessionToolsOpen = false;
        state.view = state.currentSession || state.sessionId ? "chat" : "sessions";
        renderWorkspaceOnly() || render();
        return;
      }
      if (target === "projects") {
        state.view = "capabilities";
        renderWorkspaceOnly() || render();
        if (!state.admin.settings && !state.adminLoading) await refreshAdmin({ silent: true });
        requestAnimationFrame(() => document.querySelector("#personal-projects-panel")?.scrollIntoView?.({ block: "start" }));
        return;
      }
      setView(target);
    });
  }
  bindSessionListActions(root);
  for (const button of qsa("[data-report-open]")) {
    button.addEventListener("click", () => selectReport(button.getAttribute("data-report-open") || ""));
  }
  for (const link of qsa("[data-report-path]")) {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      openReportByPath(link.getAttribute("data-report-path") || "");
    });
  }
  for (const button of qsa("[data-report-favorite]")) {
    button.addEventListener("click", () => toggleReportFavorite(button.getAttribute("data-report-favorite") || ""));
  }
  for (const button of qsa("[data-artifact-open]")) {
    button.addEventListener("click", () => selectArtifact(button.getAttribute("data-artifact-open") || ""));
  }
  for (const button of qsa("[data-artifact-favorite]")) {
    button.addEventListener("click", () => toggleArtifactFavorite(button.getAttribute("data-artifact-favorite") || ""));
  }
  for (const button of qsa("[data-artifact-download]")) {
    button.addEventListener("click", () => downloadArtifact(button.getAttribute("data-artifact-download") || ""));
  }
  for (const button of qsa("[data-workspace-file]")) {
    button.addEventListener("click", () => openWorkspaceFile(button.getAttribute("data-workspace-file") || ""));
  }
  qs("#terminal-form")?.addEventListener("submit", runTerminalCommand);
  qs("#terminal-command")?.addEventListener("input", (event) => {
    state.terminalCommand = event.target.value;
  });
  qs("#stop-terminal")?.addEventListener("click", stopTerminalCommand);
  qs("#clear-terminal")?.addEventListener("click", clearTerminalOutput);
  qs("#copy-terminal-output")?.addEventListener("click", copyTerminalOutput);
  qs("#append-terminal-output")?.addEventListener("click", appendTerminalOutputToPrompt);
  for (const button of qsa("[data-remove-file]")) {
    button.addEventListener("click", () => {
      const index = Number(button.getAttribute("data-remove-file"));
      state.selectedFiles.splice(index, 1);
      render();
    });
  }
  for (const button of qsa("[data-approval]")) {
    button.addEventListener("click", () => resolveApproval(
      button.getAttribute("data-approval") || "",
      button.getAttribute("data-approval-action") || "deny",
    ));
  }
  for (const button of qsa("[data-mobile-tab]")) {
    button.addEventListener("click", () => {
      const tab = button.getAttribute("data-mobile-tab");
      if (tab === "new") return openNewSession();
      setView(tab || "sessions");
    });
  }
  for (const button of qsa("[data-quick]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const text = button.getAttribute("data-quick") || "";
      const nextPrompt = state.prompt ? `${state.prompt}\n${text}` : text;
      const input = button.closest("#composer-form")?.querySelector("#prompt-input") || document.querySelector("#prompt-input");
      if (!setPromptDraft(nextPrompt, { focus: true, input })) {
        render();
        focusPromptEnd();
      }
    });
  }
  for (const button of qsa("[data-command]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      insertCommand(button.getAttribute("data-command") || "", {
        input: button.closest("#composer-form")?.querySelector("#prompt-input") || null,
      });
    });
  }
  for (const button of qsa("[data-context-package-action]")) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleContextPackageAction(button.getAttribute("data-context-package-action") || "insert");
    });
  }
  for (const button of qsa("[data-copy-text]")) {
    button.addEventListener("click", async () => {
      await copyText(button.getAttribute("data-copy-text") || "");
      state.notice = "已复制";
      render();
    });
  }
  for (const button of qsa("[data-ecosystem-tab]")) {
    button.addEventListener("click", () => {
      state.ecosystem.tab = button.getAttribute("data-ecosystem-tab") || "skills";
      render();
    });
  }
  for (const button of qsa("[data-skill-toggle]")) {
    button.addEventListener("click", () => toggleSkill(button.getAttribute("data-skill-toggle") || "", button.getAttribute("data-skill-enabled") === "true"));
  }
  for (const button of qsa("[data-app-toggle]")) {
    button.addEventListener("click", () => toggleApp(button.getAttribute("data-app-toggle") || "", button.getAttribute("data-app-enabled") === "true"));
  }
  for (const button of qsa("[data-mcp-toggle]")) {
    button.addEventListener("click", () => toggleMcp(button.getAttribute("data-mcp-toggle") || "", button.getAttribute("data-mcp-enabled") === "true"));
  }
  for (const button of qsa("[data-mcp-oauth]")) {
    button.addEventListener("click", () => startMcpOauth(button.getAttribute("data-mcp-oauth") || ""));
  }
  for (const button of qsa("[data-plugin-install]")) {
    button.addEventListener("click", () => installPluginFromButton(button));
  }
  for (const button of qsa("[data-plugin-uninstall]")) {
    button.addEventListener("click", () => uninstallPlugin(button.getAttribute("data-plugin-uninstall") || ""));
  }
  for (const button of qsa("button[data-theme]")) {
    button.addEventListener("click", () => {
      applyTheme(button.getAttribute("data-theme") || "light", { persist: true });
      render();
    });
  }
  const promptInput = qs("#prompt-input");
  if (promptInput) {
    promptInput.addEventListener('touchstart', syncPromptFocusLayout, { passive: true });
    promptInput.addEventListener('focus', syncPromptFocusLayout);
    promptInput.addEventListener("input", (event) => {
      state.prompt = event.target.value;
      syncPromptInputLayout(event.target);
      updateSendButton();
    });
    promptInput.addEventListener("keydown", handlePromptKeydown);
  }
  qs("#composer-form")?.addEventListener("submit", sendPrompt);
  qs("#send-button")?.addEventListener("click", handleComposerSendClick);
  qs("#queue-message-button")?.addEventListener("click", queueCurrentPrompt);
  for (const button of qsa("[data-remove-queued-message]")) {
    button.addEventListener("click", () => {
      const sessionId = currentQueueSessionId();
      removeQueuedMessage(sessionId, button.getAttribute("data-remove-queued-message") || "");
      render();
    });
  }
  qs("#stop-button")?.addEventListener("click", stopTurn);
  qs("#retry-last")?.addEventListener("click", retryLastUserMessage);
}

function handlePromptKeydown(event) {
  if (event?.key !== "Enter") return;
  if (event.shiftKey || event.altKey || event.isComposing) return;
  event.preventDefault();
  requestComposerSubmit();
}

function handleComposerSendClick(event) {
  event?.preventDefault?.();
  requestComposerSubmit();
}

function requestComposerSubmit() {
  const form = document.querySelector("#composer-form");
  if (typeof form?.requestSubmit === "function") {
    form.requestSubmit();
    return;
  }
  return onComposerSubmit({ preventDefault() {} });
}

function handleSessionSearchInput(event) {
  state.search = event.target.value;
  if (renderSessionSearchResultsOnly()) {
    return;
  }
  render();
}

function renderSessionSearchResultsOnly() {
  if (state.isMobile) {
    const results = document.querySelector("#mobile-session-results");
    if (!results) return false;
    results.innerHTML = renderSessionList();
    bindSessionListActions(results);
    return true;
  }
  return renderSidebarRecentsOnly();
}

function renderSidebarRecentsOnly() {
  const recents = document.querySelector("#sidebar-recents");
  if (!recents) {
    return false;
  }
  recents.innerHTML = renderSidebarRecentsContent();
  bindSessionListActions(recents);
  return true;
}

function bindSessionListActions(root = document) {
  const queryAll = typeof root.querySelectorAll === "function"
    ? (selector) => root.querySelectorAll(selector)
    : (selector) => document.querySelectorAll(selector);
  for (const button of queryAll("[data-session-open]")) {
    button.addEventListener("click", () => selectSession(button.getAttribute("data-session-open") || ""));
  }
  for (const button of queryAll("[data-favorite]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleFavorite(button.getAttribute("data-favorite") || "");
    });
  }
  for (const button of queryAll("[data-archive]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleArchive(button.getAttribute("data-archive") || "");
    });
  }
}

async function setView(view) {
  state.view = view === "reports" || view === "settings" || view === "capabilities" ? view : "sessions";
  state.notice = "";
  renderWorkspaceOnly() || render();
  if (state.view === "reports") {
    await Promise.all([
      !state.reports.length ? refreshReports({ silent: true }) : null,
      refreshArtifacts({ silent: true }),
    ]);
  }
  if (state.view === "capabilities") {
    await Promise.all([
      !state.ecosystem.loaded && !state.ecosystem.loading ? refreshEcosystem({ silent: true }) : null,
      !state.admin.settings && !state.adminLoading ? refreshAdmin({ silent: true }) : null,
      !state.runtimeHealth && !state.runtimeHealthLoading ? refreshRuntimeHealth({ silent: true }) : null,
    ]);
    return;
  }
  if (state.view === "settings") {
    await Promise.all([
      refreshModels().catch(() => null),
      refreshRuntimeHealth({ silent: true }).catch(() => null),
      refreshDiagnostics({ silent: true }).catch(() => null),
      refreshSecurityState({ silent: true }).catch(() => null),
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

async function refreshRuntimeHealth({ silent = false } = {}) {
  state.runtimeHealthLoading = true;
  if (!silent) {
    state.notice = "正在刷新运行状态";
    render();
  }
  try {
    const payload = await apiFetch("/api/runtime/health");
    state.runtimeHealth = payload?.health || null;
    if (!silent) state.notice = "运行状态已刷新";
  } catch (error) {
    state.runtimeHealth = {
      status: "failed",
      usage: { status: "official_usage_unavailable", required: false },
      message: error?.payload?.message || error?.message || "运行状态读取失败",
    };
    if (!silent) state.notice = state.runtimeHealth.message;
  } finally {
    state.runtimeHealthLoading = false;
    if (!silent) render();
  }
}

async function refreshDiagnostics({ silent = false } = {}) {
  state.diagnosticsLoading = true;
  if (!silent) {
    state.notice = "正在检查系统状态";
    render();
  }
  try {
    const payload = await apiFetch("/api/diagnostics/summary");
    state.diagnostics = payload?.summary || null;
    if (!silent) state.notice = "系统诊断已刷新";
  } catch (error) {
    state.diagnostics = {
      system: { reboot: { required: false, packages: [] }, upgrades: { count: null, status: "unknown" } },
      service: { active: null, enabled: null, name: "codex-web.service" },
      storage: {},
      backup: { latest: null },
      provider: { status: "failed", usage: { status: "unavailable", required: false } },
      error: error?.payload?.message || error?.message || "系统诊断读取失败",
    };
    if (!silent) state.notice = state.diagnostics.error;
  } finally {
    state.diagnosticsLoading = false;
    if (!silent) render();
  }
}

async function refreshSecurityState({ silent = false } = {}) {
  state.securityLoading = true;
  if (!silent) {
    state.notice = "正在刷新安全状态";
    render();
  }
  try {
    const [sessionsPayload, auditPayload] = await Promise.all([
      apiFetch("/api/auth/sessions").catch(() => ({ items: [] })),
      apiFetch("/api/admin/audit?limit=8").catch(() => ({ items: [] })),
    ]);
    state.authSessions = Array.isArray(sessionsPayload?.items) ? sessionsPayload.items : [];
    state.auditItems = Array.isArray(auditPayload?.items) ? auditPayload.items : [];
    if (!silent) state.notice = "安全状态已刷新";
  } catch (error) {
    if (!silent) state.notice = error?.payload?.message || error?.message || "安全状态读取失败";
  } finally {
    state.securityLoading = false;
    if (!silent) render();
  }
}

async function revokeAuthSession(sessionId) {
  const target = String(sessionId || "").trim();
  if (!target) return;
  state.securityLoading = true;
  state.notice = "正在撤销设备";
  render();
  try {
    await apiFetch(`/api/auth/sessions/${encodeURIComponent(target)}`, { method: "DELETE" });
    await refreshSecurityState({ silent: true });
    state.notice = "设备已撤销";
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "设备撤销失败";
  } finally {
    state.securityLoading = false;
    render();
  }
}

async function refreshReports({ silent = false } = {}) {
  state.reportLoading = true;
  if (!silent) render();
  try {
    const payload = await apiFetch("/api/reports");
    state.reports = Array.isArray(payload?.items) ? payload.items : [];
    if (!currentSessionId() && !state.currentReport && state.reports[0]) await selectReport(state.reports[0].id, { silent: true });
  } finally {
    state.reportLoading = false;
    if (silent) renderWorkspaceAfterBackgroundRefresh();
    else renderAfterBackgroundRefresh();
  }
}

async function refreshArtifacts({ silent = false } = {}) {
  const sessionId = currentSessionId();
  if (!sessionId) {
    state.artifacts = [];
    state.currentArtifact = null;
    state.artifactContent = null;
    state.artifactError = "";
    if (!silent) renderArtifactsOnly() || renderWorkspaceOnly() || render();
    return;
  }
  state.artifactLoading = true;
  state.artifactError = "";
  if (!silent) renderArtifactsOnly() || renderWorkspaceOnly() || render();
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`);
    state.artifacts = Array.isArray(payload?.items) ? payload.items : [];
    if (state.currentArtifact && !state.artifacts.some((item) => item.id === state.currentArtifact.id)) {
      state.currentArtifact = null;
      state.artifactContent = null;
    }
    if (!state.currentArtifact && state.artifacts[0]) {
      state.currentArtifact = state.artifacts[0];
      state.artifactContent = null;
    } else if (state.currentArtifact) {
      state.currentArtifact = state.artifacts.find((item) => item.id === state.currentArtifact.id) || state.currentArtifact;
    }
    if (state.currentArtifact?.previewable && state.currentArtifact.kind !== "pdf" && !state.artifactContent) {
      await selectArtifact(state.currentArtifact.id, { silent: true });
    }
  } catch (error) {
    state.artifactError = error?.payload?.message || error?.message || "产物读取失败";
  } finally {
    state.artifactLoading = false;
    renderArtifactsOnly() || (silent ? renderWorkspaceAfterBackgroundRefresh() : renderWorkspaceOnly() || render());
  }
}

async function selectArtifact(artifactId, { silent = false } = {}) {
  const artifact = state.artifacts.find((item) => item.id === artifactId);
  if (!artifact) return;
  state.currentArtifact = artifact;
  state.artifactContent = null;
  state.artifactError = "";
  if (!artifact.previewable || artifact.kind === "download" || artifact.kind === "pdf") {
    renderArtifactsOnly() || renderWorkspaceOnly() || render();
    return;
  }
  state.artifactLoading = true;
  if (!silent) renderArtifactsOnly() || renderWorkspaceOnly() || render();
  try {
    const sessionId = currentSessionId();
    if (!sessionId) return;
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/content`);
    state.currentArtifact = payload?.artifact || artifact;
    state.artifactContent = payload || null;
    state.artifacts = state.artifacts.map((item) => item.id === state.currentArtifact.id ? { ...item, ...state.currentArtifact } : item);
  } catch (error) {
    state.artifactError = error?.payload?.message || error?.message || "产物预览失败";
  } finally {
    state.artifactLoading = false;
    renderArtifactsOnly() || (silent ? renderWorkspaceAfterBackgroundRefresh() : renderWorkspaceOnly() || render());
  }
}

async function toggleArtifactFavorite(artifactId) {
  const artifact = state.artifacts.find((item) => item.id === artifactId) || state.currentArtifact;
  const sessionId = currentSessionId();
  if (!artifact || !sessionId) return;
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/favorite`, {
      method: "PATCH",
      body: { favorite: !artifact.favorite },
    });
    const updated = payload?.artifact;
    if (updated) {
      state.artifacts = state.artifacts.map((item) => item.id === updated.id ? { ...item, ...updated } : item);
      if (state.currentArtifact?.id === updated.id) state.currentArtifact = { ...state.currentArtifact, ...updated };
    }
  } catch (error) {
    state.artifactError = error?.payload?.message || error?.message || "收藏失败";
  }
  renderArtifactsOnly() || renderWorkspaceOnly() || render();
}

async function downloadArtifact(artifactId) {
  const sessionId = currentSessionId();
  const artifact = state.artifacts.find((item) => item.id === artifactId) || state.currentArtifact;
  if (!sessionId || !artifact) return;
  try {
    const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/download`, {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : {},
    });
    if (!response.ok) throw await buildApiError(response);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = artifactFileName(artifact);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    state.artifactError = error?.payload?.message || error?.message || "下载失败";
    renderArtifactsOnly() || renderWorkspaceOnly() || render();
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

async function openReportByPath(reportPath) {
  const path = String(reportPath || "").trim();
  if (!path) return;
  state.view = "reports";
  state.reportLoading = true;
  state.currentReport = {
    id: path,
    title: path.split("/").filter(Boolean).pop() || "报告",
    path,
  };
  state.reportContent = "";
  render();
  try {
    const payload = await apiFetch("/api/reports/resolve", {
      method: "POST",
      body: { path },
    });
    if (payload?.report) {
      state.currentReport = payload.report;
      upsertReport(payload.report);
      await selectReport(payload.report.id, { silent: true });
    }
  } catch (error) {
    state.reportContent = error?.payload?.message || error?.message || "报告打开失败";
  } finally {
    state.reportLoading = false;
    render();
  }
}

async function toggleWorkspaceInspector() {
  state.workspaceOpen = !state.workspaceOpen;
  if (!state.workspaceOpen) {
    render();
    return;
  }
  render();
  await refreshWorkspaceInspector();
}

async function refreshWorkspaceInspector() {
  const sessionId = state.currentSession?.id || state.sessionId;
  if (!sessionId) return;
  state.workspaceLoading = true;
  state.workspaceError = "";
  render();
  try {
    const [statusPayload, diffPayload, artifactsPayload] = await Promise.all([
      apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/status`),
      apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/diff`),
      apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/artifacts`).catch((error) => {
        state.artifactError = error?.payload?.message || error?.message || "产物读取失败";
        return null;
      }),
    ]);
    state.workspaceStatus = statusPayload?.status || null;
    state.workspaceDiff = diffPayload?.diff || null;
    if (artifactsPayload) {
      state.artifacts = Array.isArray(artifactsPayload?.items) ? artifactsPayload.items : [];
      if (state.currentArtifact && !state.artifacts.some((item) => item.id === state.currentArtifact.id)) {
        state.currentArtifact = null;
        state.artifactContent = null;
      }
      if (!state.currentArtifact && state.artifacts[0]) state.currentArtifact = state.artifacts[0];
    }
  } catch (error) {
    state.workspaceError = error?.payload?.message || error?.message || "工作区读取失败";
  } finally {
    state.workspaceLoading = false;
    renderAfterBackgroundRefresh();
  }
}

async function loadSessionContextPackage() {
  const sessionId = currentSessionId();
  const preserveFocusedPrompt = isPromptInputFocused();
  if (!sessionId) {
    state.notice = "请先打开一个会话再生成交接包";
    if (!preserveFocusedPrompt && !isFormControlInteractionActive()) render();
    return null;
  }
  state.contextPackageLoading = true;
  state.notice = "正在生成交接包";
  if (!preserveFocusedPrompt && !isFormControlInteractionActive()) renderWorkspaceOnly() || render();
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/context-package`);
    return payload?.package || null;
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "交接包生成失败";
    state.error = state.notice;
    return null;
  } finally {
    state.contextPackageLoading = false;
    if (!preserveFocusedPrompt && !isFormControlInteractionActive()) renderWorkspaceOnly() || render();
  }
}

async function handleContextPackageAction(action = "insert") {
  const activeInput = document.querySelector("#prompt-input");
  const contextPackage = await loadSessionContextPackage();
  const markdown = String(contextPackage?.markdown || "").trim();
  if (!markdown) return;
  if (action === "copy") {
    await copyText(`${markdown}\n`);
    state.notice = "交接包已复制";
    renderAfterBackgroundRefresh();
    return;
  }
  if (action === "new") {
    await openNewSession();
    const prompt = `请基于这个交接包继续当前工作：\n\n${markdown}\n`;
    if (!setPromptDraft(prompt, { focus: true })) {
      state.prompt = prompt;
      render({ preserveComposer: false });
      focusPromptEnd();
    }
    state.notice = "已创建新会话草稿";
    return;
  }
  insertContextPackageMarkdown(markdown, activeInput);
  state.notice = "交接包已插入输入框";
}

function insertContextPackageMarkdown(markdown, input = null) {
  const existing = String(input?.value || state.prompt || "").trim();
  const nextPrompt = existing ? `${existing}\n\n${markdown}\n` : `${markdown}\n`;
  if (setPromptDraft(nextPrompt, { focus: true, input })) {
    return;
  }
  state.prompt = nextPrompt;
  render({ preserveComposer: false });
  focusPromptEnd();
}

async function openWorkspaceFile(filePath) {
  const sessionId = state.currentSession?.id || state.sessionId;
  const pathValue = String(filePath || "").trim();
  if (!sessionId || !pathValue) return;
  state.workspaceLoading = true;
  state.workspaceError = "";
  render();
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/workspace/files?path=${encodeURIComponent(pathValue)}`);
    state.workspaceFile = payload?.file || null;
  } catch (error) {
    state.workspaceError = error?.payload?.message || error?.message || "文件读取失败";
  } finally {
    state.workspaceLoading = false;
    renderAfterBackgroundRefresh();
  }
}

async function runTerminalCommand(event) {
  event?.preventDefault?.();
  const sessionId = state.currentSession?.id || state.sessionId;
  const input = event?.currentTarget?.querySelector?.("#terminal-command") || document.querySelector("#terminal-command");
  const command = String(input?.value || state.terminalCommand || "").trim();
  state.terminalCommand = command;
  if (!sessionId) {
    state.terminalError = "请先打开一个会话。";
    renderTerminalOnly();
    return;
  }
  if (!command) {
    state.terminalError = "请输入要运行的命令。";
    renderTerminalOnly();
    return;
  }
  stopTerminalStream({ clearCursor: true });
  state.terminalLoading = true;
  state.terminalError = "";
  state.terminalOutput = "";
  state.terminalCurrent = { status: "starting" };
  renderTerminalOnly();
  try {
    const payload = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/terminal`, {
      method: "POST",
      body: { command },
    });
    state.terminalCurrent = payload?.terminal || null;
    state.terminalLoading = false;
    renderTerminalOnly();
    if (payload?.terminal?.id) {
      void streamTerminalEvents(payload.terminal.id);
    }
  } catch (error) {
    state.terminalLoading = false;
    state.terminalCurrent = null;
    state.terminalError = error?.payload?.message || error?.message || "命令启动失败";
    renderTerminalOnly();
  }
}

async function stopTerminalCommand() {
  const terminalId = state.terminalCurrent?.id;
  if (!terminalId) return;
  state.terminalLoading = true;
  renderTerminalOnly();
  try {
    const payload = await apiFetch(`/api/terminals/${encodeURIComponent(terminalId)}/stop`, { method: "POST" });
    if (payload?.terminal) {
      state.terminalCurrent = {
        ...state.terminalCurrent,
        ...payload.terminal,
      };
    }
    appendTerminalOutput("\n[stop requested]\n");
  } catch (error) {
    state.terminalError = error?.payload?.message || error?.message || "停止命令失败";
  } finally {
    state.terminalLoading = false;
    renderTerminalOnly();
  }
}

function clearTerminalOutput() {
  state.terminalOutput = "";
  state.terminalError = "";
  renderTerminalOnly();
}

async function copyTerminalOutput() {
  const output = state.terminalOutput.trim();
  if (!output) return;
  await copyText(output);
}

function appendTerminalOutputToPrompt() {
  const output = state.terminalOutput.trim();
  if (!output) return;
  const text = output.length > 6000 ? output.slice(-6000) : output;
  const next = state.prompt
    ? `${state.prompt}\n\n终端输出:\n${text}`
    : `终端输出:\n${text}`;
  if (!setPromptDraft(next, { focus: true })) {
    render();
    focusPromptEnd();
  }
}

function renderArtifactsOnly() {
  const panels = Array.from(document.querySelectorAll("[data-artifact-panel]"));
  if (!panels.length) {
    return false;
  }
  for (const panel of panels) {
    const context = panel.getAttribute("data-artifact-panel") || "workspace";
    const wrapper = document.createElement("div");
    wrapper.innerHTML = renderArtifactPanel(context).trim();
    const nextPanel = wrapper.firstElementChild;
    if (!nextPanel) continue;
    panel.replaceWith(nextPanel);
    bindApp(nextPanel);
  }
  return true;
}

function renderTerminalOnly() {
  const panel = document.querySelector(".workspace-terminal");
  if (!panel) {
    return renderWorkspaceOnly() || render();
  }
  const wrapper = document.createElement("div");
  wrapper.innerHTML = renderWorkspaceTerminalPanel().trim();
  const nextPanel = wrapper.firstElementChild;
  if (!nextPanel) {
    return false;
  }
  panel.replaceWith(nextPanel);
  bindApp(nextPanel);
  syncTerminalOutputScroll();
  return true;
}

function stopTerminalStream({ clearCursor = false } = {}) {
  if (state.terminalAbortController) {
    state.terminalAbortController.abort();
    state.terminalAbortController = null;
  }
  if (clearCursor) {
    state.lastTerminalEventSequence = null;
  }
}

function resetTerminalState() {
  stopTerminalStream({ clearCursor: true });
  state.terminalCurrent = null;
  state.terminalOutput = "";
  state.terminalError = "";
  state.terminalLoading = false;
}

function resetArtifactState() {
  state.artifacts = [];
  state.currentArtifact = null;
  state.artifactContent = null;
  state.artifactLoading = false;
  state.artifactError = "";
}

async function streamTerminalEvents(terminalId) {
  stopTerminalStream();
  const controller = new AbortController();
  state.terminalAbortController = controller;
  try {
    const after = state.lastTerminalEventSequence
      ? `?after=${encodeURIComponent(String(state.lastTerminalEventSequence))}`
      : "";
    const response = await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/events${after}`, {
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
        processTerminalSseFrame(frame);
        boundary = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) processTerminalSseFrame(buffer);
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error?.status === 401) {
      handleApiError(error, { auth: true });
      return;
    }
    state.terminalError = error?.payload?.message || error?.message || "终端输出读取失败";
    renderTerminalOnly();
  } finally {
    if (state.terminalAbortController === controller) {
      state.terminalAbortController = null;
    }
  }
}

function processTerminalSseFrame(frame) {
  const lines = frame.split(/\r?\n/u);
  let eventName = "message";
  const data = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    if (line.startsWith("id:")) state.lastTerminalEventSequence = line.slice(3).trim();
  }
  if (eventName !== "message" || !data.length) return;
  try {
    applyTerminalEvent(JSON.parse(data.join("\n")));
  } catch (_error) {
  }
}

function applyTerminalEvent(event) {
  if (!event || typeof event !== "object") return;
  if (event.type === "started") {
    state.terminalCurrent = {
      ...(state.terminalCurrent || {}),
      id: event.terminalId,
      sessionId: event.sessionId,
      cwd: event.cwd,
      command: event.command,
      status: "running",
    };
    state.terminalLoading = false;
    appendTerminalOutput(`$ ${event.command}\n`);
    renderTerminalOnly();
    return;
  }
  if (event.type === "output") {
    appendTerminalOutput(event.text || "");
    return;
  }
  if (event.type === "input") {
    return;
  }
  if (event.type === "error") {
    state.terminalError = event.message || "终端错误";
    state.terminalCurrent = { ...(state.terminalCurrent || {}), status: "failed" };
    renderTerminalOnly();
    return;
  }
  if (event.type === "exit") {
    state.terminalCurrent = {
      ...(state.terminalCurrent || {}),
      status: event.status || "completed",
      exitCode: event.exitCode,
      signal: event.signal,
    };
    appendTerminalOutput(`\n[${event.status || "completed"}${event.exitCode === null || event.exitCode === undefined ? "" : `: ${event.exitCode}`}]\n`);
    renderTerminalOnly();
  }
}

function appendTerminalOutput(text) {
  if (!text) return;
  state.terminalOutput = limitTerminalOutput(`${state.terminalOutput || ""}${String(text)}`);
  const code = document.querySelector("#terminal-output code");
  if (code) {
    code.textContent = state.terminalOutput || "命令输出会显示在这里。";
    syncTerminalOutputScroll();
  }
}

function limitTerminalOutput(value) {
  const text = String(value || "");
  if (text.length <= TERMINAL_OUTPUT_LIMIT) return text;
  const hidden = text.length - TERMINAL_OUTPUT_LIMIT;
  return `[已截断前 ${hidden} 字]\n${text.slice(-TERMINAL_OUTPUT_LIMIT)}`;
}

function syncTerminalOutputScroll() {
  const output = document.querySelector("#terminal-output");
  if (output) output.scrollTop = output.scrollHeight;
}

async function refreshAdmin({ silent = false } = {}) {
  state.adminLoading = true;
  if (!silent) render();
  try {
    const [settings, projects] = await Promise.all([
      apiFetch("/api/admin/settings").catch(() => null),
      apiFetch("/api/admin/projects").catch(() => ({ items: [] })),
    ]);
    state.admin = {
      settings: settings?.settings || null,
      projects: Array.isArray(projects?.items) ? projects.items : [],
      roles: [],
      users: [],
    };
  } finally {
    state.adminLoading = false;
    renderWorkspaceAfterBackgroundRefresh();
  }
}

async function refreshEcosystem({ silent = false } = {}) {
  const query = ecosystemCwdQuery();
  state.ecosystem.loading = true;
  state.ecosystem.error = "";
  if (!silent) render();
  try {
    const [skills, plugins, apps, mcp] = await Promise.all([
      apiFetch(`/api/skills${query}${query ? "&" : "?"}forceReload=${silent ? "false" : "true"}`),
      apiFetch(`/api/plugins${query}`),
      apiFetch("/api/apps"),
      apiFetch("/api/mcp"),
    ]);
    state.ecosystem = {
      ...state.ecosystem,
      loading: false,
      loaded: true,
      skills: {
        cwd: skills?.cwd || null,
        skills: Array.isArray(skills?.skills) ? skills.skills : [],
        errors: Array.isArray(skills?.errors) ? skills.errors : [],
      },
      plugins: {
        featuredPluginIds: Array.isArray(plugins?.featuredPluginIds) ? plugins.featuredPluginIds : [],
        marketplaceLoadErrors: Array.isArray(plugins?.marketplaceLoadErrors) ? plugins.marketplaceLoadErrors : [],
        marketplaces: Array.isArray(plugins?.marketplaces) ? plugins.marketplaces : [],
      },
      apps: Array.isArray(apps?.items) ? apps.items : [],
      mcp: Array.isArray(mcp?.items) ? mcp.items : [],
      error: "",
    };
  } catch (error) {
    state.ecosystem.loading = false;
    state.ecosystem.error = error?.payload?.message || error?.message || "生态信息读取失败";
  } finally {
    if (silent) renderWorkspaceAfterBackgroundRefresh();
    else render();
  }
}

function ecosystemCwdQuery() {
  const cwd = String(state.currentSession?.cwd || state.defaultCwd || "").trim();
  return cwd ? `?cwd=${encodeURIComponent(cwd)}` : "";
}

async function toggleSkill(name, enabled) {
  if (!name) return;
  state.notice = "";
  try {
    await apiFetch("/api/skills", { method: "PATCH", body: { name, enabled } });
    state.notice = enabled ? "Skill 已启用" : "Skill 已停用";
    await refreshEcosystem({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "Skill 更新失败";
    render();
  }
}

async function toggleApp(appId, enabled) {
  if (!appId) return;
  state.notice = "";
  try {
    await apiFetch("/api/apps", { method: "PATCH", body: { appId, enabled } });
    state.notice = enabled ? "App 已启用" : "App 已停用";
    await refreshEcosystem({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "App 更新失败";
    render();
  }
}

async function toggleMcp(name, enabled) {
  if (!name) return;
  state.notice = "";
  try {
    await apiFetch("/api/mcp", { method: "PATCH", body: { name, enabled } });
    state.notice = enabled ? "MCP 已启用" : "MCP 已停用";
    await refreshEcosystem({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "MCP 更新失败";
    render();
  }
}

async function startMcpOauth(name) {
  if (!name) return;
  state.notice = "";
  try {
    const payload = await apiFetch(`/api/mcp/${encodeURIComponent(name)}/oauth/start`, { method: "POST", body: {} });
    state.ecosystem.oauthUrl = payload?.authorizationUrl || "";
    state.notice = state.ecosystem.oauthUrl ? "OAuth 链接已生成" : "OAuth 已启动";
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "OAuth 启动失败";
  }
  render();
}

async function installPluginFromButton(button) {
  const pluginName = button.getAttribute("data-plugin-install") || "";
  if (!pluginName) return;
  const marketplaceName = button.getAttribute("data-plugin-marketplace") || null;
  const marketplacePath = button.getAttribute("data-plugin-marketplace-path") || null;
  state.notice = "";
  try {
    const payload = await apiFetch(`/api/plugins/${encodeURIComponent(pluginName)}/install`, {
      method: "POST",
      body: { marketplaceName, marketplacePath },
    });
    const authCount = Array.isArray(payload?.appsNeedingAuth) ? payload.appsNeedingAuth.length : 0;
    state.notice = authCount ? `插件已安装，${authCount} 个 App 需要授权` : "插件已安装";
    await refreshEcosystem({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "插件安装失败";
    render();
  }
}

async function uninstallPlugin(pluginId) {
  if (!pluginId) return;
  state.notice = "";
  try {
    await apiFetch(`/api/plugins/${encodeURIComponent(pluginId)}/uninstall`, { method: "POST" });
    state.notice = "插件已卸载";
    await refreshEcosystem({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "插件卸载失败";
    render();
  }
}

async function writeEcosystemConfig(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const keyPath = String(data.get("keyPath") || "").trim();
  const rawValue = String(data.get("value") || "").trim();
  state.ecosystem.configKey = keyPath;
  state.ecosystem.configValue = rawValue;
  if (!keyPath) {
    state.notice = "配置路径不能为空";
    render();
    return;
  }
  let value = rawValue;
  if (rawValue) {
    try {
      value = JSON.parse(rawValue);
    } catch (_error) {
      value = rawValue;
    }
  }
  try {
    await apiFetch("/api/config/value", {
      method: "POST",
      body: { keyPath, value, mergeStrategy: "upsert" },
    });
    state.notice = "配置已写入";
    await refreshEcosystem({ silent: true });
  } catch (error) {
    state.notice = error?.payload?.message || error?.message || "配置写入失败";
    render();
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
    else renderSessionListsAfterBackgroundRefresh();
  }
}

async function selectSession(sessionId) {
  const cached = state.sessions.find((session) => session.id === sessionId) || null;
  state.draftSessionActive = false;
  state.sessionId = sessionId;
  state.currentSession = cached;
  resetTimelineRenderLimit();
  state.timeline = cached ? hydrateTimelineFromSession(cached) : [];
  state.view = state.isMobile ? "chat" : "sessions";
  state.status = "Loading session";
  state.statusTone = "warn";
  stopStream();
  resetTerminalState();
  resetArtifactState();
  render();
  await refreshCurrentSession();
  void refreshArtifacts({ silent: true });
}

async function refreshCurrentSession({ silent = false } = {}) {
  if (!state.sessionId) return null;
  if (!silent) {
    state.status = "Loading session";
    state.statusTone = "warn";
  }
  return refreshCurrentSessionMetadata({ hydrateTimeline: true, silent });
}

async function refreshCurrentSessionMetadata(options = {}) {
  const shouldHydrateTimeline = options.hydrateTimeline === true;
  if (!state.sessionId) return null;
  const payload = await apiFetch(`/api/sessions/${encodeURIComponent(state.sessionId)}`);
  if (payload?.session) {
    upsertSession(payload.session);
    state.currentSession = payload.session;
    if (shouldHydrateTimeline) {
      state.timeline = hydrateTimelineFromSession(payload.session);
    }
    const active = findActiveTurn(payload.session);
    if (active?.id) {
      state.pendingTurn = true;
      state.turnId = active.id;
      state.status = "Turn running";
      state.statusTone = "warn";
      if (!isTurnStreamHealthy()) {
        void streamTurnEvents(active.id, { forceReconnect: true });
      }
    } else {
      state.pendingTurn = false;
      state.turnId = null;
      state.streamWasBackgrounded = false;
      state.status = statusFromSession(payload.session).status;
      state.statusTone = statusFromSession(payload.session).tone;
      stopStream(false);
    }
  }
  if (options.viewportSnapshot?.shouldFollowLatest || state.timelineShouldFollowLatest) {
    state.timelineShouldFollowLatest = true;
  }
  renderAfterBackgroundRefresh();
  scrollTimelineToBottomIfFollowingLatest();
  return payload?.session || null;
}

async function refreshCurrentView() {
  if (state.view === "chat" && state.sessionId) {
    return refreshCurrentSessionMetadata({ hydrateTimeline: true });
  }
  if (state.view === "reports") {
    return refreshReports();
  }
  if (state.view === "admin") {
    return refreshAdmin();
  }
  return refreshSessions({ silent: true });
}

function connectWorkspaceEvents({ forceReconnect = false } = {}) {
  if (!state.token) return Promise.resolve();
  if (
    !forceReconnect
    && state.workspaceAbortController
    && !state.workspaceAbortController.signal.aborted
  ) {
    return Promise.resolve();
  }
  stopWorkspaceEvents();
  const controller = new AbortController();
  state.workspaceAbortController = controller;
  const stream = readWorkspaceSse(controller)
    .catch((error) => {
      if (controller.signal.aborted) return;
      if (error?.status === 401) {
        handleApiError(error, { auth: true });
        return;
      }
      scheduleWorkspaceReconnect();
    })
    .then(() => {
      if (!controller.signal.aborted) {
        scheduleWorkspaceReconnect();
      }
    });
  return stream;
}

function scheduleWorkspaceEventsConnect(options = {}) {
  if (!state.token) return;
  const connectAfterQuietPeriod = () => {
    if (workspaceEventsDeferredTimer) clearTimeout(workspaceEventsDeferredTimer);
    workspaceEventsDeferredTimer = setTimeout(() => {
      workspaceEventsDeferredTimer = null;
      connectWorkspaceEvents(options);
    }, 350);
  };
  if (document.readyState === "complete") {
    connectAfterQuietPeriod();
    return;
  }
  if (workspaceEventsConnectAfterLoadAttached) return;
  workspaceEventsConnectAfterLoadAttached = true;
  window.addEventListener("load", () => {
    workspaceEventsConnectAfterLoadAttached = false;
    connectAfterQuietPeriod();
  }, { once: true });
}

function stopWorkspaceEvents({ clearCursor = false } = {}) {
  if (workspaceEventsDeferredTimer) {
    clearTimeout(workspaceEventsDeferredTimer);
    workspaceEventsDeferredTimer = null;
  }
  if (state.workspaceReconnectTimer) {
    clearTimeout(state.workspaceReconnectTimer);
    state.workspaceReconnectTimer = null;
  }
  if (state.workspaceAbortController) {
    state.workspaceAbortController.abort();
    state.workspaceAbortController = null;
  }
  if (clearCursor) {
    state.lastWorkspaceEventSequence = null;
  }
}

function scheduleWorkspaceReconnect() {
  if (!state.token || state.workspaceReconnectTimer) return;
  state.workspaceReconnectTimer = setTimeout(() => {
    state.workspaceReconnectTimer = null;
    connectWorkspaceEvents({ forceReconnect: true });
  }, 1000);
  if (typeof state.workspaceReconnectTimer?.unref === "function") {
    state.workspaceReconnectTimer.unref();
  }
}

async function readWorkspaceSse(controller) {
  const after = state.lastWorkspaceEventSequence
    ? `?after=${encodeURIComponent(String(state.lastWorkspaceEventSequence))}`
    : "";
  const response = await fetch(`/api/workspace/events${after}`, {
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
      processWorkspaceSseFrame(frame);
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) processWorkspaceSseFrame(buffer);
}

function processWorkspaceSseFrame(frame) {
  const lines = frame.split(/\r?\n/u);
  let eventName = "message";
  const data = [];
  for (const line of lines) {
    if (line.startsWith("event:")) eventName = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    if (line.startsWith("id:")) state.lastWorkspaceEventSequence = line.slice(3).trim();
  }
  if (eventName !== "message" || !data.length) return;
  try {
    void applyWorkspaceEvent(JSON.parse(data.join("\n")));
  } catch (_error) {
  }
}

function applyWorkspaceEvent(event) {
  if (!event || typeof event !== "object") return Promise.resolve([]);
  if (event.sequence) state.lastWorkspaceEventSequence = event.sequence;
  const eventSessionId = event.sessionId || event.threadId || "";
  return enqueueWorkspaceRefresh({
    sessions: shouldRefreshSessionsForWorkspaceEvent(event),
    currentSessionId: eventSessionId && state.sessionId && eventSessionId === state.sessionId
      ? state.sessionId
      : "",
    reports: event.type === "report.updated" && (state.view === "reports" || state.currentReport),
  });
}

function enqueueWorkspaceRefresh({ sessions = false, currentSessionId = "", reports = false } = {}) {
  if (sessions) workspaceRefreshQueue.sessions = true;
  if (currentSessionId) workspaceRefreshQueue.currentSessionIds.add(currentSessionId);
  if (reports) workspaceRefreshQueue.reports = true;
  if (!workspaceRefreshQueue.promise) {
    workspaceRefreshQueue.promise = new Promise((resolve) => {
      workspaceRefreshQueue.resolve = resolve;
    });
  }
  if (!workspaceRefreshQueue.scheduled) {
    workspaceRefreshQueue.scheduled = true;
    Promise.resolve().then(flushWorkspaceRefreshQueue);
  }
  return workspaceRefreshQueue.promise;
}

async function flushWorkspaceRefreshQueue() {
  workspaceRefreshQueue.scheduled = false;
  const refreshSessionsNeeded = workspaceRefreshQueue.sessions;
  const refreshCurrentSessionIds = new Set(workspaceRefreshQueue.currentSessionIds);
  const refreshReportsNeeded = workspaceRefreshQueue.reports;
  const resolve = workspaceRefreshQueue.resolve;
  workspaceRefreshQueue.sessions = false;
  workspaceRefreshQueue.currentSessionIds.clear();
  workspaceRefreshQueue.reports = false;
  workspaceRefreshQueue.promise = null;
  workspaceRefreshQueue.resolve = null;

  const refreshes = [];
  if (refreshSessionsNeeded) {
    refreshes.push(refreshSessions({ silent: true }).catch(() => null));
  }
  if (state.sessionId && refreshCurrentSessionIds.has(state.sessionId)) {
    refreshes.push(refreshCurrentSessionMetadata({ hydrateTimeline: true }).catch(() => null));
  }
  if (refreshReportsNeeded) {
    refreshes.push(refreshReports().catch(() => null));
  }
  const results = await Promise.all(refreshes);
  resolve?.(results);
}

function shouldRefreshSessionsForWorkspaceEvent(event) {
  return event.type === "session.created"
    || event.type === "session.updated"
    || event.type === "session.archived"
    || event.type === "session.unarchived"
    || event.type === "session.favorite.updated"
    || event.type === "turn.started"
    || event.type === "turn.completed"
    || event.type === "turn.failed"
    || event.type === "approval.requested"
    || event.type === "approval.resolved";
}

function onVisibilityChange() {
  if (document.visibilityState === "hidden") {
    state.lastTimelineViewportSnapshot = captureTimelineViewport();
    if (state.pendingTurn && state.turnId) {
      state.streamWasBackgrounded = true;
    }
    return;
  }
  if (document.visibilityState === "visible") {
    onPageResume();
  }
}

function onPageResume() {
  if (!state.token && !state.authSession) return;
  if (pageResumeRecoveryTimer) clearTimeout(pageResumeRecoveryTimer);
  pageResumeRecoveryTimer = setTimeout(() => {
    pageResumeRecoveryTimer = null;
    if (!state.token && !state.authSession) return;
    if (isFormControlInteractionActive()) return;
    void recoverActiveTurnAfterForeground();
  }, 160);
}

function isTurnStreamHealthy() {
  if (!state.pendingTurn || !state.turnId || !state.streamAbortController) return false;
  if (state.streamAbortController.signal.aborted) return false;
  if (state.streamWasBackgrounded) return false;
  return Date.now() - (state.streamLastEventAt || state.streamStartedAt || 0) < 45_000;
}

async function recoverActiveTurnAfterForeground() {
  if (!state.sessionId) {
    await refreshSessions({ silent: true }).catch(() => null);
    return;
  }
  const viewportSnapshot = state.lastTimelineViewportSnapshot || captureTimelineViewport();
  await refreshCurrentSessionMetadata({ hydrateTimeline: true, viewportSnapshot });
  if (state.pendingTurn && state.turnId && !isTurnStreamHealthy()) {
    await streamTurnEvents(state.turnId, { forceReconnect: true });
  }
  state.lastTimelineViewportSnapshot = null;
  state.timelineShouldFollowLatest = true;
  scrollTimelineToBottomIfFollowingLatest();
}

async function openNewSession() {
  stopStream();
  resetTerminalState();
  resetArtifactState();
  state.currentSession = null;
  state.sessionId = "";
  state.draftSessionActive = true;
  resetTimelineRenderLimit();
  state.timeline = [];
  state.prompt = "";
  state.pendingTurn = false;
  state.turnId = "";
  state.error = "";
  state.status = "Ready";
  state.statusTone = "success";
  state.sessionToolsOpen = false;
  state.view = "chat";
  render({ preserveComposer: false });
}

async function ensureSession() {
  if (state.sessionId) return state.sessionId;
  const payload = await apiFetch("/api/sessions", {
    method: "POST",
    body: { cwd: defaultCwdForCreate() || null, settings: collectSettings() },
  });
  const session = payload.session;
  state.draftSessionActive = false;
  state.sessionId = session.id;
  state.currentSession = session;
  resetTimelineRenderLimit();
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
  if (!text) return;
  if (state.pendingTurn && state.turnId) {
    await sendSteeringPrompt(text);
    return;
  }
  if (state.pendingTurn) return;
  state.error = "";
  state.prompt = "";
  state.pendingTurn = true;
  state.status = "Turn running";
  state.statusTone = "warn";
  appendTimeline({ id: `local_user_${Date.now()}`, kind: "message", role: "user", meta: "sending", text });
  render({ preserveComposer: false });
  try {
    const sessionId = await ensureSession();
    const attachments = state.selectedFiles.length ? await uploadSessionFiles(sessionId, state.selectedFiles) : [];
    state.selectedFiles = [];
    const turn = await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/turns`, {
      method: "POST",
      body: { text, attachments, settings: collectSettings() },
    });
    if (turn?.session) {
      state.sessionId = turn.session.id || state.sessionId;
      state.currentSession = turn.session;
      upsertSession(turn.session);
      void refreshArtifacts({ silent: true });
      state.timeline = hydrateTimelineFromSession(turn.session);
      const nextStatus = statusFromSession(turn.session);
      state.status = nextStatus.status;
      state.statusTone = nextStatus.tone;
    }
    if (turn?.type === "command") {
      state.pendingTurn = false;
      state.turnId = "";
      if (turn.command?.draftPrompt) {
        state.prompt = turn.command.draftPrompt;
      }
      render();
      return;
    }
    state.turnId = turn.turnId || "";
    if (state.turnId) {
      state.lastTurnEventSequence = null;
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

async function sendSteeringPrompt(text) {
  const turnId = state.turnId;
  if (!turnId) return;
  state.error = "";
  state.prompt = "";
  state.pendingTurn = true;
  state.status = "Turn running";
  state.statusTone = "warn";
  appendTimeline({ id: `local_steer_${Date.now()}`, kind: "message", role: "user", meta: "steering", text });
  render({ preserveComposer: false });
  try {
    const attachments = state.selectedFiles.length && state.sessionId
      ? await uploadSessionFiles(state.sessionId, state.selectedFiles)
      : [];
    state.selectedFiles = [];
    await apiFetch(`/api/turns/${encodeURIComponent(turnId)}/steer`, {
      method: "POST",
      body: { text, attachments },
    });
    state.pendingTurn = true;
    state.turnId = turnId;
    state.status = "Turn running";
    state.statusTone = "warn";
    render();
  } catch (error) {
    if (error?.status === 401 || error?.payload?.error === "setup_required") {
      handleApiError(error, { auth: error?.status === 401 });
      return;
    }
    state.pendingTurn = true;
    state.turnId = turnId;
    state.status = "Turn running";
    state.statusTone = "warn";
    state.error = error?.payload?.message || error?.message || "追加指令失败";
    appendTimeline({
      id: `steer_error_${Date.now()}`,
      kind: "message",
      role: "system",
      severity: "error",
      meta: "failed",
      text: state.error,
    });
    render();
  }
}

function onComposerSubmit(event) {
  return sendPrompt(event);
}

function streamTurn(turnId) {
  void streamTurnEvents(turnId);
}

async function streamTurnEvents(turnId, { forceReconnect = false } = {}) {
  if (!turnId) return;
  if (!forceReconnect && state.streamAbortController && state.turnId === turnId && isTurnStreamHealthy()) {
    return;
  }
  stopStream(false);
  const controller = new AbortController();
  state.streamAbortController = controller;
  state.turnId = turnId;
  state.pendingTurn = true;
  state.status = "Turn running";
  state.statusTone = "warn";
  state.streamStartedAt = Date.now();
  state.streamLastEventAt = Date.now();
  state.streamWasBackgrounded = false;
  try {
    await readSse(turnId, controller);
    if (controller.signal.aborted) return;
    if (state.pendingTurn && state.turnId === turnId) {
      markStreamPaused();
    }
  } catch (error) {
    if (controller.signal.aborted) return;
    markStreamPaused(error);
  }
}

async function readSse(turnId, controller) {
  const after = state.lastTurnEventSequence
    ? `?after=${encodeURIComponent(String(state.lastTurnEventSequence))}`
    : "";
  const response = await fetch(`/api/turns/${encodeURIComponent(turnId)}/events${after}`, {
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

function markStreamPaused() {
  state.pendingTurn = true;
  state.streamWasBackgrounded = true;
  state.status = "Stream paused";
  state.statusTone = "warn";
  renderAfterBackgroundRefresh();
}

function processSseFrame(frame) {
  state.streamLastEventAt = Date.now();
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
    state.turnId = null;
    state.streamWasBackgrounded = false;
    if (isInterruptedStatus(event.status)) {
      state.status = "Turn stopped";
      state.statusTone = "warn";
    } else {
      state.status = "Ready";
      state.statusTone = "success";
    }
    stopStream(false);
    sendNextQueuedMessage(state.sessionId || state.currentSession?.id || "").catch(handleApiError);
    refreshCurrentSession({ silent: true }).catch(() => null);
  } else if (event.type === "turn.failed") {
    state.pendingTurn = false;
    state.turnId = null;
    state.streamWasBackgrounded = false;
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

function insertCommand(command, { input = null } = {}) {
  if (!command) return;
  const nextPrompt = command.endsWith(" ") ? command : command;
  state.prompt = nextPrompt;
  state.view = "chat";
  if (setPromptDraft(nextPrompt, { focus: true, input })) {
    return;
  }
  render({ preserveComposer: false });
  focusPromptEnd();
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
  stopWorkspaceEvents({ clearCursor: true });
  stopTerminalStream({ clearCursor: true });
  state.token = "";
  state.authSession = null;
  state.currentSession = null;
  state.sessionId = "";
  state.draftSessionActive = false;
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

function hydrateTimelineFromSession(session) {
  return hydrateTimeline(session);
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
      label: typeof item.label === "string" ? item.label : undefined,
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

function saveCurrentTimeline() {
  return null;
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

function upsertReport(report) {
  if (!report?.id) return;
  const index = state.reports.findIndex((item) => item.id === report.id);
  if (index >= 0) {
    state.reports[index] = { ...state.reports[index], ...report };
  } else {
    state.reports.unshift(report);
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

function firstInputForSession(session) {
  if (typeof session?.firstUserInput === "string" && session.firstUserInput.trim()) {
    return session.firstUserInput.trim();
  }
  const turns = Array.isArray(session?.thread?.turns) ? session.thread.turns : [];
  for (const turn of turns) {
    for (const item of Array.isArray(turn?.items) ? turn.items : []) {
      const role = inferThreadRole(item);
      const text = extractThreadText(item);
      if (role === "user" && text) return text;
    }
  }
  return firstLine(session?.preview || "");
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

function currentSessionId() {
  return state.currentSession?.id || state.sessionId || "";
}

function artifactFileName(artifact) {
  const displayPath = String(artifact?.displayPath || artifact?.title || "artifact").replace(/\\/g, "/");
  return displayPath.split("/").filter(Boolean).pop() || "artifact";
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

function loadDefaultThreadSettings() {
  try {
    return JSON.parse(localStorage.getItem(DEFAULT_THREAD_SETTINGS_KEY) || "{}") || {};
  } catch (_error) {
    return {};
  }
}

function loadQueuedMessages() {
  try {
    const raw = JSON.parse(localStorage.getItem(QUEUED_MESSAGES_KEY) || "{}");
    const entries = Object.entries(raw || {}).map(([sessionId, items]) => [
      sessionId,
      (Array.isArray(items) ? items : [])
        .map((item) => ({
          id: String(item?.id || `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
          text: String(item?.text || "").trim(),
          sending: item?.sending === true,
        }))
        .filter((item) => item.text),
    ]);
    return new Map(entries.filter(([, items]) => items.length));
  } catch (_error) {
    return new Map();
  }
}

function persistQueuedMessages() {
  const payload = {};
  for (const [sessionId, messages] of state.queuedMessages.entries()) {
    const active = messages
      .filter((message) => message?.text)
      .map((message) => ({ id: message.id, text: message.text, sending: message.sending === true }));
    if (active.length) payload[sessionId] = active;
  }
  if (Object.keys(payload).length) {
    localStorage.setItem(QUEUED_MESSAGES_KEY, JSON.stringify(payload));
  } else {
    localStorage.removeItem(QUEUED_MESSAGES_KEY);
  }
}

function currentQueueSessionId() {
  return state.sessionId || state.currentSession?.id || "__draft__";
}

function queuedMessagesForSession(sessionId) {
  const key = sessionId || "__draft__";
  if (!(state.queuedMessages instanceof Map)) state.queuedMessages = new Map();
  return state.queuedMessages.get(key) || [];
}

function queuedMessagesForCurrentSession() {
  return queuedMessagesForSession(currentQueueSessionId());
}

function enqueueQueuedMessage(sessionId, text) {
  const key = sessionId || "__draft__";
  const value = String(text || "").trim();
  if (!value) return null;
  const message = {
    id: `queued_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    text: value,
    sending: false,
  };
  const messages = queuedMessagesForSession(key);
  state.queuedMessages.set(key, [...messages, message]);
  persistQueuedMessages();
  return message;
}

function removeQueuedMessage(sessionId, messageId) {
  const key = sessionId || "__draft__";
  const next = queuedMessagesForSession(key).filter((message) => message.id !== messageId);
  if (next.length) state.queuedMessages.set(key, next);
  else state.queuedMessages.delete(key);
  persistQueuedMessages();
}

function queueCurrentPrompt(event) {
  event?.preventDefault?.();
  const text = state.prompt.trim();
  if (!text) return;
  enqueueQueuedMessage(currentQueueSessionId(), text);
  state.prompt = "";
  state.notice = "已加入排队，本轮完成后自动发送";
  render({ preserveComposer: false });
}

async function sendNextQueuedMessage(sessionId) {
  const key = sessionId || currentQueueSessionId();
  if (!key || state.pendingTurn) return null;
  const messages = queuedMessagesForSession(key);
  const next = messages.find((message) => !message.sending);
  if (!next) return null;
  next.sending = true;
  persistQueuedMessages();
  renderAfterBackgroundRefresh();
  try {
    state.prompt = next.text;
    await sendPrompt({ preventDefault() {} });
    removeQueuedMessage(key, next.id);
    return next;
  } catch (error) {
    next.sending = false;
    persistQueuedMessages();
    throw error;
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
  if (!state.usage) return "按需刷新；第三方 API 可不支持官方用量";
  if (state.usage.error) return `${state.usage.error} · 不影响第三方 API 模式`;
  if (typeof state.usage === "string") return state.usage;
  const parts = [];
  for (const [key, value] of Object.entries(state.usage)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    parts.push(`${key}: ${value}`);
  }
  return parts.slice(0, 3).join(" · ") || "已连接";
}

function auditActionLabel(action) {
  const normalized = String(action || "").trim();
  const labels = {
    "auth.login.success": "登录成功",
    "auth.login.failure": "登录失败",
    "auth.login.rate_limited": "登录限流",
    "auth.logout": "退出登录",
    "auth.session.revoked": "撤销设备",
    "settings.updated": "设置更新",
    "project.updated": "项目更新",
    "project.favorite.updated": "项目收藏",
    "role.updated": "角色更新",
    "user.updated": "用户更新",
    "user.deleted": "用户删除",
    "session.created": "新建对话",
    "session.archived": "归档对话",
    "session.unarchived": "恢复对话",
    "session.shared": "分享对话",
    "session.favorite.updated": "对话收藏",
    "session.settings.updated": "对话设置",
    "session.attachments.created": "上传附件",
    "session.timeline.appended": "追加记录",
    "turn.started": "发送任务",
    "turn.steered": "追加指令",
    "turn.interrupted": "中断任务",
    "approval.accept": "批准操作",
    "approval.accept_for_session": "本会话批准",
    "approval.deny": "拒绝操作",
    "terminal.started": "启动终端",
    "terminal.input": "终端输入",
    "terminal.stopped": "停止终端",
    "skill.updated": "技能更新",
    "plugin.updated": "插件更新",
    "mcp.updated": "MCP 更新",
    "mcp.oauth.started": "MCP 授权",
    "app.updated": "应用更新",
    "config.updated": "配置更新",
    "artifact.read": "读取产物",
    "artifact.favorite.updated": "收藏产物",
    "report.favorite.updated": "收藏报告",
    "share.read": "读取分享",
  };
  return labels[normalized] || normalized || "操作记录";
}

function auditIcon(action) {
  const normalized = String(action || "").toLowerCase();
  if (normalized.includes("failure") || normalized.includes("deny") || normalized.includes("rate_limited")) return "info";
  if (normalized.includes("terminal")) return "code";
  if (normalized.includes("plugin") || normalized.includes("skill") || normalized.includes("mcp") || normalized.includes("config") || normalized.includes("settings") || normalized.includes("app.")) return "sliders";
  if (normalized.includes("project") || normalized.includes("role")) return "layers";
  if (normalized.includes("share") || normalized.includes("artifact")) return "doc";
  if (normalized.includes("logout") || normalized.includes("revoked") || normalized.includes("user")) return "user";
  return "check";
}

function runtimeHealthText() {
  if (state.runtimeHealthLoading && !state.runtimeHealth) return "检查中";
  const health = state.runtimeHealth || {};
  const status = health.status || "unknown";
  const statusText = {
    provider_ok: "Provider OK",
    auth_missing: "认证缺失",
    unsupported: "不支持",
    failed: "运行时异常",
    unknown: "按需刷新",
  }[status] || "按需刷新";
  const modelCount = Number(health.models?.count || 0);
  const modelText = modelCount ? `${modelCount} 个模型` : "模型待确认";
  const usageStatus = health.usage?.status || "";
  const usageTextValue = usageStatus === "provider_ok"
    ? "官方用量可读"
    : usageStatus === "official_usage_unavailable"
      ? "官方用量不可用，不影响第三方 API"
      : usageStatus === "auth_missing"
        ? "官方认证缺失"
        : "用量待确认";
  return `${statusText} · ${modelText} · ${usageTextValue}`;
}

function runtimeHealthIcon() {
  const status = state.runtimeHealth?.status || "";
  if (status === "provider_ok") return "check";
  if (status === "auth_missing" || status === "failed") return "info";
  return "refresh";
}

function systemDiagnosticsText(diagnostics) {
  const parts = [];
  if (diagnostics.system?.reboot?.required) {
    const packages = diagnostics.system.reboot.packages || [];
    parts.push(`系统需重启${packages.length ? ` · ${packages.slice(0, 2).join(", ")}` : ""}`);
  } else {
    parts.push("无需系统重启");
  }
  const upgradeCount = diagnostics.system?.upgrades?.count;
  if (typeof upgradeCount === "number") {
    parts.push(`${upgradeCount} 个包可升级`);
  } else {
    parts.push("升级包数量未知");
  }
  const availableBytes = diagnostics.system?.disk?.availableBytes;
  if (typeof availableBytes === "number") parts.push(`磁盘可用 ${formatBytes(availableBytes)}`);
  return parts.join(" · ");
}

function systemDiagnosticsIcon(diagnostics) {
  return diagnostics.system?.reboot?.required || Number(diagnostics.system?.upgrades?.count || 0) > 0 ? "info" : "check";
}

function serviceDiagnosticsText(diagnostics) {
  const service = diagnostics.service || {};
  const active = service.active === true ? "运行中" : service.active === false ? "未运行" : "未知";
  const enabled = service.enabled === true ? "开机自启" : service.enabled === false ? "未自启" : "自启未知";
  return `${service.name || "codex-web.service"} · ${active} · ${enabled}`;
}

function storageDiagnosticsText(diagnostics) {
  const stateDir = diagnostics.storage?.stateDir || {};
  const reportsDir = diagnostics.storage?.reportsDir || {};
  const stateText = stateDir.writable === true ? "状态目录可写" : stateDir.exists === false ? "状态目录缺失" : "状态目录待确认";
  const reportText = reportsDir.writable === true ? "报告目录可写" : reportsDir.exists === false ? "报告目录缺失" : "报告目录待确认";
  return `${stateText} · ${reportText}`;
}

function storageDiagnosticsIcon(diagnostics) {
  return diagnostics.storage?.stateDir?.writable === true && diagnostics.storage?.reportsDir?.writable === true ? "check" : "info";
}

function backupDiagnosticsText(diagnostics) {
  const latest = diagnostics.backup?.latest;
  if (latest?.name) return latest.name;
  return diagnostics.backup?.exists === false ? "还没有备份目录" : "还没有备份记录";
}

function diagnosticsProviderText(diagnostics) {
  const status = diagnostics.provider?.status === "provider_ok" ? "Provider OK" : "Provider 待确认";
  const usageStatus = diagnostics.provider?.usage?.status;
  const usage = usageStatus === "available"
    ? "官方用量可读"
    : usageStatus === "unavailable" || usageStatus === "unsupported"
      ? "官方用量不可用，不影响第三方 API"
      : "用量待确认";
  return `${status} · ${usage}`;
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

function isPromptInputFocused() {
  const input = document.querySelector("#prompt-input");
  return Boolean(input && document.activeElement === input);
}

function isFormControlInteractionActive() {
  return isFormControl(document.activeElement) || Date.now() - lastFormControlInteractionAt < 1800;
}

function renderAfterBackgroundRefresh() {
  if (isFormControlInteractionActive()) return;
  render();
}

function renderWorkspaceAfterBackgroundRefresh() {
  if (isFormControlInteractionActive()) return;
  renderWorkspaceOnly() || render();
}

function renderSessionListsAfterBackgroundRefresh() {
  if (renderSessionSearchResultsOnly()) return;
  if (isFormControlInteractionActive()) return;
  render();
}

function renderAuthenticatedAfterBackgroundRefresh() {
  if (!state.token) {
    render();
    return;
  }
  if (isFormControlInteractionActive()) {
    return;
  }
  const shellExists = document.querySelector(".desktop-shell, .mobile-shell");
  if (!shellExists) {
    render();
    return;
  }
  if (!state.isMobile) {
    renderSidebarRecentsOnly();
    renderWorkspaceOnly();
    return;
  }
  renderSessionSearchResultsOnly() || render();
}

function captureFocusedComposerState() {
  const input = document.querySelector("#prompt-input");
  if (!input || document.activeElement !== input) return null;
  const value = String(input.value || "");
  state.prompt = value;
  return {
    value,
    selectionStart: typeof input.selectionStart === "number" ? input.selectionStart : value.length,
    selectionEnd: typeof input.selectionEnd === "number" ? input.selectionEnd : value.length,
  };
}

function restoreFocusedComposerState(snapshot) {
  if (!snapshot) return;
  const input = document.querySelector("#prompt-input");
  if (!input) return;
  state.prompt = snapshot.value;
  input.value = snapshot.value;
  input.selectionStart = snapshot.selectionStart;
  input.selectionEnd = snapshot.selectionEnd;
  input.focus();
  syncPromptInputLayout(input);
  updateSendButton();
}

function isFormControl(element) {
  if (!element) return false;
  if (typeof Element !== "undefined" && !(element instanceof Element)) return false;
  return Boolean(element.closest?.("input, select, textarea, [contenteditable='true']"));
}

function scrollChatToBottom() {
  const timeline = getTimelineElement();
  if (timeline) timeline.scrollTop = timeline.scrollHeight;
}

function getTimelineElement() {
  return document.querySelector("#timeline") || document.querySelector("#messages");
}

function captureTimelineViewport() {
  const timeline = getTimelineElement();
  if (!timeline) {
    return { shouldFollowLatest: state.timelineShouldFollowLatest };
  }
  const distanceFromBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight;
  return {
    scrollTop: timeline.scrollTop,
    scrollHeight: timeline.scrollHeight,
    clientHeight: timeline.clientHeight,
    shouldFollowLatest: state.timelineShouldFollowLatest || distanceFromBottom <= 32,
  };
}

function updateTimelineFollowState() {
  const timeline = getTimelineElement();
  if (!timeline) {
    state.timelineShouldFollowLatest = true;
    return;
  }
  state.timelineShouldFollowLatest = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight <= 32;
}

function scrollTimelineToBottomIfFollowingLatest() {
  if (!state.timelineShouldFollowLatest) return;
  requestAnimationFrame(() => {
    const timeline = getTimelineElement();
    if (timeline) timeline.scrollTop = timeline.scrollHeight;
  });
}

function syncPromptFocusLayout(eventOrTextarea) {
  const textarea = eventOrTextarea?.target || eventOrTextarea;
  if (!textarea) return;
  markFormControlInteraction();
  protectPromptFocusScroll();
  syncPromptInputLayout(textarea);
  requestAnimationFrame(() => {
    syncPromptInputLayout(textarea);
    scheduleTimelineViewportRestore();
  });
  if (promptFocusLayoutTimer) clearTimeout(promptFocusLayoutTimer);
  promptFocusLayoutTimer = setTimeout(() => {
    syncPromptInputLayout(textarea);
    scheduleTimelineViewportRestore();
    promptFocusLayoutTimer = null;
  }, 120);
}

function syncPromptInputLayout(textarea) {
  autoGrowTextarea(textarea);
}

function protectPromptFocusScroll() {
  state.lastTimelineViewportSnapshot = captureTimelineViewport();
  scheduleTimelineViewportRestore(state.lastTimelineViewportSnapshot);
}

function scheduleTimelineViewportRestore(snapshot = state.lastTimelineViewportSnapshot) {
  if (!snapshot) return;
  const restore = () => restoreTimelineViewport(snapshot);
  requestAnimationFrame(restore);
  if (promptFocusRestoreTimer) clearTimeout(promptFocusRestoreTimer);
  promptFocusRestoreTimer = setTimeout(() => {
    restore();
    promptFocusRestoreTimer = null;
  }, 180);
}

function restoreTimelineViewport(snapshot) {
  const timeline = getTimelineElement();
  if (!timeline || !snapshot) return;
  if (snapshot.shouldFollowLatest) {
    timeline.scrollTop = timeline.scrollHeight;
    state.timelineShouldFollowLatest = true;
    return;
  }
  timeline.scrollTop = Math.max(0, Number(snapshot.scrollTop) || 0);
  state.timelineShouldFollowLatest = false;
}

function autoGrowTextarea(textarea) {
  if (!textarea?.style) return;
  textarea.style.height = "auto";
  const nextHeight = `${Math.min(160, Math.max(44, textarea.scrollHeight || 44))}px`;
  if (textarea.style.height !== nextHeight) textarea.style.height = nextHeight;
}

function updateSendButton() {
  const button = document.querySelector(".send-btn");
  if (button) button.disabled = !state.prompt.trim();
  const queueButton = document.querySelector("#queue-message-button");
  if (queueButton) queueButton.disabled = !state.prompt.trim();
}

function setPromptDraft(value, { focus = false, input = null } = {}) {
  input = input || document.querySelector("#prompt-input");
  state.prompt = String(value || "");
  if (!input) {
    return false;
  }
  input.value = state.prompt;
  syncPromptInputLayout(input);
  updateSendButton();
  if (focus) {
    focusPromptEnd(input);
  }
  return true;
}

function focusPromptEnd(input = document.querySelector("#prompt-input")) {
  if (!input) return;
  input.focus();
  const end = String(input.value || "").length;
  input.selectionStart = end;
  input.selectionEnd = end;
}

function normalizeSiteTitle(value) {
  const title = String(value || "").trim();
  return title || "Codex 远程工作台";
}

function translate(value) {
  return zh[value] || value || "";
}

function firstLine(value) {
  return String(value || "").split(/\r?\n/u)[0].trim();
}

function truncateText(value, maxLength) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (!Number.isFinite(maxLength) || text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
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
    panel: '<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M10 3v18"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M17 14v6"/><path d="M14 17h6"/></svg>',
    sparkles: '<svg viewBox="0 0 24 24"><path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5z"/><path d="m19 14 .8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z"/><path d="m5 13 .8 2.2L8 16l-2.2.8L5 19l-.8-2.2L2 16l2.2-.8z"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="12" height="16" rx="2"/><path d="M9 5a3 3 0 0 1 6 0"/><path d="M9 12h6"/><path d="M9 16h4"/></svg>',
    layers: '<svg viewBox="0 0 24 24"><path d="m12 3 9 4-9 4-9-4z"/><path d="m3 12 9 4 9-4"/><path d="m3 17 9 4 9-4"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>',
    download: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>',
  };
  return icons[name] || icons.info;
}
