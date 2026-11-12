import unittest
from fixtures import PAIRS, text, pair
from review_adapter import pair_file, render_file
from woditor_parser import COMMAND, META, fields, catalog


class AlignmentTests(unittest.TestCase):
    def test_unused_settings_and_removed_arguments_keep_later_translations(self):
        for name, key in [('unused', 'ITEMNAME0'), ('removed', 'CSELF_NAME_0')]:
            data = pair(name)
            with self.subTest(name=name):
                self.assertFalse(data['errors'])
                self.assertTrue(any('未使用の選択肢設定を無視しました' in w for w in data['warnings']))
                self.assertFalse(any(s['key'].startswith(('CHOICE_NAME_', 'CHOICE_STR_')) for s in data['slots']))
                self.assertTrue(any(s['key'] == key for s in data['slots']))
                self.assertTrue(any(s['enLine'] != s['line'] for s in data['slots']))

    def test_english_only_commands_and_shifted_edits_preserve_untouched_sections(self):
        data = pair('shifted')
        self.assertFalse(data['errors'])
        added = [c for c in data['commands'] if c['line'] < 0]
        self.assertEqual([c['code'] for c in added], [103, 121])
        self.assertEqual(added[0]['ja'], '')
        slot = next(s for s in data['slots'] if s['command'] and s['command']['code'] == 101)
        self.assertNotEqual(slot['line'], slot['enLine'])
        slot['translation'] = 'Revised message'
        output = render_file(data['enText'], data['slots'])['text']
        self.assertIn('[101][0,1]<0>()("Revised message")', output)
        self.assertIn('English-only note', output)
        self.assertEqual(output.split('[COMMAND_TEXT_START]')[1], data['enText'].split('[COMMAND_TEXT_START]')[1])

    def test_pairs_have_unique_slots_exact_english_positions_and_lossless_noop_output(self):
        for name in PAIRS:
            data = pair(name)
            with self.subTest(name=name):
                ids = [sid for item in data['items'] for sid in item['slotIds']]
                self.assertEqual(ids, [s['id'] for s in data['slots']])
                self.assertEqual(len(ids), len(set(ids)))
                self.assertTrue(all(not item['approved'] for item in data['items']))
                lines = data['enText'].splitlines()
                csv = catalog(data['enText'])['fields'] if '<<--CSV_START-->>' in data['enText'] else {}
                positions = set()
                for slot in data['slots']:
                    position = (slot['enLine'], slot['key'])
                    self.assertNotIn(position, positions); positions.add(position)
                    if slot['kind'] == 'database_csv':
                        value = csv[slot['key']]['value']
                    elif slot['kind'] == 'metadata':
                        value = META.fullmatch(lines[slot['enLine'] - 1])[2]
                    else:
                        command = COMMAND.fullmatch(lines[slot['enLine'] - 1])
                        start, end = fields(command['args'])[slot['position'] - 1]
                        value = command['args'][start:end]
                    self.assertEqual(value, slot['translation'])
                self.assertEqual(render_file(data['enText'], data['slots'])['text'], data['enText'])

    def test_legacy_arguments_comments_grouping_and_multiple_variable_usages(self):
        legacy = pair('legacy')
        self.assertFalse(legacy['errors'])
        self.assertTrue(any('引数形式の違いを吸収' in w for w in legacy['warnings']))
        data = pair('common')
        grouped = [i for i in data['items'] if len(i['slotIds']) > 1]
        self.assertEqual(len(grouped), 1)
        self.assertEqual(grouped[0]['code'], 103)
        self.assertTrue(any(len(hits) == 2 for hits in data['usages'].values()))

    def test_ambiguous_commands_preserve_unpaired_english_without_guessing_originals(self):
        data = pair('ambiguous')
        self.assertTrue(data['errors'])
        self.assertTrue(data['items'])
        unpaired = [s for s in data['slots'] if s.get('sourceMissing')]
        self.assertEqual({s['translation'] for s in unpaired}, {'Hello, Hero.', 'Unpaired English'})
        self.assertTrue(all(s['source'] == '' for s in unpaired))

    def test_identity_and_display_corruption_fail_while_changed_commands_are_not_mispaired(self):
        source, english = text('map', 'ja'), text('map', 'en')
        for broken in [english.replace('EVENT_ID=0', 'EVENT_ID=99'), english.replace('[COMMAND_TEXT_END]', '')]:
            with self.subTest(broken=broken), self.assertRaises(ValueError):
                pair_file(PAIRS['map']['path'], source.encode(), broken.encode())
        changed = pair_file(PAIRS['map']['path'], source.encode(), english.replace('[101][0,1]', '[106][0,1]', 1).encode())
        # A uniquely removed/added command is warned about, not guessed from its
        # text. Ambiguous candidates are tested separately above.
        self.assertTrue(changed['warnings'])
        self.assertFalse(any(s['command'] and s['command']['code'] == 101 and s['translation'] == 'Hello, Hero.' for s in changed['slots']))
