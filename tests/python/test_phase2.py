import unittest
from pathlib import Path
from collections import Counter
from review_parser import pair_file, decode
from woditor_translation_tool import file_type

ROOT = Path('.reference')


@unittest.skipUnless(ROOT.exists(), 'Private corpus is not installed')
class PairTests(unittest.TestCase):
    def pair(self, path):
        return pair_file(path, (ROOT/'ja-JP/texts'/path).read_bytes(), (ROOT/'en-US/texts'/path).read_bytes())

    def test_all_real_pairs_safe_or_explicit_error(self):
        passed, rejected = Counter(), Counter()
        for f in (ROOT/'ja-JP/texts').rglob('*.txt'):
            path = f.relative_to(ROOT/'ja-JP/texts').as_posix()
            try:
                kind = file_type(decode(f.read_bytes())[0])
            except ValueError:
                continue
            try:
                data = self.pair(path)
            except ValueError as error:
                self.assertTrue(str(error))
                rejected[kind] += 1
                continue
            passed[kind] += 1
            ids = [sid for item in data['items'] for sid in item['slotIds']]
            self.assertEqual(ids, [s['id'] for s in data['slots']])
            self.assertEqual(len(ids), len(set(ids)))
            self.assertTrue(all(not i['approved'] for i in data['items']))
        self.assertEqual(sum(passed.values()) + sum(rejected.values()), 328)
        self.assertGreater(passed['common'], 100)
        self.assertGreater(passed['database'], 40)
        self.assertGreater(passed['map'], 20)
        print(f'\nReal corpus: paired={dict(passed)}, rejected={dict(rejected)}')

    def test_actual_english_and_comment_group(self):
        d = self.pair('MapData/SampleMapA/Event_0000.txt')
        self.assertTrue(any('Yuichi' in s['translation'] for s in d['slots']))
        grouped = [i for i in d['items'] if len(i['slotIds']) > 1]
        self.assertTrue(grouped)
        self.assertTrue(all(i['code'] == 103 for i in grouped))
        self.assertEqual(d['commands'][0]['code'], 101)
        self.assertTrue(d['commands'][0]['en'].startswith('■Show Message'))

    def test_inconsistent_real_file_refused(self):
        with self.assertRaisesRegex(ValueError, '一致しません'):
            self.pair('MapData/SampleMapA/Event_0009.txt')

    def test_structure_and_slot_position(self):
        path = 'MapData/SampleMapA/Event_0000.txt'
        ja = (ROOT/'ja-JP/texts'/path).read_bytes()
        en = (ROOT/'en-US/texts'/path).read_bytes()
        with self.assertRaises(ValueError):
            pair_file(path, ja, en.replace(b'[101][0,1]', b'[106][0,1]', 1))

    def test_direct_self_usage(self):
        d = self.pair('BasicData/CommonEvent/003.txt')
        self.assertTrue(any(len(hits) > 1 for hits in d['usages'].values()))


if __name__ == '__main__':
    unittest.main()
