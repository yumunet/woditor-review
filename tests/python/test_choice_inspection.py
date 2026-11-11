import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from woditor_parser import inspect_choices, clean_unused_choices, translation_slots
from review_adapter import pair_file, render_file


def fixture(kind='common',mode=2,names=('選択A','選択B'),values=('0','1'),group=0,name_count=None,value_count=None):
    common=kind=='common';family='STR' if common else 'NAME'
    header=['COMMON_ID=0','VALINPUT_NUM=5','VALINPUT_NAME_0=引数'] if common else ['TYPE_ID=0','ITEM_NUM=1','ITEMNAME0=項目']
    header+=[f'LOADTYPE{group}={mode}' if common else f'ITEM_LOADTYPE_{group}={mode}',
             f'CHOICE_{family}_{group}_NUM={len(names) if name_count is None else name_count}']
    header += [f'CHOICE_{family}_{group}_{i}={value}' for i,value in enumerate(names)]
    header += [f'CHOICE_VAL_{group}_NUM={len(values) if value_count is None else value_count}']
    header += [f'CHOICE_VAL_{group}_{i}={value}' for i,value in enumerate(values)]
    tail='WoditorEvCOMMAND_START\n[101][0,1]<0>()("本文")\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n■本文\n[COMMAND_TEXT_END]\n' if common else '<<--CSV_START-->>\n"項目",\n"データ",\n<<--CSV_END-->>\n'
    return '\n'.join(header)+'\n'+tail


class ChoiceInspectionTests(unittest.TestCase):
    def test_all_supported_active_shapes_and_database_folder_name_are_valid(self):
        for kind,mode,names,values in [('common',0,(),()),('common',1,(),('1','2','3')),('common',1,('なし','不明','未設定'),('1','2','3')),('common',2,('選択A','選択B'),('5','8')),('database',1,('CharaChip',),('0',)),('database',2,(),('1','2','3')),('database',2,('なし','不明','未設定'),('1','2','3')),('database',3,('選択A','選択B'),('5','8'))]:
            with self.subTest(kind=kind,mode=mode,names=names):
                text=fixture(kind,mode,names,values);report=inspect_choices(text)
                self.assertEqual(report['counts'],dict(error=0,warning=0,automatic=0),report['diagnostics'])
                self.assertEqual(clean_unused_choices(text)[0],text)

    def test_direct_input_removes_both_families_and_resets_counts_without_touching_body(self):
        for kind in ('common','database'):
            text=fixture(kind,0).replace('\n','\r\n');report=inspect_choices(text)
            self.assertEqual(report['counts']['error'],0);self.assertEqual(len(report['unused']),4)
            revised,_=clean_unused_choices(text)
            self.assertIn('CHOICE_VAL_0_NUM=0\r\n',revised);self.assertNotIn('CHOICE_VAL_0_0=',revised)
            self.assertEqual(inspect_choices(revised)['changes'],[])
            boundary='WoditorEvCOMMAND_START' if kind=='common' else '<<--CSV_START-->>'
            self.assertEqual(text[text.index(boundary):],revised[revised.index(boundary):])
            self.assertNotIn('CHOICE_',repr([s.id for s in translation_slots(text)[0]]))
        self.assertFalse(translation_slots(fixture(mode=0,values=('残存する内部値','未使用')))[1])

    def test_out_of_range_entries_and_unused_arguments_are_automatic(self):
        for kind,mode in [('common',2),('database',3)]:
            text=fixture(kind,mode,('有効','残存'),('0','1'),name_count=1,value_count=1)
            report=inspect_choices(text);self.assertEqual(report['counts']['error'],0);self.assertEqual(len(report['unused']),2)
            revised,_=clean_unused_choices(text);self.assertNotIn('残存',revised);self.assertIn('有効',revised)
        for group in (2,5,9):
            text=fixture(group=group).replace('VALINPUT_NUM=5','VALINPUT_NUM=1')
            self.assertEqual(len(inspect_choices(text)['unused']),4)
        for kind,mode in [('common',1),('database',2)]:
            text=fixture(kind,mode,('無','未','不明','残存'),('1','2','3','4'))
            report=inspect_choices(text);self.assertEqual(report['counts']['error'],0);self.assertEqual(len(report['unused']),2)
            revised,_=clean_unused_choices(text);self.assertNotIn('残存',revised);self.assertIn('CHOICE_VAL_0_NUM=3\n',revised)
            paired=pair_file('file.txt',text.encode(),revised.encode())
            self.assertFalse(paired['errors']);self.assertFalse(any('設定値が日英で異なります' in warning for warning in paired['warnings']))
            self.assertFalse(any(slot['source']=='残存' for slot in paired['slots']))

    def test_malformed_active_settings_are_errors_and_cleanup_never_guesses(self):
        cases=[fixture('common',1,('一つ',),('0','1','2')),fixture('common',1,(),('0','1')),
               fixture('common',2,('一つ',),('0','1')),fixture('database',1,(),('0',)),
               fixture('database',1,('一つ','二つ'),('0',)),fixture('database',2,('一つ',),('0','1','2')),
               fixture(name_count=3),fixture().replace('CHOICE_STR_0_NUM=2','CHOICE_STR_0_NUM=invalid'),
               fixture().replace('CHOICE_VAL_0_1=1','CHOICE_VAL_0_0=1'),fixture(mode=9)]
        for text in cases:
            with self.subTest(text=text):
                self.assertGreater(inspect_choices(text)['counts']['error'],0)
                with self.assertRaisesRegex(ValueError,'削除しません'): clean_unused_choices(text)

    def test_internal_values_warn_but_stay_unchanged_in_the_application(self):
        ja=fixture();en=ja.replace('CHOICE_VAL_0_1=1','CHOICE_VAL_0_1=17').replace('選択A','Choice A').replace('選択B','Choice B')
        paired=pair_file('common.txt',ja.encode(),en.encode())
        self.assertFalse(paired['errors']);self.assertIn('翻訳対象外の設定値が日英で異なります: 1件',paired['warnings'])
        self.assertEqual(render_file(en,paired['slots'])['text'],en)
        self.assertEqual(len([s for s in paired['slots'] if s['key'].startswith('CHOICE_STR')]),2)
        unused=fixture(mode=0);paired=pair_file('common.txt',unused.encode(),unused.encode())
        self.assertFalse(any(s['key'].startswith('CHOICE_STR') for s in paired['slots']))
        self.assertTrue(any(w.startswith('未使用の選択肢設定を無視しました') for w in paired['warnings']))

    def test_cli_inspection_and_cleanup_preserve_source_encoding_and_reject_unsafe_outputs(self):
        cli=str(Path('python/woditor_translation_tool.py').resolve())
        with TemporaryDirectory() as directory:
            root=Path(directory);source=fixture(mode=0).replace('\n','\r\n');raw=source.encode('cp932');(root/'input.txt').write_bytes(raw)
            def run(*args):
                return subprocess.run([sys.executable,cli,*args],cwd=root,capture_output=True,text=True,encoding='utf-8')
            result=run('inspect-choices','input.txt');self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual(len(json.loads(result.stdout)['unused']),4)
            result=run('clean-choices','input.txt','--out','cleaned.txt');self.assertEqual(result.returncode,0,result.stderr)
            self.assertEqual((root/'input.txt').read_bytes(),raw)
            self.assertEqual((root/'cleaned.txt').read_bytes(),clean_unused_choices(source)[0].encode('cp932'))
            for target in ('input.txt','cleaned.txt'):
                self.assertNotEqual(run('clean-choices','input.txt','--out',target).returncode,0)
            (root/'bom.txt').write_bytes(b'\xef\xbb\xbf'+source.encode())
            self.assertEqual(run('clean-choices','bom.txt','--out','bom-cleaned.txt').returncode,0)
            self.assertEqual((root/'bom-cleaned.txt').read_bytes(),b'\xef\xbb\xbf'+clean_unused_choices(source)[0].encode())
            (root/'bad.txt').write_text(fixture(name_count=7),encoding='utf-8')
            result=run('inspect-choices','bad.txt');self.assertEqual(result.returncode,2);self.assertGreater(json.loads(result.stdout)['counts']['error'],0)
            self.assertNotEqual(run('clean-choices','bad.txt','--out','not-written.txt').returncode,0);self.assertFalse((root/'not-written.txt').exists())

    def test_new_translation_csv_edits_use_the_shared_safe_writer(self):
        cli=str(Path('python/woditor_translation_tool.py').resolve())
        with TemporaryDirectory() as directory:
            root=Path(directory);text=fixture('database',0);(root/'source.txt').write_bytes(text.encode())
            def run(*args):
                result=subprocess.run([sys.executable,cli,*args],cwd=root,capture_output=True,text=True,encoding='utf-8')
                self.assertEqual(result.returncode,0,result.stderr)
                return result
            run('extract','source.txt','--out','translation.json');data=json.loads((root/'translation.json').read_text(encoding='utf-8'))
            self.assertFalse(any('CHOICE_' in entry['id'] for entry in data['entries']))
            for entry in data['entries']:
                entry['translation']='Line "one"\nLine two' if 'CSV_' in entry['id'] else 'Field'
            (root/'translation.json').write_text(json.dumps(data),encoding='utf-8')
            run('context','source.txt','--id',next(entry['id'] for entry in data['entries'] if 'CSV_' in entry['id']))
            run('apply','source.txt','translation.json','--out','translated.txt')
            result=(root/'translated.txt').read_text(encoding='utf-8')
            self.assertIn('"Line ""one""\nLine two",',result)
            self.assertIn('CHOICE_VAL_0_NUM=2\n',result);self.assertEqual((root/'source.txt').read_bytes(),text.encode())

    @unittest.skipUnless(Path('.reference/ja-JP/texts').exists(),'Private corpus unavailable')
    def test_corpus_cleanup_is_idempotent_and_never_modifies_commands_or_csv(self):
        errors=[];removed=0
        from woditor_parser import file_type,decode
        for language in ('ja-JP','en-US'):
            for path in Path('.reference',language,'texts').rglob('*.txt'):
                text,_=decode(path.read_bytes())
                try: kind=file_type(text)
                except ValueError: continue
                if kind not in ('common','database'): continue
                report=inspect_choices(text)
                if report['counts']['error']:
                    errors.append(path.as_posix());continue
                revised,_=clean_unused_choices(text);removed+=len(report['unused'])
                self.assertEqual(clean_unused_choices(revised)[0],revised)
                marker='WoditorEvCOMMAND_START' if kind=='common' else '<<--CSV_START-->>'
                if marker in text: self.assertEqual(text[text.index(marker):],revised[revised.index(marker):])
        self.assertGreater(removed,8000)
        self.assertEqual(errors,['.reference/ja-JP/texts/BasicData/CommonEvent/026.txt'])
