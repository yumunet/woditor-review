import unittest
from pathlib import Path

from review_parser import decode, extract_source, command_info, slot_policy, metadata_title
from woditor_translation_tool import analyze, file_type

ROOT = Path('.reference/ja-JP/texts')


class MetadataTitleTests(unittest.TestCase):
    def test_self_variable_names_use_the_actual_zero_based_index(self):
        self.assertEqual(metadata_title('CSELF_NAME_0'), 'セルフ変数名 0')
        self.assertEqual(metadata_title('CSELF_NAME_99'), 'セルフ変数名 99')
        self.assertEqual(metadata_title('VALINPUT_NAME_0'), '数値引数名 1')
        self.assertEqual(metadata_title('ITEMNAME0'), '項目名 0')
        self.assertEqual(metadata_title('ITEMNAME37'), '項目名 37')

    def test_database_choice_field_numbers_start_at_zero_while_choices_keep_their_ordinals(self):
        self.assertEqual(metadata_title('CHOICE_NAME_0_0'), '選択肢名 0-1')
        self.assertEqual(metadata_title('CHOICE_NAME_12_2'), '選択肢名 12-3')
        self.assertEqual(metadata_title('CHOICE_STR_0_0'), '選択肢 1-1')


@unittest.skipUnless(ROOT.exists(), 'Private reference corpus is not installed')
class SourceCorpusTests(unittest.TestCase):
    def test_all_real_source_files(self):
        counts = {'common': 0, 'database': 0, 'map': 0}
        slots = 0
        for f in ROOT.rglob('*.txt'):
            text, _ = decode(f.read_bytes())
            try:
                kind = file_type(text)
            except ValueError:
                continue
            with self.subTest(file=str(f)):
                counts[kind] += 1
                original, unhandled = analyze(text, kind)
                result = extract_source(text)
                self.assertFalse(unhandled)
                self.assertEqual(len(original), len(result['slots']) + len(result['excluded']))
                for s in result['slots']:
                    self.assertEqual(text[s['start']:s['end']], s['source'])
                slots += len(original)
        self.assertEqual(counts, {'common': 225, 'database': 66, 'map': 37})
        self.assertEqual(slots, 23719)

    def test_real_database_csv_excluded(self):
        text, _ = decode((ROOT / 'BasicData/DataBase/00.txt').read_bytes())
        result = extract_source(text)
        self.assertTrue(any(s['key'] == 'TYPENAME' for s in result['slots']))
        self.assertTrue(all(s['start'] < text.index('<<--CSV_START-->>') for s in result['slots']))

    def test_real_comment_and_name_reference(self):
        text, _ = decode((ROOT / 'BasicData/CommonEvent/000.txt').read_bytes())
        r = extract_source(text)
        self.assertTrue(any(s['command'] and s['command']['code'] == 103 for s in r['slots']))
        self.assertTrue(any(s['command']['code'] == 250 and s['position'] == 2 for s in r['excluded']))
        self.assertTrue(any(s['command']['code'] == 300 for s in r['excluded']))

    def test_all_required_codes_against_real_commands(self):
        expected = {101: '文章の表示', 102: '選択肢', 103: 'コメント', 106: 'デバッグ文',
                    250: 'DB操作', 122: '文字列操作', 112: '条件分岐（文字列）',
                    150: 'ピクチャ', 212: 'ラベル', 213: 'ラベルジャンプ',
                    210: 'コモンイベント', 211: 'コモンイベント', 300: 'コモンイベント'}
        observed = set()
        branches = set()
        for path in ROOT.rglob('*.txt'):
            text, _ = decode(path.read_bytes())
            try:
                result = extract_source(text)
            except ValueError:
                continue
            lines = text.splitlines()
            for n, command in result['commands'].items():
                code = command['code']
                self.assertEqual(code, int(lines[n - 1].split(']')[0][1:]))
                if code in expected:
                    observed.add(code)
                    self.assertEqual(command['kind'], expected[code])
                if code == 401:
                    parent = command['parentCode']
                    branches.add(parent)
                    self.assertEqual(command['kind'], {102: '選択肢', 112: '条件分岐（文字列）'}.get(parent))
        self.assertEqual(observed, set(expected))
        self.assertTrue({102, 111, 112}.issubset(branches))


class CommandTests(unittest.TestCase):
    def test_first_bracket_is_code(self):
        info = command_info('[122][2,1]<2>(1600009,256)("test")')
        self.assertEqual(info['code'], 122)
        self.assertEqual(info['numbers'], [1600009, 256])
        self.assertTrue(slot_policy(info, 1)[0])

    def test_modes_and_positions(self):
        for code in (101, 102, 103, 106, 112, 212, 213, 210, 211, 300, 250):
            info = {'code': code, 'numbers': [], 'kind': 'test'}
            self.assertEqual(slot_policy(info, 1)[0], code != 300)
        self.assertFalse(slot_policy({'code': 122, 'numbers': [1, 1]}, 1)[0])
        self.assertTrue(slot_policy({'code': 150, 'numbers': [4128]}, 1)[0])
        self.assertFalse(slot_policy({'code': 150, 'numbers': [0]}, 1)[0])
        for position in (2, 3, 4):
            self.assertFalse(slot_policy({'code': 250, 'numbers': []}, position)[0])
        self.assertTrue(slot_policy({'code': 300, 'numbers': []}, 2)[0])

    def test_branch_requires_parent(self):
        raw = '[401][1,0]<0>(1)()'
        for parent, kind in ((112, '条件分岐（文字列）'), (102, '選択肢'), (111, None), (None, None)):
            info = command_info(raw, parent)
            self.assertEqual(info['kind'], kind)
            self.assertEqual(slot_policy(info, 1)[0], kind is not None)

    def test_utf8_strict_and_bom(self):
        self.assertEqual(decode(b'\xef\xbb\xbftext'), ('text', True))
        with self.assertRaises(UnicodeDecodeError):
            decode(b'\xff')


if __name__ == '__main__':
    unittest.main()
