import {test,expect,type Page} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {emptyWorkspace,type ReviewFile} from '../../src/model';

async function loadSelectionFiles(page:Page) {
  const workspace=emptyWorkspace(),hash='0'.repeat(64);
  for(const folder of ['A','B']) for(let index=0;index<30;index++) {
    const path=`${folder}/${String(index).padStart(2,'0')}.txt`;
    workspace.files.push({path,type:'database',jaText:'TYPE_NAME=名前',enText:'TYPE_NAME=Name',jaBom:false,enBom:false,sourceVersion:hash,version:hash,
      slots:[{id:'name',key:'TYPE_NAME',kind:'metadata',title:'タイプ名',source:'名前',translation:'Name',line:1,enLine:1,start:10,end:14,command:null,fingerprint:hash,warnings:[]}],
      items:[{id:'name',slotIds:['name'],title:'タイプ名',code:null,depth:null,lastLine:1,approved:false,threads:[],changes:[]}],commands:[],usages:{},excluded:[],warnings:[]} satisfies ReviewFile);
  }
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'バックアップを復元',exact:true}).click();
  await page.locator('input[name=backup]').setInputFiles({name:'selection.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(workspace))});
  await page.getByRole('button',{name:'復元する',exact:true}).click();await page.getByRole('button',{name:'確定',exact:true}).click();await expect(page.getByRole('dialog')).toHaveCount(0);
}
const open=async(page:Page,name:string)=>{await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name,exact:true}).click();};

test('export checkbox Shift ranges select and deselect in both directions, including collapsed folders',async({page})=>{
  await loadSelectionFiles(page);
  for(const panel of ['AIレビューを依頼','英訳TXTを出力']) {
    await open(page,panel);
    const all=page.getByRole('checkbox',{name:'すべて選択',exact:true}),file=(n:number)=>page.getByRole('checkbox',{name:`A/${String(n).padStart(2,'0')}.txt`,exact:true});
    await all.uncheck();await file(1).check();await file(5).click({modifiers:['Shift']});await expect(page.locator('[data-export-path]:checked')).toHaveCount(5);
    await file(3).click({modifiers:['Shift']});await expect(page.locator('[data-export-path]:checked')).toHaveCount(2);await expect(file(4)).toBeChecked();await expect(file(5)).toBeChecked();
    await all.check();await all.uncheck();await file(5).check();await file(1).locator('..').click({modifiers:['Shift']});await expect(page.locator('[data-export-path]:checked')).toHaveCount(5);
    if(panel==='AIレビューを依頼') {
      const download=page.waitForEvent('download');await page.getByRole('button',{name:'JSONを出力',exact:true}).click();
      const request=JSON.parse(readFileSync((await (await download).path())!,'utf8'));
      expect(request.targets.map((target:any)=>target.path)).toEqual([1,2,3,4,5].map(n=>`A/0${n}.txt`));
    }
    await all.check();await all.uncheck();
    for(const folder of ['A','B']) await page.getByRole('button',{name:`${folder}を閉じる`,exact:true}).click();
    const a=page.getByRole('checkbox',{name:'Aを選択',exact:true}),b=page.getByRole('checkbox',{name:'Bを選択',exact:true});
    await a.check();await b.click({modifiers:['Shift']});await expect(all).toBeChecked();await expect(page.locator('[data-export-path]:checked')).toHaveCount(60);
    await a.click({modifiers:['Shift']});await expect(page.locator('[data-export-path]:checked')).toHaveCount(30);expect(await all.evaluate((el:HTMLInputElement)=>el.indeterminate)).toBe(true);
    for(const folder of ['A','B']) await page.getByRole('button',{name:`${folder}を開く`,exact:true}).click();
    await page.getByRole('button',{name:'閉じる',exact:true}).click();
  }
});

test('export touch long press ranges follow the finger, scroll at either edge and preserve normal swipes',async({page,context},info)=>{
  test.skip(info.project.name!=='mobile','Touch gestures are exercised on the mobile project');
  await loadSelectionFiles(page);
  const session=await context.newCDPSession(page);
  const touch=async(type:'touchStart'|'touchMove'|'touchEnd'|'touchCancel',x=0,y=0)=>session.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'||type==='touchCancel'?[]:[{x,y}]});
  try {
  for(const panel of ['AIレビューを依頼','英訳TXTを出力']) {
    await open(page,panel);const all=page.getByRole('checkbox',{name:'すべて選択',exact:true});await all.uncheck();
    const body=page.locator('.sheet-body'),tree=page.locator('.export-tree'),file=(n:number)=>page.getByRole('checkbox',{name:`A/${String(n).padStart(2,'0')}.txt`,exact:true});
    const point=async(n:number)=>{const box=await file(n).locator('..').boundingBox();return {x:box!.x+box!.width/2,y:box!.y+box!.height/2};};
    const start=await point(0);await touch('touchStart',start.x,start.y);await expect(tree).toHaveClass(/range-selecting/);
    await expect(file(0)).toBeChecked();const end=await point(3);await touch('touchMove',end.x,end.y);await expect(page.locator('[data-export-path]:checked')).toHaveCount(4);
    const shrink=await point(1);await touch('touchMove',shrink.x,shrink.y);await expect(page.locator('[data-export-path]:checked')).toHaveCount(2);
    await touch('touchEnd');await expect(tree).not.toHaveClass(/range-selecting/);await expect(page.locator('[data-export-path]:checked')).toHaveCount(2);
    // A regular tap still toggles once after a completed gesture.
    await file(2).tap();await expect(page.locator('[data-export-path]:checked')).toHaveCount(3);
    // Hold a checked row to remove a span instead of adding it.
    const checked=await point(0);await touch('touchStart',checked.x,checked.y);await expect(tree).toHaveClass(/range-selecting/);const third=await point(2);await touch('touchMove',third.x,third.y);await touch('touchEnd');await expect(page.locator('[data-export-path]:checked')).toHaveCount(0);
    // A quick swipe must scroll normally, without selecting or dismissing the panel.
    const bounds=await body.boundingBox(),x=bounds!.x+bounds!.width/2,y=bounds!.y+bounds!.height*.8;
    await touch('touchStart',x,y);for(let dy=15;dy<=150;dy+=15) await touch('touchMove',x,y-dy);await touch('touchEnd');
    await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(20);await expect(page.getByRole('dialog',{name:panel,exact:true})).toBeVisible();await expect(page.locator('[data-export-path]:checked')).toHaveCount(0);
    // Stop the native fling before beginning the next, independent gesture.
    await touch('touchStart',x,y);await touch('touchCancel');
    await body.evaluate(el=>{el.scrollTop=0;});await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBe(0);
    const first=await point(0);await touch('touchStart',first.x,first.y);await expect(tree).toHaveClass(/range-selecting/);
    const bottom=bounds!.y+bounds!.height-4;await touch('touchMove',x,bottom);
    await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(220);
    await expect.poll(()=>page.locator('[data-export-path]:checked').count()).toBeGreaterThan(6);
    const offset=await body.evaluate(el=>el.scrollTop);await touch('touchMove',x,bounds!.y+4);await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeLessThan(offset-80);
    await touch('touchEnd');const stopped=await body.evaluate(el=>el.scrollTop);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));expect(await body.evaluate(el=>el.scrollTop)).toBe(stopped);
    await page.getByRole('button',{name:'閉じる',exact:true}).click();
  }
  } finally {await touch('touchCancel').catch(()=>{});await session.detach();}
});
