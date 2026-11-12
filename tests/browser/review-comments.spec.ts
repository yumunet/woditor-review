import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  loadFixture,
  openTreeFile,
  resolveCurrentComment,
  exportCurrentRequest,
  importRevisedAnswer,
  closeReviewSheet,
  sourcePath,
} from './helpers';

test('comment drafts survive closing and Back but clear on item changes and submission', async ({
  page,
}) => {
  await loadFixture(page);
  const composer = page.getByLabel('コメント内容');
  await page.locator('.comment-trigger').click();
  await composer.fill('Draft\nsecond line');
  await closeReviewSheet(page);
  await page.locator('.comment-trigger').click();
  await expect(composer).toHaveValue('Draft\nsecond line');
  await page.keyboard.press('Escape');
  await page.locator('.comment-trigger').click();
  await expect(composer).toHaveValue('Draft\nsecond line');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.comment-trigger').click();
  await expect(composer).toHaveValue('Draft\nsecond line');
  await page.getByRole('button', { name: 'すべてのコメント', exact: true }).click();
  await expect(composer).toHaveValue('Draft\nsecond line');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await expect(composer).toHaveValue('');
  await expect(page.locator('.post-text')).toHaveText('Draft\nsecond line');
  await page.getByRole('button', { name: '返信', exact: true }).click();
  await composer.fill('Unsent reply');
  await closeReviewSheet(page);
  await page.locator('.comment-trigger').click();
  await expect(composer).toHaveValue('Unsent reply');
  await expect(composer).toHaveAttribute('placeholder', '返信を入力');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await composer.fill('Edited draft');
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.comment-trigger').click();
  await expect(composer).toHaveValue('Edited draft');
  await expect(page.getByRole('button', { name: '保存', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(composer).toHaveValue('');
  await expect(page.locator('.post-text')).toHaveText('Edited draft');
  await composer.fill('Discard on navigation');
  await closeReviewSheet(page);
  await page.locator('.entry-open').click();
  await closeReviewSheet(page);
  await page.locator('.comment-trigger').click();
  await expect(composer).toHaveValue('Discard on navigation');
  await closeReviewSheet(page);
  await page.getByRole('button', { name: '次の項目', exact: true }).click();
  await page.locator('.comment-trigger').click();
  await expect(composer).toHaveValue('');
  await closeReviewSheet(page);
  await page.getByRole('button', { name: '前の項目', exact: true }).click();
  await page.locator('.comment-trigger').click();
  await expect(composer).toHaveValue('');
  await expect(composer).toHaveAttribute('placeholder', 'コメントを入力');
});

test('comments, reply preview, confirmations, persistence and backup restore', async ({ page }) => {
  await loadFixture(page);
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  await page.getByLabel('コメント内容').fill('名前の表記を確認');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '編集', exact: true }).click();
  await page.getByLabel('コメント内容').fill('名前の表記を再確認');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.post-text')).toHaveText('名前の表記を再確認');
  await page.getByRole('button', { name: '返信', exact: true }).click();
  await page.getByLabel('コメント内容').fill('最新の返信');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.float-preview')).toHaveText('最新の返信');
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('未解決コメントを解決にしますか？');
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('.float-comment')).toBeVisible();
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('.entry-title')).toHaveText('文章の表示 1');
  await page.getByRole('button', { name: '前の項目', exact: true }).click();
  await page.getByRole('button', { name: '未確認に戻す', exact: true }).click();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('確認済み');
  await page.getByRole('button', { name: '未確認に戻す', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('.entry-title')).toHaveText('イベント名');
  await expect(page.locator('.status')).toHaveText('未確認');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '状態をバックアップ', exact: true }).click();
  const backup = await downloadEvent;
  const backupPath = await backup.path();
  await page.reload();
  for (const name of ['MapData', 'TestMap', 'Event_0000.txt'])
    await page
      .locator('.file-row')
      .filter({ has: page.locator('.row-name', { hasText: name }) })
      .click();
  await page
    .getByRole('button', { name: /コメント/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'すべてのコメント', exact: true }).click();
  await expect(page.locator('.post-text')).toContainText(['名前の表記を再確認', '最新の返信']);
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'バックアップを復元', exact: true }).click();
  await page.locator('input[name=backup]').setInputFiles(backupPath!);
  await page.getByRole('button', { name: '復元する', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('.file-row')).toContainText('MapData');
});

test('undo retains a filtered-out item; comment deletion requires confirmation', async ({
  page,
}) => {
  await loadFixture(page);
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await page.getByRole('button', { name: '前の項目', exact: true }).click();
  await page.locator('.entry-open').click();
  await page.getByRole('button', { name: '確認済み', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.counter')).toHaveText('1 / 1');
  await page.getByRole('button', { name: '未確認に戻す', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('.entry-title')).toHaveText('イベント名');
  await expect(page.locator('.counter')).toHaveText('0 / 0');
  await page.locator('.entry-open').click();
  await page.getByRole('button', { name: 'すべて', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  await page.getByLabel('コメント内容').fill('削除テスト');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('.post-text')).toHaveText('削除テスト');
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('.post-text')).toHaveCount(0);
});

test('manual comment split and merge', async ({ page }) => {
  await loadFixture(page);
  const grouped = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('woditor-review');
      r.onsuccess = () => resolve(r.result);
    });
    const file: any = await new Promise((resolve) => {
      const r = db.transaction('files').objectStore('files').get('MapData/TestMap/Event_0000.txt');
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    const item = file.items.find((i: any) => i.slotIds.length > 1);
    return { title: item.title, count: file.items.length };
  });
  await page.locator('.entry-open').click();
  await page.locator('.pick-row').filter({ hasText: grouped.title }).first().click();
  const source = await page.locator('.source').textContent();
  expect(source).toContain('\n');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'コメントを行ごとに分割', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  expect(await page.locator('.source').textContent()).not.toContain('\n');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '次のコメントと結合', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('.source')).toHaveText(source!);
  await expect(page.locator('.counter')).toHaveText(new RegExp(` / ${grouped.count}$`));
});

test('initial AI review adds comments without changing translations and continues with a correction request', async ({
  page,
}) => {
  await loadFixture(page);
  const original = await page.locator('.translation').innerText();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  await expect(
    page.getByRole('radio', { name: '英訳をチェックして指摘・修正案を作る', exact: true }),
  ).toBeChecked();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを出力', exact: true }).click();
  const request = JSON.parse(readFileSync((await (await event).path())!, 'utf8'));
  expect(request.mode).toBe('initial');
  expect(request.entries).toEqual([]);
  expect(request.targets.length).toBeGreaterThan(1);
  expect(request.targets[0].threads).toEqual([]);
  await closeReviewSheet(page);
  const target = request.targets[0],
    response = {
      schemaVersion: 1,
      requestId: request.requestId,
      responses: [],
      suggestions: [
        {
          id: 'initial-ai-comment',
          path: target.path,
          itemId: target.itemId,
          fileVersion: target.fileVersion,
          reason: '名前表記を確認してください',
          changes: [],
        },
      ],
    };
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビュー結果を読み込む', exact: true }).click();
  await page.locator('input[name=answer]').setInputFiles({
    name: 'initial-response.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(response)),
  });
  await page.getByRole('button', { name: '回答を読み込む', exact: true }).click();
  await expect(page.locator('.float-preview')).toHaveText('名前表記を確認してください');
  await expect(page.locator('.translation')).toHaveText(original);
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await expect(page.locator('.status')).toHaveText('未確認');
  await page.reload();
  await openTreeFile(page, sourcePath);
  await page.locator('.comment-trigger').click();
  await expect(page.locator('.thread-top strong')).toHaveText('AI');
  await page.getByRole('button', { name: '返信', exact: true }).click();
  await page.getByLabel('コメント内容').fill('修正してください');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await closeReviewSheet(page);
  const followup = await exportCurrentRequest(page);
  expect(followup.mode).not.toBe('initial');
  expect(followup.entries[0].posts.map((p: any) => p.author)).toEqual(['ai', 'user']);
  await importRevisedAnswer(page, followup, 'accepted', 'Revised Name', [
    { slotId: target.slots[0].id, before: original, after: 'Revised Name' },
  ]);
  await expect(page.locator('.translation-after')).toHaveText('Revised Name');
  await resolveCurrentComment(page);
  await expect(page.locator('.translation')).toHaveText('Revised Name');
});
