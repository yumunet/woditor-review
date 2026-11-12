import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandColor } from '../src/command-colors';
import { compact, escape, fileTree, percent } from '../src/ui';
import type { ReviewFile } from '../src/model';
test('command colors recognize both languages and repeated indent markers without broad prefix matches', () => {
  const fallback = commandColor('other');
  for (const [ja, en] of [
    ['■条件分岐', '■Condition'],
    ['■変数操作', '■Set Variable'],
    ['▼', '▼'],
  ]) {
    assert.equal(commandColor(ja + ' text'), commandColor(en + ' text'));
    assert.equal(commandColor(' | | |' + ja + ' text'), commandColor(ja + ' text'));
    assert.notEqual(commandColor(ja + ' text'), fallback);
  }
  assert.notEqual(commandColor('■Condition text'), commandColor('■Set Variable text'));
  for (const invalid of ['■Key Input:x', '  ▼ note', '|▼ note'])
    assert.equal(commandColor(invalid), fallback);
});
test('compact counts and zero denominator', () => {
  assert.equal(compact(1000), '1K');
  assert.equal(compact(1200), '1.2K');
  assert.equal(percent(0, 0), null);
  assert.equal(percent(1, 4), 25);
  assert.equal(escape('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
test('nested folder aggregates and natural file order', () => {
  const file = (path: string, approved: boolean) =>
    ({ path, items: [{ approved, threads: [], changes: [] }] }) as unknown as ReviewFile;
  const tree = fileTree([file('A/B/10.txt', false), file('A/B/2.txt', true)], 'all');
  assert.equal(tree.total, 2);
  assert.equal(tree.done, 1);
  assert.equal(tree.children[0].children[0].total, 2);
  assert.equal(tree.children[0].children[0].children[0].name, '2.txt');
});
