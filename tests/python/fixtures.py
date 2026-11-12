"""Small, public inputs shared by parser/CLI tests and browser tests."""

import json
from pathlib import Path

PAIRS = json.loads(
    (Path(__file__).resolve().parents[1] / "fixtures/woditor.json").read_text(encoding="utf-8")
)


def text(name, language):
    return "\n".join(PAIRS[name][language]) + "\n"


def pair(name):
    from review_adapter import pair_file

    data = PAIRS[name]
    return pair_file(data["path"], text(name, "ja").encode(), text(name, "en").encode())


def event(commands, header="COMMON_ID=0"):
    return "\n".join(
        [
            header,
            "WoditorEvCOMMAND_START",
            *commands,
            "WoditorEvCOMMAND_END",
            "[COMMAND_TEXT_START]",
            *["表示" for _ in commands],
            "[COMMAND_TEXT_END]",
            "",
        ]
    )


def csv_fixture(name="名前", value="最初の行\r\n二行目"):
    return (
        "TYPE_ID=0\r\nITEM_NUM=2\r\nDATANAME_LOAD_TYPE=0\r\nITEMNAME0=説明\r\nITEMNAME1=数\r\n"
        '<<--CSV_START-->>\r\n"説明","数",\r\n'
        f'"{value.replace(chr(34), chr(34) * 2)}",123,<<!--DATANAME--!>>{name},\r\n"",5,<<!--DATANAME--!>>次,\r\n<<--CSV_END-->>\r\n'
    )
