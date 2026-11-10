import {test} from 'node:test';
import assert from 'node:assert/strict';
import {preferencesFrom} from '../src/preferences';
test('preferences preserve explicit false values and reject invalid saved options',()=>{
  const defaults=preferencesFrom(null);
  assert.deepEqual(preferencesFrom({reviewMode:'unknown',contextRadius:100,contextLanguage:'other'}),defaults);
  const saved=preferencesFrom({reviewMode:'initial',contextRadius:10,contextOpen:false,contextLanguage:'ja',contextFull:true,contextLineNumbers:true,contextWrap:false});
  assert.equal(saved.contextOpen,false);assert.equal(saved.contextWrap,false);assert.equal(saved.contextRadius,10);assert.equal(saved.contextFull,true);assert.equal(saved.reviewMode,'initial');
});
