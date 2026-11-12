import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRequest,
  importResponse,
  chatInstructions,
  type ReviewResponse,
} from '../src/exchange';
import { emptyWorkspace, type ReviewFile } from '../src/model';
import { approveItem, setResolved } from '../src/review-state';
import { backupJson, restoreJson } from '../src/storage';

function setup() {
  const slots = ['COMMON_NAME', 'MEMO'].map((key, i) => ({
    id: `s${i}`,
    line: i + 2,
    enLine: i + 2,
    start: i * 20,
    end: i * 20 + 2,
    source: `原文${i}`,
    translation: `English ${i}`,
    kind: 'metadata',
    key,
    title: key,
    command: null,
    warnings: [],
    fingerprint: String(i + 1).repeat(64),
  }));
  const file: ReviewFile = {
    path: 'BasicData/CommonEvent/000.txt',
    type: 'common',
    jaText: 'COMMON_ID=0\n' + slots.map((s) => s.key + '=' + s.source).join('\n'),
    enText: 'COMMON_ID=0\n' + slots.map((s) => s.key + '=' + s.translation).join('\n'),
    jaBom: false,
    enBom: false,
    sourceVersion: '0'.repeat(64),
    version: 'a'.repeat(64),
    slots,
    items: slots.map((s, i) => ({
      id: `i${i}`,
      slotIds: [s.id],
      title: s.title,
      code: null,
      depth: null,
      lastLine: s.line,
      approved: true,
      threads: [],
      changes: [],
    })),
    commands: [],
    usages: {},
    excluded: [],
    warnings: [],
  };
  const workspace = { ...emptyWorkspace(), files: [file] },
    request = createRequest(workspace, [file.path], 'initial');
  workspace.requests.push(request);
  const response: ReviewResponse = {
    schemaVersion: 1,
    requestId: request.requestId,
    responses: [],
    suggestions: [
      {
        id: 'issue',
        path: file.path,
        itemId: 'i0',
        fileVersion: file.version,
        reason: '用語を統一します',
        changes: [{ slotId: 's0', before: 'English 0', after: 'Revised English' }],
      },
    ],
  };
  return { workspace, request, response, file };
}

test('initial review separates reasons and pending edits, persists them and uses the usual approval/reply flow', () => {
  const { workspace, request, response, file } = setup(),
    before = structuredClone(workspace);
  assert.match(chatInstructions(request), /修正後の英訳はchanges.after/);
  assert.match(chatInstructions(request), /apply/);
  assert.match(chatInstructions(request), /<\\n>/);
  const next = restoreJson(backupJson(importResponse(workspace, response))),
    nf = next.files[0],
    item = nf.items[0];
  assert.deepEqual(workspace, before);
  assert.equal(nf.enText, file.enText);
  assert.equal(nf.slots[0].translation, 'English 0');
  assert.equal(item.approved, false);
  assert.equal(nf.items[1].approved, true);
  assert.equal(item.threads[0].posts[0].text, '用語を統一します');
  assert.equal(item.threads[0].posts[0].decision, 'needs_review');
  assert.equal(item.changes[0].status, 'pending');
  assert.equal(item.changes[0].after, 'Revised English');
  assert.equal(item.changes[0].aiPostId, item.threads[0].posts[0].id);
  const followup = createRequest(next, [nf.path]);
  assert.equal(followup.entries[0].pendingChanges![0].after, 'Revised English');
  setResolved(item, nf.slots, 'issue', true);
  assert.equal(nf.slots[0].translation, 'Revised English');
  setResolved(item, nf.slots, 'issue', false);
  assert.equal(nf.slots[0].translation, 'English 0');
  approveItem(item, nf.slots, true);
  assert.equal(nf.slots[0].translation, 'Revised English');
  assert.equal(item.approved, true);
  assert.throws(() => importResponse(next, response), /既に/);
});

test('initial edits are rejected atomically for invalid slots, duplicate edits, stale text, unsafe strings and pending conflicts', () => {
  for (const corrupt of [
    (r: ReviewResponse) => (r.suggestions[0].changes[0].slotId = 's1'),
    (r: ReviewResponse) => (r.suggestions[0].changes[0].before = 'Stale'),
    (r: ReviewResponse) => (r.suggestions[0].changes[0].after = 'First\nSecond'),
    (r: ReviewResponse) => (r.suggestions[0].changes[0].after = 'Bad\0text'),
    (r: ReviewResponse) =>
      r.suggestions.push({ ...structuredClone(r.suggestions[0]), id: 'other' }),
  ]) {
    const { workspace, response } = setup(),
      before = structuredClone(workspace);
    corrupt(response);
    assert.throws(() => importResponse(workspace, response));
    assert.deepEqual(workspace, before);
  }
  const { workspace, response, file } = setup();
  file.items[0].changes.push({
    id: 'old',
    threadId: 'old-thread',
    slotId: 's0',
    before: 'English 0',
    after: 'Old proposal',
    origin: 'ai',
    status: 'pending',
    createdAt: workspace.updatedAt,
  });
  assert.throws(() => importResponse(workspace, response), /保留中/);
  assert.equal(file.items[0].changes.length, 1);
  file.items[0].changes = [];
  file.slots[0].kind = 'command_string';
  response.suggestions[0].changes[0].after = 'Literal "quote"';
  assert.throws(() => importResponse(workspace, response), /<dqrt>/);
  file.slots[0].kind = 'database_csv';
  file.slots[0].key = 'CSV_D0_ITEM0';
  response.suggestions[0].changes[0].after = 'Quoted "text"\nSecond line';
  assert.doesNotThrow(() => importResponse(workspace, response));
  file.slots[0].key = 'CSV_D0_NAME';
  assert.throws(() => importResponse(workspace, response), /改行/);
});

test('initial corrected TXT is checked against JSON and remains a proposal, with saved slot IDs and shifted CSV lines supported', () => {
  const { workspace, response, file } = setup();
  // Saved IDs can differ from a fresh parser result after an earlier overwrite.
  file.slots[0].id = 'N:saved';
  file.items[0].slotIds = ['N:saved'];
  file.slots[0].kind = 'database_csv';
  file.slots[0].key = 'CSV_D0_ITEM0';
  workspace.requests[0] = createRequest(workspace, [file.path], 'initial');
  response.requestId = workspace.requests[0].requestId;
  response.suggestions[0].changes[0].slotId = 'N:saved';
  const revised = structuredClone(file);
  revised.slots[0].id = 'CSV_D0_ITEM0';
  revised.slots[0].line = 10;
  revised.slots[0].enLine = 11;
  revised.slots[0].translation = 'Revised English';
  revised.version = 'b'.repeat(64);
  revised.enText = 'Corrected TXT';
  const result = restoreJson(backupJson(importResponse(workspace, response, [revised]))),
    updated = result.files[0];
  assert.equal(updated.enText, 'Corrected TXT');
  assert.equal(updated.version, revised.version);
  assert.equal(updated.slots[0].enLine, 11);
  assert.equal(updated.slots[0].translation, 'English 0');
  assert.equal(updated.items[0].changes[0].status, 'pending');
  setResolved(updated.items[0], updated.slots, 'issue', true);
  assert.equal(updated.slots[0].translation, 'Revised English');
  const before = structuredClone(workspace);
  for (const corrupt of [
    (f: ReviewFile) => (f.slots[0].translation = 'Different'),
    (f: ReviewFile) => (f.slots[1].translation = 'Undeclared edit'),
    (f: ReviewFile) => f.slots.pop(),
    (f: ReviewFile) => f.slots.push(structuredClone(f.slots[0])),
    (f: ReviewFile) => (f.sourceVersion = 'c'.repeat(64)),
  ]) {
    const invalid = structuredClone(revised);
    corrupt(invalid);
    assert.throws(() => importResponse(workspace, response, [invalid]));
    assert.deepEqual(workspace, before);
  }
  assert.throws(() => importResponse(workspace, response, []), /不足/);
});

test('initial comments-only and clean responses remain supported without automatically approving anything', () => {
  const { workspace, response } = setup();
  response.suggestions[0].changes = [];
  const next = importResponse(workspace, response);
  assert.deepEqual(next.files[0].slots, workspace.files[0].slots);
  assert.equal(next.files[0].items[0].changes.length, 0);
  assert.equal(next.files[0].items[0].threads.length, 1);
  response.suggestions = [];
  assert.deepEqual(importResponse(workspace, response).files, workspace.files);
});
