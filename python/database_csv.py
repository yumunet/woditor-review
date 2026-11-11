"""Quoted database CSV cells with exact offsets; never rewrite numeric cells."""
import hashlib
import re

NAME_MARKER = '<<!--DATANAME--!>>'


def text_cell(cell):
    return cell['quoted'] or cell.get('dataName', False)


def catalog(text):
    start = re.search(r'^<<--CSV_START-->>\r?$', text, re.M)
    if not start:
        return None
    end = re.search(r'^<<--CSV_END-->>\r?$', text[start.end():], re.M)
    if not end:
        raise ValueError('CSV_ENDがありません')
    finish = start.end() + end.start()
    begin = start.end() + (1 if text[start.end():].startswith('\n') else 0)
    count = re.search(r'^ITEM_NUM=(\d+)\r?$', text[:start.start()], re.M)
    count = int(count[1]) if count else None
    mode = re.search(r'^DATANAME_LOAD_TYPE=(\d+)\r?$', text[:start.start()], re.M)
    mode = int(mode[1]) if mode else None
    rows, cells, i = [], [], begin
    line = len(re.findall(r'\r\n|\r|\n', text[:begin])) + 1
    while i < finish:
        cell_line, cell_start = line, i
        quoted = text[i] == '"'
        data_name = text.startswith(NAME_MARKER, i)
        if data_name:
            a = i + len(NAME_MARKER)
            while i < finish and text[i] not in '\r\n':
                i += 1
            b = i - int(i > a and text[i - 1] == ',')
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
                if text[i] == '\r' or text[i] == '\n' and (i == a or text[i - 1] != '\r'):
                    line += 1
                i += 1
            if i >= finish:
                raise ValueError(f'CSVの引用符が閉じていません（行 {cell_line}）')
            b = i
            value = text[a:b].replace('""', '"')
            i += 1
            while i < finish and text[i] in ' \t':
                i += 1
            if i < finish and text[i] not in ',\r\n':
                raise ValueError(f'CSVの区切りが不正です（行 {cell_line}）')
        else:
            a = i
            while i < finish and text[i] not in ',\r\n':
                if text[i] == '"':
                    raise ValueError(f'CSVの引用符が不正です（行 {cell_line}）')
                i += 1
            b, value = i, text[a:i]
        cells.append(dict(start=a, end=b, value=value, quoted=quoted, line=cell_line, dataName=data_name))
        if i < finish and text[i] == ',':
            i += 1
            continue
        if cells and not text_cell(cells[-1]) and not cells[-1]['value']:
            cells.pop()  # WOLF terminates CSV records with an extra comma.
        if cells or not rows:
            rows.append(cells)
        cells = []
        if i < finish:
            if text[i:i + 2] == '\r\n':
                i += 2
            else:
                i += 1
            line += 1
        if i == cell_start:
            raise ValueError('CSVの解析が進みません')
    if not rows:
        return dict(start=start.start(), begin=begin, end=finish, rows=[], fields={}, header=[], nameMode=mode)
    header, data = rows[0], rows[1:]
    if count is None:
        count = len(header)
    fields = {}
    for row, values in enumerate(data):
        name = values[-1] if values and values[-1].get('dataName') else None
        settings = values[:-1] if name else values
        if len(settings) != count:
            raise ValueError(f'CSVの列数が項目数と一致しません（データ {row}、行 {values[0]["line"]}）')
        for column, cell in enumerate(settings):
            key = f'CSV_D{row}_ITEM{column}'
            fields[key] = {**cell, 'key': key, 'position': column + 1,
                           'csv': {'row': row, 'item': column, 'dataName': False}}
        if name and mode == 0:
            key = f'CSV_D{row}_NAME'
            fields[key] = {**name, 'key': key, 'position': count + 1,
                           'csv': {'row': row, 'item': None, 'dataName': True}}
    return dict(start=start.start(), begin=begin, end=finish, rows=data, fields=fields, header=header, nameMode=mode)


def pair_cells(ja, en, warning_for):
    slots, errors, warnings = [], [], []
    try:
        a, b = catalog(ja), catalog(en)
    except ValueError as error:
        return slots, [f'CSVを解析できません: {error}'], warnings
    if (a is None) != (b is None):
        return slots, ['CSVセクションが一致しません'], warnings
    if a is None:
        return slots, errors, warnings
    if len(a['rows']) != len(b['rows']):
        errors.append(f'CSVのデータ件数が一致しません（日本語 {len(a["rows"])} / 英語 {len(b["rows"])}）')
    non_text = 0
    for key, target in b['fields'].items():
        if target.get('dataName') and a['nameMode'] != 0:
            continue
        source = a['fields'].get(key)
        if source and text_cell(source) and source['value'] == '':
            continue
        if not text_cell(target):
            if source and not text_cell(source) and source['value'] != target['value']:
                non_text += 1
            elif source and text_cell(source):
                errors.append(f'行 {source["line"]}: CSVの文字列項目が英語版では文字列ではありません（{key}）')
            continue
        missing = not source or not text_cell(source)
        if missing:
            errors.append(f'英語行 {target["line"]}: CSV文字列に対応する原文がありません（{key}）')
        source_value = '' if missing else source['value']
        descriptor = target['csv']
        title = f'データ名 {descriptor["row"]}' if descriptor['dataName'] else f'データ {descriptor["row"]} / 項目 {descriptor["item"]}'
        slots.append({'id': ('E:' if missing else '') + key, 'key': key, 'kind': 'database_csv',
                      'line': -target['line'] if missing else source['line'], 'enLine': target['line'],
                      'start': 0 if missing else source['start'], 'end': 0 if missing else source['end'],
                      'source': source_value, 'translation': target['value'], 'command': None,
                      'title': title, 'position': target['position'], 'csv': descriptor,
                      'warnings': [] if missing else warning_for(source_value, target['value']),
                      'fingerprint': hashlib.sha256((key + '\0' + source_value).encode()).hexdigest(),
                      **({'sourceMissing': True} if missing else {})})
    for key, source in a['fields'].items():
        if source.get('dataName') and b['nameMode'] != 0:
            continue
        if text_cell(source) and source['value'] != '' and key not in b['fields']:
            errors.append(f'行 {source["line"]}: 英語版に対応する翻訳項目がありません（CSV: {key}）')
    if non_text:
        warnings.append(f'翻訳対象外の設定値が日英で異なります（CSVの数値・非文字列）: {non_text}件')
    return slots, errors, warnings


def cell_for_key(text, key,section=None):
    section = catalog(text) if section is None else section
    cell = section and section['fields'].get(key)
    if not cell or not text_cell(cell):
        raise ValueError(f'CSV文字列の位置が一致しません: {key}')
    return cell


def masked_csv(text, section):
    begin=section['begin']
    return replace_spans(text[begin:],[(c['start']-begin,c['end']-begin,'{CSV_TEXT}') for c in section['fields'].values() if text_cell(c)])


def replace_spans(text,replacements):
    parts,cursor,seen=[],0,set()
    for a,b,value in sorted(replacements):
        if a<cursor or b<a or b>len(text) or (a,b) in seen:
            raise ValueError('翻訳範囲が重複または不正です')
        seen.add((a,b))
        parts.extend((text[cursor:a],value));cursor=b
    parts.append(text[cursor:])
    return ''.join(parts)
