import {test} from 'node:test';
import assert from 'node:assert/strict';
import {navigationQuestion,navigationTarget,orderedReviewFiles} from '../src/navigation';
import type {ReviewFile,Item} from '../src/model';
const item=(id:string,approved=false,comment=false)=>({id,approved,threads:comment?[{id:'t',resolved:false,posts:[]}]:[],changes:[]} as unknown as Item);
const file=(path:string,items:Item[])=>({path,items} as ReviewFile);
test('file boundaries follow the natural folder tree order in either direction',()=>{
  const files=[file('A/10.txt',[item('last')]),file('A/2.txt',[item('first'),item('second')])];
  assert.deepEqual(orderedReviewFiles(files).map(f=>f.path),['A/2.txt','A/10.txt']);
  const next=navigationTarget(files,'A/2.txt','second','all','all',1)!;
  assert.equal(next.file.path,'A/10.txt');assert.ok(next.crossesFile);assert.equal(navigationQuestion('A/2.txt',next),'次の「10.txt」を開きますか？');
  assert.equal(navigationTarget(files,'A/10.txt','last','all','all',-1)!.item.id,'second');
  assert.equal(navigationTarget(files,'A/2.txt','first','all','all',-1),undefined);
});
test('destination files and items use the folder filter, skipping empty and ineligible files',()=>{
  const files=[file('A/0.txt',[item('current')]),file('A/1.txt',[]),file('A/2.txt',[item('unreviewed')]),file('B/0.txt',[item('pending'),item('approved',true)])];
  const next=navigationTarget(files,'A/0.txt','current','all','done',1)!;
  assert.equal(next.file.path,'B/0.txt');assert.equal(next.item.id,'approved');assert.equal(next.filter,'done');
  assert.equal(navigationQuestion('A/0.txt',next),'次のフォルダ「B」へ移動して「0.txt」を開きますか？');
});
test('retained filtered-out items move from their original position without skipping eligible neighbors',()=>{
  const files=[file('A/0.txt',[item('before',false,true),item('current'),item('after',false,true)])];
  assert.equal(navigationTarget(files,'A/0.txt','current','comment','comment',1)!.item.id,'after');
  assert.equal(navigationTarget(files,'A/0.txt','current','comment','comment',-1)!.item.id,'before');
  assert.equal(navigationTarget(files,'A/0.txt',null,'comment','comment',1),undefined);
});
