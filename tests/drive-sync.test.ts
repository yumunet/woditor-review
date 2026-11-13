import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, type Workspace } from '../src/model';
import { synchronize, workspaceHash, revisionHeads, type SyncBase } from '../src/drive-sync';
import {
  decodeSnapshot,
  encodeSnapshot,
  GoogleDrive,
  DriveAuthError,
  type DriveRemote,
  type DriveRevision,
  type DriveSnapshot,
} from '../src/drive-api';
// Empty files are enough to represent workspaces without coupling sync tests to the parser.
const workspace = (note: string): Workspace => ({
  ...emptyWorkspace(),
  diagnostics: [{ path: 'test.txt', severity: 'warning', message: note }],
  files: [],
});
const changed = (note: string): Workspace => ({
  ...workspace(note),
  files: [{ path: 'test.txt' } as Workspace['files'][number]],
});
class MemoryDrive implements DriveRemote {
  snapshots: DriveSnapshot[] = [];
  afterUpload?: () => void;
  list = async () =>
    this.snapshots.map((s) => ({
      id: s.id,
      fileId: s.id,
      parents: s.parents,
      device: s.device,
      modifiedTime: s.createdAt,
    }));
  download = async (r: DriveRevision) =>
    structuredClone(this.snapshots.find((s) => s.id === r.id)!);
  upload = async (s: DriveSnapshot) => {
    this.snapshots.push(structuredClone(s));
    this.afterUpload?.();
  };
}
const snapshot = (data: Workspace, parents: string[] = []) =>
  ({
    schemaVersion: 1,
    kind: 'woditor-review-sync',
    id: crypto.randomUUID(),
    parents,
    device: 'phone',
    createdAt: new Date().toISOString(),
    workspace: data,
  }) as DriveSnapshot;
test('first upload, a second empty device pull, and unchanged re-sync preserve full state', async () => {
  const remote = new MemoryDrive(),
    local = changed('first'),
    push = await synchronize(remote, local, undefined, 'PC');
  assert.equal(push.kind, 'uploaded');
  assert.equal(remote.snapshots.length, 1);
  const pull = await synchronize(remote, emptyWorkspace(), undefined, 'phone');
  assert.equal(pull.kind, 'downloaded');
  assert.deepEqual(pull.workspace, local);
  const again = await synchronize(remote, { ...local, updatedAt: 'later' }, pull.base, 'phone');
  assert.equal(again.kind, 'unchanged');
  assert.equal(remote.snapshots.length, 1);
});
test('one-sided edits push or pull while concurrent edits require an explicit choice', async () => {
  const remote = new MemoryDrive(),
    original = changed('initial'),
    first = await synchronize(remote, original, undefined, 'PC');
  const phone = await synchronize(remote, changed('phone'), first.base, 'phone');
  assert.equal(phone.kind, 'uploaded');
  const download = await synchronize(remote, original, first.base, 'PC');
  assert.equal(download.kind, 'downloaded');
  assert.equal(download.workspace!.diagnostics[0].message, 'phone');
  const conflict = await synchronize(remote, changed('PC'), first.base, 'PC');
  assert.equal(conflict.kind, 'conflict');
  assert.equal(remote.snapshots.length, 2);
  const accepted = await synchronize(remote, changed('PC'), first.base, 'PC', {
    use: 'remote',
    revision: phone.base!.revision,
    expectedHeads: conflict.heads.map((h) => h.id),
  });
  assert.equal(accepted.kind, 'downloaded');
  assert.equal(accepted.workspace!.diagnostics[0].message, 'phone');
  assert.equal(remote.snapshots.length, 3);
  assert.equal(remote.snapshots[0].workspace.diagnostics[0].message, 'initial');
});
test('racing creates preserve both branches; resolution joins every observed head and rejects stale choices', async () => {
  const remote = new MemoryDrive(),
    local = changed('local');
  const root = snapshot(changed('root'));
  remote.snapshots.push(root);
  const base: SyncBase = {
    revision: root.id,
    hash: await workspaceHash(root.workspace),
    syncedAt: root.createdAt,
  };
  remote.afterUpload = () => {
    remote.afterUpload = undefined;
    remote.snapshots.push(snapshot(changed('other'), [root.id]));
  };
  const race = await synchronize(remote, local, base, 'PC');
  assert.equal(race.kind, 'conflict');
  assert.equal(race.heads.length, 2);
  assert.equal(remote.snapshots.length, 3);
  const old = race.heads.map((h) => h.id);
  remote.snapshots.push(snapshot(changed('newer'), [old[0]]));
  const stale = await synchronize(remote, local, base, 'PC', { use: 'local', expectedHeads: old });
  assert.equal(stale.kind, 'conflict');
  assert.equal(remote.snapshots.length, 4);
  const merged = await synchronize(remote, local, base, 'PC', {
    use: 'local',
    expectedHeads: stale.heads.map((h) => h.id),
  });
  assert.equal(merged.kind, 'uploaded');
  assert.equal(revisionHeads(await remote.list()).length, 1);
  assert.deepEqual(remote.snapshots.at(-1)!.parents.sort(), stale.heads.map((h) => h.id).sort());
});
test('different initial projects conflict, and failed network operations do not mutate local state', async () => {
  const remote = new MemoryDrive();
  remote.snapshots.push(snapshot(changed('remote')));
  const local = changed('local'),
    before = JSON.stringify(local);
  const result = await synchronize(remote, local, undefined, 'PC');
  assert.equal(result.kind, 'conflict');
  assert.equal(JSON.stringify(local), before);
  remote.upload = async () => {
    throw Error('offline');
  };
  await assert.rejects(
    () =>
      synchronize(remote, local, undefined, 'PC', {
        use: 'local',
        expectedHeads: result.heads.map((h) => h.id),
      }),
    /offline/,
  );
  assert.equal(JSON.stringify(local), before);
});
test('diagnostics without parsed files still sync and are not treated as an empty device', async () => {
  const remote = new MemoryDrive(),
    local = workspace('rejected import');
  assert.equal((await synchronize(remote, local, undefined, 'PC')).kind, 'uploaded');
  const result = await synchronize(remote, workspace('other rejected import'), undefined, 'phone');
  assert.equal(result.kind, 'conflict');
});
test('gzip snapshots validate schema and revision before applying, and malformed histories are refused', async () => {
  const data = snapshot(emptyWorkspace()),
    revision = {
      id: data.id,
      fileId: 'file',
      parents: [],
      device: data.device,
      modifiedTime: data.createdAt,
    };
  const zip = await encodeSnapshot(data);
  assert.deepEqual(await decodeSnapshot(zip.stream(), revision), data);
  await assert.rejects(
    () => decodeSnapshot(zip.stream(), { ...revision, id: crypto.randomUUID() }),
    /不正/,
  );
  const corrupt = { ...data, workspace: { ...data.workspace, files: [{}] } } as DriveSnapshot;
  await assert.rejects(
    () => encodeSnapshot(corrupt).then((z) => decodeSnapshot(z.stream(), revision)),
    /形式/,
  );
  assert.throws(() => revisionHeads([{ ...revision, parents: [revision.id] }]), /循環/);
  assert.throws(() => revisionHeads([revision, revision]), /重複/);
});
test('Drive API restricts appData scope and follows pagination, resumable upload, and auth errors', async () => {
  const data = snapshot(emptyWorkspace()),
    calls: { url: string; init: RequestInit }[] = [];
  const fake: typeof fetch = async (input, init = {}) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    if (url.includes('pageToken=next')) return Response.json({ files: [] });
    if (url.includes('/drive/v3/files?')) {
      if (init.method === 'POST')
        return new Response(null, { headers: { Location: 'https://www.googleapis.com/session' } });
      return Response.json({
        files: [
          {
            id: 'file',
            modifiedTime: data.createdAt,
            appProperties: { revision: data.id, device: 'PC' },
          },
        ],
        nextPageToken: 'next',
      });
    }
    return Response.json({ id: 'file' });
  };
  const remote = new GoogleDrive(() => 'memory-token', fake);
  assert.equal((await remote.list()).length, 1);
  assert.ok(calls[0].url.includes('spaces=appDataFolder'));
  assert.ok(calls[1].url.includes('pageToken=next'));
  await remote.upload(data);
  assert.equal(calls.at(-1)!.init.method, 'PUT');
  assert.equal(calls.at(-1)!.url, 'https://www.googleapis.com/session');
  assert.equal(new Headers(calls[0].init.headers).get('Authorization'), 'Bearer memory-token');
  const unauthorized = new GoogleDrive(
    () => 'expired',
    async () => new Response('', { status: 401 }),
  );
  await assert.rejects(() => unauthorized.list(), DriveAuthError);
  const denied = new GoogleDrive(
    () => 'denied',
    async () => new Response('', { status: 403 }),
  );
  await assert.rejects(() => denied.list(), /拒否/);
});
