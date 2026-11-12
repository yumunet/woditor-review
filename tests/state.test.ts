import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addComment,
  approveItem,
  canEdit,
  deleteComment,
  editComment,
  latestComment,
  latestPreview,
  nextAfterApproval,
  setResolved,
  undoApproval,
} from '../src/review-state';
import { isDone, type Item, type Slot } from '../src/model';
const item = (): Item => ({
  id: 'a',
  title: 'コメント 1',
  slotIds: ['s'],
  code: 103,
  depth: 0,
  lastLine: 1,
  approved: false,
  threads: [],
  changes: [],
});
const slots = () => [{ id: 's', translation: 'old' } as Slot];
test('unresolved comments revoke approval; approve requires confirmation', () => {
  const i = item(),
    ss = slots();
  approveItem(i, ss);
  assert.equal(isDone(i), true);
  const t = addComment(i, 'Check');
  assert.equal(isDone(i), false);
  assert.throws(() => approveItem(i, ss));
  assert.equal(t.resolved, false);
  approveItem(i, ss, true);
  assert.equal(isDone(i), true);
  setResolved(i, ss, t.id, false);
  assert.equal(isDone(i), false);
});
test('post edit IDs, deletion protection after AI reply, latest reply preview', () => {
  const i = item(),
    t = addComment(i, 'Root'),
    id = t.posts[0].id;
  editComment(i, t.id, id, 'Edited');
  assert.equal(t.posts[0].id, id);
  t.posts[0].createdAt = '2026-01-01T00:00:00Z';
  addComment(i, 'Latest reply', t.id);
  assert.equal(latestPreview(i), 'Latest reply');
  t.posts.push({ id: 'ai', author: 'ai', text: 'Reply', createdAt: '2027-01-01T00:00:00Z' });
  assert.equal(canEdit(t, id), false);
  assert.throws(() => deleteComment(i, t.id, id));
  assert.throws(() => editComment(i, t.id, id, 'bad'));
  assert.equal(latestPreview(i), 'Reply');
});
test('approval moves forward through targets; undo does not move', () => {
  const a = item(),
    b = { ...item(), id: 'b', approved: true },
    c = { ...item(), id: 'c' };
  assert.equal(
    nextAfterApproval([a, b, c], 'a', (i) => !isDone(i)),
    'c',
  );
  assert.equal(
    nextAfterApproval([a, b, c], 'c', (i) => !isDone(i)),
    'c',
  );
  undoApproval(b);
  assert.equal(b.approved, false);
});
test('latest preview favors a later reply even with equal timestamps', () => {
  const i = item(),
    t = addComment(i, 'First');
  addComment(i, 'Second', t.id);
  t.posts[1].createdAt = t.posts[0].createdAt;
  assert.equal(latestPreview(i), 'Second');
});

test('preview navigation identifies the displayed reply and ignores resolved threads', () => {
  const i = item(),
    first = addComment(i, 'First'),
    second = addComment(i, 'Second');
  first.posts[0].createdAt = '2026-01-01T00:00:00Z';
  second.posts[0].createdAt = '2026-01-02T00:00:00Z';
  addComment(i, 'Reply to first', first.id);
  first.posts[1].createdAt = '2026-01-03T00:00:00Z';
  assert.equal(latestComment(i)?.thread, first);
  assert.equal(latestComment(i)?.post, first.posts[1]);
  assert.equal(latestPreview(i), 'Reply to first');
  second.posts[0].createdAt = '2026-01-04T00:00:00Z';
  second.resolved = true;
  assert.equal(latestComment(i)?.post, first.posts[1]);
  first.resolved = true;
  assert.equal(latestComment(i), undefined);
  assert.equal(latestPreview(i), '');
});
