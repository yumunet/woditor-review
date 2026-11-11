import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controlWarning,newlineWarning,translationWarnings,slotWarnings} from '../src/translation-warnings';
import type {Slot} from '../src/model';
import {displaySlotText} from '../src/display-text';
test('only newline controls produce a subdued notice; other controls remain warnings',()=>{
  assert.deepEqual(translationWarnings(String.raw`a<\n>b`, 'ab'),[newlineWarning]);
  assert.deepEqual(translationWarnings(String.raw`a\c[1]<\n>b`,String.raw`ab\c[1]`),[newlineWarning]);
  assert.deepEqual(translationWarnings(String.raw`a\c[1]<\n>b`,String.raw`ab\c[2]`),[controlWarning]);
  assert.deepEqual(translationWarnings(String.raw`a\r[文字,もじ]`, 'text'),[]);
  assert.deepEqual(translationWarnings('text','text'),[]);
});
test('legacy stored warnings are reclassified when displayed',()=>{
  const slot={source:String.raw`a<\n>b`,translation:'ab',warnings:[controlWarning]} as Slot;
  assert.deepEqual(slotWarnings(slot),[newlineWarning]);
});
test('database memo newlines are display-only and do not create newline warnings',()=>{
  const slot={key:'MEMO',source:String.raw`一行目<<\n>>二行目`,translation:'One line',warnings:[newlineWarning]} as Slot;
  assert.equal(displaySlotText({type:'database'},slot,slot.source),'一行目\n二行目');
  assert.equal(displaySlotText({type:'common'},slot,slot.source),slot.source);
  assert.deepEqual(slotWarnings(slot,{type:'database'}),[]);assert.deepEqual(slotWarnings(slot,{type:'common'}),[newlineWarning]);
  slot.source+=String.raw`\c[1]`;assert.deepEqual(slotWarnings(slot,{type:'database'}),[controlWarning]);
});
