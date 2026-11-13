import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { captureUi } from './screenshots';
import { loadFixture } from './helpers';

test('offline restart, local Python rendering, and saved review operations', async ({
  page,
  context,
}) => {
  await loadFixture(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller)
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
  });
  await context.setOffline(true);
  await page.reload();
  for (const name of ['MapData', 'TestMap', 'Event_0000.txt'])
    await page
      .locator('.file-row')
      .filter({ has: page.locator('.row-name', { hasText: name }) })
      .click();
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  await page.getByLabel('コメント内容').fill('オフラインで保存したコメント');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.float-preview')).toHaveText('オフラインで保存したコメント');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを出力', exact: true }).click();
  const request = JSON.parse(readFileSync(await (await downloaded).path(), 'utf8'));
  expect(request.entries[0].posts[0].text).toContain('オフライン');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.reload();
  for (const name of ['MapData', 'TestMap', 'Event_0000.txt'])
    await page
      .locator('.file-row')
      .filter({ has: page.locator('.row-name', { hasText: name }) })
      .click();
  await expect(page.locator('.float-preview')).toHaveText('オフラインで保存したコメント');
});

test('touch swipes close panels only from the handle or the top of their content', async ({
  page,
  context,
}, info) => {
  test.skip(info.project.name !== 'mobile', 'Touch gestures are exercised on the mobile project');
  await loadFixture(page, 'BasicData/CommonEvent/000.txt');
  await page.locator('.entry-open').click();
  const session = await context.newCDPSession(page);
  async function swipe(selector: string) {
    const box = await page.locator(selector).boundingBox(),
      x = box!.x + box!.width / 2,
      y = box!.y + Math.min(20, box!.height / 2);
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let dy = 20; dy <= 120; dy += 20)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + dy }],
      });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await page.locator('.sheet-body').evaluate((el) => {
    el.scrollTop = 160;
  });
  expect(await page.locator('.sheet-body').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await swipe('.sheet-body');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.sheet-body').evaluate((el) => {
    el.scrollTop = 0;
  });
  await swipe('.sheet-body');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  await swipe('.handle');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: '次の項目', exact: true }).click();
  const currentTitle = await page.locator('.entry-title').textContent();
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  await page.getByLabel('コメント内容').fill('この表現を確認してください');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.entry-title')).toHaveText(currentTitle!);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await captureUi(page, info, 'review');
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
