import { test, expect } from '@playwright/test';
import { zipSync, unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';

test('common choice settings classify ignored rows, active value differences and invalid reference counts', async ({
  page,
}) => {
  const path = 'BasicData/CommonEvent/000.txt';
  const ja =
    'COMMON_ID=0\nVALINPUT_NUM=3\nVALINPUT_NAME_0=直接入力\nVALINPUT_NAME_1=参照\nVALINPUT_NAME_2=選択\nLOADTYPE0=0\nLOADTYPE1=1\nLOADTYPE2=2\nCHOICE_STR_0_NUM=1\nCHOICE_STR_0_0=使わないラベル\nCHOICE_VAL_0_NUM=1\nCHOICE_VAL_0_0=7\nCHOICE_STR_1_NUM=0\nCHOICE_VAL_1_NUM=3\nCHOICE_VAL_1_0=1\nCHOICE_VAL_1_1=2\nCHOICE_VAL_1_2=3\nCHOICE_STR_2_NUM=1\nCHOICE_STR_2_0=有効な選択肢\nCHOICE_STR_2_1=範囲外のラベル\nCHOICE_VAL_2_NUM=1\nCHOICE_VAL_2_0=0\nCHOICE_VAL_2_1=1\nWoditorEvCOMMAND_START\n[101][0,1]<0>()("本文")\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n■本文\n[COMMAND_TEXT_END]\n';
  const en = ja
    .replace('使わないラベル', 'Unused label')
    .replace('有効な選択肢', 'Active choice')
    .replace('CHOICE_VAL_2_0=0', 'CHOICE_VAL_2_0=9');
  const badPath = 'BasicData/CommonEvent/001.txt',
    bad = en.replace('CHOICE_VAL_1_2=3\n', '');
  await page.goto('/');
  await expect(page.locator('.busy')).toHaveCount(0);
  await page.getByRole('button', { name: 'ファイルを読み込む', exact: true }).click();
  for (const [language, files] of [
    ['ja', { [path]: ja, [badPath]: ja }],
    ['en', { [path]: en, [badPath]: bad }],
  ] as const)
    await page.locator(`input[name=${language}]`).setInputFiles({
      name: language + '.zip',
      mimeType: 'application/zip',
      buffer: Buffer.from(
        zipSync(
          Object.fromEntries(Object.entries(files).map(([key, text]) => [key, Buffer.from(text)])),
        ),
      ),
    });
  await page.getByRole('button', { name: '読み込む', exact: true }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90000 });
  await expect(page.getByRole('tab', { name: 'エラー (1)', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.locator('.diagnostic.error').click();
  await page.getByRole('tab', { name: '英語', exact: true }).click();
  await expect(page.locator('.focus-line code')).toHaveText('CHOICE_VAL_1_NUM=3');
  await page.locator('[data-action=diagnostic-back]').click();
  await page.getByRole('tab', { name: /^自動補正/ }).click();
  await expect(page.locator('#diagnostic-panel')).toContainText('未使用の選択肢設定を無視しました');
  await expect(page.locator('#diagnostic-panel')).not.toContainText('設定値が日英で異なります');
  await page.getByRole('tab', { name: /^警告/ }).click();
  await expect(page.locator('#diagnostic-panel')).toContainText(
    '翻訳対象外の設定値が日英で異なります',
  );
  await expect(page.locator('#diagnostic-panel')).not.toContainText('未使用の選択肢');
  await page.getByRole('button', { name: '閉じる', exact: true }).click();
  for (const part of ['BasicData', 'BasicData/CommonEvent', path])
    await page.locator(`.file-row[data-value="${part}"]`).click();
  await page.locator('.entry-open').click();
  const labels = await page.locator('.pick-title').allTextContents();
  expect(labels.filter((label) => label.startsWith('選択肢 '))).toEqual(['選択肢 3-1']);
  await page
    .locator('.pick-row')
    .filter({ has: page.locator('.pick-title', { hasText: /^数値引数名 1$/ }) })
    .click();
  await expect(page.locator('.choices-context')).toHaveCount(0);
  await page.locator('.entry-open').click();
  await page
    .locator('.pick-row')
    .filter({ has: page.locator('.pick-title', { hasText: /^数値引数名 3$/ }) })
    .click();
  await expect(page.locator('.choice-row')).toHaveCount(1);
  await expect(page.locator('.choice-translation')).toHaveText('Active choice');
  await page.getByRole('button', { name: 'メニュー', exact: true }).click();
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '英訳TXTを出力', exact: true }).click();
  const files = unzipSync(readFileSync(await (await pending).path()));
  expect(Buffer.from(files['en-US/texts/' + path]).toString('utf8')).toBe(en);
});
