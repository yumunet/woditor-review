import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  databaseFieldOriginal,
  commonArgumentOriginal,
  databaseContextView,
} from '../src/database-context';
import { metadataHeader, metadataContextText, metadataItem } from '../src/metadata-text';
import type { ReviewFile, Item } from '../src/model';

const item = { id: 'a', slotIds: ['s'] } as Item;
const file = (key: string, kind = 'metadata') =>
  ({
    type: 'database',
    jaText:
      'TYPE_ID=0\r\nITEM_LOADTYPE_0=3\r\nITEMNAME0=日本語の説明\r\nITEMNAME1=ASCII source\r\nITEMNAME2=\r\n<<--CSV_START-->>\r\n"複数行\r\nITEMNAME3=セル内の文字列\r\n"\r\n',
    enText:
      'TYPE_ID=0\r\nITEM_LOADTYPE_0=3\r\nITEMNAME0=Description\r\nITEMNAME1=ASCII translation\r\nITEMNAME2=\r\n<<--CSV_START-->>\r\n"Multiple lines\r\nITEMNAME3=Not a header\r\n"\r\n',
    items: [] as Item[],
    slots: [{ id: 's', key, kind }],
  }) as ReviewFile;
test('choices and CSV settings identify their zero-based field and use original header names', () => {
  assert.deepEqual(databaseFieldOriginal(file('CHOICE_NAME_0_17'), item), {
    index: 0,
    source: '日本語の説明',
    translation: 'Description',
  });
  assert.deepEqual(databaseFieldOriginal(file('CSV_D10_ITEM1', 'database_csv'), item), {
    index: 1,
    source: 'ASCII source',
    translation: 'ASCII translation',
  });
  assert.deepEqual(databaseFieldOriginal(file('CSV_D0_ITEM2', 'database_csv'), item), {
    index: 2,
    source: '',
    translation: '',
  });
  assert.deepEqual(databaseFieldOriginal(file('CSV_D0_ITEM3', 'database_csv'), item), {
    index: 3,
    source: null,
    translation: null,
  });
});
test('data names, unrelated metadata and commands have no field context', () => {
  for (const [key, kind] of [
    ['CSV_D0_NAME', 'database_csv'],
    ['ITEMNAME0', 'metadata'],
    ['MEMO', 'metadata'],
    ['S1', 'command_string'],
  ])
    assert.equal(databaseFieldOriginal(file(key, kind), item), null);
  assert.equal(databaseFieldOriginal({ ...file('CHOICE_NAME_0_0'), type: 'common' }, item), null);
});
test('the collapsible field original is escaped and distinguishes missing and empty names', () => {
  const db = file('CSV_D0_ITEM0', 'database_csv');
  db.jaText = 'ITEMNAME0=<script>\n';
  const html = databaseContextView(db, item, true);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('項目名 0'));
  assert.ok(!html.includes('<script>'));
  assert.ok(!databaseContextView(db, item, false).includes('class="text-box'));
  assert.ok(databaseContextView(db, item, false).includes('aria-expanded="false"'));
  assert.ok(
    databaseContextView(file('CSV_D0_ITEM2', 'database_csv'), item, true).includes(
      '項目名は未設定',
    ),
  );
  assert.ok(
    databaseContextView(file('CSV_D0_ITEM3', 'database_csv'), item, true).includes(
      '対応する項目名がありません',
    ),
  );
  assert.ok(html.includes('対応する項目</button>') || html.includes('>対応する項目<span'));
  assert.ok(!html.includes('context-field-label'));
  assert.equal((html.match(/class="context-language"/g) ?? []).length, 2);
  assert.ok(html.includes('class="label">原文</div>'));
  assert.ok(html.includes('class="label">英訳</div>'));
  assert.ok(html.includes('database-translation'));
});

const common = (key: string) =>
  ({
    type: 'common',
    jaText:
      'COMMON_ID=0\r\nLOADTYPE0=2\r\nLOADTYPE1=2\r\nLOADTYPE2=2\r\nLOADTYPE4=2\r\nVALINPUT_NAME_0=呼び出すメニュー\r\nVALINPUT_NAME_1=\r\nVALINPUT_NAME_4=ASCII argument\r\nSTRINPUT_NAME_0=別の文字列引数\r\nWoditorEvCOMMAND_START\r\nVALINPUT_NAME_2=本文中の偽設定\r\n',
    enText:
      'COMMON_ID=0\r\nLOADTYPE0=2\r\nLOADTYPE1=2\r\nLOADTYPE2=2\r\nLOADTYPE4=2\r\nVALINPUT_NAME_0=Menu to open\r\nVALINPUT_NAME_1=\r\nVALINPUT_NAME_4=ASCII translation\r\nWoditorEvCOMMAND_START\r\nVALINPUT_NAME_2=Not a header\r\n',
    items: [] as Item[],
    slots: [{ id: 's', key, kind: 'metadata' }],
  }) as ReviewFile;

test('common argument choices use the numeric argument group and original header, including ASCII names', () => {
  assert.deepEqual(commonArgumentOriginal(common('CHOICE_STR_0_8'), item), {
    index: 0,
    source: '呼び出すメニュー',
    translation: 'Menu to open',
  });
  assert.deepEqual(commonArgumentOriginal(common('CHOICE_STR_4_0'), item), {
    index: 4,
    source: 'ASCII argument',
    translation: 'ASCII translation',
  });
  assert.deepEqual(commonArgumentOriginal(common('CHOICE_STR_1_0'), item), {
    index: 1,
    source: '',
    translation: '',
  });
  assert.deepEqual(commonArgumentOriginal(common('CHOICE_STR_2_0'), item), {
    index: 2,
    source: null,
    translation: null,
  });
});

test('common argument lookup ignores command bodies and applies only to common argument choices', () => {
  for (const boundary of [
    'WoditorEvCOMMAND_START',
    '[COMMAND_TEXT_START]',
    '[103][0,1]<0>()("comment")',
  ]) {
    const data = common('CHOICE_STR_2_0');
    data.jaText = `COMMON_ID=0\n${boundary}\nVALINPUT_NAME_2=Not a header\n`;
    assert.deepEqual(commonArgumentOriginal(data, item), {
      index: 2,
      source: null,
      translation: null,
    });
  }
  for (const key of ['VALINPUT_NAME_0', 'STRINPUT_NAME_0', 'CHOICE_NAME_0_0', 'S1'])
    assert.equal(commonArgumentOriginal(common(key), item), null);
  assert.equal(commonArgumentOriginal({ ...common('CHOICE_STR_0_0'), type: 'map' }, item), null);
});

test('common argument context shares collapse controls and escapes bilingual text without duplicate argument captions', () => {
  const data = common('CHOICE_STR_0_0');
  data.jaText = 'COMMON_ID=0\nLOADTYPE0=2\nVALINPUT_NAME_0=<script>\n';
  const html = databaseContextView(data, item, true);
  assert.ok(html.includes('>対応する引数<span'));
  assert.ok(!html.includes('数値引数名 1'));
  assert.ok(!html.includes('context-field-label'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('Menu to open'));
  const closed = databaseContextView(data, item, false);
  assert.ok(closed.includes('aria-expanded="false"'));
  assert.ok(closed.includes('data-action="database-context"'));
  assert.ok(!closed.includes('class="text-box'));
  assert.ok(databaseContextView(common('CHOICE_STR_1_0'), item, true).includes('引数名は未設定'));
  assert.ok(
    databaseContextView(common('CHOICE_STR_2_0'), item, true).includes(
      '対応する引数名がありません',
    ),
  );
});

test('metadata context uses confirmed slots before stale TXT while preserving manual source, empty values and missing values', () => {
  const data = file('CHOICE_NAME_0_0');
  data.slots.push({
    id: 'field',
    kind: 'metadata',
    key: 'ITEMNAME0',
    sourceOverride: '補完した原文',
    translation: 'Latest confirmed translation',
  } as ReviewFile['slots'][number]);
  assert.deepEqual(metadataContextText(data, 'ITEMNAME0'), {
    source: '補完した原文',
    translation: 'Latest confirmed translation',
  });
  data.slots[1].translation = '';
  data.slots[1].sourceOverride = '';
  assert.deepEqual(metadataContextText(data, 'ITEMNAME0'), { source: '', translation: '' });
  assert.deepEqual(metadataContextText(data, 'ITEMNAME2'), { source: '', translation: '' });
  assert.deepEqual(metadataContextText(data, 'ITEMNAME3'), { source: null, translation: null });
});

test('context links resolve the item owning the exact metadata slot and leave header-only names unavailable', () => {
  const data = file('CHOICE_NAME_0_0');
  data.slots.push({
    id: 'field',
    kind: 'metadata',
    key: 'ITEMNAME0',
  } as ReviewFile['slots'][number]);
  const target = { id: 'field-item', slotIds: ['field'] } as Item;
  data.items = [target];
  assert.equal(metadataItem(data, 'ITEMNAME0'), target);
  assert.equal(metadataItem(data, 'ITEMNAME1'), undefined);
  assert.ok(databaseContextView(data, item, true).includes('data-value="field-item"'));
});

test('metadata header extraction respects every supported command boundary in both event formats', () => {
  const prefix = 'COMMON_ID=0\nVALINPUT_NAME_0=Header\n';
  for (const type of ['common', 'map'] as const)
    for (const boundary of [
      'WoditorEvCOMMAND_START',
      '[COMMAND_TEXT_START]',
      '[103][0,1]<0>()("comment")',
    ]) {
      assert.equal(
        metadataHeader(prefix + boundary + '\nVALINPUT_NAME_1=Not a header\n', type),
        prefix,
      );
    }
  assert.equal(
    metadataHeader('ITEMNAME0=Header\n<<--CSV_START-->>\nITEMNAME1=CSV data\n', 'database'),
    'ITEMNAME0=Header\n',
  );
});

test('saved database choice slots have no parent context when both languages use folders or inactive modes', () => {
  for (const mode of [undefined, '0', '1', '4', '-1', 'invalid']) {
    const data = file('CHOICE_NAME_0_0');
    const header =
      (mode === undefined ? '' : `ITEM_LOADTYPE_0=${mode}\n`) +
      'ITEMNAME0=Folder setting\nCHOICE_NAME_0_0=Folder/path\nCHOICE_NAME_0_1=Other/path\n';
    data.jaText = data.enText = header;
    assert.equal(databaseFieldOriginal(data, item), null);
    assert.equal(databaseContextView(data, item, true), '');
  }
});

test('choice parent context respects each language mode while CSV field context remains available', () => {
  const data = file('CHOICE_NAME_0_0');
  data.jaText = data.jaText.replace('ITEM_LOADTYPE_0=3', 'ITEM_LOADTYPE_0=1');
  assert.deepEqual(databaseFieldOriginal(data, item), {
    index: 0,
    source: null,
    translation: 'Description',
  });
  data.jaText = data.jaText.replace('ITEM_LOADTYPE_0=1', 'ITEM_LOADTYPE_0=2');
  data.enText = data.enText.replace('ITEM_LOADTYPE_0=3', 'ITEM_LOADTYPE_0=0');
  assert.deepEqual(databaseFieldOriginal(data, item), {
    index: 0,
    source: '日本語の説明',
    translation: null,
  });
  data.slots[0].key = 'CSV_D0_ITEM0';
  data.slots[0].kind = 'database_csv';
  data.jaText = data.jaText.replace('ITEM_LOADTYPE_0=2', 'ITEM_LOADTYPE_0=1');
  assert.deepEqual(databaseFieldOriginal(data, item), {
    index: 0,
    source: '日本語の説明',
    translation: 'Description',
  });
});
