import { test, expect, type Page } from '@playwright/test';
import { startFrontendE2eServer, type FrontendE2eServer } from './helpers/server.js';

let server: FrontendE2eServer;

test.beforeAll(async () => {
  server = await startFrontendE2eServer();
});

test.afterAll(async () => {
  await server.stop();
});

test.beforeEach(async ({ page }) => {
  await captureRuntimeFailures(page);
  await page.goto(server.baseUrl);
  await page.getByPlaceholder('密码').fill('password');
  await page.getByRole('button', { name: '登录' }).click();
  await expect(page.locator('#session-search')).toBeVisible();
});

test.afterEach(async ({ page }) => {
  const failures = await page.evaluate(() => (window as any).__codexE2eFailures?.() || []);
  expect(failures).toEqual([]);
});

test('desktop composer remains responsive across session, search, and workbench navigation', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sessionLoaded = page.waitForResponse((response) => (
    response.url().endsWith('/api/sessions/session_existing')
    && response.status() === 200
  ));
  await page.locator('[data-session-open="session_existing"]').click();
  await sessionLoaded;
  await page.waitForTimeout(100);
  const prompt = page.locator('#prompt-input');
  await expect(prompt).toBeVisible();
  await prompt.click();
  await prompt.fill('检查输入框不会卡死');
  await expect(prompt).toHaveValue('检查输入框不会卡死');

  await page.locator('#session-search').fill('现有');
  await expect(prompt).toHaveValue('检查输入框不会卡死');

  await page.getByRole('button', { name: /工作台/ }).click();
  await expect(page.locator('.capabilities-page')).toBeVisible();
  await page.locator('.sidebar-nav [data-view="sessions"]').click();
  await expect(prompt).toBeVisible();
  await expect(prompt).toHaveValue('检查输入框不会卡死');

  const desktopTurn = page.waitForResponse((response) => (
    response.url().includes('/api/sessions/')
    && response.url().endsWith('/turns')
    && response.status() === 202
  ));
  await prompt.press('Enter');
  await desktopTurn;
  await expect(page.locator('.message.user').last()).toContainText('检查输入框不会卡死');
});

test('composer quick actions update the prompt without replacing the input node', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sessionLoaded = page.waitForResponse((response) => (
    response.url().endsWith('/api/sessions/session_existing')
    && response.status() === 200
  ));
  await page.locator('[data-session-open="session_existing"]').click();
  await sessionLoaded;
  await page.waitForTimeout(100);
  const prompt = page.locator('#prompt-input');
  await expect(prompt).toBeVisible();
  await prompt.fill('先保留这些文字');
  const promptHandle = await prompt.elementHandle();
  expect(promptHandle).not.toBeNull();

  await page.locator('[data-quick="运行测试"]').click();

  await expect(prompt).toHaveValue('先保留这些文字\n运行测试');
  expect(await promptHandle!.evaluate((node) => node.isConnected)).toBe(true);
});

test('session search and command buttons keep the active composer mounted', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sessionLoaded = page.waitForResponse((response) => (
    response.url().endsWith('/api/sessions/session_existing')
    && response.status() === 200
  ));
  await page.locator('[data-session-open="session_existing"]').click();
  await sessionLoaded;
  await page.waitForTimeout(100);

  const prompt = page.locator('#prompt-input');
  await expect(prompt).toBeVisible();
  await prompt.fill('搜索时不能丢');
  const promptHandle = await prompt.elementHandle();
  expect(promptHandle).not.toBeNull();

  await page.locator('#session-search').fill('现');
  await page.locator('#session-search').fill('现有');
  await page.locator('#session-search').fill('');
  await expect(prompt).toHaveValue('搜索时不能丢');
  expect(await promptHandle!.evaluate((node) => node.isConnected)).toBe(true);

  await page.locator('[data-command="/help"]').click();
  await expect(prompt).toHaveValue('/help');
  expect(await promptHandle!.evaluate((node) => node.isConnected)).toBe(true);
});

test('desktop workbench and settings navigation do not replace the sidebar shell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const search = page.locator('#session-search');
  await expect(search).toBeVisible();
  const searchHandle = await search.elementHandle();
  expect(searchHandle).not.toBeNull();

  await page.locator('.sidebar-nav [data-view="capabilities"]').click();
  await expect(page.locator('.capabilities-page')).toBeVisible();
  expect(await searchHandle!.evaluate((node) => node.isConnected)).toBe(true);

  await page.locator('.sidebar-nav [data-view="settings"]').click();
  await expect(page.locator('.settings-page')).toBeVisible();
  expect(await searchHandle!.evaluate((node) => node.isConnected)).toBe(true);

  await page.locator('.sidebar-nav [data-view="sessions"]').click();
  await expect(page.locator('#session-search')).toBeVisible();
  expect(await searchHandle!.evaluate((node) => node.isConnected)).toBe(true);
});

test('desktop workspace terminal runs a command without freezing the composer', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const sessionLoaded = page.waitForResponse((response) => (
    response.url().endsWith('/api/sessions/session_existing')
    && response.status() === 200
  ));
  await page.locator('[data-session-open="session_existing"]').click();
  await sessionLoaded;
  await expect(page.locator('#prompt-input')).toBeVisible();

  const workspaceLoaded = page.waitForResponse((response) => (
    response.url().includes('/api/sessions/session_existing/workspace/status')
    && response.status() === 200
  ));
  await page.locator('#toggle-workspace').click();
  await workspaceLoaded;
  await expect(page.locator('.workspace-terminal')).toBeVisible();

  const command = `${process.execPath} -e "console.log('e2e-terminal-ok')"`;
  const terminalStarted = page.waitForResponse((response) => (
    response.url().endsWith('/api/sessions/session_existing/terminal')
    && response.status() === 201
  ));
  await page.locator('#terminal-command').fill(command);
  await page.locator('#terminal-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await terminalStarted;
  await expect(page.locator('#terminal-output')).toContainText('e2e-terminal-ok');

  const prompt = page.locator('#prompt-input');
  await prompt.fill('终端运行后仍可输入');
  await expect(prompt).toHaveValue('终端运行后仍可输入');
});

test('mobile new conversation and refresh keep the composer usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator('#session-search')).toBeVisible();
  await page.locator('#new-session-button').click();

  const prompt = page.locator('#prompt-input');
  await expect(prompt).toBeVisible();
  await prompt.click();
  await prompt.fill('手机端输入不能卡');
  await expect(prompt).toHaveValue('手机端输入不能卡');
  const mobileTurn = page.waitForResponse((response) => (
    response.url().includes('/api/sessions/')
    && response.url().endsWith('/turns')
    && response.status() === 202
  ));
  await prompt.press('Enter');
  await mobileTurn;
  await expect(page.locator('.message.user').last()).toContainText('手机端输入不能卡');

  await page.reload();
  await expect(page.locator('#session-search')).toBeVisible();
  await page.locator('#new-session-button').click();
  await expect(page.locator('#prompt-input')).toBeVisible();
});

async function captureRuntimeFailures(page: Page): Promise<void> {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (message.text().startsWith('Failed to load resource:')) {
        return;
      }
      failures.push(message.text());
    }
  });
  page.on('response', (response) => {
    if (response.status() < 400) {
      return;
    }
    const url = response.url();
    if (url.endsWith('/favicon.ico')) {
      return;
    }
    failures.push(`${response.status()} ${url}`);
  });
  page.on('requestfailed', (request) => {
    if (request.url().includes('/api/turns/') && request.url().includes('/events')) {
      return;
    }
    failures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || 'failed'}`);
  });
  await page.exposeFunction('__codexE2eFailures', () => failures);
}
