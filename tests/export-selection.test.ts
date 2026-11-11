import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectRange,type SelectionRow} from '../src/export-selection';

const rows:SelectionRow[]=[{key:'folder:A',paths:['A/0','A/1']},{key:'file:A/0',paths:['A/0']},{key:'file:A/1',paths:['A/1']},{key:'file:B/0',paths:['B/0']}];
test('range selection works in both directions and preserves files outside the range',()=>{
  const baseline=new Set(['elsewhere']);
  assert.deepEqual(selectRange(rows,'file:A/0','file:B/0',baseline,true),new Set(['elsewhere','A/0','A/1','B/0']));
  assert.deepEqual(selectRange(rows,'file:B/0','file:A/0',baseline,true),new Set(['elsewhere','A/0','A/1','B/0']));
  assert.deepEqual(baseline,new Set(['elsewhere']));
});
test('deselecting a range includes folder descendants even when collapsed',()=>{
  const collapsed=rows.filter(row=>!row.key.startsWith('file:A/'));
  assert.deepEqual(selectRange(collapsed,'file:B/0','folder:A',new Set(['A/0','A/1','B/0','elsewhere']),false),new Set(['elsewhere']));
});
test('shrinking a touch range restores the original values outside the new span',()=>{
  const baseline=new Set(['B/0','elsewhere']);
  assert.deepEqual(selectRange(rows,'file:A/0','file:A/1',baseline,true),new Set(['B/0','elsewhere','A/0','A/1']));
  assert.deepEqual(selectRange(rows,'file:A/0','file:A/0',baseline,true),new Set(['B/0','elsewhere','A/0']));
  assert.deepEqual(selectRange(rows,'missing','file:A/1',baseline,false),baseline);
});
