import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync } from 'fflate';
import {
  loadFixture,
  openTreeFile,
  postReviewComment,
  resolveCurrentComment,
  exportCurrentRequest,
  importRevisedAnswer,
  closeReviewSheet,
  sourcePath,
  fixtureTextAt,
} from './helpers';

test('review JSON and revised TXT round trip, AI resolve/reopen and persistence', async ({
  page,
}) => {
  await loadFixture(page);
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  await page.getByLabel('コメント内容').fill('Please correct this name');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを出力', exact: true }).click();
  const downloaded = await downloadEvent;
  const request = JSON.parse(readFileSync((await downloaded.path())!, 'utf8'));
  expect(request.entries).toHaveLength(1);
  await expect(page.getByLabel('ChatGPT向け指示文')).toHaveCount(0);
  const row = request.entries[0];
  const response = {
    schemaVersion: 1,
    requestId: request.requestId,
    suggestions: [],
    responses: [
      {
        commentId: row.commentId,
        path: row.path,
        itemId: row.itemId,
        fileVersion: row.fileVersion,
        decision: 'accepted',
        reason: 'Adjusted the name.',
        changes: [
          { slotId: row.slots[0].id, before: row.slots[0].translation, after: 'Revised Name' },
        ],
      },
    ],
  };
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビュー結果を読み込む', exact: true }).click();
  await page.locator('input[name=answer]').setInputFiles({
    name: 'review_response.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(response)),
  });
  const revised = fixtureTextAt(sourcePath, 'en').replace(
    /EVENT_NAME=[^\r\n]*/,
    'EVENT_NAME=Revised Name',
  );
  await page.locator('input[name=revised]').setInputFiles({
    name: 'revised.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync({ [`en-US/texts/${sourcePath}`]: Buffer.from(revised) })),
  });
  await page.getByRole('button', { name: '回答を読み込む', exact: true }).click();
  await expect(page.locator('.translation-after')).toHaveText('Revised Name');
  await expect(page.locator('.diff-added')).not.toHaveCount(0);
  await expect(page.locator('.diff-deleted')).not.toHaveCount(0);
  await page
    .getByRole('button', { name: /コメント/ })
    .first()
    .click();
  await expect(page.getByRole('button', { name: '編集', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '削除', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '解決', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await expect(page.locator('.translation')).toHaveText('Revised Name');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zipEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zipped = unzipSync(readFileSync((await (await zipEvent).path())!));
  const exported = Buffer.from(zipped[`en-US/texts/${sourcePath}`]).toString('utf8');
  expect(exported).toContain('EVENT_NAME=Revised Name');
  const original = fixtureTextAt(sourcePath, 'en');
  expect(exported.split('[COMMAND_TEXT_START]')[1]).toBe(original.split('[COMMAND_TEXT_START]')[1]);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.reload();
  for (const name of ['MapData', 'TestMap', 'Event_0000.txt'])
    await page
      .locator('.file-row')
      .filter({ has: page.locator('.row-name', { hasText: name }) })
      .click();
  await expect(page.locator('.translation')).toHaveText('Revised Name');
  await page
    .getByRole('button', { name: /コメント/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'すべてのコメント', exact: true }).click();
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.translation')).toHaveText(row.slots[0].translation);
  await expect(page.locator('.translation-after')).toHaveText('Revised Name');
  await page.getByRole('button', { name: '承認', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await page.getByRole('button', { name: '前の項目', exact: true }).click();
  await expect(page.locator('.status')).toHaveText('確認済み');
  await expect(page.locator('.translation')).toHaveText('Revised Name');
});

test('corrected English positions survive JSON export, revised TXT and approved ZIP export', async ({
  page,
}) => {
  const path = 'MapData/TestMap/Event_0001.txt';
  await loadFixture(page, path);
  await page.getByRole('button', { name: '次の項目', exact: true }).click();
  await expect(page.locator('.translation')).toContainText('Hello, Hero.');
  await page.getByRole('button', { name: 'コメント', exact: true }).click();
  await page.getByLabel('コメント内容').fill('Please revise this message');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  let event = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを出力', exact: true }).click();
  const request = JSON.parse(readFileSync((await (await event).path())!, 'utf8')),
    row = request.entries[0],
    slot = row.slots[0];
  const original = fixtureTextAt(path, 'en'),
    lines = original.split(/\r?\n/);
  const first = lines.find((l) => l.startsWith('[101]'))!;
  expect(slot.line).toBe(lines.indexOf(first) + 1);
  expect(slot.line).toBeGreaterThan(Number(slot.id.match(/^L(\d+)/)[1]));
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const after = slot.translation + ' Revised.',
    nl = original.includes('\r\n') ? '\r\n' : '\n';
  const display = lines.find((l) => l.startsWith('■Show Message:'))!;
  const revised = original
    .replace(
      first,
      () =>
        `[103][0,1]<0>()("Extra translator comment")${nl}${first.replace(slot.translation, () => after)}`,
    )
    .replace(display, () => `▼ Extra translator comment${nl}${display}`);
  const response = {
    schemaVersion: 1,
    requestId: request.requestId,
    suggestions: [],
    responses: [
      {
        commentId: row.commentId,
        path,
        itemId: row.itemId,
        fileVersion: row.fileVersion,
        decision: 'accepted',
        reason: 'Revised message',
        changes: [{ slotId: slot.id, before: slot.translation, after }],
      },
    ],
  };
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビュー結果を読み込む', exact: true }).click();
  await page.locator('input[name=answer]').setInputFiles({
    name: 'response.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(response)),
  });
  await page.locator('input[name=revised]').setInputFiles({
    name: 'revised.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync({ [`en-US/texts/${path}`]: Buffer.from(revised) })),
  });
  await page.getByRole('button', { name: '回答を読み込む', exact: true }).click();
  await expect(page.locator('.translation-after')).toHaveText(
    after
      .split(String.raw`<\n>`)
      .join('\n')
      .split('<dqrt>')
      .join('"'),
  );
  await page
    .getByRole('button', { name: /コメント/ })
    .first()
    .click();
  await page.getByRole('button', { name: '解決', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  event = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zip = unzipSync(readFileSync((await (await event).path())!)),
    output = Buffer.from(zip[`en-US/texts/${path}`]).toString('utf8');
  expect(output).toBe(revised);
});

test('rejected reassessment ZIP imports and discarded proposals stay discarded after reopen and restart', async ({
  page,
}) => {
  await loadFixture(page);
  await postReviewComment(page, 'Correct the name');
  const first = await exportCurrentRequest(page),
    slot = first.entries[0].slots[0];
  await importRevisedAnswer(page, first, 'accepted', 'Revised Name', [
    { slotId: slot.id, before: slot.translation, after: 'Revised Name' },
  ]);
  await resolveCurrentComment(page);
  await expect(page.locator('.translation')).toHaveText('Revised Name');
  await page.locator('.comment-trigger').click();
  await page.getByRole('button', { name: 'すべてのコメント', exact: true }).click();
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await page.getByRole('button', { name: '返信', exact: true }).click();
  await page.getByLabel('コメント内容').fill('Please withdraw the previous proposal');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  const second = await exportCurrentRequest(page);
  expect(second.entries[0].pendingChanges[0].after).toBe('Revised Name');
  await importRevisedAnswer(page, second, 'rejected', slot.translation, []);
  await expect(page.locator('.translation-after')).toHaveText('Revised Name');
  await page.getByRole('button', { name: '不採用の変更を破棄', exact: true }).click();
  await page.getByRole('button', { name: 'キャンセル', exact: true }).click();
  await expect(page.locator('.translation-after')).toBeVisible();
  await page.getByRole('button', { name: '不採用の変更を破棄', exact: true }).click();
  await page.getByRole('button', { name: '確定', exact: true }).click();
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await expect(page.locator('.translation')).toHaveText(slot.translation);
  await page.reload();
  await openTreeFile(page, sourcePath);
  await expect(page.getByRole('button', { name: '不採用の変更を破棄', exact: true })).toHaveCount(
    0,
  );
  await resolveCurrentComment(page);
  await page.locator('.comment-trigger').click();
  await page.getByRole('button', { name: 'すべてのコメント', exact: true }).click();
  await page.getByRole('button', { name: '再開', exact: true }).click();
  await expect(page.locator('.post-text')).toContainText([
    'Correct the name',
    'Corrected spelling',
    'Please withdraw the previous proposal',
    'Withdrawn after reconsideration',
  ]);
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zipEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zip = readFileSync((await (await zipEvent).path())!);
  expect(Buffer.from(unzipSync(zip)[`en-US/texts/${sourcePath}`]).toString('utf8')).toContain(
    `EVENT_NAME=${slot.translation}`,
  );
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  await page
    .locator('input[name=en]')
    .setInputFiles({ name: 'reviewed.zip', mimeType: 'application/zip', buffer: zip });
  await expect(page.locator('input[name=ja]')).not.toHaveAttribute('required');
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0);
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await expect(page.locator('.translation')).toHaveText(slot.translation);
});

test('database CSV multiline strings round trip through AI approval, ZIP and English-only reload', async ({
  page,
}) => {
  const path = 'BasicData/DataBase/00.txt';
  await loadFixture(page, path);
  await page.locator('.entry-open').click();
  await page
    .locator('.pick-row')
    .filter({ has: page.locator('.pick-title', { hasText: /^データ 0 \/ 項目 0$/ }) })
    .click();
  expect(await page.locator('.source').textContent()).toContain('\n');
  await postReviewComment(page, 'Review CSV wording');
  const request = await exportCurrentRequest(page),
    entry = request.entries[0],
    slot = entry.slots[0];
  expect(slot.kind).toBe('database_csv');
  const after = 'Revised, "quoted" text\r\nSecond line\r\nThird line';
  const response = {
    schemaVersion: 1,
    requestId: request.requestId,
    suggestions: [],
    responses: [
      {
        commentId: entry.commentId,
        path,
        itemId: entry.itemId,
        fileVersion: entry.fileVersion,
        decision: 'accepted',
        reason: 'CSV wording revised',
        changes: [{ slotId: slot.id, before: slot.translation, after }],
      },
    ],
  };
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビュー結果を読み込む', exact: true }).click();
  await page.locator('input[name=answer]').setInputFiles({
    name: 'csv-response.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(response)),
  });
  await page.getByRole('button', { name: '回答を読み込む', exact: true }).click();
  await expect(page.locator('.translation-after')).toHaveText(after);
  await resolveCurrentComment(page);
  await expect(page.locator('.translation')).toHaveText(after);
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zip = readFileSync((await (await event).path())!);
  const output = Buffer.from(unzipSync(zip)[`en-US/texts/${path}`]).toString('utf8');
  const original = fixtureTextAt(path, 'en');
  expect(output).toBe(
    original.replace(
      '"' + slot.translation.replaceAll('"', '""') + '"',
      '"' + after.replaceAll('"', '""') + '"',
    ),
  );
  await closeReviewSheet(page);
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  await page
    .locator('input[name=en]')
    .setInputFiles({ name: 'csv-reviewed.zip', mimeType: 'application/zip', buffer: zip });
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0);
  await page.getByRole('button', { name: '上書きする', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0);
  if (await page.getByRole('dialog').count()) await closeReviewSheet(page);
  await expect(page.locator('.translation')).toHaveText(after);
  await expect(page.locator('.translation-after')).toHaveCount(0);
});
