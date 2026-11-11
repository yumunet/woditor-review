import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from woditor_review_tool import read_schema


class ModuleBoundaryTests(unittest.TestCase):
    def test_embedded_schemas_match_the_documented_contracts(self):
        for path in Path('python/schemas').glob('*.json'):
            self.assertEqual(read_schema(path.name),json.loads(path.read_text(encoding='utf-8')))

    def test_new_translation_cli_runs_without_review_or_application_modules(self):
        with TemporaryDirectory() as directory:
            root=Path(directory);tool=root/'tool';tool.mkdir();work=root/'work';work.mkdir()
            for name in ('woditor_translation_tool.py','woditor_parser.py'):
                shutil.copyfile(Path('python')/name,tool/name)
            source='TYPE_ID=0\r\nTYPENAME=名前 <None> X% of Max\r\n'
            (work/'input.txt').write_bytes(b'\xef\xbb\xbf'+source.encode())
            def run(*args):
                result=subprocess.run([sys.executable,str(tool/'woditor_translation_tool.py'),*args],cwd=work,capture_output=True,text=True,encoding='utf-8')
                self.assertEqual(result.returncode,0,result.stderr)
                return result
            run('extract','input.txt','--out','entries.json')
            entries=json.loads((work/'entries.json').read_text(encoding='utf-8'))
            entries['entries'][0]['translation']='Name'
            (work/'entries.json').write_text(json.dumps(entries),encoding='utf-8')
            run('context','input.txt','--id',entries['entries'][0]['id'])
            run('apply','input.txt','entries.json','--out','output.txt')
            self.assertEqual((work/'input.txt').read_bytes(),b'\xef\xbb\xbf'+source.encode())
            self.assertEqual((work/'output.txt').read_bytes(),b'\xef\xbb\xbfTYPE_ID=0\r\nTYPENAME=Name\r\n')
