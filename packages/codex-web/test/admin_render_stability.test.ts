import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const appSource = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function loadRenderHarness() {
  const storage = new Map<string, string>();
  const appElement = {
    innerHTML: '',
  };
  const context: any = {
    console,
    URL,
    Date,
    Set,
    Map,
    Promise,
    TextDecoder,
    TextEncoder,
    AbortController,
    Element: class Element {},
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
    },
    location: { origin: 'http://127.0.0.1', hostname: '127.0.0.1' },
    navigator: {},
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      activeElement: null,
      scrollingElement: { scrollTop: 0 },
      documentElement: { scrollTop: 0, dataset: {} },
      title: '',
      addEventListener() {},
      querySelector(selector: string) {
        return selector === '#app' ? appElement : null;
      },
      querySelectorAll() {
        return [];
      },
      createElement() {
        return {
          style: {},
          classList: { toggle() {}, remove() {} },
          appendChild() {},
          remove() {},
        };
      },
      body: { appendChild() {} },
    },
    window: {
      innerWidth: 1440,
      location: { hostname: '127.0.0.1', origin: 'http://127.0.0.1' },
      addEventListener() {},
      matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    },
    requestAnimationFrame(callback: () => void) {
      callback();
    },
    setTimeout,
    clearTimeout,
    fetch: async () => ({ ok: true, status: 204, json: async () => ({}) }),
  };
  vm.runInNewContext(`${appSource}
globalThis.__adminRenderTest = {
  state,
  renderNotebookSidebar,
  renderViewTabs,
  renderAdminBody,
  renderCapabilities,
};`, context);
  return context.__adminRenderTest as {
    state: any;
    renderNotebookSidebar: () => string;
    renderViewTabs: (mobile: boolean) => string;
    renderAdminBody: () => string;
    renderCapabilities: (mobile: boolean) => string;
  };
}

test('personal navigation does not expose a separate multi-user admin console', () => {
  const api = loadRenderHarness();
  api.state.authSession = { id: 'auth_1', principal: { userId: 'user_admin', username: 'admin', mode: 'single' } };

  const sidebar = api.renderNotebookSidebar();
  const desktopTabs = api.renderViewTabs(false);
  const mobileTabs = api.renderViewTabs(true);
  const capabilities = api.renderCapabilities(false);

  assert.doesNotMatch(sidebar, /data-view="admin"/u);
  assert.doesNotMatch(sidebar, />管理</u);
  assert.doesNotMatch(desktopTabs, /data-view="admin"/u);
  assert.doesNotMatch(desktopTabs, />管理</u);
  assert.doesNotMatch(mobileTabs, /data-view="admin"/u);
  assert.doesNotMatch(capabilities, /data-capability-target="admin"/u);
});

test('personal admin page does not render multi-role management by default', () => {
  const api = loadRenderHarness();
  const projects = Array.from({ length: 60 }, (_, index) => ({
    id: `project_${index}`,
    displayName: `Project ${index}`,
    cwd: `/repo/project-${index}`,
  }));
  const roles = Array.from({ length: 40 }, (_, index) => ({
    id: `role_${index}`,
    name: `Role ${index}`,
    isAdmin: index === 0,
    projectGrants: projects.map((project) => ({
      projectId: project.id,
      canRead: true,
      canCreate: true,
      canWrite: index % 2 === 0,
    })),
  }));

  api.state.admin = {
    settings: { multiUserEnabled: true },
    projects,
    roles,
    users: [],
  };
  const html = api.renderAdminBody();
  const grantRows = html.match(/class="role-grant-row"/gu) ?? [];

  assert.equal(grantRows.length, 0);
  assert.doesNotMatch(html, /data-admin-role/u);
  assert.doesNotMatch(html, /data-admin-user/u);
  assert.doesNotMatch(html, /角色/u);
  assert.doesNotMatch(html, /用户/u);
  assert.ok(html.length < 250_000, `admin markup should stay bounded, got ${html.length} bytes`);
});

test('personal workbench renders ecosystem controls without multi-role management residue', () => {
  const api = loadRenderHarness();
  api.state.ecosystem = {
    loading: false,
    tab: 'skills',
    skills: {
      cwd: '/repo',
      skills: [
        { name: 'frontend-design', description: 'UI skill', enabled: true, path: '/skills/frontend-design', scope: 'user' },
      ],
      errors: [],
    },
    plugins: {
      featuredPluginIds: [],
      marketplaceLoadErrors: [],
      marketplaces: [{
        name: 'personal',
        plugins: [{ id: 'plugin-a', name: 'plugin-a', installed: true, enabled: true, installPolicy: 'AVAILABLE', authPolicy: 'ON_USE', marketplaceName: 'personal', marketplacePath: null }],
      }],
    },
    apps: [{ id: 'github', name: 'GitHub', isAccessible: true, isEnabled: false, pluginDisplayNames: ['plugin-a'] }],
    mcp: [{ name: 'github', isEnabled: true, authStatus: 'oAuth', toolCount: 8, resourceCount: 1, resourceTemplateCount: 0 }],
    oauthUrl: 'https://auth.example/github',
  };

  const html = api.renderCapabilities(false);

  assert.match(html, /生态控制台/u);
  assert.match(html, /frontend-design/u);
  assert.match(html, /plugin-a/u);
  assert.match(html, /GitHub/u);
  assert.match(html, /github/u);
  assert.doesNotMatch(html, /data-admin-role/u);
  assert.doesNotMatch(html, /data-admin-user/u);
  assert.doesNotMatch(html, /角色/u);
  assert.doesNotMatch(html, /用户/u);
  assert.ok(html.length < 180_000, `capability markup should stay bounded, got ${html.length} bytes`);
});
