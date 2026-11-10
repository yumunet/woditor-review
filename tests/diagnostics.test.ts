import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticsView, diagnosticItem,diagnosticLocation,withoutReplacedDiagnostics} from '../src/diagnostics';
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
