import {captureUi} from './screenshots';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { zipSync, unzipSync } from 'fflate';
const real = '.reference/ja-JP/texts/MapData/SampleMapA/Event_0000.txt';
const corpus = existsSync(real);
const sourcePath = 'MapData/SampleMapA/Event_0000.txt';
export async function loadReal(page: Page, importPath = sourcePath) {
  await page.goto('/');
  await expect(page.locator('.busy')).toHaveCount(0);
  if(!await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).count()) await page.getByRole('button',{name:'メニュー',exact:true}).click();
  await page.getByRole('button', {name: 'ファイルを読み込む', exact: true}).click();
  for (const [name, lang] of [['ja', 'ja-JP'], ['en', 'en-US']]) {
    const buffer = Buffer.from(zipSync({[`extra/${lang}/texts/${importPath}`]: readFileSync(`.reference/${lang}/texts/${importPath}`)}));
    await page.locator(`input[name=${name}]`).setInputFiles({name: `${lang}.zip`, mimeType: 'application/zip', buffer});
  }
  await page.getByRole('button', {name: '読み込む', exact: true}).click();
  await expect(page.locator('.busy')).toHaveCount(0, {timeout: 90_000});
  if (await page.getByRole('dialog').count()) await page.getByRole('button', {name: '閉じる', exact: true}).click();
  for (const name of importPath.split('/')) await page.locator('.file-row').filter({has: page.locator('.row-name', {hasText: name})}).click();
  if (importPath === sourcePath) await expect(page.locator('.source')).toContainText('夕一');
  else await expect(page.locator('.source')).toBeVisible();
}

test('unified import accepts English alone and preserves comments and other files',async({page})=>{
  test.skip(!corpus,'Private reference files not available');
  await page.goto('/');await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  await expect(page.locator('input[name=ja]')).toHaveAttribute('required');await closeReviewSheet(page);
  await loadNavigationFiles(page);await openTreeFile(page,navigationPaths[0]);await postReviewComment(page,'Keep this comment');
  const oldText=await page.locator('.translation').textContent();
  await page.getByRole('button',{name:'メニュー',exact:true}).click();
  await expect(page.getByRole('button',{name:'英訳TXTを再読み込み',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  await expect(page.locator('input[name=ja]')).not.toHaveAttribute('required');
  const text=readFileSync(`.reference/en-US/texts/${navigationPaths[0]}`,'utf8').replace(/COMMON_NAME=[^\r\n]*/,'COMMON_NAME=Updated name');
  expect(text).toContain('COMMON_NAME=Updated name');
  await page.locator('input[name=en]').setInputFiles({name:'revised.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[`en-US/texts/${navigationPaths[0]}`]:Buffer.from(text)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90_000});
  if(await page.getByRole('dialog').count()) await closeReviewSheet(page);
  await expect(page.locator('h1')).toHaveText('000.txt');await expect(page.locator('.translation')).toHaveText(oldText!);await expect(page.locator('.translation-after')).toHaveText('Updated name');
  await page.locator('.comment-trigger').click();await expect(page.locator('.post-text')).toHaveText('Keep this comment');await closeReviewSheet(page);
  await openTreeFile(page,navigationPaths[1]);await expect(page.locator('.source')).toBeVisible();
});

test('system Back closes panels and confirmation before returning to the folder view',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  await page.locator('.comment-trigger').click();await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.source')).toBeVisible();
  await page.goForward();await expect(page.getByRole('dialog',{name:'コメント',exact:true})).toBeVisible();await closeReviewSheet(page);
  await page.goBack();await expect(page.locator('h1')).toHaveText('Woditor Review');await expect(page.locator('.file-row')).not.toHaveCount(0);
  await page.goForward();await expect(page.locator('.entry-title')).toHaveText('イベント名');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.goBack();await expect(page.locator('.menu')).toHaveCount(0);await expect(page.locator('.source')).toBeVisible();
  await page.getByRole('button',{name:'承認',exact:true}).click();await page.getByRole('button',{name:'前の項目',exact:true}).click();await page.getByRole('button',{name:'未確認に戻す',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.goBack();await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'未確認に戻す',exact:true})).toBeVisible();
  await page.goBack();await expect(page.locator('h1')).toHaveText('Woditor Review');
  await page.goBack();await expect(page).toHaveURL('about:blank');
});

test('Back returns from diagnostic text to the selected warning tab',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page,'BasicData/CDataBase/04.txt');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();await page.getByRole('tab',{name:/^自動補正/}).click();await page.locator('.diagnostic.warning').first().click();
  await expect(page.getByRole('dialog',{name:'テキスト表示',exact:true})).toBeVisible();await page.goBack();await expect(page.getByRole('tab',{name:/^自動補正/})).toHaveAttribute('aria-selected','true');await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.source')).toBeVisible();
});

test('comment drafts survive closing and Back but clear on item changes and submission',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  const composer=page.getByLabel('コメント内容');
  await page.locator('.comment-trigger').click();await composer.fill('Draft\nsecond line');await closeReviewSheet(page);
  await page.locator('.comment-trigger').click();await expect(composer).toHaveValue('Draft\nsecond line');await page.keyboard.press('Escape');
  await page.locator('.comment-trigger').click();await expect(composer).toHaveValue('Draft\nsecond line');await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.comment-trigger').click();await expect(composer).toHaveValue('Draft\nsecond line');await page.getByRole('button',{name:'すべてのコメント',exact:true}).click();await expect(composer).toHaveValue('Draft\nsecond line');
  await page.getByRole('button',{name:'送信',exact:true}).click();await expect(composer).toHaveValue('');await expect(page.locator('.post-text')).toHaveText('Draft\nsecond line');
  await page.getByRole('button',{name:'返信',exact:true}).click();await composer.fill('Unsent reply');await closeReviewSheet(page);await page.locator('.comment-trigger').click();await expect(composer).toHaveValue('Unsent reply');await expect(composer).toHaveAttribute('placeholder','返信を入力');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();await composer.fill('Edited draft');await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('.comment-trigger').click();await expect(composer).toHaveValue('Edited draft');await expect(page.getByRole('button',{name:'保存',exact:true})).toBeVisible();await page.getByRole('button',{name:'保存',exact:true}).click();await expect(composer).toHaveValue('');await expect(page.locator('.post-text')).toHaveText('Edited draft');
  await composer.fill('Discard on navigation');await closeReviewSheet(page);await page.locator('.entry-open').click();await closeReviewSheet(page);await page.locator('.comment-trigger').click();await expect(composer).toHaveValue('Discard on navigation');await closeReviewSheet(page);
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await page.locator('.comment-trigger').click();await expect(composer).toHaveValue('');await closeReviewSheet(page);
  await page.getByRole('button',{name:'前の項目',exact:true}).click();await page.locator('.comment-trigger').click();await expect(composer).toHaveValue('');await expect(composer).toHaveAttribute('placeholder','コメントを入力');
});

test('real ZIP -> folders -> compare -> context -> filtered empty state', async ({page}) => {
  test.skip(!corpus, 'Private reference files not available');
  const errors: string[] = [];
  page.on('pageerror', err => errors.push(String(err)));
  await loadReal(page);
  await expect(page.locator('.entry-title')).toHaveText('イベント名');
  await expect(page.locator('html')).toHaveCSS('font-synthesis','weight');
  for(const selector of ['.entry-title','.label','.comment-trigger','.approve']) await expect(page.locator(selector).first()).toHaveCSS('font-weight','700');
  await expect(page.locator('.source')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('.translation')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(page.locator('.approve svg circle')).toHaveAttribute('r','9');
  const arrow=await page.locator('.prevnext').first().boundingBox(),comment=await page.locator('.comment-trigger').boundingBox(),approve=await page.locator('.approve').boundingBox();
  expect(arrow!.width).toBeGreaterThanOrEqual(44);expect(arrow!.height).toBe(arrow!.width);expect(comment!.height).toBeGreaterThanOrEqual(48);expect(approve!.height).toBeGreaterThanOrEqual(56);
  await expect(page.locator('.approve')).toHaveCSS('background-color','rgb(22, 131, 73)');
  await page.getByRole('button', {name: '次の項目', exact: true}).click();
  await expect(page.locator('.translation')).toContainText('Yuichi');
  await expect(page.locator('.command.current')).toContainText('Show Message');
  await expect(page.locator('.command.current')).toHaveCSS('background-color', 'rgb(255, 255, 250)');
  await page.getByRole('button',{name:'表示言語',exact:true}).click();await page.getByRole('option',{name:'日本語',exact:true}).click();
  await expect(page.locator('.command.current')).toContainText('■文章');
  await page.locator('.entry-open').click();
  await expect(page.locator('.pick-title').first()).toHaveCSS('font-weight','700');
  await page.getByRole('button', {name: '確認済み', exact: true}).click();
  await expect(page.getByRole('dialog')).toContainText('対象の項目はありません');
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  await expect(page.locator('.counter')).toHaveText('0 / 0');
  await expect(page.getByRole('button', {name: '次の項目', exact: true})).toBeDisabled();
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
});

test('comments, reply preview, confirmations, persistence and backup restore', async ({page}) => {
  test.skip(!corpus, 'Private reference files not available');
  await loadReal(page);
  await page.getByRole('button', {name: 'コメント', exact: true}).click();
  await page.getByLabel('コメント内容').fill('名前の表記を確認');
  await page.getByRole('button', {name: '送信', exact: true}).click();
  await page.getByRole('button', {name: '編集', exact: true}).click();
  await page.getByLabel('コメント内容').fill('名前の表記を再確認');
  await page.getByRole('button', {name: '保存', exact: true}).click();
  await expect(page.locator('.post-text')).toHaveText('名前の表記を再確認');
  await page.getByRole('button', {name: '返信', exact: true}).click();
  await page.getByLabel('コメント内容').fill('最新の返信');
  await page.getByRole('button', {name: '送信', exact: true}).click();
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  await expect(page.locator('.float-preview')).toHaveText('最新の返信');
  const preview = await page.locator('.float-comment').boundingBox(), approve = await page.locator('.approve').boundingBox(), footer = await page.locator('.bottom').boundingBox();
  expect(approve!.y + approve!.height).toBeLessThan(preview!.y);
  expect(preview!.y + preview!.height).toBeLessThan(footer!.y);
  await page.getByRole('button', {name: '承認', exact: true}).click();
  await expect(page.getByRole('alertdialog')).toContainText('未解決コメントを解決にしますか？');
  await page.getByRole('button', {name: 'キャンセル', exact: true}).click();
  await expect(page.locator('.float-comment')).toBeVisible();
  await page.getByRole('button', {name: '承認', exact: true}).click();
  await page.getByRole('button', {name: '確定', exact: true}).click();
  await expect(page.locator('.entry-title')).toHaveText('文章の表示 1');
  await page.getByRole('button', {name: '前の項目', exact: true}).click();
  await page.getByRole('button', {name: '未確認に戻す', exact: true}).click();
  await page.getByRole('button', {name: 'キャンセル', exact: true}).click();
  await expect(page.locator('.status')).toHaveText('確認済み');
  await page.getByRole('button', {name: '未確認に戻す', exact: true}).click();
  await page.getByRole('button', {name: '確定', exact: true}).click();
  await expect(page.locator('.entry-title')).toHaveText('イベント名');
  await expect(page.locator('.status')).toHaveText('未確認');
  await page.getByRole('button', {name: 'メニュー', exact: true}).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', {name: '状態をバックアップ', exact: true}).click();
  const backup = await downloadEvent;
  const backupPath = await backup.path();
  await page.reload();
  for (const name of ['MapData', 'SampleMapA', 'Event_0000.txt']) await page.locator('.file-row').filter({has: page.locator('.row-name', {hasText: name})}).click();
  await page.getByRole('button', {name: /コメント/}).first().click();
  await page.getByRole('button', {name: 'すべてのコメント', exact: true}).click();
  await expect(page.locator('.post-text')).toContainText(['名前の表記を再確認', '最新の返信']);
  await page.getByRole('button', {name: '再開', exact: true}).click();
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  await page.getByRole('button', {name: 'メニュー', exact: true}).click();
  await page.getByRole('button', {name: 'バックアップを復元', exact: true}).click();
  await page.locator('input[name=backup]').setInputFiles(backupPath!);
  await page.getByRole('button', {name: '復元する', exact: true}).click();
  await page.getByRole('button', {name: '確定', exact: true}).click();
  await expect(page.locator('.file-row')).toContainText('MapData');
});

test('review JSON and revised TXT round trip, AI resolve/reopen and persistence', async ({page}) => {
  test.skip(!corpus, 'Private reference files not available');
  await loadReal(page);
  await page.getByRole('button', {name: 'コメント', exact: true}).click();
  await page.getByLabel('コメント内容').fill('Please correct this name');
  await page.getByRole('button', {name: '送信', exact: true}).click();
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  await page.getByRole('button', {name: 'メニュー', exact: true}).click();
  await page.getByRole('button', {name: 'AIレビューを依頼', exact: true}).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', {name: 'JSONを出力', exact: true}).click();
  const downloaded = await downloadEvent;
  const request = JSON.parse(readFileSync((await downloaded.path())!, 'utf8'));
  expect(request.entries).toHaveLength(1);
  await expect(page.getByLabel('ChatGPT向け指示文')).toHaveCount(0);
  const row = request.entries[0];
  const response = {schemaVersion: 1, requestId: request.requestId, suggestions: [], responses: [{commentId: row.commentId, path: row.path, itemId: row.itemId, fileVersion: row.fileVersion, decision: 'accepted', reason: 'Adjusted the name.', changes: [{slotId: row.slots[0].id, before: row.slots[0].translation, after: 'Revised Name'}]}]};
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  await page.getByRole('button', {name: 'メニュー', exact: true}).click();
  await page.getByRole('button', {name: 'AIレビュー結果を読み込む', exact: true}).click();
  await page.locator('input[name=answer]').setInputFiles({name: 'review_response.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(response))});
  const revised = readFileSync(`.reference/en-US/texts/${sourcePath}`, 'utf8').replace(/EVENT_NAME=[^\r\n]*/, 'EVENT_NAME=Revised Name');
  await page.locator('input[name=revised]').setInputFiles({name: 'revised.zip', mimeType: 'application/zip', buffer: Buffer.from(zipSync({[`en-US/texts/${sourcePath}`]: Buffer.from(revised)}))});
  await page.getByRole('button', {name: '回答を読み込む', exact: true}).click();
  await expect(page.locator('.translation-after')).toHaveText('Revised Name');
  await expect(page.locator('.diff-added')).not.toHaveCount(0);
  await expect(page.locator('.diff-deleted')).not.toHaveCount(0);
  await page.getByRole('button', {name: /コメント/}).first().click();
  await expect(page.getByRole('button', {name: '編集', exact: true})).toHaveCount(0);
  await expect(page.getByRole('button', {name: '削除', exact: true})).toHaveCount(0);
  await page.getByRole('button', {name: '解決', exact: true}).click();
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  await expect(page.locator('.translation-after')).toHaveCount(0);
  await expect(page.locator('.translation')).toHaveText('Revised Name');
  await page.getByRole('button', {name:'メニュー',exact:true}).click();
  await page.getByRole('button', {name:'英訳TXTを出力',exact:true}).click();
  const zipEvent=page.waitForEvent('download');
  await page.getByRole('button', {name:'英訳TXTを出力',exact:true}).click();
  const zipped=unzipSync(readFileSync((await (await zipEvent).path())!));
  const exported=Buffer.from(zipped[`en-US/texts/${sourcePath}`]).toString('utf8');
  expect(exported).toContain('EVENT_NAME=Revised Name');
  const original=readFileSync(`.reference/en-US/texts/${sourcePath}`,'utf8');
  expect(exported.split('[COMMAND_TEXT_START]')[1]).toBe(original.split('[COMMAND_TEXT_START]')[1]);
  await page.getByRole('button', {name:'閉じる',exact:true}).click();
  await page.reload();
  for (const name of ['MapData', 'SampleMapA', 'Event_0000.txt']) await page.locator('.file-row').filter({has: page.locator('.row-name', {hasText: name})}).click();
  await expect(page.locator('.translation')).toHaveText('Revised Name');
  await page.getByRole('button', {name: /コメント/}).first().click();
  await page.getByRole('button', {name: 'すべてのコメント', exact: true}).click();
  await page.getByRole('button', {name: '再開', exact: true}).click();
  await page.getByRole('button', {name: '閉じる', exact: true}).click();
  await expect(page.locator('.translation')).toHaveText(row.slots[0].translation);
  await expect(page.locator('.translation-after')).toHaveText('Revised Name');
  await page.getByRole('button', {name: '承認', exact: true}).click();
  await page.getByRole('button', {name: '確定', exact: true}).click();
  await page.getByRole('button', {name: '前の項目', exact: true}).click();
  await expect(page.locator('.status')).toHaveText('確認済み');
  await expect(page.locator('.translation')).toHaveText('Revised Name');
});

test('full real corpus in worker, diagnostics, all folder progress and restart', async ({page}, info) => {
  test.skip(!corpus, 'Private reference files not available');
  const external: string[] = [];
  page.on('request', request => {if (new URL(request.url()).origin !== 'http://127.0.0.1:4173') external.push(request.url());});
  await page.goto('/');
  await page.getByRole('button', {name: 'ファイルを読み込む', exact: true}).click();
  for (const [name, lang] of [['ja', 'ja-JP'], ['en', 'en-US']]) {
    const directory = `.reference/${lang}/texts`;
    const entries = Object.fromEntries(readdirSync(directory, {recursive:true}).map(String).filter(f=>f.endsWith('.txt')).map(f=>[`${lang}/texts/${f.replaceAll('\\','/')}`, readFileSync(`${directory}/${f}`)]));
    await page.locator(`input[name=${name}]`).setInputFiles({name:`${lang}.zip`,mimeType:'application/zip',buffer:Buffer.from(zipSync(entries,{level:1}))});
  }
  await page.evaluate(() => {(window as any).ticks=0; (window as any).timer=setInterval(()=>(window as any).ticks++,10);});
  const start = Date.now();
  await page.getByRole('button', {name: '読み込む', exact: true}).click();
  await expect(page.locator('.busy')).toHaveCount(0, {timeout:90_000});
  const elapsedMs=Date.now()-start;
  expect(await page.evaluate(() => {clearInterval((window as any).timer);return (window as any).ticks;})).toBeGreaterThan(10);
  await expect(page.getByRole('tab',{name:'エラー (10)',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.diagnostic.error')).toHaveCount(10);
  await expect(page.locator('.diagnostic.warning, .diagnostic.skip')).toHaveCount(0);
  await page.getByRole('tab',{name:/^警告/}).click();
  await expect(page.locator('.diagnostic.error, .diagnostic.skip')).toHaveCount(0);
  await page.getByRole('tab',{name:/^自動補正/}).click();await expect(page.locator('.diagnostic.warning').first()).toBeVisible();
  await page.getByRole('tab',{name:'対象外 (20)',exact:true}).click();
  await expect(page.locator('.diagnostic.skip')).toHaveCount(20);
  await page.getByRole('tab',{name:'エラー (10)',exact:true}).click();
  const summary = await page.evaluate(async () => {
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('woditor-review');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
    const files:any[]=await new Promise(resolve=>{const r=db.transaction('files').objectStore('files').getAll();r.onsuccess=()=>resolve(r.result);});db.close();
    return {files:files.length,items:files.reduce((n,f)=>n+f.items.length,0),slots:files.reduce((n,f)=>n+f.slots.length,0),types:files.reduce((a,f)=>({...a,[f.type]:(a[f.type]||0)+1}),{}), usages:files.reduce((n,f)=>n+Object.values(f.usages).filter((hits:any)=>hits.length>1).length,0)};
  });
  expect(summary.files).toBe(328); expect(summary.types).toEqual({common:225,database:66,map:37}); expect(summary.usages).toBeGreaterThan(0);
  mkdirSync('test-results',{recursive:true});writeFileSync(`test-results/corpus-${info.project.name}.json`,JSON.stringify({...summary,elapsedMs},null,2));
  await page.getByRole('button', {name:'閉じる',exact:true}).click();
  await page.getByRole('button', {name:'全体の進捗',exact:true}).click();
  await expect(page.locator('.progress-detail')).toContainText(['全体','BasicData','CDataBase','CommonEvent','DataBase','SysDataBase','MapData','Dungeon','SampleMapA','SampleMapB','TitleMap']);
  await page.getByRole('button', {name:'閉じる',exact:true}).click();
  await page.locator('.file-row[data-value="BasicData"]').click();await page.locator('.file-row[data-value="BasicData/CommonEvent"]').click();
  const scroller=page.locator('.file-scroll');await scroller.evaluate(el=>{el.scrollTop=el.scrollHeight;});
  const position=await scroller.evaluate(el=>el.scrollTop);expect(position).toBeGreaterThan(100);
  await page.locator('.file-row[data-value^="BasicData/CommonEvent/"]').last().click();await page.getByRole('button',{name:'戻る',exact:true}).click();
  await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBe(position);
  await page.locator('.file-row[data-value^="BasicData/CommonEvent/"]').last().click();await page.goBack();await expect.poll(()=>scroller.evaluate(el=>el.scrollTop)).toBe(position);
  await page.reload(); await expect(page.locator('.file-row')).toHaveCount(2);
  expect(external).toEqual([]);
});

test('offline restart, local Python rendering, and saved review operations', async ({page,context}) => {
  test.skip(!corpus, 'Private reference files not available');
  await loadReal(page);
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise<void>(resolve=>navigator.serviceWorker.addEventListener('controllerchange',()=>resolve(),{once:true}));});
  await context.setOffline(true);
  await page.reload();
  for(const name of ['MapData','SampleMapA','Event_0000.txt']) await page.locator('.file-row').filter({has:page.locator('.row-name',{hasText:name})}).click();
  await page.getByRole('button',{name:'コメント',exact:true}).click();
  await page.getByLabel('コメント内容').fill('オフラインで保存したコメント');
  await page.getByRole('button',{name:'送信',exact:true}).click();
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await expect(page.locator('.float-preview')).toHaveText('オフラインで保存したコメント');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();
  await page.getByRole('button',{name:'AIレビューを依頼',exact:true}).click();
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'JSONを出力',exact:true}).click();
  const request=JSON.parse(readFileSync((await (await downloaded).path())!,'utf8'));expect(request.entries[0].posts[0].text).toContain('オフライン');
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.reload();
  for(const name of ['MapData','SampleMapA','Event_0000.txt']) await page.locator('.file-row').filter({has:page.locator('.row-name',{hasText:name})}).click();
  await expect(page.locator('.float-preview')).toHaveText('オフラインで保存したコメント');
});

test('bottom sheets swipe, normal scrolling, keyboard and review screenshot', async ({page,context},info) => {
  test.skip(!corpus, 'Private reference files not available');
  await loadReal(page);
  await page.locator('.entry-open').click();
  const session=await context.newCDPSession(page);
  async function swipe(selector:string) {
    const box=await page.locator(selector).boundingBox(), x=box!.x+box!.width/2,y=box!.y+Math.min(20,box!.height/2);
    await session.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let dy=20;dy<=120;dy+=20) await session.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+dy}]});
    await session.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }
  await page.locator('.sheet-body').evaluate(el=>{el.scrollTop=160;});
  await swipe('.sheet-body');await expect(page.getByRole('dialog')).toBeVisible();
  await page.locator('.sheet-body').evaluate(el=>{el.scrollTop=0;});
  await swipe('.sheet-body');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'コメント',exact:true}).click();
  await swipe('.handle');await expect(page.getByRole('dialog')).toHaveCount(0);
  if(info.project.name==='desktop') {
    await page.keyboard.press('ArrowRight');await expect(page.locator('.entry-title')).toHaveText('文章の表示 1');
  } else await page.getByRole('button',{name:'次の項目',exact:true}).click();
  await page.getByRole('button',{name:'コメント',exact:true}).click();
  await page.getByLabel('コメント内容').fill('この表現を確認してください');
  await page.keyboard.press('ArrowRight');await expect(page.locator('.entry-title')).toHaveText('文章の表示 1');
  await page.getByRole('button',{name:'送信',exact:true}).click();
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  mkdirSync('docs/screenshots',{recursive:true});
  await captureUi(page,info,'review');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
});

test('undo retains a filtered-out item; comment deletion requires confirmation', async ({page}) => {
  test.skip(!corpus, 'Private reference files not available');
  await loadReal(page);
  await page.getByRole('button',{name:'承認',exact:true}).click();
  await page.getByRole('button',{name:'前の項目',exact:true}).click();
  await page.locator('.entry-open').click();
  await page.getByRole('button',{name:'確認済み',exact:true}).click();
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await expect(page.locator('.counter')).toHaveText('1 / 1');
  await page.getByRole('button',{name:'未確認に戻す',exact:true}).click();
  await page.getByRole('button',{name:'確定',exact:true}).click();
  await expect(page.locator('.entry-title')).toHaveText('イベント名');
  await expect(page.locator('.counter')).toHaveText('0 / 0');
  await page.locator('.entry-open').click();await page.getByRole('button',{name:'すべて',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'コメント',exact:true}).click();
  await page.getByLabel('コメント内容').fill('削除テスト');await page.getByRole('button',{name:'送信',exact:true}).click();
  await page.getByRole('button',{name:'削除',exact:true}).click();await page.getByRole('button',{name:'キャンセル',exact:true}).click();
  await expect(page.locator('.post-text')).toHaveText('削除テスト');
  await page.getByRole('button',{name:'削除',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();
  await expect(page.locator('.post-text')).toHaveCount(0);
});

test('manual comment split and merge', async ({page}) => {
  test.skip(!corpus, 'Private reference files not available');
  await loadReal(page);
  const grouped=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('woditor-review');r.onsuccess=()=>resolve(r.result);});
    const file:any=await new Promise(resolve=>{const r=db.transaction('files').objectStore('files').get('MapData/SampleMapA/Event_0000.txt');r.onsuccess=()=>resolve(r.result);});db.close();
    const item=file.items.find((i:any)=>i.slotIds.length>1);return {title:item.title,count:file.items.length};
  });
  await page.locator('.entry-open').click();await page.locator('.pick-row').filter({hasText:grouped.title}).first().click();
  const source=await page.locator('.source').textContent();expect(source).toContain('\n');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();
  await page.getByRole('button',{name:'コメントを行ごとに分割',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();
  expect(await page.locator('.source').textContent()).not.toContain('\n');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();
  await page.getByRole('button',{name:'次のコメントと結合',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();
  await expect(page.locator('.source')).toHaveText(source!);
  await expect(page.locator('.counter')).toHaveText(new RegExp(` / ${grouped.count}$`));
});

test('corrected English positions survive JSON export, revised TXT and approved ZIP export',async({page})=>{
  test.skip(!corpus,'Private reference files not available');
  const path='MapData/SampleMapA/Event_0023.txt';
  await loadReal(page,path);
  await page.getByRole('button',{name:'次の項目',exact:true}).click();
  await expect(page.locator('.translation')).toContainText("I'm a witch.");
  await page.getByRole('button',{name:'コメント',exact:true}).click();
  await page.getByLabel('コメント内容').fill('Please revise this message');await page.getByRole('button',{name:'送信',exact:true}).click();
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビューを依頼',exact:true}).click();
  let event=page.waitForEvent('download');await page.getByRole('button',{name:'JSONを出力',exact:true}).click();
  const request=JSON.parse(readFileSync((await(await event).path())!,'utf8')),row=request.entries[0],slot=row.slots[0];
  const original=readFileSync(`.reference/en-US/texts/${path}`,'utf8'),lines=original.split(/\r?\n/);
  const first=lines.find(l=>l.startsWith('[101]'))!;
  expect(slot.line).toBe(lines.indexOf(first)+1);
  expect(slot.line).toBeGreaterThan(Number(slot.id.match(/^L(\d+)/)[1]));
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  const after=slot.translation+' Revised.',nl=original.includes('\r\n')?'\r\n':'\n';
  const display=lines.find(l=>l.startsWith('■Show Message:'))!;
  const revised=original.replace(first,()=>`[103][0,1]<0>()("Extra translator comment")${nl}${first.replace(slot.translation,()=>after)}`).replace(display,()=>`▼ Extra translator comment${nl}${display}`);
  const response={schemaVersion:1,requestId:request.requestId,suggestions:[],responses:[{commentId:row.commentId,path,itemId:row.itemId,fileVersion:row.fileVersion,decision:'accepted',reason:'Revised message',changes:[{slotId:slot.id,before:slot.translation,after}]}]};
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビュー結果を読み込む',exact:true}).click();
  await page.locator('input[name=answer]').setInputFiles({name:'response.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});
  await page.locator('input[name=revised]').setInputFiles({name:'revised.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[`en-US/texts/${path}`]:Buffer.from(revised)}))});
  await page.getByRole('button',{name:'回答を読み込む',exact:true}).click();await expect(page.locator('.translation-after')).toHaveText(after);
  await page.getByRole('button',{name:/コメント/}).first().click();await page.getByRole('button',{name:'解決',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();
  event=page.waitForEvent('download');await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();
  const zip=unzipSync(readFileSync((await(await event).path())!)),output=Buffer.from(zip[`en-US/texts/${path}`]).toString('utf8');
  expect(output).toBe(revised);
});

test('comment action buttons stay in one row at mobile and narrow widths',async({page},info)=>{
  test.skip(!corpus,'Private reference files not available');
  await loadReal(page);
  await page.getByRole('button',{name:'コメント',exact:true}).click();
  await page.getByLabel('コメント内容').fill('コメントの操作を確認');await page.getByRole('button',{name:'送信',exact:true}).click();
  const actions=page.locator('.thread-root > .thread-actions').first();
  const checkRow=async()=>{
    await expect(actions.getByRole('button')).toHaveText(['返信','編集','削除','解決']);
    const boxes=await actions.getByRole('button').evaluateAll(buttons=>buttons.map(button=>{const r=button.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};}));
    for(let i=1;i<boxes.length;i++) {expect(Math.abs(boxes[i].y-boxes[0].y)).toBeLessThan(1);expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i-1].x+boxes[i-1].width);}
    expect(await actions.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBeTruthy();
  };
  await checkRow();
  await page.setViewportSize({width:320,height:844});await checkRow();
  await actions.getByRole('button',{name:'返信',exact:true}).click();await page.getByLabel('コメント内容').fill('返信も確認');await page.getByRole('button',{name:'送信',exact:true}).click();
  await checkRow();await expect(page.locator('.reply .thread-actions button')).toHaveText(['編集','削除']);
  await actions.getByRole('button',{name:'編集',exact:true}).click();await page.getByLabel('コメント内容').fill('編集したコメント');await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('.thread-root .post-text')).toHaveText('編集したコメント');
  await page.setViewportSize(info.project.name==='mobile'?{width:390,height:844}:{width:1280,height:900});
  mkdirSync('docs/screenshots',{recursive:true});await captureUi(page,info,'comments');
  await actions.getByRole('button',{name:'解決',exact:true}).click();await page.getByRole('button',{name:'すべてのコメント',exact:true}).click();
  await expect(actions.getByRole('button')).toHaveText(['編集','削除','再開']);
  await actions.getByRole('button',{name:'再開',exact:true}).click();await checkRow();
});

test('ambiguous English translations can be reviewed with a manually supplied original',async({page})=>{
  test.skip(!corpus,'Private reference files not available');
  const path='MapData/TitleMap/Event_0000.txt';await loadReal(page,path);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();
  await expect(page.getByRole('button',{name:'読み込み結果 (エラー7)',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'読み込み結果 (エラー7)',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'読み込み結果',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.locator('.entry-open').click();await page.locator('.pick-row[data-value="R:E00058:S1"]').click();
  await expect(page.locator('.source')).toHaveText('');await expect(page.locator('.translation')).toHaveText('[About the Blue [S] Mark]');
  await expect(page.locator('.command.current')).toContainText('[About the Blue [S] Mark]');
  await page.getByRole('button',{name:'原文を補う',exact:true}).click();await page.getByLabel('補完する原文').fill('青いSマークについて');
  await page.getByRole('button',{name:'保存',exact:true}).click();await expect(page.locator('.source')).toHaveText('青いSマークについて');
  await page.reload();for(const name of path.split('/')) await page.locator('.file-row').filter({has:page.locator('.row-name',{hasText:name})}).click();
  await page.locator('.entry-open').click();await page.locator('.pick-row[data-value="R:E00058:S1"]').click();await expect(page.locator('.source')).toHaveText('青いSマークについて');
});
test('item search filters rows by either language without changing counters or navigation',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  const count=(await page.locator('.counter').textContent())!.split('/')[1].trim();
  await page.locator('.entry-open').click();
  const search=page.getByRole('searchbox',{name:'翻訳項目を検索'});
  await search.fill('HeY ThErE');await expect(page.locator('.pick-row')).toHaveCount(1);await expect(search).toBeFocused();
  await expect(page.locator('.counter')).toHaveText(`1 / ${count}`);
  await page.locator('.pick-row').click();await expect(page.locator('.counter')).toHaveText(`2 / ${count}`);
  await page.locator('.entry-open').click();await search.fill('ゆういち');await expect(page.locator('.pick-row').first()).toBeVisible();
  await search.fill('no such translation');await expect(page.locator('.pick-row')).toHaveCount(0);await expect(page.locator('.counter')).toHaveText(`2 / ${count}`);
  await page.getByRole('button',{name:'閉じる',exact:true}).click();await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.locator('.counter')).toHaveText(`3 / ${count}`);
});
test('folder status filters flow into item filters in one direction',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  await page.getByRole('button',{name:'承認',exact:true}).click();await page.getByRole('button',{name:'戻る',exact:true}).click();
  await page.getByRole('button',{name:'確認済み',exact:true}).click();await page.locator('.file-row').filter({has:page.locator('.row-name',{hasText:'Event_0000.txt'})}).click();
  await expect(page.locator('.entry-title')).toHaveText('イベント名');await expect(page.locator('.counter')).toHaveText('1 / 1');
  await page.locator('.entry-open').click();await expect(page.getByRole('button',{name:'確認済み',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'未確認',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'戻る',exact:true}).click();await expect(page.getByRole('button',{name:'確認済み',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'未確認',exact:true}).click();await page.locator('.file-row').filter({has:page.locator('.row-name',{hasText:'Event_0000.txt'})}).click();
  await expect(page.locator('.entry-title')).toHaveText('文章の表示 1');await page.locator('.entry-open').click();
  await expect(page.getByRole('button',{name:'未確認',exact:true})).toHaveAttribute('aria-pressed','true');
});
test('item rows show a compact one-line original preview with ellipsis',async({page},info)=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  const source=await page.locator('.source').textContent();await page.locator('.entry-open').click();
  await expect(page.locator('.pick-source').first()).toHaveText(source!);
  await expect(page.locator('.pick-source').first()).toHaveCSS('white-space','nowrap');await expect(page.locator('.pick-source').first()).toHaveCSS('text-overflow','ellipsis');
  const rows=await page.locator('.pick-row').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().height));expect(Math.max(...rows)).toBeLessThanOrEqual(60);
  await page.setViewportSize({width:320,height:844});
  expect(await page.locator('.pick-source').evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth))).toBeTruthy();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
  await page.setViewportSize(info.project.name==='mobile'?{width:390,height:844}:{width:1280,height:900});
  mkdirSync('docs/screenshots',{recursive:true});await captureUi(page,info,'items');
});

test('diagnostic text viewer opens errors at the source line and switches languages',async({page},info)=>{
  test.skip(!corpus,'Private reference files not available');const path='MapData/TitleMap/Event_0000.txt';await loadReal(page,path);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();
  await page.locator('.diagnostic.error').first().click();await expect(page.getByRole('dialog',{name:'テキスト表示',exact:true})).toBeVisible();
  await expect(page.getByRole('tab',{name:'英語',exact:true})).toHaveAttribute('aria-selected','true');
  await expect(page.locator('.focus-line')).toHaveAttribute('data-text-line','58');
  const en=readFileSync(`.reference/en-US/texts/${path}`,'utf8').split(/\r?\n/);await expect(page.locator('.focus-line code')).toHaveText(en[57]);
  expect(await page.locator('.text-scroll').evaluate(el=>el.scrollTop)).toBeGreaterThan(500);
  await page.getByRole('tab',{name:'日本語',exact:true}).click();await expect(page.getByRole('tab',{name:'日本語',exact:true})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:'英語',exact:true}).click();
  const line=Number(await page.locator('.focus-line').getAttribute('data-text-line'));
  await expect(page.locator('.focus-line code')).toHaveText(en[line-1]);
  mkdirSync('docs/screenshots',{recursive:true});await captureUi(page,info,'diagnostic');
  await page.locator('.text-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
  await expect(page.locator('.text-row').last()).toHaveAttribute('data-text-line',String(en.length));
  expect(await page.locator('.text-row').count()).toBeLessThanOrEqual(120);
  await page.getByRole('button',{name:/読み込み結果$/}).click();await expect(page.getByRole('tab',{name:/^エラー/})).toHaveAttribute('aria-selected','true');
});

test('warning locations open both the removed setting and its English count field',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page,'BasicData/CDataBase/04.txt');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();
  await page.getByRole('tab',{name:/^自動補正/}).click();await page.locator('.diagnostic.warning').filter({hasText:'無効化された設定'}).first().click();
  await expect(page.locator('.focus-line code')).toContainText('CHOICE_NAME_0_0=');
  await page.getByRole('tab',{name:'英語',exact:true}).click();await expect(page.locator('.focus-line code')).toHaveText('CHOICE_NAME_0_NUM=0');
});

test('rejected files remain viewable in both languages after restart',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await page.goto('/');await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [name,lang] of [['ja','ja-JP'],['en','en-US']]) {
    let text=readFileSync(`.reference/${lang}/texts/${sourcePath}`,'utf8');if(name==='en') text=text.replace('EVENT_ID=0','EVENT_ID=999');
    await page.locator(`input[name=${name}]`).setInputFiles({name:`${lang}.zip`,mimeType:'application/zip',buffer:Buffer.from(zipSync({[`${lang}/texts/${sourcePath}`]:Buffer.from(text)}))});
  }
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90_000});
  await page.locator('.diagnostic.error').click();await expect(page.locator('.focus-line code')).toHaveText('EVENT_ID=0');
  await page.getByRole('tab',{name:'英語',exact:true}).click();await expect(page.locator('.focus-line code')).toHaveText('EVENT_ID=999');
  await page.reload();await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'読み込み結果 (エラー1)',exact:true}).click();
  await page.locator('.diagnostic.error').click();await page.getByRole('tab',{name:'英語',exact:true}).click();await expect(page.locator('.focus-line code')).toHaveText('EVENT_ID=999');
});

test('folder disclosure triangles keep the same geometry in both states',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  await page.getByRole('button',{name:'戻る',exact:true}).click();
  const folder=page.locator('.folder[data-value="MapData"]');
  const geometry=async()=>folder.locator('.folder-triangle').evaluate(svg=>{
    const r=svg.getBoundingClientRect(),p=svg.querySelector('path')!.getBoundingClientRect();
    return {width:r.width,height:r.height,pathWidth:p.width,pathHeight:p.height,d:svg.querySelector('path')!.getAttribute('d')};
  });
  const open=await geometry();await folder.click();await expect(folder).toHaveAttribute('aria-expanded','false');
  expect(await geometry()).toEqual(open);await folder.click();await expect(folder).toHaveAttribute('aria-expanded','true');expect(await geometry()).toEqual(open);
});

const navigationPaths=['BasicData/CommonEvent/000.txt','BasicData/CommonEvent/001.txt','BasicData/CommonEvent/002.txt','MapData/Dungeon/Event_0000.txt'];
async function openTreeFile(page:Page,path:string) {
  if(await page.getByRole('button',{name:'戻る',exact:true}).count()) await page.getByRole('button',{name:'戻る',exact:true}).click();
  const parts=path.split('/');
  for(let i=0;i<parts.length;i++) {
    const row=page.locator(`.file-row[data-value="${parts.slice(0,i+1).join('/')}"]`);
    if(i===parts.length-1 || await row.getAttribute('aria-expanded')==='false') await row.click();
  }
}
async function loadNavigationFiles(page:Page) {
  await page.goto('/');await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [name,lang] of [['ja','ja-JP'],['en','en-US']]) {
    const entries=Object.fromEntries(navigationPaths.map(path=>[`${lang}/texts/${path}`,readFileSync(`.reference/${lang}/texts/${path}`)]));
    await page.locator(`input[name=${name}]`).setInputFiles({name:`${lang}.zip`,mimeType:'application/zip',buffer:Buffer.from(zipSync(entries))});
  }
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90_000});
  if(await page.getByRole('dialog').count()) await page.getByRole('button',{name:'閉じる',exact:true}).click();
}
test('boundary navigation confirms forward and backward file changes and preserves cancellation',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadNavigationFiles(page);await openTreeFile(page,navigationPaths[0]);
  await expect(page.getByRole('button',{name:'前の項目',exact:true})).toBeDisabled();
  await page.locator('.entry-open').click();await page.locator('.pick-row').last().click();
  const last=await page.locator('.counter').textContent();
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('次の「001.txt」を開きますか？');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await expect(page.locator('h1')).toHaveText('000.txt');await expect(page.locator('.counter')).toHaveText(last!);
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();
  await expect(page.locator('h1')).toHaveText('001.txt');await expect(page.locator('.counter')).toHaveText(/^1 \/ /);
  await page.goBack();await expect(page.locator('h1')).toHaveText('000.txt');await expect(page.locator('.counter')).toHaveText(last!);await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.goForward();await expect(page.locator('h1')).toHaveText('001.txt');await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await page.keyboard.press('ArrowLeft');await expect(page.getByRole('alertdialog')).toContainText('前の「000.txt」を開きますか？');
  await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('h1')).toHaveText('000.txt');await expect(page.locator('.counter')).toHaveText(last!);
});
test('cross-file navigation applies the folder filter and distinguishes folder changes',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadNavigationFiles(page);
  for(const path of [navigationPaths[0],navigationPaths[2],navigationPaths[3]]) {
    await openTreeFile(page,path);await page.getByRole('button',{name:'コメント',exact:true}).click();await page.getByLabel('コメント内容').fill('Review '+path);
    await page.getByRole('button',{name:'送信',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
  }
  await page.getByRole('button',{name:'戻る',exact:true}).click();await page.getByRole('button',{name:'コメントあり',exact:true}).click();await openTreeFile(page,navigationPaths[0]);
  await expect(page.locator('.counter')).toHaveText('1 / 1');
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('次の「002.txt」を開きますか？');
  await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('h1')).toHaveText('002.txt');await expect(page.locator('.counter')).toHaveText('1 / 1');
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('次のフォルダ「MapData/Dungeon」へ移動して「Event_0000.txt」を開きますか？');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await expect(page.locator('h1')).toHaveText('002.txt');
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('h1')).toHaveText('Event_0000.txt');
  await expect(page.getByRole('button',{name:'次の項目',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'前の項目',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('前のフォルダ「BasicData/CommonEvent」');
  await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('h1')).toHaveText('002.txt');
});

async function postReviewComment(page:Page,text:string) {
  await page.locator('.comment-trigger').click();await page.getByLabel('コメント内容').fill(text);await page.getByRole('button',{name:'送信',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
}
async function resolveCurrentComment(page:Page) {
  await page.locator('.comment-trigger').click();await page.getByRole('button',{name:'解決',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
}

async function exportCurrentRequest(page:Page) {
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビューを依頼',exact:true}).click();
  await page.getByRole('radio',{name:'既存コメントに回答・修正する',exact:true}).check();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'JSONを出力',exact:true}).click();
  const file=await download,request=JSON.parse(readFileSync((await file.path())!,'utf8'));
  expect(file.suggestedFilename()).toBe(`review_request_${request.requestId.replace(/-/g,'').slice(0,12)}.json`);
  await expect(page.getByLabel('ChatGPT向け指示文')).toHaveCount(0);
  await page.getByRole('button',{name:'閉じる',exact:true}).click();return request;
}
async function importRevisedAnswer(page:Page,request:any,decision:string,translation:string,changes:any[]) {
  const entry=request.entries[0],response={schemaVersion:1,requestId:request.requestId,suggestions:[],responses:[{commentId:entry.commentId,path:entry.path,itemId:entry.itemId,fileVersion:entry.fileVersion,decision,reason:decision==='rejected'?'Withdrawn after reconsideration':'Corrected spelling',changes}]};
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビュー結果を読み込む',exact:true}).click();
  await page.locator('input[name=answer]').setInputFiles({name:'response.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});
  const revised=readFileSync(`.reference/en-US/texts/${sourcePath}`,'utf8').replace(/EVENT_NAME=[^\r\n]*/,`EVENT_NAME=${translation}`);
  await page.locator('input[name=revised]').setInputFiles({name:'revised.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[`en-US/texts/${sourcePath}`]:Buffer.from(revised)}))});
  await page.getByRole('button',{name:'回答を読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
}

test('rejected reassessment ZIP imports and discarded proposals stay discarded after reopen and restart',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);await postReviewComment(page,'Correct the name');
  const first=await exportCurrentRequest(page),slot=first.entries[0].slots[0];
  await importRevisedAnswer(page,first,'accepted','Revised Name',[{slotId:slot.id,before:slot.translation,after:'Revised Name'}]);
  await resolveCurrentComment(page);await expect(page.locator('.translation')).toHaveText('Revised Name');
  await page.locator('.comment-trigger').click();await page.getByRole('button',{name:'すべてのコメント',exact:true}).click();await page.getByRole('button',{name:'再開',exact:true}).click();
  await page.getByRole('button',{name:'返信',exact:true}).click();await page.getByLabel('コメント内容').fill('Please withdraw the previous proposal');await page.getByRole('button',{name:'送信',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
  const second=await exportCurrentRequest(page);expect(second.entries[0].pendingChanges[0].after).toBe('Revised Name');
  await importRevisedAnswer(page,second,'rejected',slot.translation,[]);
  await expect(page.locator('.translation-after')).toHaveText('Revised Name');
  const sourceBox=await page.locator('.source').boundingBox(),afterBox=await page.locator('.translation-after').boundingBox(),noticeBox=await page.locator('.rejected-proposal').boundingBox(),discardBox=await page.getByRole('button',{name:'不採用の変更を破棄',exact:true}).boundingBox();
  expect(noticeBox!.x).toBe(sourceBox!.x);expect(discardBox!.x).toBe(sourceBox!.x);expect(noticeBox!.y-afterBox!.y-afterBox!.height).toBeGreaterThanOrEqual(12);
  await page.getByRole('button',{name:'不採用の変更を破棄',exact:true}).click();await page.getByRole('button',{name:'キャンセル',exact:true}).click();await expect(page.locator('.translation-after')).toBeVisible();
  await page.getByRole('button',{name:'不採用の変更を破棄',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('.translation-after')).toHaveCount(0);await expect(page.locator('.translation')).toHaveText(slot.translation);
  await page.reload();await openTreeFile(page,sourcePath);await expect(page.getByRole('button',{name:'不採用の変更を破棄',exact:true})).toHaveCount(0);
  await resolveCurrentComment(page);await page.locator('.comment-trigger').click();await page.getByRole('button',{name:'すべてのコメント',exact:true}).click();await page.getByRole('button',{name:'再開',exact:true}).click();await expect(page.locator('.post-text')).toContainText(['Correct the name','Corrected spelling','Please withdraw the previous proposal','Withdrawn after reconsideration']);await page.getByRole('button',{name:'閉じる',exact:true}).click();await expect(page.locator('.translation-after')).toHaveCount(0);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();const zipEvent=page.waitForEvent('download');await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();
  const zip=readFileSync((await (await zipEvent).path())!);expect(Buffer.from(unzipSync(zip)[`en-US/texts/${sourcePath}`]).toString('utf8')).toContain(`EVENT_NAME=${slot.translation}`);await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();await page.locator('input[name=en]').setInputFiles({name:'reviewed.zip',mimeType:'application/zip',buffer:zip});await expect(page.locator('input[name=ja]')).not.toHaveAttribute('required');await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);await expect(page.locator('.translation-after')).toHaveCount(0);await expect(page.locator('.translation')).toHaveText(slot.translation);
});
test('resolved comment-filter items stay visible while counters update until arrow navigation',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  await postReviewComment(page,'First issue');await page.getByRole('button',{name:'次の項目',exact:true}).click();await postReviewComment(page,'Second issue');
  await page.getByRole('button',{name:'前の項目',exact:true}).click();await page.locator('.entry-open').click();await page.getByRole('button',{name:'コメントあり',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await expect(page.locator('.counter')).toHaveText('1 / 2');await resolveCurrentComment(page);
  await expect(page.locator('.entry-title')).toHaveText('イベント名');await expect(page.locator('.counter')).toHaveText('0 / 1');await expect(page.locator('.float-comment')).toHaveCount(0);
  await page.getByRole('button',{name:'承認',exact:true}).click();await expect(page.locator('.entry-title')).toHaveText('イベント名');await expect(page.locator('.status')).toHaveText('確認済み');
  await page.locator('.entry-open').click();await page.getByRole('button',{name:'コメントあり',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();await expect(page.locator('.entry-title')).toHaveText('イベント名');
  await page.locator('.comment-trigger').click();await page.getByRole('button',{name:'すべてのコメント',exact:true}).click();await page.getByRole('button',{name:'編集',exact:true}).click();await page.getByLabel('コメント内容').fill('Updated first issue');await page.getByRole('button',{name:'保存',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await expect(page.locator('.entry-title')).toHaveText('イベント名');await expect(page.locator('.counter')).toHaveText('0 / 1');
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.locator('.entry-title')).toHaveText('文章の表示 1');await expect(page.locator('.counter')).toHaveText('1 / 1');
  await resolveCurrentComment(page);await expect(page.locator('.entry-title')).toHaveText('文章の表示 1');await expect(page.locator('.counter')).toHaveText('0 / 0');
  await expect(page.getByRole('button',{name:'次の項目',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'前の項目',exact:true})).toBeDisabled();
});
test('resolved last comment stays until confirming a move to the next filtered file',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadNavigationFiles(page);
  for(const path of [navigationPaths[0],navigationPaths[2]]) {await openTreeFile(page,path);await postReviewComment(page,'Review '+path);}
  await page.getByRole('button',{name:'戻る',exact:true}).click();await page.getByRole('button',{name:'コメントあり',exact:true}).click();await openTreeFile(page,navigationPaths[0]);
  await resolveCurrentComment(page);await expect(page.locator('h1')).toHaveText('000.txt');await expect(page.locator('.counter')).toHaveText('0 / 0');
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('次の「002.txt」を開きますか？');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await expect(page.locator('h1')).toHaveText('000.txt');await expect(page.locator('.counter')).toHaveText('0 / 0');
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('h1')).toHaveText('002.txt');await expect(page.locator('.counter')).toHaveText('1 / 1');
});

test('export sheets select all files, align output buttons, and preview copied instructions in the center',async({page},info)=>{
  test.skip(!corpus,'Private reference files not available');
  await page.addInitScript(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{if((window as any).failClipboard)throw Error('Clipboard denied');(window as any).copiedInstructions=text;}}});});
  await loadNavigationFiles(page);
  for(const path of [navigationPaths[0],navigationPaths[2]]) {await openTreeFile(page,path);await postReviewComment(page,'Review this file');}
  await page.getByRole('button',{name:'戻る',exact:true}).click();await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビューを依頼',exact:true}).click();
  const all=page.getByRole('checkbox',{name:'すべて選択',exact:true}),files=page.locator('[data-export-path]');
  await expect(files).toHaveCount(2);await expect(all).toBeChecked();await all.uncheck();await expect(page.locator('[data-export-path]:checked')).toHaveCount(0);await expect(page.getByRole('button',{name:'JSONを出力',exact:true})).toBeDisabled();
  await files.first().check();expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBeTruthy();await all.check();await expect(page.locator('[data-export-path]:checked')).toHaveCount(2);
  const jsonBox=await page.getByRole('button',{name:'JSONを出力',exact:true}).boundingBox(),zipBox=await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).boundingBox();expect(jsonBox!.y).toBe(zipBox!.y);expect(jsonBox!.x+jsonBox!.width).toBeLessThan(zipBox!.x);
  await captureUi(page,info,'export');
  await page.getByRole('button',{name:'指示文をコピー',exact:true}).click();await expect(page.locator('.toast')).toContainText('指示文をコピーしました');await expect(page.locator('.sheet details')).toHaveCount(0);await expect(page.locator('.sheet .instructions')).toHaveCount(0);
  const copied=await page.evaluate(()=>(window as any).copiedInstructions);expect(copied).toContain('woditor_review_tool.py');
  await page.getByRole('button',{name:'指示文を確認',exact:true}).click();const modal=page.getByRole('dialog',{name:'指示文',exact:true});await expect(modal.locator('pre')).toHaveText(copied);await expect(page.getByRole('button',{name:'指示文を閉じる',exact:true})).toBeFocused();await page.goBack();await expect(modal).toHaveCount(0);await expect(page.getByRole('dialog',{name:'AIレビューを依頼',exact:true})).toBeVisible();await page.goForward();await expect(modal.locator('pre')).toHaveText(copied);
  const box=await modal.boundingBox(),viewport=page.viewportSize()!;expect(Math.abs(box!.y+box!.height/2-viewport.height/2)).toBeLessThan(2);expect(Math.abs(box!.x+box!.width/2-viewport.width/2)).toBeLessThan(2);
  await page.keyboard.press('Shift+Tab');await expect(modal.locator('pre')).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'指示文を閉じる',exact:true})).toBeFocused();await captureUi(page,info,'instructions');await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await expect(page.getByRole('dialog',{name:'AIレビューを依頼',exact:true})).toBeVisible();
  await page.evaluate(()=>{(window as any).failClipboard=true;});await page.getByRole('button',{name:'指示文をコピー',exact:true}).click();await expect(page.locator('.toast')).toContainText('コピーできませんでした');await page.getByRole('button',{name:'指示文を確認',exact:true}).click();await expect(modal.locator('pre')).toHaveText(copied);await page.getByRole('button',{name:'指示文を閉じる',exact:true}).click();
  await page.getByRole('button',{name:'閉じる',exact:true}).click();await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();await expect(files).toHaveCount(4);await expect(all).toBeChecked();await all.uncheck();await expect(page.getByRole('button',{name:'英訳TXTを出力',exact:true})).toBeDisabled();await files.last().check();expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBeTruthy();await all.check();await expect(page.locator('[data-export-path]:checked')).toHaveCount(4);
});

test('export trees preserve hierarchy and support collapsed folder selection in both panels',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadNavigationFiles(page);
  for(const panel of ['AIレビューを依頼','英訳TXTを出力']) {
    await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:panel,exact:true}).click();
    const folder=page.getByRole('checkbox',{name:'BasicData/CommonEventを選択',exact:true});
    await expect(page.locator('.export-folder span').first()).toHaveText('BasicData');await expect(page.locator('.export-leaf span').first()).toHaveText('000.txt');
    const parent=await folder.boundingBox(),child=await page.locator('[data-export-path]').first().boundingBox();expect(child!.x).toBeGreaterThan(parent!.x);
    await folder.uncheck();await expect(page.locator('[data-export-path]:checked')).toHaveCount(1);
    await page.locator('[data-export-path]').first().check();expect(await folder.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBe(true);
    await page.getByRole('button',{name:'BasicData/CommonEventを閉じる',exact:true}).click();await expect(page.locator('[data-export-path]').first()).not.toBeVisible();
    await folder.check();await expect(page.locator('[data-export-path]:checked')).toHaveCount(4);await expect(page.getByRole('checkbox',{name:'すべて選択',exact:true})).toBeChecked();
    await page.getByRole('button',{name:'BasicData/CommonEventを開く',exact:true}).click();await closeReviewSheet(page);
  }
});

test.describe('backup timestamps',()=>{
  test.use({timezoneId:'Pacific/Honolulu'});
  test('backup download uses the device local date and time and can restore',async({page})=>{
    test.skip(!corpus,'Private reference files not available');await loadReal(page);
    await page.clock.setFixedTime(new Date('2026-11-10T05:06:07Z'));
    await page.getByRole('button',{name:'メニュー',exact:true}).click();const event=page.waitForEvent('download');await page.getByRole('button',{name:'状態をバックアップ',exact:true}).click();const file=await event;
    expect(file.suggestedFilename()).toBe('woditor-review-backup_2026-11-09_19-06-07.json');
    const backup=await file.path();await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'バックアップを復元',exact:true}).click();await page.locator('input[name=backup]').setInputFiles(backup!);await page.getByRole('button',{name:'復元する',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('.file-row')).toContainText('MapData');
  });
});

test('initial AI review adds comments without changing translations and continues with a correction request',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  const original=await page.locator('.translation').innerText();
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビューを依頼',exact:true}).click();await expect(page.getByRole('radio',{name:'英訳をチェックして指摘を作る',exact:true})).toBeChecked();
  const event=page.waitForEvent('download');await page.getByRole('button',{name:'JSONを出力',exact:true}).click();const request=JSON.parse(readFileSync((await (await event).path())!,'utf8'));
  expect(request.mode).toBe('initial');expect(request.entries).toEqual([]);expect(request.targets.length).toBeGreaterThan(1);expect(request.targets[0].threads).toEqual([]);await closeReviewSheet(page);
  const target=request.targets[0],response={schemaVersion:1,requestId:request.requestId,responses:[],suggestions:[{id:'initial-ai-comment',path:target.path,itemId:target.itemId,fileVersion:target.fileVersion,reason:'名前表記を確認してください',changes:[]}]};
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビュー結果を読み込む',exact:true}).click();await page.locator('input[name=answer]').setInputFiles({name:'initial-response.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});await page.getByRole('button',{name:'回答を読み込む',exact:true}).click();
  await expect(page.locator('.float-preview')).toHaveText('名前表記を確認してください');await expect(page.locator('.translation')).toHaveText(original);await expect(page.locator('.translation-after')).toHaveCount(0);await expect(page.locator('.status')).toHaveText('未確認');
  await page.reload();await openTreeFile(page,sourcePath);await page.locator('.comment-trigger').click();await expect(page.locator('.thread-top strong')).toHaveText('AI');await page.getByRole('button',{name:'返信',exact:true}).click();await page.getByLabel('コメント内容').fill('修正してください');await page.getByRole('button',{name:'送信',exact:true}).click();await closeReviewSheet(page);
  const followup=await exportCurrentRequest(page);expect(followup.mode).not.toBe('initial');expect(followup.entries[0].posts.map((p:any)=>p.author)).toEqual(['ai','user']);
  await importRevisedAnswer(page,followup,'accepted','Revised Name',[{slotId:target.slots[0].id,before:original,after:'Revised Name'}]);await expect(page.locator('.translation-after')).toHaveText('Revised Name');await resolveCurrentComment(page);await expect(page.locator('.translation')).toHaveText('Revised Name');
});
async function closeReviewSheet(page:Page){await page.getByRole('button',{name:'閉じる',exact:true}).click();}

test('review mode stays selected after panel close, history and app restart',async({page,context})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  const open=async(p:Page)=>{await p.getByRole('button',{name:'メニュー',exact:true}).click();await p.getByRole('button',{name:'AIレビューを依頼',exact:true}).click();};
  await open(page);await page.getByRole('radio',{name:'既存コメントに回答・修正する',exact:true}).check();await closeReviewSheet(page);await open(page);await expect(page.getByRole('radio',{name:'既存コメントに回答・修正する',exact:true})).toBeChecked();
  await page.getByRole('radio',{name:'英訳をチェックして指摘を作る',exact:true}).check();await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await open(page);await expect(page.getByRole('radio',{name:'英訳をチェックして指摘を作る',exact:true})).toBeChecked();
  await page.reload();await expect(page.locator('.busy')).toHaveCount(0);await open(page);await expect(page.getByRole('radio',{name:'英訳をチェックして指摘を作る',exact:true})).toBeChecked();await page.getByRole('radio',{name:'既存コメントに回答・修正する',exact:true}).check();await closeReviewSheet(page);
  const next=await context.newPage();await next.goto('/');await expect(next.locator('.busy')).toHaveCount(0);await page.close();await open(next);await expect(next.getByRole('radio',{name:'既存コメントに回答・修正する',exact:true})).toBeChecked();
});

test('menu dismisses outside without activating content and the item picker reveals the current item',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadNavigationFiles(page);await openTreeFile(page,navigationPaths[0]);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.locator('.menu-dismiss').click({position:{x:20,y:300}});await expect(page.locator('.menu')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'メニュー',exact:true}).click();await expect(page.locator('.menu')).toHaveCount(0);
  await page.locator('.entry-open').click();await page.locator('.pick-row').last().click();const title=await page.locator('.entry-title').textContent();await page.locator('.entry-open').click();await expect(page.locator('.pick-row.active')).toContainText(title!);await expect(page.locator('.pick-row.active')).toBeInViewport();expect(await page.locator('.sheet-body').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
});

test('context controls retain all options and full view marks every variable usage',async({page},info)=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page,navigationPaths[0]);
  const target=await page.evaluate(async(path)=>{
    const db=await new Promise<IDBDatabase>(resolve=>{const r=indexedDB.open('woditor-review');r.onsuccess=()=>resolve(r.result);});
    const file:any=await new Promise(resolve=>{const r=db.transaction('files').objectStore('files').get(path);r.onsuccess=()=>resolve(r.result);});db.close();
    const item=file.items.find((i:any)=>file.usages[i.slotIds[0]]?.length>1),hits=file.usages[item.slotIds[0]],index=file.commands.findIndex((c:any)=>c.line===hits[0]);
    return {id:item.id,hits:hits.length,commands:file.commands.length,partial:Math.min(file.commands.length,index+8)-Math.max(0,index-7),ja:file.commands[0].ja};
  },navigationPaths[0]);
  await page.locator('.entry-open').click();await page.locator(`.pick-row[data-value="${target.id}"]`).click();
  const button=(name:string)=>page.getByRole('button',{name,exact:true});
  await button('前後の行数').click();await page.getByRole('option',{name:'7行',exact:true}).click();await expect(page.locator('.command')).toHaveCount(target.partial);
  await button('ファイル全体を表示').click();await expect(button('前後の行数')).toBeDisabled();await expect(page.locator('.command')).toHaveCount(target.commands);await expect(page.locator('.command.current')).toHaveCount(target.hits);await expect(page.locator('.usage-tools')).toHaveText(`使用箇所 ${target.hits}件`);await expect(button('次の使用箇所')).toHaveCount(0);await captureUi(page,info,'context-full','.context-tools');
  await button('行番号').click();await expect(page.locator('.command-number').first()).toHaveText('0');
  await button('行の折り返し').click();await expect(page.locator('.command-code').first()).toHaveCSS('white-space','pre');
  await button('表示言語').click();await page.getByRole('option',{name:'日本語',exact:true}).click();await expect(page.locator('.command-code').first()).toHaveText(target.ja);
  if(info.project.name==='desktop') await button('行番号').hover();
  else {await button('行番号').dispatchEvent('pointerdown',{pointerType:'touch'});}
  await expect(page.getByRole('tooltip')).toHaveText('行番号');
  if(info.project.name==='mobile') {await button('行番号').dispatchEvent('pointerup',{pointerType:'touch'});await button('行番号').dispatchEvent('click');await expect(button('行番号')).toHaveAttribute('aria-pressed','true');}
  await page.locator('.context-title').click();await expect(page.locator('.command-frame')).toHaveCount(0);await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.locator('.command-frame')).toHaveCount(0);
  await page.reload();await openTreeFile(page,navigationPaths[0]);await page.locator('.entry-open').click();await page.locator(`.pick-row[data-value="${target.id}"]`).click();await expect(page.locator('.context-title')).toHaveAttribute('aria-expanded','false');await page.locator('.context-title').click();
  await expect(button('ファイル全体を表示')).toHaveAttribute('aria-pressed','true');await expect(button('行番号')).toHaveAttribute('aria-pressed','true');await expect(button('行の折り返し')).toHaveAttribute('aria-pressed','false');await expect(page.locator('.command-code').first()).toHaveText(target.ja);
  await expect(button('前後の行数')).toBeDisabled();await button('ファイル全体を表示').click();await expect(button('前後の行数')).toBeEnabled();await expect(page.locator('.command')).toHaveCount(target.partial);await button('前後の行数').click();await expect(page.getByRole('option',{name:'7行',exact:true})).toHaveAttribute('aria-selected','true');const title=await page.locator('.entry-title').textContent();await page.keyboard.press('ArrowRight');await expect(page.locator('.entry-title')).toHaveText(title!);await expect(page.getByRole('listbox')).toBeVisible();await page.goBack();await expect(page.getByRole('listbox')).toHaveCount(0);await expect(page.locator('.command')).toHaveCount(target.partial);
});

test('diagnostic errors and warnings open translation items and Back restores the results tab',async({page},info)=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page,'BasicData/CDataBase/04.txt');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();await page.getByRole('tab',{name:/^自動補正/}).click();
  const row=page.locator('.diagnostic-row').filter({has:page.locator('[data-action=diagnostic-item]')}).first(),text=row.locator('.diagnostic-open'),item=row.locator('.diagnostic-item');
  const alignment=async()=>{const a=await text.boundingBox(),b=await item.boundingBox(),r=await row.boundingBox();expect(b!.x).toBeGreaterThanOrEqual(a!.x+a!.width);expect(Math.abs(b!.x+b!.width-r!.x-r!.width+8)).toBeLessThan(1);expect(Math.abs(b!.y+b!.height/2-r!.y-r!.height/2)).toBeLessThan(1);};
  await expect(text).toHaveJSProperty('tagName','SPAN');await expect(row.locator('strong')).toHaveCSS('font-weight','700');
  await alignment();await page.setViewportSize({width:320,height:844});await alignment();expect(await item.evaluate(el=>el.getBoundingClientRect().right<=innerWidth)).toBe(true);await page.setViewportSize(info.project.name==='mobile'?{width:390,height:844}:{width:1280,height:900});
  await captureUi(page,info,'results');
  await item.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  if(info.project.name==='desktop') await item.hover();else await item.dispatchEvent('pointerdown',{pointerType:'touch'});
  await expect(page.getByRole('tooltip')).toHaveText((await item.getAttribute('aria-label'))!);
  if(info.project.name==='mobile') {await item.dispatchEvent('pointerup',{pointerType:'touch'});await item.dispatchEvent('click');await expect(page.getByRole('dialog',{name:'読み込み結果',exact:true})).toBeVisible();}
  await text.click();await expect(page.getByRole('dialog',{name:'テキスト表示',exact:true})).toBeVisible();await page.goBack();await expect(page.getByRole('tab',{name:/^自動補正/})).toHaveAttribute('aria-selected','true');
  await page.locator('[data-action=diagnostic-item]').first().click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.source')).toBeVisible();await page.goBack();await expect(page.getByRole('tab',{name:/^自動補正/})).toHaveAttribute('aria-selected','true');
  await loadReal(page,'MapData/SampleMapA/Event_0019.txt');await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();
  await page.locator('.diagnostic.error').first().locator('..').getByRole('button',{name:'翻訳項目を開く',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.source')).toHaveText('');await expect(page.getByRole('button',{name:'原文を補う',exact:true})).toBeVisible();await page.goBack();await expect(page.getByRole('tab',{name:/^エラー/})).toHaveAttribute('aria-selected','true');
});

test('comments focus the composer, show scroll directions and fit the keyboard viewport with short search results',async({page},info)=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  const source=await page.locator('.source').textContent();await page.locator('.comment-trigger').click();await expect(page.getByLabel('コメント内容')).toBeFocused();
  const up=page.getByRole('button',{name:'コメントを上にスクロール',exact:true}),down=page.getByRole('button',{name:'コメントを下にスクロール',exact:true});
  await expect(up).toBeHidden();await expect(down).toBeHidden();
  for(let i=0;i<3;i++) {await page.getByLabel('コメント内容').fill(`Comment ${i}\n`+'Long review line\n'.repeat(8));await page.getByRole('button',{name:'送信',exact:true}).click();}
  const expectCenteredMark=async(control:Locator)=>{
    const offsets=await control.evaluate(button=>{const outer=button.getBoundingClientRect();return ['svg','path'].map(selector=>{const mark=button.querySelector(selector)!.getBoundingClientRect();return {x:mark.x+mark.width/2-outer.x-outer.width/2,y:mark.y+mark.height/2-outer.y-outer.height/2};});});
    for(const offset of offsets) {expect(Math.abs(offset.x)).toBeLessThan(.25);expect(Math.abs(offset.y)).toBeLessThan(.25);}
  };
  await expect(down).toBeVisible();await expect(up).toBeHidden();await expectCenteredMark(down);await captureUi(page,info,'comment-scroll');await down.click();await expect(up).toBeVisible();await expectCenteredMark(up);
  const guide=await up.boundingBox(),listBox=await page.locator('.comments-list').boundingBox();expect(Math.abs(guide!.x+guide!.width/2-listBox!.x-listBox!.width/2)).toBeLessThan(1);
  const list=page.locator('.comments-list');await list.evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(down).toBeHidden();await expect(up).toBeVisible();await up.click();await expect(down).toBeVisible();
  const resize=async(height:number,top=0)=>{
    await page.evaluate(({height,top})=>{Object.defineProperty(visualViewport!,'height',{configurable:true,value:height});Object.defineProperty(visualViewport!,'offsetTop',{configurable:true,value:top});visualViewport!.dispatchEvent(new Event('resize'));},{height,top});
    await expect(page.locator('#app')).toHaveCSS('height',`${height}px`);
  };
  await page.getByLabel('コメント内容').focus();await resize(430,30);
  const panel=await page.getByRole('dialog',{name:'コメント',exact:true}).boundingBox(),composer=await page.getByLabel('コメント内容').boundingBox();
  expect(panel!.y).toBeGreaterThanOrEqual(30);expect(panel!.y+panel!.height).toBeLessThanOrEqual(460);expect(composer!.y+composer!.height).toBeLessThan(460);
  await page.evaluate(()=>scrollTo(0,200));expect(await page.evaluate(()=>scrollY)).toBe(0);await closeReviewSheet(page);
  await resize(page.viewportSize()!.height);await page.locator('.entry-open').click();await page.getByLabel('翻訳項目を検索').focus();await page.getByLabel('翻訳項目を検索').fill(source!);await expect(page.locator('.pick-row')).toHaveCount(1);await resize(400);
  const picker=await page.getByRole('dialog',{name:'翻訳項目',exact:true}).boundingBox();expect(picker!.y).toBeGreaterThanOrEqual(0);expect(picker!.y+picker!.height).toBeLessThanOrEqual(400);
  await page.evaluate(()=>scrollTo(0,200));expect(await page.evaluate(()=>scrollY)).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true);
});

test('review badge text aligns with its label',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);await postReviewComment(page,'Alignment check');
  const centers=await page.locator('.comment-trigger').evaluate(button=>['.comment-label','.bubble'].map(selector=>{const range=document.createRange();range.selectNodeContents(button.querySelector(selector)!);const rect=range.getBoundingClientRect();return rect.y+rect.height/2;}));
  expect(Math.abs(centers[0]-centers[1])).toBeLessThanOrEqual(1.5);
});

test('floating comments reveal the displayed post without focusing the composer, including history and replies',async({page})=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  await page.locator('.comment-trigger').click();const composer=page.getByLabel('コメント内容');await expect(composer).toBeFocused();
  for(let i=0;i<3;i++) {await composer.fill(`Thread ${i}\n`+'Review details\n'.repeat(8));await page.getByRole('button',{name:'送信',exact:true}).click();}
  await page.getByRole('button',{name:'すべてのコメント',exact:true}).click();
  await page.locator('.thread').first().getByRole('button',{name:'解決',exact:true}).click();
  await page.locator('.thread').nth(1).getByRole('button',{name:'返信',exact:true}).click();await composer.fill('この返信を表示');await page.getByRole('button',{name:'送信',exact:true}).click();await composer.fill('未送信の下書き');await closeReviewSheet(page);
  await expect(page.locator('.float-preview')).toHaveText('この返信を表示');const postId=await page.locator('.float-comment').getAttribute('data-value');
  await page.locator('.float-comment').click();const post=page.locator(`[data-post-id="${postId}"]`);
  await expect(post).toHaveClass('reply');await expect(post).toBeInViewport();await expect(post).toBeFocused();await expect(composer).not.toBeFocused();await expect(composer).toHaveValue('未送信の下書き');expect(await page.locator('.comments-list').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
  await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await page.goForward();await expect(post).toBeInViewport();await expect(post).toBeFocused();await expect(composer).not.toBeFocused();
  await closeReviewSheet(page);await page.locator('.comment-trigger').click();await expect(composer).toBeFocused();await expect(composer).toHaveValue('未送信の下書き');
  await composer.fill('最新の新規コメント');await page.getByRole('button',{name:'送信',exact:true}).click();await closeReviewSheet(page);await expect(page.locator('.float-preview')).toHaveText('最新の新規コメント');await page.locator('.float-comment').click();
  const root=page.locator('.thread-root').filter({has:page.locator('.post-text',{hasText:'最新の新規コメント'})});await expect(root).toBeInViewport();await expect(root).toBeFocused();await expect(composer).not.toBeFocused();
});

test('completed item markers use a balanced green at the same size as other markers',async({page},info)=>{
  test.skip(!corpus,'Private reference files not available');await loadReal(page);
  await page.getByRole('button',{name:'承認',exact:true}).click();await page.getByRole('button',{name:'前の項目',exact:true}).click();await page.locator('.entry-open').click();
  await expect(page.locator('.dot.done')).toHaveCSS('background-color','rgb(65, 159, 117)');
  const sizes=await page.locator('.dot').evaluateAll(dots=>dots.map(dot=>{const rect=dot.getBoundingClientRect();return [rect.width,rect.height];}));expect(sizes.every(([width,height])=>width===8 && height===8)).toBe(true);
  await expect(page.locator('.dot.done')).toHaveCSS('box-shadow','none');await captureUi(page,info,'items');
});

test('database memo displays encoded line breaks and multiline previews without changing exported TXT',async({page})=>{
  test.skip(!corpus,'Private reference files not available');const path='BasicData/DataBase/00.txt';await loadReal(page,path);await page.locator('.entry-open').click();
  await expect(page.locator('.pick-title',{hasText:/^項目名 0$/})).toHaveCount(1);
  const memo=page.locator('.pick-row').filter({has:page.locator('.pick-title',{hasText:/^メモ$/})});await expect(memo.locator('.pick-source')).toContainText('...');await memo.click();
  const source=await page.locator('.source').textContent();expect(source).toContain('\n');expect(source).not.toContain(String.raw`<<\n>>`);await expect(page.locator('.slot-warning.subtle')).toHaveCount(0);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();const event=page.waitForEvent('download');await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();
  const zip=unzipSync(readFileSync((await(await event).path())!));expect(Buffer.from(zip[`en-US/texts/${path}`]).equals(readFileSync(`.reference/en-US/texts/${path}`))).toBe(true);
});

test('database CSV multiline strings round trip through AI approval, ZIP and English-only reload',async({page})=>{
  test.skip(!corpus,'Private reference files not available');const path='BasicData/DataBase/00.txt';await loadReal(page,path);await page.locator('.entry-open').click();await page.locator('.pick-row').filter({has:page.locator('.pick-title',{hasText:/^データ 2 \/ 項目 1$/})}).click();
  expect(await page.locator('.source').textContent()).toContain('\n');await postReviewComment(page,'Review CSV wording');const request=await exportCurrentRequest(page),entry=request.entries[0],slot=entry.slots[0];expect(slot.kind).toBe('database_csv');
  const after='Revised, "quoted" text\r\nSecond line\r\nThird line';
  const response={schemaVersion:1,requestId:request.requestId,suggestions:[],responses:[{commentId:entry.commentId,path,itemId:entry.itemId,fileVersion:entry.fileVersion,decision:'accepted',reason:'CSV wording revised',changes:[{slotId:slot.id,before:slot.translation,after}]}]};
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビュー結果を読み込む',exact:true}).click();await page.locator('input[name=answer]').setInputFiles({name:'csv-response.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(response))});await page.getByRole('button',{name:'回答を読み込む',exact:true}).click();await expect(page.locator('.translation-after')).toHaveText(after);await resolveCurrentComment(page);await expect(page.locator('.translation')).toHaveText(after);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();const event=page.waitForEvent('download');await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();const zip=readFileSync((await(await event).path())!);const output=Buffer.from(unzipSync(zip)[`en-US/texts/${path}`]).toString('utf8');
  const original=readFileSync(`.reference/en-US/texts/${path}`,'utf8');expect(output).toBe(original.replace('"'+slot.translation.replaceAll('"','""')+'"','"'+after.replaceAll('"','""')+'"'));await closeReviewSheet(page);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();await page.locator('input[name=en]').setInputFiles({name:'csv-reviewed.zip',mimeType:'application/zip',buffer:zip});await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);if(await page.getByRole('dialog').count()) await closeReviewSheet(page);await expect(page.locator('.translation')).toHaveText(after);await expect(page.locator('.translation-after')).toHaveCount(0);
});

test('import results separate automatic corrections from warnings and keep errors as the default',async({page})=>{
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  const path='BasicData/DataBase/00.txt';
  for(const [name,text] of [['ja','TYPE_ID=0\r\nITEM_NUM=0\r\nMEMO=日本語\r\n'],['en','TYPE_ID=0\nITEM_NUM=0\nMEMO=English\nEXTRA_SETTING=1\n']]) await page.locator(`input[name=${name}]`).setInputFiles({name:name+'.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(text)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90000});await expect(page.getByRole('tab',{name:/^エラー/})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:/^警告/}).click();await expect(page.locator('.diagnostic.warning')).toHaveCount(1);await expect(page.locator('.diagnostic.warning')).toContainText('改行形式');
  await page.getByRole('tab',{name:/^自動補正/}).click();await expect(page.locator('#diagnostic-panel')).toContainText('行数差を自動補正');await expect(page.locator('#diagnostic-panel')).not.toContainText('改行形式');
});
