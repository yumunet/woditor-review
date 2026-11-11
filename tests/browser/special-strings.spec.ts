import {test,expect} from '@playwright/test';
import {zipSync} from 'fflate';

test('only Woditor special-string differences warn; plain angle text, percentages, ruby and display tokens do not',async({page})=>{
  const path='BasicData/CommonEvent/000.txt';
  const ja=[String.raw`説明 <None> X% of Max %s <\n><dqrt>\r[漢字,かんじ]`,String.raw`変数 \udb[3:\v[4]:\self[1]]`,String.raw`待機 \!\.\^\>\<\E\N\A+\A-`,String.raw`維持 \v1[2]\f+[14]\-[1]<L><C><R>@123`];
  const en=['None and plain English',String.raw`Variable \udb[3:\v[5]:\self[1]]`,String.raw`Wait \.\^\>\<\E\N\A+\A-`,String.raw`Keep \v1[2]\f+[14]\-[1]<L><C><R>@123`];
  const file=(values:string[])=>'COMMON_ID=0\nWoditorEvCOMMAND_START\n'+values.map(value=>`[101][0,1]<0>()("${value}")`).join('\n')+'\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n'+values.map(value=>'■Show Message: '+value).join('\n')+'\n[COMMAND_TEXT_END]\n';
  await page.goto('/');await expect(page.locator('.busy')).toHaveCount(0);await page.getByRole('button',{name:'ファイルを読み込む',exact:true}).click();
  for(const [name,values] of [['ja',ja],['en',en]] as const) await page.locator(`input[name=${name}]`).setInputFiles({name:name+'.zip',mimeType:'application/zip',buffer:Buffer.from(zipSync({[path]:Buffer.from(file([...values]))}))});
  await page.getByRole('button',{name:'読み込む',exact:true}).click();await expect(page.locator('.busy')).toHaveCount(0,{timeout:90000});if(await page.getByRole('dialog').count()) await page.getByRole('button',{name:'閉じる',exact:true}).click();
  for(const part of ['BasicData','BasicData/CommonEvent',path]) await page.locator(`.file-row[data-value="${part}"]`).click();
  await expect(page.locator('.slot-warning')).toHaveCount(0);
  for(let index=0;index<2;index++) {await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.locator('.slot-warning')).toHaveText('特殊文字列が原文と異なります');}
  await page.getByRole('button',{name:'次の項目',exact:true}).click();await expect(page.locator('.slot-warning')).toHaveCount(0);
});
