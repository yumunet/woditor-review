import { test, expect, type Page } from '@playwright/test';
import { zipSync, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { captureUi } from './screenshots';

const path = 'BasicData/CommonEvent/000.txt';
const ja =
  'COMMON_ID=0\nCOMMON_NAME=名前\nMEMO=説明\nRETURN_VAL_NAME=結果\nWoditorEvCOMMAND_START\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n[COMMAND_TEXT_END]\n';
const en = ja.replace('名前', 'Name').replace('説明', 'Memo').replace('結果', 'Result');
const zip = (file: string, text: string) => Buffer.from(zipSync({ [file]: Buffer.from(text) }));
async function beginImport(page: Page, english: string, source?: string, file = path) {
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'メニュー', exact: true })
    .getByRole('button', { name: 'ファイルを読み込む', exact: true })
    .click();
  if (source)
    await page
      .locator('input[name=ja]')
      .setInputFiles({ name: 'ja.zip', mimeType: 'application/zip', buffer: zip(file, source) });
  await page
    .locator('input[name=en]')
    .setInputFiles({ name: 'en.zip', mimeType: 'application/zip', buffer: zip(file, english) });
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90000 });
}
async function openFile(page: Page, file = path) {
  for (const part of ['BasicData', 'BasicData/CommonEvent', file])
    await page.locator(`.file-row[data-value="${part}"]`).click();
}
async function setup(page: Page) {
  await page.goto('/');
  await expect(page.locator('.busy')).toHaveCount(0);
  await beginImport(page, en, ja);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await openFile(page);
}
async function finishImport(page: Page) {
  await page.getByRole('button', { name: '上書きする', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}
async function saved(page: Page) {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('woditor-review');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Test database open failed'));
    });
    const files: any[] = await new Promise((resolve) => {
      const request = db.transaction('files').objectStore('files').getAll();
      request.onsuccess = () => resolve(request.result);
    });
    db.close();
    return files;
  });
}
async function pick(page: Page, title: string) {
  await page.locator('.entry-open').click();
  await page
    .locator('.pick-row')
    .filter({ has: page.locator('.pick-title', { hasText: new RegExp(`^${title}$`) }) })
    .click();
}

test('a restored confirmation cannot overwrite approval changes made after cancellation', async ({
  page,
}) => {
  await setup(page);
  const revised = en.replace('COMMON_NAME=Name', 'COMMON_NAME=External name');
  await beginImport(page, revised);
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await expect(page.locator('.entry-title')).toHaveText('メモ');
  await page.goForward();
  await expect(page.getByRole('alertdialog', { name: '英訳の上書き', exact: true })).toBeVisible();
  await finishImport(page);
  await expect(page.getByRole('status')).toContainText('もう一度読み込んでください');
  const files = await saved(page),
    file = files[0],
    slot = file.slots.find((s: any) => s.key === 'COMMON_NAME');
  expect(slot.translation).toBe('Name');
  expect(file.items.find((i: any) => i.slotIds.includes(slot.id)).approved).toBe(true);
  await beginImport(page, revised);
  await finishImport(page);
  await expect(page.locator('.translation')).toHaveText('External name');
  await expect(page.locator('.status')).toHaveText('確認済み');
});

test('overwrite confirmation cancels safely, defaults to preserving approval, and persists exact English without a diff', async ({
  page,
}, info) => {
  await setup(page);
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await pick(page, 'コモンイベント名');
  const before = await saved(page),
    revised = en.replace('COMMON_NAME=Name', 'COMMON_NAME=Externally reviewed');
  await beginImport(page, revised);
  const dialog = page.getByRole('alertdialog', { name: '英訳の上書き', exact: true }),
    reset = page.getByRole('checkbox', { name: '変更された項目を未確認に戻す', exact: true });
  await expect(dialog.locator('dd')).toHaveText(['1件', '1件', '0件']);
  await expect(reset).not.toBeChecked();
  expect(await saved(page)).toEqual(before);
  await captureUi(page, info, 'import-overwrite', '.import-confirmation');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await saved(page)).toEqual(before);
  await expect(page.locator('.translation')).toHaveText('Name');
  await beginImport(page, revised);
  await reset.check();
  await page.goBack();
  await expect(dialog).toHaveCount(0);
  expect(await saved(page)).toEqual(before);
  await beginImport(page, revised);
  await expect(reset).not.toBeChecked();
  await finishImport(page);
  await expect(page.locator('.translation')).toHaveText('Externally reviewed');
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await expect(page.locator('.status')).toHaveText('確認済み');
  await page.reload();
  await expect(page.locator('.busy')).toHaveCount(0);
  await openFile(page);
  await expect(page.locator('.translation')).toHaveText('Externally reviewed');
  await expect(page.locator('.status')).toHaveText('確認済み');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const output = unzipSync(readFileSync(await (await downloading).path()));
  expect(Buffer.from(output['en-US/texts/' + path]).toString('utf8')).toBe(revised);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await beginImport(page, revised.replace('Externally reviewed', 'Another external revision'));
  await reset.check();
  await finishImport(page);
  await expect(page.locator('.status')).toHaveText('未確認');
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await pick(page, 'メモ');
  await expect(page.locator('.status')).toHaveText('確認済み');
  await beginImport(
    page,
    en.replace('COMMON_ID=0', 'COMMON_ID=1'),
    ja.replace('COMMON_ID=0', 'COMMON_ID=1'),
    'BasicData/CommonEvent/001.txt',
  );
  await expect(dialog).toHaveCount(0);
  const files = await saved(page);
  expect(files).toHaveLength(2);
  expect(
    files.find((f) => f.path === path).slots.find((s: any) => s.key === 'COMMON_NAME').translation,
  ).toBe('Another external revision');
  expect(files.find((f) => f.path.endsWith('001.txt')).items.every((i: any) => !i.approved)).toBe(
    true,
  );
});

test('overwriting one AI proposal preserves conversations and untouched proposals; old comments cannot undo the new baseline', async ({
  page,
}, info) => {
  await setup(page);
  for (const title of ['コモンイベント名', 'メモ']) {
    await pick(page, title);
    await page.locator('.comment-trigger').click();
    await page.getByLabel('コメント内容').fill('Review ' + title);
    await page.getByRole('button', { name: '送信', exact: true }).click();
    await page.getByRole('button', { name: '閉じる', exact: true }).click();
  }
  await pick(page, 'コモンイベント名');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを出力', exact: true }).click();
  const request = JSON.parse(readFileSync(await (await downloading).path(), 'utf8'));
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const response = {
    schemaVersion: 1,
    requestId: request.requestId,
    suggestions: [],
    responses: request.entries.map((entry: any) => ({
      commentId: entry.commentId,
      path: entry.path,
      itemId: entry.itemId,
      fileVersion: entry.fileVersion,
      decision: 'accepted',
      reason: 'AI wording',
      changes: [
        {
          slotId: entry.slots[0].id,
          before: entry.slots[0].translation,
          after: entry.slots[0].key === 'MEMO' ? 'AI memo' : 'AI name',
        },
      ],
    })),
  };
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビュー結果を読み込む', exact: true }).click();
  await page.locator('input[name=answer]').setInputFiles({
    name: 'response.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(response)),
  });
  await page.getByRole('button', { name: '回答を読み込む', exact: true }).click();
  await expect(page.locator('.translation-after')).toHaveText('AI name');
  await beginImport(page, en.replace('COMMON_NAME=Name', 'COMMON_NAME=External name'));
  const dialog = page.getByRole('alertdialog', { name: '英訳の上書き', exact: true });
  await expect(dialog.locator('dd')).toHaveText(['1件', '1件', '1件']);
  await captureUi(page, info, 'import-overwrite', '.import-confirmation');
  await finishImport(page);
  await expect(page.locator('.translation')).toHaveText('External name');
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await page.locator('.comment-trigger').click();
  await expect(page.locator('.post-text')).toHaveText(['Review コモンイベント名', 'AI wording']);
  await page.getByRole('button', { name: '解決', exact: true }).click();
  await page.getByRole('button', { name: 'すべてのコメント', exact: true }).click();
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.translation')).toHaveText('External name');
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await pick(page, 'メモ');
  await expect(page.locator('.translation')).toHaveText('Memo');
  await expect(page.locator('.translation-after')).toHaveText('AI memo');
  await page.locator('.comment-trigger').click();
  await page.getByRole('button', { name: '解決', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.translation')).toHaveText('AI memo');
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await pick(page, 'メモ');
  await beginImport(
    page,
    en
      .replace('COMMON_NAME=Name', 'COMMON_NAME=External name')
      .replace('MEMO=Memo', 'MEMO=External memo'),
  );
  await expect(dialog.locator('dd')).toHaveText(['1件', '1件', '0件']);
  await finishImport(page);
  await expect(page.locator('.status')).toHaveText('確認済み');
  await expect(page.locator('.translation')).toHaveText('External memo');
  await page.locator('.comment-trigger').click();
  await page.getByRole('button', { name: 'すべてのコメント', exact: true }).click();
  await expect(page.locator('.thread-status')).toHaveText('解決済み');
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.translation')).toHaveText('External memo');
  await expect(page.locator('.translation-after')).toHaveCount(0);
});
