import {test,expect} from '@playwright/test';
import {zipSync} from 'fflate';
import {emptyWorkspace} from '../../src/model';
import {captureUi} from './screenshots';
import {loadFixture,openTreeFile,sourcePath,fixtureTextAt} from './helpers';

test('import results restore each tab scroll after text view and system Back',async({page})=>{
  const path='BasicData/CDataBase/00.txt',workspace=emptyWorkspace();
  workspace.diagnosticDocuments=[{path,jaText:Array.from({length:400},(_,i)=>`日本語 ${i}`).join('\n'),enText:Array.from({length:400},(_,i)=>`English ${i}`).join('\n')}];
  for(const severity of ['error','warning'] as const) for(let i=0;i<60;i++) workspace.diagnostics.push({path,severity,message:`${severity} 行 ${i+200}`,line:i+200,enLine:i+190});
  for(let i=0;i<60;i++) workspace.diagnostics.push({path,severity:'warning',message:`設定キーによる行ずれ補正: 行 ${i+200}`,line:i+200,enLine:i+190});
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'バックアップを復元',exact:true}).click();
  await page.locator('input[name=backup]').setInputFiles({name:'scroll.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(workspace))});await page.getByRole('button',{name:'復元する',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();
  const body=page.locator('#diagnostic-panel');
  for(const [index,tab] of ['エラー','警告','自動補正'].entries()) {
    await page.getByRole('tab',{name:new RegExp(`^${tab}`)}).click();
    const row=body.locator('.diagnostic').nth(20+index*5);await row.scrollIntoViewIfNeeded();const offset=await body.evaluate(el=>el.scrollTop);expect(offset).toBeGreaterThan(100);
    for(const systemBack of [false,true]) {
      await row.click();await expect(page.getByRole('dialog',{name:'テキスト表示',exact:true})).toBeVisible();
      await expect(page.locator('.focus-line code')).toHaveText(`日本語 ${219+index*5}`);
      await page.getByRole('tab',{name:'英語',exact:true}).click();await expect(page.locator('.focus-line code')).toHaveText(`English ${209+index*5}`);
      await page.locator('.text-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});
      await expect(page.locator('.text-row').last()).toHaveAttribute('data-text-line','400');
      expect(await page.locator('.text-row').count()).toBeLessThan(400);
      if(systemBack) await page.goBack();else await page.locator('[data-action=diagnostic-back]').click();
      await expect(page.getByRole('tab',{name:new RegExp(`^${tab}`)})).toHaveAttribute('aria-selected','true');
      await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(offset);await expect(row).toBeInViewport();
    }
    await page.getByRole('tab',{name:/^対象外/}).click();await page.getByRole('tab',{name:new RegExp(`^${tab}`)}).click();await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(offset);
  }
});

test('automatic choice notices open both the unused setting and its English count field',async({page})=>{
  await loadFixture(page,'BasicData/CommonEvent/unused.txt');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();
  await page.getByRole('tab',{name:/^自動補正/}).click();await page.locator('.diagnostic.warning').filter({hasText:'未使用の選択肢設定を無視しました（日本語'}).first().click();
  await expect(page.locator('.focus-line code')).toContainText('CHOICE_STR_1_0=');
  await page.getByRole('tab',{name:'英語',exact:true}).click();await expect(page.locator('.focus-line code')).toHaveText('CHOICE_STR_1_NUM=0');
});

test('rejected files remain viewable in both languages after restart',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [name,lang] of [['ja','ja-JP'],['en','en-US']]) {
    let text=fixtureTextAt(sourcePath,lang==='ja-JP'?'ja':'en');if(name==='en') text=text.replace('EVENT_ID=0','EVENT_ID=999');
    await page.locator(`input[name=${name}]`).setInputFiles({name:`${lang}.zip`,mimeType:'application/zip',buffer:Buffer.from(zipSync({[`${lang}/texts/${sourcePath}`]:Buffer.from(text)}))});
  }
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90_000});
  await page.locator('.diagnostic.error').click();await expect(page.locator('.focus-line code')).toHaveText('EVENT_ID=0');
  await page.getByRole('tab',{name:'英語',exact:true}).click();await expect(page.locator('.focus-line code')).toHaveText('EVENT_ID=999');
  await page.reload();await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'読み込み結果 (エラー1)',exact:true}).click();
  await page.locator('.diagnostic.error').click();await page.getByRole('tab',{name:'英語',exact:true}).click();await expect(page.locator('.focus-line code')).toHaveText('EVENT_ID=999');
});

test('diagnostic errors and warnings open translation items and Back restores the results tab',async({page},info)=>{
  await loadFixture(page,'MapData/TestMap/Event_0001.txt');
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();await page.getByRole('tab',{name:/^警告/}).click();
  const row=page.locator('.diagnostic-row').filter({has:page.locator('[data-action=diagnostic-item]')}).first(),text=row.locator('.diagnostic-open'),item=row.locator('.diagnostic-item');
  await captureUi(page,info,'results');
  await item.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  if(info.project.name==='desktop') await item.hover();else await item.dispatchEvent('pointerdown',{pointerType:'touch'});
  await expect(page.getByRole('tooltip')).toHaveText((await item.getAttribute('aria-label'))!);
  if(info.project.name==='mobile') {await item.dispatchEvent('pointerup',{pointerType:'touch'});await item.dispatchEvent('click');await expect(page.getByRole('dialog',{name:'読み込み結果',exact:true})).toBeVisible();}
  await text.click();await expect(page.getByRole('dialog',{name:'テキスト表示',exact:true})).toBeVisible();await page.goBack();await expect(page.getByRole('tab',{name:/^警告/})).toHaveAttribute('aria-selected','true');
  await page.locator('[data-action=diagnostic-item]').first().click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.source')).toBeVisible();await page.goBack();await expect(page.getByRole('tab',{name:/^警告/})).toHaveAttribute('aria-selected','true');
  await loadFixture(page,'MapData/Unpaired/Event_0000.txt');await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();
  await page.locator('.diagnostic.error').first().locator('..').getByRole('button',{name:'翻訳項目を開く',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await expect(page.locator('.source')).toHaveText('');await expect(page.getByRole('button',{name:'原文を補う',exact:true})).toBeVisible();await page.goBack();await expect(page.getByRole('tab',{name:/^エラー/})).toHaveAttribute('aria-selected','true');
});

test('import results separate automatic corrections from warnings and keep errors as the default',async({page})=>{
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  const path='BasicData/DataBase/00.txt';
  for(const [name,text] of [['ja','TYPE_ID=0\r\nITEM_NUM=0\r\nMEMO=日本語\r\n'],['en','TYPE_ID=0\nITEM_NUM=0\nMEMO=English\nEXTRA_SETTING=1\n']]) await page.locator(`input[name=${name}]`).setInputFiles({name:name+'.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(text)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90000});await expect(page.getByRole('tab',{name:/^エラー/})).toHaveAttribute('aria-selected','true');
  await page.getByRole('tab',{name:/^警告/}).click();await expect(page.locator('.diagnostic.warning')).toHaveCount(2);await expect(page.locator('#diagnostic-panel')).toContainText('改行形式');await expect(page.locator('#diagnostic-panel')).toContainText('英語版だけの設定があります');
  await page.getByRole('tab',{name:/^自動補正/}).click();await expect(page.locator('#diagnostic-panel')).toContainText('行数差を自動補正');await expect(page.locator('#diagnostic-panel')).not.toContainText('改行形式');
});

test('ambiguous translations accept a manual original and preserve it after restart',async({page})=>{
  const path='MapData/Unpaired/Event_0000.txt';await loadFixture(page,path);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:/^読み込み結果/}).click();
  await page.locator('.diagnostic.error').first().click();await page.getByRole('tab',{name:'英語',exact:true}).click();
  await expect(page.locator('.focus-line code')).toContainText('[101]');await page.goBack();
  await page.locator('.diagnostic.error').first().locator('..').getByRole('button',{name:'翻訳項目を開く',exact:true}).click();
  await expect(page.locator('.source')).toHaveText('');const title=await page.locator('.entry-title').innerText(),translation=await page.locator('.translation').innerText();
  await page.getByRole('button',{name:'原文を補う',exact:true}).click();await page.getByLabel('補完する原文').fill('補完した原文');await page.getByRole('button',{name:'保存',exact:true}).click();
  await expect(page.locator('.source')).toHaveText('補完した原文');await page.reload();await expect(page.locator('.busy')).toHaveCount(0);await openTreeFile(page,path);
  await page.locator('.entry-open').click();await page.locator('.pick-row').filter({has:page.locator('.pick-title',{hasText:new RegExp('^'+title+'$')})}).click();
  await expect(page.locator('.source')).toHaveText('補完した原文');await expect(page.locator('.translation')).toHaveText(translation);
});
