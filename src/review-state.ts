import { isDone, unresolved, type Item, type Post, type Slot, type Thread } from './model';

export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function canEdit(thread: Thread, postId: string) {
  const index = thread.posts.findIndex((p) => p.id === postId);
  return (
    index >= 0 &&
    thread.posts[index].author === 'user' &&
    !thread.posts.slice(index + 1).some((p) => p.author === 'ai')
  );
}
export function addComment(item: Item, text: string, threadId?: string): Thread {
  if (!text.trim()) throw new Error('コメントを入力してください');
  const post: Post = { id: uid(), author: 'user', text, createdAt: now() };
  let thread = item.threads.find((t) => t.id === threadId);
  if (threadId && !thread) throw new Error('返信先が見つかりません');
  if (thread) {
    if (thread.resolved) throw new Error('返信する前にコメントを再開してください');
    thread.posts.push(post);
  } else {
    thread = { id: uid(), resolved: false, posts: [post] };
    item.threads.push(thread);
  }
  item.approved = false;
  return thread;
}
export function editComment(item: Item, threadId: string, postId: string, text: string) {
  const thread = item.threads.find((t) => t.id === threadId);
  if (!thread || !canEdit(thread, postId) || !text.trim())
    throw new Error('このコメントは編集できません');
  thread.posts.find((p) => p.id === postId)!.text = text;
}
export function deleteComment(item: Item, threadId: string, postId: string) {
  const thread = item.threads.find((t) => t.id === threadId);
  if (!thread || !canEdit(thread, postId)) throw new Error('このコメントは削除できません');
  thread.posts = thread.posts.filter((p) => p.id !== postId);
  if (!thread.posts.length) item.threads = item.threads.filter((t) => t.id !== threadId);
}
export function discardRejectedChanges(item: Item) {
  const rejected = item.changes.filter((c) => c.status === 'pending' && c.rejectedBy);
  if (!rejected.length) throw new Error('破棄できる不採用の変更がありません');
  for (const change of rejected) change.status = 'discarded';
  item.approved = false;
}
export function setResolved(item: Item, slots: Slot[], threadId: string, resolved: boolean) {
  const thread = item.threads.find((t) => t.id === threadId);
  if (!thread) throw new Error('コメントが見つかりません');
  // Validate the entire transition before changing any field.
  // An external overwrite establishes a new baseline for this slot. Older
  // comment history remains readable but cannot undo that imported text.
  const changes = item.changes.filter(
    (c, index) =>
      c.threadId === threadId &&
      c.status !== 'discarded' &&
      !item.changes
        .slice(index + 1)
        .some(
          (next) =>
            next.slotId === c.slotId && next.origin === 'reload' && next.status === 'committed',
        ),
  );
  if (resolved && changes.some((c) => c.status === 'pending' && c.rejectedBy))
    throw new Error('再審で不採用になった変更を破棄してから解決してください');
  for (const c of changes)
    if (!slots.some((s) => s.id === c.slotId)) throw new Error('翻訳単位が見つかりません');
  for (const c of changes) {
    const later = item.changes
      .slice(item.changes.indexOf(c) + 1)
      .some(
        (next) =>
          next.slotId === c.slotId && next.threadId !== threadId && next.status !== 'discarded',
      );
    if (later)
      throw new Error(
        '同じ翻訳に後続の変更があります。履歴を上書きしないため、このコメントの状態は変更できません',
      );
  }
  thread.resolved = resolved;
  for (const c of resolved ? changes : [...changes].reverse()) {
    const slot = slots.find((s) => s.id === c.slotId)!;
    slot.translation = resolved ? c.after : c.before;
    c.status = resolved ? 'committed' : 'pending';
  }
  if (!resolved) item.approved = false;
}
export function approveItem(item: Item, slots: Slot[], resolveComments = false) {
  if (unresolved(item).length && !resolveComments) throw new Error('未解決コメントがあります');
  if (item.changes.some((c) => c.status === 'pending' && c.rejectedBy))
    throw new Error('再審で不採用になった変更を破棄してから承認してください');
  if (item.changes.some((c) => c.status === 'pending' && c.origin === 'ai' && !c.threadId))
    throw new Error('対応コメントのないAI変更を確認してください');
  if (resolveComments) for (const t of unresolved(item)) setResolved(item, slots, t.id, true);
  for (const c of item.changes.filter((c) => c.status === 'pending' && c.origin === 'reload')) {
    slots.find((s) => s.id === c.slotId)!.translation = c.after;
    c.status = 'committed';
  }
  item.approved = true;
}
export function latestComment(item: Item) {
  return unresolved(item)
    .flatMap((thread) => thread.posts.map((post) => ({ thread, post })))
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => b.post.createdAt.localeCompare(a.post.createdAt) || b.index - a.index)
    .at(0);
}
export function latestPreview(item: Item) {
  return latestComment(item)?.post.text ?? '';
}
export function nextAfterApproval(
  items: Item[],
  currentId: string,
  filter: (item: Item) => boolean,
): string {
  const index = items.findIndex((i) => i.id === currentId);
  return items.slice(index + 1).find(filter)?.id ?? currentId;
}
export function undoApproval(item: Item) {
  if (isDone(item)) item.approved = false;
}
