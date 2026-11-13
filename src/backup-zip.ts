import { Zip, ZipDeflate } from 'fflate';

export type BackupRequest =
  | { type: 'start'; name: string }
  | { type: 'chunk'; data: Uint8Array<ArrayBuffer>; final: boolean };
export type BackupReply =
  | { type: 'data'; data: Uint8Array<ArrayBuffer> }
  | { type: 'ack' }
  | { type: 'error'; message: string };

/** The same incremental codec runs in the worker and in codec unit tests. */
export class BackupZip {
  private archive: Zip;
  private entry: ZipDeflate;
  constructor(name: string, output: (data: Uint8Array<ArrayBuffer>) => void) {
    this.archive = new Zip((error, data) => {
      if (error) throw error;
      output(data);
    });
    this.entry = new ZipDeflate(name, { level: 6 });
    this.archive.add(this.entry);
  }
  push(data: Uint8Array, final = false) {
    this.entry.push(data, final);
    if (final) this.archive.end();
  }
}
