import {test} from 'node:test';
import assert from 'node:assert/strict';
import {displaySlotText} from '../src/display-text';
import type {Slot} from '../src/model';

test('message text decodes line breaks and quotes for display without changing its stored value',()=>{
  const raw=String.raw`一行目<\n><dqrt>二行目<dqrt><\n>`,slot={command:{code:101},source:raw} as Slot;
  assert.equal(displaySlotText({type:'common'},slot,raw),'一行目\n"二行目"\n');assert.equal(slot.source,raw);
  assert.equal(displaySlotText({type:'map'},slot,'Text<dqrt> quote'),'Text" quote');
});
test('WOLF comment text decodes quotes while retaining its encoded newline tokens',()=>{
  const raw=String.raw`<dqrt>注記<dqrt><\n>`,slot={command:{code:103}} as Slot;
  assert.equal(displaySlotText({type:'common'},slot,raw),String.raw`"注記"<\n>`);
});
test('all commands decode quotes and all except comments decode newlines; metadata stays encoded',()=>{
  const raw=String.raw`value<\n><dqrt>`,slot={key:'MEMO',command:{code:122}} as Slot;
  for(const code of [102,103,122,250,300,999]) {slot.command!.code=code;assert.equal(displaySlotText({type:'common'},slot,raw),code===103?String.raw`value<\n>"`:'value\n"');}
  slot.command=null;assert.equal(displaySlotText({type:'database'},slot,raw),raw);
});
