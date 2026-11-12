import copy
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from review_adapter import pair_file
from woditor_review_tool import build, validate, apply_files
from fixtures import csv_fixture


class InitialReviewEditTests(unittest.TestCase):
    def setup_request(self, ja, en, key="COMMON_NAME"):
        path = "BasicData/000.txt"
        file = pair_file(path, ja.encode(), en.encode())
        self.assertFalse(file["errors"])
        slot = next(s for s in file["slots"] if s["key"] == key)
        target = {
            "path": path,
            "fileVersion": file["version"],
            "sourceVersion": file["sourceVersion"],
            "itemId": "item",
            "title": "Item",
            "slotIds": [slot["id"]],
            "context": [],
            "threads": [],
            "pendingChanges": [],
            "slots": [
                {
                    **{
                        k: slot[k]
                        for k in ("id", "source", "translation", "key", "kind", "position")
                        if k in slot
                    },
                    "line": slot["enLine"],
                }
            ],
        }
        request = {
            "schemaVersion": 1,
            "requestId": "initial",
            "createdAt": "2026-11-12",
            "mode": "initial",
            "entries": [],
            "targets": [target],
        }
        decision = {
            "path": path,
            "itemId": "item",
            "reason": "修正理由",
            "changes": [{"slotId": slot["id"], "before": slot["translation"], "after": "Revised"}],
        }
        return request, decision

    def metadata(self):
        ja = "COMMON_ID=0\r\nCOMMON_NAME=原文\r\nMEMO=メモ\r\nWoditorEvCOMMAND_START\r\nWoditorEvCOMMAND_END\r\n[COMMAND_TEXT_START]\r\n[COMMAND_TEXT_END]\r\n"
        en = ja.replace("原文", "English").replace("メモ", "Memo")
        return en, *self.setup_request(ja, en)

    def test_initial_build_validate_apply_preserves_bom_crlf_and_original(self):
        en, request, decision = self.metadata()
        response = build(request, {"suggestions": [decision]})
        self.assertEqual(response["suggestions"][0]["reason"], "修正理由")
        self.assertEqual(response["suggestions"][0]["changes"], decision["changes"])
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input"
            path = request["targets"][0]["path"]
            (source / path).parent.mkdir(parents=True)
            raw = b"\xef\xbb\xbf" + en.encode()
            (source / path).write_bytes(raw)
            apply_files(request, response, source, root / "output")
            self.assertEqual((source / path).read_bytes(), raw)
            self.assertEqual(
                (root / "output" / path).read_bytes(),
                raw.replace(b"COMMON_NAME=English", b"COMMON_NAME=Revised"),
            )
            with self.assertRaisesRegex(ValueError, "already exists"):
                apply_files(request, response, source, root / "output")
            with self.assertRaisesRegex(ValueError, "separate"):
                apply_files(request, response, source, source / "nested")
            (source / path).write_bytes(raw.replace(b"English", b"Changed"))
            with self.assertRaisesRegex(ValueError, "version mismatch"):
                apply_files(request, response, source, root / "stale")
            self.assertFalse((root / "stale").exists())

    def test_invalid_edits_duplicate_slots_and_pending_conflicts_are_rejected(self):
        _, request, decision = self.metadata()
        response = build(request, {"suggestions": [decision]})
        for field, value in [
            ("slotId", "unknown"),
            ("before", "stale"),
            ("after", "Bad\0text"),
            ("after", "First\nSecond"),
        ]:
            broken = copy.deepcopy(response)
            broken["suggestions"][0]["changes"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate(request, broken)
        duplicate = copy.deepcopy(response)
        duplicate["suggestions"].append(
            {**copy.deepcopy(duplicate["suggestions"][0]), "id": "another"}
        )
        with self.assertRaisesRegex(ValueError, "Duplicate/unknown slot"):
            validate(request, duplicate)
        target = request["targets"][0]
        edit = decision["changes"][0]
        target["pendingChanges"] = [
            {"id": "old", "slotId": edit["slotId"], "before": edit["before"], "after": "Previous"}
        ]
        with self.assertRaisesRegex(ValueError, "pending change"):
            validate(request, response)
        validate(
            request,
            build(
                request, {"suggestions": [{k: v for k, v in decision.items() if k != "changes"}]}
            ),
        )

    def test_initial_csv_multiline_edits_are_safe_but_names_remain_single_line(self):
        ja, en = csv_fixture(), csv_fixture("Name", "English")
        request, decision = self.setup_request(ja, en, "CSV_D0_ITEM0")
        after = 'Revised, "quoted"\r\nSecond\r\nThird'
        decision["changes"][0]["after"] = after
        response = build(request, {"suggestions": [decision]})
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input"
            path = request["targets"][0]["path"]
            (source / path).parent.mkdir(parents=True)
            (source / path).write_bytes(en.encode())
            apply_files(request, response, source, root / "output")
            output = (root / "output" / path).read_bytes().decode()
            self.assertEqual(
                output,
                en.replace('"English",123,', '"Revised, ""quoted""\r\nSecond\r\nThird",123,'),
            )
            self.assertEqual((source / path).read_bytes(), en.encode())
        request, decision = self.setup_request(ja, en, "CSV_D0_NAME")
        decision["changes"][0]["after"] = "Broken\nname"
        with self.assertRaisesRegex(ValueError, "encoded newlines"):
            build(request, {"suggestions": [decision]})

    def test_initial_command_edits_preserve_special_strings_and_encoded_formatting(self):
        ja = 'COMMON_ID=0\nWoditorEvCOMMAND_START\n[101][0,1]<0>()("原文\\v[1]")\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n文章:原文\\v[1]\n[COMMAND_TEXT_END]\n'
        en = ja.replace("原文", "Old")
        request, decision = self.setup_request(ja, en, "S1")
        decision["changes"][0]["after"] = "New<\\n><dqrt>quote<dqrt>\\v[1]"
        response = build(request, {"suggestions": [decision]})
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "input"
            path = request["targets"][0]["path"]
            (source / path).parent.mkdir(parents=True)
            (source / path).write_bytes(en.encode())
            apply_files(request, response, source, root / "output")
            self.assertIn(decision["changes"][0]["after"], (root / "output" / path).read_text())
            response["suggestions"][0]["changes"][0]["after"] = "New\\v[2]"
            with self.assertRaisesRegex(ValueError, "special strings"):
                apply_files(request, response, source, root / "unsafe")
            self.assertFalse((root / "unsafe").exists())
