"""Structural alignment of independently edited WOLF exports.

Unique metadata keys and ordered command anchors establish correspondence.
Within changed command spans, only pairs shared by every minimum-cost edit
alignment are accepted. Ambiguous spans do not invalidate the rest of a file.
"""
from array import array
from bisect import bisect_left
from collections import Counter, defaultdict
import re
from woditor_translation_tool import COMMAND, META, source_lines, metadata_allowed


def records(text, parse):
    meta, commands = [], []
    page, saw_page_count = None, False
    for n, line in enumerate(source_lines(text), 1):
        if match := META.fullmatch(line):
            key, value = match.groups()
            if key == 'EVENT_PAGE_NUM':
                saw_page_count = True
            if key == 'EVENT_PAGE' and saw_page_count:
                page = value
            meta.append({'line': n, 'key': key, 'value': value, 'scope': page})
        elif COMMAND.fullmatch(line):
            commands.append({'line': n, 'raw': line, 'scope': page, **parse(line)})
    return meta, commands


def command_key(command):
    nums = command['numbers']
    # WOLF's newer export adds an explicit zero to legacy manual strings.
    if command['code'] == 122 and len(nums) == 2:
        nums = nums + [0]
    return (command['scope'], command['code'], command['depth'], tuple(nums),
            len(command['strings']), command['raw'] if command['opaque'] else None)


def pair_cost(a, b):
    if command_key(a) == command_key(b):
        return 0 if a['raw'] == b['raw'] else 1
    if (a['scope'], a['code'], a['depth'], len(a['strings'])) != (b['scope'], b['code'], b['depth'], len(b['strings'])):
        return 1000000
    if a['opaque'] or b['opaque'] or a['code'] in (401, 420, 421, 499):
        return 1000000
    # Do not treat image/resource modes as translated string pictures.
    if a['code'] == 150 and (not a['numbers'] or not b['numbers'] or a['numbers'][0] & 0x70 != b['numbers'][0] & 0x70):
        return 1000000
    if a['code'] == 122 and (len(a['numbers']) < 2 or len(b['numbers']) < 2 or a['numbers'][1] & 0xff != b['numbers'][1] & 0xff):
        return 1000000
    return 2


def unique_anchors(a, b):
    ak, bk = list(map(command_key, a)), list(map(command_key, b))
    ac, bc = Counter(ak), Counter(bk)
    positions = {key: j for j, key in enumerate(bk) if bc[key] == 1}
    candidates = [(i, positions[key]) for i, key in enumerate(ak) if ac[key] == 1 and key in positions]
    # A longest increasing subsequence prevents crossing reordered anchors.
    tails, indices, previous = [], [], []
    for index, (_, j) in enumerate(candidates):
        rank = bisect_left(tails, j)
        previous.append(indices[rank - 1] if rank else -1)
        if rank == len(tails):
            tails.append(j); indices.append(index)
        else:
            tails[rank] = j; indices[rank] = index
    result, index = [], indices[-1] if indices else -1
    while index >= 0:
        result.append(candidates[index]); index = previous[index]
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
    forward = [array('I', (4 * j for j in range(m + 1)))]
    for i in range(n):
        row = array('I', [4 * (i + 1)] + [0] * m)
        prior = forward[-1]
        for j in range(m):
            row[j + 1] = min(prior[j] + costs[i][j], prior[j + 1] + 4, row[j] + 4)
        forward.append(row)
    backward = [None] * (n + 1)
    backward[n] = array('I', (4 * (m - j) for j in range(m + 1)))
    for i in range(n - 1, -1, -1):
        row = array('I', [0] * m + [4 * (n - i)])
        following = backward[i + 1]
        for j in range(m - 1, -1, -1):
            row[j] = min(following[j + 1] + costs[i][j], following[j] + 4, row[j + 1] + 4)
        backward[i] = row
    best = forward[n][m]
    mapping, removed, ambiguous, ambiguous_en = {}, set(), set(), set()
    for i in range(n):
        candidates = [j for j in range(m) if forward[i][j] + costs[i][j] + backward[i + 1][j + 1] == best]
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
        return int(value) if value is not None and re.fullmatch(r'\d+', value) else None
    for prefix, limit in [('VALINPUT_NAME_', 'VALINPUT_NUM'), ('STRINPUT_NAME_', 'STRINPUT_NUM')]:
        if key.startswith(prefix) and key[len(prefix):].isdigit():
            n = count(limit)
            return n is not None and int(key[len(prefix):]) >= n
    if match := re.fullmatch(r'(CHOICE_STR|CHOICE_NAME)_(\d+)_(\d+)', key):
        family, group, index = match.groups()
        n = count(f'{family}_{group}_NUM')
        if n is not None:
            return int(index) >= n
        if family == 'CHOICE_STR':
            n = count('VALINPUT_NUM')
            return n is not None and int(group) >= n
    if match := re.fullmatch(r'ITEMNAME(\d+)', key):
        n = count('ITEM_NUM')
        return n is not None and int(match[1]) >= n
    return False


def align(ja, en, kind, parse, translation_lines):
    am, ac = records(ja, parse)
    bm, bc = records(en, parse)
    identity = {'common': 'COMMON_ID', 'map': 'EVENT_ID', 'database': 'TYPE_ID'}[kind]
    ai = [m['value'] for m in am if m['key'] == identity]
    bi = [m['value'] for m in bm if m['key'] == identity]
    if len(ai) != 1 or ai != bi:
        raise ValueError(f'{identity}が一致しないため関連付けできません')
    amap, bmap = defaultdict(list), defaultdict(list)
    for record in am:
        amap[record['scope'], record['key']].append(record)
    for record in bm:
        bmap[record['scope'], record['key']].append(record)
    en_meta = {m['key']: m['value'] for m in bm if m['scope'] is None}
    line_map, excluded, uncertain, uncertain_en = {}, {}, set(), set()
    summary = Counter()
    for key, source in amap.items():
        target = bmap.get(key, [])
        if len(source) == len(target) == 1:
            a, b = source[0], target[0]
            line_map[a['line']] = b['line']
            if a['line'] != b['line']:
                summary['設定キーによる行ずれ補正'] += 1
            if a['value'] != b['value'] and not metadata_allowed(kind, a['key']):
                summary['翻訳対象外の設定値が日英で異なります'] += 1
        elif not target:
            for record in source:
                unused = inactive(record['key'], en_meta)
                translated = bool(translation_lines.get(record['line']))
                subject = '翻訳項目' if translated else '設定'
                excluded[record['line']] = f'英語版で使用対象外になった{subject}' if unused else f'英語版に対応する{subject}がありません'
                summary[excluded[record['line']]] += 1
        else:
            uncertain.update(record['line'] for record in source)
            uncertain_en.update(record['line'] for record in target)
    for key in bmap:
        if key in amap:
            continue
        for record in bmap[key]:
            subject = '翻訳項目' if metadata_allowed(kind, record['key']) and record['value'] else '設定'
            summary[f'英語版だけの{subject}があります'] += 1
    pairs, removed, ambiguous, ambiguous_en = align_commands(ac, bc)
    for i, j in pairs.items():
        a, b = ac[i], bc[j]
        line_map[a['line']] = b['line']
        if a['line'] != b['line']:
            summary['コマンド列による行ずれ補正'] += 1
        if command_key(a) != command_key(b):
            summary['コマンド引数が日英で異なります'] += 1
        elif a['numbers'] != b['numbers']:
            summary['旧形式の文字列操作の引数形式の違いを吸収'] += 1
    for i in removed:
        count = translation_lines.get(ac[i]['line'], 0)
        reason = '英語版に対応する翻訳項目がありません' if count else '英語版に対応するコマンドがありません'
        excluded[ac[i]['line']] = reason
        summary[reason] += count or 1
    uncertain.update(ac[i]['line'] for i in ambiguous)
    uncertain_en.update(bc[i]['line'] for i in ambiguous_en)
    matched_en = set(pairs.values())
    for j, command in enumerate(bc):
        if j not in matched_en:
            summary['英語版だけのコメントがあります' if command['code'] == 103 else '英語版だけのコマンドがあります'] += 1
    # A merged display sequence preserves order in each language independently.
    display_pairs, x, y = [], 0, 0
    for i, j in sorted(pairs.items()) + [(len(ac), len(bc))]:
        display_pairs.extend((ac[n]['line'], None) for n in range(x, i))
        display_pairs.extend((None, bc[n]['line']) for n in range(y, j))
        if i < len(ac):
            display_pairs.append((ac[i]['line'], bc[j]['line']))
        x, y = i + 1, j + 1
    warnings = [f'{label}: {count}件' for label, count in summary.items()]
    if len(source_lines(ja)) != len(source_lines(en)):
        warnings.insert(0, f'原文部分の行数差を自動補正しました（日本語 {len(source_lines(ja))} / 英語 {len(source_lines(en))}）')
    return {'lines': line_map, 'excluded': excluded, 'ambiguous': uncertain, 'ambiguousEn': uncertain_en,
            'warnings': warnings, 'commands': display_pairs, 'enCommands': {c['line']: c for c in bc}}
