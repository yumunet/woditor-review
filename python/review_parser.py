"""Read-only review adapter around the original WOLF translator parser.

Offsets are Python code-point offsets into the untouched decoded TXT. UI ids
are opaque; callers must never use them as JavaScript string offsets.
"""
from __future__ import annotations

import hashlib
import re
from collections import Counter
from dataclasses import asdict
from review_alignment import align,reviewable_metadata,metadata_values,database_choice_key,database_choice_mode
from database_csv import catalog, pair_cells,masked_csv,replace_spans,text_cell

from woditor_translation_tool import (
    COMMAND, META, JP, analyze, fields, file_type, command_mask,
    command_display_pairs, metadata_allowed, source_lines,
    validate_text,
)

SCHEMA_VERSION = 1
KINDS = {101: '文章の表示', 102: '選択肢', 103: 'コメント', 106: 'デバッグ文',
         112: '条件分岐（文字列）', 122: '文字列操作', 150: 'ピクチャ',
         210: 'コモンイベント', 211: 'コモンイベント', 212: 'ラベル',
         213: 'ラベルジャンプ', 250: 'DB操作', 300: 'コモンイベント'}


def decode(raw: bytes) -> tuple[str, bool]:
    """Only UTF-8, preserving original BOM in the file record."""
    return raw.decode('utf-8-sig'), raw.startswith(b'\xef\xbb\xbf')


def digest(value: str) -> str:
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


def special_strings(value: str) -> list[str]:
    ends, stack, result = {}, [], []
    for index, char in enumerate(value):
        if char == '[':
            stack.append(index)
        elif char == ']' and stack:
            ends[stack.pop()] = index + 1
    bare = ('\\\\', r'\!', r'\.', r'\^', r'\>', r'\<', r'\E', r'\N', r'\A+', r'\A-')
    index = 0
    while index < len(value):
        if value[index] == '\\':
            opened = index + 1
            while opened < len(value) and (value[opened].isalnum() or value[opened] in '_+-'):
                opened += 1
            end = ends.get(opened)
            if opened > index + 1 and opened < len(value) and value[opened] == '[' and end is not None:
                if value[index + 1:opened] != 'r':
                    result.append(value[index:end])
                index = end
                continue
            token = next((token for token in bare if value.startswith(token, index)), None)
            if token:
                result.append(token)
                index += len(token)
                continue
        elif value[index] == '<' and value[index:index + 3] in ('<L>', '<C>', '<R>'):
            result.append(value[index:index + 3])
            index += 3
            continue
        elif value[index] == '@' and index + 1 < len(value) and value[index + 1] in '0123456789':
            end = index + 2
            while end < len(value) and value[end] in '0123456789':
                end += 1
            result.append(value[index:end])
            index = end
            continue
        index += 1
    return result


def translation_warnings(source: str, translation: str) -> list[str]:
    return [] if special_strings(source) == special_strings(translation) else ['特殊文字列が原文と異なります']


def command_info(line: str, parent: int | None = None) -> dict:
    m = COMMAND.fullmatch(line)
    if not m:
        raise ValueError('Invalid encoded command')
    head = re.fullmatch(r'\[(\d+)\]\[([^]]*)\]<([^>]*)>\(([^)]*)\)\(', m['head'])
    if not head:
        raise ValueError('Invalid encoded command header')
    code, counts, depth, numeric = head.groups()
    spans = fields(m['args'])
    nums = [int(n) for n in numeric.split(',')] if numeric else []
    declared = [int(n) for n in counts.split(',')]
    if spans is not None and declared != [len(nums), len(spans)]:
        raise ValueError('Declared argument counts differ from actual arguments')
    code = int(code)
    kind = KINDS.get(code)
    if code == 401:
        kind = {112: '条件分岐（文字列）', 102: '選択肢'}.get(parent)
    return {'code': code, 'kind': kind, 'depth': int(depth), 'numbers': nums,
            'strings': [m['args'][a:b] for a, b in (spans or [])],
            'opaque': spans is None, 'parentCode': parent}


def slot_policy(info: dict, position: int) -> tuple[bool, str | None]:
    """1-based string position; DB assignment and call arguments stay separate."""
    code, nums = info['code'], info['numbers']
    if code == 250 and position in (2, 3, 4):
        return False, 'DBのタイプ・データ・項目の名前指定'
    if code == 300 and position == 1:
        return False, 'コモンイベントの名前指定'
    if code == 122 and (len(nums) < 2 or nums[1] & 0xff):
        return False, '手動文字列指定以外の文字列操作'
    if code == 150 and (not nums or nums[0] & 0x70 != 0x20):
        return False, '文字列ピクチャ以外（画像・リソース等）'
    if code == 401 and not info['kind']:
        return False, '文字列条件・選択肢の親コマンドが特定できない分岐'
    return True, None  # Other codes retain the original analyzer's JP-only policy.


def metadata_title(key: str) -> str:
    rules = [(r'VALINPUT_NAME_(\d+)', '数値引数名'), (r'STRINPUT_NAME_(\d+)', '文字列引数名'),
             (r'CHOICE_STR_(\d+)_(\d+)', '選択肢'), (r'CSELF_NAME_(\d+)', 'セルフ変数名'),
             (r'ITEMNAME(\d+)', '項目名'), (r'CHOICE_NAME_(\d+)_(\d+)', '選択肢名'),
             (r'VMEMO_NAME_(\d+)', '変数名')]
    for pattern, title in rules:
        if m := re.fullmatch(pattern, key):
            if title == '選択肢名':
                return f'選択肢名 {int(m[1])}-{int(m[2]) + 1}'
            return title + ' ' + '-'.join(str(int(n) + (0 if title in ('セルフ変数名', '項目名') else 1)) for n in m.groups())
    return {'EVENT_NAME': 'イベント名', 'COMMON_NAME': 'コモンイベント名',
            'COMMON_EVENT_NAME': 'コモンイベント名', 'COMMONEVENT_NAME': 'コモンイベント名',
            'TYPENAME': 'タイプ名', 'MEMO': 'メモ', 'RETURN_VAL_NAME': '返り値名',
            'DATANAME_LOAD_NAME': 'データ名'}.get(key, 'メタデータ')


def extract_source(text: str) -> dict:
    ftype = file_type(text)
    meta = metadata_values(text)
    slots, unhandled = analyze(text, ftype)
    lines = text.splitlines()
    infos, parents = {}, {}
    for n, line in enumerate(source_lines(text), 1):
        if line in ('WoditorEvCOMMAND_START', 'WoditorEvCOMMAND_END'):
            parents.clear()
        if COMMAND.fullmatch(line):
            info = command_info(line)
            depth = info['depth']
            if info['code'] == 401:
                info = command_info(line, parents.get(depth))
            elif info['code'] in (102, 111, 112):
                parents[depth] = info['code']
            elif info['code'] == 499:
                parents.pop(depth, None)
            infos[n] = info
    included, excluded = [], []
    for s in slots:
        entry = asdict(s)
        entry['key'] = s.id.split(':', 1)[1]
        if s.kind == 'metadata' and not reviewable_metadata(ftype, entry['key'], meta):
            choice = database_choice_key(entry['key']) if ftype == 'database' else None
            reason = 'データ名の参照先設定'
            if choice:
                reason = '直接入力の項目に残る選択肢名' if database_choice_mode(meta, choice[1]) == 0 else 'ファイル読み込みの既定フォルダパス'
            excluded.append({**entry, 'reason': reason})
            continue
        info = infos.get(s.line)
        entry['command'] = info
        if info:
            position = int(entry['key'][1:])
            allowed, reason = slot_policy(info, position)
            entry['position'] = position
            if not allowed:
                excluded.append({**entry, 'reason': reason})
                continue
        entry['title'] = (info['kind'] or 'コマンド文字列') if info else metadata_title(entry['key'])
        included.append(entry)
    return {'type': ftype, 'slots': included, 'excluded': excluded,
            'unhandled': [{'line': n, 'text': l} for n, l in unhandled],
            'commands': infos}


def pair_file(path: str, ja_raw: bytes, en_raw: bytes) -> dict:
    ja, ja_bom = decode(ja_raw)
    en, en_bom = decode(en_raw)
    data = extract_source(ja)
    if file_type(en) != data['type']:
        raise ValueError('日本語・英語のファイル形式が一致しません')
    analyze(en, data['type'])  # Validate CSV markers on the English side too.
    a, b = source_lines(ja), source_lines(en)
    alignment = align(ja, en, data['type'], command_info, Counter(s['line'] for s in data['slots']))
    warnings = alignment['warnings']
    errors = list(alignment['errors'])
    en_meta = metadata_values(en)
    # Newlines belong to each input version and are never normalized in storage.
    endings = lambda s: [re.search(r'(\r\n|\r|\n)$', l)[0] if re.search(r'(\r\n|\r|\n)$', l) else ''
                         for l in s.splitlines(keepends=True)]
    ja_endings, en_endings = endings(ja), endings(en)
    if any(ja_endings[n - 1] != en_endings[e - 1] for n, e in alignment['lines'].items()):
        warnings.append('日本語と英語の改行形式が異なります（読み込み時の形式を保持）')
    slots = []
    for s in data['slots']:
        en_line = alignment['lines'].get(s['line'])
        if en_line is None:
            reason = alignment['excluded'].get(s['line'], '対応候補が複数あり自動関連付けできません')
            data['excluded'].append({**s, 'reason': reason})
            if s['line'] in alignment['ambiguous']:
                errors.append(f'行 {s["line"]}（{s["title"]}）: {reason}')
            continue
        line = b[en_line - 1]
        if s['kind'] == 'metadata':
            translation = META.fullmatch(line)[2]
        else:
            m = COMMAND.fullmatch(line)
            spans = fields(m['args'])
            if spans is None or s['position'] > len(spans):
                raise ValueError(f'文字列スロットが一致しません（行 {s["line"]}）')
            start, end = spans[s['position'] - 1]
            translation = m['args'][start:end]
        issues = translation_warnings(s['source'], translation)
        structure = command_mask(a[s['line'] - 1]) if s['command'] else s['key']
        slots.append({**s, 'enLine': en_line, 'translation': translation, 'warnings': issues,
                      'fingerprint': digest(s['key'] + '\0' + s['source'] + '\0' + (structure or ''))})
    # Keep English candidates available for human review without inventing a
    # Japanese counterpart. Their negative context line identifies the existing
    # English-only display row; writes always use their real English line.
    for en_line in sorted(alignment['ambiguousEn']):
        raw = b[en_line - 1]
        if match := META.fullmatch(raw):
            key, value = match.groups()
            values = [(key, value, None, 'metadata')] if reviewable_metadata(data['type'], key, en_meta) else []
        else:
            info = alignment['enCommands'][en_line]
            values = [(f'S{index}', value, index, 'command_string')
                      for index, value in enumerate(info['strings'], 1)
                      if value and slot_policy(info, index)[0]]
        for key, value, position, kind in values:
            if not value:
                continue
            info = alignment['enCommands'].get(en_line) if kind == 'command_string' else None
            structure = command_mask(raw) if info else key
            slots.append({'id': f'E{en_line:05d}:{key}', 'line': -en_line, 'enLine': en_line,
                          'start': 0, 'end': 0, 'source': '', 'sourceMissing': True,
                          'translation': value, 'kind': kind, 'key': key, 'position': position,
                          'command': info, 'title': (info['kind'] or 'コマンド文字列') if info else metadata_title(key),
                          'warnings': [], 'fingerprint': digest('unpaired\0' + key + '\0' + (structure or ''))})
    if data['type'] == 'database':
        csv_slots,csv_errors,csv_warnings = pair_cells(ja,en,translation_warnings)
        slots.extend(csv_slots);errors.extend(csv_errors);warnings.extend(csv_warnings)
    slots.sort(key=lambda slot: (slot['enLine'], slot.get('position') or 0))
    items, serial = [], Counter()
    for s in slots:
        info = s['command']
        prev = items[-1] if items else None
        if (info and info['code'] == 103 and prev and prev['code'] == 103
                and prev['lastLine'] + 1 == s['line']
                and prev['depth'] == info['depth']):
            prev['slotIds'].append(s['id'])
            prev['lastLine'] = s['line']
            prev['lastEnLine'] = s['enLine']
        else:
            title = s['title']
            serial[title] += 1
            items.append({'id': 'R:' + s['id'], 'slotIds': [s['id']],
                          'title': f'{title} {serial[title]}' if info else title,
                          'code': info['code'] if info else None,
                          'depth': info['depth'] if info else None,
                          'lastLine': s['line'], 'lastEnLine': s['enLine'], 'approved': False, 'threads': [], 'changes': []})
    commands = []
    if data['type'] != 'database':
        jp, ep = command_display_pairs(ja), command_display_pairs(en)
        jp = {n: (dn, display) for n, dn, display in jp}
        ep = {n: (dn, display) for n, dn, display in ep}
        for n, en_n in alignment['commands']:
            dn, display = jp[n] if n is not None else (0, '')
            edn, edisplay = ep[en_n] if en_n is not None else (0, '')
            info = data['commands'][n] if n is not None else alignment['enCommands'][en_n]
            commands.append({**info, 'line': n if n is not None else -en_n, 'enLine': en_n,
                             'ja': display, 'en': edisplay, 'displayLineJa': dn, 'displayLineEn': edn})
    usages = {}
    if data['type'] == 'common':
        for s in slots:
            if s['key'].startswith('CSELF_NAME_'):
                index = int(s['key'].split('_')[-1])
                num = re.compile(rf'(?<!\d){1600000 + index}(?!\d)')
                special = re.compile(rf'\\cself\[{index}\]', re.I)
                usages[s['id']] = [c['line'] for c in commands
                                   if c['line'] > 0 and (num.search(a[c['line'] - 1]) or special.search(a[c['line'] - 1]))]
    if data['unhandled']:
        warnings.append(f'未認識の日本語行: {len(data["unhandled"])}')
    return {'path': path, 'type': data['type'], 'jaText': ja, 'enText': en,
            'jaBom': ja_bom, 'enBom': en_bom, 'sourceVersion': digest(ja), 'version': digest(en),
            'slots': slots, 'items': items, 'commands': commands, 'usages': usages,
            'excluded': data['excluded'], 'warnings': warnings, 'errors': errors}


def render_file(text: str, slots: list[dict]) -> dict:
    """Apply formal translations to a copy, preserving every protected section."""
    lines = text.splitlines(keepends=True)
    offsets, offset = [], 0
    for line in lines:
        offsets.append(offset)
        offset += len(line)
    replacements, edited = [], set()
    csv_section = catalog(text) if any(s['kind']=='database_csv' for s in slots) else None
    for slot in slots:
        n, value = slot.get('enLine', slot['line']), slot['translation']
        if not isinstance(value, str) or '\0' in value or slot['kind']!='database_csv' and any(c in value for c in ('\r', '\n')):
            raise ValueError('Translation must be a single encoded line')
        if slot['kind']=='database_csv':
            cell = csv_section['fields'].get(slot['key'])
            if not cell or not text_cell(cell):
                raise ValueError('CSV文字列の位置が一致しません')
            if cell.get('dataName') and any(c in value for c in ('\r', '\n')):
                raise ValueError('データ名には実際の改行を使用できません')
            replacements.append((cell['start'],cell['end'],value if cell.get('dataName') else value.replace('"','""')))
            continue
        line = lines[n - 1].rstrip('\r\n')
        if slot['kind'] == 'metadata':
            m = META.fullmatch(line)
            if not m or m[1] != slot['key']:
                raise ValueError('Metadata key mismatch during export')
            a, b = m.start(2), m.end(2)
        else:
            m = COMMAND.fullmatch(line)
            if not m or (spans := fields(m['args'])) is None:
                raise ValueError('Invalid command during export')
            a, b = spans[slot['position'] - 1]
            a += m.start('args'); b += m.start('args')
        replacements.append((offsets[n - 1] + a, offsets[n - 1] + b, value))
        edited.add(n)
    result = replace_spans(text,replacements)
    if csv_section is None:
        validate_text(text, result, edited)
    else:
        revised = catalog(result)
        validate_text(text[:csv_section['start']],result[:revised['start']],edited)
        if masked_csv(text,csv_section)!=masked_csv(result,revised):
            raise ValueError('CSVの行・列構造または数値・ヘッダーが変更されました')
    return {'text': result, 'version': digest(result), **({'csvLines':{key:cell['line'] for key,cell in catalog(result)['fields'].items() if text_cell(cell)}} if csv_section else {})}
