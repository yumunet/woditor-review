import { BackupZip, type BackupRequest, type BackupReply } from './backup-zip';

const scope = self as unknown as DedicatedWorkerGlobalScope;
let archive: BackupZip | undefined;
const send = (reply: BackupReply, transfer: Transferable[] = []) =>
  scope.postMessage(reply, transfer);
scope.onmessage = ({ data }: MessageEvent<BackupRequest>) => {
  try {
    if (data.type === 'start') {
      if (archive) throw new Error('圧縮処理は既に開始されています');
      archive = new BackupZip(data.name, (chunk) =>
        send({ type: 'data', data: chunk }, [chunk.buffer]),
      );
    } else {
      if (!archive) throw new Error('圧縮処理が開始されていません');
      archive.push(data.data, data.final);
    }
    send({ type: 'ack' });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
};
