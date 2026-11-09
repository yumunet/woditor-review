import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchedItems} from '../src/item-picker';
import type {Item,ReviewFile} from '../src/model';
test('search matches originals, manual sources, translations and pending translations without changing target counts',()=>{
  const items=[{id:'a',slotIds:['1'],changes:[]},{id:'b',slotIds:['2'],changes:[{status:'pending',after:'New English'}]}] as Item[];
  const file={slots:[{id:'1',source:'日本語',translation:'Original English'},{id:'2',source:'',sourceOverride:'補完した原文',translation:'Other'}]} as ReviewFile;
  assert.deepEqual(searchedItems(file,items,'日本語'),[items[0]]);
  assert.deepEqual(searchedItems(file,items,'ORIGINAL ENGLISH'),[items[0]]);
  assert.deepEqual(searchedItems(file,items,'補完'),[items[1]]);
  assert.deepEqual(searchedItems(file,items,'New English'),[items[1]]);
  assert.deepEqual(searchedItems(file,items,'absent'),[]);
  assert.equal(items.length,2);
});
