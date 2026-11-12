import {test,expect} from '@playwright/test';
import {loadFixture,loadNavigationFiles,openTreeFile,postReviewComment,resolveCurrentComment,closeReviewSheet,navigationPaths} from './helpers';

test('system Back closes panels and confirmation before returning to the folder view',async({page})=>{
  await loadFixture(page);
  await page.locator('.comment-trigger').click();await page.goBack();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.source')).toBeVisible();
  await page.goForward();await expect(page.getByRole('dialog',{name:'コメント',exact:true})).toBeVisible();await closeReviewSheet(page);
  await page.goBack();await expect(page.locator('h1')).toHaveText('Woditor Review');await expect(page.locator('.file-row')).not.toHaveCount(0);
  await page.goForward();await expect(page.locator('.entry-title')).toHaveText('イベント名');await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('ArrowRight');await expect(page.locator('.entry-title')).toHaveText('文章の表示 1');await page.keyboard.press('ArrowLeft');await expect(page.locator('.entry-title')).toHaveText('イベント名');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.goBack();await expect(page.locator('.menu')).toHaveCount(0);await expect(page.locator('.source')).toBeVisible();
  await page.getByRole('button',{name:'承認',exact:true}).click();await page.getByRole('button',{name:'前の項目',exact:true}).click();await page.getByRole('button',{name:'未確認に戻す',exact:true}).click();await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.goBack();await expect(page.getByRole('alertdialog')).toHaveCount(0);await expect(page.getByRole('button',{name:'未確認に戻す',exact:true})).toBeVisible();
  await page.goBack();await expect(page.locator('h1')).toHaveText('Woditor Review');
  await page.goBack();await expect(page).toHaveURL('about:blank');
});

test('item search filters rows by either language without changing counters or navigation',async({page})=>{
  await loadFixture(page);
  const count=(await page.locator('.counter').textContent())!.split('/')[1].trim();
  await page.locator('.entry-open').click();
  const search=page.getByRole('searchbox',{name:'翻訳項目を検索'});
  await expect(search).toHaveAttribute('placeholder','検索');await search.fill('イベント名');await expect(page.locator('.pick-row')).toHaveCount(1);await expect(page.locator('.pick-title')).toHaveText('イベント名');
  await search.fill('HeLLo');await expect(page.locator('.pick-row')).toHaveCount(1);await expect(search).toBeFocused();
  await expect(page.locator('.counter')).toHaveText(`1 / ${count}`);
  await page.locator('.pick-row').click();await expect(page.locator('.counter')).toHaveText(`2 / ${count}`);
  await page.locator('.entry-open').click();await search.fill('主人公');await expect(page.locator('.pick-row').first()).toBeVisible();
  await search.fill('no such translation');await expect(page.locator('.pick-row')).toHaveCount(0);await expect(page.locator('.counter')).toHaveText(`2 / ${count}`);
  await page.getByRole('button',{name:'閉じる',exact:true}).click();await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.locator('.counter')).toHaveText(`3 / ${count}`);
});

test('folder status filters flow into item filters in one direction',async({page})=>{
  await loadFixture(page);
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

test('boundary navigation confirms forward and backward file changes and preserves cancellation',async({page})=>{
  await loadNavigationFiles(page);await openTreeFile(page,navigationPaths[0]);
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
  await loadNavigationFiles(page);
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

test('resolved comment-filter items stay visible while counters update until arrow navigation',async({page})=>{
  await loadFixture(page);
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
  await loadNavigationFiles(page);
  for(const path of [navigationPaths[0],navigationPaths[2]]) {await openTreeFile(page,path);await postReviewComment(page,'Review '+path);}
  await page.getByRole('button',{name:'戻る',exact:true}).click();await page.getByRole('button',{name:'コメントあり',exact:true}).click();await openTreeFile(page,navigationPaths[0]);
  await resolveCurrentComment(page);await expect(page.locator('h1')).toHaveText('000.txt');await expect(page.locator('.counter')).toHaveText('0 / 0');
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.getByRole('alertdialog')).toContainText('次の「002.txt」を開きますか？');
  await page.getByRole('button',{name:'キャンセル',exact:true}).click();await expect(page.locator('h1')).toHaveText('000.txt');await expect(page.locator('.counter')).toHaveText('0 / 0');
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.locator('h1')).toHaveText('002.txt');await expect(page.locator('.counter')).toHaveText('1 / 1');
});

test('menu dismisses outside without activating content and the item picker reveals the current item',async({page})=>{
  await loadNavigationFiles(page);await openTreeFile(page,navigationPaths[0]);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.locator('.menu-dismiss').click({position:{x:20,y:300}});await expect(page.locator('.menu')).toHaveCount(0);await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'メニュー',exact:true}).click();await expect(page.locator('.menu')).toHaveCount(0);
  await page.locator('.entry-open').click();await page.locator('.pick-row').last().click();const title=await page.locator('.entry-title').textContent();await page.locator('.entry-open').click();await expect(page.locator('.pick-row.active')).toContainText(title!);await expect(page.locator('.pick-row.active')).toBeInViewport();expect(await page.locator('.sheet-body').evaluate(el=>el.scrollTop)).toBeGreaterThan(0);
});
