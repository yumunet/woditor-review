import type {Post, Thread} from './model';
import {canEdit} from './review-state';
import {escape, icon} from './ui';

function postActions(thread: Thread, post: Post, root: boolean) {
  const reply = root && !thread.resolved ? `<button class="text-act" data-action="reply" data-value="${escape(thread.id)}">${icon('reply')}返信</button>` : '';
  const edit = canEdit(thread, post.id) ? `<button class="text-act" data-action="edit" data-thread="${escape(thread.id)}" data-post="${escape(post.id)}">${icon('edit')}編集</button><button class="text-act" data-action="delete" data-thread="${escape(thread.id)}" data-post="${escape(post.id)}">${icon('trash')}削除</button>` : '';
  const resolve = root ? `<button class="text-act" data-action="resolve" data-value="${escape(thread.id)}">${icon(thread.resolved ? 'undo' : 'check')}${thread.resolved ? '再開' : '解決'}</button>` : '';
  return reply || edit || resolve ? `<div class="thread-actions">${reply}${edit}${resolve}</div>` : '';
}

export function threadView(thread: Thread) {
  const first = thread.posts[0];
  const posts = thread.posts.map((post, index) => {
    const author = index ? `<strong class="hint">${post.author === 'ai' ? 'AI' : '自分'}</strong>` : '';
    const decision = post.decision ? `<p class="hint">${{accepted:'採用',rejected:'不採用',partial:'一部採用',needs_review:'要確認'}[post.decision]}</p>` : '';
    return `<div class="${index ? 'reply' : 'thread-root'}">${author}${decision}<div class="post-text">${escape(post.text)}</div>${postActions(thread,post,index === 0)}</div>`;
  }).join('');
  return `<article class="thread"><div class="thread-top"><strong>${first.author === 'ai' ? 'AI' : '自分'}</strong><time class="thread-time">${escape(new Date(first.createdAt).toLocaleString('ja-JP'))}</time><span class="thread-status ${thread.resolved ? 'resolved' : ''}">${thread.resolved ? '解決済み' : '未解決'}</span></div>${posts}</article>`;
}
