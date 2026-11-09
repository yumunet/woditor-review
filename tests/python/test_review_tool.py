import copy
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from review_parser import pair_file, render_file, digest
from woditor_review_tool import build, validate, apply_files


@unittest.skipUnless(Path('.reference/ja-JP/texts').exists(), 'Private corpus not available')
class ReviewToolTests(unittest.TestCase):
    def setUp(self):
        self.path = 'MapData/SampleMapA/Event_0000.txt'
        self.raw = (Path('.reference/en-US/texts') / self.path).read_bytes()
        self.f = pair_file(self.path, (Path('.reference/ja-JP/texts') / self.path).read_bytes(), self.raw)
        s = self.f['slots'][0]
        self.request = {'schemaVersion': 1, 'requestId': 'request', 'createdAt': '2026-11-09', 'entries': [{
            'path': self.path, 'fileVersion': self.f['version'], 'itemId': self.f['items'][0]['id'],
            'slotIds': [s['id']], 'commentId': 'comment', 'posts': [], 'context': [],
            'slots': [{k: s[k] for k in ('id', 'source', 'translation', 'line', 'key', 'kind')}]}]}
        self.decisions = {'responses': [{'commentId': 'comment', 'decision': 'accepted', 'reason': 'Spelling', 'changes': [{'slotId': s['id'], 'before': s['translation'], 'after': 'Yuichi revised'}]}]}

    def test_build_and_validate(self):
        response = build(self.request, self.decisions)
        validate(self.request, response)
        self.assertEqual(response['responses'][0]['path'], self.path)
        for field in ('commentId', 'fileVersion', 'itemId'):
            broken = copy.deepcopy(response); broken['responses'][0][field] = 'wrong'
            with self.assertRaises(ValueError): validate(self.request, broken)
        response['responses'].append(response['responses'][0])
        with self.assertRaises(ValueError): validate(self.request, response)

    def test_pending_proposals_can_be_reassessed_without_applying_them(self):
        slot = self.request['entries'][0]['slots'][0]
        self.request['entries'][0]['pendingChanges'] = [{'id': 'old-change', 'slotId': slot['id'], 'before': slot['translation'], 'after': 'Withdrawn proposal'}]
        response = build(self.request, {'responses': [{'commentId': 'comment', 'decision': 'rejected', 'reason': 'Withdraw the previous proposal', 'changes': []}]})
        with TemporaryDirectory() as directory:
            out = Path(directory) / 'rejected'
            apply_files(self.request, response, Path('.reference/en-US/texts'), out)
            self.assertEqual((out / self.path).read_bytes(), self.raw)

    def test_render_preserves_original_and_protected_sections(self):
        self.f['slots'][0]['translation'] = 'Yuichi revised'
        rendered = render_file(self.f['enText'], self.f['slots'])
        self.assertIn('EVENT_NAME=Yuichi revised', rendered['text'])
        self.assertEqual(rendered['version'], digest(rendered['text']))
        marker = '[COMMAND_TEXT_START]'
        self.assertEqual(rendered['text'].split(marker)[1], self.f['enText'].split(marker)[1])
        self.assertEqual((Path('.reference/en-US/texts') / self.path).read_bytes(), self.raw)

    def test_apply_outputs_separate_file_and_refuses_overwrite(self):
        response = build(self.request, self.decisions)
        with TemporaryDirectory() as directory:
            out = Path(directory) / 'revised'
            apply_files(self.request, response, Path('.reference/en-US/texts'), out)
            self.assertIn(b'EVENT_NAME=Yuichi revised', (out / self.path).read_bytes())
            with self.assertRaises(ValueError): apply_files(self.request, response, Path('.reference/en-US/texts'), out)


if __name__ == '__main__': unittest.main()
