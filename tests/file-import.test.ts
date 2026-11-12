import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorkspace,type ReviewFile,type Change} from '../src/model';
import {prepareFileImport,mergeFiles,createRequest,importResponse,type ReviewResponse} from '../src/exchange';
import {addComment,setResolved} from '../src/review-state';
import {backupJson,restoreJson} from '../src/storage';

function fixture(path='common.txt'):ReviewFile {
  const keys=['COMMON_NAME','MEMO','RETURN_VAL_NAME'];
  const slots=keys.map((key,index)=>({id:`s${index}`,line:index+2,enLine:index+2,start:index*20,end:index*20+2,source:`原文${index}`,translation:`English ${index}`,kind:'metadata',key,title:key,command:null,warnings:[],fingerprint:(index+1).toString(16).repeat(64)}));
  return {path,type:'common',jaText:'COMMON_ID=0\n'+slots.map(s=>s.key+'='+s.source).join('\n'),enText:'COMMON_ID=0\n'+slots.map(s=>s.key+'='+s.translation).join('\n'),jaBom:false,enBom:false,sourceVersion:'0'.repeat(64),version:'a'.repeat(64),slots,
    items:slots.map((slot,index)=>({id:`item${index}`,slotIds:[slot.id],title:slot.title,code:null,depth:null,lastLine:slot.line,approved:index<2,threads:[],changes:[]})),commands:[],usages:{},excluded:[],warnings:[]};
}
function pending(slotId:string,origin:Change['origin'],threadId:string|null):Change {
  return {id:`${origin}-${slotId}`,slotId,origin,threadId,before:`English ${slotId.slice(1)}`,after:`Proposed ${slotId}`,status:'pending',createdAt:'2026-11-12T00:00:00Z'};
}

test('prepared overwrite is isolated, preserves reviews and fresh positions, and can reset only changed approvals',()=>{
  const old=fixture();Object.assign(old.slots[2],{sourceMissing:true,source:'',line:-4,sourceOverride:'補完原文'});const thread=addComment(old.items[1],'Keep conversation');thread.resolved=true;old.items[1].approved=true;
  const workspace={...emptyWorkspace(),files:[old,fixture('untouched.txt')]},before=structuredClone(workspace),incoming=fixture();
  incoming.version='b'.repeat(64);incoming.enText='Imported English TXT';incoming.slots[0].translation='External';incoming.slots[0].enLine=7;incoming.slots[0].line=4;
  Object.assign(incoming.slots[2],{sourceMissing:true,source:'',line:-4});
  const prepared=prepareFileImport(workspace,[incoming]);
  assert.deepEqual(workspace,before);assert.deepEqual(prepared.summary,{overwrittenFiles:1,changedItems:1,discardedPending:0});
  const file=prepared.workspace.files[0];assert.equal(file.slots[0].translation,'External');assert.equal(file.slots[2].sourceOverride,'補完原文');assert.equal(file.slots[0].enLine,7);assert.equal(file.items[0].lastLine,4);
  assert.equal(file.version,incoming.version);assert.equal(file.enText,incoming.enText);assert.equal(file.items[0].approved,true);
  assert.deepEqual(file.items[1].threads,old.items[1].threads);assert.deepEqual(prepared.workspace.files[1],workspace.files[1]);
  assert.equal(file.items[0].changes[0].status,'committed');assert.equal(file.items[0].changes[0].origin,'reload');
  const reset=mergeFiles(workspace,[incoming],{resetChangedApproval:true}).files[0];assert.equal(reset.items[0].approved,false);assert.equal(reset.items[1].approved,true);assert.equal(reset.items[2].approved,false);
  const added=fixture('new.txt');added.items[0].approved=true;assert.equal(prepareFileImport(workspace,[added]).summary.overwrittenFiles,0);assert.equal(mergeFiles(workspace,[added]).files[2].items[0].approved,false);
  assert.deepEqual(restoreJson(backupJson(prepared.workspace)),prepared.workspace);
});

test('only changed-slot AI proposals and all old reload proposals are discarded, with conversations preserved',()=>{
  for(const translation of ['External','Proposed s0']) {
    const old=fixture(),first=addComment(old.items[0],'AI first'),second=addComment(old.items[1],'AI second');
    old.items[0].changes=[pending('s0','ai',first.id)];old.items[1].changes=[pending('s1','ai',second.id)];old.items[2].changes=[pending('s2','reload',null)];
    const incoming=fixture();incoming.slots[0].translation=translation;
    const prepared=prepareFileImport({...emptyWorkspace(),files:[old]},[incoming]),file=prepared.workspace.files[0];
    assert.deepEqual(prepared.summary,{overwrittenFiles:1,changedItems:1,discardedPending:2});
    assert.equal(file.items[0].changes[0].status,'discarded');assert.equal(file.items[0].changes[1].status,'committed');assert.equal(file.slots[0].translation,translation);
    assert.deepEqual(file.items[0].threads,old.items[0].threads);assert.equal(file.items[1].changes[0].status,'pending');assert.equal(file.items[2].changes[0].status,'discarded');
    setResolved(file.items[0],file.slots,first.id,true);setResolved(file.items[0],file.slots,first.id,false);assert.equal(file.slots[0].translation,translation);
  }
  const old=fixture();old.items[0].approved=false;old.items[0].changes=[pending('s0','reload',null)];
  const result=prepareFileImport({...emptyWorkspace(),files:[old]},[fixture()]);assert.equal(result.summary.discardedPending,1);assert.equal(result.summary.changedItems,0);assert.equal(result.workspace.files[0].items[0].changes[0].status,'discarded');
});

test('old AI history cannot rewind an external overwrite while subsequent AI review still resolves and reopens normally',()=>{
  const old=fixture(),thread=addComment(old.items[0],'Earlier review');thread.resolved=true;old.items[0].approved=true;
  old.items[0].changes=[{...pending('s0','ai',thread.id),before:'Older English',after:'English 0',status:'committed'}];
  const workspace={...emptyWorkspace(),files:[old]},incoming=fixture();incoming.version='b'.repeat(64);incoming.slots[0].translation='External';
  const result=restoreJson(backupJson(mergeFiles(workspace,[incoming]))),file=result.files[0],item=file.items[0];
  setResolved(item,file.slots,thread.id,false);assert.equal(file.slots[0].translation,'External');setResolved(item,file.slots,thread.id,true);assert.equal(file.slots[0].translation,'External');
  setResolved(item,file.slots,thread.id,false);const request=createRequest(result,[file.path]);result.requests.push(request);
  const answer:ReviewResponse={schemaVersion:1,requestId:request.requestId,suggestions:[],responses:[{commentId:thread.id,path:file.path,itemId:item.id,fileVersion:file.version,decision:'accepted',reason:'Next review',changes:[{slotId:'s0',before:'External',after:'Next AI wording'}]}]};
  const revised=importResponse(result,answer),updated=revised.files[0];setResolved(updated.items[0],updated.slots,thread.id,true);assert.equal(updated.slots[0].translation,'Next AI wording');
  setResolved(updated.items[0],updated.slots,thread.id,false);assert.equal(updated.slots[0].translation,'External');
  answer.requestId='old-request';answer.responses[0].fileVersion=old.version;result.requests.push({...request,requestId:'old-request',entries:request.entries.map(entry=>({...entry,fileVersion:old.version}))});assert.throws(()=>importResponse(result,answer),/バージョン/);
});

test('a multi-slot item counts once and an unsafe file contributes no overwrite or discard counts',()=>{
  const old=fixture();old.items[0].slotIds.push('s1');old.items.splice(1,1);
  const incoming=structuredClone(old);incoming.slots[0].translation='External 0';incoming.slots[1].translation='External 1';
  const result=prepareFileImport({...emptyWorkspace(),files:[old]},[incoming]);assert.equal(result.summary.changedItems,1);assert.equal(result.workspace.files[0].items[0].changes.length,2);
  incoming.slots[0].fingerprint='f'.repeat(64);
  const skipped=prepareFileImport({...emptyWorkspace(),files:[old]},[incoming]);assert.deepEqual(skipped.summary,{overwrittenFiles:0,changedItems:0,discardedPending:0});assert.deepEqual(skipped.workspace.files[0],old);assert.equal(skipped.workspace.diagnostics[0].severity,'error');
});
