#!/usr/bin/env python3
"""WOLF RPG Editor text-export translator helper (stdlib-only, Python 3.10+).

Supports map events, common events, and database types. Extracts editable
Japanese strings to JSON, reapplies translations by exact position, verifies
that all other source content stays intact. Never edits database CSV or
COMMAND_TEXT sections; the latter is read only to display event context.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path

JP = re.compile(r"[\u3040-\u30ff\u3400-\u9fff\uff66-\uff9f]")
META = re.compile(r"^([A-Z][A-Z0-9_]*)=(.*)$")
COMMAND = re.compile(
    r"^(?P<head>\[\d+\]\[[^\]\r\n]*\]<[^>\r\n]*>\([^\)\r\n]*\)\()(?P<args>.*)\)$"
)
# Order more-specific variants before less-specific ones.
# Ruby \r[text,reading] is translatable and may be removed; other controls stay protected.
SPECIAL = re.compile(
    r"<<\\n>>|<\\n>|\\r\\n|\\n|\\r(?!\[)|"
    r"\\(?!r\[)[a-zA-Z][a-zA-Z0-9_]*\[[^\]\r\n]*\]|"
    r"<<[A-Z][A-Z0-9_]*>>|<DIR>|<(?!dqrt>)[A-Za-z][A-Za-z0-9_:-]*>|"
    r"%(?:\d+\$)?[-+ #0]*(?:\d+|\*)?(?:\.(?:\d+|\*))?[diuoxXfFeEgGaAcsp]|"
    r"@\d+"
)
COMMON_NAME_KEYS = {"COMMON_NAME", "COMMON_EVENT_NAME", "COMMONEVENT_NAME"}
MAP_KEYS = {"EVENT_NAME"}
DB_KEYS = {"TYPENAME", "MEMO", "DATANAME_LOAD_NAME"}
COMMON_KEYS = COMMON_NAME_KEYS | {"MEMO", "RETURN_VAL_NAME"}


def is_resource_metadata(key: str) -> bool:
    """Asset paths are runtime references, not localization strings."""
    return key == "GRAPHIC_FILENAME" or key.endswith((
        "_FILENAME", "_FILE", "_PATH", "_FOLDER", "_DIRECTORY"))


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
    bom, detected = next(((b, e) for b, e in (
        (b"\xef\xbb\xbf", "utf-8"), (b"\xff\xfe", "utf-16-le"),
        (b"\xfe\xff", "utf-16-be")) if raw.startswith(b)), (b"", None))
    payload = raw[len(bom):]
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
        if s[i] != ',':
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
        return (key in COMMON_KEYS or bool(re.fullmatch(
            r"(?:VALINPUT_NAME_\d+|STRINPUT_NAME_\d+|CHOICE_STR_\d+_\d+|CSELF_NAME_\d+)", key)))
    if ftype == "database":
        return (key in DB_KEYS or bool(re.fullmatch(
            r"(?:ITEMNAME\d+|CHOICE_NAME_\d+_\d+|VMEMO_NAME_\d+)", key)))
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
                        slots.append(Slot(f"L{num:05d}:{key}", num, a, a + len(value), value, "metadata"))
                elif not is_resource_metadata(key):
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
                            slots.append(Slot(f"L{num:05d}:S{i}", num, a, a + len(value),
                                              value, "command_string"))
                    if JP.search(line[:m.start("args")] + line[m.end("args"):]):
                        unhandled.append((num, line))
            else:
                unhandled.append((num, line))
        offset += len(complete)
    if in_csv or (saw_csv != csv_closed):
        raise ValueError("Unclosed CSV section")
    return slots, unhandled


def as_entry(s: Slot) -> dict:
    # Only fields needed by the translator. The original source determines all
    # structural information, and the line number is already encoded in id.
    return {"id": s.id, "source": s.source, "translation": None}


def extract(a: argparse.Namespace) -> None:
    src = Path(a.source)
    text, _, _, _ = file_read(src, a.encoding)
    ftype = file_type(text)
    slots, unhandled = analyze(text, ftype)
    result = {"entries": [as_entry(s) for s in slots]}
    dest = Path(a.out)
    if dest.exists():
        raise ValueError(f"Output already exists: {dest}")
    dest.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Extracted {len(slots)} Japanese entries ({ftype}); unrecognized lines: {len(unhandled)}")
    print(f"Saved template: {dest}")
    if ftype == "database":
        print("NOTE: <<--CSV_START-->> ... <<--CSV_END-->> is never parsed or translated.")
    if unhandled:
        for n, line in unhandled[:12]:
            print(f"WARNING: line {n}: {line[:120]}", file=sys.stderr)
        print("WARNING: apply will fail until unrecognized lines are resolved.", file=sys.stderr)


def normalize_translation(value: str, kind: str) -> str:
    if "\x00" in value:
        raise ValueError("NUL is not allowed")
    if kind == "command_string":
        if '\\"' in value:
            raise ValueError("Use a normal double quote in translation, not \\\"; it is converted to <dqrt>")
        return value.replace('"', '<dqrt>').replace('\r\n', '<\\n>').replace('\r', '<\\n>').replace('\n', '<\\n>')
    if '\r' in value or '\n' in value:
        raise ValueError("Metadata values cannot contain actual newline characters")
    return value


def tokens(value: str) -> list[str]:
    return [m.group(0) for m in SPECIAL.finditer(value)]


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
    return line[:m.start("args")] + val + line[m.end("args"):]


def validate_text(old: str, new: str, edited: set[int]) -> None:
    before = old.splitlines(keepends=True)
    after = new.splitlines(keepends=True)
    if len(before) != len(after):
        raise ValueError("Line count changed")
    for n, (b, c) in enumerate(zip(before, after), 1):
        ending = '\r\n' if b.endswith('\r\n') else '\n' if b.endswith('\n') else '\r' if b.endswith('\r') else ''
        if ending and not c.endswith(ending):
            raise ValueError(f"Line ending changed: line {n}")
        if not ending and c.endswith(('\r', '\n')):
            raise ValueError(f"Line ending added: line {n}")
        if n not in edited:
            if b != c:
                raise ValueError(f"Unintended change at line {n}")
            continue
        b = b.removesuffix(ending) if ending else b
        c = c.removesuffix(ending) if ending else c
        bm, cm = COMMAND.fullmatch(b), COMMAND.fullmatch(c)
        if bm:
            if command_mask(b) != command_mask(c):
                raise ValueError(f"Event command structure changed at line {n}")
        elif (mb := META.fullmatch(b)):
            mc = META.fullmatch(c)
            if not mc or mb.group(1) != mc.group(1):
                raise ValueError(f"Metadata key changed at line {n}")
        else:
            raise ValueError(f"Edited unexpected line {n}")
    for marker in ('[COMMAND_TEXT_START]', '<<--CSV_START-->>'):
        if (marker in old) != (marker in new):
            raise ValueError(f"Marker disappeared: {marker}")
        if marker in old and old[old.index(marker):] != new[new.index(marker):]:
            raise ValueError(f"Protected section changed: {marker}")


def apply(a: argparse.Namespace) -> None:
    src, dst = Path(a.source), Path(a.out)
    if src.resolve() == dst.resolve():
        raise ValueError("Refusing to overwrite original")
    if dst.exists() and not a.force:
        raise ValueError("Output exists (use --force if intentional)")
    text, enc, bom, _ = file_read(src, a.encoding)
    ftype = file_type(text)
    slots, unhandled = analyze(text, ftype)
    if unhandled:
        raise ValueError(f"{len(unhandled)} Japanese lines were not recognized (first at line {unhandled[0][0]})")
    data = json.loads(Path(a.translations).read_text(encoding="utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("Translation JSON must be an object")
    entries = data.get("entries")
    if not isinstance(entries, list) or len(entries) != len(slots):
        raise ValueError("Translation entry count does not match extracted entries")
    changes: list[tuple[Slot, str]] = []
    for s, obj in zip(slots, entries):
        if not isinstance(obj, dict):
            raise ValueError(f"Entry {s.id} is not an object")
        for key, expected in (("id", s.id), ("source", s.source)):
            if obj.get(key) != expected:
                raise ValueError(f"Entry {s.id}: original {key} was modified")
        if not isinstance(obj.get("translation"), str):
            raise ValueError(f"Entry {s.id} has no translation")
        val = normalize_translation(obj["translation"], s.kind)
        if tokens(s.source) != tokens(val):
            raise ValueError(f"Entry {s.id}: protected characters differ:\n  source={tokens(s.source)}\n  output={tokens(val)}")
        changes.append((s, val))
    result = text
    for s, val in reversed(changes):
        if result[s.start:s.end] != s.source:
            raise ValueError(f"Entry {s.id}: source text not found at its expected position")
        result = result[:s.start] + val + result[s.end:]
    validate_text(text, result, {s.line for s, _ in changes})
    output_bytes = bom + result.encode(enc)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(output_bytes)
    if dst.read_bytes() != output_bytes:
        raise ValueError("Read-back verification failed")
    print(f"Wrote {dst} | {ftype} | translated {len(changes)}")
    print("Verified: metadata and command structure, protected tokens, other lines, newlines, CSV/display sections")


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
        "WoditorEvCOMMAND_START", "WoditorEvCOMMAND_END",
        "[COMMAND_TEXT_START]", "[COMMAND_TEXT_END]",
    )
    try:
        start, end, display_start, display_end = (lines.index(m) for m in markers)
    except ValueError as e:
        raise ValueError("Event command or command-text section is missing") from e
    if not (start < end < display_start < display_end):
        raise ValueError("Unexpected event section order")
    encoded = [(i + 1, lines[i]) for i in range(start + 1, end)
               if lines[i].strip()]
    readable = [(i + 1, lines[i]) for i in range(display_start + 1, display_end)
                if lines[i].strip()]
    if len(encoded) != len(readable):
        raise ValueError(
            f"Cannot align commands with display text: {len(encoded)} encoded, "
            f"{len(readable)} displayed. Refusing an uncertain mapping."
        )
    for line_number, command in encoded:
        if not COMMAND.fullmatch(command):
            raise ValueError(f"Unexpected event command format at line {line_number}")
    return [(line_number, display_line_number, display)
            for (line_number, _), (display_line_number, display)
            in zip(encoded, readable)]


def show_context(lines: list[str], n: int, before: int, after: int) -> None:
    lo, hi = max(1, n-before), min(len(lines), n+after)
    for i in range(lo, hi+1):
        print(f"{i:5d} {'>>' if i == n else '  '} {lines[i-1]}")


def show_command_context(pairs: list[tuple[int, int, str]], raw_line: int,
                         before: int, after: int) -> None:
    index = next((i for i, (n, _, _) in enumerate(pairs) if n == raw_line), None)
    if index is None:
        raise ValueError(f"No displayed command matches source line {raw_line}")
    for i in range(max(0, index-before), min(len(pairs), index+after+1)):
        _, display_line, display = pairs[i]
        print(f"{display_line:5d} {'>>' if i == index else '  '} {display}")


def context(a: argparse.Namespace) -> None:
    text, _, _, _ = file_read(Path(a.source), a.encoding)
    ftype = file_type(text)
    slots, _ = analyze(text, ftype)
    by_id = {s.id: s for s in slots}
    if a.id not in by_id:
        raise ValueError(f"Unknown entry ID {a.id}")
    slot = by_id[a.id]
    if slot.kind == "command_string":
        show_command_context(command_display_pairs(text), slot.line, a.before, a.after)
    else:
        # Header names and memo fields aren't individual event commands.
        show_context(source_lines(text), slot.line, a.before, a.after)


def usage(a: argparse.Namespace) -> None:
    text, _, _, _ = file_read(Path(a.source), a.encoding)
    if file_type(text) != "common":
        raise ValueError("usage is for common events (COMMON_ID) only")
    index = a.index
    if not (0 <= index < 100):
        raise ValueError("Expected common self variable number 0-99")
    pairs = command_display_pairs(text)
    lines = text.splitlines()
    # Identify usage with encoded numeric operands to avoid ambiguities in
    # displayed labels. Show the matching human-readable commands instead.
    num = re.compile(rf'(?<!\d){1600000+index}(?!\d)')
    special = re.compile(rf'\\cself\[{index}\]', re.I)
    hits = [raw_line for raw_line, _, _ in pairs
            if num.search(lines[raw_line-1]) or special.search(lines[raw_line-1])]
    print(f"CSelf{index}: {len(hits)} matching commands")
    for line_number in hits[:a.limit]:
        print(f"\n--- usage from source line {line_number} (displayed command text) ---")
        show_command_context(pairs, line_number, a.before, a.after)
    if len(hits) > a.limit:
        print(f"\n... {len(hits)-a.limit} other occurrences; adjust --limit to see more")
    if not hits:
        print("No direct numeric or \\cself[n] matches; indirect references cannot be ruled out.")


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    subs = p.add_subparsers(dest="action", required=True)
    for name in ("extract", "apply", "context", "usage"):
        sub = subs.add_parser(name)
        sub.add_argument("source")
        sub.add_argument("--encoding", default="auto")
        if name == "extract":
            sub.add_argument("--out", required=True)
        elif name == "apply":
            sub.add_argument("translations")
            sub.add_argument("--out", required=True)
            sub.add_argument("--force", action="store_true")
        elif name == "context":
            sub.add_argument("--id", required=True)
            sub.add_argument("--before", type=int, default=8)
            sub.add_argument("--after", type=int, default=8)
        elif name == "usage":
            sub.add_argument("--index", type=int, required=True)
            sub.add_argument("--before", type=int, default=2)
            sub.add_argument("--after", type=int, default=2)
            sub.add_argument("--limit", type=int, default=12)
    a = p.parse_args()
    if any(getattr(a, x, 0) < 0 for x in ("before", "after", "limit")):
        p.error("Context sizes and limits must not be negative")
    try:
        {"extract": extract, "apply": apply, "context": context, "usage": usage}[a.action](a)
    except (ValueError, KeyError, TypeError, OSError, UnicodeError, json.JSONDecodeError) as e:
        p.exit(1, f"ERROR: {e}\n")


if __name__ == '__main__':
    main()
