import { test } from 'node:test';
import assert from 'node:assert/strict';
import { displaySlotText } from '../src/display-text';
import type { Slot } from '../src/model';

test('display decoding is independent of storage and preserves the comment/metadata newline exceptions', () => {
  const raw = String.raw`一行目<\n><dqrt>二行目<dqrt><\n>`;
  for (const type of ['common', 'map'] as const)
    for (const code of [101, 102, 103, 122, 250, 300, 999]) {
      const slot = { command: { code }, source: raw } as Slot;
      const expected = code === 103 ? String.raw`一行目<\n>"二行目"<\n>` : '一行目\n"二行目"\n';
      assert.equal(displaySlotText({ type }, slot, raw), expected);
      assert.equal(slot.source, raw);
    }
  assert.equal(
    displaySlotText({ type: 'database' }, { key: 'OTHER', command: null } as Slot, raw),
    raw,
  );
});
