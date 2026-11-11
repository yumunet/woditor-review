import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from review_adapter import pair_file,render_file
from woditor_parser import catalog,cell_for_key,masked_csv
from woditor_review_tool import build,apply_files


def fixture(name='名前', value='最初の行\r\n二行目'):
    return ('TYPE_ID=0\r\nITEM_NUM=2\r\nDATANAME_LOAD_TYPE=0\r\nITEMNAME0=説明\r\nITEMNAME1=数\r\n'
            '<<--CSV_START-->>\r\n"説明","数",\r\n'
            f'"{value.replace(chr(34),chr(34)*2)}",123,<<!--DATANAME--!>>{name},\r\n"",5,<<!--DATANAME--!>>次,\r\n<<--CSV_END-->>\r\n')


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
        self.assertEqual([s['key'] for s in cells],['CSV_D0_ITEM0','CSV_D0_NAME','CSV_D1_NAME'])
        self.assertEqual(cells[1]['title'],'データ名 0');self.assertEqual(cells[0]['csv']['item'],0)
        self.assertEqual(cells[0]['translation'],'First, "quoted"\r\nSecond')
        self.assertEqual(cells[0]['source'],'最初の行\r\n二行目');self.assertFalse(data['errors'])
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
        ja=fixture().replace('"",5,<<!--DATANAME--!>>次,','"",5,<<!--DATANAME--!>>,')
        en=fixture('Name','English').replace('"",5,<<!--DATANAME--!>>次,','"English-only value",5,<<!--DATANAME--!>>English-only name,')
        data=pair_file('db.txt',ja.encode(),en.encode())
        self.assertFalse(data['errors'])
        self.assertFalse(any(s['csv']['row']==1 for s in data['slots'] if s['kind']=='database_csv'))
        self.assertEqual(render_file(en,data['slots'])['text'],en)
        spaced=pair_file('db.txt',ja.replace('<<!--DATANAME--!>>,','<<!--DATANAME--!>> ,').encode(),en.encode())
        self.assertTrue(any(s['key']=='CSV_D1_NAME' for s in spaced['slots']))

    def test_first_csv_column_is_always_field_zero(self):
        text='TYPE_ID=0\nITEM_NUM=2\n<<--CSV_START-->>\n"名前","説明",\n"技能","説明文",\n<<--CSV_END-->>\n'
        data=pair_file('db.txt',text.encode(),text.encode());cells=[s for s in data['slots'] if s['kind']=='database_csv']
        self.assertEqual([s['key'] for s in cells],['CSV_D0_ITEM0','CSV_D0_ITEM1'])
        self.assertEqual(cells[0]['csv']['item'],0)

    def test_only_explicit_names_in_mode_zero_are_reviewed_and_references_are_not_followed(self):
        for mode in (0,1,2,10000,20000,39999,110000,120000,130000):
            with self.subTest(mode=mode):
                text=fixture().replace('DATANAME_LOAD_TYPE=0',f'DATANAME_LOAD_TYPE={mode}\r\nDATANAME_LOAD_NAME=参照タイプ')
                data=pair_file('db.txt',text.encode(),text.encode())
                self.assertFalse(data['errors']);self.assertFalse(any(s['key']=='DATANAME_LOAD_NAME' for s in data['slots']))
                self.assertEqual(sum(s.get('csv',{}).get('dataName',False) for s in data['slots']),2 if mode==0 else 0)
                self.assertTrue(any(s['key']=='CSV_D0_ITEM0' for s in data['slots']))
                self.assertEqual(render_file(text,data['slots'])['text'],text)

    def test_zero_field_database_keeps_data_zero_and_skips_empty_names(self):
        ja='TYPE_ID=0\nDATANAME_LOAD_TYPE=0\nITEM_NUM=0\n<<--CSV_START-->>\n\n<<!--DATANAME--!>>名前,\n<<!--DATANAME--!>>,\n<<--CSV_END-->>\n'
        en=ja.replace('名前','Name').replace('<<!--DATANAME--!>>,','<<!--DATANAME--!>>Unused English,')
        data=pair_file('db.txt',ja.encode(),en.encode());self.assertFalse(data['errors'])
        self.assertEqual([s['key'] for s in data['slots']],['CSV_D0_NAME'])
        self.assertEqual(data['slots'][0]['source'],'名前');self.assertEqual(render_file(en,data['slots'])['text'],en)

    def test_raw_name_edits_preserve_the_marker_delimiter_quotes_and_commas(self):
        data=self.pair();name=next(s for s in data['slots'] if s['key']=='CSV_D0_NAME')
        name['translation']='New, "quoted", name,'
        result=render_file(data['enText'],data['slots'])
        self.assertEqual(cell_for_key(result['text'],name['key'])['value'],name['translation'])
        self.assertIn('<<!--DATANAME--!>>New, "quoted", name,,\r\n',result['text'])
        self.assertEqual(masked_csv(data['enText'],catalog(data['enText'])),masked_csv(result['text'],catalog(result['text'])))
        name['translation']='Broken\nrow'
        with self.assertRaisesRegex(ValueError,'データ名'):render_file(data['enText'],data['slots'])

    def test_added_or_malformed_csv_keeps_metadata_and_reports_errors(self):
        ja=fixture();en=ja.replace('<<--CSV_END-->>','"Value",3,<<!--DATANAME--!>>Extra,\r\n<<--CSV_END-->>')
        data=pair_file('db.txt',ja.encode(),en.encode());self.assertTrue(data['errors'])
        self.assertTrue(any(s.get('sourceMissing') and s['key']=='CSV_D2_NAME' for s in data['slots']))
        broken=pair_file('db.txt',ja.encode(),en.replace('"Value"','"Value').encode());self.assertTrue(broken['errors']);self.assertTrue(any(s['key']=='ITEMNAME0' for s in broken['slots']))

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
