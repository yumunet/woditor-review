"""Bilingual alignment and conversion to application review items and diagnostics.

Parsing and safe writes are owned by woditor_parser; this module only adapts
source/translation pairs to the app's review model.
"""

from __future__ import annotations

import re
from array import array
from bisect import bisect_left
from collections import Counter, defaultdict
from dataclasses import asdict

from woditor_parser import (
    COMMAND,
    META,
    analyze,
    catalog,
    choice_count,
    choice_key,
    choice_mode,
    choice_record_active,
    command_display_pairs,
    command_info,
    command_infos,
    command_mask,
    decode,
    digest,
    fields,
    file_type,
    inspect_choices,
    metadata_values,
    reviewable_metadata,
    slot_policy,
    source_lines,
    text_cell,
    translation_warnings,
)
from woditor_parser import (
    JP as JP,
)
from woditor_parser import (
    metadata_allowed as metadata_allowed,
)
from woditor_parser import (
    render_file as render_file,
)
from woditor_parser import (
    special_strings as special_strings,
)

SCHEMA_VERSION = 1


def choice_notices(ja, en, kind):
    summary, errors = Counter(), []
    for language, text in (("日本語", ja), ("英語", en)):
        report = inspect_choices(text)
        if any(d["severity"] == "automatic" for d in report["diagnostics"]):
            line = (
                report["unused"][0]["line"]
                if report["unused"]
                else next(d["line"] for d in report["diagnostics"] if d["severity"] == "automatic")
            )
            summary[f"未使用の選択肢設定を無視しました（{language}、行 {line}）"] = len(
                report["changes"]
            )
        for diagnostic in report["diagnostics"]:
            if diagnostic["severity"] == "error":
                errors.append(f"{language}の{diagnostic['message']}")
            elif diagnostic["severity"] == "warning":
                summary[f"{language}の{diagnostic['message']}"] += 1
    if kind == "database":
        am, bm = metadata_values(ja), metadata_values(en)
        groups = {choice[1] for key in am.keys() | bm.keys() if (choice := choice_key(kind, key))}
        for group in groups:
            if choice_mode(kind, am, group) == choice_mode(kind, bm, group) == 1:
                key = f"CHOICE_NAME_{group}_0"
                if key in am and key in bm and am[key] != bm[key]:
                    summary["ファイル読み込みの既定フォルダパスが日英で異なります"] += 1
    return summary, errors


def aligned_metadata_record(kind, record, meta, other_meta):
    choice = choice_key(kind, record["key"])
    if not choice:
        return True
    family, group, index = choice
    if not choice_record_active(kind, record["key"], meta):
        return False
    if kind == "database" and choice_mode(kind, meta, group) == 1 and family == "NAME":
        return False  # Folder paths have their own configuration-difference notice.
    return (
        family != "VAL" and index != "NUM" or choice_mode(kind, other_meta, group) not in (None, 0)
    )


def records(text, parse):
    meta, commands = [], []
    page, saw_page_count = None, False
    for n, line in enumerate(source_lines(text), 1):
        if match := META.fullmatch(line):
            key, value = match.groups()
            if key == "EVENT_PAGE_NUM":
                saw_page_count = True
            if key == "EVENT_PAGE" and saw_page_count:
                page = value
            meta.append({"line": n, "key": key, "value": value, "scope": page})
        elif COMMAND.fullmatch(line):
            commands.append({"line": n, "raw": line, "scope": page, **parse(line)})
    return meta, commands


def command_key(command):
    nums = command["numbers"]
    # WOLF's newer export adds an explicit zero to legacy manual strings.
    if command["code"] == 122 and len(nums) == 2:
        nums = nums + [0]
    return (
        command["scope"],
        command["code"],
        command["depth"],
        tuple(nums),
        len(command["strings"]),
        command["raw"] if command["opaque"] else None,
    )


def pair_cost(a, b):
    if command_key(a) == command_key(b):
        return 0 if a["raw"] == b["raw"] else 1
    if (a["scope"], a["code"], a["depth"], len(a["strings"])) != (
        b["scope"],
        b["code"],
        b["depth"],
        len(b["strings"]),
    ):
        return 1000000
    if a["opaque"] or b["opaque"] or a["code"] in (401, 420, 421, 499):
        return 1000000
    # Do not treat image/resource modes as translated string pictures.
    if a["code"] == 150 and (
        not a["numbers"] or not b["numbers"] or a["numbers"][0] & 0x70 != b["numbers"][0] & 0x70
    ):
        return 1000000
    if a["code"] == 122 and (
        len(a["numbers"]) < 2
        or len(b["numbers"]) < 2
        or a["numbers"][1] & 0xFF != b["numbers"][1] & 0xFF
    ):
        return 1000000
    return 2


def unique_anchors(a, b):
    ak, bk = list(map(command_key, a)), list(map(command_key, b))
    ac, bc = Counter(ak), Counter(bk)
    positions = {key: j for j, key in enumerate(bk) if bc[key] == 1}
    candidates = [
        (i, positions[key]) for i, key in enumerate(ak) if ac[key] == 1 and key in positions
    ]
    # A longest increasing subsequence prevents crossing reordered anchors.
    tails, indices, previous = [], [], []
    for index, (_, j) in enumerate(candidates):
        rank = bisect_left(tails, j)
        previous.append(indices[rank - 1] if rank else -1)
        if rank == len(tails):
            tails.append(j)
            indices.append(index)
        else:
            tails[rank] = j
            indices[rank] = index
    result, index = [], indices[-1] if indices else -1
    while index >= 0:
        result.append(candidates[index])
        index = previous[index]
    return list(reversed(result))


def changed_span(a, b):
    """Return forced matches, definite deletions, and ambiguous source rows."""
    n, m = len(a), len(b)
    if not n:
        return {}, set(), set(), set()
    if not m:
        return {}, set(range(n)), set(), set()
    if n * m > 1000000:
        return {}, set(), set(range(n)), set(range(m))
    costs = [[pair_cost(x, y) for y in b] for x in a]
    forward = [array("I", (4 * j for j in range(m + 1)))]
    for i in range(n):
        row = array("I", [4 * (i + 1)] + [0] * m)
        prior = forward[-1]
        for j in range(m):
            row[j + 1] = min(prior[j] + costs[i][j], prior[j + 1] + 4, row[j] + 4)
        forward.append(row)
    backward = [None] * (n + 1)
    backward[n] = array("I", (4 * (m - j) for j in range(m + 1)))
    for i in range(n - 1, -1, -1):
        row = array("I", [0] * m + [4 * (n - i)])
        following = backward[i + 1]
        for j in range(m - 1, -1, -1):
            row[j] = min(following[j + 1] + costs[i][j], following[j] + 4, row[j + 1] + 4)
        backward[i] = row
    best = forward[n][m]
    mapping, removed, ambiguous, ambiguous_en = {}, set(), set(), set()
    for i in range(n):
        candidates = [
            j for j in range(m) if forward[i][j] + costs[i][j] + backward[i + 1][j + 1] == best
        ]
        deletion = any(forward[i][j] + 4 + backward[i + 1][j] == best for j in range(m + 1))
        if len(candidates) == 1 and not deletion:
            mapping[i] = candidates[0]
        elif not candidates:
            removed.add(i)
        else:
            ambiguous.add(i)
            ambiguous_en.update(candidates)
    if ambiguous:
        ambiguous_en.update(set(range(m)) - set(mapping.values()))
    return mapping, removed, ambiguous, ambiguous_en


def align_commands(a, b):
    if list(map(command_key, a)) == list(map(command_key, b)):
        return dict(enumerate(range(len(a)))), set(), set(), set()
    anchors = unique_anchors(a, b)
    if not anchors:
        return changed_span(a, b)
    mapping, removed, ambiguous, ambiguous_en = {}, set(), set(), set()
    lo_a = lo_b = 0
    for i, j in anchors + [(len(a), len(b))]:
        pairs, deleted, uncertain, uncertain_en = align_commands(a[lo_a:i], b[lo_b:j])
        mapping.update({lo_a + x: lo_b + y for x, y in pairs.items()})
        removed.update(lo_a + x for x in deleted)
        ambiguous.update(lo_a + x for x in uncertain)
        ambiguous_en.update(lo_b + x for x in uncertain_en)
        if i < len(a):
            mapping[i] = j
        lo_a, lo_b = i + 1, j + 1
    return mapping, removed, ambiguous, ambiguous_en


def inactive(key, meta):
    def count(name):
        value = meta.get(name)
        return int(value) if value is not None and re.fullmatch(r"\d+", value) else None

    for prefix, limit in [("VALINPUT_NAME_", "VALINPUT_NUM"), ("STRINPUT_NAME_", "STRINPUT_NUM")]:
        if key.startswith(prefix) and key[len(prefix) :].isdigit():
            n = count(limit)
            return n is not None and int(key[len(prefix) :]) >= n
    if match := re.fullmatch(r"(CHOICE_STR|CHOICE_NAME)_(\d+)_(\d+)", key):
        family, group, index = match.groups()
        n = count(f"{family}_{group}_NUM")
        if n is not None:
            return int(index) >= n
        if family == "CHOICE_STR":
            n = count("VALINPUT_NUM")
            return n is not None and int(group) >= n
    if match := re.fullmatch(r"ITEMNAME(\d+)", key):
        n = count("ITEM_NUM")
        return n is not None and int(match[1]) >= n
    return False


def align(ja, en, kind, parse, translation_lines):
    am, ac = records(ja, parse)
    bm, bc = records(en, parse)
    identity = {"common": "COMMON_ID", "map": "EVENT_ID", "database": "TYPE_ID"}[kind]
    ai = [m["value"] for m in am if m["key"] == identity]
    bi = [m["value"] for m in bm if m["key"] == identity]
    if len(ai) != 1 or ai != bi:
        raise ValueError(f"{identity}が一致しないため関連付けできません")
    ja_meta = {m["key"]: m["value"] for m in am if m["scope"] is None}
    en_meta = {m["key"]: m["value"] for m in bm if m["scope"] is None}
    amap, bmap = defaultdict(list), defaultdict(list)
    for record in am:
        if aligned_metadata_record(kind, record, ja_meta, en_meta):
            amap[record["scope"], record["key"]].append(record)
    for record in bm:
        if aligned_metadata_record(kind, record, en_meta, ja_meta):
            bmap[record["scope"], record["key"]].append(record)
    line_map, excluded, uncertain, uncertain_en = {}, {}, set(), set()
    summary, errors = (
        choice_notices(ja, en, kind) if kind in ("database", "common") else (Counter(), [])
    )
    for key, source in amap.items():
        target = bmap.get(key, [])
        if len(source) == len(target) == 1:
            a, b = source[0], target[0]
            line_map[a["line"]] = b["line"]
            if a["line"] != b["line"]:
                summary["設定キーによる行ずれ補正"] += 1
            if a["value"] != b["value"] and not reviewable_metadata(kind, a["key"], ja_meta):
                choice = choice_key(kind, a["key"])
                if (
                    not choice
                    or choice[2] != "NUM"
                    or choice_count(kind, a["key"], ja_meta)
                    != choice_count(kind, b["key"], en_meta)
                ):
                    summary["翻訳対象外の設定値が日英で異なります"] += 1
        elif not target:
            for record in source:
                unused = inactive(record["key"], en_meta)
                choice = choice_key(kind, record["key"])
                if choice and not reviewable_metadata(kind, record["key"], en_meta):
                    unused = True
                translated = bool(translation_lines.get(record["line"]))
                subject = "翻訳項目" if translated else "設定"
                excluded[record["line"]] = (
                    f"英語版で使用対象外になった{subject}"
                    if unused
                    else f"英語版に対応する{subject}がありません"
                )
                summary[excluded[record["line"]]] += 1
        else:
            uncertain.update(record["line"] for record in source)
            uncertain_en.update(record["line"] for record in target)
    for key in bmap:
        if key in amap:
            continue
        for record in bmap[key]:
            subject = (
                "翻訳項目"
                if reviewable_metadata(kind, record["key"], en_meta) and record["value"]
                else "設定"
            )
            summary[f"英語版だけの{subject}があります"] += 1
    pairs, removed, ambiguous, ambiguous_en = align_commands(ac, bc)
    for i, j in pairs.items():
        a, b = ac[i], bc[j]
        line_map[a["line"]] = b["line"]
        if a["line"] != b["line"]:
            summary["コマンド列による行ずれ補正"] += 1
        if command_key(a) != command_key(b):
            summary["コマンド引数が日英で異なります"] += 1
        elif a["numbers"] != b["numbers"]:
            summary["旧形式の文字列操作の引数形式の違いを吸収"] += 1
    for i in removed:
        count = translation_lines.get(ac[i]["line"], 0)
        reason = (
            "英語版に対応する翻訳項目がありません"
            if count
            else "英語版に対応するコマンドがありません"
        )
        excluded[ac[i]["line"]] = reason
        summary[reason] += count or 1
    uncertain.update(ac[i]["line"] for i in ambiguous)
    uncertain_en.update(bc[i]["line"] for i in ambiguous_en)
    matched_en = set(pairs.values())
    for j, command in enumerate(bc):
        if j not in matched_en:
            summary[
                "英語版だけのコメントがあります"
                if command["code"] == 103
                else "英語版だけのコマンドがあります"
            ] += 1
    # A merged display sequence preserves order in each language independently.
    display_pairs, x, y = [], 0, 0
    for i, j in sorted(pairs.items()) + [(len(ac), len(bc))]:
        display_pairs.extend((ac[n]["line"], None) for n in range(x, i))
        display_pairs.extend((None, bc[n]["line"]) for n in range(y, j))
        if i < len(ac):
            display_pairs.append((ac[i]["line"], bc[j]["line"]))
        x, y = i + 1, j + 1
    warnings = [f"{label}: {count}件" for label, count in summary.items()]
    if len(source_lines(ja)) != len(source_lines(en)):
        warnings.insert(
            0,
            f"原文部分の行数差を自動補正しました（日本語 {len(source_lines(ja))} / 英語 {len(source_lines(en))}）",
        )
    return {
        "lines": line_map,
        "excluded": excluded,
        "ambiguous": uncertain,
        "ambiguousEn": uncertain_en,
        "warnings": warnings,
        "errors": errors,
        "commands": display_pairs,
        "enCommands": {c["line"]: c for c in bc},
    }


def pair_cells(ja, en, warning_for):
    slots, errors, warnings = [], [], []
    try:
        a, b = catalog(ja), catalog(en)
    except ValueError as error:
        return slots, [f"CSVを解析できません: {error}"], warnings
    if (a is None) != (b is None):
        return slots, ["CSVセクションが一致しません"], warnings
    if a is None:
        return slots, errors, warnings
    if len(a["rows"]) != len(b["rows"]):
        errors.append(
            f"CSVのデータ件数が一致しません（日本語 {len(a['rows'])} / 英語 {len(b['rows'])}）"
        )
    non_text = 0
    for key, target in b["fields"].items():
        if target.get("dataName") and a["nameMode"] != 0:
            continue
        source = a["fields"].get(key)
        if source and text_cell(source) and source["value"] == "":
            continue
        if not text_cell(target):
            if source and not text_cell(source) and source["value"] != target["value"]:
                non_text += 1
            elif source and text_cell(source):
                errors.append(
                    f"行 {source['line']}: CSVの文字列項目が英語版では文字列ではありません（{key}）"
                )
            continue
        missing = not source or not text_cell(source)
        if missing:
            errors.append(f"英語行 {target['line']}: CSV文字列に対応する原文がありません（{key}）")
        source_value = "" if missing else source["value"]
        descriptor = target["csv"]
        title = (
            f"データ名 {descriptor['row']}"
            if descriptor["dataName"]
            else f"データ {descriptor['row']} / 項目 {descriptor['item']}"
        )
        slots.append(
            {
                "id": ("E:" if missing else "") + key,
                "key": key,
                "kind": "database_csv",
                "line": -target["line"] if missing else source["line"],
                "enLine": target["line"],
                "start": 0 if missing else source["start"],
                "end": 0 if missing else source["end"],
                "source": source_value,
                "translation": target["value"],
                "command": None,
                "title": title,
                "position": target["position"],
                "csv": descriptor,
                "warnings": [] if missing else warning_for(source_value, target["value"]),
                "fingerprint": digest(key + "\0" + source_value),
                **({"sourceMissing": True} if missing else {}),
            }
        )
    for key, source in a["fields"].items():
        if source.get("dataName") and b["nameMode"] != 0:
            continue
        if text_cell(source) and source["value"] != "" and key not in b["fields"]:
            errors.append(
                f"行 {source['line']}: 英語版に対応する翻訳項目がありません（CSV: {key}）"
            )
    if non_text:
        warnings.append(
            f"翻訳対象外の設定値が日英で異なります（CSVの数値・非文字列）: {non_text}件"
        )
    return slots, errors, warnings


def metadata_title(key: str) -> str:
    rules = [
        (r"VALINPUT_NAME_(\d+)", "数値引数名"),
        (r"STRINPUT_NAME_(\d+)", "文字列引数名"),
        (r"CHOICE_STR_(\d+)_(\d+)", "選択肢"),
        (r"CSELF_NAME_(\d+)", "セルフ変数名"),
        (r"ITEMNAME(\d+)", "項目名"),
        (r"CHOICE_NAME_(\d+)_(\d+)", "選択肢名"),
        (r"VMEMO_NAME_(\d+)", "変数名"),
    ]
    for pattern, title in rules:
        if m := re.fullmatch(pattern, key):
            if title == "選択肢名":
                return f"選択肢名 {int(m[1])}-{int(m[2]) + 1}"
            return (
                title
                + " "
                + "-".join(
                    str(int(n) + (0 if title in ("セルフ変数名", "項目名") else 1))
                    for n in m.groups()
                )
            )
    return {
        "EVENT_NAME": "イベント名",
        "COMMON_NAME": "コモンイベント名",
        "COMMON_EVENT_NAME": "コモンイベント名",
        "COMMONEVENT_NAME": "コモンイベント名",
        "TYPENAME": "タイプ名",
        "MEMO": "メモ",
        "RETURN_VAL_NAME": "返り値名",
        "DATANAME_LOAD_NAME": "データ名",
    }.get(key, "メタデータ")


def extract_source(text: str) -> dict:
    ftype = file_type(text)
    meta = metadata_values(text)
    slots, unhandled = analyze(text, ftype)
    infos = command_infos(text)
    included, excluded = [], []
    for s in slots:
        entry = asdict(s)
        entry["key"] = s.id.split(":", 1)[1]
        if s.kind == "metadata" and not reviewable_metadata(ftype, entry["key"], meta):
            choice = choice_key(ftype, entry["key"])
            reason = "データ名の参照先設定"
            if choice:
                reason = (
                    "ファイル読み込みの既定フォルダパス"
                    if ftype == "database" and choice_mode(ftype, meta, choice[1]) == 1
                    else "使用対象外の選択肢設定"
                )
            excluded.append({**entry, "reason": reason})
            continue
        info = infos.get(s.line)
        entry["command"] = info
        if info:
            position = int(entry["key"][1:])
            allowed, reason = slot_policy(info, position)
            entry["position"] = position
            if not allowed:
                excluded.append({**entry, "reason": reason})
                continue
        entry["title"] = (
            (info["kind"] or "コマンド文字列") if info else metadata_title(entry["key"])
        )
        included.append(entry)
    return {
        "type": ftype,
        "slots": included,
        "excluded": excluded,
        "unhandled": [{"line": n, "text": line} for n, line in unhandled],
        "commands": infos,
    }


def pair_file(path: str, ja_raw: bytes, en_raw: bytes) -> dict:
    ja, ja_bom = decode(ja_raw)
    en, en_bom = decode(en_raw)
    data = extract_source(ja)
    if file_type(en) != data["type"]:
        raise ValueError("日本語・英語のファイル形式が一致しません")
    analyze(en, data["type"])  # Validate CSV markers on the English side too.
    a, b = source_lines(ja), source_lines(en)
    alignment = align(ja, en, data["type"], command_info, Counter(s["line"] for s in data["slots"]))
    warnings = alignment["warnings"]
    errors = list(alignment["errors"])
    en_meta = metadata_values(en)

    # Newlines belong to each input version and are never normalized in storage.
    def endings(text):
        return [
            re.search(r"(\r\n|\r|\n)$", line)[0] if re.search(r"(\r\n|\r|\n)$", line) else ""
            for line in text.splitlines(keepends=True)
        ]

    ja_endings, en_endings = endings(ja), endings(en)
    if any(ja_endings[n - 1] != en_endings[e - 1] for n, e in alignment["lines"].items()):
        warnings.append("日本語と英語の改行形式が異なります（読み込み時の形式を保持）")
    slots = []
    for s in data["slots"]:
        en_line = alignment["lines"].get(s["line"])
        if en_line is None:
            reason = alignment["excluded"].get(
                s["line"], "対応候補が複数あり自動関連付けできません"
            )
            data["excluded"].append({**s, "reason": reason})
            if s["line"] in alignment["ambiguous"]:
                errors.append(f"行 {s['line']}（{s['title']}）: {reason}")
            continue
        line = b[en_line - 1]
        if s["kind"] == "metadata":
            translation = META.fullmatch(line)[2]
        else:
            m = COMMAND.fullmatch(line)
            spans = fields(m["args"])
            if spans is None or s["position"] > len(spans):
                raise ValueError(f"文字列スロットが一致しません（行 {s['line']}）")
            start, end = spans[s["position"] - 1]
            translation = m["args"][start:end]
        issues = translation_warnings(s["source"], translation)
        structure = command_mask(a[s["line"] - 1]) if s["command"] else s["key"]
        slots.append(
            {
                **s,
                "enLine": en_line,
                "translation": translation,
                "warnings": issues,
                "fingerprint": digest(s["key"] + "\0" + s["source"] + "\0" + (structure or "")),
            }
        )
    # Keep English candidates available for human review without inventing a
    # Japanese counterpart. Their negative context line identifies the existing
    # English-only display row; writes always use their real English line.
    for en_line in sorted(alignment["ambiguousEn"]):
        raw = b[en_line - 1]
        if match := META.fullmatch(raw):
            key, value = match.groups()
            values = (
                [(key, value, None, "metadata")]
                if reviewable_metadata(data["type"], key, en_meta)
                else []
            )
        else:
            info = alignment["enCommands"][en_line]
            values = [
                (f"S{index}", value, index, "command_string")
                for index, value in enumerate(info["strings"], 1)
                if value and slot_policy(info, index)[0]
            ]
        for key, value, position, kind in values:
            if not value:
                continue
            info = alignment["enCommands"].get(en_line) if kind == "command_string" else None
            structure = command_mask(raw) if info else key
            slots.append(
                {
                    "id": f"E{en_line:05d}:{key}",
                    "line": -en_line,
                    "enLine": en_line,
                    "start": 0,
                    "end": 0,
                    "source": "",
                    "sourceMissing": True,
                    "translation": value,
                    "kind": kind,
                    "key": key,
                    "position": position,
                    "command": info,
                    "title": (info["kind"] or "コマンド文字列") if info else metadata_title(key),
                    "warnings": [],
                    "fingerprint": digest("unpaired\0" + key + "\0" + (structure or "")),
                }
            )
    if data["type"] == "database":
        csv_slots, csv_errors, csv_warnings = pair_cells(ja, en, translation_warnings)
        slots.extend(csv_slots)
        errors.extend(csv_errors)
        warnings.extend(csv_warnings)
    slots.sort(key=lambda slot: (slot["enLine"], slot.get("position") or 0))
    items, serial = [], Counter()
    for s in slots:
        info = s["command"]
        prev = items[-1] if items else None
        if (
            info
            and info["code"] == 103
            and prev
            and prev["code"] == 103
            and prev["lastLine"] + 1 == s["line"]
            and prev["depth"] == info["depth"]
        ):
            prev["slotIds"].append(s["id"])
            prev["lastLine"] = s["line"]
            prev["lastEnLine"] = s["enLine"]
        else:
            title = s["title"]
            serial[title] += 1
            items.append(
                {
                    "id": "R:" + s["id"],
                    "slotIds": [s["id"]],
                    "title": f"{title} {serial[title]}" if info else title,
                    "code": info["code"] if info else None,
                    "depth": info["depth"] if info else None,
                    "lastLine": s["line"],
                    "lastEnLine": s["enLine"],
                    "approved": False,
                    "threads": [],
                    "changes": [],
                }
            )
    commands = []
    if data["type"] != "database":
        jp, ep = command_display_pairs(ja), command_display_pairs(en)
        jp = {n: (dn, display) for n, dn, display in jp}
        ep = {n: (dn, display) for n, dn, display in ep}
        for n, en_n in alignment["commands"]:
            dn, display = jp[n] if n is not None else (0, "")
            edn, edisplay = ep[en_n] if en_n is not None else (0, "")
            info = data["commands"][n] if n is not None else alignment["enCommands"][en_n]
            commands.append(
                {
                    **info,
                    "line": n if n is not None else -en_n,
                    "enLine": en_n,
                    "ja": display,
                    "en": edisplay,
                    "displayLineJa": dn,
                    "displayLineEn": edn,
                }
            )
    usages = {}
    if data["type"] == "common":
        for s in slots:
            if s["key"].startswith("CSELF_NAME_"):
                index = int(s["key"].split("_")[-1])
                num = re.compile(rf"(?<!\d){1600000 + index}(?!\d)")
                special = re.compile(rf"\\cself\[{index}\]", re.I)
                usages[s["id"]] = [
                    c["line"]
                    for c in commands
                    if c["line"] > 0
                    and (num.search(a[c["line"] - 1]) or special.search(a[c["line"] - 1]))
                ]
    if data["unhandled"]:
        warnings.append(f"未認識の日本語行: {len(data['unhandled'])}")
    return {
        "path": path,
        "type": data["type"],
        "jaText": ja,
        "enText": en,
        "jaBom": ja_bom,
        "enBom": en_bom,
        "sourceVersion": digest(ja),
        "version": digest(en),
        "slots": slots,
        "items": items,
        "commands": commands,
        "usages": usages,
        "excluded": data["excluded"],
        "warnings": warnings,
        "errors": errors,
    }
