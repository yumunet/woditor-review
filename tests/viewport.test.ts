import {test} from 'node:test';
import assert from 'node:assert/strict';
import {viewportBox} from '../src/viewport';
test('keyboard viewport uses visible height and offset while pinch zoom preserves the layout',()=>{
  assert.deepEqual(viewportBox(430,30,1,844),{height:430,top:30});
  assert.deepEqual(viewportBox(430,30,2,844),{height:844,top:0});
  assert.deepEqual(viewportBox(0,30,1,844),{height:844,top:0});
});
