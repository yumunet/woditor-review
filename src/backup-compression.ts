import type { BackupReply, BackupRequest } from './backup-zip';

export type BackupCompressor = (
  name: string,
  chunks: Iterable<Uint8Array<ArrayBuffer>>,
) => Promise<Blob>;
const active = new Set<() => void>();
if (typeof window !== 'undefined')
  window.addEventListener('pagehide', () => {
    for (const cancel of active) cancel();
  });

export const compressBackup: BackupCompressor = async (name, chunks) => {
  const worker = new Worker(new URL('./backup.worker.ts', import.meta.url), { type: 'module' });
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let pending: { resolve: () => void; reject: (error: Error) => void } | undefined;
  let failure: Error | undefined;
  const fail = (error: Error) => {
    failure = error;
    pending?.reject(error);
    pending = undefined;
  };
  const message = ({ data }: MessageEvent<BackupReply>) => {
    if (data.type === 'data') parts.push(data.data);
    else if (data.type === 'error') fail(new Error(data.message));
    else {
      pending?.resolve();
      pending = undefined;
    }
  };
  const error = (event: ErrorEvent) =>
    fail(new Error(event.message || 'バックアップの圧縮に失敗しました'));
  const unreadable = () => fail(new Error('バックアップの圧縮結果を読み込めませんでした'));
  const cancel = () => {
    fail(new Error('バックアップを中断しました'));
    worker.terminate();
  };
  const push = (data: BackupRequest, transfer: Transferable[] = []) =>
    new Promise<void>((resolve, reject) => {
      if (failure) {
        reject(failure);
        return;
      }
      pending = { resolve, reject };
      worker.postMessage(data, transfer);
    });
  active.add(cancel);
  worker.addEventListener('message', message);
  worker.addEventListener('error', error);
  worker.addEventListener('messageerror', unreadable);
  try {
    await push({ type: 'start', name });
    for (const data of chunks) await push({ type: 'chunk', data, final: false }, [data.buffer]);
    await push({ type: 'chunk', data: new Uint8Array(), final: true });
    return new Blob(parts, { type: 'application/zip' });
  } finally {
    worker.removeEventListener('message', message);
    worker.removeEventListener('error', error);
    worker.removeEventListener('messageerror', unreadable);
    worker.terminate();
    active.delete(cancel);
    pending = undefined;
    parts.length = 0;
  }
};
