import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commandColor, commandColors } from '../src/command-colors';
import { compact, escape, fileTree, percent } from '../src/ui';
import type { ReviewFile } from '../src/model';
test('all 42 exact prefix pairs and defaults', () => {
  assert.equal(commandColors.length, 42);
  for (const [ja, en, color] of commandColors) {
    assert.equal(commandColor(ja + 'x'), `rgb(${color})`);
    assert.equal(commandColor(en + 'x'), `rgb(${color})`);
  }
  assert.equal(commandColor('■Key Input:x'), 'rgb(40, 40, 60)');
  assert.equal(commandColor(' |▼ note'), 'rgb(0, 160, 0)');
  for(const [ja,en,color] of commandColors) for(const prefix of [ja,en]) {
    assert.equal(commandColor(' | | |'+prefix+'x'),`rgb(${color})`);
  }
  assert.equal(commandColor(' | |■Key Input:x'),'rgb(40, 40, 60)');
  assert.equal(commandColor('  ▼ note'),'rgb(40, 40, 60)');
  assert.equal(commandColor('|▼ note'),'rgb(40, 40, 60)');
  assert.equal(commandColor('other'), 'rgb(40, 40, 60)');
});
test('compact counts and zero denominator', () => {
  assert.equal(compact(1000), '1K'); assert.equal(compact(1200), '1.2K');
  assert.equal(percent(0, 0), null); assert.equal(percent(1, 4), 25);
  assert.equal(escape('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
test('nested folder aggregates and natural file order', () => {
  const file = (path: string, approved: boolean) => ({path, items: [{approved, threads: [], changes: []}]} as unknown as ReviewFile);
  const tree = fileTree([file('A/B/10.txt', false), file('A/B/2.txt', true)], 'all');
  assert.equal(tree.total, 2); assert.equal(tree.done, 1);
  assert.equal(tree.children[0].children[0].total, 2);
  assert.equal(tree.children[0].children[0].children[0].name, '2.txt');
});
