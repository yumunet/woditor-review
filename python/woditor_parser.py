"""Shared Woditor TXT/CSV parser and safe text rewriting (stdlib, Python 3.10+).

No CLI, application models, or bilingual alignment dependencies.
Offsets are Unicode code-point positions in the untouched decoded text.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass
from pathlib import Path

JP = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]")


META = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")


COMMAND = re.compile(r"^(?P<head>\[\d+\]\[[^\]\r\n]*\]<[^>\r\n]*>\([^\)\r\n]*\)\()(?P<args>.*)\)$")


COMMON_NAME_KEYS = {"COMMON_NAME", "COMMON_EVENT_NAME", "COMMONEVENT_NAME"}


MAP_KEYS = {"EVENT_NAME"}


DB_KEYS = {"TYPENAME", "MEMO", "DATANAME_LOAD_NAME"}


COMMON_KEYS = COMMON_NAME_KEYS | {"MEMO", "RETURN_VAL_NAME"}


def is_resource_metadata(key: str) -> bool:
    """Asset paths are runtime references, not localization strings."""
    return key == "GRAPHIC_FILENAME" or key.endswith(
        ("_FILENAME", "_FILE", "_PATH", "_FOLDER", "_DIRECTORY")
    )


@dataclass(frozen=True)
class Slot:
    id: str
    line: int
    start: int
    end: int
    source: str
    kind: str


def file_read(path: Path, enc_arg: str = "auto") -> tuple[str, str, bytes, bytes]:
    raw = path.read_bytes()
    bom, detected = next(
        (
            (b, e)
            for b, e in (
                (b"\xef\xbb\xbf", "utf-8"),
                (b"\xff\xfe", "utf-16-le"),
                (b"\xfe\xff", "utf-16-be"),
            )
            if raw.startswith(b)
        ),
        (b"", None),
    )
    payload = raw[len(bom) :]
    if enc_arg != "auto":
        enc = enc_arg
    elif detected:
        enc = detected
    else:
        try:
            payload.decode("utf-8")
            enc = "utf-8"
        except UnicodeDecodeError:
            enc = "cp932"
    return payload.decode(enc), enc, bom, raw


def fields(s: str) -> list[tuple[int, int]] | None:
    """Return string content spans within final (...)(\"...\",\"...\") group."""
    if not s.strip():
        return []
    result = []
    i = 0
    while i < len(s):
        while i < len(s) and s[i].isspace():
            i += 1
        if i >= len(s) or s[i] != '"':
            return None
        a = i + 1
        i = a
        while i < len(s):
            if s[i] == "\\" and i + 1 < len(s) and s[i + 1] == '"':
                i += 2
            elif s[i] == '"':
                break
            else:
                i += 1
        if i >= len(s):
            return None
        result.append((a, i))
        i += 1
        while i < len(s) and s[i].isspace():
            i += 1
        if i == len(s):
            return result
        if s[i] != ",":
            return None
        i += 1
        if not s[i:].strip():
            return None
    return result


def file_type(text: str) -> str:
    first = text.splitlines()[0] if text.splitlines() else ""
    if first.startswith("EVENT_ID=") or "\nEVENT_ID=" in text[:150]:
        return "map"
    if first.startswith("COMMON_ID="):
        return "common"
    if first.startswith("TYPE_ID="):
        return "database"
    raise ValueError("Unknown export type (expected EVENT_ID, COMMON_ID, or TYPE_ID)")


def metadata_allowed(ftype: str, key: str) -> bool:
    if ftype == "map":
        return key in MAP_KEYS
    if ftype == "common":
        return key in COMMON_KEYS or bool(
            re.fullmatch(
                r"(?:VALINPUT_NAME_\d+|STRINPUT_NAME_\d+|CHOICE_STR_\d+_\d+|CSELF_NAME_\d+)", key
            )
        )
    if ftype == "database":
        return key in DB_KEYS or bool(
            re.fullmatch(r"(?:ITEMNAME\d+|CHOICE_NAME_\d+_\d+|VMEMO_NAME_\d+)", key)
        )
    return False


def analyze(text: str, ftype: str) -> tuple[list[Slot], list[tuple[int, str]]]:
    slots: list[Slot] = []
    unhandled: list[tuple[int, str]] = []
    offset = 0
    in_csv = False
    saw_csv = False
    csv_closed = False
    for num, complete in enumerate(text.splitlines(keepends=True), 1):
        line = complete.rstrip("\r\n")
        if ftype in ("map", "common") and line == "[COMMAND_TEXT_START]":
            break
        if ftype == "database" and line == "<<--CSV_START-->>":
            if in_csv or saw_csv:
                raise ValueError("Duplicate CSV_START marker")
            saw_csv, in_csv = True, True
        elif ftype == "database" and line == "<<--CSV_END-->>":
            if not in_csv:
                raise ValueError("CSV_END without CSV_START")
            csv_closed, in_csv = True, False
        elif in_csv:
            pass  # CSV values and line breaks intentionally remain byte-identical.
        elif JP.search(line):
            m = META.fullmatch(line)
            if m:
                key, value = m.groups()
                if metadata_allowed(ftype, key):
                    if JP.search(value):
                        a = offset + len(key) + 1
                        slots.append(
                            Slot(f"L{num:05d}:{key}", num, a, a + len(value), value, "metadata")
                        )
                elif not is_resource_metadata(key) and not choice_key(ftype, key):
                    unhandled.append((num, line))
            elif ftype in ("map", "common") and (m := COMMAND.fullmatch(line)):
                arg = m.group("args")
                spans = fields(arg)
                if spans is None:
                    unhandled.append((num, line))
                else:
                    for i, (start, end) in enumerate(spans, 1):
                        value = arg[start:end]
                        if JP.search(value):
                            a = offset + m.start("args") + start
                            slots.append(
                                Slot(
                                    f"L{num:05d}:S{i}",
                                    num,
                                    a,
                                    a + len(value),
                                    value,
                                    "command_string",
                                )
                            )
                    if JP.search(line[: m.start("args")] + line[m.end("args") :]):
                        unhandled.append((num, line))
            else:
                unhandled.append((num, line))
        offset += len(complete)
    if in_csv or (saw_csv != csv_closed):
        raise ValueError("Unclosed CSV section")
    return slots, unhandled


def normalize_translation(value: str, kind: str) -> str:
    if "\x00" in value:
        raise ValueError("NUL is not allowed")
    if kind == "command_string":
        if '\\"' in value:
            raise ValueError(
                'Use a normal double quote in translation, not \\"; it is converted to <dqrt>'
            )
        return (
            value.replace('"', "<dqrt>")
            .replace("\r\n", "<\\n>")
            .replace("\r", "<\\n>")
            .replace("\n", "<\\n>")
        )
    if kind == "database_csv":
        return value
    if "\r" in value or "\n" in value:
        raise ValueError("Metadata values cannot contain actual newline characters")
    return value


def command_mask(line: str) -> str | None:
    m = COMMAND.fullmatch(line)
    if m is None:
        return None
    spans = fields(m.group("args"))
    if spans is None:
        return None
    val = m.group("args")
    for start, end in reversed(spans):
        val = val[:start] + "{TEXT}" + val[end:]
    return line[: m.start("args")] + val + line[m.end("args") :]


def validate_text(old: str, new: str, edited: set[int]) -> None:
    before = old.splitlines(keepends=True)
    after = new.splitlines(keepends=True)
    if len(before) != len(after):
        raise ValueError("Line count changed")
    for n, (b, c) in enumerate(zip(before, after, strict=True), 1):
        ending = (
            "\r\n"
            if b.endswith("\r\n")
            else "\n"
            if b.endswith("\n")
            else "\r"
            if b.endswith("\r")
            else ""
        )
        if ending and not c.endswith(ending):
            raise ValueError(f"Line ending changed: line {n}")
        if not ending and c.endswith(("\r", "\n")):
            raise ValueError(f"Line ending added: line {n}")
        if n not in edited:
            if b != c:
                raise ValueError(f"Unintended change at line {n}")
            continue
        b = b.removesuffix(ending) if ending else b
        c = c.removesuffix(ending) if ending else c
        bm = COMMAND.fullmatch(b)
        if bm:
            if command_mask(b) != command_mask(c):
                raise ValueError(f"Event command structure changed at line {n}")
        elif mb := META.fullmatch(b):
            mc = META.fullmatch(c)
            if not mc or mb.group(1) != mc.group(1):
                raise ValueError(f"Metadata key changed at line {n}")
        else:
            raise ValueError(f"Edited unexpected line {n}")
    for marker in ("[COMMAND_TEXT_START]", "<<--CSV_START-->>"):
        if (marker in old) != (marker in new):
            raise ValueError(f"Marker disappeared: {marker}")
        if marker in old and old[old.index(marker) :] != new[new.index(marker) :]:
            raise ValueError(f"Protected section changed: {marker}")


def source_lines(text: str) -> list[str]:
    """Source lines before the display-only COMMAND_TEXT or database CSV."""
    result = []
    for line in text.splitlines():
        if line in ("[COMMAND_TEXT_START]", "<<--CSV_START-->>"):
            break
        result.append(line)
    return result


def command_display_pairs(text: str) -> list[tuple[int, int, str]]:
    """Match each encoded event command to its human-readable command text.

    Both sections contain one line per command in the tested WOLF exports.
    Never guess a correspondence if their command counts differ.
    """
    lines = text.splitlines()
    markers = (
        "WoditorEvCOMMAND_START",
        "WoditorEvCOMMAND_END",
        "[COMMAND_TEXT_START]",
        "[COMMAND_TEXT_END]",
    )
    try:
        start, end, display_start, display_end = (lines.index(m) for m in markers)
    except ValueError as e:
        raise ValueError("Event command or command-text section is missing") from e
    if not (start < end < display_start < display_end):
        raise ValueError("Unexpected event section order")
    encoded = [(i + 1, lines[i]) for i in range(start + 1, end) if lines[i].strip()]
    readable = [
        (i + 1, lines[i]) for i in range(display_start + 1, display_end) if lines[i].strip()
    ]
    if len(encoded) != len(readable):
        raise ValueError(
            f"Cannot align commands with display text: {len(encoded)} encoded, "
            f"{len(readable)} displayed. Refusing an uncertain mapping."
        )
    for line_number, command in encoded:
        if not COMMAND.fullmatch(command):
            raise ValueError(f"Unexpected event command format at line {line_number}")
    return [
        (line_number, display_line_number, display)
        for (line_number, _), (display_line_number, display) in zip(encoded, readable, strict=True)
    ]


NAME_MARKER = "<<!--DATANAME--!>>"


def text_cell(cell):
    return cell["quoted"] or cell.get("dataName", False)


def catalog(text):
    start = re.search(r"^<<--CSV_START-->>\r?$", text, re.MULTILINE)
    if not start:
        return None
    end = re.search(r"^<<--CSV_END-->>\r?$", text[start.end() :], re.MULTILINE)
    if not end:
        raise ValueError("CSV_ENDがありません")
    finish = start.end() + end.start()
    begin = start.end() + (1 if text[start.end() :].startswith("\n") else 0)
    count = re.search(r"^ITEM_NUM=(\d+)\r?$", text[: start.start()], re.MULTILINE)
    count = int(count[1]) if count else None
    mode = re.search(r"^DATANAME_LOAD_TYPE=(\d+)\r?$", text[: start.start()], re.MULTILINE)
    mode = int(mode[1]) if mode else None
    rows, cells, i = [], [], begin
    line = len(re.findall(r"\r\n|\r|\n", text[:begin])) + 1
    while i < finish:
        cell_line, cell_start = line, i
        quoted = text[i] == '"'
        data_name = text.startswith(NAME_MARKER, i)
        if data_name:
            a = i + len(NAME_MARKER)
            while i < finish and text[i] not in "\r\n":
                i += 1
            b = i - int(i > a and text[i - 1] == ",")
            value = text[a:b]
        elif quoted:
            i += 1
            a = i
            while i < finish:
                if text[i] == '"':
                    if i + 1 < finish and text[i + 1] == '"':
                        i += 2
                        continue
                    break
                if text[i] == "\r" or text[i] == "\n" and (i == a or text[i - 1] != "\r"):
                    line += 1
                i += 1
            if i >= finish:
                raise ValueError(f"CSVの引用符が閉じていません（行 {cell_line}）")
            b = i
            value = text[a:b].replace('""', '"')
            i += 1
            while i < finish and text[i] in " \t":
                i += 1
            if i < finish and text[i] not in ",\r\n":
                raise ValueError(f"CSVの区切りが不正です（行 {cell_line}）")
        else:
            a = i
            while i < finish and text[i] not in ",\r\n":
                if text[i] == '"':
                    raise ValueError(f"CSVの引用符が不正です（行 {cell_line}）")
                i += 1
            b, value = i, text[a:i]
        cells.append(
            {
                "start": a,
                "end": b,
                "value": value,
                "quoted": quoted,
                "line": cell_line,
                "dataName": data_name,
            }
        )
        if i < finish and text[i] == ",":
            i += 1
            continue
        if cells and not text_cell(cells[-1]) and not cells[-1]["value"]:
            cells.pop()  # WOLF terminates CSV records with an extra comma.
        if cells or not rows:
            rows.append(cells)
        cells = []
        if i < finish:
            if text[i : i + 2] == "\r\n":
                i += 2
            else:
                i += 1
            line += 1
        if i == cell_start:
            raise ValueError("CSVの解析が進みません")
    if not rows:
        return {
            "start": start.start(),
            "begin": begin,
            "end": finish,
            "rows": [],
            "fields": {},
            "header": [],
            "nameMode": mode,
        }
    header, data = rows[0], rows[1:]
    if count is None:
        count = len(header)
    fields = {}
    for row, values in enumerate(data):
        name = values[-1] if values and values[-1].get("dataName") else None
        settings = values[:-1] if name else values
        if len(settings) != count:
            raise ValueError(
                f"CSVの列数が項目数と一致しません（データ {row}、行 {values[0]['line']}）"
            )
        for column, cell in enumerate(settings):
            key = f"CSV_D{row}_ITEM{column}"
            fields[key] = {
                **cell,
                "key": key,
                "position": column + 1,
                "csv": {"row": row, "item": column, "dataName": False},
            }
        if name and mode == 0:
            key = f"CSV_D{row}_NAME"
            fields[key] = {
                **name,
                "key": key,
                "position": count + 1,
                "csv": {"row": row, "item": None, "dataName": True},
            }
    return {
        "start": start.start(),
        "begin": begin,
        "end": finish,
        "rows": data,
        "fields": fields,
        "header": header,
        "nameMode": mode,
    }


def cell_for_key(text, key, section=None):
    section = catalog(text) if section is None else section
    cell = section and section["fields"].get(key)
    if not cell or not text_cell(cell):
        raise ValueError(f"CSV文字列の位置が一致しません: {key}")
    return cell


def masked_csv(text, section):
    begin = section["begin"]
    return replace_spans(
        text[begin:],
        [
            (c["start"] - begin, c["end"] - begin, "{CSV_TEXT}")
            for c in section["fields"].values()
            if text_cell(c)
        ],
    )


def replace_spans(text, replacements):
    parts, cursor, seen = [], 0, set()
    for a, b, value in sorted(replacements):
        if a < cursor or b < a or b > len(text) or (a, b) in seen:
            raise ValueError("翻訳範囲が重複または不正です")
        seen.add((a, b))
        parts.extend((text[cursor:a], value))
        cursor = b
    parts.append(text[cursor:])
    return "".join(parts)


def decode(raw: bytes) -> tuple[str, bool]:
    """Only UTF-8, preserving original BOM in the file record."""
    return raw.decode("utf-8-sig"), raw.startswith(b"\xef\xbb\xbf")


def digest(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def special_strings(value: str) -> list[str]:
    ends, stack, result = {}, [], []
    for index, char in enumerate(value):
        if char == "[":
            stack.append(index)
        elif char == "]" and stack:
            ends[stack.pop()] = index + 1
    bare = ("\\\\", r"\!", r"\.", r"\^", r"\>", r"\<", r"\E", r"\N", r"\A+", r"\A-")
    index = 0
    while index < len(value):
        if value[index] == "\\":
            opened = index + 1
            while opened < len(value) and (value[opened].isalnum() or value[opened] in "_+-"):
                opened += 1
            end = ends.get(opened)
            if (
                opened > index + 1
                and opened < len(value)
                and value[opened] == "["
                and end is not None
            ):
                if value[index + 1 : opened] != "r":
                    result.append(value[index:end])
                index = end
                continue
            token = next((token for token in bare if value.startswith(token, index)), None)
            if token:
                result.append(token)
                index += len(token)
                continue
        elif value[index] == "<" and value[index : index + 3] in ("<L>", "<C>", "<R>"):
            result.append(value[index : index + 3])
            index += 3
            continue
        elif value[index] == "@" and index + 1 < len(value) and value[index + 1] in "0123456789":
            end = index + 2
            while end < len(value) and value[end] in "0123456789":
                end += 1
            result.append(value[index:end])
            index = end
            continue
        index += 1
    return result


def translation_warnings(source: str, translation: str) -> list[str]:
    return (
        []
        if special_strings(source) == special_strings(translation)
        else ["特殊文字列が原文と異なります"]
    )


KINDS = {
    101: "文章の表示",
    102: "選択肢",
    103: "コメント",
    106: "デバッグ文",
    112: "条件分岐（文字列）",
    122: "文字列操作",
    150: "ピクチャ",
    210: "コモンイベント",
    211: "コモンイベント",
    212: "ラベル",
    213: "ラベルジャンプ",
    250: "DB操作",
    300: "コモンイベント",
}


def command_info(line: str, parent: int | None = None) -> dict:
    m = COMMAND.fullmatch(line)
    if not m:
        raise ValueError("Invalid encoded command")
    head = re.fullmatch(r"\[(\d+)\]\[([^]]*)\]<([^>]*)>\(([^)]*)\)\(", m["head"])
    if not head:
        raise ValueError("Invalid encoded command header")
    code, counts, depth, numeric = head.groups()
    spans = fields(m["args"])
    nums = [int(n) for n in numeric.split(",")] if numeric else []
    declared = [int(n) for n in counts.split(",")]
    if spans is not None and declared != [len(nums), len(spans)]:
        raise ValueError("Declared argument counts differ from actual arguments")
    code = int(code)
    kind = KINDS.get(code)
    if code == 401:
        kind = {112: "条件分岐（文字列）", 102: "選択肢"}.get(parent)
    return {
        "code": code,
        "kind": kind,
        "depth": int(depth),
        "numbers": nums,
        "strings": [m["args"][a:b] for a, b in (spans or [])],
        "opaque": spans is None,
        "parentCode": parent,
    }


def slot_policy(info: dict, position: int) -> tuple[bool, str | None]:
    """1-based string position; DB assignment and call arguments stay separate."""
    code, nums = info["code"], info["numbers"]
    if code == 250 and position in (2, 3, 4):
        return False, "DBのタイプ・データ・項目の名前指定"
    if code == 300 and position == 1:
        return False, "コモンイベントの名前指定"
    if code == 122 and (len(nums) < 2 or nums[1] & 0xFF):
        return False, "手動文字列指定以外の文字列操作"
    if code == 150 and (not nums or nums[0] & 0x70 != 0x20):
        return False, "文字列ピクチャ以外（画像・リソース等）"
    if code == 401 and not info["kind"]:
        return False, "文字列条件・選択肢の親コマンドが特定できない分岐"
    return True, None  # Other codes retain the original analyzer's JP-only policy.


def render_file(text: str, slots: list[dict]) -> dict:
    """Apply formal translations to a copy, preserving every protected section."""
    lines = text.splitlines(keepends=True)
    offsets, offset = [], 0
    for line in lines:
        offsets.append(offset)
        offset += len(line)
    replacements, edited = [], set()
    csv_section = catalog(text) if any(s["kind"] == "database_csv" for s in slots) else None
    for slot in slots:
        n, value = slot.get("enLine", slot["line"]), slot["translation"]
        if (
            not isinstance(value, str)
            or "\0" in value
            or slot["kind"] != "database_csv"
            and any(c in value for c in ("\r", "\n"))
        ):
            raise ValueError("Translation must be a single encoded line")
        if slot["kind"] == "database_csv":
            cell = csv_section["fields"].get(slot["key"])
            if not cell or not text_cell(cell):
                raise ValueError("CSV文字列の位置が一致しません")
            if cell.get("dataName") and any(c in value for c in ("\r", "\n")):
                raise ValueError("データ名には実際の改行を使用できません")
            replacements.append(
                (
                    cell["start"],
                    cell["end"],
                    value if cell.get("dataName") else value.replace('"', '""'),
                )
            )
            continue
        line = lines[n - 1].rstrip("\r\n")
        if slot["kind"] == "metadata":
            m = META.fullmatch(line)
            if not m or m[1] != slot["key"]:
                raise ValueError("Metadata key mismatch during export")
            a, b = m.start(2), m.end(2)
        else:
            m = COMMAND.fullmatch(line)
            if not m or (spans := fields(m["args"])) is None:
                raise ValueError("Invalid command during export")
            a, b = spans[slot["position"] - 1]
            a += m.start("args")
            b += m.start("args")
        replacements.append((offsets[n - 1] + a, offsets[n - 1] + b, value))
        edited.add(n)
    result = replace_spans(text, replacements)
    if csv_section is None:
        validate_text(text, result, edited)
    else:
        revised = catalog(result)
        validate_text(text[: csv_section["start"]], result[: revised["start"]], edited)
        if masked_csv(text, csv_section) != masked_csv(result, revised):
            raise ValueError("CSVの行・列構造または数値・ヘッダーが変更されました")
    return {
        "text": result,
        "version": digest(result),
        **(
            {
                "csvLines": {
                    key: cell["line"]
                    for key, cell in catalog(result)["fields"].items()
                    if text_cell(cell)
                }
            }
            if csv_section
            else {}
        ),
    }


def metadata_values(text):
    return {match[1]: match[2] for line in source_lines(text) if (match := META.fullmatch(line))}


def reviewable_metadata(kind, key, meta=None):
    if not metadata_allowed(kind, key) or kind == "database" and key == "DATANAME_LOAD_NAME":
        return False
    choice = choice_key(kind, key)
    if not choice:
        return True
    meta = meta or {}
    return (
        choice[0] != "VAL"
        and choice[2] != "NUM"
        and choice_mode(kind, meta, choice[1]) in ((1, 2) if kind == "common" else (2, 3))
        and choice_record_active(kind, key, meta)
    )


def choice_key(kind, key):
    family = "STR" if kind == "common" else "NAME" if kind == "database" else None
    match = re.fullmatch(rf"CHOICE_({family}|VAL)_(\d+)_(NUM|\d+)", key) if family else None
    return (match[1], int(match[2]), match[3]) if match else None


def choice_mode(kind, meta, group):
    limit = meta.get("VALINPUT_NUM" if kind == "common" else "ITEM_NUM")
    if (
        kind == "common"
        and group >= 5
        or limit is not None
        and re.fullmatch(r"\d+", limit)
        and group >= int(limit)
    ):
        return 0
    value = meta.get(f"LOADTYPE{group}" if kind == "common" else f"ITEM_LOADTYPE_{group}", "0")
    return (
        int(value)
        if re.fullmatch(r"\d+", value)
        and int(value) in ((0, 1, 2) if kind == "common" else (0, 1, 2, 3))
        else None
    )


def choice_record_active(kind, key, meta):
    choice = choice_key(kind, key)
    if not choice:
        return True
    _, group, index = choice
    if choice_mode(kind, meta, group) in (None, 0):
        return False
    if index == "NUM":
        return True
    count = choice_count(kind, key, meta)
    return count is None or int(index) < count


def choice_limit(kind, mode, family):
    return (
        3
        if mode == (1 if kind == "common" else 2)
        else 1
        if kind == "database" and mode == 1 and family == "VAL"
        else None
    )


def choice_count(kind, key, meta):
    family, group, _ = choice_key(kind, key)
    value = meta.get(f"CHOICE_{family}_{group}_NUM")
    count = int(value) if value is not None and re.fullmatch(r"\d+", value) else None
    maximum = choice_limit(kind, choice_mode(kind, meta, group), family)
    return maximum if count is None else count if maximum is None else min(count, maximum)


def choice_records(text):
    """Header-only records; offsets include each original line ending."""
    result = []
    offset = 0
    for number, complete in enumerate(text.splitlines(keepends=True), 1):
        line = complete.rstrip("\r\n")
        if line in (
            "WoditorEvCOMMAND_START",
            "[COMMAND_TEXT_START]",
            "<<--CSV_START-->>",
        ) or COMMAND.fullmatch(line):
            break
        if match := META.fullmatch(line):
            result.append(
                {
                    "key": match[1],
                    "value": match[2],
                    "line": number,
                    "start": offset,
                    "end": offset + len(complete),
                    "valueStart": offset + match.start(2),
                    "valueEnd": offset + match.end(2),
                }
            )
        offset += len(complete)
    return result


def inspect_choices(text):
    """Inspect a single export, without bilingual data or application modules.

    Automatic notices identify unused entries/counts only. Malformed active
    settings are errors and are never guessed or deleted by cleanup.
    """
    kind = file_type(text)
    records = choice_records(text)
    meta = {r["key"]: r["value"] for r in records}
    argument_count = meta.get("VALINPUT_NUM", "")
    argument_limit = int(argument_count) if re.fullmatch(r"\d+", argument_count) else None
    diagnostics = []
    unused = []
    changes = []
    groups = {}

    def issue(severity, message, record, group):
        diagnostics.append(
            {
                "severity": severity,
                "message": f"{message}（{'数値引数' if kind == 'common' else '項目'} {group}、行 {record['line']}）",
                "line": record["line"],
                "key": record["key"],
                "group": group,
            }
        )

    for record in records:
        if choice := choice_key(kind, record["key"]):
            groups.setdefault(choice[1], []).append((choice, record))
    # Validate explicitly configured modes even if they have no choice rows.
    for record in records:
        match = (
            re.fullmatch(
                r"LOADTYPE(\d+)" if kind == "common" else r"ITEM_LOADTYPE_(\d+)", record["key"]
            )
            if kind in ("common", "database")
            else None
        )
        if match and (kind != "common" or int(match[1]) < 5):
            groups.setdefault(int(match[1]), [])
    label = "STR" if kind == "common" else "NAME"
    for group, entries in sorted(groups.items()):
        change_start = len(changes)
        mode = choice_mode(kind, meta, group)
        anchor = (
            entries[0][1]
            if entries
            else next(
                r
                for r in records
                if r["key"]
                == (f"LOADTYPE{group}" if kind == "common" else f"ITEM_LOADTYPE_{group}")
            )
        )
        if mode is None:
            issue("error", "選択肢の入力形式が不正です", anchor, group)
            continue
        if mode == 0:
            reset_modes = []
            if (
                kind == "common"
                and group < 5
                and argument_limit is not None
                and group >= argument_limit
            ):
                reset_modes = [
                    r for r in records if r["key"] == f"LOADTYPE{group}" and r["value"] != "0"
                ]
                for record in reset_modes:
                    changes.append((record["valueStart"], record["valueEnd"], "0"))
            numbers = {}
            ignored = []
            for (family, _, index), record in entries:
                if index == "NUM":
                    if family in numbers:
                        changes.append((record["start"], record["end"], ""))
                    else:
                        numbers[family] = record
                        if record["value"] != "0":
                            changes.append((record["valueStart"], record["valueEnd"], "0"))
                else:
                    ignored.append(record)
                    unused.append(
                        {
                            **record,
                            "family": family,
                            "reason": "使用対象外の引数・項目または直接入力",
                        }
                    )
                    changes.append((record["start"], record["end"], ""))
            if len(changes) > change_start:
                details = f"ラベル {sum(r['key'].startswith('CHOICE_' + label + '_') for r in ignored)}件・内部値 {sum(r['key'].startswith('CHOICE_VAL_') for r in ignored)}件"
                if reset_modes:
                    details += "・入力形式を0へ補正"
                issue(
                    "automatic",
                    f"未使用の選択肢設定を無視しました（{details}）",
                    anchor if ignored or not reset_modes else reset_modes[0],
                    group,
                )
            continue
        counts = {}
        active = {}
        family_records = {}
        for family in (label, "VAL"):
            family_entries = [(index, record) for (f, _, index), record in entries if f == family]
            declared = [record for index, record in family_entries if index == "NUM"]
            values = [(int(index), record) for index, record in family_entries if index != "NUM"]
            family_records[family] = values
            if len(declared) > 1:
                issue("error", "選択肢の件数設定が重複しています", declared[1], group)
            if declared and not re.fullmatch(r"\d+", declared[0]["value"]):
                issue("error", "選択肢の件数が非負整数ではありません", declared[0], group)
                counts[family] = None
                active[family] = {}
                continue
            count = (
                int(declared[0]["value"])
                if declared
                else max((i + 1 for i, _ in values), default=0)
            )
            # Fixed-size reference arguments cannot use entries after index 2.
            # Folder internal values similarly have exactly one usable entry.
            maximum = choice_limit(kind, mode, family)
            if maximum is not None and count > maximum:
                count = maximum
                if declared:
                    changes.append((declared[0]["valueStart"], declared[0]["valueEnd"], str(count)))
            counts[family] = count
            active[family] = {}
            if not declared and values:
                issue(
                    "warning",
                    "選択肢の件数設定がありません（実際の添字を使用）",
                    values[0][1],
                    group,
                )
            for index, record in values:
                if index >= count:
                    unused.append({**record, "family": family, "reason": "有効件数の範囲外"})
                    changes.append((record["start"], record["end"], ""))
                    continue
                if index in active[family]:
                    issue("error", "有効な選択肢のキーが重複しています", record, group)
                active[family][index] = record
            if len(active[family]) != count:
                issue(
                    "error",
                    f"選択肢の件数と実際の設定が一致しません（{family}: 件数 {count}・実際 {len(active[family])}件）",
                    declared[0] if declared else anchor,
                    group,
                )
        if any(entry["group"] == group and entry["severity"] == "error" for entry in diagnostics):
            continue
        name_count, value_count = counts[label], counts["VAL"]
        reference = mode == (1 if kind == "common" else 2)
        if reference and (name_count not in (0, 3) or value_count != 3):
            issue(
                "error", "データベース参照はラベル0件または3件・内部値3件が必要です", anchor, group
            )
        elif kind == "database" and mode == 1:
            if name_count != 1 or value_count != 1 or len(family_records[label]) != 1:
                message = (
                    "ファイル読み込み設定に既定フォルダパスが複数あります"
                    if name_count > 1 or len(family_records[label]) > 1
                    else "ファイル読み込み設定は既定フォルダパス1件・内部値1件が必要です"
                )
                issue("error", message, anchor, group)
        elif not reference and name_count != value_count:
            issue("error", "選択肢のラベル数と内部値数が一致しません", anchor, group)
        ignored = [record for record in unused if choice_key(kind, record["key"])[1] == group]
        if len(changes) > change_start:
            issue(
                "automatic",
                f"未使用の選択肢設定を無視しました（有効件数の範囲外 {len(ignored)}件）",
                ignored[0] if ignored else anchor,
                group,
            )
    return {
        "type": kind,
        "diagnostics": diagnostics,
        "unused": unused,
        "changes": changes,
        "counts": {
            severity: sum(d["severity"] == severity for d in diagnostics)
            for severity in ("error", "warning", "automatic")
        },
    }


def clean_unused_choices(text):
    report = inspect_choices(text)
    if report["counts"]["error"]:
        raise ValueError(
            "有効な選択肢設定にエラーがあるため削除しません: "
            + next(d["message"] for d in report["diagnostics"] if d["severity"] == "error")
        )
    result = replace_spans(text, report["changes"])
    checked = inspect_choices(result)
    if checked["counts"]["error"] or checked["changes"]:
        raise ValueError("選択肢の削除後の検証に失敗しました")
    return result, report


def command_infos(text):
    """Parsed commands keyed by physical line, with branch parent information."""
    infos = {}
    parents = {}
    for number, line in enumerate(source_lines(text), 1):
        if line in ("WoditorEvCOMMAND_START", "WoditorEvCOMMAND_END"):
            parents.clear()
        if COMMAND.fullmatch(line):
            info = command_info(line)
            depth = info["depth"]
            if info["code"] == 401:
                info = command_info(line, parents.get(depth))
            elif info["code"] in (102, 111, 112):
                parents[depth] = info["code"]
            elif info["code"] == 499:
                parents.pop(depth, None)
            infos[number] = info
    return infos


def translation_slots(text):
    """Translation CLI extraction using the same eligibility as the app."""
    kind = file_type(text)
    meta = metadata_values(text)
    slots, unhandled = analyze(text, kind)
    infos = command_infos(text)
    selected = []
    for slot in slots:
        key = slot.id.split(":", 1)[1]
        if slot.kind == "metadata" and not reviewable_metadata(kind, key, meta):
            continue
        if slot.kind == "command_string" and not slot_policy(infos[slot.line], int(key[1:]))[0]:
            continue
        selected.append(slot)
    if kind == "database" and (section := catalog(text)):
        for key, cell in section["fields"].items():
            if text_cell(cell) and cell["value"] and JP.search(cell["value"]):
                selected.append(
                    Slot(
                        f"L{cell['line']:05d}:{key}",
                        cell["line"],
                        cell["start"],
                        cell["end"],
                        cell["value"],
                        "database_csv",
                    )
                )
    return sorted(selected, key=lambda slot: slot.start), unhandled
