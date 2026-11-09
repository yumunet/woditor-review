import unittest
from pathlib import Path
from review_parser import pair_file, render_file, decode
from woditor_translation_tool import command_display_pairs, COMMAND, fields, META

ROOT = Path('.reference')


@unittest.skipUnless((ROOT / 'ja-JP/texts').exists(), 'Private corpus not installed')
class AlignmentTests(unittest.TestCase):
    def pair(self, path):
        ja = (ROOT / 'ja-JP/texts' / path).read_bytes()
        en = (ROOT / 'en-US/texts' / path).read_bytes()
        return pair_file(path, ja, en)

    def test_deleted_database_settings_and_shifted_metadata(self):
        data = self.pair('BasicData/CDataBase/04.txt')
        self.assertFalse(data['errors'])
        self.assertTrue(any('無効化' in w for w in data['warnings']))
        self.assertFalse(any(s['key'].startswith('CHOICE_NAME_') for s in data['slots']))
        self.assertTrue(any(s['key'] == 'ITEMNAME0' and 'Rate' in s['translation'] for s in data['slots']))
        shifted = self.pair('BasicData/CDataBase/01.txt')
        self.assertTrue(any(s['enLine'] != s['line'] for s in shifted['slots']))

    def test_removed_common_argument_choices_keep_later_slots(self):
        data = self.pair('BasicData/CommonEvent/014.txt')
        self.assertFalse(data['errors'])
        self.assertTrue(any(s['key'].startswith('CHOICE_STR_1_') and '無効化' in s['reason'] for s in data['excluded']))
        self.assertTrue(any(s['key'].startswith('CSELF_NAME_') for s in data['slots']))
        for slot in data['slots']:
            line = data['enText'].splitlines()[slot['enLine'] - 1]
            if slot['kind'] == 'metadata':
                self.assertEqual(META.fullmatch(line)[1], slot['key'])
                self.assertEqual(META.fullmatch(line)[2], slot['translation'])

    def test_english_only_comment_and_command_preserved_on_export(self):
        data = self.pair('MapData/SampleMapA/Event_0023.txt')
        self.assertFalse(data['errors'])
        added = [c for c in data['commands'] if c['line'] < 0]
        self.assertEqual([c['code'] for c in added], [103, 121])
        self.assertEqual(added[0]['ja'], '')
        self.assertIn('English version', added[0]['en'])
        self.assertEqual(render_file(data['enText'], data['slots'])['text'], data['enText'])
        slot = next(s for s in data['slots'] if s['command'] and s['command']['code'] == 101)
        self.assertNotEqual(slot['line'], slot['enLine'])
        slot['translation'] = 'Revised witch message'
        updated = render_file(data['enText'], data['slots'])['text']
        self.assertIn('[101][0,1]<0>()("Revised witch message")', updated)
        self.assertIn('Since this is the English version', updated)
        marker = '[COMMAND_TEXT_START]'
        self.assertEqual(updated.split(marker)[1], data['enText'].split(marker)[1])

    def test_changed_numeric_parameters_warn_without_losing_db_text(self):
        data = self.pair('BasicData/CommonEvent/074.txt')
        self.assertFalse(data['errors'])
        self.assertTrue(any('コマンド引数の差' in w for w in data['warnings']))
        self.assertTrue(any(s['command'] and s['command']['code'] == 250 and 'Learned' in s['translation'] for s in data['slots']))

    def test_every_real_accepted_slot_matches_its_english_field(self):
        for path in (ROOT / 'ja-JP/texts').rglob('*.txt'):
            relative = path.relative_to(ROOT / 'ja-JP/texts')
            try:
                data = self.pair(relative)
            except ValueError:
                continue
            lines = data['enText'].splitlines()
            mapped = set()
            for slot in data['slots']:
                line = lines[slot['enLine'] - 1]
                position = (slot['enLine'], slot['key'])
                self.assertNotIn(position, mapped)
                mapped.add(position)
                if slot['kind'] == 'metadata':
                    value = META.fullmatch(line)[2]
                else:
                    match = COMMAND.fullmatch(line)
                    a, b = fields(match['args'])[slot['position'] - 1]
                    value = match['args'][a:b]
                self.assertEqual(value, slot['translation'])

    def test_ambiguous_duplicate_commands_are_not_guessed_and_file_still_loads(self):
        path = 'MapData/SampleMapA/Event_0000.txt'
        ja = (ROOT / 'ja-JP/texts' / path).read_bytes()
        en = decode((ROOT / 'en-US/texts' / path).read_bytes())[0]
        lines = en.splitlines(keepends=True)
        raw, display, _ = command_display_pairs(en)[0]
        newline = '\r\n' if lines[raw - 1].endswith('\r\n') else '\n'
        lines.insert(display - 1, '■Show Message: Additional English message' + newline)
        lines.insert(raw - 1, '[101][0,1]<0>()("Additional English message")' + newline)
        result = pair_file(path, ja, ''.join(lines).encode('utf-8'))
        self.assertTrue(result['errors'])
        self.assertTrue(result['items'])
        unpaired = [s for s in result['slots'] if s.get('sourceMissing')]
        self.assertTrue(any(s['translation'] == 'Additional English message' for s in unpaired))
        self.assertTrue(all(s['source'] == '' for s in unpaired))
        self.assertEqual(render_file(result['enText'],result['slots'])['text'],result['enText'])

    def test_different_event_identity_remains_an_error(self):
        path = 'MapData/SampleMapA/Event_0000.txt'
        ja = (ROOT / 'ja-JP/texts' / path).read_bytes()
        en = (ROOT / 'en-US/texts' / path).read_bytes()
        with self.assertRaisesRegex(ValueError, 'EVENT_ID'):
            pair_file(path, ja, en.replace(b'EVENT_ID=0', b'EVENT_ID=99', 1))
