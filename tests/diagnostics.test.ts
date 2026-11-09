import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diagnosticsView, withoutReplacedDiagnostics} from '../src/diagnostics';
import type {Diagnostic} from '../src/model';
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
