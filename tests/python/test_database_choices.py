import unittest

from review_adapter import extract_source, pair_file, render_file


def database(mode, names=(), values=None, declared=None, duplicate=False):
    lines=['TYPE_ID=0','ITEM_NUM=1','ITEMNAME0=項目','MEMO=説明']
    if mode is not None:
        lines.append(f'ITEM_LOADTYPE_0={mode}')
    lines.append(f'CHOICE_NAME_0_NUM={len(names) if declared is None else declared}')
    lines.extend(f'CHOICE_NAME_0_{0 if duplicate else index}={name}' for index,name in enumerate(names))
    values=list(values) if values is not None else ['1']*len(names)
    lines.append(f'CHOICE_VAL_0_NUM={len(values)}')
    lines.extend(f'CHOICE_VAL_0_{index}={value}' for index,value in enumerate(values))
    return '\n'.join(lines)+'\n'


class DatabaseChoicePolicyTests(unittest.TestCase):
    def pair(self, ja, en):
        data=pair_file('db.txt',ja.encode(),en.encode())
        self.assertEqual(render_file(en,data['slots'])['text'],en)
        self.assertTrue(any(slot['key']=='MEMO' for slot in data['slots']))
        return data

    def choices(self,data):
        return [slot for slot in data['slots'] if slot['key'].startswith('CHOICE_NAME_')]

    def test_mode_two_reference_labels_are_reviewed_even_with_positive_choice_values(self):
        data=self.pair(database(2,['対象なし','親の設定','直前の設定'],['1','7','1']),
                       database(2,['None','Parent setting','Previous setting'],['1','7','1']))
        self.assertFalse(data['errors'])
        self.assertEqual([slot['source'] for slot in self.choices(data)],['対象なし','親の設定','直前の設定'])

    def test_mode_three_choices_are_normal_translation_items(self):
        data=self.pair(database(3,['はい','いいえ']),database(3,['Yes','No']))
        self.assertFalse(data['errors']);self.assertEqual(len(self.choices(data)),2)

    def test_direct_input_residue_ignores_names_counts_and_values_without_translation_errors(self):
        for mode in (None,0):
            with self.subTest(mode=mode):
                ja=database(mode,['残存名','別の残存名'],['10','20'],declared=5,duplicate=True)
                en=database(mode,['Other'],['77'],declared=7)
                data=self.pair(ja,en)
                self.assertFalse(data['errors']);self.assertFalse(self.choices(data))
                self.assertEqual(sum(w.startswith('未使用の選択肢設定を無視しました') for w in data['warnings']),2)
                self.assertFalse(any('翻訳項目' in warning or '設定値が' in warning or '対応する設定' in warning or 'だけの設定' in warning for warning in data['warnings']))

    def test_direct_input_empty_count_does_not_generate_ignore_notices(self):
        data=self.pair(database(0),database(0))
        self.assertFalse(data['errors']);self.assertFalse(any('選択肢名を無視' in warning for warning in data['warnings']))

    def test_unused_settings_counts_include_values_and_count_resets_per_language(self):
        data=self.pair(database(0,['名0','名1']),database(0,['Name0','Name1','Name2']))
        self.assertTrue(any('（日本語、行 ' in w and w.endswith(': 6件') for w in data['warnings']));self.assertTrue(any('（英語、行 ' in w and w.endswith(': 8件') for w in data['warnings']))
        self.assertFalse(data['errors'])

    def test_folder_paths_are_configuration_and_language_differences_warn(self):
        ja,en=database(1,['素材/画像']),database(1,['Assets/Images'])
        self.assertFalse(any(slot['key'].startswith('CHOICE_NAME_') for slot in extract_source(ja)['slots']))
        data=self.pair(ja,en)
        self.assertFalse(data['errors']);self.assertFalse(self.choices(data))
        self.assertIn('ファイル読み込みの既定フォルダパスが日英で異なります: 1件',data['warnings'])
        self.assertFalse(any('翻訳項目' in warning for warning in data['warnings']))

    def test_empty_folder_entries_are_counted_on_both_sides(self):
        data=self.pair(database(1,['',''],declared=0),database(1,['',''],declared=0))
        self.assertEqual(len(data['errors']),2);self.assertTrue(any(error.startswith('日本語') for error in data['errors']));self.assertTrue(any(error.startswith('英語') for error in data['errors']))
        self.assertFalse(self.choices(data));self.assertFalse(any(slot.get('sourceMissing') for slot in data['slots']))

    def test_declared_multiple_folder_paths_are_errors_even_if_actual_entries_are_missing(self):
        data=self.pair(database(1,[],declared=2),database(1,['Images'],declared=1))
        self.assertEqual(len(data['errors']),1);self.assertTrue(data['errors'][0].startswith('日本語'))
        data=self.pair(database(1,['画像'],declared=1),database(1,[],declared=2))
        self.assertEqual(len(data['errors']),1);self.assertTrue(data['errors'][0].startswith('英語'))

    def test_duplicate_folder_entries_do_not_become_ambiguous_translation_items(self):
        data=self.pair(database(1,['一つ目','二つ目'],declared=1,duplicate=True),database(1,['Images'],declared=1))
        self.assertEqual(len(data['errors']),1);self.assertFalse(self.choices(data));self.assertFalse(any(slot.get('sourceMissing') for slot in data['slots']))

    def test_each_languages_mode_prevents_folder_and_residual_values_from_becoming_translations(self):
        for source_mode,target_mode in ((1,3),(0,3),(3,1),(3,0)):
            with self.subTest(source_mode=source_mode,target_mode=target_mode):
                data=self.pair(database(source_mode,['原文側の値']),database(target_mode,['English value']))
                self.assertFalse(self.choices(data));self.assertFalse(data['errors'])
                self.assertFalse(any('既定フォルダパスが日英で異なります' in warning for warning in data['warnings']))
                expected='英語版だけの翻訳項目があります: 1件' if target_mode==3 else '英語版で使用対象外になった翻訳項目: 1件'
                self.assertIn(expected,data['warnings'])
