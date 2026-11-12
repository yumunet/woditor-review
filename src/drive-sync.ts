import type { Workspace } from './model';
import type { DriveRemote, DriveRevision, DriveSnapshot } from './drive-api';
export interface SyncBase {
  revision: string;
  hash: string;
  syncedAt: string;
}
export type SyncResolution = {
  use: 'local' | 'remote';
  revision?: string;
  expectedHeads: string[];
};
export interface SyncResult {
  kind: 'unchanged' | 'uploaded' | 'downloaded' | 'conflict';
  base?: SyncBase;
  workspace?: Workspace;
  heads: DriveRevision[];
}
export async function workspaceHash(workspace: Workspace) {
  const { updatedAt, ...content } = workspace;
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(content)),
  );
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
}
export function revisionHeads(revisions: DriveRevision[]): DriveRevision[] {
  const ids = new Set<string>(),
    parents = new Set(revisions.flatMap((r) => r.parents));
  for (const r of revisions) {
    if (ids.has(r.id)) throw new Error('Driveに重複した同期履歴があります');
    ids.add(r.id);
  }
  const heads = revisions.filter((r) => !parents.has(r.id));
  if (revisions.length && !heads.length) throw new Error('Driveの同期履歴に循環があります');
  return heads.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
}
const sameHeads = (a: string[], b: string[]) =>
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const hasData = (workspace: Workspace) =>
  !!(
    workspace.files.length ||
    workspace.diagnostics.length ||
    workspace.requests.length ||
    workspace.importedResponses.length ||
    workspace.diagnosticDocuments?.length
  );
export async function synchronize(
  remote: DriveRemote,
  local: Workspace,
  base: SyncBase | undefined,
  device: string,
  resolution?: SyncResolution,
): Promise<SyncResult> {
  const heads = revisionHeads(await remote.list()),
    hash = await workspaceHash(local);
  const conflict = (): SyncResult => ({ kind: 'conflict', heads });
  if (
    resolution &&
    !sameHeads(
      resolution.expectedHeads,
      heads.map((h) => h.id),
    )
  )
    return conflict();
  const makeBase = (revision: string, hash: string): SyncBase => ({
    revision,
    hash,
    syncedAt: new Date().toISOString(),
  });
  if (resolution?.use === 'remote') {
    const selected = heads.find((r) => r.id === resolution.revision);
    if (!selected) return conflict();
    const snapshot = await remote.download(selected);
    // Preserve both branches on Drive by recording the explicit choice as a child.
    return publish(snapshot.workspace, await workspaceHash(snapshot.workspace), 'downloaded');
  }
  if (resolution?.use === 'local') return publish(local, hash, 'uploaded');
  if (!heads.length)
    return hasData(local) ? publish(local, hash, 'uploaded') : { kind: 'unchanged', heads };
  if (heads.length > 1) return conflict();
  const head = heads[0];
  if (head.id === base?.revision)
    return hash === base.hash
      ? { kind: 'unchanged', heads, base }
      : publish(local, hash, 'uploaded');
  const snapshot = await remote.download(head),
    remoteHash = await workspaceHash(snapshot.workspace);
  if (hash === remoteHash) return { kind: 'unchanged', heads, base: makeBase(head.id, hash) };
  if (hash === base?.hash || (!base && !hasData(local)))
    return {
      kind: 'downloaded',
      workspace: snapshot.workspace,
      base: makeBase(head.id, remoteHash),
      heads,
    };
  return conflict();

  async function publish(
    workspace: Workspace,
    valueHash: string,
    kind: 'uploaded' | 'downloaded',
  ): Promise<SyncResult> {
    const snapshot: DriveSnapshot = {
      schemaVersion: 1,
      kind: 'woditor-review-sync',
      id: crypto.randomUUID(),
      parents: heads.map((h) => h.id),
      device,
      createdAt: new Date().toISOString(),
      workspace,
    };
    await remote.upload(snapshot);
    // Include this write even if listing briefly lags behind upload completion.
    const revisions = await remote.list();
    if (!revisions.some((r) => r.id === snapshot.id))
      revisions.push({
        id: snapshot.id,
        fileId: '',
        parents: snapshot.parents,
        modifiedTime: snapshot.createdAt,
        device,
      });
    const current = revisionHeads(revisions),
      nextBase = makeBase(snapshot.id, valueHash);
    if (current.length > 1) return { kind: 'conflict', heads: current, base: nextBase };
    return {
      kind,
      base: nextBase,
      heads: current,
      ...(kind === 'downloaded' ? { workspace } : {}),
    };
  }
}
