import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTextView,targetLine,textViewMarkup,viewLines} from '../src/text-viewer';
import {diagnosticDocument,diagnosticLocation,replaceDiagnosticDocuments} from '../src/diagnostics';
import {emptyWorkspace,type ReviewFile} from '../src/model';
import {backupJson,restoreJson} from '../src/storage';
test('text viewer keeps language-specific positions and preserves escaped literals',()=>{
  const view=createTextView({path:'a.txt',jaText:'a\r\n日本語\r\n<x>',enText:'a\nb\nEnglish'},{path:'a.txt',severity:'error',message:'行 2',line:2,enLine:3});
  assert.equal(view.language,'ja');assert.equal(targetLine(view),2);assert.equal(viewLines(view)![2],'<x>');
  view.language='en';assert.equal(targetLine(view),3);assert.equal(viewLines(view)![2],'English');assert.ok(textViewMarkup(view).includes('3行 / 3行'));
});
test('diagnostic raw documents survive backup and resolve rejected files',()=>{
  const workspace={...emptyWorkspace(),diagnosticDocuments:[{path:'MapData/Test/Event.txt',jaText:'EVENT_ID=0',enText:'EVENT_ID=99'}]};
  const restored=restoreJson(backupJson(workspace));assert.equal(diagnosticDocument(restored,workspace.diagnosticDocuments[0].path)!.enText,'EVENT_ID=99');
  assert.deepEqual(replaceDiagnosticDocuments(workspace.diagnosticDocuments,[],[workspace.diagnosticDocuments[0].path]),[]);
});
test('diagnostic rows use source and English line positions independently',()=>{
  const file={slots:[{line:50,enLine:47}],commands:[],excluded:[]} as unknown as ReviewFile;
  assert.deepEqual(diagnosticLocation(file,'行 50: ambiguous'),{line:50,enLine:47});
});
