import unittest
from review_parser import pair_file, render_file


class NotificationTests(unittest.TestCase):
    def pair(self, ja, en):
        def complete(text):
            if not text.startswith('COMMON_ID='):return text
            header,*commands=text.splitlines()
            return header+'\nWoditorEvCOMMAND_START\n'+''.join(c+'\n' for c in commands)+'WoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n'+''.join('表示\n' for c in commands)+'[COMMAND_TEXT_END]\n'
        ja,en=complete(ja),complete(en)
        data=pair_file('test.txt',ja.encode(),en.encode())
        self.assertEqual(render_file(en,data['slots'])['text'],en)
        return data

    def test_missing_metadata_counts_translation_items_and_settings_separately(self):
        ja=('TYPE_ID=0\nITEM_NUM=1\nITEMNAME0=項目\nCHOICE_NAME_0_NUM=3\n'
            'CHOICE_NAME_0_0=選択肢\nCHOICE_NAME_0_1=別の選択肢\nCHOICE_NAME_0_2=\nMEMO=メモ\nEXTRA_SETTING=7\n')
        en='TYPE_ID=0\nITEM_NUM=1\nITEMNAME0=Item\nCHOICE_NAME_0_NUM=0\n'
        data=self.pair(ja,en);self.assertFalse(data['errors'])
        for message in ['英語版で使用対象外になった翻訳項目: 2件','英語版で使用対象外になった設定: 1件',
                        '英語版に対応する翻訳項目がありません: 1件','英語版に対応する設定がありません: 1件',
                        '翻訳対象外の設定値が日英で異なります: 1件']:
            self.assertIn(message,data['warnings'])
        self.assertEqual(len(data['excluded']),3)

    def test_missing_command_counts_each_translatable_string_instead_of_commands(self):
        data=self.pair('COMMON_ID=0\n[102][0,2]<0>()("一つ目","二つ目")\n','COMMON_ID=0\n')
        self.assertFalse(data['errors']);self.assertIn('英語版に対応する翻訳項目がありません: 2件',data['warnings'])
        data=self.pair('COMMON_ID=0\n[121][0,0]<0>()()\n','COMMON_ID=0\n')
        self.assertFalse(data['errors']);self.assertIn('英語版に対応するコマンドがありません: 1件',data['warnings'])

    def test_added_metadata_is_not_a_mixed_setting_total(self):
        data=self.pair('TYPE_ID=0\n','TYPE_ID=0\nMEMO=English memo\nEXTRA_SETTING=1\n')
        self.assertIn('英語版だけの翻訳項目があります: 1件',data['warnings'])
        self.assertIn('英語版だけの設定があります: 1件',data['warnings'])

    def test_legacy_format_absorption_is_distinct_from_changed_command_arguments(self):
        data=self.pair('COMMON_ID=0\n[122][2,1]<0>(1,0)("文字列")\n',
                       'COMMON_ID=0\n[122][3,1]<0>(1,0,0)("Text")\n')
        self.assertIn('旧形式の文字列操作の引数形式の違いを吸収: 1件',data['warnings'])
        self.assertNotIn('コマンド引数が日英で異なります: 1件',data['warnings'])
        data=self.pair('COMMON_ID=0\n[101][1,1]<0>(1)("文章")\n','COMMON_ID=0\n[101][1,1]<0>(2)("Text")\n')
        self.assertFalse(data['errors']);self.assertIn('コマンド引数が日英で異なります: 1件',data['warnings'])

    def test_csv_numeric_differences_are_reported_without_changing_the_english_value(self):
        ja='TYPE_ID=0\nITEM_NUM=1\n<<--CSV_START-->>\n"数",\n"データ",123,\n<<--CSV_END-->>\n'
        en=ja.replace('"データ",123','"Data",456')
        data=self.pair(ja,en)
        self.assertIn('翻訳対象外の設定値が日英で異なります（CSVの数値・非文字列）: 1件',data['warnings'])
