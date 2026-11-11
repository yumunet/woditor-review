import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {controlWarning,specialStrings,translationWarnings,slotWarnings} from '../src/translation-warnings';
import type {Slot} from '../src/model';

const cases=JSON.parse(readFileSync(new URL('./fixtures/special-strings.json',import.meta.url),'utf8')) as {name:string;text:string;tokens:string[]}[];
for(const entry of cases) test(`special strings: ${entry.name}`,()=>{assert.deepEqual(specialStrings(entry.text),entry.tokens);});

test('only specified special strings warn, including nested arguments and changed token count or order',()=>{
  assert.deepEqual(translationWarnings(String.raw`日本語 \udb[3:\v[4]:\self[1]]`,String.raw`English \udb[3:\v[5]:\self[1]]`),[controlWarning]);
  assert.deepEqual(translationWarnings(String.raw`\v1[2] \f+[14]`,String.raw`\v1[2] \f+[14]`),[]);
  assert.deepEqual(translationWarnings(String.raw`\v[1]\v[1]`,String.raw`\v[1]`),[controlWarning]);
  assert.deepEqual(translationWarnings('<L><C>','<C><L>'),[controlWarning]);
  assert.deepEqual(translationWarnings(String.raw`<None> X% of Max<\n><dqrt>\r[漢字,かんじ]`, 'plain English'),[]);
});
test('saved broad warnings disappear and current special-string mismatches are recomputed',()=>{
  const slot={source:String.raw`<None> %s <\n>\r[原文,よみ]`,translation:'None',warnings:['制御文字・置換文字列が原文と異なります','改行が異なります','Other warning']} as Slot;
  assert.deepEqual(slotWarnings(slot),['Other warning']);
  slot.source=String.raw`\E`;assert.deepEqual(slotWarnings(slot),['Other warning',controlWarning]);
  slot.sourceMissing=true;slot.source='';assert.deepEqual(slotWarnings(slot),['Other warning']);
});
