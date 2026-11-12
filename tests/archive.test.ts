import { test } from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { readZip, relativePath } from '../src/archive';
test('ZIP paths recognize locale and extra parent folders', () => {
  assert.equal(
    relativePath('project/export/ja-JP/texts/BasicData/CommonEvent/042.txt'),
    'BasicData/CommonEvent/042.txt',
  );
  const files = readZip(
    zipSync({ 'project/en-US/texts/MapData/Test/Event_0000.txt': strToU8('EVENT_ID=0') }),
  );
  assert.equal(files.size, 1);
  assert.ok(files.has('MapData/Test/Event_0000.txt'));
});
test('duplicate and traversal paths are refused', () => {
  assert.throws(() => relativePath('a/../../secret.txt'));
  assert.throws(() =>
    readZip(zipSync({ 'ja-JP/texts/a.txt': strToU8('a'), 'texts/a.txt': strToU8('b') })),
  );
});
