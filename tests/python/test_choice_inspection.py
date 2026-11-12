import json
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from review_adapter import pair_file, render_file
from woditor_parser import clean_unused_choices, inspect_choices, translation_slots


def fixture(
    kind="common",
    mode=2,
    names=("選択A", "選択B"),
    values=("0", "1"),
    group=0,
    name_count=None,
    value_count=None,
):
    common = kind == "common"
    family = "STR" if common else "NAME"
    header = (
        ["COMMON_ID=0", "VALINPUT_NUM=5", "VALINPUT_NAME_0=引数"]
        if common
        else ["TYPE_ID=0", "ITEM_NUM=1", "ITEMNAME0=項目"]
    )
    header += [
        f"LOADTYPE{group}={mode}" if common else f"ITEM_LOADTYPE_{group}={mode}",
        f"CHOICE_{family}_{group}_NUM={len(names) if name_count is None else name_count}",
    ]
    header += [f"CHOICE_{family}_{group}_{i}={value}" for i, value in enumerate(names)]
    header += [f"CHOICE_VAL_{group}_NUM={len(values) if value_count is None else value_count}"]
    header += [f"CHOICE_VAL_{group}_{i}={value}" for i, value in enumerate(values)]
    tail = (
        'WoditorEvCOMMAND_START\n[101][0,1]<0>()("本文")\nWoditorEvCOMMAND_END\n[COMMAND_TEXT_START]\n■本文\n[COMMAND_TEXT_END]\n'
        if common
        else '<<--CSV_START-->>\n"項目",\n"データ",\n<<--CSV_END-->>\n'
    )
    return "\n".join(header) + "\n" + tail


class ChoiceInspectionTests(unittest.TestCase):
    def test_zero_arguments_reset_the_unused_reference_mode_with_its_choice_values(self):
        source = "COMMON_ID=0\nVALINPUT_NUM=0\nLOADTYPE0=1\nCHOICE_VAL_0_NUM=3\nCHOICE_VAL_0_0=1\nCHOICE_VAL_0_1=4\nCHOICE_VAL_0_2=0\n"
        expected = "COMMON_ID=0\nVALINPUT_NUM=0\nLOADTYPE0=0\nCHOICE_VAL_0_NUM=0\n"
        report = inspect_choices(source)
        self.assertEqual(report["counts"], dict(error=0, warning=0, automatic=1))
        self.assertEqual(len(report["unused"]), 3)
        self.assertIn("入力形式を0へ補正", report["diagnostics"][0]["message"])
        revised, _ = clean_unused_choices(source)
        self.assertEqual(revised, expected)
        self.assertEqual(inspect_choices(revised)["changes"], [])
        self.assertEqual(inspect_choices(revised)["counts"]["automatic"], 0)

    def test_only_unused_numeric_argument_modes_reset_even_without_choice_entries(self):
        active = fixture(mode=1, names=(), values=("1", "4", "0")).replace(
            "VALINPUT_NUM=5", "VALINPUT_NUM=1"
        )
        source = active.replace(
            "LOADTYPE0=1\n",
            "LOADTYPE0=1\nLOADTYPE1=1\nLOADTYPE2=2\nLOADTYPE4=1\nLOADTYPE5=1\nLOADTYPE9=2\n",
        )
        expected = (
            source.replace("LOADTYPE1=1", "LOADTYPE1=0")
            .replace("LOADTYPE2=2", "LOADTYPE2=0")
            .replace("LOADTYPE4=1", "LOADTYPE4=0")
        )
        revised, report = clean_unused_choices(source)
        self.assertEqual(revised, expected)
        self.assertEqual(report["counts"], dict(error=0, warning=0, automatic=3))
        self.assertEqual(report["unused"], [])
        self.assertEqual(
            {d["key"] for d in report["diagnostics"]}, {"LOADTYPE1", "LOADTYPE2", "LOADTYPE4"}
        )
        self.assertEqual(inspect_choices(revised)["changes"], [])
        for count in ("5", "invalid", "-1", None):
            with self.subTest(count=count):
                text = fixture(group=4)
                if count is None:
                    text = text.replace("VALINPUT_NUM=5\n", "")
                else:
                    text = text.replace("VALINPUT_NUM=5", f"VALINPUT_NUM={count}")
                self.assertEqual(clean_unused_choices(text)[0], text)

    def test_unused_argument_modes_and_both_choice_families_are_cleaned_together(self):
        for mode in (1, 2):
            with self.subTest(mode=mode):
                source = fixture(mode=mode, group=1).replace("VALINPUT_NUM=5", "VALINPUT_NUM=1")
                revised, _ = clean_unused_choices(source)
                self.assertIn("LOADTYPE1=0\n", revised)
                self.assertIn("CHOICE_STR_1_NUM=0\n", revised)
                self.assertIn("CHOICE_VAL_1_NUM=0\n", revised)
                self.assertNotIn("CHOICE_STR_1_0=", revised)
                self.assertNotIn("CHOICE_VAL_1_0=", revised)
                boundary = "WoditorEvCOMMAND_START"
                self.assertEqual(
                    source[source.index(boundary) :], revised[revised.index(boundary) :]
                )

    def test_cli_reset_preserves_bom_crlf_and_the_original_file(self):
        cli = str(Path("python/woditor_translation_tool.py").resolve())
        source = "COMMON_ID=0\r\nVALINPUT_NUM=0\r\nLOADTYPE0=1\r\nCHOICE_VAL_0_NUM=3\r\nCHOICE_VAL_0_0=1\r\nCHOICE_VAL_0_1=4\r\nCHOICE_VAL_0_2=0\r\n"
        expected = "COMMON_ID=0\r\nVALINPUT_NUM=0\r\nLOADTYPE0=0\r\nCHOICE_VAL_0_NUM=0\r\n"
        with TemporaryDirectory() as directory:
            root = Path(directory)
            raw = b"\xef\xbb\xbf" + source.encode()
            (root / "input.txt").write_bytes(raw)

            def run(*args):
                result = subprocess.run(
                    [sys.executable, cli, *args],
                    cwd=root,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                return result

            report = json.loads(run("inspect-choices", "input.txt").stdout)
            self.assertEqual(report["counts"], dict(error=0, warning=0, automatic=1))
            self.assertIn(
                "adjusted 2 count/mode settings",
                run("clean-choices", "input.txt", "--out", "cleaned.txt").stdout,
            )
            self.assertEqual(
                (root / "cleaned.txt").read_bytes(), b"\xef\xbb\xbf" + expected.encode()
            )
            self.assertEqual((root / "input.txt").read_bytes(), raw)
            self.assertEqual(
                json.loads(run("inspect-choices", "cleaned.txt").stdout)["counts"]["automatic"], 0
            )

    def test_all_supported_active_shapes_and_database_folder_name_are_valid(self):
        for kind, mode, names, values in [
            ("common", 0, (), ()),
            ("common", 1, (), ("1", "2", "3")),
            ("common", 1, ("なし", "不明", "未設定"), ("1", "2", "3")),
            ("common", 2, ("選択A", "選択B"), ("5", "8")),
            ("database", 1, ("CharaChip",), ("0",)),
            ("database", 2, (), ("1", "2", "3")),
            ("database", 2, ("なし", "不明", "未設定"), ("1", "2", "3")),
            ("database", 3, ("選択A", "選択B"), ("5", "8")),
        ]:
            with self.subTest(kind=kind, mode=mode, names=names):
                text = fixture(kind, mode, names, values)
                report = inspect_choices(text)
                self.assertEqual(
                    report["counts"], dict(error=0, warning=0, automatic=0), report["diagnostics"]
                )
                self.assertEqual(clean_unused_choices(text)[0], text)

    def test_direct_input_removes_both_families_and_resets_counts_without_touching_body(self):
        for kind in ("common", "database"):
            text = fixture(kind, 0).replace("\n", "\r\n")
            report = inspect_choices(text)
            self.assertEqual(report["counts"]["error"], 0)
            self.assertEqual(len(report["unused"]), 4)
            revised, _ = clean_unused_choices(text)
            self.assertIn("CHOICE_VAL_0_NUM=0\r\n", revised)
            self.assertNotIn("CHOICE_VAL_0_0=", revised)
            self.assertEqual(inspect_choices(revised)["changes"], [])
            boundary = "WoditorEvCOMMAND_START" if kind == "common" else "<<--CSV_START-->>"
            self.assertEqual(text[text.index(boundary) :], revised[revised.index(boundary) :])
            self.assertNotIn("CHOICE_", repr([s.id for s in translation_slots(text)[0]]))
        self.assertFalse(translation_slots(fixture(mode=0, values=("残存する内部値", "未使用")))[1])

    def test_out_of_range_entries_and_unused_arguments_are_automatic(self):
        for kind, mode in [("common", 2), ("database", 3)]:
            text = fixture(kind, mode, ("有効", "残存"), ("0", "1"), name_count=1, value_count=1)
            report = inspect_choices(text)
            self.assertEqual(report["counts"]["error"], 0)
            self.assertEqual(len(report["unused"]), 2)
            revised, _ = clean_unused_choices(text)
            self.assertNotIn("残存", revised)
            self.assertIn("有効", revised)
        for group in (2, 5, 9):
            text = fixture(group=group).replace("VALINPUT_NUM=5", "VALINPUT_NUM=1")
            self.assertEqual(len(inspect_choices(text)["unused"]), 4)
        for kind, mode in [("common", 1), ("database", 2)]:
            text = fixture(kind, mode, ("無", "未", "不明", "残存"), ("1", "2", "3", "4"))
            report = inspect_choices(text)
            self.assertEqual(report["counts"]["error"], 0)
            self.assertEqual(len(report["unused"]), 2)
            revised, _ = clean_unused_choices(text)
            self.assertNotIn("残存", revised)
            self.assertIn("CHOICE_VAL_0_NUM=3\n", revised)
            paired = pair_file("file.txt", text.encode(), revised.encode())
            self.assertFalse(paired["errors"])
            self.assertFalse(
                any("設定値が日英で異なります" in warning for warning in paired["warnings"])
            )
            self.assertFalse(any(slot["source"] == "残存" for slot in paired["slots"]))

    def test_malformed_active_settings_are_errors_and_cleanup_never_guesses(self):
        cases = [
            fixture("common", 1, ("一つ",), ("0", "1", "2")),
            fixture("common", 1, ("一つ", "二つ"), ("0", "1", "2")),
            fixture("common", 1, (), ("0", "1")),
            fixture("common", 2, ("一つ",), ("0", "1")),
            fixture("database", 1, (), ("0",)),
            fixture("database", 1, ("一つ", "二つ"), ("0",)),
            fixture("database", 2, ("一つ",), ("0", "1", "2")),
            fixture(name_count=3),
            fixture().replace("CHOICE_STR_0_NUM=2", "CHOICE_STR_0_NUM=invalid"),
            fixture().replace("CHOICE_VAL_0_1=1", "CHOICE_VAL_0_0=1"),
            fixture(mode=9),
        ]
        for text in cases:
            with self.subTest(text=text):
                self.assertGreater(inspect_choices(text)["counts"]["error"], 0)
                with self.assertRaisesRegex(ValueError, "削除しません"):
                    clean_unused_choices(text)

    def test_internal_values_warn_but_stay_unchanged_in_the_application(self):
        ja = fixture()
        en = (
            ja.replace("CHOICE_VAL_0_1=1", "CHOICE_VAL_0_1=17")
            .replace("選択A", "Choice A")
            .replace("選択B", "Choice B")
        )
        paired = pair_file("common.txt", ja.encode(), en.encode())
        self.assertFalse(paired["errors"])
        self.assertIn("翻訳対象外の設定値が日英で異なります: 1件", paired["warnings"])
        self.assertEqual(render_file(en, paired["slots"])["text"], en)
        self.assertEqual(len([s for s in paired["slots"] if s["key"].startswith("CHOICE_STR")]), 2)
        unused = fixture(mode=0)
        paired = pair_file("common.txt", unused.encode(), unused.encode())
        self.assertFalse(any(s["key"].startswith("CHOICE_STR") for s in paired["slots"]))
        self.assertTrue(
            any(w.startswith("未使用の選択肢設定を無視しました") for w in paired["warnings"])
        )

    def test_cli_inspection_and_cleanup_preserve_source_encoding_and_reject_unsafe_outputs(self):
        cli = str(Path("python/woditor_translation_tool.py").resolve())
        with TemporaryDirectory() as directory:
            root = Path(directory)
            source = fixture(mode=0).replace("\n", "\r\n")
            raw = source.encode("cp932")
            (root / "input.txt").write_bytes(raw)

            def run(*args):
                return subprocess.run(
                    [sys.executable, cli, *args],
                    cwd=root,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )

            result = run("inspect-choices", "input.txt")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(len(json.loads(result.stdout)["unused"]), 4)
            result = run("clean-choices", "input.txt", "--out", "cleaned.txt")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((root / "input.txt").read_bytes(), raw)
            self.assertEqual(
                (root / "cleaned.txt").read_bytes(), clean_unused_choices(source)[0].encode("cp932")
            )
            for target in ("input.txt", "cleaned.txt"):
                self.assertNotEqual(
                    run("clean-choices", "input.txt", "--out", target).returncode, 0
                )
            (root / "bom.txt").write_bytes(b"\xef\xbb\xbf" + source.encode())
            self.assertEqual(
                run("clean-choices", "bom.txt", "--out", "bom-cleaned.txt").returncode, 0
            )
            self.assertEqual(
                (root / "bom-cleaned.txt").read_bytes(),
                b"\xef\xbb\xbf" + clean_unused_choices(source)[0].encode(),
            )
            (root / "bad.txt").write_text(fixture(name_count=7), encoding="utf-8")
            result = run("inspect-choices", "bad.txt")
            self.assertEqual(result.returncode, 2)
            self.assertGreater(json.loads(result.stdout)["counts"]["error"], 0)
            self.assertNotEqual(
                run("clean-choices", "bad.txt", "--out", "not-written.txt").returncode, 0
            )
            self.assertFalse((root / "not-written.txt").exists())

    def test_new_translation_csv_edits_use_the_shared_safe_writer(self):
        cli = str(Path("python/woditor_translation_tool.py").resolve())
        with TemporaryDirectory() as directory:
            root = Path(directory)
            text = fixture("database", 0)
            (root / "source.txt").write_bytes(text.encode())

            def run(*args):
                result = subprocess.run(
                    [sys.executable, cli, *args],
                    cwd=root,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                return result

            run("extract", "source.txt", "--out", "translation.json")
            data = json.loads((root / "translation.json").read_text(encoding="utf-8"))
            self.assertFalse(any("CHOICE_" in entry["id"] for entry in data["entries"]))
            for entry in data["entries"]:
                entry["translation"] = 'Line "one"\nLine two' if "CSV_" in entry["id"] else "Field"
            (root / "translation.json").write_text(json.dumps(data), encoding="utf-8")
            run(
                "context",
                "source.txt",
                "--id",
                next(entry["id"] for entry in data["entries"] if "CSV_" in entry["id"]),
            )
            run("apply", "source.txt", "translation.json", "--out", "translated.txt")
            result = (root / "translated.txt").read_text(encoding="utf-8")
            self.assertIn('"Line ""one""\nLine two",', result)
            self.assertIn("CHOICE_VAL_0_NUM=2\n", result)
            self.assertEqual((root / "source.txt").read_bytes(), text.encode())

    def test_cleanup_is_idempotent_and_never_modifies_command_or_csv_bodies(self):
        for kind, mode in [
            ("common", 0),
            ("common", 1),
            ("common", 2),
            ("database", 0),
            ("database", 1),
            ("database", 2),
            ("database", 3),
        ]:
            names = ("Folder",) if kind == "database" and mode == 1 else ("有効", "残存")
            values = ("0",) if len(names) == 1 else ("0", "1")
            source = fixture(kind, mode, names, values, name_count=1, value_count=1)
            if mode == 1 and kind == "common" or mode == 2 and kind == "database":
                source = fixture(kind, mode, ("無", "未", "不明", "残存"), ("1", "2", "3", "4"))
            with self.subTest(kind=kind, mode=mode):
                revised, _ = clean_unused_choices(source)
                self.assertEqual(clean_unused_choices(revised)[0], revised)
                boundary = "WoditorEvCOMMAND_START" if kind == "common" else "<<--CSV_START-->>"
                self.assertEqual(
                    source[source.index(boundary) :], revised[revised.index(boundary) :]
                )
