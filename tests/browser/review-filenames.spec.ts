import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {zipSync,unzipSync} from 'fflate';

test('review ZIPs use neutral names with the same request ID in either mode and export order',async({page})=>{
  const path='BasicData/CommonEvent/000.txt';
  const ja='COMMON_ID=0\nCOMMON_NAME=原文\nWoditorEvCOMMAND_START\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n[COMMAND_TEXT_END]\n',en=ja.replace('原文','English');
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [language,text] of [['ja',ja],['en',en]]) await page.locator(`input[name=${language}]`).setInputFiles({name:language+'.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(text)}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90000});
  for(const part of ['BasicData','BasicData/CommonEvent',path]) await page.locator(`.file-row[data-value="${part}"]`).click();
  await page.locator('.comment-trigger').click();await page.getByLabel('コメント内容').fill('Review wording');await page.getByRole('button',{name:'送信',exact:true}).click();await page.getByRole('button',{name:'閉じる',exact:true}).click();
  await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'AIレビューを依頼',exact:true}).click();
  const download=async(name:string)=>{
    const pending=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();const file=await pending;await expect(page.locator('.busy')).toHaveCount(0);return file;
  };
  let previous='';
  for(const [index,label] of ['英訳をチェックして指摘を作る','既存コメントに回答・修正する'].entries()) {
    await page.getByRole('radio',{name:label,exact:true}).check();
    const first=index===0?await download('英訳TXTを出力'):await download('JSONを出力');
    const second=index===0?await download('JSONを出力'):await download('英訳TXTを出力');
    const requestFile=index===0?second:first,zipFile=index===0?first:second;
    const request=JSON.parse(readFileSync((await requestFile.path())!,'utf8')),id=request.requestId.replaceAll('-','').slice(0,12);
    expect(request.mode==='initial').toBe(index===0);expect(request.requestId).not.toBe(previous);previous=request.requestId;
    expect(requestFile.suggestedFilename()).toBe(`review_request_${id}.json`);expect(zipFile.suggestedFilename()).toBe(`en-US_${id}.zip`);
    const files=unzipSync(readFileSync((await zipFile.path())!));expect(Buffer.from(files['en-US/texts/'+path]).toString('utf8')).toBe(en);
    expect((await download('英訳TXTを出力')).suggestedFilename()).toBe(zipFile.suggestedFilename());
  }
  await page.getByRole('button',{name:'閉じる',exact:true}).click();await page.getByRole('button',{name:'メニュー',exact:true}).click();await page.getByRole('button',{name:'英訳TXTを出力',exact:true}).click();
  expect((await download('英訳TXTを出力')).suggestedFilename()).toBe('en-US.zip');
});
