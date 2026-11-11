import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from review_parser import pair_file,render_file
from database_csv import catalog,cell_for_key,masked_csv
from woditor_review_tool import build,apply_files


def fixture(name='名前', value='最初の行\r\n二行目'):
    return ('TYPE_ID=0\r\nITEM_NUM=2\r\nDATANAME_LOAD_TYPE=0\r\nITEMNAME0=説明\r\nITEMNAME1=数\r\n'
            '<<--CSV_START-->>\r\n"説明","数",\r\n'
            f'"{name}","{value.replace(chr(34),chr(34)*2)}",123,\r\n"次","",5,\r\n<<--CSV_END-->>\r\n')


class DatabaseMemoTests(unittest.TestCase):
    def test_memo_ignores_newline_warning_without_changing_the_encoded_value(self):
        ja = 'TYPE_ID=0\nMEMO=一行目<<\\n>>二行目\n'
        en = 'TYPE_ID=0\nMEMO=One line\n'
        file = pair_file('db.txt', ja.encode(), en.encode())
        memo = next(s for s in file['slots'] if s['key'] == 'MEMO')
        self.assertEqual(memo['source'], '一行目<<\\n>>二行目')
        self.assertNotIn('改行が異なります', memo['warnings'])


class DatabaseCsvTests(unittest.TestCase):
    def pair(self):
        return pair_file('db.txt',fixture().encode(),fixture('Name','First, "quoted"\r\nSecond').encode())

    def test_only_quoted_cells_are_reviewed_with_zero_based_data_and_field_indices(self):
        data=self.pair();cells=[s for s in data['slots'] if s['kind']=='database_csv']
        self.assertEqual([s['key'] for s in cells],['CSV_D0_NAME','CSV_D0_ITEM0','CSV_D1_NAME'])
        self.assertEqual(cells[0]['title'],'データ名 0');self.assertEqual(cells[1]['csv']['item'],0)
        self.assertEqual(cells[1]['translation'],'First, "quoted"\r\nSecond')
        self.assertEqual(cells[1]['source'],'最初の行\r\n二行目');self.assertFalse(data['errors'])
        self.assertEqual(render_file(data['enText'],data['slots'])['text'],data['enText'])

    def test_csv_quotes_and_multiline_edits_preserve_all_other_cells_and_refresh_locations(self):
        data=self.pair();slot=next(s for s in data['slots'] if s['key']=='CSV_D0_ITEM0');next_line=cell_for_key(data['enText'],'CSV_D1_NAME')['line']
        slot['translation']='Changed, "text"\r\nTwo\r\nThree'
        result=render_file(data['enText'],data['slots'])
        self.assertEqual(cell_for_key(result['text'],slot['key'])['value'],slot['translation'])
        self.assertEqual(result['csvLines']['CSV_D1_NAME'],next_line+1)
        self.assertEqual(masked_csv(data['enText'],catalog(data['enText'])),masked_csv(result['text'],catalog(result['text'])))
        self.assertEqual(render_file(result['text'],data['slots'])['text'],result['text'])
        with self.assertRaises(ValueError):render_file(data['enText'],[{**slot,'key':'CSV_D0_ITEM1'}])
        cell=next(s for s in data['slots'] if s['key']=='CSV_D1_NAME')
        with self.assertRaises(ValueError):render_file(data['enText'],[cell,cell])

    def test_empty_original_cells_are_not_reviewed_and_their_english_values_are_preserved(self):
        ja=fixture().replace('"次","",5,','"","",5,')
        en=fixture('Name','English').replace('"次","",5,','"English-only name","English-only value",5,')
        data=pair_file('db.txt',ja.encode(),en.encode())
        self.assertFalse(data['errors'])
        self.assertFalse(any(s['csv']['row']==1 for s in data['slots'] if s['kind']=='database_csv'))
        self.assertEqual(render_file(en,data['slots'])['text'],en)
        spaced=pair_file('db.txt',ja.replace('"","",5,','" ","",5,').encode(),en.encode())
        self.assertTrue(any(s['key']=='CSV_D1_NAME' for s in spaced['slots']))

    def test_shared_name_fields_and_independent_name_columns_keep_their_actual_field_number(self):
        text='TYPE_ID=0\nITEM_NUM=2\n<<--CSV_START-->>\n"名前","説明",\n"技能","説明文",\n<<--CSV_END-->>\n'
        data=pair_file('db.txt',text.encode(),text.encode());cells=[s for s in data['slots'] if s['kind']=='database_csv']
        self.assertEqual([s['key'] for s in cells],['CSV_D0_ITEM0','CSV_D0_ITEM1'])
        self.assertEqual(cells[0]['csv']['item'],0)

    def test_added_or_malformed_csv_keeps_metadata_and_reports_errors(self):
        ja=fixture();en=ja.replace('<<--CSV_END-->>','"Extra","Value",3,\r\n<<--CSV_END-->>')
        data=pair_file('db.txt',ja.encode(),en.encode());self.assertTrue(data['errors'])
        self.assertTrue(any(s.get('sourceMissing') and s['key']=='CSV_D2_NAME' for s in data['slots']))
        broken=pair_file('db.txt',ja.encode(),en.replace('"Extra"','"Extra').encode());self.assertTrue(broken['errors']);self.assertTrue(any(s['key']=='ITEMNAME0' for s in broken['slots']))

    def test_review_cli_applies_csv_newlines_and_quotes_to_a_separate_output(self):
        data=self.pair();slot=next(s for s in data['slots'] if s['key']=='CSV_D0_ITEM0')
        request={'schemaVersion':1,'requestId':'csv-request','createdAt':'2026-11-11','entries':[{'path':'db.txt','fileVersion':data['version'],'itemId':'item','slotIds':[slot['id']],'commentId':'comment','posts':[],'context':[],
                 'slots':[{**{k:slot[k] for k in ('id','source','translation','key','kind','position')},'line':slot['enLine']}]}]}
        after='A "quoted", value\r\nNew line'
        response=build(request,{'responses':[{'commentId':'comment','decision':'accepted','reason':'Reworded','changes':[{'slotId':slot['id'],'before':slot['translation'],'after':after}]}]})
        with TemporaryDirectory() as temp:
            root=Path(temp);source=root/'in';source.mkdir();(source/'db.txt').write_bytes(b'\xef\xbb\xbf'+data['enText'].encode())
            apply_files(request,response,source,root/'out');raw=(root/'out/db.txt').read_bytes();self.assertTrue(raw.startswith(b'\xef\xbb\xbf'))
            result=raw.decode('utf-8-sig');self.assertEqual(cell_for_key(result,slot['key'])['value'],after)
            self.assertEqual(masked_csv(data['enText'],catalog(data['enText'])),masked_csv(result,catalog(result)))

    @unittest.skipUnless(Path('.reference/ja-JP/texts').exists(),'Private corpus unavailable')
    def test_all_real_database_csv_strings_round_trip_without_touching_protected_cells(self):
        count=0
        for path in Path('.reference/ja-JP/texts/BasicData').rglob('*.txt'):
            ja=path.read_bytes()
            if not ja.decode('utf-8-sig').startswith('TYPE_ID='):continue
            en=(Path('.reference/en-US/texts')/path.relative_to('.reference/ja-JP/texts')).read_bytes()
            data=pair_file(str(path),ja,en)
            with self.subTest(path=str(path)):
                self.assertFalse(data['errors']);self.assertEqual(render_file(data['enText'],data['slots'])['text'],data['enText'])
                self.assertTrue(all(s['source'] or s.get('sourceMissing') for s in data['slots'] if s['kind']=='database_csv'))
                count+=sum(s['kind']=='database_csv' for s in data['slots'])
        self.assertGreater(count,500)
