import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolveDriveClientId, type DriveState} from '../src/drive-controller';
import {driveView} from '../src/drive-view';
test('embedded Drive configuration takes precedence over stale or empty saved IDs and hides manual settings',()=>{
  const embedded='123-public.apps.googleusercontent.com';
  for(const stored of [undefined,'','   ','old.apps.googleusercontent.com'])assert.equal(resolveDriveClientId(embedded,stored),embedded);
  assert.equal(resolveDriveClientId(undefined,' saved.apps.googleusercontent.com '),'saved.apps.googleusercontent.com');assert.equal(resolveDriveClientId('  ',''),'');
  const state:DriveState={clientId:embedded,hasEmbeddedClientId:true,ready:true,working:false,email:'',connected:false,automatic:false,message:'Ready',conflicts:[]};
  const html=driveView(state);assert.ok(!html.includes('drive-config-form'));assert.ok(!html.includes(embedded));assert.ok(!html.includes('クライアントシークレット'));assert.ok(!html.includes('専用領域'));
  assert.ok(driveView({...state,clientId:'',hasEmbeddedClientId:false}).includes('drive-config-form'));
});
