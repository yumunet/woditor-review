import { relativePath } from './archive';
import type { Workspace } from './model';
const DB = 'woditor-review',
  VERSION = 1;
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB, VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('files', { keyPath: 'path' });
      request.result.createObjectStore('meta');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('データベースを開けませんでした'));
    request.onblocked = () => reject(new Error('別のタブを閉じて保存を再試行してください'));
  });
const value = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('データベースを読み込めませんでした'));
  });
export async function loadWorkspace(): Promise<Workspace | null> {
  const db = await open();
  try {
    const tx = db.transaction(['files', 'meta'], 'readonly');
    const [files, meta] = await Promise.all([
      value(tx.objectStore('files').getAll()),
      value(tx.objectStore('meta').get('workspace')),
    ]);
    if (!meta) return null;
    const result = { ...meta, files };
    validateWorkspace(result);
    return result;
  } finally {
    db.close();
  }
}
let saving: Promise<void> = Promise.resolve();
export async function readSetting<T>(key: string): Promise<T | undefined> {
  const db = await open();
  try {
    return await value<T>(db.transaction('meta', 'readonly').objectStore('meta').get(key));
  } finally {
    db.close();
  }
}
export async function writeSetting(key: string, data: unknown): Promise<void> {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(data, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('設定を保存できませんでした'));
      tx.onabort = () => reject(tx.error ?? new Error('設定の保存が中断されました'));
    });
  } finally {
    db.close();
  }
}
export function saveWorkspace(workspace: Workspace, changedPath?: string): Promise<void> {
  workspace.updatedAt = new Date().toISOString();
  const { files, ...meta } = workspace;
  const snapshot = structuredClone({
    meta,
    files: changedPath ? files.filter((f) => f.path === changedPath) : files,
  });
  const write = async () => {
    const db = await open();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['files', 'meta'], 'readwrite');
        const store = tx.objectStore('files');
        if (!changedPath) store.clear();
        snapshot.files.forEach((f) => store.put(f));
        tx.objectStore('meta').put(snapshot.meta, 'workspace');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('保存に失敗しました'));
        tx.onabort = () => reject(tx.error ?? new Error('保存が中断されました'));
      });
    } finally {
      db.close();
    }
  };
  saving = saving.catch(() => {}).then(write);
  return saving;
}
export function validateWorkspace(data: unknown): asserts data is Workspace {
  const fail = () => {
    throw new Error('バックアップの形式・参照関係が不正です');
  };
  const object = (v: unknown): v is Record<string, any> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  const str = (v: unknown): v is string => typeof v === 'string';
  const arr = Array.isArray;
  const hash = (v: unknown) => str(v) && /^[a-f0-9]{64}$/.test(v);
  if (
    !object(data) ||
    data.schemaVersion !== 1 ||
    !arr(data.files) ||
    !arr(data.diagnostics) ||
    !arr(data.requests) ||
    !arr(data.importedResponses) ||
    !str(data.updatedAt)
  )
    return fail();
  const paths = new Set(),
    threads = new Set(),
    posts = new Set();
  for (const f of data.files) {
    if (
      !object(f) ||
      !str(f.path) ||
      !f.path ||
      f.path !== relativePath(f.path) ||
      paths.has(f.path) ||
      !['common', 'database', 'map'].includes(f.type) ||
      !str(f.jaText) ||
      !str(f.enText) ||
      !hash(f.version) ||
      !hash(f.sourceVersion) ||
      typeof f.jaBom !== 'boolean' ||
      typeof f.enBom !== 'boolean' ||
      !arr(f.slots) ||
      !arr(f.items) ||
      !arr(f.commands) ||
      !arr(f.excluded) ||
      !arr(f.warnings) ||
      !f.warnings.every(str) ||
      !object(f.usages)
    )
      return fail();
    paths.add(f.path);
    const slots = new Set(),
      items = new Set(),
      assigned = new Set();
    for (const s of f.slots) {
      if (
        !object(s) ||
        !str(s.id) ||
        slots.has(s.id) ||
        !str(s.source) ||
        !str(s.translation) ||
        !str(s.key) ||
        !str(s.kind) ||
        !hash(s.fingerprint) ||
        !arr(s.warnings) ||
        !s.warnings.every(str) ||
        !Number.isInteger(s.line) ||
        (s.line < 1 && !(s.sourceMissing === true && s.line === -s.enLine)) ||
        !Number.isInteger(s.start) ||
        !Number.isInteger(s.end) ||
        s.start < 0 ||
        s.end < s.start
      )
        return fail();
      if (
        (s.sourceMissing !== undefined && typeof s.sourceMissing !== 'boolean') ||
        (s.sourceOverride !== undefined && (!s.sourceMissing || !str(s.sourceOverride)))
      )
        return fail();
      if (
        s.csv !== undefined &&
        (s.kind !== 'database_csv' ||
          !object(s.csv) ||
          !Number.isInteger(s.csv.row) ||
          s.csv.row < 0 ||
          (s.csv.item !== null && (!Number.isInteger(s.csv.item) || s.csv.item < 0)) ||
          typeof s.csv.dataName !== 'boolean')
      )
        return fail();
      slots.add(s.id);
      if (s.enLine !== undefined && (!Number.isInteger(s.enLine) || s.enLine < 1)) return fail();
    }
    for (const i of f.items) {
      if (
        !object(i) ||
        !str(i.id) ||
        items.has(i.id) ||
        !str(i.title) ||
        typeof i.approved !== 'boolean' ||
        !arr(i.slotIds) ||
        !i.slotIds.length ||
        !arr(i.threads) ||
        !arr(i.changes)
      )
        return fail();
      items.add(i.id);
      for (const id of i.slotIds) {
        if (!slots.has(id) || assigned.has(id)) return fail();
        assigned.add(id);
      }
      const localThreads = new Set();
      for (const t of i.threads) {
        if (
          !object(t) ||
          !str(t.id) ||
          !t.id ||
          threads.has(t.id) ||
          typeof t.resolved !== 'boolean' ||
          !arr(t.posts) ||
          !t.posts.length
        )
          return fail();
        threads.add(t.id);
        localThreads.add(t.id);
        for (const p of t.posts) {
          if (
            !object(p) ||
            !str(p.id) ||
            posts.has(p.id) ||
            !['user', 'ai'].includes(p.author) ||
            !str(p.text) ||
            !str(p.createdAt) ||
            (p.decision !== undefined &&
              !['accepted', 'rejected', 'partial', 'needs_review'].includes(p.decision))
          )
            return fail();
          posts.add(p.id);
        }
      }
      const changes = new Set();
      for (const c of i.changes) {
        if (
          !object(c) ||
          !str(c.id) ||
          changes.has(c.id) ||
          !i.slotIds.includes(c.slotId) ||
          !str(c.before) ||
          !str(c.after) ||
          !['pending', 'committed', 'discarded'].includes(c.status) ||
          !['ai', 'reload'].includes(c.origin) ||
          !str(c.createdAt) ||
          (c.threadId !== null && !localThreads.has(c.threadId)) ||
          (c.rejectedBy !== undefined &&
            (!str(c.rejectedBy) ||
              !i.threads.some(
                (t: any) =>
                  t.id === c.threadId &&
                  t.posts.some(
                    (p: any) =>
                      p.id === c.rejectedBy && p.author === 'ai' && p.decision === 'rejected',
                  ),
              )))
        )
          return fail();
        changes.add(c.id);
      }
      if (
        i.approved &&
        (i.threads.some((t: any) => !t.resolved) ||
          i.changes.some((c: any) => c.status === 'pending'))
      )
        return fail();
    }
    if (assigned.size !== slots.size) return fail();
    if (
      f.manualGroups !== undefined &&
      (!arr(f.manualGroups) ||
        JSON.stringify(f.manualGroups) !==
          JSON.stringify(f.items.filter((i: any) => i.code === 103).map((i: any) => i.slotIds)))
    )
      return fail();
    for (const c of f.commands)
      if (
        !object(c) ||
        !Number.isInteger(c.line) ||
        !str(c.ja) ||
        !str(c.en) ||
        !Number.isInteger(c.code)
      )
        return fail();
    for (const [id, lines] of Object.entries(f.usages))
      if (
        !slots.has(id) ||
        !arr(lines) ||
        !lines.every((n) => Number.isInteger(n) && f.commands.some((c: any) => c.line === n))
      )
        return fail();
  }
  for (const d of data.diagnostics) {
    if (
      !object(d) ||
      !str(d.path) ||
      !str(d.message) ||
      !['error', 'warning', 'skip'].includes(d.severity)
    )
      return fail();
    for (const key of ['line', 'enLine'])
      if (d[key] !== undefined && (!Number.isInteger(d[key]) || d[key] < 1)) return fail();
  }
  if (data.diagnosticDocuments !== undefined) {
    if (!arr(data.diagnosticDocuments)) return fail();
    const documents = new Set();
    for (const d of data.diagnosticDocuments) {
      if (
        !object(d) ||
        !str(d.path) ||
        !d.path ||
        d.path !== relativePath(d.path) ||
        documents.has(d.path) ||
        (d.jaText === undefined && d.enText === undefined) ||
        (d.jaText !== undefined && !str(d.jaText)) ||
        (d.enText !== undefined && !str(d.enText))
      )
        return fail();
      documents.add(d.path);
    }
  }
  for (const r of data.requests) {
    if (!object(r) || r.schemaVersion !== 1 || !str(r.requestId) || !arr(r.entries)) return fail();
    if (r.mode !== undefined && !['comments', 'initial'].includes(r.mode)) return fail();
    if (
      r.mode === 'initial' &&
      (r.entries.length ||
        !arr(r.targets) ||
        !r.targets.length ||
        !r.targets.every(
          (t: any) =>
            object(t) &&
            str(t.path) &&
            str(t.itemId) &&
            str(t.title) &&
            hash(t.fileVersion) &&
            hash(t.sourceVersion) &&
            arr(t.slotIds) &&
            arr(t.slots) &&
            arr(t.context) &&
            arr(t.threads) &&
            arr(t.pendingChanges),
        ))
    )
      return fail();
    for (const row of r.entries)
      if (
        !object(row) ||
        !str(row.path) ||
        !str(row.itemId) ||
        !str(row.commentId) ||
        !hash(row.fileVersion) ||
        !arr(row.slotIds) ||
        !arr(row.slots) ||
        !arr(row.posts) ||
        !arr(row.context)
      )
        return fail();
  }
  if (!data.importedResponses.every(str)) return fail();
}
export function backupJson(workspace: Workspace) {
  return JSON.stringify(workspace, null, 2);
}
export function backupFileName(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `woditor-review-backup_${day}_${time}.json`;
}
export function restoreJson(text: string): Workspace {
  if (text.length > 256 * 1024 * 1024) throw new Error('バックアップが大きすぎます');
  const data: unknown = JSON.parse(text);
  validateWorkspace(data);
  return data;
}
export function download(name: string, data: string | Uint8Array, type = 'application/json') {
  const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
