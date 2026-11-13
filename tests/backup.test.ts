import test from 'node:test';
import assert from 'node:assert/strict';
import { strFromU8, unzipSync, zipSync, Zip, ZipDeflate } from 'fflate';
import { createBackup, readBackup } from '../src/backup-archive';
import { backupJson } from '../src/storage';
import { emptyWorkspace } from '../src/model';
import { reviewFile } from './helpers/review-fixtures';
import { BackupZip } from '../src/backup-zip';
import { backupChunks } from '../src/backup-json';
import type { BackupCompressor } from '../src/backup-compression';

const inlineCompression: BackupCompressor = async (name, chunks) => {
  const parts: Uint8Array<ArrayBuffer>[] = [],
    archive = new BackupZip(name, (data) => parts.push(data));
  for (const data of chunks) archive.push(data);
  archive.push(new Uint8Array(), true);
  return new Blob(parts, { type: 'application/zip' });
};

function workspace() {
  return {
    ...emptyWorkspace(),
    files: [reviewFile()],
    diagnosticDocuments: [
      { path: 'broken.txt', jaText: '日本語\r\n"引用" 😀', enText: 'English\n' },
    ],
  };
}
function zip(text: string) {
  return new Blob([zipSync({ 'state.json': new TextEncoder().encode(text) })]);
}
function mutate(bytes: Uint8Array<ArrayBuffer>, edit: (view: DataView, central: number) => void) {
  const copy = bytes.slice(),
    view = new DataView(copy.buffer);
  edit(view, view.getUint32(copy.length - 6, true));
  return new Blob([copy]);
}
test('backup ZIP contains one compact UTF-8 JSON and round trips the full review state', async () => {
  const original = workspace(),
    before = structuredClone(original),
    expected = JSON.parse(JSON.stringify(original));
  const { name, blob } = await createBackup(
    original,
    new Date(2026, 10, 13, 12, 34, 56),
    inlineCompression,
  );
  assert.equal(name, 'woditor-review-backup_2026-11-13_12-34-56.zip');
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(Object.keys(files), [name.replace('.zip', '.json')]);
  assert.equal(strFromU8(Object.values(files)[0]), JSON.stringify(original));
  assert.equal(backupJson(original), JSON.stringify(original));
  assert.deepEqual(await readBackup(blob), expected);
  assert.deepEqual(original, before);
});
test('bounded JSON chunks preserve escapes, Unicode pairs, lone surrogates and optional values', () => {
  const values = [
    'a'.repeat(4095) + '😀',
    '日本語\\\r\n\t"'.repeat(14000),
    '\ud800' + 'z'.repeat(4095) + '\udc00',
  ];
  const input = {
    values,
    [values[0]]: 'key boundary',
    omitted: undefined,
    array: [undefined, null, true, false, NaN, Infinity, -0, 123],
  };
  const pieces = [...backupChunks(input)];
  assert.ok(pieces.every((p) => p.length <= 65536));
  assert.equal(Buffer.concat(pieces).toString('utf8'), JSON.stringify(input));
  assert.deepEqual(
    JSON.parse(Buffer.concat(pieces).toString('utf8')),
    JSON.parse(JSON.stringify(input)),
  );
  assert.throws(() => [...backupChunks(input, 10)], /大きすぎ/);
  const cycle: { child?: unknown } = {};
  cycle.child = cycle;
  assert.throws(() => [...backupChunks(cycle)], /循環/);
});
test('legacy indented JSON including BOM still restores', async () => {
  const original = workspace();
  assert.deepEqual(
    await readBackup(new Blob(['\ufeff' + JSON.stringify(original, null, 2)])),
    JSON.parse(JSON.stringify(original)),
  );
});
test('streamed ZIP data descriptors and stored entries restore', async () => {
  const text = JSON.stringify(workspace()),
    pieces: Uint8Array<ArrayBuffer>[] = [];
  const archive = new Zip((error, chunk) => {
    if (error) throw error;
    pieces.push(chunk);
  });
  const entry = new ZipDeflate('state.json');
  archive.add(entry);
  entry.push(new TextEncoder().encode(text), true);
  archive.end();
  assert.deepEqual(await readBackup(new Blob(pieces)), JSON.parse(text));
  const stored = zipSync({ 'state.json': new TextEncoder().encode(text) }, { level: 0 });
  assert.deepEqual(await readBackup(new Blob([stored])), JSON.parse(text));
});
test('corrupt CRC, encrypted, truncated and ambiguous archives are refused', async () => {
  const text = JSON.stringify(workspace()),
    bytes = zipSync({ 'state.json': new TextEncoder().encode(text) });
  const crc = mutate(bytes, (v, c) => {
    v.setUint32(14, 1, true);
    v.setUint32(c + 16, 1, true);
  });
  const encrypted = mutate(bytes, (v, c) => {
    v.setUint16(6, v.getUint16(6, true) | 1, true);
    v.setUint16(c + 8, v.getUint16(c + 8, true) | 1, true);
  });
  const multiple = new Blob([
    zipSync({ 'a.json': new TextEncoder().encode(text), 'b.json': new TextEncoder().encode(text) }),
  ]);
  for (const blob of [
    crc,
    encrypted,
    new Blob([bytes.subarray(0, -2)]),
    multiple,
    new Blob([zipSync({})]),
  ])
    await assert.rejects(readBackup(blob));
});
test('actual decoded size and declared expansion limits are enforced', async () => {
  const text = JSON.stringify(workspace());
  await assert.rejects(readBackup(new Blob([text]), text.length - 1), /大きすぎ/);
  await assert.rejects(readBackup(zip(text), text.length - 1), /大きすぎ/);
  const bytes = zipSync({ 'state.json': new TextEncoder().encode(text) });
  await assert.rejects(
    readBackup(
      mutate(bytes, (v, c) => {
        v.setUint32(22, 1, true);
        v.setUint32(c + 24, 1, true);
      }),
    ),
    /大きすぎ/,
  );
  await assert.rejects(
    readBackup(
      mutate(bytes, (v, c) => v.setUint32(c + 24, 10000, true)),
      100,
    ),
    /大きすぎ/,
  );
});
test('invalid JSON and broken review references are refused in both formats', async () => {
  const invalid = workspace();
  invalid.files[0].items[0].slotIds = ['missing'];
  for (const text of ['{', JSON.stringify(invalid)]) {
    await assert.rejects(readBackup(new Blob([text])));
    await assert.rejects(readBackup(zip(text)));
  }
});
