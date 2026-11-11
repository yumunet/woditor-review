import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {zipSync,unzipSync} from 'fflate';

const path='BasicData/DataBase/00.txt';
async function load(page:Page,ja:string,en:string) {
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [name,text] of [['ja',ja],['en',en]]) await page.locator(`input[name=${name}]`).setInputFiles({name:name+'.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(text)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90000});
}
async function openFile(page:Page) {if(await page.getByRole('dialog').count()) await page.getByRole('button',{name:'閉じる',exact:true}).click();for(const part of ['BasicData','BasicData/DataBase',path]) await page.locator(`.file-row[data-value="${part}"]`).click();}

test('database load types exclude ignored choices and paths while keeping reference labels and custom choices',async({page})=>{
  const ja='TYPE_ID=0\nDATANAME_LOAD_TYPE=1\nITEM_NUM=4\nITEMNAME0=直接入力\nITEMNAME1=ファイル\nITEMNAME2=データベース参照\nITEMNAME3=選択肢作成\nITEM_LOADTYPE_0=0\nITEM_LOADTYPE_1=1\nITEM_LOADTYPE_2=2\nITEM_LOADTYPE_3=3\nCHOICE_NAME_0_NUM=2\nCHOICE_NAME_0_0=無視する値\nCHOICE_NAME_0_1=無視する別の値\nCHOICE_VAL_0_NUM=2\nCHOICE_VAL_0_0=0\nCHOICE_VAL_0_1=1\nCHOICE_NAME_1_NUM=1\nCHOICE_NAME_1_0=画像/原文/\nCHOICE_VAL_1_NUM=1\nCHOICE_VAL_1_0=0\nCHOICE_NAME_2_NUM=3\nCHOICE_NAME_2_0=なし\nCHOICE_NAME_2_1=未設定\nCHOICE_NAME_2_2=特殊\nCHOICE_VAL_2_NUM=3\nCHOICE_VAL_2_0=1\nCHOICE_VAL_2_1=7\nCHOICE_VAL_2_2=1\nCHOICE_NAME_3_NUM=2\nCHOICE_NAME_3_0=選択A\nCHOICE_NAME_3_1=選択B\nCHOICE_VAL_3_NUM=2\nCHOICE_VAL_3_0=0\nCHOICE_VAL_3_1=1\n<<--CSV_START-->>\n"直接入力","ファイル","データベース参照","選択肢作成",\n0,0,0,0,\n<<--CSV_END-->>\n';
  const en=ja.replaceAll('直接入力','Direct input').replaceAll('ファイル','File').replaceAll('データベース参照','Database').replaceAll('選択肢作成','Choices').replace(/^CHOICE_(?:NAME|VAL)_0_[^\n]*\n/gm,'').replace('画像/原文/','Images/English/').replace('=なし','=None').replace('=未設定','=Unset').replace('=特殊','=Special').replace('=選択A','=Choice A').replace('=選択B','=Choice B');
  await load(page,ja,en);await expect(page.getByRole('tab',{name:'エラー (0)',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:/^警告/}).click();const folder=page.locator('.diagnostic.warning').filter({hasText:'既定フォルダパスが日英で異なります'});await expect(folder).toHaveCount(1);await folder.click();
  await expect(page.locator('.focus-line code')).toHaveText('CHOICE_NAME_1_0=画像/原文/');await page.getByRole('tab',{name:'英語',exact:true}).click();await expect(page.locator('.focus-line code')).toHaveText('CHOICE_NAME_1_0=Images/English/');await page.locator('[data-action=diagnostic-back]').click();
  await page.getByRole('tab',{name:/^自動補正/}).click();await expect(page.locator('#diagnostic-panel')).toContainText('未使用の選択肢設定を無視しました');
  await openFile(page);await page.locator('.entry-open').click();const titles=await page.locator('.pick-title').allTextContents();
  expect(titles.filter(title=>title.startsWith('選択肢名 0-')||title.startsWith('選択肢名 1-'))).toEqual([]);
  expect(titles.filter(title=>title.startsWith('選択肢名 2-'))).toHaveLength(3);expect(titles.filter(title=>title.startsWith('選択肢名 3-'))).toHaveLength(2);
  await page.locator('.pick-row').filter({has:page.locator('.pick-title',{hasText:/^項目名 1$/})}).click();await expect(page.locator('.choices-context')).toHaveCount(0);
  await page.locator('.entry-open').click();await page.locator('.pick-row').filter({has:page.locator('.pick-title',{hasText:/^項目名 2$/})}).click();await expect(page.locator('.choice-row')).toHaveCount(3);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();const zip=unzipSync(readFileSync((await(await download).path())!));expect(Buffer.from(zip[`en-US/texts/${path}`]).toString('utf8')).toBe(en);
});

test('multiple file-loading choice names report an error while other database text stays reviewable',async({page})=>{
  const ja='TYPE_ID=0\nITEM_NUM=1\nITEMNAME0=ファイル\nITEM_LOADTYPE_0=1\nCHOICE_NAME_0_NUM=2\nCHOICE_NAME_0_0=画像/\nCHOICE_NAME_0_1=追加のパス/\n';
  await load(page,ja,ja.replace('ファイル','File').replace('画像/','Images/').replace('追加のパス/','Extra/'));
  await expect(page.getByRole('tab',{name:/^エラー/})).toHaveAttribute('aria-selected','true');await expect(page.locator('.diagnostic.error').first()).toContainText('既定フォルダパスが複数');
  await openFile(page);await page.locator('.entry-open').click();await expect(page.locator('.pick-title')).toHaveText(['項目名 0']);
});
