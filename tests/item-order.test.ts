import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orderedItems } from '../src/item-order';
import { itemRows } from '../src/item-picker';
import type { Item, ReviewFile, Slot } from '../src/model';

function fixture(): ReviewFile {
  const keys = [
    'MEMO',
    'CSV_D0_ITEM0',
    'CSV_D0_ITEM1',
    'CSV_D0_NAME',
    'CSV_D1_ITEM0',
    'CSV_D1_NAME',
    'CSV_D2_ITEM0',
    'CSV_D3_NAME',
    'ITEMNAME0',
  ];
  const slots = keys.map(
    (key, index) =>
      ({
        id: key,
        key,
        kind: key.startsWith('CSV_') ? 'database_csv' : 'metadata',
        source: 'Source ' + index,
        translation: 'English ' + index,
        command: null,
      }) as Slot,
  );
  const items = slots.map(
    (slot) =>
      ({
        id: slot.id,
        slotIds: [slot.id],
        title: slot.id,
        approved: false,
        threads: [],
        changes: [],
      }) as unknown as Item,
  );
  return { type: 'database', slots, items } as ReviewFile;
}

test('database names precede only their own row settings while other order and stored data remain intact', () => {
  const file = fixture(),
    original = structuredClone(file);
  const ordered = orderedItems(file);
  assert.deepEqual(
    ordered.map((item) => item.id),
    [
      'MEMO',
      'CSV_D0_NAME',
      'CSV_D0_ITEM0',
      'CSV_D0_ITEM1',
      'CSV_D1_NAME',
      'CSV_D1_ITEM0',
      'CSV_D2_ITEM0',
      'CSV_D3_NAME',
      'ITEMNAME0',
    ],
  );
  assert.deepEqual(file, original);
  assert.equal(ordered[1], file.items[3]);
  const html = itemRows(file, file.items, null, '');
  assert.ok(html.indexOf('data-value="CSV_D0_NAME"') < html.indexOf('data-value="CSV_D0_ITEM0"'));
});

test('filtered lists never reintroduce a hidden data name and standalone names remain usable', () => {
  const file = fixture(),
    subset = file.items.filter((item) => !['CSV_D0_NAME', 'CSV_D1_ITEM0'].includes(item.id));
  assert.deepEqual(
    orderedItems(file, subset).map((item) => item.id),
    subset.map((item) => item.id),
  );
  assert.deepEqual(orderedItems(file, [file.items[3]]), [file.items[3]]);
});

test('data rows retain their original order and descriptors support opaque saved slot IDs', () => {
  const reversed = fixture(),
    subset = [reversed.items[4], reversed.items[5], reversed.items[1], reversed.items[3]];
  assert.deepEqual(
    orderedItems(reversed, subset).map((item) => item.id),
    ['CSV_D1_NAME', 'CSV_D1_ITEM0', 'CSV_D0_NAME', 'CSV_D0_ITEM0'],
  );
  const file = fixture();
  file.slots = file.slots.slice(1, 4);
  file.items = file.items.slice(1, 4);
  file.slots.forEach((slot, index) => {
    slot.id = 'opaque-' + index;
    slot.key = 'saved-key';
    slot.csv = { row: 10, item: index === 2 ? null : index, dataName: index === 2 };
    file.items[index].slotIds = [slot.id];
  });
  assert.deepEqual(
    orderedItems(file).map((item) => item.id),
    ['CSV_D0_NAME', 'CSV_D0_ITEM0', 'CSV_D0_ITEM1'],
  );
  file.type = 'common';
  assert.equal(orderedItems(file), file.items);
});
