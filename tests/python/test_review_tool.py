import copy
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from fixtures import PAIRS, text
from review_adapter import pair_file
from woditor_parser import digest, render_file
from woditor_review_tool import apply_files, build, validate


class ReviewToolTests(unittest.TestCase):
    def setUp(self):
        temporary = TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.english_root = Path(temporary.name)
        target = self.english_root / PAIRS["map"]["path"]
        target.parent.mkdir(parents=True)
        target.write_bytes(text("map", "en").encode())
        self.path = PAIRS["map"]["path"]
        self.raw = text("map", "en").encode()
        self.f = pair_file(self.path, text("map", "ja").encode(), self.raw)
        s = self.f["slots"][0]
        self.request = {
            "schemaVersion": 1,
            "requestId": "request",
            "createdAt": "2026-11-09",
            "entries": [
                {
                    "path": self.path,
                    "fileVersion": self.f["version"],
                    "itemId": self.f["items"][0]["id"],
                    "slotIds": [s["id"]],
                    "commentId": "comment",
                    "posts": [],
                    "context": [],
                    "slots": [
                        {k: s[k] for k in ("id", "source", "translation", "line", "key", "kind")}
                    ],
                }
            ],
        }
        self.decisions = {
            "responses": [
                {
                    "commentId": "comment",
                    "decision": "accepted",
                    "reason": "Spelling",
                    "changes": [
                        {"slotId": s["id"], "before": s["translation"], "after": "Yuichi revised"}
                    ],
                }
            ]
        }

    def test_build_and_validate(self):
        response = build(self.request, self.decisions)
        validate(self.request, response)
        self.assertEqual(response["responses"][0]["path"], self.path)
        for field in ("commentId", "fileVersion", "itemId"):
            broken = copy.deepcopy(response)
            broken["responses"][0][field] = "wrong"
            with self.assertRaises(ValueError):
                validate(self.request, broken)
        response["responses"].append(response["responses"][0])
        with self.assertRaises(ValueError):
            validate(self.request, response)

    def initial_request(self):
        target = copy.deepcopy(self.request["entries"][0])
        target.pop("commentId")
        target.pop("posts")
        target.update(
            sourceVersion=self.f["sourceVersion"], title="Event name", threads=[], pendingChanges=[]
        )
        return {**self.request, "mode": "initial", "entries": [], "targets": [target]}

    def test_initial_review_builds_comments_without_existing_threads(self):
        request = self.initial_request()
        response = build(
            request,
            {
                "suggestions": [
                    {
                        "path": self.path,
                        "itemId": self.f["items"][0]["id"],
                        "reason": "Spelling issue",
                    }
                ]
            },
        )
        validate(request, response)
        self.assertEqual(response["responses"], [])
        self.assertEqual(response["suggestions"][0]["changes"], [])
        self.assertEqual(response["suggestions"][0]["fileVersion"], self.f["version"])
        self.assertTrue(response["suggestions"][0]["id"])
        validate(request, build(request, {"suggestions": []}))
        with TemporaryDirectory() as directory:
            out = Path(directory) / "out"
            apply_files(request, response, self.english_root, out)
            self.assertEqual((out / self.path).read_bytes(), self.raw)

    def test_initial_review_rejects_unknown_targets_and_allows_translation_changes(self):
        request = self.initial_request()
        with self.assertRaisesRegex(ValueError, "Unknown"):
            build(
                request,
                {"suggestions": [{"path": self.path, "itemId": "unknown", "reason": "Issue"}]},
            )
        response = build(
            request,
            {
                "suggestions": [
                    {
                        "path": self.path,
                        "itemId": self.f["items"][0]["id"],
                        "reason": "Issue",
                        "changes": self.decisions["responses"][0]["changes"],
                    }
                ]
            },
        )
        with TemporaryDirectory() as directory:
            out = Path(directory) / "out"
            apply_files(request, response, self.english_root, out)
            self.assertIn(b"EVENT_NAME=Yuichi revised", (out / self.path).read_bytes())

    def test_pending_proposals_can_be_reassessed_without_applying_them(self):
        slot = self.request["entries"][0]["slots"][0]
        self.request["entries"][0]["pendingChanges"] = [
            {
                "id": "old-change",
                "slotId": slot["id"],
                "before": slot["translation"],
                "after": "Withdrawn proposal",
            }
        ]
        response = build(
            self.request,
            {
                "responses": [
                    {
                        "commentId": "comment",
                        "decision": "rejected",
                        "reason": "Withdraw the previous proposal",
                        "changes": [],
                    }
                ]
            },
        )
        with TemporaryDirectory() as directory:
            out = Path(directory) / "rejected"
            apply_files(self.request, response, self.english_root, out)
            self.assertEqual((out / self.path).read_bytes(), self.raw)

    def test_render_preserves_original_and_protected_sections(self):
        self.f["slots"][0]["translation"] = "Yuichi revised"
        rendered = render_file(self.f["enText"], self.f["slots"])
        self.assertIn("EVENT_NAME=Yuichi revised", rendered["text"])
        self.assertEqual(rendered["version"], digest(rendered["text"]))
        marker = "[COMMAND_TEXT_START]"
        self.assertEqual(rendered["text"].split(marker)[1], self.f["enText"].split(marker)[1])
        self.assertEqual((self.english_root / self.path).read_bytes(), self.raw)

    def test_apply_outputs_separate_file_and_refuses_overwrite(self):
        response = build(self.request, self.decisions)
        with TemporaryDirectory() as directory:
            out = Path(directory) / "revised"
            apply_files(self.request, response, self.english_root, out)
            self.assertIn(b"EVENT_NAME=Yuichi revised", (out / self.path).read_bytes())
            with self.assertRaises(ValueError):
                apply_files(self.request, response, self.english_root, out)


if __name__ == "__main__":
    unittest.main()
