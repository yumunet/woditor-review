import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {zipSync,unzipSync} from 'fflate';
import {captureUi} from './screenshots';

async function load(page:Page,path:string,ja:string,en:string) {
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [name,text] of [['ja',ja],['en',en]]) await page.locator(`input[name=${name}]`).setInputFiles({name:name+'.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(text)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90000});if(await page.getByRole('dialog').count()) await page.getByRole('button',{name:'閉じる',exact:true}).click();
}
async function openFile(page:Page,path:string) {
  const parts=path.split('/');for(let i=0;i<parts.length;i++) await page.locator(`.file-row[data-value="${parts.slice(0,i+1).join('/')}"]`).click();
}
for(const common of [false,true]) test(`${common?'common arguments':'database fields'} show bilingual choice tables with independent persistent collapse`,async({page},info)=>{
  const path=common?'BasicData/CommonEvent/000.txt':'BasicData/DataBase/00.txt';
  const family=common?'CHOICE_STR':'CHOICE_NAME',field=common?'VALINPUT_NAME_':'ITEMNAME';
  const prefix=common?'COMMON_ID=0\nVALINPUT_NUM=2\n':'TYPE_ID=0\nDATANAME_LOAD_TYPE=1\nITEM_NUM=2\n';
  const tail=common?'WoditorEvCOMMAND_START\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n[COMMAND_TEXT_END]\n':'<<--CSV_START-->>\n"分類名","選択肢なし",\n"隠すデータ値","隠す設定値",\n<<--CSV_END-->>\n';
  const ja=prefix+`${field}0=分類名\n${field}1=選択肢なし\n${family}_0_NUM=2\n${family}_0_0=最初の選択\n${family}_0_1=二番目の選択\n${family}_1_NUM=0\n${family}_1_0=使用しない残存値\n`+tail;
  const en=ja.replaceAll('分類名','Category').replaceAll('選択肢なし','No choices').replace(`${family}_0_NUM=2`,`${family}_0_NUM=1`).replace('最初の選択','First choice').replace('二番目の選択','Inactive English choice');
  const title=common?'数値引数名 1':'項目名 0',choiceTitle=common?'選択肢 1-1':'選択肢名 0-1';
  await load(page,path,ja,en);await openFile(page,path);
  const pick=async(title:string)=>{await page.locator('.entry-open').click();await page.locator('.pick-row').filter({has:page.locator('.pick-title',{hasText:new RegExp(`^${title}$`)})}).click();};
  await pick(title);const section=page.locator('.choices-context'),toggle=section.getByRole('button'),rows=page.locator('.choice-row');
  await expect(toggle).toHaveAttribute('aria-expanded','true');await expect(rows).toHaveCount(2);await expect(section.locator('thead th')).toHaveText(['原文','英訳']);await expect(rows.locator('th')).toHaveCount(0);await expect(section.locator('.choices-table')).toHaveCSS('font-size','14px');
  await expect(rows.first().locator('.choice-source')).toHaveText('最初の選択');await expect(rows.first().locator('.choice-translation')).toHaveText('First choice');
  await expect(rows.nth(1).locator('.choice-source')).toHaveText('二番目の選択');await expect(rows.nth(1).locator('.choice-translation')).toContainText('対応なし');
  await expect(section).not.toContainText('隠すデータ値');await expect(section).not.toContainText('使用しない残存値');await expect(section).not.toContainText('Inactive English choice');
  await expect(rows.first().locator('.choice-source')).toHaveCSS('border-bottom-width','1px');await expect(rows.first().locator('.choice-source')).toHaveCSS('border-right-width','1px');
  const viewport=page.viewportSize()!;await page.setViewportSize({width:320,height:844});expect(await section.evaluate(el=>el.getBoundingClientRect().right<=innerWidth)).toBe(true);await page.setViewportSize(viewport);
  await captureUi(page,info,common?'argument-choices-context':'database-choices-context','.choices-context');
  await toggle.click();await expect(rows).toHaveCount(0);
  await pick(choiceTitle);const related=page.locator('.database-context'),relatedToggle=related.getByRole('button');await expect(relatedToggle).toHaveAttribute('aria-expanded','true');await expect(page.locator('.database-original')).toHaveText('分類名');await expect(page.locator('.database-translation')).toHaveText('Category');
  await relatedToggle.click();await pick(title);await expect(toggle).toHaveAttribute('aria-expanded','false');
  await page.reload();await expect(page.locator('.busy')).toHaveCount(0);await openFile(page,path);await pick(title);await expect(toggle).toHaveAttribute('aria-expanded','false');await toggle.click();await expect(rows).toHaveCount(2);
  await pick(choiceTitle);await expect(relatedToggle).toHaveAttribute('aria-expanded','false');await relatedToggle.click();await expect(page.locator('.database-translation')).toHaveText('Category');
  await pick(common?'数値引数名 2':'項目名 1');await expect(section).toHaveCount(0);await expect(related).toHaveCount(0);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();const download=page.waitForEvent('download');await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();
  const zip=unzipSync(readFileSync((await(await download).path())!));expect(Buffer.from(zip[`en-US/texts/${path}`]).toString('utf8')).toBe(en);
});
