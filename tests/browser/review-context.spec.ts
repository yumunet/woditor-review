import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { zipSync, unzipSync } from 'fflate';
import { captureUi } from './screenshots';
import {
  loadFixture,
  openTreeFile,
  postReviewComment,
  resolveCurrentComment,
  exportCurrentRequest,
  closeReviewSheet,
  navigationPaths,
  fixtureTextAt,
} from './helpers';

test('floating comments reveal the displayed post without focusing the composer, including history and replies', async ({
  page,
}) => {
  await loadFixture(page);
  await page.locator('.comment-trigger').click();
  const composer = page.getByLabel('コメント内容');
  await expect(composer).toBeFocused();
  for (let i = 0; i < 3; i++) {
    await composer.fill(`Thread ${i}\n` + 'Review details\n'.repeat(8));
    await page.getByRole('button', { name: '送信', exact: true }).click();
  }
  await page.getByRole('button', { name: 'すべてのコメント', exact: true }).click();
  await page.locator('.thread').first().getByRole('button', { name: '解決', exact: true }).click();
  await page.locator('.thread').nth(1).getByRole('button', { name: '返信', exact: true }).click();
  await composer.fill('この返信を表示');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await composer.fill('未送信の下書き');
  await closeReviewSheet(page);
  await expect(page.locator('.float-preview')).toHaveText('この返信を表示');
  const postId = await page.locator('.float-comment').getAttribute('data-value');
  await page.locator('.float-comment').click();
  const post = page.locator(`[data-post-id="${postId}"]`);
  await expect(post).toHaveClass('reply');
  await expect(post).toBeInViewport();
  await expect(post).toBeFocused();
  await expect(composer).not.toBeFocused();
  await expect(composer).toHaveValue('未送信の下書き');
  expect(await page.locator('.comments-list').evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await page.goBack();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.goForward();
  await expect(post).toBeInViewport();
  await expect(post).toBeFocused();
  await expect(composer).not.toBeFocused();
  await closeReviewSheet(page);
  await page.locator('.comment-trigger').click();
  await expect(composer).toBeFocused();
  await expect(composer).toHaveValue('未送信の下書き');
  await composer.fill('最新の新規コメント');
  await page.getByRole('button', { name: '送信', exact: true }).click();
  await closeReviewSheet(page);
  await expect(page.locator('.float-preview')).toHaveText('最新の新規コメント');
  await page.locator('.float-comment').click();
  const root = page
    .locator('.thread-root')
    .filter({ has: page.locator('.post-text', { hasText: '最新の新規コメント' }) });
  await expect(root).toBeInViewport();
  await expect(root).toBeFocused();
  await expect(composer).not.toBeFocused();
});

test('database memo displays encoded line breaks and multiline previews without changing exported TXT', async ({
  page,
}) => {
  const path = 'BasicData/DataBase/00.txt';
  await loadFixture(page, path);
  await page.locator('.entry-open').click();
  await expect(page.locator('.pick-title', { hasText: /^項目名 0$/ })).toHaveCount(1);
  const memo = page
    .locator('.pick-row')
    .filter({ has: page.locator('.pick-title', { hasText: /^メモ$/ }) });
  await expect(memo.locator('.pick-source')).toContainText('...');
  await memo.click();
  const source = await page.locator('.source').textContent();
  expect(source).toContain('\n');
  expect(source).not.toContain(String.raw`<<\n>>`);
  await expect(page.locator('.slot-warning.subtle')).toHaveCount(0);
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zip = unzipSync(readFileSync(await (await event).path()));
  expect(
    Buffer.from(zip[`en-US/texts/${path}`]).equals(Buffer.from(fixtureTextAt(path, 'en'))),
  ).toBe(true);
});

test('message line breaks and message and comment quotes are readable while TXT remains encoded', async ({
  page,
}) => {
  const path = 'BasicData/CommonEvent/000.txt';
  const fixture = (text: string, comment: string) =>
    `COMMON_ID=0\nWoditorEvCOMMAND_START\n[101][0,1]<0>()("${text}")\n[103][0,1]<0>()("${comment}")\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n■Show Message:${text}\n▼ ${comment}\n[COMMAND_TEXT_END]\n`;
  const ja = fixture(String.raw`一行目<\n><dqrt>二行目<dqrt>`, '<dqrt>注記<dqrt>'),
    en = fixture(String.raw`First<\n><dqrt>Second<dqrt>`, '<dqrt>Note<dqrt>');
  await page.goto('/');
  await expect(page.locator('.busy')).toHaveCount(0);
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  for (const [name, text] of [
    ['ja', ja],
    ['en', en],
  ])
    await page.locator(`input[name=${name}]`).setInputFiles({
      name: name + '.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(zipSync({ [path]: Buffer.from(text) })),
    });
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90000 });
  if (await page.getByRole('dialog').count()) await closeReviewSheet(page);
  await openTreeFile(page, path);
  await expect(page.locator('.source')).toHaveText('一行目\n"二行目"');
  await expect(page.locator('.translation')).toHaveText('First\n"Second"');
  await page.locator('.entry-open').click();
  await expect(page.locator('.pick-source').first()).toHaveText('一行目...');
  await page
    .locator('.pick-row')
    .filter({ has: page.locator('.pick-title', { hasText: /^コメント/ }) })
    .click();
  await expect(page.locator('.source')).toHaveText('"注記"');
  await expect(page.locator('.translation')).toHaveText('"Note"');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zip = unzipSync(readFileSync(await (await download).path()));
  expect(Buffer.from(zip[`en-US/texts/${path}`]).toString('utf8')).toBe(en);
});

test('database CSV columns start at item zero and only mode zero exposes explicit names through AI and ZIP', async ({
  page,
}) => {
  const entries = [0, 1, 2, 110000].map((mode, index) => {
    const path = `BasicData/DataBase/0${index}.txt`,
      ja = `TYPE_ID=${index}\nDATANAME_LOAD_TYPE=${mode}\nITEM_NUM=2\nITEMNAME0=最初の項目\nITEMNAME1=次の項目\n<<--CSV_START-->>\n"最初の項目","次の項目",\n"一つ目","二つ目",<<!--DATANAME--!>>独立名,\n<<--CSV_END-->>\n`;
    return {
      path,
      mode,
      ja,
      en: ja
        .replaceAll('最初の項目', 'First field')
        .replaceAll('次の項目', 'Second field')
        .replace('一つ目', 'First')
        .replace('二つ目', 'Second')
        .replace('独立名', 'Explicit name'),
    };
  });
  await page.goto('/');
  await expect(page.locator('.busy')).toHaveCount(0);
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  for (const name of ['ja', 'en'] as const)
    await page.locator(`input[name=${name}]`).setInputFiles({
      name: name + '.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(
        zipSync(Object.fromEntries(entries.map((entry) => [entry.path, Buffer.from(entry[name])]))),
      ),
    });
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90000 });
  if (await page.getByRole('dialog').count()) await closeReviewSheet(page);
  for (const entry of entries) {
    await openTreeFile(page, entry.path);
    await page.locator('.entry-open').click();
    const row = (title: string) =>
      page
        .locator('.pick-row')
        .filter({ has: page.locator('.pick-title', { hasText: new RegExp(`^${title}$`) }) });
    if (entry.mode === 0) {
      const titles = await page.locator('.pick-title').allTextContents();
      expect(titles.indexOf('データ名 0')).toBeLessThan(titles.indexOf('データ 0 / 項目 0'));
      await row('データ名 0').click();
      await page.getByRole('button', { name: '次の項目', exact: true }).click();
      await expect(page.locator('.entry-title')).toHaveText('データ 0 / 項目 0');
      await page.getByRole('button', { name: '前の項目', exact: true }).click();
      await expect(page.locator('.entry-title')).toHaveText('データ名 0');
      await page.getByRole('button', { name: '承認', exact: true }).click();
      await expect(page.locator('.entry-title')).toHaveText('データ 0 / 項目 0');
      await page.locator('.entry-open').click();
    }
    await expect(row('データ名 0')).toHaveCount(entry.mode === 0 ? 1 : 0);
    await row('データ 0 / 項目 0').click();
    await expect(page.locator('.source')).toHaveText('一つ目');
    await page.locator('.entry-open').click();
    await row('データ 0 / 項目 1').click();
    await expect(page.locator('.source')).toHaveText('二つ目');
  }
  await openTreeFile(page, entries[0].path);
  await page.locator('.entry-open').click();
  await page
    .locator('.pick-row')
    .filter({ has: page.locator('.pick-title', { hasText: /^データ名 0$/ }) })
    .click();
  await expect(page.locator('.source')).toHaveText('独立名');
  await postReviewComment(page, 'Review the explicit name');
  const request = await exportCurrentRequest(page),
    slot = request.entries[0].slots[0],
    after = 'New, "quoted", name';
  expect(slot.key).toBe('CSV_D0_NAME');
  const response = {
    schemaVersion: 1,
    requestId: request.requestId,
    suggestions: [],
    responses: [
      {
        commentId: request.entries[0].commentId,
        path: entries[0].path,
        itemId: request.entries[0].itemId,
        fileVersion: request.entries[0].fileVersion,
        decision: 'accepted',
        reason: 'Name revised',
        changes: [{ slotId: slot.id, before: slot.translation, after }],
      },
    ],
  };
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: 'AIレビュー結果を読み込む', exact: true }).click();
  await page.locator('input[name=answer]').setInputFiles({
    name: 'name.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(response)),
  });
  await page.getByRole('button', { name: '回答を読み込む', exact: true }).click();
  await resolveCurrentComment(page);
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zip = unzipSync(readFileSync(await (await download).path()));
  expect(Buffer.from(zip[`en-US/texts/${entries[0].path}`]).toString('utf8')).toBe(
    entries[0].en.replace('<<!--DATANAME--!>>Explicit name,', `<<!--DATANAME--!>>${after},`),
  );
});

test('empty original database data cells are omitted from review while English-only contents survive export', async ({
  page,
}) => {
  const path = 'BasicData/DataBase/00.txt';
  const ja =
    'TYPE_ID=0\nDATANAME_LOAD_TYPE=0\nITEM_NUM=1\nITEMNAME0=説明\n<<--CSV_START-->>\n"説明",\n"",<<!--DATANAME--!>>名前,\n"本文",<<!--DATANAME--!>>,\n<<--CSV_END-->>\n';
  const en = ja
    .replace('ITEMNAME0=説明', 'ITEMNAME0=Description')
    .replace('"",<<!--DATANAME--!>>名前', '"Keep this English",<<!--DATANAME--!>>Name')
    .replace('"本文",<<!--DATANAME--!>>', '"Text",<<!--DATANAME--!>>Keep this name');
  await page.goto('/');
  await expect(page.locator('.busy')).toHaveCount(0);
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  for (const [name, text] of [
    ['ja', ja],
    ['en', en],
  ])
    await page.locator(`input[name=${name}]`).setInputFiles({
      name: name + '.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(zipSync({ [path]: Buffer.from(text) })),
    });
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90000 });
  if (await page.getByRole('dialog').count()) await closeReviewSheet(page);
  await openTreeFile(page, path);
  await page.locator('.entry-open').click();
  await expect(page.locator('.pick-row')).toHaveCount(3);
  await expect(page.locator('.pick-title', { hasText: /^データ 0 \/ 項目 0$/ })).toHaveCount(0);
  await expect(page.locator('.pick-title', { hasText: /^データ名 1$/ })).toHaveCount(0);
  await closeReviewSheet(page);
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const zip = unzipSync(readFileSync(await (await download).path()));
  expect(Buffer.from(zip[`en-US/texts/${path}`]).toString('utf8')).toBe(en);
});

test('context controls retain all options and full view marks every variable usage', async ({
  page,
}, info) => {
  await loadFixture(page, navigationPaths[0]);
  const target = await page.evaluate(async (path) => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = indexedDB.open('woditor-review');
      r.onsuccess = () => resolve(r.result);
    });
    const file: any = await new Promise((resolve) => {
      const r = db.transaction('files').objectStore('files').get(path);
      r.onsuccess = () => resolve(r.result);
    });
    db.close();
    const item = file.items.find((i: any) => file.usages[i.slotIds[0]]?.length > 1),
      hits = file.usages[item.slotIds[0]],
      index = file.commands.findIndex((c: any) => c.line === hits[0]);
    return {
      id: item.id,
      hits: hits.length,
      commands: file.commands.length,
      partial: Math.min(file.commands.length, index + 8) - Math.max(0, index - 7),
      ja: file.commands[0].ja,
    };
  }, navigationPaths[0]);
  await page.locator('.entry-open').click();
  await page.locator(`.pick-row[data-value="${target.id}"]`).click();
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  await button('前後の行数').click();
  await page.getByRole('option', { name: '7行', exact: true }).click();
  await expect(page.locator('.command')).toHaveCount(target.partial);
  await button('ファイル全体を表示').click();
  await expect(button('前後の行数')).toBeDisabled();
  await expect(page.locator('.command')).toHaveCount(target.commands);
  await expect(page.locator('.command.current')).toHaveCount(target.hits);
  await expect(page.locator('.usage-tools')).toHaveText(`使用箇所 ${target.hits}件`);
  await expect(button('次の使用箇所')).toHaveCount(0);
  await captureUi(page, info, 'context-full', '.context-tools');
  await button('行番号').click();
  await expect(page.locator('.command-number').first()).toHaveText('0');
  await button('行の折り返し').click();
  await expect(page.locator('.command-code').first()).toHaveCSS('white-space', 'pre');
  await button('表示言語').click();
  await page.getByRole('option', { name: '日本語', exact: true }).click();
  await expect(page.locator('.command-code').first()).toHaveText(target.ja);
  if (info.project.name === 'desktop') await button('行番号').hover();
  else {
    await button('行番号').dispatchEvent('pointerdown', { pointerType: 'touch' });
  }
  await expect(page.getByRole('tooltip')).toHaveText('行番号');
  if (info.project.name === 'mobile') {
    await button('行番号').dispatchEvent('pointerup', { pointerType: 'touch' });
    await button('行番号').dispatchEvent('click');
    await expect(button('行番号')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.locator('.context-title').click();
  await expect(page.locator('.command-frame')).toHaveCount(0);
  await page.getByRole('button', { name: '次の項目', exact: true }).click();
  await expect(page.locator('.command-frame')).toHaveCount(0);
  await page.reload();
  await openTreeFile(page, navigationPaths[0]);
  await page.locator('.entry-open').click();
  await page.locator(`.pick-row[data-value="${target.id}"]`).click();
  await expect(page.locator('.context-title')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('.context-title').click();
  await expect(button('ファイル全体を表示')).toHaveAttribute('aria-pressed', 'true');
  await expect(button('行番号')).toHaveAttribute('aria-pressed', 'true');
  await expect(button('行の折り返し')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.command-code').first()).toHaveText(target.ja);
  await expect(button('前後の行数')).toBeDisabled();
  await button('ファイル全体を表示').click();
  await expect(button('前後の行数')).toBeEnabled();
  await expect(page.locator('.command')).toHaveCount(target.partial);
  await button('前後の行数').click();
  await expect(page.getByRole('option', { name: '7行', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  const title = await page.locator('.entry-title').textContent();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('.entry-title')).toHaveText(title!);
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page.locator('.command')).toHaveCount(target.partial);
});

test('comments focus the composer, show scroll directions and fit the keyboard viewport with short search results', async ({
  page,
}, info) => {
  await loadFixture(page);
  const source = await page.locator('.entry-title').textContent();
  await page.locator('.comment-trigger').click();
  await expect(page.getByLabel('コメント内容')).toBeFocused();
  const up = page.getByRole('button', { name: 'コメントを上にスクロール', exact: true }),
    down = page.getByRole('button', { name: 'コメントを下にスクロール', exact: true });
  await expect(up).toBeHidden();
  await expect(down).toBeHidden();
  for (let i = 0; i < 3; i++) {
    await page.getByLabel('コメント内容').fill(`Comment ${i}\n` + 'Long review line\n'.repeat(8));
    await page.getByRole('button', { name: '送信', exact: true }).click();
  }
  await expect(down).toBeVisible();
  await expect(up).toBeHidden();
  await captureUi(page, info, 'comment-scroll');
  await down.click();
  await expect(up).toBeVisible();
  const list = page.locator('.comments-list');
  await list.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(down).toBeHidden();
  await expect(up).toBeVisible();
  await up.click();
  await expect(down).toBeVisible();
  const resize = async (height: number, top = 0) => {
    await page.evaluate(
      ({ height, top }) => {
        Object.defineProperty(visualViewport!, 'height', { configurable: true, value: height });
        Object.defineProperty(visualViewport!, 'offsetTop', { configurable: true, value: top });
        visualViewport!.dispatchEvent(new Event('resize'));
      },
      { height, top },
    );
    await expect.poll(async () => (await page.locator('#app').boundingBox())!.height).toBe(height);
  };
  await page.getByLabel('コメント内容').focus();
  await resize(430, 30);
  const panel = await page.getByRole('dialog', { name: 'コメント', exact: true }).boundingBox(),
    composer = await page.getByLabel('コメント内容').boundingBox();
  expect(panel!.y).toBeGreaterThanOrEqual(30);
  expect(panel!.y + panel!.height).toBeLessThanOrEqual(460);
  expect(composer!.y + composer!.height).toBeLessThan(460);
  await page.evaluate(() => scrollTo(0, 200));
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await closeReviewSheet(page);
  await resize(page.viewportSize()!.height);
  await page.locator('.entry-open').click();
  await page.getByLabel('翻訳項目を検索').focus();
  await page.getByLabel('翻訳項目を検索').fill(source!);
  await expect(page.locator('.pick-row')).toHaveCount(1);
  await resize(400);
  const picker = await page.getByRole('dialog', { name: '翻訳項目', exact: true }).boundingBox();
  expect(picker!.y).toBeGreaterThanOrEqual(0);
  expect(picker!.y + picker!.height).toBeLessThanOrEqual(400);
  await page.evaluate(() => scrollTo(0, 200));
  expect(await page.evaluate(() => scrollY)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(
    true,
  );
});

test('database field originals appear below English for choices and CSV values with persistent collapse', async ({
  page,
}, info) => {
  const path = 'BasicData/DataBase/00.txt';
  const ja =
    'TYPE_ID=0\nDATANAME_LOAD_TYPE=0\nITEM_NUM=2\nITEMNAME0=日本語の説明\nITEMNAME1=ASCII original label\nITEM_LOADTYPE_0=3\nITEM_LOADTYPE_1=0\nCHOICE_NAME_0_NUM=1\nCHOICE_NAME_0_0=選択肢\nCHOICE_VAL_0_NUM=1\nCHOICE_VAL_0_0=0\n<<--CSV_START-->>\n"日本語の説明","ASCII original label",\n"最初の値","次の値",<<!--DATANAME--!>>データ名,\n<<--CSV_END-->>\n';
  const en = ja
    .replaceAll('日本語の説明', 'Description')
    .replaceAll('ASCII original label', 'English field label')
    .replace('選択肢', 'Choice')
    .replace('最初の値', 'First value')
    .replace('次の値', 'Second value')
    .replace('>>データ名,', '>>Data name,');
  await page.goto('/');
  await expect(page.locator('.busy')).toHaveCount(0);
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  for (const [name, text] of [
    ['ja', ja],
    ['en', en],
  ])
    await page.locator(`input[name=${name}]`).setInputFiles({
      name: name + '.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(zipSync({ [path]: Buffer.from(text) })),
    });
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90000 });
  if (await page.getByRole('dialog').count()) await closeReviewSheet(page);
  await openTreeFile(page, path);
  const pick = async (title: RegExp) => {
    await page.locator('.entry-open').click();
    await page
      .locator('.pick-row')
      .filter({ has: page.locator('.pick-title', { hasText: title }) })
      .click();
  };
  await pick(/^選択肢名/);
  await expect(page.locator('.entry-title')).toHaveText('選択肢名 0-1');
  const section = page.locator('.database-context'),
    toggle = section.locator('.context-title'),
    original = page.locator('.database-original');
  await expect(original).toHaveText('日本語の説明');
  await expect(section.locator('.context-field-label')).toHaveCount(0);
  await expect(page.locator('.database-translation')).toHaveText('Description');
  await captureUi(page, info, 'database-context', '.database-context');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(original).toHaveCount(0);
  await pick(/^データ 0 \/ 項目 0$/);
  await toggle.click();
  await section.getByRole('button', { name: '翻訳項目を開く', exact: true }).click();
  await expect(page.locator('.entry-title')).toHaveText('項目名 0');
  await page.goBack();
  await expect(page.locator('.entry-title')).toHaveText('データ 0 / 項目 0');
  await toggle.click();
  await pick(/^データ 0 \/ 項目 1$/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(original).toHaveText('ASCII original label');
  await expect(page.locator('.database-translation')).toHaveText('English field label');
  await expect(section.getByRole('button', { name: '翻訳項目を開く', exact: true })).toBeDisabled();
  await toggle.click();
  await page.reload();
  await openTreeFile(page, path);
  await pick(/^選択肢名/);
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(original).toHaveText('日本語の説明');
  await pick(/^データ名 0$/);
  await expect(section).toHaveCount(0);
  await pick(/^項目名 0$/);
  await expect(section).toHaveCount(0);
});
