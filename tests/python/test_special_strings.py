import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from review_adapter import pair_file
from woditor_parser import special_strings, translation_warnings
from woditor_review_tool import apply_files, build


class SpecialStringTests(unittest.TestCase):
    def test_shared_token_cases_match_the_ui_specification(self):
        cases = json.loads(Path("tests/fixtures/special-strings.json").read_text(encoding="utf-8"))
        for case in cases:
            with self.subTest(name=case["name"]):
                self.assertEqual(special_strings(case["text"]), case["tokens"])

    def test_nested_arguments_bare_controls_counts_and_order_are_compared(self):
        self.assertEqual(
            translation_warnings(r"文\udb[3:\v[4]:\self[1]]", r"Text\udb[3:\v[5]:\self[1]]"),
            ["特殊文字列が原文と異なります"],
        )
        self.assertEqual(translation_warnings(r"\!\!", r"\!"), ["特殊文字列が原文と異なります"])
        self.assertEqual(translation_warnings("<L><C>", "<C><L>"), ["特殊文字列が原文と異なります"])
        self.assertEqual(
            translation_warnings(r"<None> X% of Max %02d <\n><dqrt>\r[漢字,かんじ]", "English"), []
        )

    def apply(self, before, after):
        ja = "TYPE_ID=0\nMEMO=原文 " + before + "\n"
        en = "TYPE_ID=0\nMEMO=" + before + "\n"
        file = pair_file("db.txt", ja.encode(), en.encode())
        slot = next(s for s in file["slots"] if s["key"] == "MEMO")
        request = {
            "schemaVersion": 1,
            "requestId": "special-test",
            "createdAt": "2026-11-11",
            "entries": [
                {
                    "path": "db.txt",
                    "fileVersion": file["version"],
                    "itemId": "memo",
                    "slotIds": [slot["id"]],
                    "commentId": "comment",
                    "posts": [],
                    "context": [],
                    "slots": [
                        {
                            **{
                                key: slot[key]
                                for key in ("id", "source", "translation", "key", "kind")
                            },
                            "line": slot["enLine"],
                        }
                    ],
                }
            ],
        }
        response = build(
            request,
            {
                "responses": [
                    {
                        "commentId": "comment",
                        "decision": "accepted",
                        "reason": "Review",
                        "changes": [{"slotId": slot["id"], "before": before, "after": after}],
                    }
                ]
            },
        )
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input"
            source.mkdir()
            (source / "db.txt").write_bytes(en.encode())
            apply_files(request, response, source, root / "output")
            self.assertEqual(
                (root / "output/db.txt").read_bytes(), ("TYPE_ID=0\nMEMO=" + after + "\n").encode()
            )
            self.assertEqual((source / "db.txt").read_bytes(), en.encode())

    def test_review_tool_allows_changes_to_excluded_formatting_and_ruby(self):
        self.apply(r"<None> X% of Max %s <\n><dqrt>\r[漢字,かんじ]", "None and plain English")

    def test_review_tool_rejects_changed_woditor_special_strings(self):
        for before, after in [
            (r"\udb[3:\v[4]:\self[1]]", r"\udb[3:\v[5]:\self[1]]"),
            (r"\E", r"\N"),
        ]:
            with self.subTest(before=before), self.assertRaisesRegex(ValueError, "special strings"):
                self.apply(before, after)
