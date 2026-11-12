import { expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { zipSync } from 'fflate';
import { fixtureTextAt, navigationPaths, sourcePath } from '../helpers/woditor';
export {
  fixtures,
  fixtureText,
  fixtureTextAt,
  navigationPaths,
  sourcePath,
} from '../helpers/woditor';

export async function closeReviewSheet(page: Page) {
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
}
export async function openTreeFile(page: Page, path: string) {
  if (await page.getByRole('button', { name: '戻る', exact: true }).count())
    await page.getByRole('button', { name: '戻る', exact: true }).click();
  const parts = path.split('/');
  for (let index = 0; index < parts.length; index++) {
    const row = page.locator(`.file-row[data-value="${parts.slice(0, index + 1).join('/')}"]`);
    if (index === parts.length - 1 || (await row.getAttribute('aria-expanded')) === 'false')
      await row.click();
  }
}
export async function importPairs(
  page: Page,
  pairs: { path: string; ja: string; en: string }[],
  base = '/',
) {
  await page.goto(base);
  await expect(page.locator('.busy')).toHaveCount(0);
  if (!(await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).count()))
    await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  for (const language of ['ja', 'en'] as const) {
    const locale = language === 'ja' ? 'ja-JP' : 'en-US';
    const buffer = Buffer.from(
      zipSync(
        Object.fromEntries(
          pairs.map((pair) => [`extra/${locale}/texts/${pair.path}`, Buffer.from(pair[language])]),
        ),
      ),
    );
    await page
      .locator(`input[name=${language}]`)
      .setInputFiles({ name: locale + '.zip', mimeType: 'application/zip', buffer });
  }
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90000 });
  if (await page.getByRole('alertdialog', { name: '英訳の上書き', exact: true }).count()) {
    await page.getByRole('button', { name: '上書きする', exact: true }).click();
    await expect(page.locator('.busy')).toHaveCount(0);
  }
}
export async function loadFixture(page: Page, path = sourcePath) {
  await importPairs(page, [{ path, ja: fixtureTextAt(path, 'ja'), en: fixtureTextAt(path, 'en') }]);
  if (await page.getByRole('dialog').count()) await closeReviewSheet(page);
  await openTreeFile(page, path);
  await expect(page.locator('.source')).toBeVisible();
}
export async function loadNavigationFiles(page: Page) {
  await importPairs(
    page,
    navigationPaths.map((path) => ({
      path,
      ja: fixtureTextAt(path, 'ja'),
      en: fixtureTextAt(path, 'en'),
    })),
  );
  if (await page.getByRole('dialog').count()) await closeReviewSheet(page);
}
export async function postReviewComment(page: Page, text: string) {
  await page.locator('.comment-trigger').click();
  await page.getByLabel('コメント内容').fill(text);
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await closeReviewSheet(page);
}
export async function resolveCurrentComment(page: Page) {
  await page.locator('.comment-trigger').click();
  await page.getByRole('button', { name: '解決', exact: true }).click();
  await closeReviewSheet(page);
}
export async function exportCurrentRequest(page: Page) {
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビューを依頼', exact: true }).click();
  await page.getByRole('radio', { name: '既存コメントに回答・修正する', exact: true }).check();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'JSONを出力', exact: true }).click();
  const file = await pending,
    request = JSON.parse(readFileSync((await file.path())!, 'utf8'));
  expect(file.suggestedFilename()).toBe(
    `review_request_${request.requestId.replace(/-/g, '').slice(0, 12)}.json`,
  );
  await closeReviewSheet(page);
  return request;
}
export async function importRevisedAnswer(
  page: Page,
  request: any,
  decision: string,
  translation: string,
  changes: any[],
) {
  const entry = request.entries[0],
    response = {
      schemaVersion: 1,
      requestId: request.requestId,
      suggestions: [],
      responses: [
        {
          commentId: entry.commentId,
          path: entry.path,
          itemId: entry.itemId,
          fileVersion: entry.fileVersion,
          decision,
          reason:
            decision === 'rejected' ? 'Withdrawn after reconsideration' : 'Corrected spelling',
          changes,
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
  const revised = fixtureTextAt(sourcePath, 'en').replace(
    /EVENT_NAME=[^\r\n]*/,
    `EVENT_NAME=${translation}`,
  );
  await page.locator('input[name=revised]').setInputFiles({
    name: 'revised.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(zipSync({ ['en-US/texts/' + sourcePath]: Buffer.from(revised) })),
  });
  await page.getByRole('button', { name: '回答を読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}
