import {test,expect} from '@playwright/test';
import {zipSync} from 'fflate';
import {importPairs,fixtureText,fixtures,openTreeFile,postReviewComment} from './helpers';

test('English-only partial ZIPs overwrite one file while preserving omitted files and comments',async({page})=>{
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  await expect(page.locator('input[name=ja]')).toHaveAttribute('required');await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await importPairs(page,['map','common'].map(name=>({path:fixtures[name].path,ja:fixtureText(name,'ja'),en:fixtureText(name,'en')})));
  await openTreeFile(page,fixtures.common.path);await postReviewComment(page,'Keep this omitted file');
  await openTreeFile(page,fixtures.map.path);await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  await expect(page.locator('input[name=ja]')).not.toHaveAttribute('required');
  const updated=fixtureText('map','en').replace('EVENT_NAME=Hero','EVENT_NAME=Externally reviewed');
  await page.locator('input[name=en]').setInputFiles({name:'partial.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[fixtures.map.path]:Buffer.from(updated)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.getByRole('alertdialog',{name:'英訳の上書き',exact:true})).toBeVisible();await page.getByRole('button',{name:'上書きする',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0);
  await expect(page.locator('.translation')).toHaveText('Externally reviewed');await expect(page.locator('.translation-after')).toHaveCount(0);
  await openTreeFile(page,fixtures.common.path);await expect(page.locator('.float-preview')).toHaveText('Keep this omitted file');await expect(page.locator('.translation')).toHaveText('Common action');
});

test('generated mixed-format ZIPs parse in the worker, persist losslessly and restore folder scroll',async({page})=>{
  const pairs=Array.from({length:15},(_,index)=>[
    {path:`BasicData/CommonEvent/${String(index).padStart(3,'0')}.txt`,name:'common'},
    {path:`BasicData/DataBase/${String(index).padStart(2,'0')}.txt`,name:'database'},
    {path:`MapData/TestMap/Event_${String(index).padStart(4,'0')}.txt`,name:'map'},
  ]).flat().map(({path,name})=>({path,ja:fixtureText(name,'ja'),en:fixtureText(name,'en')}));
  const external:string[]=[];
  page.on('request',request=>{if(new URL(request.url()).origin!=='http://127.0.0.1:4173')external.push(request.url());});
  await page.addInitScript(()=>{(window as any).ticks=0;setInterval(()=>(window as any).ticks++,10);});
  await importPairs(page,pairs);
  expect(await page.evaluate(()=>(window as any).ticks)).toBeGreaterThan(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const stored=await page.evaluate(async()=>{
    const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('woditor-review');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    try {return await new Promise<{path:string;enText:string;type:string}[]>((resolve,reject)=>{const request=db.transaction('files').objectStore('files').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});} finally {db.close();}
  });
  expect(stored).toHaveLength(pairs.length);
  for(const kind of ['map','common','database']) expect(stored.filter(file=>file.type===kind)).toHaveLength(15);
  for(const file of stored) expect(file.enText).toBe(pairs.find(input=>input.path===file.path)!.en);
  await page.getByRole('button',{name:'全体の進捗',exact:true}).click();await expect(page.locator('.progress-detail')).toContainText(['CommonEvent','DataBase','TestMap']);await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await openTreeFile(page,'BasicData/CommonEvent/000.txt');await page.getByRole('button',{name:'戻る',exact:true}).click();
  const last=page.locator('.file-row[data-value^="BasicData/CommonEvent/"]').last(),scroll=page.locator('.file-scroll');
  await last.scrollIntoViewIfNeeded();const offset=await scroll.evaluate(el=>el.scrollTop);expect(offset).toBeGreaterThan(0);
  await last.click();await page.getByRole('button',{name:'戻る',exact:true}).click();await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(offset);
  await last.click();await page.goBack();await expect.poll(()=>scroll.evaluate(el=>el.scrollTop)).toBe(offset);
  await page.reload();await expect(page.locator('.file-row')).toHaveCount(2);expect(external).toEqual([]);
});
