import type { Workspace } from './model';
import { restoreJson } from './storage';
export interface DriveRevision {
  id: string;
  fileId: string;
  parents: string[];
  modifiedTime: string;
  device: string;
}
export interface DriveSnapshot {
  schemaVersion: 1;
  kind: 'woditor-review-sync';
  id: string;
  parents: string[];
  device: string;
  createdAt: string;
  workspace: Workspace;
}
export interface DriveRemote {
  list(): Promise<DriveRevision[]>;
  download(revision: DriveRevision): Promise<DriveSnapshot>;
  upload(snapshot: DriveSnapshot): Promise<void>;
}
export class DriveAuthError extends Error {
  constructor() {
    super('Google接続の有効期限が切れました。再接続してください');
  }
}
const limit = 256 * 1024 * 1024,
  app = 'woditor-review-sync-v1';
async function boundedText(stream: ReadableStream<Uint8Array<ArrayBuffer>>) {
  const reader = stream.getReader(),
    chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('同期データが大きすぎます');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return new Blob(chunks).text();
}
export async function encodeSnapshot(snapshot: DriveSnapshot): Promise<Blob> {
  const text = JSON.stringify(snapshot);
  if (new TextEncoder().encode(text).length > limit) throw new Error('同期データが大きすぎます');
  return new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
}
export async function decodeSnapshot(
  stream: ReadableStream<Uint8Array<ArrayBuffer>>,
  revision: DriveRevision,
): Promise<DriveSnapshot> {
  const data = JSON.parse(await boundedText(stream.pipeThrough(new DecompressionStream('gzip'))));
  if (
    data?.schemaVersion !== 1 ||
    data.kind !== 'woditor-review-sync' ||
    data.id !== revision.id ||
    !Array.isArray(data.parents) ||
    JSON.stringify(data.parents) !== JSON.stringify(revision.parents) ||
    typeof data.device !== 'string' ||
    typeof data.createdAt !== 'string'
  )
    throw new Error('Driveの同期データが不正です');
  data.workspace = restoreJson(JSON.stringify(data.workspace));
  return data;
}
export class GoogleDrive implements DriveRemote {
  constructor(
    private token: () => string,
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  private async request(url: string, init: RequestInit = {}) {
    const response = await this.fetcher(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init.headers)),
        Authorization: `Bearer ${this.token()}`,
      },
      signal: AbortSignal.timeout(120000),
    });
    if (response.status === 401) throw new DriveAuthError();
    if (!response.ok)
      throw new Error(
        response.status === 403
          ? 'Driveへのアクセスが拒否されました。権限とAPIの設定を確認してください'
          : `Driveとの通信に失敗しました (${response.status})`,
      );
    return response;
  }
  async account(): Promise<{ id: string; email: string }> {
    const data = await (await this.request('https://www.googleapis.com/oauth2/v3/userinfo')).json();
    if (typeof data.sub !== 'string' || !data.sub || typeof data.email !== 'string')
      throw new Error('Googleアカウントを確認できませんでした');
    return { id: data.sub, email: data.email };
  }
  async list(): Promise<DriveRevision[]> {
    const result: DriveRevision[] = [];
    let page = '';
    do {
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: `trashed = false and appProperties has { key='app' and value='${app}' }`,
        fields: 'nextPageToken,files(id,modifiedTime,appProperties)',
        pageSize: '1000',
      });
      if (page) params.set('pageToken', page);
      const data = await (
        await this.request(`https://www.googleapis.com/drive/v3/files?${params}`)
      ).json();
      if (!Array.isArray(data.files)) throw new Error('Driveのファイル一覧が不正です');
      for (const file of data.files) {
        const p = file.appProperties;
        if (
          typeof file.id !== 'string' ||
          typeof p?.revision !== 'string' ||
          !/^[a-f0-9-]{36}$/.test(p.revision)
        )
          throw new Error('Driveの同期履歴が不正です');
        const parents = Object.keys(p)
          .filter((k) => /^p\d+$/.test(k))
          .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
          .map((k) => p[k]);
        if (parents.some((id) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)))
          throw new Error('Driveの同期履歴が不正です');
        result.push({
          fileId: file.id,
          id: p.revision,
          parents,
          device: p.device ?? '別の端末',
          modifiedTime: file.modifiedTime ?? '',
        });
      }
      page = data.nextPageToken ?? '';
    } while (page);
    return result;
  }
  async download(revision: DriveRevision) {
    const response = await this.request(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(revision.fileId)}?alt=media`,
    );
    if (!response.body) throw new Error('Driveのデータが空です');
    return decodeSnapshot(response.body, revision);
  }
  async upload(snapshot: DriveSnapshot) {
    if (snapshot.parents.length > 95)
      throw new Error('同期の候補が多すぎます。履歴をバックアップしてください');
    const data = await encodeSnapshot(snapshot);
    const response = await this.request(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'application/gzip',
          'X-Upload-Content-Length': String(data.size),
        },
        body: JSON.stringify({
          name: `woditor-review-${snapshot.id}.json.gz`,
          parents: ['appDataFolder'],
          mimeType: 'application/gzip',
          appProperties: {
            app,
            revision: snapshot.id,
            device: snapshot.device,
            ...Object.fromEntries(snapshot.parents.map((id, i) => [`p${i}`, id])),
          },
        }),
      },
    );
    const location = response.headers.get('Location');
    if (!location || new URL(location).origin !== 'https://www.googleapis.com')
      throw new Error('Driveのアップロード先が不正です');
    await this.request(location, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/gzip' },
      body: data,
    });
  }
}
