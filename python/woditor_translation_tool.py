#!/usr/bin/env python3
"""Woditor new-translation extract/apply and context/usage CLI.

Requires only woditor_parser.py alongside this script. Python 3.10+, stdlib.
"""
from __future__ import annotations
import argparse
import json
import re
import sys
from pathlib import Path
from woditor_parser import (Slot, file_read, file_type, analyze, normalize_translation,
                            special_strings, validate_text, source_lines, command_display_pairs)

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
        if special_strings(s.source) != special_strings(val):
            raise ValueError(f"Entry {s.id}: protected characters differ:\n  source={special_strings(s.source)}\n  output={special_strings(val)}")
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
