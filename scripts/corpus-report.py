"""Reproduce corpus counts and every refusal without changing reference files."""

import hashlib
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import perf_counter

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "python"))
# The standalone script locates the sibling source modules before importing them.
from review_adapter import decode, extract_source, pair_file  # noqa: E402
from woditor_parser import file_type  # noqa: E402


def main():
    start = perf_counter()
    ja_root, en_root = ROOT / ".reference/ja-JP/texts", ROOT / ".reference/en-US/texts"
    if not ja_root.exists() or not en_root.exists():
        raise SystemExit("Reference corpus is not installed")
    types, paired, rejected, commands, excluded = [Counter() for _ in range(5)]
    errors, warnings, skipped, counts = [], [], [], Counter()
    ja_hash, en_hash = hashlib.sha256(), hashlib.sha256()
    for source in sorted(ja_root.rglob("*.txt")):
        path = source.relative_to(ja_root).as_posix()
        ja_raw, en_raw = source.read_bytes(), (en_root / path).read_bytes()
        ja_hash.update(path.encode())
        ja_hash.update(ja_raw)
        en_hash.update(path.encode())
        en_hash.update(en_raw)
        ja, _ = decode(ja_raw)
        try:
            kind = file_type(ja)
        except ValueError:
            skipped.append(path)
            continue
        types[kind] += 1
        data = extract_source(ja)
        counts["sourceOriginalSlots"] += len(data["slots"]) + len(data["excluded"])
        counts["sourceIncludedSlots"] += len(data["slots"])
        counts["sourceExcludedSlots"] += len(data["excluded"])
        counts["sourceUnhandledLines"] += len(data["unhandled"])
        commands.update(str(c["code"]) for c in data["commands"].values())
        excluded.update(s["reason"] for s in data["excluded"])
        try:
            result = pair_file(path, ja_raw, en_raw)
        except ValueError as error:
            rejected[kind] += 1
            errors.append({"path": path, "type": kind, "reason": str(error)})
            continue
        paired[kind] += 1
        if result["errors"]:
            counts["filesWithErrors"] += 1
        counts["diagnosticErrors"] += len(result["errors"])
        counts["alignmentExcludedSlots"] += len(result["excluded"]) - len(data["excluded"])
        for error in result["errors"]:
            errors.append({"path": path, "type": kind, "reason": error})
        if result["warnings"]:
            warnings.append({"path": path, "messages": result["warnings"]})
        counts["pairedSlots"] += len(result["slots"])
        counts["slotsWithoutSource"] += sum(bool(s.get("sourceMissing")) for s in result["slots"])
        counts["reviewItems"] += len(result["items"])
        counts["commentGroups"] += sum(len(i["slotIds"]) > 1 for i in result["items"])
        counts["selfVariablesWithMultipleUsages"] += sum(
            len(hits) > 1 for hits in result["usages"].values()
        )
        counts["slotsWithTokenWarnings"] += sum(bool(s["warnings"]) for s in result["slots"])
    output = {
        "generatedAt": datetime.now(timezone(timedelta(hours=9))).isoformat(),
        "sourceFiles": dict(types),
        "pairedFiles": dict(paired),
        "rejectedFiles": dict(rejected),
        "counts": dict(counts),
        "commandCounts": dict(commands),
        "excludedReasons": dict(excluded),
        "unsupportedFiles": skipped,
        "errors": errors,
        "warnings": warnings,
        "corpusSha256": {"ja": ja_hash.hexdigest(), "en": en_hash.hexdigest()},
        "nativeElapsedSeconds": round(perf_counter() - start, 3),
    }
    dest = ROOT / "docs/validation-corpus.json"
    dest.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                k: v
                for k, v in output.items()
                if k not in ("commandCounts", "errors", "warnings", "unsupportedFiles")
            },
            ensure_ascii=True,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
