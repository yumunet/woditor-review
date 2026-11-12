import type { PyodideInterface } from 'pyodide';
import parser from '../python/woditor_parser.py?raw';
import adapter from '../python/review_adapter.py?raw';
import { readZip } from './archive';
import type { Diagnostic, DiagnosticDocument, ReviewFile } from './model';
import { diagnosticLocation } from './diagnostics';

let runtime: Promise<PyodideInterface> | undefined;
const messageFor = (error: unknown) =>
  String(error)
    .trim()
    .split('\n')
    .at(-1)!
    .replace(/^(?:ValueError|UnicodeDecodeError|Error):\s*/, '');
async function python() {
  if (!runtime)
    runtime = (async () => {
      const indexURL = new URL(`${import.meta.env.BASE_URL}pyodide/`, self.location.origin).href;
      const { loadPyodide } = await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`);
      const py: PyodideInterface = await loadPyodide({ indexURL });
      py.globals.set('parser_code', parser);
      py.globals.set('adapter_code', adapter);
      await py.runPythonAsync(`
import types, sys, json
for name, code in [('woditor_parser', parser_code), ('review_adapter', adapter_code)]:
    module = types.ModuleType(name)
    sys.modules[name] = module
    exec(compile(code, name + '.py', 'exec'), module.__dict__)
from review_adapter import pair_file, file_type, decode, render_file
def supported(raw):
    text, _ = decode(bytes(raw))
    try:
        file_type(text)
        return True
    except ValueError:
        return False
def parse_pair(path, ja, en):
    return json.dumps(pair_file(path, bytes(ja), bytes(en)), ensure_ascii=False)
def render_files(data):
    files = json.loads(data)
    return json.dumps([dict(path=f['path'], **render_file(f['enText'], f['slots'])) for f in files], ensure_ascii=False)
`);
      return py;
    })().catch((error) => {
      runtime = undefined;
      throw error;
    });
  return runtime;
}

self.onmessage = async ({
  data,
}: MessageEvent<{
  id: number;
  ja: ArrayBuffer;
  en: ArrayBuffer;
  files?: ReviewFile[];
  partial?: boolean;
}>) => {
  try {
    if (data.files) {
      const py = await python(),
        render = py.globals.get('render_files');
      try {
        self.postMessage({ id: data.id, result: JSON.parse(render(JSON.stringify(data.files))) });
      } finally {
        render.destroy();
      }
      return;
    }
    self.postMessage({ id: data.id, progress: 'ZIPを展開中…' });
    const ja = readZip(new Uint8Array(data.ja)),
      en = readZip(new Uint8Array(data.en));
    self.postMessage({ id: data.id, progress: '解析エンジンを準備中…' });
    const py = await python();
    const supported = py.globals.get('supported'),
      pair = py.globals.get('parse_pair');
    const files: ReviewFile[] = [],
      diagnostics: Diagnostic[] = [];
    const diagnosticDocuments: DiagnosticDocument[] = [];
    const retain = (path: string, jaBytes?: Uint8Array, enBytes?: Uint8Array) =>
      diagnosticDocuments.push({
        path,
        jaText: jaBytes ? new TextDecoder().decode(jaBytes) : undefined,
        enText: enBytes ? new TextDecoder().decode(enBytes) : undefined,
      });
    try {
      let index = 0;
      for (const [path, raw] of ja) {
        self.postMessage({
          id: data.id,
          progress: `解析中 ${++index} / ${ja.size}`,
          current: index,
          total: ja.size,
        });
        try {
          if (!supported(raw)) {
            retain(path, raw, en.get(path));
            diagnostics.push({ path, severity: 'skip', message: '対応形式以外のTXT' });
            continue;
          }
          const other = en.get(path);
          if (!other && data.partial) continue;
          if (!other) throw new Error('対応する英訳ファイルがありません');
          const parsed: ReviewFile = JSON.parse(pair(path, raw, other));
          files.push(parsed);
          parsed.warnings.forEach((message) =>
            diagnostics.push({
              path,
              severity: 'warning',
              message,
              ...diagnosticLocation(parsed, message),
            }),
          );
          parsed.errors?.forEach((message) =>
            diagnostics.push({
              path,
              severity: 'error',
              message,
              ...diagnosticLocation(parsed, message),
            }),
          );
        } catch (err) {
          retain(path, raw, en.get(path));
          const message = messageFor(err);
          const line = /(?:行\s*|line\s+)(\d+)/i.exec(message)?.[1];
          diagnostics.push({
            path,
            severity: 'error',
            message,
            line: line ? Number(line) : undefined,
          });
        }
      }
      for (const path of en.keys())
        if (!ja.has(path)) {
          retain(path, undefined, en.get(path));
          diagnostics.push({ path, severity: 'skip', message: '日本語原文がありません' });
        }
    } finally {
      supported.destroy();
      pair.destroy();
    }
    self.postMessage({ id: data.id, result: { files, diagnostics, diagnosticDocuments } });
  } catch (err) {
    self.postMessage({ id: data.id, error: messageFor(err) });
  }
};
