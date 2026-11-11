import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chatInstructions, createRequest, importResponse, mergeFiles, reviewFileNames, type ReviewResponse } from '../src/exchange';
import { emptyWorkspace, isDone, sourceText, type ReviewFile, type Workspace } from '../src/model';
import { addComment, approveItem, canEdit, discardRejectedChanges, setResolved } from '../src/review-state';
import { backupJson, restoreJson } from '../src/storage';
import { characterDiff } from '../src/diff';
import { canMerge, mergeGroup, splitGroup } from '../src/grouping';
import {updateManualSources} from '../src/source-edit';

const corpus = existsSync('.reference/ja-JP/texts/MapData/SampleMapA/Event_0000.txt');
test('CSV proposals accept literal newlines and quotes while metadata proposals reject them',{skip:!corpus},()=>{
  const file=realFile('BasicData/DataBase/00.txt'),item=file.items.find(i=>file.slots.find(s=>s.id===i.slotIds[0])?.kind==='database_csv')!;
  const slot=file.slots.find(s=>s.id===item.slotIds[0])!,thread=addComment(item,'Review this CSV cell');
  const workspace={...emptyWorkspace(),files:[file]},request=createRequest(workspace,[file.path]);workspace.requests.push(request);
  const response:ReviewResponse={schemaVersion:1,requestId:request.requestId,suggestions:[],responses:[{commentId:thread.id,path:file.path,itemId:item.id,fileVersion:file.version,decision:'accepted',reason:'Revised',changes:[{slotId:slot.id,before:slot.translation,after:'A "quoted", value\nNext line'}]}]};
  const next=importResponse(workspace,response);const edited=next.files[0].items.find(i=>i.id===item.id)!;setResolved(edited,next.files[0].slots,thread.id,true);
  assert.equal(next.files[0].slots.find(s=>s.id===slot.id)!.translation,'A "quoted", value\nNext line');assert.equal(restoreJson(backupJson(next)).files[0].slots.find(s=>s.id===slot.id)!.csv?.row,0);
  slot.kind='metadata';assert.throws(()=>importResponse(workspace,response),/エンコードされた改行/);
});
function realFile(path='MapData/SampleMapA/Event_0000.txt'): ReviewFile {
  const local = '.tools/python';
  const command = process.env.PYTHON || (existsSync(local) ? readdirSync(local).map(p => join(local, p, 'python.exe')).find(existsSync) : null) || (process.platform === 'win32' ? 'py' : 'python3');
  const result = spawnSync(command, ['-c', `import json;from pathlib import Path;from review_parser import pair_file;p=${JSON.stringify(path)};print(json.dumps(pair_file(p,(Path('.reference/ja-JP/texts')/p).read_bytes(),(Path('.reference/en-US/texts')/p).read_bytes())))`], {encoding: 'utf8', env: {...process.env, PYTHONPATH: 'python', PYTHONUTF8: '1'}});
  if (result.status !== 0) throw new Error(result.stderr); return JSON.parse(result.stdout);
}
const reference = corpus ? realFile() : null;
function setup() {
  const workspace: Workspace = {...emptyWorkspace(), files: [structuredClone(reference!)]};
  const file = workspace.files[0], item = file.items[0], thread = addComment(item, 'Please fix the name');
  const request = createRequest(workspace, [file.path]); workspace.requests.push(request);
  const response: ReviewResponse = {schemaVersion: 1, requestId: request.requestId, suggestions: [], responses: [{commentId: thread.id, path: file.path, itemId: item.id, fileVersion: file.version, decision: 'accepted', reason: 'Corrected spelling', changes: [{slotId: file.slots[0].id, before: file.slots[0].translation, after: 'Yuichi, revised'}]}]};
  return {workspace, file, item, thread, response};
}
test('character-level difference preserves whitespace, Unicode, and escapes markup', () => {
  const d = characterDiff('cat 😺 <x>\n', 'cut 😺 <y>\n');
  assert.equal(d.before, 'c<span class="diff-deleted">a</span>t 😺 &lt;<span class="diff-deleted">x</span>&gt;\n');
  assert.equal(d.after, 'c<span class="diff-added">u</span>t 😺 &lt;<span class="diff-added">y</span>&gt;\n');
});

test('initial review exports uncommented items and imports only AI comments, then supports the normal reply cycle',{skip:!corpus},()=>{
  const file=structuredClone(reference!),workspace={...emptyWorkspace(),files:[file]};file.items[0].approved=true;
  const before=JSON.stringify(file),request=createRequest(workspace,[file.path],'initial');workspace.requests.push(request);
  assert.equal(request.entries.length,0);assert.equal(request.targets!.length,file.items.length);assert.equal(request.targets![0].slots[0].translation,file.slots[0].translation);
  assert.match(chatInstructions(request),/build → validate/);assert.match(chatInstructions(request),/英訳は変更せず/);
  const target=request.targets![0],response:ReviewResponse={schemaVersion:1,requestId:request.requestId,responses:[],suggestions:[{id:'new-ai-issue',path:target.path,itemId:target.itemId,fileVersion:target.fileVersion,reason:'Check this spelling',changes:[]}]};
  const next=importResponse(workspace,response),nf=next.files[0],ni=nf.items[0];
  assert.equal(JSON.stringify(file),before);assert.deepEqual(nf.slots,file.slots);assert.equal(nf.enText,file.enText);assert.equal(nf.version,file.version);assert.equal(ni.approved,false);assert.equal(ni.changes.length,0);assert.equal(ni.threads[0].posts[0].author,'ai');
  const restored=restoreJson(backupJson(next));assert.equal(restored.requests[0].targets!.length,file.items.length);
  addComment(ni,'Please fix it',ni.threads[0].id);const followup=createRequest(next,[nf.path]);next.requests.push(followup);assert.equal(followup.entries.length,1);assert.equal(followup.entries[0].posts[0].author,'ai');
  const result=importResponse(next,{schemaVersion:1,requestId:followup.requestId,suggestions:[],responses:[{commentId:ni.threads[0].id,path:nf.path,itemId:ni.id,fileVersion:nf.version,decision:'accepted',reason:'Fixed',changes:[{slotId:nf.slots[0].id,before:nf.slots[0].translation,after:'Reviewed spelling'}]}]});
  assert.equal(result.files[0].items[0].changes[0].status,'pending');setResolved(result.files[0].items[0],result.files[0].slots,ni.threads[0].id,true);assert.equal(result.files[0].slots[0].translation,'Reviewed spelling');
});
test('initial review rejects edits, foreign targets, duplicate imports and stale originals atomically',{skip:!corpus},()=>{
  const file=structuredClone(reference!),workspace={...emptyWorkspace(),files:[file]},request=createRequest(workspace,[file.path],'initial');workspace.requests.push(request);
  const target=request.targets![0],base:ReviewResponse={schemaVersion:1,requestId:request.requestId,responses:[],suggestions:[{id:'issue',path:target.path,itemId:target.itemId,fileVersion:target.fileVersion,reason:'Issue',changes:[]}]};
  for(const corrupt of [(r:ReviewResponse)=>r.suggestions[0].itemId='foreign',(r:ReviewResponse)=>r.suggestions.push(structuredClone(r.suggestions[0])),(r:ReviewResponse)=>r.suggestions[0].changes.push({slotId:file.slots[0].id,before:file.slots[0].translation,after:'edit'})]){const r=structuredClone(base),before=JSON.stringify(workspace);corrupt(r);assert.throws(()=>importResponse(workspace,r));assert.equal(JSON.stringify(workspace),before);}
  assert.throws(()=>importResponse(workspace,base,[]),/指摘コメント/);assert.throws(()=>importResponse(importResponse(workspace,base),base),/既に/);
  file.slots[0].translation+=' changed';assert.throws(()=>importResponse(workspace,base),/依頼後/);file.slots[0].translation=target.slots[0].translation;file.slots[0].source+=' changed';assert.throws(()=>importResponse(workspace,base),/依頼後/);
});
test('a clean initial review creates no comments and never automatically approves items',{skip:!corpus},()=>{
  const workspace={...emptyWorkspace(),files:[structuredClone(reference!)]},request=createRequest(workspace,[reference!.path],'initial');workspace.requests.push(request);
  const next=importResponse(workspace,{schemaVersion:1,requestId:request.requestId,responses:[],suggestions:[]});assert.deepEqual(next.files,workspace.files);assert.equal(next.importedResponses[0],request.requestId);
});

test('each request names its response uniquely and gives concise portable review instructions', {skip: !corpus}, () => {
  const {workspace}=setup(),first=createRequest(workspace,[workspace.files[0].path]),second=createRequest(workspace,[workspace.files[0].path]);
  assert.notEqual(reviewFileNames(first).response,reviewFileNames(second).response);
  const shortId=first.requestId.replace(/-/g,'').slice(0,12);
  assert.equal(reviewFileNames(first).response,`review_response_${shortId}.json`);
  assert.equal(reviewFileNames(first).request,`review_request_${shortId}.json`);
  assert.ok(reviewFileNames(first).request.length<=32);
  assert.ok(chatInstructions(first).includes(first.requestId));
  const prompt=chatInstructions(first);
  assert.ok(prompt.includes(reviewFileNames(first).response));assert.ok(prompt.includes('woditor_review_tool.py'));
  assert.ok(!prompt.includes('python/woditor_review_tool.py'));assert.ok(!prompt.includes('review_response.json'));
  for(const required of ['全commentId','pendingChanges','changes: []','slots.translation','build → validate → apply','needs_review','COMMAND_TEXT','BOM','名前指定フィールド']) assert.ok(prompt.includes(required),required);
  assert.ok(prompt.length<1100,`instructions too long: ${prompt.length}`);
});
test('AI proposal -> resolve -> backup -> reopen -> resolve; another thread does not commit', {skip: !corpus}, () => {
  const {workspace, response, thread} = setup();
  const next = importResponse(workspace, response), f = next.files[0], i = f.items[0], old = f.slots[0].translation;
  const other = addComment(i, 'Other issue');
  setResolved(i, f.slots, other.id, true); assert.equal(i.changes[0].status, 'pending');
  assert.equal(canEdit(i.threads[0], i.threads[0].posts[0].id), false);
  setResolved(i, f.slots, thread.id, true); assert.equal(f.slots[0].translation, 'Yuichi, revised');
  const restored = restoreJson(backupJson(next)), rf = restored.files[0], ri = rf.items[0];
  setResolved(ri, rf.slots, thread.id, false); assert.equal(rf.slots[0].translation, old); assert.equal(isDone(ri), false);
  setResolved(ri, rf.slots, thread.id, true); assert.equal(rf.slots[0].translation, 'Yuichi, revised');
  approveItem(ri, rf.slots); assert.equal(isDone(ri), true);
});
test('ID/version/slot/duplicate/missing conflicts apply no changes', {skip: !corpus}, () => {
  for (const corrupt of [(r: ReviewResponse) => {r.responses[0].commentId = 'bad';}, (r: ReviewResponse) => {r.responses[0].fileVersion = 'f'.repeat(64);}, (r: ReviewResponse) => {r.responses[0].changes[0].before = 'bad';}, (r: ReviewResponse) => {r.responses.push(r.responses[0]);}, (r: ReviewResponse) => {r.responses = [];}]) {
    const {workspace, response} = setup(), before = JSON.stringify(workspace); corrupt(response);
    assert.throws(() => importResponse(workspace, response)); assert.equal(JSON.stringify(workspace), before);
  }
  const {workspace, response} = setup(), next = importResponse(workspace, response);
  assert.throws(() => importResponse(next, response), /既に/);
});
test('edits to a comment after export invalidate its response', {skip: !corpus}, () => {
  const {workspace, response, thread} = setup(); thread.posts[0].text = 'Changed';
  assert.throws(() => importResponse(workspace, response), /変更/);
});
test('revised TXT must agree with response; undeclared changes need manual review', {skip: !corpus}, () => {
  const {workspace, response} = setup(), revised = structuredClone(workspace.files[0]);
  revised.slots[0].translation = response.responses[0].changes[0].after;
  revised.slots[1].translation += ' changed';
  const next = importResponse(workspace, response, [revised]);
  assert.equal(next.files[0].items[0].changes[0].status, 'pending');
  assert.equal(next.files[0].items[1].threads[0].posts[0].decision, 'needs_review');
  revised.slots[0].translation = 'conflict'; assert.throws(() => importResponse(workspace, response, [revised]));
});

test('rejected reassessment imports the original TXT and lets the user discard the former proposal', {skip: !corpus}, () => {
  const {workspace,response,thread}=setup();
  const first=importResponse(workspace,response),file=first.files[0],item=file.items[0],original=file.slots[0].translation;
  addComment(item,'Please reconsider the proposed change',thread.id);
  const request=createRequest(first,[file.path]);first.requests.push(request);
  const rejected:ReviewResponse={schemaVersion:1,requestId:request.requestId,suggestions:[],responses:[{...response.responses[0],decision:'rejected',reason:'Withdraw the previous proposal',changes:[]}]};
  const revised=structuredClone(reference!);
  const next=importResponse(first,rejected,[revised]),nf=next.files[0],ni=nf.items[0];
  assert.equal(nf.slots[0].translation,original);
  assert.ok(ni.changes[0].rejectedBy);
  assert.throws(()=>setResolved(ni,nf.slots,thread.id,true),/破棄/);
  discardRejectedChanges(ni);
  assert.equal(ni.changes[0].status,'discarded');
  setResolved(ni,nf.slots,thread.id,true);assert.equal(nf.slots[0].translation,original);
  setResolved(ni,nf.slots,thread.id,false);assert.equal(ni.changes[0].status,'discarded');
  const restored=restoreJson(backupJson(next));assert.equal(restored.files[0].items[0].changes[0].status,'discarded');
  assert.equal(restored.files[0].items[0].threads[0].posts.filter(p=>p.author==='ai').length,2);
});

test('a new reassessment proposal replaces its own pending edit, but not another thread edit', {skip: !corpus}, () => {
  const {workspace,response,thread}=setup();const first=importResponse(workspace,response),file=first.files[0],item=file.items[0];
  addComment(item,'A different spelling please',thread.id);
  const request=createRequest(first,[file.path]);first.requests.push(request);
  assert.equal(request.entries[0].pendingChanges?.[0].after,'Yuichi, revised');
  const revised=structuredClone(reference!);revised.slots[0].translation='Second proposal';
  const answer:ReviewResponse={...response,requestId:request.requestId,responses:[{...response.responses[0],changes:[{...response.responses[0].changes[0],after:'Second proposal'}]}]};
  const next=importResponse(first,answer,[revised]),nf=next.files[0],ni=nf.items[0];
  assert.deepEqual(ni.changes.map(c=>c.status),['discarded','pending']);
  setResolved(ni,nf.slots,thread.id,true);assert.equal(nf.slots[0].translation,'Second proposal');
  setResolved(ni,nf.slots,thread.id,false);assert.equal(nf.slots[0].translation,reference!.slots[0].translation);
  const other=addComment(item,'Another issue'),otherRequest=createRequest(first,[file.path]);first.requests.push(otherRequest);
  const conflicting={...answer,requestId:otherRequest.requestId,responses:otherRequest.entries.map(e=>({...answer.responses[0],commentId:e.commentId,changes:e.commentId===other.id?answer.responses[0].changes:[]}))};
  const before=JSON.stringify(first);assert.throws(()=>importResponse(first,conflicting),/保留中/);assert.equal(JSON.stringify(first),before);
});

test('reopening multiple committed revisions restores the baseline before rejected reassessment', {skip: !corpus}, () => {
  const {workspace,response,thread}=setup();let next=importResponse(workspace,response),file=next.files[0],item=file.items[0];
  setResolved(item,file.slots,thread.id,true);
  const second=addComment(item,'Improve again'),request=createRequest(next,[file.path]);next.requests.push(request);
  const edit={slotId:file.slots[0].id,before:file.slots[0].translation,after:'Third spelling'};
  next=importResponse(next,{...response,requestId:request.requestId,responses:[{...response.responses[0],commentId:second.id,changes:[edit]}]});
  file=next.files[0];item=file.items[0];setResolved(item,file.slots,second.id,true);
  assert.throws(()=>setResolved(item,file.slots,thread.id,false),/後続/);
  setResolved(item,file.slots,second.id,false);assert.equal(file.slots[0].translation,'Yuichi, revised');
  addComment(item,'Reconsider',second.id);const third=createRequest(next,[file.path]);next.requests.push(third);
  const rejected=importResponse(next,{...response,requestId:third.requestId,responses:third.entries.map(e=>({...response.responses[0],commentId:e.commentId,decision:'rejected' as const,changes:[]}))});
  file=rejected.files[0];item=file.items[0];discardRejectedChanges(item);setResolved(item,file.slots,second.id,true);
  assert.equal(file.slots[0].translation,'Yuichi, revised');
});

test('discarding a proposal after exporting a request invalidates the stale answer', {skip: !corpus}, () => {
  const {workspace,response,thread}=setup();let first=importResponse(workspace,response);let file=first.files[0],item=file.items[0];
  addComment(item,'Reconsider',thread.id);const request=createRequest(first,[file.path]);first.requests.push(request);
  const reject={...response,requestId:request.requestId,responses:[{...response.responses[0],decision:'rejected' as const,changes:[]}]};
  first=importResponse(first,reject);file=first.files[0];item=file.items[0];
  const stale=createRequest(first,[file.path]);first.requests.push(stale);discardRejectedChanges(item);
  assert.throws(()=>importResponse(first,{...reject,requestId:stale.requestId}),/破棄/);
});
test('reload keeps unchanged approval and comments; changes await re-review', {skip: !corpus}, () => {
  const {workspace, file, item} = setup();
  item.threads = []; approveItem(item, file.slots); approveItem(file.items[1], file.slots);
  const incoming = structuredClone(file); incoming.slots[0].translation += ' new';
  const next = mergeFiles(workspace, [incoming]), f = next.files[0];
  assert.equal(f.items[0].approved, false); assert.equal(f.items[1].approved, true);
  assert.equal(f.slots[0].translation, file.slots[0].translation); assert.equal(f.items[0].changes[0].status, 'pending');
  approveItem(f.items[0], f.slots); assert.equal(f.slots[0].translation, incoming.slots[0].translation);
});
test('line shifts preserve unique review IDs; ambiguous source changes retain prior file', {skip: !corpus}, () => {
  const {workspace, file, item, thread} = setup(), incoming = structuredClone(file);
  incoming.sourceVersion = 'b'.repeat(64);
  incoming.slots[0].id = 'L00003:EVENT_NAME'; incoming.slots[0].line++;
  incoming.items[0].slotIds = [incoming.slots[0].id]; incoming.items[0].id = 'new';
  const next = mergeFiles(workspace, [incoming]);
  assert.equal(next.files[0].items[0].id, item.id); assert.equal(next.files[0].items[0].threads[0].id, thread.id);
  incoming.slots[0].fingerprint = 'c'.repeat(64);
  const unsafe = mergeFiles(workspace, [incoming]);
  assert.equal(unsafe.files[0].sourceVersion, file.sourceVersion); assert.match(unsafe.diagnostics[0].message, /対応付け/);
});
test('malformed backup references are refused before replacement', {skip: !corpus}, () => {
  const {workspace} = setup(); workspace.files[0].items[0].slotIds = ['bad'];
  assert.throws(() => restoreJson(backupJson(workspace)));
});
test('manual comment split/merge keeps Slots, reload grouping, backup and history boundaries', {skip: !corpus}, () => {
  const {workspace, file} = setup(), grouped = file.items.find(i => i.slotIds.length > 1)!;
  const count = file.items.length, ids = [...grouped.slotIds];
  const first = splitGroup(file, grouped.id);
  assert.equal(file.items.length, count + ids.length - 1);
  assert.equal(file.items.find(i => i.id === first)!.slotIds.length, 1);
  assert.equal(canMerge(file, file.items.find(i => i.id === first)!), true);
  const reloaded = mergeFiles(workspace, [structuredClone(reference!)]);
  assert.deepEqual(reloaded.files[0].manualGroups, file.manualGroups);
  assert.equal(reloaded.files[0].items.length, file.items.length);
  const restored = restoreJson(backupJson(reloaded)), rf = restored.files[0];
  mergeGroup(rf, first);
  assert.deepEqual(rf.items.find(i => i.id === first)!.slotIds, ids);
  addComment(rf.items.find(i => i.id === first)!, 'Locked group');
  assert.throws(() => splitGroup(rf, first), /履歴/);
});
test('unmatched English candidates keep manual originals across backup, reload and request export',{skip:!corpus},()=>{
  const file=realFile('MapData/TitleMap/Event_0000.txt'),workspace={...emptyWorkspace(),files:[file]};
  const candidate=structuredClone(file),slot=file.slots.find(s=>s.sourceMissing && s.translation.includes('[About'))!;
  const item=file.items.find(i=>i.slotIds.includes(slot.id))!;
  assert.equal(sourceText(slot),'');assert.ok(file.commands.some(c=>c.line===slot.line && c.en.includes('[About')));
  updateManualSources(file,item,new Map([[slot.id,'青いSマークについて']]));
  addComment(item,'確認してください');
  const request=createRequest(workspace,[file.path]);
  assert.equal(request.entries[0].slots[0].source,'青いSマークについて');assert.equal(request.entries[0].slots[0].line,slot.enLine);
  const restored=restoreJson(backupJson(workspace));assert.equal(sourceText(restored.files[0].slots.find(s=>s.id===slot.id)!),sourceText(slot));
  const reloaded=mergeFiles(workspace,[candidate]);assert.equal(sourceText(reloaded.files[0].slots.find(s=>s.id===slot.id)!),sourceText(slot));
});
