import unittest
from review_parser import pair_file


class DatabaseMemoTests(unittest.TestCase):
    def test_memo_ignores_newline_warning_without_changing_the_encoded_value(self):
        ja = 'TYPE_ID=0\nMEMO=一行目<<\\n>>二行目\n'
        en = 'TYPE_ID=0\nMEMO=One line\n'
        file = pair_file('db.txt', ja.encode(), en.encode())
        memo = next(s for s in file['slots'] if s['key'] == 'MEMO')
        self.assertEqual(memo['source'], '一行目<<\\n>>二行目')
        self.assertNotIn('改行が異なります', memo['warnings'])
