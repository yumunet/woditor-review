import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {zipSync,unzipSync} from 'fflate';

const path='BasicData/CommonEvent/000.txt';
const ja='COMMON_ID=0\nCOMMON_NAME=原文\nMEMO=メモ\nWoditorEvCOMMAND_START\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n[COMMAND_TEXT_END]\n';
const en=ja.replace('原文','Original English').replace('メモ','Memo');
const reason='文脈に合う表現に修正します';
async function menu(page:Page,label:string) {
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:label,exact:true}).click();
}
async function openFile(page:Page) {
  for(const part of ['BasicData','BasicData/CommonEvent',path]) {
    const row=page.locator(`.file-row[data-value="${part}"]`);
    if(part===path || await row.getAttribute('aria-expanded')==='false') await row.click();
  }
}
async function close(page:Page) {await page.getByRole('button',{name:'閉じる',exact:true}).click();}
async function download(page:Page,label:string) {
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:label,exact:true}).click();const file=await pending;await expect(page.locator('.busy')).toHaveCount(0);return readFileSync((await file.path())!);
}

for(const withZip of [false,true]) test(`initial review imports structured edits ${withZip?'with a matching ZIP':'from JSON alone'} as pending differences`,async({page})=>{
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{(window as any).instructions=text;}}});});
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [lang,text] of [['ja',ja],['en',en]]) await page.locator(`input[name=${lang}]`).setInputFiles({name:lang+'.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(text)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90000});await openFile(page);
  await menu(page,'AIレビューを依頼');await page.getByRole('radio',{name:'英訳をチェックして指摘・修正案を作る',exact:true}).check();
  const request=JSON.parse((await download(page,'JSONを出力')).toString('utf8')),target=request.targets[0];
  await page.getByRole('button',{name:'指示文をコピー',exact:true}).click();
  const instructions=await page.evaluate(()=>(window as any).instructions);expect(instructions).toContain('修正後の英訳はchanges.after');expect(instructions).toContain('apply');expect(instructions).not.toContain('作成しない');
  await close(page);
  const response={schemaVersion:1,requestId:request.requestId,responses:[],suggestions:[{id:'initial-proposal',path:target.path,itemId:target.itemId,fileVersion:target.fileVersion,reason,changes:[{slotId:target.slots[0].id,before:'Original English',after:'Revised English'}]}]};
  await menu(page,'AIレビュー結果を読み込む');await page.locator('input[name=answer]').setInputFiles({name:'review_response.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});
  if(withZip) {
    // Reject unlisted edits without creating either comments or pending changes.
    const invalid=en.replace('Original English','Revised English').replace('MEMO=Memo','MEMO=Undeclared');
    await page.locator('input[name=revised]').setInputFiles({name:'revised.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(invalid)}))});
    await page.getByRole('button',{name:'回答を読み込む',exact:true}).click();await expect(page.locator('.toast')).toContainText('回答JSONと修正TXTの新訳が一致しません');await expect(page.locator('.translation-after')).toHaveCount(0);
    // A failed submit re-renders the file inputs, so supply both again.
    await page.locator('input[name=answer]').setInputFiles({name:'review_response.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});
    await page.locator('input[name=revised]').setInputFiles({name:'revised.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(en.replace('Original English','Revised English'))}))});
  }
  await page.getByRole('button',{name:'回答を読み込む',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.translation')).toHaveText('Original English');await expect(page.locator('.translation-after')).toHaveText('Revised English');await expect(page.locator('.float-preview')).toHaveText(reason);await expect(page.locator('.status')).toHaveText('未確認');
  await page.reload();await expect(page.locator('.busy')).toHaveCount(0);await openFile(page);await expect(page.locator('.translation-after')).toHaveText('Revised English');
  await page.locator('.comment-trigger').click();await expect(page.locator('.post-text')).toHaveText(reason);await expect(page.locator('.post-text')).not.toContainText('Revised English');await page.getByRole('button',{name:'解決',exact:true}).click();await close(page);
  await expect(page.locator('.translation')).toHaveText('Revised English');await expect(page.locator('.translation-after')).toHaveCount(0);
  await menu(page,'英訳TXTを出力');const files=unzipSync(await download(page,'英訳TXTを出力'));expect(Buffer.from(files['en-US/texts/'+path]).toString('utf8')).toBe(en.replace('Original English','Revised English'));await close(page);
  await page.locator('.comment-trigger').click();await page.getByRole('button',{name:'すべてのコメント',exact:true}).click();await page.getByRole('button',{name:'再開',exact:true}).click();await close(page);await expect(page.locator('.translation')).toHaveText('Original English');await expect(page.locator('.translation-after')).toHaveText('Revised English');
  await menu(page,'AIレビューを依頼');await page.getByRole('radio',{name:'既存コメントに回答・修正する',exact:true}).check();const followup=JSON.parse((await download(page,'JSONを出力')).toString('utf8'));expect(followup.entries[0].pendingChanges[0].after).toBe('Revised English');expect(followup.entries[0].posts[0].text).toBe(reason);await close(page);
});
