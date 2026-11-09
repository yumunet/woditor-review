import {test} from 'node:test';
import assert from 'node:assert/strict';
import {controlWarning,newlineWarning,translationWarnings,slotWarnings} from '../src/translation-warnings';
import type {Slot} from '../src/model';
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
