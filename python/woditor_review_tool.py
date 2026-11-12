#!/usr/bin/env python3
"""Assemble and validate review JSON; write revised TXT only to a new folder.

AI supplies decisions and translation edits. This helper only assembles,
checks IDs/versions and applies explicit edits. Python 3.10+, stdlib only.
"""
from __future__ import annotations
import argparse
import json
import re
from uuid import uuid4
from pathlib import Path, PurePosixPath
from woditor_parser import decode, digest, render_file, special_strings, catalog, cell_for_key, COMMAND, META, fields

_SCHEMAS = json.loads(r'''
{
  "review-request.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "woditor-review/request/v1",
    "type": "object",
    "required": [
      "schemaVersion",
      "requestId",
      "createdAt",
      "entries"
    ],
    "additionalProperties": false,
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "requestId": {
        "type": "string",
        "minLength": 1
      },
      "createdAt": {
        "type": "string"
      },
      "entries": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "path",
            "fileVersion",
            "itemId",
            "slotIds",
            "commentId",
            "slots",
            "posts",
            "context"
          ],
          "properties": {
            "path": {
              "type": "string"
            },
            "fileVersion": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "itemId": {
              "type": "string"
            },
            "slotIds": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "commentId": {
              "type": "string",
              "minLength": 1
            },
            "slots": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "id",
                  "source",
                  "translation",
                  "line",
                  "key",
                  "kind"
                ],
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "source": {
                    "type": "string"
                  },
                  "translation": {
                    "type": "string"
                  },
                  "line": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "key": {
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "metadata",
                      "command_string",
                      "database_csv"
                    ]
                  },
                  "position": {
                    "type": "integer",
                    "minimum": 1
                  }
                }
              }
            },
            "pendingChanges": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "id",
                  "slotId",
                  "before",
                  "after"
                ],
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "slotId": {
                    "type": "string"
                  },
                  "before": {
                    "type": "string"
                  },
                  "after": {
                    "type": "string"
                  }
                }
              }
            },
            "posts": {
              "type": "array",
              "items": {
                "type": "object",
                "required": [
                  "id",
                  "author",
                  "text",
                  "createdAt"
                ],
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "author": {
                    "enum": [
                      "user",
                      "ai"
                    ]
                  },
                  "text": {
                    "type": "string"
                  },
                  "createdAt": {
                    "type": "string"
                  },
                  "decision": {
                    "enum": [
                      "accepted",
                      "rejected",
                      "partial",
                      "needs_review"
                    ]
                  },
                  "requestId": {
                    "type": "string"
                  }
                }
              }
            },
            "context": {
              "type": "array",
              "items": {
                "type": "object"
              }
            }
          }
        }
      },
      "mode": {
        "enum": [
          "comments",
          "initial"
        ]
      },
      "targets": {
        "type": "array",
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": [
            "path",
            "fileVersion",
            "sourceVersion",
            "itemId",
            "title",
            "slotIds",
            "slots",
            "context",
            "threads",
            "pendingChanges"
          ],
          "properties": {
            "path": {
              "type": "string"
            },
            "fileVersion": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "itemId": {
              "type": "string"
            },
            "slotIds": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "slots": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "id",
                  "source",
                  "translation",
                  "line",
                  "key",
                  "kind"
                ],
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "source": {
                    "type": "string"
                  },
                  "translation": {
                    "type": "string"
                  },
                  "line": {
                    "type": "integer",
                    "minimum": 1
                  },
                  "key": {
                    "type": "string"
                  },
                  "kind": {
                    "enum": [
                      "metadata",
                      "command_string",
                      "database_csv"
                    ]
                  },
                  "position": {
                    "type": "integer",
                    "minimum": 1
                  }
                }
              }
            },
            "pendingChanges": {
              "type": "array",
              "items": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "id",
                  "slotId",
                  "before",
                  "after"
                ],
                "properties": {
                  "id": {
                    "type": "string"
                  },
                  "slotId": {
                    "type": "string"
                  },
                  "before": {
                    "type": "string"
                  },
                  "after": {
                    "type": "string"
                  }
                }
              }
            },
            "context": {
              "type": "array",
              "items": {
                "type": "object"
              }
            },
            "sourceVersion": {
              "type": "string",
              "pattern": "^[a-f0-9]{64}$"
            },
            "title": {
              "type": "string"
            },
            "threads": {
              "type": "array",
              "items": {
                "type": "object"
              }
            }
          }
        }
      }
    }
  },
  "review-response.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "woditor-review/response/v1",
    "title": "Woditor Review response",
    "type": "object",
    "additionalProperties": false,
    "required": [
      "schemaVersion",
      "requestId",
      "responses",
      "suggestions"
    ],
    "properties": {
      "schemaVersion": {
        "const": 1
      },
      "requestId": {
        "type": "string",
        "minLength": 1
      },
      "responses": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/response"
        }
      },
      "suggestions": {
        "type": "array",
        "items": {
          "$ref": "#/$defs/suggestion"
        }
      }
    },
    "$defs": {
      "change": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "slotId",
          "before",
          "after"
        ],
        "properties": {
          "slotId": {
            "type": "string"
          },
          "before": {
            "type": "string"
          },
          "after": {
            "type": "string"
          }
        }
      },
      "response": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "commentId",
          "path",
          "itemId",
          "fileVersion",
          "decision",
          "reason",
          "changes"
        ],
        "properties": {
          "commentId": {
            "type": "string",
            "minLength": 1
          },
          "path": {
            "type": "string",
            "minLength": 1
          },
          "itemId": {
            "type": "string",
            "minLength": 1
          },
          "fileVersion": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "decision": {
            "enum": [
              "accepted",
              "rejected",
              "partial",
              "needs_review"
            ]
          },
          "reason": {
            "type": "string",
            "minLength": 1
          },
          "explanation": {
            "type": "string"
          },
          "changes": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/change"
            }
          }
        }
      },
      "suggestion": {
        "type": "object",
        "additionalProperties": false,
        "required": [
          "id",
          "path",
          "itemId",
          "fileVersion",
          "reason",
          "changes"
        ],
        "properties": {
          "id": {
            "type": "string",
            "minLength": 1
          },
          "path": {
            "type": "string",
            "minLength": 1
          },
          "itemId": {
            "type": "string",
            "minLength": 1
          },
          "fileVersion": {
            "type": "string",
            "pattern": "^[a-f0-9]{64}$"
          },
          "reason": {
            "type": "string",
            "minLength": 1
          },
          "changes": {
            "type": "array",
            "items": {
              "$ref": "#/$defs/change"
            }
          }
        }
      }
    }
  }
}
''')


def read(path: str | Path):
    return json.loads(Path(path).read_text(encoding='utf-8-sig'))


def read_schema(name: str):
    return _SCHEMAS[name]


def check_schema(data, schema: dict, root: dict | None = None, location: str = '$'):
    root = root or schema
    if '$ref' in schema:
        target = root
        for key in schema['$ref'].removeprefix('#/').split('/'):
            target = target[key]
        return check_schema(data, target, root, location)
    types = {'object': dict, 'array': list, 'string': str, 'integer': int}
    if 'type' in schema and (not isinstance(data, types[schema['type']]) or schema['type'] == 'integer' and isinstance(data, bool)):
        raise ValueError(f'{location}: expected {schema["type"]}')
    if 'const' in schema and (type(data) is not type(schema['const']) or data != schema['const']):
        raise ValueError(f'{location}: invalid constant')
    if 'enum' in schema and data not in schema['enum']:
        raise ValueError(f'{location}: unknown value')
    if isinstance(data, str):
        if len(data) < schema.get('minLength', 0) or 'pattern' in schema and not re.search(schema['pattern'], data):
            raise ValueError(f'{location}: invalid string')
    if isinstance(data, int) and data < schema.get('minimum', data):
        raise ValueError(f'{location}: below minimum')
    if isinstance(data, dict):
        for key in schema.get('required', []):
            if key not in data:
                raise ValueError(f'{location}: missing {key}')
        props = schema.get('properties', {})
        if schema.get('additionalProperties') is False and set(data) - set(props):
            raise ValueError(f'{location}: unexpected fields')
        for key, value in data.items():
            if key in props:
                check_schema(value, props[key], root, f'{location}.{key}')
    if isinstance(data, list) and 'items' in schema:
        for i, value in enumerate(data):
            check_schema(value, schema['items'], root, f'{location}[{i}]')


def validate_edits(entry: dict, edits: list, changed: set, initial=False):
    slots = {s['id']: s for s in entry['slots']}
    pending = {c['slotId'] for c in entry.get('pendingChanges', [])}
    for edit in edits:
        key = (entry['path'], edit['slotId'])
        slot = slots.get(edit['slotId'])
        if key in changed or slot is None or edit['slotId'] not in entry['slotIds'] or slot['translation'] != edit['before']:
            raise ValueError('Duplicate/unknown slot or changed before text')
        if initial and edit['slotId'] in pending:
            raise ValueError('Slot already has a pending change')
        if '\0' in edit['after'] or (slot['kind'] != 'database_csv' or re.fullmatch(r'CSV_D\d+_NAME', slot['key'])) and any(c in edit['after'] for c in ('\r', '\n')):
            raise ValueError('Use encoded newlines, not literal newlines')
        changed.add(key)


def validate(request: dict, response: dict):
    check_schema(request, read_schema('review-request.schema.json'))
    check_schema(response, read_schema('review-response.schema.json'))
    if request['requestId'] != response['requestId']:
        raise ValueError('Request ID mismatch')
    if request.get('mode') == 'initial':
        if request['entries'] or not request.get('targets') or response['responses']:
            raise ValueError('Initial review requires targets and no comment responses')
        seen, changed = set(), set()
        for suggestion in response['suggestions']:
            if suggestion['id'] in seen:
                raise ValueError('Duplicate suggestion ID')
            seen.add(suggestion['id'])
            target = next((t for t in request['targets'] if all(t[k] == suggestion[k] for k in ('path', 'itemId', 'fileVersion'))), None)
            if target is None:
                raise ValueError('Unknown initial review target')
            validate_edits(target, suggestion['changes'], changed, initial=True)
        return
    entries = {e['commentId']: e for e in request['entries']}
    if len(entries) != len(request['entries']):
        raise ValueError('Duplicate request comment ID')
    answers, changed = set(), set()
    for answer in response['responses']:
        cid = answer['commentId']
        if cid in answers or cid not in entries:
            raise ValueError('Duplicate or unknown response comment ID')
        answers.add(cid)
        entry = entries[cid]
        for key in ('path', 'itemId', 'fileVersion'):
            if answer[key] != entry[key]:
                raise ValueError(f'Mismatched {key}')
        validate_edits(entry, answer['changes'], changed)
    if answers != set(entries):
        raise ValueError('Response is missing comment IDs')
    suggestions = set()
    for suggestion in response['suggestions']:
        if suggestion['id'] in suggestions or suggestion['id'] in entries:
            raise ValueError('Duplicate suggestion ID')
        suggestions.add(suggestion['id'])
        # A proposal must reference an item/version known from this request.
        options = [e for e in entries.values() if all(e[k] == suggestion[k] for k in ('path', 'itemId', 'fileVersion'))]
        if not options:
            raise ValueError('Unknown suggestion item/version')
        validate_edits(options[0], suggestion['changes'], changed)


def build(request: dict, decisions: dict) -> dict:
    if request.get('mode') == 'initial':
        result = {'schemaVersion': 1, 'requestId': request['requestId'], 'responses': decisions.get('responses', []), 'suggestions': []}
        for suggestion in decisions.get('suggestions', []):
            target = next((t for t in request.get('targets', []) if all(t[k] == suggestion[k] for k in ('path', 'itemId'))), None)
            if target is None:
                raise ValueError('Unknown initial review target')
            result['suggestions'].append({'id': str(uuid4()), 'fileVersion': target['fileVersion'], 'changes': [], **suggestion})
        validate(request, result)
        return result
    entries = {e['commentId']: e for e in request['entries']}
    result = {'schemaVersion': 1, 'requestId': request['requestId'], 'responses': [], 'suggestions': decisions.get('suggestions', [])}
    for decision in decisions['responses']:
        cid = decision['commentId']
        if cid not in entries:
            raise ValueError('Unknown comment ID')
        entry = entries[cid]
        result['responses'].append({**{k: entry[k] for k in ('path', 'itemId', 'fileVersion')}, **decision, 'changes': decision.get('changes', [])})
    validate(request, result)
    return result


def apply_files(request: dict, response: dict, english_root: Path, output_root: Path):
    validate(request, response)
    if output_root.exists():
        raise ValueError('Output directory already exists; choose a new directory')
    src, dst = english_root.resolve(), output_root.resolve()
    if dst == src or src in dst.parents or dst in src.parents:
        raise ValueError('Output must be separate from input')
    writes, csv_sections = {}, {}
    entries = request['targets'] if request.get('mode') == 'initial' else request['entries']
    for answer in response['responses'] + response['suggestions']:
        path = PurePosixPath(answer['path'])
        if path.is_absolute() or '..' in path.parts or any(':' in p or '\\' in p for p in path.parts):
            raise ValueError('Unsafe relative path')
        entry = next(e for e in entries if e['path'] == answer['path'] and e['itemId'] == answer['itemId'])
        target = (src / path).resolve()
        if src not in target.parents:
            raise ValueError('Input path escapes root')
        text, bom = decode(target.read_bytes())
        if digest(text) != answer['fileVersion']:
            raise ValueError(f'File version mismatch: {path}')
        if str(path) not in writes:
            writes[str(path)] = (text, bom, [])
        by_id = {s['id']: s for s in entry['slots']}
        for edit in answer['changes']:
            slot = by_id[edit['slotId']]
            line = text.splitlines()[slot['line'] - 1] if slot['kind']!='database_csv' else ''
            if slot['kind'] == 'database_csv':
                if str(path) not in csv_sections:
                    csv_sections[str(path)] = catalog(text)
                actual = cell_for_key(text,slot['key'],csv_sections[str(path)])['value']
            elif slot['kind'] == 'metadata':
                match = META.fullmatch(line)
                if not match or match[1] != slot['key']:
                    raise ValueError('Metadata position mismatch')
                actual = match[2]
            else:
                match = COMMAND.fullmatch(line)
                spans = fields(match['args']) if match else None
                if spans is None or not slot.get('position') or slot['position'] > len(spans):
                    raise ValueError('Command position mismatch')
                a, b = spans[slot['position'] - 1]
                actual = match['args'][a:b]
            if actual != edit['before']:
                raise ValueError('Before text does not match the actual English TXT')
            if special_strings(actual) != special_strings(edit['after']):
                raise ValueError('Woditor special strings changed')
            writes[str(path)][2].append({**by_id[edit['slotId']], 'translation': edit['after']})
    rendered = {path: (b'\xef\xbb\xbf' if bom else b'') + render_file(text, slots)['text'].encode('utf-8') for path, (text, bom, slots) in writes.items()}
    for path, raw in rendered.items():
        out = dst / path
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(raw)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    subs = p.add_subparsers(dest='command', required=True)
    for command in ('build', 'validate', 'apply'):
        sub = subs.add_parser(command)
        sub.add_argument('--request', required=True)
        if command == 'build':
            sub.add_argument('--decisions', required=True)
            sub.add_argument('--out', required=True)
        else:
            sub.add_argument('--response', required=True)
        if command == 'apply':
            sub.add_argument('--english-root', required=True)
            sub.add_argument('--out-root', required=True)
    args = p.parse_args()
    try:
        request = read(args.request)
        if args.command == 'build':
            result = build(request, read(args.decisions))
            with Path(args.out).open('x', encoding='utf-8') as stream:
                json.dump(result, stream, indent=2, ensure_ascii=False)
        else:
            response = read(args.response)
            if args.command == 'apply':
                apply_files(request, response, Path(args.english_root), Path(args.out_root))
            else:
                validate(request, response)
        print('OK')
    except (ValueError, KeyError, TypeError, OSError) as error:
        p.exit(1, f'ERROR: {error}\n')


if __name__ == '__main__':
    main()
