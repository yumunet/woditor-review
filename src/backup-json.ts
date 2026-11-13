import { backupTextLimit } from './storage';

// Model data is JSON-compatible. Escape bounded string pieces without splitting a pair.
function* stringTokens(value: string): Generator<string> {
  yield '"';
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + 4096, value.length);
    const last = value.charCodeAt(end - 1),
      next = value.charCodeAt(end);
    if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) end--;
    yield JSON.stringify(value.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}
function* tokens(value: unknown, parents: Set<object>): Generator<string> {
  if (typeof value === 'string') {
    if (value.length <= 4096) yield JSON.stringify(value);
    else yield* stringTokens(value);
    return;
  }
  if (value === null || typeof value !== 'object') {
    yield JSON.stringify(value) ?? 'null';
    return;
  }
  if (parents.has(value)) throw new TypeError('循環参照のあるデータはバックアップできません');
  parents.add(value);
  try {
    if (Array.isArray(value)) {
      yield '[';
      for (let index = 0; index < value.length; index++) {
        if (index) yield ',';
        yield* tokens(value[index], parents);
      }
      yield ']';
    } else {
      yield '{';
      let first = true;
      for (const key of Object.keys(value)) {
        const item = (value as Record<string, unknown>)[key];
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
        if (!first) yield ',';
        first = false;
        if (key.length <= 4096) yield JSON.stringify(key);
        else yield* stringTokens(key);
        yield ':';
        yield* tokens(item, parents);
      }
      yield '}';
    }
  } finally {
    parents.delete(value);
  }
}
/** Compact JSON bytes, at most 64KiB per owned, transferable buffer. */
export function* backupChunks(
  value: unknown,
  limit = backupTextLimit,
): Generator<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  let output = new Uint8Array(64 * 1024),
    used = 0,
    characters = 0;
  // Batch small punctuation/keys before encoding, without creating a full JSON string.
  function* fragments() {
    const pieces: string[] = [];
    let length = 0;
    for (const token of tokens(value, new Set())) {
      pieces.push(token);
      length += token.length;
      if (length >= 4096) {
        yield pieces.join('');
        pieces.length = 0;
        length = 0;
      }
    }
    if (length) yield pieces.join('');
  }
  for (const token of fragments()) {
    characters += token.length;
    if (characters > limit) throw new Error('バックアップが大きすぎます');
    for (let offset = 0; offset < token.length;) {
      const { read, written } = encoder.encodeInto(token.slice(offset), output.subarray(used));
      offset += read;
      used += written;
      // encodeInto leaves a UTF-8 character intact when the remaining space is too small.
      if (used === output.length || offset < token.length) {
        yield output.subarray(0, used);
        output = new Uint8Array(64 * 1024);
        used = 0;
      }
    }
  }
  if (used) yield output.subarray(0, used);
}
