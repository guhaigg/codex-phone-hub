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
  renderAdminBody,
};`, context);
  return context.__adminRenderTest as {
    state: any;
    renderAdminBody: () => string;
  };
}

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
