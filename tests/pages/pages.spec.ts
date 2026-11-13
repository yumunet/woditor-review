import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fixtureText, sourcePath } from '../helpers/woditor';
import { zipSync, unzipSync, strFromU8 } from 'fflate';
const base = '/woditor-review/',
  path = sourcePath;
test('project Pages assets, install scope, and offline Python work under the subpath', async ({
  page,
  context,
}) => {
  await page.goto(`${base}icon.svg`);
  await page.evaluate(async () => {
    const cache = await caches.open('woditor-review-other-site-v1');
    await cache.put('/other-site/sentinel', new Response('keep'));
  });
  const failures: string[] = [],
    paths: string[] = [];
  page.on('requestfailed', (req) => failures.push(req.url()));
  page.on('pageerror', (error) => failures.push(String(error)));
  page.on('request', (req) => {
    const url = new URL(req.url());
    if (url.origin === 'http://127.0.0.1:4173') paths.push(url.pathname);
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Woditor Review', exact: true })).toBeVisible();
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute(
    'href',
    base + 'manifest.webmanifest',
  );
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute(
    'href',
    base + 'icon-192.png',
  );
  const manifest = await (await page.request.get(base + 'manifest.webmanifest')).json();
  expect([manifest.name, manifest.short_name]).toEqual(['Woditor Review', 'Review']);
  expect([manifest.id, manifest.start_url, manifest.scope]).toEqual([base, base, base]);
  for (const icon of manifest.icons) {
    expect(icon.src).toMatch(/^\/woditor-review\/icon-/);
    expect((await page.request.get(icon.src)).status()).toBe(200);
  }
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
    const names = await caches.keys(),
      resources = (
        await Promise.all(
          names
            .filter((n) => n !== 'woditor-review-other-site-v1')
            .map(async (name) =>
              (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname),
            ),
        )
      ).flat();
    return {
      scope: registration.scope,
      script: registration.active!.scriptURL,
      resources,
      sentinel: await caches.has('woditor-review-other-site-v1'),
      root: !!(await navigator.serviceWorker.getRegistration('/')),
    };
  });
  expect(state.scope).toBe('http://127.0.0.1:4173' + base);
  expect(state.script).toBe('http://127.0.0.1:4173' + base + 'sw.js');
  expect(state.root).toBe(false);
  expect(state.sentinel).toBe(true);
  expect(state.resources.length).toBeGreaterThan(10);
  expect(state.resources.every((p) => p.startsWith(base))).toBeTruthy();
  expect(state.resources).toContain(base + 'pyodide/pyodide.asm.wasm');
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Woditor Review', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  for (const [name, lang] of [
    ['ja', 'ja-JP'],
    ['en', 'en-US'],
  ])
    await page.locator(`input[name=${name}]`).setInputFiles({
      name: `${lang}.zip`,
      mimeType: 'application/zip',
      buffer: Buffer.from(
        zipSync({
          [`${lang}/texts/${path}`]: Buffer.from(fixtureText('map', name === 'ja' ? 'ja' : 'en')),
        }),
      ),
    });
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90000 });
  if (await page.getByRole('button', { name: '閉じる', exact: true }).count())
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
  for (const name of ['MapData', 'MapData/TestMap', path])
    await page.locator(`.file-row[data-value="${name}"]`).click();
  await expect(page.locator('.source')).toContainText('主人公');
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  await page.getByLabel('コメント内容').fill('Pages offline review');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを出力', exact: true }).click();
  const request = JSON.parse(readFileSync(await (await download).path(), 'utf8'));
  expect(request.entries[0].posts[0].text).toBe('Pages offline review');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: '状態をバックアップ', exact: true }).click();
  const entries = unzipSync(readFileSync(await (await backup).path()));
  expect(JSON.parse(strFromU8(Object.values(entries)[0])).files).toHaveLength(1);
  await page.reload();
  await expect(page.locator('.file-row')).toHaveCount(1);
  expect(paths.every((p) => p.startsWith(base))).toBeTruthy();
  expect(failures).toEqual([]);
});
