import { unzipSync } from 'fflate';

export function relativePath(path: string): string {
  const parts = path
    .replaceAll('\\', '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.');
  if (parts.some((p) => p === '..' || p.includes('\0') || p.includes(':')))
    throw new Error(`不正なパス: ${path}`);
  const locale = parts.findIndex((p) => /^(ja-JP|en-US)$/i.test(p));
  if (locale >= 0 && parts[locale + 1]?.toLowerCase() === 'texts')
    return parts.slice(locale + 2).join('/');
  const texts = parts.findIndex((p) => p.toLowerCase() === 'texts');
  if (texts >= 0) return parts.slice(texts + 1).join('/');
  const root = parts.findIndex((p) => p === 'BasicData' || p === 'MapData');
  return (root >= 0 ? parts.slice(root) : parts).join('/');
}

export function readZip(bytes: Uint8Array): Map<string, Uint8Array> {
  if (bytes.byteLength > 128 * 1024 * 1024) throw new Error('ZIPは128MB以下にしてください');
  let total = 0,
    count = 0;
  const entries = unzipSync(bytes, {
    filter: (entry) => {
      if (!entry.name.toLowerCase().endsWith('.txt')) return false;
      if (
        entry.originalSize > 16 * 1024 * 1024 ||
        (total += entry.originalSize) > 256 * 1024 * 1024 ||
        ++count > 5000
      )
        throw new Error('ZIP展開サイズ・件数の上限を超えています');
      return true;
    },
  });
  const result = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(entries)) {
    const path = relativePath(name);
    if (result.has(path)) throw new Error(`ZIP内の相対パスが重複: ${path}`);
    result.set(path, data);
  }
  if (!result.size) throw new Error('ZIP内にTXTファイルがありません');
  return result;
}
