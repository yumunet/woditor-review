import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticsView, diagnosticTabFor,diagnosticItem,diagnosticLocation,withoutReplacedDiagnostics} from '../src/diagnostics';
import {emptyWorkspace,type Diagnostic,type ReviewFile} from '../src/model';
const diagnostics: Diagnostic[] = [
  {path:'a.txt',severity:'error',message:'Cannot match'},
  {path:'b.txt',severity:'warning',message:'Aligned automatically'},
  {path:'c.txt',severity:'skip',message:'Unsupported'},
];
test('diagnostic tabs show only their own severity with counts and escaping',()=>{
  for (const active of ['error','warning','skip'] as const) {
    const html=diagnosticsView(diagnostics,active);
    assert.ok(html.includes(`id="diagnostic-tab-${active}"`));
    assert.equal((html.match(/class="diagnostic /g)??[]).length,1);
    assert.ok(html.includes(diagnostics.find(d=>d.severity===active)!.message));
  }
  assert.ok(diagnosticsView([],'error').includes('エラーはありません'));
});
test('successful re-import removes stale errors for the attempted paths',()=>{
  assert.deepEqual(withoutReplacedDiagnostics(diagnostics,['a.txt','b.txt']),[diagnostics[2]]);
});
test('automatic alignment notices have their own tab without hiding actual warnings or errors',()=>{
  const automatic={path:'db.txt',severity:'warning',message:'設定キーによる行ずれ補正: 10件'} as Diagnostic;
  const warning={path:'db.txt',severity:'warning',message:'日本語と英語の改行形式が異なります'} as Diagnostic;
  assert.equal(diagnosticTabFor(automatic),'automatic');assert.equal(diagnosticTabFor(warning),'warning');assert.equal(diagnosticTabFor({...automatic,severity:'error'}),'error');
  const html=diagnosticsView([automatic,warning],'automatic');assert.ok(html.includes(automatic.message));assert.ok(!html.includes(warning.message));assert.ok(html.includes('自動補正 (1)'));assert.ok(html.includes('警告 (1)'));
  assert.ok(!diagnosticsView([automatic,warning],'warning').includes(automatic.message));
});

test('only positional alignment and known format differences are automatic',()=>{
  const automatic=['原文部分の行数差を自動補正しました（日本語 10 / 英語 9）','設定キーによる行ずれ補正: 2件','コマンド列による行ずれ補正: 1件',
    '旧形式の文字列操作の引数形式の違いを吸収: 1件'];
  const differences=['英語版で使用対象外になった翻訳項目: 3件','英語版に対応する翻訳項目がありません: 3件','翻訳対象外の設定値が日英で異なります: 2件','コマンド引数が日英で異なります: 2件'];
  for(const message of automatic) assert.equal(diagnosticTabFor({path:'a',severity:'warning',message}),'automatic');
  for(const message of differences) assert.equal(diagnosticTabFor({path:'a',severity:'warning',message}),'warning');
  for(const message of [...automatic,...differences]) assert.equal(diagnosticTabFor({path:'a',severity:'error',message}),'error');
});
test('diagnostic links use exact or nearby slots, including English-only originals',()=>{
  const file={path:'a.txt',slots:[{id:'s',line:10,enLine:8},{id:'missing',line:-20,enLine:20}],items:[{id:'a',slotIds:['s']},{id:'b',slotIds:['missing']}],commands:[],excluded:[]} as unknown as ReviewFile;
  const workspace={...emptyWorkspace(),files:[file]};
  const d:Diagnostic={path:'a.txt',severity:'error',message:'行 -20',...diagnosticLocation(file,'行 -20: ambiguous')};
  assert.deepEqual([d.line,d.enLine],[undefined,20]);assert.equal(diagnosticItem(workspace,d)?.item.id,'b');assert.equal(diagnosticItem(workspace,d)?.exact,true);
  file.slots[1].sourceMissing=true;
  assert.deepEqual(diagnosticLocation(file,'行 20: 対応候補が複数あり自動関連付けできません'),{line:undefined,enLine:20});
  assert.equal(diagnosticItem(workspace,{...d,message:'行 20: 対応候補が複数あり自動関連付けできません',line:20,enLine:8})?.item.id,'b');
  assert.equal(diagnosticItem(workspace,{...d,line:11,enLine:undefined})?.exact,false);
  assert.equal(diagnosticItem(workspace,{...d,line:undefined,enLine:undefined}),undefined);
  assert.equal(diagnosticItem(workspace,{...d,path:'rejected.txt'}),undefined);
  assert.ok(diagnosticsView([d],'error',workspace).includes('data-action="diagnostic-item"'));
});
