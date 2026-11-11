import {test} from 'node:test';
import assert from 'node:assert/strict';
import {choicesContextView} from '../src/choices-context';
import {databaseChoiceMode} from '../src/database-choice-policy';
import type {ReviewFile,Item,Slot} from '../src/model';

const item={id:'item',slotIds:['field']} as Item;
function fixture(type:ReviewFile['type']='database',key='ITEMNAME0',ja='',en=''):ReviewFile {
  const modes=type==='common'?'LOADTYPE0=2\nLOADTYPE1=2\nLOADTYPE2=2\nLOADTYPE3=2\nLOADTYPE4=2\n':'';
  return {type,jaText:modes+ja,enText:modes+en,items:[] as Item[],slots:[{id:'field',key,kind:'metadata',command:null}]} as ReviewFile;
}
const rows=(html:string)=>[...html.matchAll(/<tr class="choice-row">([\s\S]*?)<\/tr>/g)].map(match=>match[1]);

test('database mode lookup distinguishes folder and choice modes and defaults missing or invalid modes to zero',()=>{
  for(const mode of [0,1,2,3]) assert.equal(databaseChoiceMode(`ITEM_LOADTYPE_7=${mode}\n`,7),mode);
  for(const mode of ['-1','4','invalid','2.5','','9007199254740992']) assert.equal(databaseChoiceMode(`ITEM_LOADTYPE_7=${mode}\n`,7),0);
  assert.equal(databaseChoiceMode('ITEM_LOADTYPE_0=3\n',7),0);
});

test('database field choice tables keep numeric order with bilingual text and a navigation column',()=>{
  const file=fixture('database','ITEMNAME3','TYPE_ID=0\nITEM_LOADTYPE_3=3\nCHOICE_NAME_3_10=十一番目\nCHOICE_NAME_3_1=二番目\nCHOICE_NAME_2_0=別の項目\n','TYPE_ID=0\nITEM_LOADTYPE_3=3\nCHOICE_NAME_3_2=English only\nCHOICE_NAME_3_1=Second\n');
  const html=choicesContextView(file,item,true),lines=rows(html);
  assert.equal(lines.length,3);assert.ok(lines[0].includes('二番目'));assert.ok(lines[1].includes('English only'));assert.ok(lines[2].includes('十一番目'));assert.ok(!html.includes('choice-index'));
  assert.ok(lines[0].includes('二番目'));assert.ok(lines[0].includes('Second'));assert.ok(lines[1].includes('（対応なし）'));assert.ok(lines[2].includes('十一番目'));assert.ok(!html.includes('別の項目'));
  assert.ok(html.includes('<th scope="col">原文</th><th scope="col">英訳</th>'));assert.equal((html.match(/<th scope="col"[ >]/g)??[]).length,3);
});

test('common numeric arguments use CHOICE_STR, preserve empty values and prefer confirmed translations',()=>{
  const file=fixture('common','VALINPUT_NAME_0','COMMON_ID=0\nCHOICE_STR_0_0=\nCHOICE_STR_0_1=日本語\n','COMMON_ID=0\nCHOICE_STR_0_0=\nCHOICE_STR_0_1=Old English\n');
  file.slots.push({id:'choice',key:'CHOICE_STR_0_1',kind:'metadata',translation:'Confirmed English',source:'日本語',command:null} as Slot);
  const html=choicesContextView(file,item,true),lines=rows(html);
  assert.equal(lines.length,2);assert.equal((lines[0].match(/（未設定）/g)??[]).length,2);assert.ok(!lines[0].includes('（対応なし）'));
  assert.ok(lines[1].includes('Confirmed English'));assert.ok(!html.includes('Old English'));
});

test('independent valid counts hide stale keys on each side and keep only rows active in either language',()=>{
  const file=fixture('database','ITEMNAME0','ITEM_LOADTYPE_0=3\nCHOICE_NAME_0_NUM=1\nCHOICE_NAME_0_0=有効\nCHOICE_NAME_0_1=原文の残存値\nCHOICE_NAME_0_2=両側の残存値\n','ITEM_LOADTYPE_0=3\nCHOICE_NAME_0_NUM=2\nCHOICE_NAME_0_0=Active\nCHOICE_NAME_0_1=Second\nCHOICE_NAME_0_2=Stale\n');
  const html=choicesContextView(file,item,true),lines=rows(html);
  assert.equal(lines.length,2);assert.ok(lines[1].includes('（対応なし）'));assert.ok(lines[1].includes('Second'));assert.ok(!html.includes('原文の残存値'));assert.ok(!html.includes('両側の残存値'));assert.ok(!html.includes('Stale'));
  file.jaText=file.jaText.replace('NUM=1','NUM=0');file.enText=file.enText.replace('NUM=2','NUM=0');assert.equal(choicesContextView(file,item,true),'');
});

test('invalid or absent counts fall back to keys actually present in that header',()=>{
  for(const count of ['-1','1.5','NaN','','9007199254740992']) {
    const file=fixture('common','VALINPUT_NAME_2',`CHOICE_STR_2_NUM=${count}\nCHOICE_STR_2_4=原文\n`,'CHOICE_STR_2_5=Translation\n');
    const html=choicesContextView(file,item,true),lines=rows(html);assert.equal(lines.length,2);assert.ok(lines[0].includes('原文'));assert.ok(lines[1].includes('Translation'));
  }
});

test('CSV and command body fake metadata cannot become choice rows',()=>{
  const database=fixture('database','ITEMNAME0','TYPE_ID=0\nITEM_LOADTYPE_0=3\n<<--CSV_START-->>\n"value\nCHOICE_NAME_0_0=Fake\n"\n','TYPE_ID=0\nITEM_LOADTYPE_0=3\n');
  assert.equal(choicesContextView(database,item,true),'');
  for(const boundary of ['WoditorEvCOMMAND_START','[COMMAND_TEXT_START]','[103][0,1]<0>()("comment")']) {
    const common=fixture('common','VALINPUT_NAME_0',`COMMON_ID=0\n${boundary}\nCHOICE_STR_0_0=Fake\n`,'COMMON_ID=0\n');
    assert.equal(choicesContextView(common,item,true),'');
  }
});

test('unrelated items, data names, CSV settings and commands do not have reverse choice tables',()=>{
  for(const [type,key] of [['database','CSV_D0_NAME'],['database','CSV_D0_ITEM0'],['database','CHOICE_NAME_0_0'],['common','STRINPUT_NAME_0'],['common','CHOICE_STR_0_0'],['map','ITEMNAME0']] as const) {
    const file=fixture(type,key,'ITEM_LOADTYPE_0=3\nCHOICE_NAME_0_0=Name\nCHOICE_STR_0_0=Choice\n','');assert.equal(choicesContextView(file,item,true),'');
  }
  const command=fixture('database','ITEMNAME0','ITEM_LOADTYPE_0=3\nCHOICE_NAME_0_0=Name\n','');command.slots[0].kind='command_string';assert.equal(choicesContextView(command,item,true),'');
  assert.equal(choicesContextView(fixture(),item,true),'');
});

test('choice tables escape text and share the requested collapsible controls',()=>{
  const file=fixture('database','ITEMNAME0','ITEM_LOADTYPE_0=3\nCHOICE_NAME_0_0=<script>原文</script>\n','ITEM_LOADTYPE_0=3\nCHOICE_NAME_0_0=<img src=x onerror=bad>\n');
  const open=choicesContextView(file,item,true);assert.ok(open.includes('&lt;script&gt;原文&lt;/script&gt;'));assert.ok(!open.includes('<script>'));assert.ok(open.includes('&lt;img src=x onerror=bad&gt;'));
  assert.ok(open.includes('class="choices-table"'));assert.ok(open.includes('class="choice-source"'));assert.ok(open.includes('class="choice-translation"'));assert.ok(open.includes('aria-controls="choices-context-body"'));
  const closed=choicesContextView(file,item,false);assert.ok(closed.includes('aria-expanded="false"'));assert.ok(closed.includes('data-action="choices-context"'));assert.ok(!closed.includes('<table'));
});

test('database folder paths and inactive leftover choice keys never appear as selectable choices',()=>{
  for(const mode of [undefined,'0','1','4','-1','invalid']) {
    const header=(mode===undefined?'':`ITEM_LOADTYPE_0=${mode}\n`)+'CHOICE_NAME_0_NUM=2\nCHOICE_NAME_0_0=Folder/path\nCHOICE_NAME_0_1=Other/path\n';
    const file=fixture('database','ITEMNAME0',header,header);assert.equal(choicesContextView(file,item,true),'');
  }
});

test('database choice modes are independent per language and only active choice sides are rendered',()=>{
  for(const mode of [2,3]) {
    const source=`ITEM_LOADTYPE_0=${mode}\nCHOICE_NAME_0_NUM=1\nCHOICE_NAME_0_0=有効な選択肢\n`,folder='ITEM_LOADTYPE_0=1\nCHOICE_NAME_0_NUM=2\nCHOICE_NAME_0_0=Folder/path\nCHOICE_NAME_0_1=More/path\n';
    const file=fixture('database','ITEMNAME0',source,folder);file.slots.push({id:'stale-folder',kind:'metadata',key:'CHOICE_NAME_0_0',translation:'Latest folder path'} as Slot);
    const html=choicesContextView(file,item,true);assert.equal(rows(html).length,1);assert.ok(html.includes('有効な選択肢'));assert.ok(html.includes('（対応なし）'));assert.ok(!html.includes('Folder/path'));assert.ok(!html.includes('Latest folder path'));
    const reversed=choicesContextView(fixture('database','ITEMNAME0',folder,source.replace('有効な選択肢','Active choice')),item,true);assert.equal(rows(reversed).length,1);assert.ok(reversed.includes('Active choice'));assert.ok(reversed.includes('（対応なし）'));assert.ok(!reversed.includes('Folder/path'));
  }
});

test('common direct-input and unused numeric arguments hide residual labels independently in each language',()=>{
  const file=fixture('common','VALINPUT_NAME_0','CHOICE_STR_0_NUM=1\nCHOICE_STR_0_0=残存ラベル\n','CHOICE_STR_0_NUM=1\nCHOICE_STR_0_0=Active label\n');
  file.jaText=file.jaText.replace('LOADTYPE0=2','LOADTYPE0=0');
  const html=choicesContextView(file,item,true);assert.ok(!html.includes('残存ラベル'));assert.ok(html.includes('Active label'));assert.ok(html.includes('（対応なし）'));
  file.enText=file.enText.replace('LOADTYPE0=2','LOADTYPE0=0');assert.equal(choicesContextView(file,item,true),'');
  const unused=fixture('common','VALINPUT_NAME_2','VALINPUT_NUM=2\nCHOICE_STR_2_0=残存\n','VALINPUT_NUM=2\nCHOICE_STR_2_0=Unused\n');assert.equal(choicesContextView(unused,item,true),'');
});

test('reference choice lists hide fixed-size trailing settings even when old counts are larger',()=>{
  for(const type of ['common','database'] as const) {
    const family=type==='common'?'STR':'NAME',key=type==='common'?'VALINPUT_NAME_0':'ITEMNAME0';
    const header=(type==='common'?'LOADTYPE0=1\n':'ITEM_LOADTYPE_0=2\n')+`CHOICE_${family}_0_NUM=4\n`+['有効A','有効B','有効C','残存'].map((value,index)=>`CHOICE_${family}_0_${index}=${value}\n`).join('');
    const file=fixture(type,key,header,header);
    if(type==='common') {file.jaText=file.jaText.replace('LOADTYPE0=2','LOADTYPE0=1');file.enText=file.enText.replace('LOADTYPE0=2','LOADTYPE0=1');}
    const html=choicesContextView(file,item,true);assert.equal(rows(html).length,3);assert.ok(!html.includes('残存'));
  }
});
