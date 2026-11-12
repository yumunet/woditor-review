import unittest

from fixtures import event, text
from review_adapter import extract_source, metadata_title
from woditor_parser import analyze, command_info, decode, file_type, slot_policy


class MetadataTitleTests(unittest.TestCase):
    def test_self_variable_names_use_the_actual_zero_based_index(self):
        self.assertEqual(metadata_title("CSELF_NAME_0"), "セルフ変数名 0")
        self.assertEqual(metadata_title("CSELF_NAME_99"), "セルフ変数名 99")
        self.assertEqual(metadata_title("VALINPUT_NAME_0"), "数値引数名 1")
        self.assertEqual(metadata_title("ITEMNAME0"), "項目名 0")
        self.assertEqual(metadata_title("ITEMNAME37"), "項目名 37")

    def test_database_choice_field_numbers_start_at_zero_while_choices_keep_their_ordinals(self):
        self.assertEqual(metadata_title("CHOICE_NAME_0_0"), "選択肢名 0-1")
        self.assertEqual(metadata_title("CHOICE_NAME_12_2"), "選択肢名 12-3")
        self.assertEqual(metadata_title("CHOICE_STR_0_0"), "選択肢 1-1")


class ExtractionTests(unittest.TestCase):
    def test_source_offsets_and_exclusions_cover_each_supported_format(self):
        for name in ("map", "common", "database", "unused"):
            source = text(name, "ja")
            with self.subTest(name=name):
                kind = file_type(source)
                raw, unhandled = analyze(source, kind)
                result = extract_source(source)
                self.assertFalse(unhandled)
                self.assertEqual(len(raw), len(result["slots"]) + len(result["excluded"]))
                for slot in result["slots"]:
                    self.assertEqual(source[slot["start"] : slot["end"]], slot["source"])
                if kind == "database":
                    # extract_source handles metadata; pair_file adds CSV cells.
                    self.assertTrue(
                        all(s["start"] < source.index("<<--CSV_START-->>") for s in result["slots"])
                        if "<<--CSV_START-->>" in source
                        else True
                    )

    def test_command_families_and_reference_positions_use_encoded_commands(self):
        cases = [
            (101, "", "文章の表示"),
            (102, "", "選択肢"),
            (103, "", "コメント"),
            (106, "", "デバッグ文"),
            (250, "", "DB操作"),
            (122, "1,0", "文字列操作"),
            (112, "", "条件分岐（文字列）"),
            (150, "4128", "ピクチャ"),
            (212, "", "ラベル"),
            (213, "", "ラベルジャンプ"),
            (210, "", "コモンイベント"),
            (211, "", "コモンイベント"),
            (300, "", "コモンイベント"),
            (999, "", None),
        ]
        for code, numbers, title in cases:
            strings = '"代入文","参照名","項目名","データ名"' if code == 250 else '"名前","本文"'
            command = f"[{code}][{len(numbers.split(',')) if numbers else 0},{4 if code == 250 else 2}]<0>({numbers})({strings})"
            with self.subTest(code=code):
                result = extract_source(event([command]))
                info = next(iter(result["commands"].values()))
                self.assertEqual(info["code"], code)
                self.assertEqual(info["kind"], title)
                if code in (250, 300):
                    excluded = [s["position"] for s in result["excluded"]]
                    self.assertEqual(excluded, [2, 3, 4] if code == 250 else [1])


class CommandTests(unittest.TestCase):
    def test_nested_branch_parents_are_inferred_from_commands_and_cleared_at_their_end(self):
        source = event(
            [
                '[102][0,1]<0>()("選択")',
                '[401][0,1]<0>()("外側")',
                '[112][0,1]<1>()("条件")',
                '[401][0,1]<1>()("内側")',
                "[499][0,0]<1>()()",
                '[401][0,1]<1>()("終了後")',
                '[401][0,1]<0>()("外側再開")',
                "[499][0,0]<0>()()",
                "[111][0,0]<0>()()",
                '[401][0,1]<0>()("数値条件")',
            ]
        )
        result = extract_source(source)
        branches = [c for c in result["commands"].values() if c["code"] == 401]
        self.assertEqual([c["parentCode"] for c in branches], [102, 112, None, 102, 111])
        self.assertEqual(
            [c["kind"] for c in branches], ["選択肢", "条件分岐（文字列）", None, "選択肢", None]
        )
        self.assertEqual(
            [s["source"] for s in result["slots"] if s["command"]["code"] == 401],
            ["外側", "内側", "外側再開"],
        )
        self.assertEqual([s["source"] for s in result["excluded"]], ["終了後", "数値条件"])

    def test_first_bracket_is_code(self):
        info = command_info('[122][2,1]<2>(1600009,256)("test")')
        self.assertEqual(info["code"], 122)
        self.assertEqual(info["numbers"], [1600009, 256])
        self.assertTrue(slot_policy(info, 1)[0])

    def test_modes_and_positions(self):
        for code in (101, 102, 103, 106, 112, 212, 213, 210, 211, 300, 250):
            info = {"code": code, "numbers": [], "kind": "test"}
            self.assertEqual(slot_policy(info, 1)[0], code != 300)
        self.assertFalse(slot_policy({"code": 122, "numbers": [1, 1]}, 1)[0])
        self.assertTrue(slot_policy({"code": 150, "numbers": [4128]}, 1)[0])
        self.assertFalse(slot_policy({"code": 150, "numbers": [0]}, 1)[0])
        for position in (2, 3, 4):
            self.assertFalse(slot_policy({"code": 250, "numbers": []}, position)[0])
        self.assertTrue(slot_policy({"code": 300, "numbers": []}, 2)[0])

    def test_utf8_strict_and_bom(self):
        self.assertEqual(decode(b"\xef\xbb\xbftext"), ("text", True))
        with self.assertRaises(UnicodeDecodeError):
            decode(b"\xff")


if __name__ == "__main__":
    unittest.main()
