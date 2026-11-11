import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class ReviewToolLayoutTests(unittest.TestCase):
    def test_packaged_and_flat_files_work_from_an_unrelated_directory(self):
        source = Path('python').resolve()
        modules = ('woditor_review_tool.py', 'review_parser.py', 'review_alignment.py',
                   'database_csv.py', 'woditor_translation_tool.py')
        for layout in ('schemas', '.'):
            with self.subTest(layout=layout), TemporaryDirectory() as directory:
                root = Path(directory)
                tools = root / 'tools'
                tools.mkdir()
                for name in modules:
                    shutil.copyfile(source / name, tools / name)
                schemas = tools / layout
                schemas.mkdir(exist_ok=True)
                for name in ('review-request.schema.json', 'review-response.schema.json'):
                    shutil.copyfile(source / 'schemas' / name, schemas / name)
                work = root / 'work'
                work.mkdir()
                request = {'schemaVersion': 1, 'requestId': 'portable', 'createdAt': '2026-11-11', 'entries': []}
                (work / 'request.json').write_text(json.dumps(request), encoding='utf-8')
                (work / 'decisions.json').write_text('{"responses":[]}', encoding='utf-8')

                def run(*arguments):
                    return subprocess.run([sys.executable, str(tools / 'woditor_review_tool.py'), *arguments],
                                          cwd=work, capture_output=True, text=True, encoding='utf-8')

                result = run('build', '--request', 'request.json', '--decisions', 'decisions.json', '--out', 'response.json')
                self.assertEqual(result.returncode, 0, result.stderr)
                result = run('validate', '--request', 'request.json', '--response', 'response.json')
                self.assertEqual(result.returncode, 0, result.stderr)
                # Finding the files must still enforce their actual schema constraints.
                del request['requestId']
                (work / 'request.json').write_text(json.dumps(request), encoding='utf-8')
                result = run('validate', '--request', 'request.json', '--response', 'response.json')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('missing requestId', result.stderr)
