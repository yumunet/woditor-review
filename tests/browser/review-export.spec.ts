import { test, expect, type Page } from '@playwright/test';
import { captureUi } from './screenshots';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import {
  loadFixture,
  loadNavigationFiles,
  openTreeFile,
  postReviewComment,
  closeReviewSheet,
  navigationPaths,
} from './helpers';

test('export selection and instruction copy/preview preserve accessible keyboard and Back operations', async ({
  page,
}, info) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if ((window as any).failClipboard) throw Error('Clipboard denied');
          (window as any).copiedInstructions = text;
        },
      },
    });
  });
  await loadNavigationFiles(page);
  for (const path of [navigationPaths[0], navigationPaths[2]]) {
    await openTreeFile(page, path);
    await postReviewComment(page, 'Review this file');
  }
  await page.getByRole('button', { name: '戻る', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  const all = page.getByRole('checkbox', { name: 'すべて選択', exact: true }),
    files = page.locator('[data-export-path]');
  await expect(files).toHaveCount(2);
  await expect(all).toBeChecked();
  await all.uncheck();
  await expect(page.locator('[data-export-path]:checked')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'JSONを出力', exact: true })).toBeDisabled();
  await files.first().check();
  expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBeTruthy();
  await all.check();
  await expect(page.locator('[data-export-path]:checked')).toHaveCount(2);
  await captureUi(page, info, 'export');
  await page.getByRole('button', { name: '指示文をコピー', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('指示文をコピーしました');
  await expect(page.locator('.sheet details')).toHaveCount(0);
  await expect(page.locator('.sheet .instructions')).toHaveCount(0);
  const copied = await page.evaluate(() => (window as any).copiedInstructions);
  expect(copied).toContain('woditor_review_tool.py');
  await page.getByRole('button', { name: '指示文を確認', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '指示文', exact: true });
  await expect(modal.locator('pre')).toHaveText(copied);
  await expect(page.getByRole('button', { name: '指示文を閉じる', exact: true })).toBeFocused();
  await page.goBack();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'AIレビューを依頼', exact: true })).toBeVisible();
  await page.goForward();
  await expect(modal.locator('pre')).toHaveText(copied);
  await page.keyboard.press('Shift+Tab');
  await expect(modal.locator('pre')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: '指示文を閉じる', exact: true })).toBeFocused();
  await captureUi(page, info, 'instructions');
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'AIレビューを依頼', exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as any).failClipboard = true;
  });
  await page.getByRole('button', { name: '指示文をコピー', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('コピーできませんでした');
  await page.getByRole('button', { name: '指示文を確認', exact: true }).click();
  await expect(modal.locator('pre')).toHaveText(copied);
  await page.getByRole('button', { name: '指示文を閉じる', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  await expect(files).toHaveCount(4);
  await expect(all).toBeChecked();
  await all.uncheck();
  await expect(page.getByRole('button', { name: '英訳TXTを出力', exact: true })).toBeDisabled();
  await files.last().check();
  expect(await all.evaluate((el: HTMLInputElement) => el.indeterminate)).toBeTruthy();
  await all.check();
  await expect(page.locator('[data-export-path]:checked')).toHaveCount(4);
});

test('export trees preserve hierarchy and support collapsed folder selection in both panels', async ({
  page,
}) => {
  await loadNavigationFiles(page);
  for (const panel of ['AIレビューを依頼', '英訳TXTを出力']) {
    await page.getByRole('button', { name: 'メニュー', exact: true }).click();
    await page.getByRole('button', { name: panel, exact: true }).click();
    const folder = page.getByRole('checkbox', { name: 'BasicData/CommonEventを選択', exact: true });
    await expect(page.locator('.export-folder span').first()).toHaveText('BasicData');
    await expect(page.locator('.export-leaf span').first()).toHaveText('000.txt');
    await folder.uncheck();
    await expect(page.locator('[data-export-path]:checked')).toHaveCount(1);
    await page.locator('[data-export-path]').first().check();
    expect(await folder.evaluate((el: HTMLInputElement) => el.indeterminate)).toBe(true);
    await page.getByRole('button', { name: 'BasicData/CommonEventを閉じる', exact: true }).click();
    await expect(page.locator('[data-export-path]').first()).not.toBeVisible();
    await folder.check();
    await expect(page.locator('[data-export-path]:checked')).toHaveCount(4);
    await expect(page.getByRole('checkbox', { name: 'すべて選択', exact: true })).toBeChecked();
    await page.getByRole('button', { name: 'BasicData/CommonEventを開く', exact: true }).click();
    await closeReviewSheet(page);
  }
});

test('review mode stays selected after panel close, history and app restart', async ({
  page,
  context,
}) => {
  await loadFixture(page);
  const open = async (p: Page) => {
    await p.getByRole('button', { name: 'メニュー', exact: true }).click();
    await p.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  };
  await open(page);
  await page.getByRole('radio', { name: '既存コメントに回答・修正する', exact: true }).check();
  await closeReviewSheet(page);
  await open(page);
  await expect(
    page.getByRole('radio', { name: '既存コメントに回答・修正する', exact: true }),
  ).toBeChecked();
  await page
    .getByRole('radio', { name: '英訳をチェックして指摘・修正案を作る', exact: true })
    .check();
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await open(page);
  await expect(
    page.getByRole('radio', { name: '英訳をチェックして指摘・修正案を作る', exact: true }),
  ).toBeChecked();
  await page.reload();
  await expect(page.locator('.busy')).toHaveCount(0);
  await open(page);
  await expect(
    page.getByRole('radio', { name: '英訳をチェックして指摘・修正案を作る', exact: true }),
  ).toBeChecked();
  await page.getByRole('radio', { name: '既存コメントに回答・修正する', exact: true }).check();
  await closeReviewSheet(page);
  const next = await context.newPage();
  await next.goto('/');
  await expect(next.locator('.busy')).toHaveCount(0);
  await page.close();
  await open(next);
  await expect(
    next.getByRole('radio', { name: '既存コメントに回答・修正する', exact: true }),
  ).toBeChecked();
});

test.describe('backup timestamps', () => {
  test.use({ timezoneId: 'Pacific/Honolulu' });
  test('backup download uses the device local date and time and can restore', async ({ page }) => {
    await page.addInitScript(() => {
      const stats = { active: 0, pending: 0, maxPending: 0, maxBytes: 0, urls: new Set<string>() };
      Object.assign(window, { backupStats: stats });
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        tracked: boolean;
        stopped = false;
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          this.tracked = String(url).includes('backup.worker');
          if (this.tracked) {
            stats.active++;
            this.addEventListener('message', ({ data }) => {
              if (data.type === 'ack') stats.pending--;
            });
          }
        }
        override postMessage(
          message: any,
          options: Transferable[] | StructuredSerializeOptions = [],
        ) {
          if (this.tracked) {
            stats.pending++;
            stats.maxPending = Math.max(stats.maxPending, stats.pending);
            stats.maxBytes = Math.max(stats.maxBytes, message.data?.byteLength ?? 0);
          }
          if (Array.isArray(options)) super.postMessage(message, options);
          else super.postMessage(message, options);
        }
        override terminate() {
          if (this.tracked && !this.stopped) stats.active--;
          this.stopped = true;
          super.terminate();
        }
      };
      const create = URL.createObjectURL.bind(URL),
        revoke = URL.revokeObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = create(blob);
        if (blob instanceof Blob && blob.type === 'application/zip') stats.urls.add(url);
        return url;
      };
      URL.revokeObjectURL = (url) => {
        stats.urls.delete(url);
        revoke(url);
      };
    });
    await loadFixture(page);
    await page.clock.setFixedTime(new Date('2026-11-10T05:06:07Z'));
    await postReviewComment(page, '分割境界😀'.repeat(20000));
    await page.getByRole('button', { name: 'メニュー', exact: true }).click();
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: '状態をバックアップ', exact: true }).click();
    const file = await event;
    expect(file.suggestedFilename()).toBe('woditor-review-backup_2026-11-09_19-06-07.zip');
    const backup = await file.path();
    const entries = unzipSync(readFileSync(backup));
    expect(Object.keys(entries)).toEqual(['woditor-review-backup_2026-11-09_19-06-07.json']);
    const text = strFromU8(Object.values(entries)[0]);
    expect(text).not.toContain('\n');
    expect(
      await page.evaluate(() => {
        const { active, pending, maxPending, maxBytes } = (window as any).backupStats;
        return { active, pending, maxPending, maxBytes };
      }),
    ).toEqual({ active: 0, pending: 0, maxPending: 1, maxBytes: 65536 });
    await expect.poll(() => page.evaluate(() => (window as any).backupStats.urls.size)).toBe(0);
    await page.evaluate(() => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (String(url).includes('backup.worker'))
            queueMicrotask(() =>
              this.dispatchEvent(new ErrorEvent('error', { message: 'Compression failure test' })),
            );
        }
      };
    });
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.getByRole('button', { name: 'メニュー', exact: true }).click();
    await page.getByRole('button', { name: '状態をバックアップ', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('Compression failure test');
    await expect(page.locator('.busy')).toHaveCount(0);
    expect(downloads).toBe(0);
    expect(await page.evaluate(() => (window as any).backupStats.active)).toBe(0);
    await postReviewComment(page, 'Keep after canceled restore');
    await page.getByRole('button', { name: 'メニュー', exact: true }).click();
    await page.getByRole('button', { name: 'バックアップを復元', exact: true }).click();
    await page.locator('input[name=backup]').setInputFiles(backup);
    await page.getByRole('button', { name: '復元する', exact: true }).click();
    await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
    await expect(page.locator('.float-preview')).toHaveText('Keep after canceled restore');
    await page.locator('input[name=backup]').setInputFiles({
      name: 'broken.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from('PKbroken'),
    });
    await page.getByRole('button', { name: '復元する', exact: true }).click();
    await expect(page.locator('.toast')).toContainText('バックアップZIP');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.locator('.float-preview')).toHaveText('Keep after canceled restore');
    // An older, indented JSON backup remains compatible too.
    await page.locator('input[name=backup]').setInputFiles({
      name: 'legacy.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(JSON.parse(text), null, 2)),
    });
    await page.getByRole('button', { name: '復元する', exact: true }).click();
    await page.getByRole('button', { name: '確定', exact: true }).click();
    await expect(page.locator('.file-row')).toContainText('MapData');
  });
});
