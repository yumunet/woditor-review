import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


class ReviewToolLayoutTests(unittest.TestCase):
    def test_embedded_schemas_work_with_only_the_cli_and_shared_parser(self):
        source = Path('python').resolve()
        modules = ('woditor_review_tool.py', 'woditor_parser.py')
        for layout in ('no-external-schemas',):
            with self.subTest(layout=layout), TemporaryDirectory() as directory:
                root = Path(directory)
                tools = root / 'tools'
                tools.mkdir()
                for name in modules:
                    shutil.copyfile(source / name, tools / name)
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
                # The embedded schemas must enforce their actual constraints.
                del request['requestId']
                (work / 'request.json').write_text(json.dumps(request), encoding='utf-8')
                result = run('validate', '--request', 'request.json', '--response', 'response.json')
                self.assertNotEqual(result.returncode, 0)
                self.assertIn('missing requestId', result.stderr)
