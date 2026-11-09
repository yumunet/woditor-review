import './styles.css';
import { emptyWorkspace, isDone, matches, sourceText, unresolved, type Workspace, type ReviewFile, type Item, type Filter, type ReviewRequest } from './model';
import { escape as e, icon, folderTriangle, filterButtons, fileTree, compact, percent, initialContext, type TreeNode } from './ui';
import { commandColor } from './command-colors';
import { parseArchives, renderTranslations } from './parser-client';
import { addComment, approveItem, deleteComment, discardRejectedChanges, editComment, latestPreview, nextAfterApproval, setResolved, undoApproval } from './review-state';
import { backupJson, download, loadWorkspace, restoreJson, saveWorkspace } from './storage';
import { chatInstructions, createRequest, importResponse, mergeFiles, reviewFileNames, sourceZip } from './exchange';
import { characterDiff } from './diff';
import { strToU8, zipSync } from 'fflate';
import { registerPwa } from './pwa';
import { canMerge, canSplit, mergeGroup, splitGroup } from './grouping';
import { diagnosticDocument,diagnosticsView,replaceDiagnosticDocuments,withoutReplacedDiagnostics } from './diagnostics';
import { threadView } from './comments';
import { updateManualSources } from './source-edit';
import {newlineWarning,slotWarnings} from './translation-warnings';
import {itemRows} from './item-picker';
import {createTextView,paintTextView,targetLine,textLineHeight,textViewMarkup,type TextView,type TextLanguage} from './text-viewer';
import {navigationQuestion,navigationTarget} from './navigation';

const root = document.querySelector<HTMLDivElement>('#app')!;
let workspace: Workspace = emptyWorkspace();
let path: string | null = null, currentId: string | null = null;
let homeFilter: Filter = 'all', itemFilter: Filter = 'all';
let itemQuery='';
let textView:TextView|null=null;
const expanded = new Set<string>();
let menu = false, sheet: string | null = null, contextOpen = true, contextLang: 'ja' | 'en' = 'en';
let before = 3, after = 3, usageIndex = 0, busy = '', notice = '';
let toastTimer: ReturnType<typeof setTimeout>;
let noticeInstructions: string | null = null, instructionsPreview: string | null = null;
function updateBusy(message: string) {busy = message; const el = root.querySelector('.busy > div:last-child'); if (el) el.textContent = message;}
let lastFocus: HTMLElement | null = null;
let commentTab: 'open' | 'all' = 'open', replyTarget: string | null = null;
let diagnosticTab: 'error' | 'warning' | 'skip' = 'error';
let editTarget: {threadId: string; postId: string} | null = null;
let confirmation: {question: string; run: () => void | Promise<void>} | null = null;
let exportSelection = new Set<string>(), preparedRequest: ReviewRequest | null = null;
const sheetTitles: Record<string,string> = {load: 'ファイルを読み込む', items: '翻訳項目', comments: 'コメント', progress: '全体の進捗', diagnostics: '読み込み結果', restore: 'バックアップを復元', export: 'レビューJSONを出力', response: 'レビューJSONを読み込む', reload: '英訳TXTを再読み込み', english: '英訳TXTを出力'};
sheetTitles.source = '原文を補う';
sheetTitles.text = 'テキスト表示';
const currentFile = () => workspace.files.find(f => f.path === path);
const currentItem = () => currentFile()?.items.find(i => i.id === currentId);
const targets = () => currentFile()?.items.filter(i => matches(i, itemFilter)) ?? [];
function toastMarkup() {return notice ? `<div class="toast" role="status">${e(notice)}${noticeInstructions ? '<button data-action="preview-instructions">指示文を確認</button>' : ''}</div>` : '';}
function toast(message: string, instructions: string | null = null) {notice = message; noticeInstructions = instructions; clearTimeout(toastTimer); root.querySelector('.toast')?.remove(); if (!menu) root.querySelector('.menu')?.remove(); root.insertAdjacentHTML('beforeend', toastMarkup()); toastTimer = setTimeout(() => {notice = ''; noticeInstructions = null; root.querySelector('.toast')?.remove();}, instructions ? 10000 : 5000);}
function closeInstructions() {instructionsPreview = null; render(); root.querySelector<HTMLElement>('[data-action="preview-instructions"], [data-action="copy-instructions"]')?.focus();}
function exportFiles() {return workspace.files.filter(f => sheet === 'english' || f.items.some(i => unresolved(i).length));}
function exportRows() {
  const files = exportFiles(), checked = files.filter(f => exportSelection.has(f.path)).length;
  return `<div class="sheet-body"><label class="export-row export-all"><input id="export-all" type="checkbox" ${files.length && checked === files.length ? 'checked' : ''} ${!files.length ? 'disabled' : ''}>すべて選択</label>${files.map(f => `<label class="export-row"><input type="checkbox" data-export-path="${e(f.path)}" ${exportSelection.has(f.path) ? 'checked' : ''}>${e(f.path)}</label>`).join('') || '<div class="empty">出力対象のファイルはありません</div>'}</div>`;
}
function openSheet(name: string) {lastFocus = document.activeElement as HTMLElement; sheet = name; menu = false; replyTarget = null; editTarget = null; if (name === 'diagnostics') diagnosticTab = 'error'; if (name === 'export' || name === 'english') {exportSelection = new Set(workspace.files.filter(f => (!path || f.path === path) && (name === 'english' || f.items.some(i => unresolved(i).length))).map(f => f.path)); preparedRequest = null;} render(); root.querySelector<HTMLElement>('.sheet .icon, .sheet input, .sheet button:not(.handle)')?.focus();}
function closeSheet() {sheet = null; replyTarget = null; editTarget = null; render(); lastFocus?.focus();}
function persist(changedPath?: string) {void saveWorkspace(workspace, changedPath).catch(error => toast(`保存できませんでした。バックアップしてください：${String(error)}`));}
function ask(question: string, run: () => void | Promise<void>) {confirmation = {question, run}; render(); root.querySelector<HTMLElement>('[data-action="confirm-cancel"]')?.focus();}
function reconcileCurrent() {
  // A resolved comment item stays available for inspection until the user
  // navigates away. The live targets() list still drives counts and movement.
  if(itemFilter==='comment' && currentItem()) return;
  if (!targets().some(i => i.id === currentId)) {currentId = targets()[0]?.id ?? null; if (!currentId && sheet === 'comments') sheet = null;}
}
function selectItem(id: string) {currentId = id; before = after = 3; usageIndex = 0; contextOpen = true;}
function move(delta: number) {
  if(!path) return;
  const target=navigationTarget(workspace.files,path,currentId,itemFilter,homeFilter,delta<0?-1:1);
  if(!target) return;
  const go=()=>{
    if(target.crossesFile) {path=target.file.path;itemFilter=target.filter;itemQuery='';sheet=null;}
    selectItem(target.item.id);render();root.querySelector('.review')?.scrollTo(0,0);
  };
  if(target.crossesFile) ask(navigationQuestion(path,target),go);else go();
}
function refreshTextView(position=false) {
  const scroller=root.querySelector<HTMLElement>('.text-scroll');
  if(!textView || !scroller) return;
  if(position) scroller.scrollTop=textView.offsets[textView.language]??Math.max(0,(targetLine(textView)-1)*textLineHeight-88);
  paintTextView(textView,scroller);
}
function treeRows(node: TreeNode, depth = 0): string {
  return node.children.filter(c => c.visible).map(c => {
    const p = percent(c.done, c.total), isOpen = expanded.has(c.path);
    return `<button class="file-row ${c.file ? '' : 'folder'}" style="--depth:${depth}" data-action="${c.file ? 'file' : 'folder'}" data-value="${e(c.path)}" ${c.file ? '' : `aria-expanded="${isOpen}"`} title="${e(c.path)}"><span class="angle">${c.file ? '' : folderTriangle()}</span><span class="glyph">${icon(c.file ? 'file' : 'folder')}</span><span class="row-name">${e(c.name)}</span><span class="bar"><span class="fill" style="display:block;width:${p ?? 0}%"></span></span><span class="pct">${p === null ? '—' : p + '%'}</span><span class="count" aria-label="${c.total}項目">${compact(c.total)}</span></button>${!c.file && isOpen ? treeRows(c, depth + 1) : ''}`;
  }).join('');
}
function context(file: ReviewFile, item: Item) {
  const slot = file.slots.find(s => s.id === item.slotIds[0])!;
  const usages = file.usages[slot.id];
  const line = usages ? usages[usageIndex] : slot.command ? slot.line : undefined;
  const commands = line === undefined ? [] : initialContext(file, line, before, after);
  const index = file.commands.findIndex(c => c.line === line);
  if (!slot.command && !usages) return '';
  return `<button class="context-title" data-action="context" aria-expanded="${contextOpen}">周辺コマンド<span class="chevron ${contextOpen ? 'open' : ''}">${contextOpen ? '閉じる' : '開く'}${icon('down')}</span></button>${contextOpen ? `<div class="command-frame"><div class="context-tools">${usages ? `<span>使用箇所 ${usages.length ? usageIndex + 1 : 0} / ${usages.length}</span><button class="icon" aria-label="前の使用箇所" data-action="usage" data-value="-1" ${usageIndex <= 0 ? 'disabled' : ''}>${icon('back')}</button><button class="icon" aria-label="次の使用箇所" data-action="usage" data-value="1" ${usageIndex >= usages.length - 1 ? 'disabled' : ''}>${icon('next')}</button>` : '<span></span>'}<select id="context-lang" aria-label="コマンド表示言語"><option value="en" ${contextLang === 'en' ? 'selected' : ''}>英語</option><option value="ja" ${contextLang === 'ja' ? 'selected' : ''}>日本語</option></select></div>${commands.length ? `<button class="expand" data-action="expand" data-value="before" ${index - before <= 0 ? 'disabled' : ''}>前をさらに表示</button>${commands.map(c => `<div class="command ${c.line === line ? 'current' : ''}" style="color:${commandColor(c[contextLang])}" ${c.line === line ? 'aria-current="true"' : ''}>${e(c[contextLang])}</div>`).join('')}<button class="expand" data-action="expand" data-value="after" ${index + after >= file.commands.length - 1 ? 'disabled' : ''}>後をさらに表示</button>` : '<div class="empty">直接参照はありません</div>'}</div>` : ''}`;
}
function review(file: ReviewFile) {
  const item = currentItem(), list = targets(), index = list.findIndex(i => i.id === currentId);
  const previous=navigationTarget(workspace.files,file.path,currentId,itemFilter,homeFilter,-1);
  const next=navigationTarget(workspace.files,file.path,currentId,itemFilter,homeFilter,1);
  let body = '<div class="empty">対象の項目はありません</div>';
  if (item) {
    const slots = item.slotIds.map(id => file.slots.find(s => s.id === id)!);
    const pending = item.changes.filter(c => c.status === 'pending');
    const oldText = slots.map(s => s.translation).join('\n');
    const diff = pending.length ? characterDiff(oldText, slots.map(s => pending.find(c => c.slotId === s.id)?.after ?? s.translation).join('\n')) : null;
    body = `<button class="entry-open" data-action="items"><span class="entry-title">${e(item.title)}</span><span class="status ${isDone(item) ? 'done' : ''}">${isDone(item) ? '確認済み' : '未確認'}</span>${icon('list')}</button><div class="pair"><div><div class="label">原文</div><div class="text-box source">${e(slots.map(sourceText).join('\n'))}</div>${slots.some(s=>s.sourceMissing) ? '<button class="text-act" data-action="source-edit">原文を補う</button>' : ''}</div><div><div class="label">${diff ? '変更前の英訳' : '英訳'}</div><div class="text-box translation">${diff?.before ?? e(oldText)}</div>${slots.flatMap(slotWarnings).map(w => `<p class="slot-warning ${w === newlineWarning ? 'subtle' : ''}">${e(w)}</p>`).join('')}</div>${diff ? `<div><div class="label">変更後の英訳</div><div class="text-box translation-after">${diff.after}</div></div>` : ''}${pending.some(c=>c.rejectedBy) ? '<div class="rejected-proposal"><p class="hint">AIの再審で不採用になった変更があります。</p><button class="text-act" data-action="discard-rejected">不採用の変更を破棄</button></div>' : ''}</div>${context(file, item)}`;
  }
  return `<main class="scroll review">${!item ? `<button class="entry-open" data-action="items">項目を選択${icon('list')}</button>` : ''}${body}</main><footer class="bottom"><button class="comment-trigger" data-action="comments" ${!item ? 'disabled' : ''}>${icon('comment')}コメント${item?.threads.length ? `<span class="bubble">${item.threads.length}</span>` : ''}</button><span class="counter" aria-live="polite">${index + 1} / ${list.length}</span><button class="prevnext" data-action="prev" aria-label="前の項目" ${!previous ? 'disabled' : ''}>${icon('back')}</button><button class="prevnext next" data-action="next" aria-label="次の項目" ${!next ? 'disabled' : ''}>${icon('next')}</button></footer>${item && unresolved(item).length ? `<button class="float-comment" data-action="comments"><div class="float-head">未解決 ${unresolved(item).length}件</div><div class="float-preview">${e(latestPreview(item))}</div></button>` : ''}${item ? `<button class="approve ${isDone(item) ? 'undo' : ''}" data-action="approve">${icon(isDone(item) ? 'undo' : 'check-circle')}${isDone(item) ? '未確認に戻す' : '承認'}</button>` : ''}`;
}
function commentsBody() {
  const item = currentItem(); if (!item) return '<div class="empty">対象の項目はありません</div>';
  const threads = item.threads.filter(t => commentTab === 'all' || !t.resolved);
  const editText = editTarget ? item.threads.find(t => t.id === editTarget!.threadId)?.posts.find(p => p.id === editTarget!.postId)?.text : '';
  return `<div class="filters"><button class="pill ${commentTab === 'open' ? 'active' : ''}" data-action="comment-tab" data-value="open">未解決</button><button class="pill ${commentTab === 'all' ? 'active' : ''}" data-action="comment-tab" data-value="all">すべてのコメント</button></div><div class="sheet-body">${threads.map(threadView).join('') || '<div class="empty">コメントはありません</div>'}</div><form class="sheet-foot" id="comment-form"><textarea name="text" aria-label="コメント内容" placeholder="${editTarget ? 'コメントを編集' : replyTarget ? '返信を入力' : 'コメントを入力'}" required>${e(editText ?? '')}</textarea><div class="send-row"><span>${editTarget ? '編集中' : replyTarget ? '返信先を選択中' : ''}${editTarget || replyTarget ? '<button class="text-act" type="button" data-action="cancel-compose">キャンセル</button>' : ''}</span><button type="submit" class="primary">${editTarget ? '保存' : '送信'}</button></div></form>`;
}
function progressRows(node: TreeNode, depth = 0): string {
  return `<div class="progress-detail" style="--depth:${depth}"><span>${e(node.name)}</span><span>${node.done.toLocaleString()} / ${node.total.toLocaleString()}</span></div>${node.children.filter(c => !c.file).map(c => progressRows(c, depth + 1)).join('')}`;
}
function sheetBody() {
  if(sheet==='text' && textView) return textViewMarkup(textView);
  if (sheet === 'source') {
    const file=currentFile(), item=currentItem();
    if (!file || !item) return '';
    return `<form class="form source-edit" id="source-form">${file.slots.filter(s=>item.slotIds.includes(s.id) && s.sourceMissing).map(s=>`<label>原文<textarea name="${e(s.id)}" aria-label="補完する原文">${e(sourceText(s))}</textarea></label>`).join('')}<button class="primary" type="submit">保存</button></form>`;
  }
  if (sheet === 'load') return `<form class="form" id="load-form"><label>日本語原文 ZIP<input type="file" name="ja" accept=".zip,application/zip" required></label><label>英訳済み ZIP<input type="file" name="en" accept=".zip,application/zip" required></label><button class="primary" type="submit">読み込む</button></form>`;
  if (sheet === 'items') return `${filterButtons(itemFilter, 'item')}<div class="item-search"><input type="search" id="item-search" aria-label="翻訳項目を検索" placeholder="原文・英訳を検索" value="${e(itemQuery)}"></div><div class="sheet-body">${itemRows(currentFile()!,targets(),currentId,itemQuery)}</div>`;
  if (sheet === 'progress') return `<div class="sheet-body">${progressRows(fileTree(workspace.files, 'all'))}</div>`;
  if (sheet === 'diagnostics') return diagnosticsView(workspace.diagnostics, diagnosticTab);
  if (sheet === 'comments') return commentsBody();
  if (sheet === 'restore') return '<form class="form" id="restore-form"><label>バックアップ JSON<input type="file" name="backup" accept=".json,application/json" required></label><button class="primary" type="submit">復元する</button></form>';
  if (sheet === 'export') return `${exportRows()}<div class="sheet-foot"><div class="export-actions"><button class="primary" data-action="export-request" ${!exportSelection.size ? 'disabled' : ''}>JSONを出力</button><button class="text-act" data-action="english-zip" ${!exportSelection.size ? 'disabled' : ''}>英訳TXTを出力</button></div><div class="send-row"><button class="text-act" data-action="copy-instructions" ${!exportSelection.size ? 'disabled' : ''}>${icon('copy')}指示文をコピー</button></div></div>`;
  if (sheet === 'response') return '<form class="form" id="response-form"><label>回答JSON<input type="file" name="answer" accept=".json,application/json" required></label><label>修正済み英訳 ZIP（任意）<input type="file" name="revised" accept=".zip,application/zip"></label><button class="primary" type="submit">回答を読み込む</button></form>';
  if (sheet === 'english') return `${exportRows()}<div class="sheet-foot"><button class="primary" data-action="english-zip" ${!exportSelection.size ? 'disabled' : ''}>英訳TXTを出力</button></div>`;
  if (sheet === 'reload') return '<form class="form" id="reload-form"><label>修正済み英訳 ZIP<input type="file" name="revised" accept=".zip,application/zip" required></label><button class="primary" type="submit">英訳を再読み込み</button></form>';
  return '<div class="sheet-body"><div class="empty">コメントはありません</div></div>';
}
function render() {
  const scroll = root.querySelector('.scroll')?.scrollTop ?? 0;
  const sheetScroll = root.querySelector('.sheet-body')?.scrollTop ?? 0;
  const file = currentFile(), tree = fileTree(workspace.files, homeFilter), p = percent(tree.done, tree.total);
  root.innerHTML = `<header class="top">${file ? `<button class="icon" aria-label="戻る" data-action="home">${icon('back')}</button>` : ''}<h1 title="${e(file?.path ?? '翻訳レビュー')}">${e(file?.path.split('/').at(-1) ?? '翻訳レビュー')}</h1>${!file ? `<button class="overall" data-action="progress" aria-label="全体の進捗"><span class="ring" style="--progress:${p ?? 0}%"></span>${p === null ? '—' : p + '%'}</button>` : ''}<button class="icon" aria-label="メニュー" data-action="menu" aria-expanded="${menu}">${icon('menu')}</button></header>${menu ? `<nav class="menu" aria-label="メニュー"><button data-action="load">ファイルを読み込む</button><button data-action="diagnostics">読み込み結果 (エラー${workspace.diagnostics.filter(d => d.severity === 'error').length})</button><button data-action="export">レビューJSONを出力</button><button data-action="response">レビューJSONを読み込む</button><button data-action="reload">英訳TXTを再読み込み</button><button data-action="backup">状態をバックアップ</button><button data-action="restore">バックアップを復元</button></nav>` : ''}${file ? review(file) : `${filterButtons(homeFilter, 'home')}<main class="scroll file-scroll">${workspace.files.length ? treeRows(tree) || '<div class="empty">対象のファイルはありません</div>' : `<div class="empty">日本語と英語のTXTを読み込んでください<br><button class="primary" data-action="load">${icon('upload')} ファイルを読み込む</button></div>`}</main>`}${sheet ? `<div class="scrim" data-action="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${e(({load: 'ファイルを読み込む', items: '翻訳項目', comments: 'コメント', progress: '全体の進捗', diagnostics: '読み込み結果'} as Record<string,string>)[sheet] ?? '')}"><button class="handle" aria-label="下にスワイプして閉じる" tabindex="-1"></button><div class="sheet-head"><h2>${({load: 'ファイルを読み込む', items: '翻訳項目', comments: 'コメント', progress: '全体の進捗', diagnostics: '読み込み結果'} as Record<string,string>)[sheet] ?? ''}</h2><button class="icon" aria-label="閉じる" data-action="close">${icon('close')}</button></div>${sheetBody()}</section>` : ''}${toastMarkup()}${busy ? `<div class="busy" role="status"><div class="spinner"></div><div>${e(busy)}</div></div>` : ''}`;
  root.querySelector('.sheet')?.setAttribute('aria-label', sheetTitles[sheet ?? ''] ?? '');
  root.querySelector('.menu [data-action="backup"]')?.insertAdjacentHTML('beforebegin', '<button data-action="english">英訳TXTを出力</button>');
  const group = currentItem();
  if (file && group?.code === 103) root.querySelector('.menu')?.insertAdjacentHTML('beforeend', `<button data-action="split-group" ${canSplit(group) ? '' : 'disabled'}>コメントを行ごとに分割</button><button data-action="merge-group" ${canMerge(file, group) ? '' : 'disabled'}>次のコメントと結合</button>`);
  const heading = root.querySelector('.sheet h2'); if (heading) heading.textContent = sheetTitles[sheet ?? ''] ?? '';
  root.querySelector('.scroll')?.scrollTo(0, scroll);
  root.querySelector('.sheet-body')?.scrollTo(0, sheetScroll);
  const all = root.querySelector<HTMLInputElement>('#export-all');
  if (all) {const count = exportFiles().filter(f => exportSelection.has(f.path)).length; all.indeterminate = count > 0 && count < exportFiles().length;}
  if (instructionsPreview !== null) root.insertAdjacentHTML('beforeend', `<div class="dialog-overlay instructions-overlay"><section class="dialog instructions-dialog" role="dialog" aria-modal="true" aria-label="指示文"><div class="instructions-head"><h2>指示文</h2><button class="icon" aria-label="指示文を閉じる" data-action="close-instructions">${icon('close')}</button></div><pre class="instructions-text" tabindex="0">${e(instructionsPreview)}</pre></section></div>`);
  if(sheet==='text') refreshTextView();
  root.classList.toggle('has-comments', !!currentItem() && unresolved(currentItem()!).length > 0);
  if (confirmation) root.insertAdjacentHTML('beforeend', `<div class="dialog-overlay"><section class="dialog" role="alertdialog" aria-modal="true" aria-label="確認"><p>${e(confirmation.question)}</p><div class="dialog-actions"><button data-action="confirm-cancel">キャンセル</button><button class="primary" data-action="confirm-ok">確定</button></div></section></div>`);
}

root.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!button || button.disabled || busy) return;
  const {action, value, scope} = button.dataset;
  if (action === 'close-instructions') {closeInstructions(); return;}
  if (instructionsPreview !== null) return;
  if (action === 'preview-instructions' && noticeInstructions) {instructionsPreview = noticeInstructions; render(); root.querySelector<HTMLElement>('[data-action="close-instructions"]')?.focus(); return;}
  if (action === 'confirm-cancel') {confirmation = null; render(); return;}
  if (action === 'confirm-ok') {const fn = confirmation?.run; confirmation = null; try {void Promise.resolve(fn?.()).catch(error => toast(String(error)));} catch (error) {toast(String(error));} render(); return;}
  if (confirmation) return;
  if (action === 'menu') {menu = !menu; render(); return;}
  menu = false;
  if (action === 'home') {path = null; currentId = null; sheet = null;}
  else if (action === 'folder') {if (expanded.has(value!)) expanded.delete(value!); else expanded.add(value!);}
  else if (action === 'file') {path = value!; itemFilter = homeFilter; itemQuery=''; selectItem(targets()[0]?.id ?? '');}
  else if (action === 'filter') {if (scope === 'home') homeFilter = value as Filter; else {const retaining=itemFilter==='comment' && value==='comment' && !!currentItem();itemFilter = value as Filter; if (!retaining && !targets().some(i => i.id === currentId)) currentId = targets()[0]?.id ?? null;}}
  else if (action === 'pick') {selectItem(value!); closeSheet(); return;}
  else if (action === 'close') {closeSheet(); return;}
  else if (action === 'prev') {move(-1); return;}
  else if (action === 'next') {move(1); return;}
  else if (action === 'context') contextOpen = !contextOpen;
  else if (action === 'expand') {if (value === 'before') before += 8; else after += 8;}
  else if (action === 'usage') {usageIndex += Number(value); before = after = 3;}
  else if (action === 'approve') {
    const item = currentItem(), file = currentFile(); if (!item || !file) return;
    const approve = () => {approveItem(item, file.slots, true); if(itemFilter!=='comment') selectItem(nextAfterApproval(file.items, item.id, i => matches(i, itemFilter))); persist(file.path); render();};
    if (isDone(item)) {ask('確認済みを未確認に戻しますか？', () => {undoApproval(item); persist(file.path);}); return;}
    if (unresolved(item).length) {ask('未解決コメントを解決にしますか？', approve); return;}
    try {approve();} catch(error) {toast(String(error));} return;
  }
  else if (action === 'comment-tab') commentTab = value as 'open' | 'all';
  else if (action === 'diagnostic-tab') diagnosticTab = value as typeof diagnosticTab;
  else if(action==='open-diagnostic') {
    const diagnostic=workspace.diagnostics[Number(value)],document=diagnostic && diagnosticDocument(workspace,diagnostic.path);
    if(!document) {toast('テキストが保存されていません。ZIPを再読み込みしてください');return;}
    textView=createTextView(document,diagnostic);openSheet('text');refreshTextView(true);return;
  }
  else if(action==='diagnostic-back') {sheet='diagnostics';render();return;}
  else if(action==='text-language' && textView) {
    textView.offsets[textView.language]=root.querySelector('.text-scroll')?.scrollTop??0;
    textView.language=value as TextLanguage;render();refreshTextView(true);return;
  }
  else if (action === 'reply') {replyTarget = value!; editTarget = null; render(); root.querySelector<HTMLTextAreaElement>('textarea')?.focus(); return;}
  else if (action === 'edit') {editTarget = {threadId: button.dataset.thread!, postId: button.dataset.post!}; replyTarget = null; render(); root.querySelector<HTMLTextAreaElement>('textarea')?.focus(); return;}
  else if (action === 'delete') {
    const item = currentItem(), file = currentFile(); if (!item || !file) return;
    ask('このコメントを削除しますか？', () => {deleteComment(item, button.dataset.thread!, button.dataset.post!); persist(file.path);}); return;
  }
  else if (action === 'resolve') {
    const item = currentItem(), file = currentFile(); if (!item || !file) return;
    const thread = item.threads.find(t => t.id === value)!;
    try {setResolved(item, file.slots, thread.id, !thread.resolved); persist(file.path); reconcileCurrent();} catch (error) {toast(String(error)); return;}
  }
  else if (action === 'discard-rejected') {
    const item = currentItem(), file = currentFile(); if (!item || !file) return;
    ask('再審で不採用になった変更を破棄しますか？', () => {discardRejectedChanges(item); persist(file.path);}); return;
  }
  else if (action === 'cancel-compose') {replyTarget = null; editTarget = null;}
  else if (action === 'source-edit') {openSheet('source'); return;}
  else if (action === 'split-group' || action === 'merge-group') {
    const file = currentFile(), item = currentItem(); if (!file || !item) return;
    ask(action === 'split-group' ? 'コメントを行ごとに分割し、未確認に戻しますか？' : '次のコメントと結合し、未確認に戻しますか？', () => {currentId = action === 'split-group' ? splitGroup(file, item.id) : mergeGroup(file, item.id); persist(file.path); reconcileCurrent();}); return;
  }
  else if (action === 'backup') {download('woditor-review-backup.json', backupJson(workspace)); toast('バックアップを出力しました'); return;}
  else if (['export-request', 'copy-instructions', 'english-zip'].includes(action!)) {void exportReview(action!); return;}
  else if (['load', 'items', 'comments', 'progress', 'diagnostics', 'restore', 'export', 'response', 'reload', 'english'].includes(action!)) {openSheet(action!); return;}
  render();
});
root.addEventListener('input',event=>{
  const input=event.target as HTMLInputElement;
  if(input.id!=='item-search' || sheet!=='items') return;
  itemQuery=input.value;
  const body=root.querySelector('.sheet-body');
  if(body) {body.innerHTML=itemRows(currentFile()!,targets(),currentId,itemQuery);body.scrollTop=0;}
});
root.addEventListener('scroll',event=>{
  const element=event.target as HTMLElement;
  if(sheet==='text' && textView && element.matches('.text-scroll')) paintTextView(textView,element);
},true);
root.addEventListener('change', event => {const el = event.target as HTMLInputElement; if (el.id === 'export-all') {exportSelection = new Set(el.checked ? exportFiles().map(f => f.path) : []); preparedRequest = null; render(); return;} if (el.id === 'context-lang') {contextLang = el.value as 'en' | 'ja'; render();} if (el.dataset.exportPath) {if (el.checked) exportSelection.add(el.dataset.exportPath); else exportSelection.delete(el.dataset.exportPath); preparedRequest = null; render();}});
root.addEventListener('submit', async event => {
  const form = event.target as HTMLFormElement;
  if (form.id === 'source-form') {
    event.preventDefault(); const file=currentFile(), item=currentItem(); if(!file || !item) return;
    try {updateManualSources(file,item,new Map([...new FormData(form)].map(([id,text])=>[id,String(text)]))); persist(file.path); closeSheet();} catch(error){toast(String(error));} return;
  }
  if (form.id === 'comment-form') {
    event.preventDefault(); const item = currentItem(), file = currentFile(); if (!item || !file) return;
    const text = new FormData(form).get('text') as string;
    try {if (editTarget) editComment(item, editTarget.threadId, editTarget.postId, text); else addComment(item, text, replyTarget ?? undefined); replyTarget = null; editTarget = null; persist(file.path); reconcileCurrent(); render();} catch (error) {toast(String(error));}
    return;
  }
  if (form.id === 'restore-form') {
    event.preventDefault(); const file = new FormData(form).get('backup') as File;
    try {const restored = restoreJson(await file.text()); ask('現在の作業状態をバックアップで置き換えますか？', async () => {await saveWorkspace(restored); workspace = restored; path = currentId = null; sheet = null; expanded.clear(); render(); toast('バックアップを復元しました');});} catch (error) {toast(String(error));} return;
  }
  if (form.id === 'response-form' || form.id === 'reload-form') {
    event.preventDefault(); const data = new FormData(form), answer = data.get('answer') as File, revised = data.get('revised') as File;
    busy = '修正データを確認中…'; render();
    try {
      let parsed: ReviewFile[] | undefined;
      let diagnostics: Workspace['diagnostics'] = [];
      let documents=workspace.diagnosticDocuments??[];
      if (revised?.size) {
        const zip = sourceZip(workspace);
        const result = await parseArchives(zip.buffer as ArrayBuffer, await revised.arrayBuffer(), updateBusy, true);
        if (result.diagnostics.some(d => d.severity === 'error')) throw new Error(result.diagnostics.filter(d => d.severity === 'error').map(d => d.path + ': ' + d.message).join('\n'));
        if (!result.files.length) throw new Error('対応する英訳TXTがありません');
        parsed = result.files;
        diagnostics = result.diagnostics;
        documents=replaceDiagnosticDocuments(documents,result.diagnosticDocuments,[...result.files.map(f=>f.path),...result.diagnostics.map(d=>d.path)]);
      }
      if (form.id === 'response-form') workspace = importResponse(workspace, JSON.parse(await answer.text()), parsed);
      else workspace = mergeFiles({...workspace, diagnostics: withoutReplacedDiagnostics(workspace.diagnostics, parsed!.map(f => f.path))}, parsed!);
      workspace.diagnostics.push(...diagnostics);
      workspace.diagnosticDocuments=documents;
      await saveWorkspace(workspace); sheet = null; reconcileCurrent(); busy = ''; render(); toast('変更を読み込みました。再確認してください');
    } catch (error) {busy = ''; render(); toast(String(error));} return;
  }
  if (form.id !== 'load-form') return;
  event.preventDefault();
  const data = new FormData(form), ja = data.get('ja') as File, en = data.get('en') as File;
  if (!ja?.size || !en?.size) return;
  busy = '読み込み中…'; sheet = null; render();
  try {
    const result = await parseArchives(await ja.arrayBuffer(), await en.arrayBuffer(), updateBusy);
    diagnosticTab = 'error';
    const documents=replaceDiagnosticDocuments(workspace.diagnosticDocuments,result.diagnosticDocuments,[...result.files.map(f=>f.path),...result.diagnostics.map(d=>d.path)]);
    if (!result.files.length) {workspace.diagnostics = result.diagnostics;workspace.diagnosticDocuments=documents;await saveWorkspace(workspace);sheet = 'diagnostics'; busy = ''; render(); return;}
    if (workspace.files.length) {
      const attempted = [...result.files.map(f => f.path), ...result.diagnostics.map(d => d.path)];
      workspace = mergeFiles({...workspace, diagnostics: withoutReplacedDiagnostics(workspace.diagnostics, attempted)}, result.files);
      workspace.diagnostics.push(...result.diagnostics);
    } else workspace = {...emptyWorkspace(), ...result};
    workspace.diagnosticDocuments=documents;
    path = currentId = null;
    await saveWorkspace(workspace);
    if (result.diagnostics.length) sheet = 'diagnostics';
  } catch (error) {notice = String(error);}
  busy = ''; render();
});
async function exportReview(action: string) {
  busy = '出力を準備中…'; render();
  try {
    const files = workspace.files.filter(f => exportSelection.has(f.path));
    const rendered = await renderTranslations(files);
    for (const r of rendered) {const file = files.find(f => f.path === r.path)!; file.enText = r.text; file.version = r.version;}
    if (action === 'english-zip') download('en-US-reviewed.zip', zipSync(Object.fromEntries(files.map(f => [`en-US/texts/${f.path}`, strToU8((f.enBom ? '\uFEFF' : '') + f.enText)]))), 'application/zip');
    else {
      if (!preparedRequest) {preparedRequest = createRequest(workspace, [...exportSelection]); workspace.requests.push(preparedRequest);}
      if (action === 'export-request') download(reviewFileNames(preparedRequest).request, JSON.stringify(preparedRequest, null, 2));
      else {await navigator.clipboard.writeText(chatInstructions(preparedRequest));}
    }
    await saveWorkspace(workspace);
    busy = ''; render(); if (action === 'copy-instructions' && preparedRequest) toast('指示文をコピーしました', chatInstructions(preparedRequest));
  } catch (error) {busy = ''; render(); if (action === 'copy-instructions' && preparedRequest) toast('コピーできませんでした。指示文を確認してコピーしてください', chatInstructions(preparedRequest)); else toast(String(error));}
}
document.addEventListener('keydown', event => {
  const input = (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]');
  if (event.key === 'Escape') {if (instructionsPreview !== null) {closeInstructions(); return;} if (confirmation) {confirmation = null; render();} else if (sheet) closeSheet(); else {menu = false; render();} return;}
  if (event.key === 'Tab' && (sheet || confirmation || instructionsPreview !== null)) {
    const container = instructionsPreview !== null ? root.querySelector('.instructions-dialog')! : confirmation ? root.querySelector('.dialog')! : root.querySelector('.sheet')!;
    const focusable = [...container.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input, textarea, select, [tabindex="0"]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
  }
  if (!input && !sheet && !confirmation && path && !busy && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);}
});
let swipe: {x: number; y: number; target: HTMLElement; allowed: boolean} | null = null;
root.addEventListener('touchstart', event => {
  const target = event.target as HTMLElement, el = target.closest<HTMLElement>('.sheet');
  if (!el || target.closest('input,textarea,select,[contenteditable=true]') || target.closest('button:not(.handle):not(.pick-row)')) return;
  const body = el.querySelector('.sheet-body');
  swipe = {x: event.touches[0].clientX, y: event.touches[0].clientY, target: el, allowed: !!target.closest('.handle') || !!target.closest('.sheet-body') && (body?.scrollTop ?? 0) <= 0};
}, {passive: true});
root.addEventListener('touchmove', event => {
  if (!swipe?.allowed) return;
  const dy = event.touches[0].clientY - swipe.y, dx = event.touches[0].clientX - swipe.x;
  if (dy > 10 && dy > Math.abs(dx) * 1.5) {event.preventDefault(); swipe.target.style.transform = `translateY(${dy}px)`;}
}, {passive: false});
root.addEventListener('touchend', event => {
  if (!swipe) return;
  const dy = event.changedTouches[0].clientY - swipe.y, dx = event.changedTouches[0].clientX - swipe.x;
  if (swipe.allowed && dy > 85 && dy > Math.abs(dx) * 1.5) closeSheet();
  else swipe.target.style.transform = '';
  swipe = null;
});
busy = '保存したデータを読み込み中…'; render();
void loadWorkspace().then(saved => {if (saved) workspace = saved;}).catch(error => {notice = `保存データを読み込めません：${String(error)}`;}).finally(() => {busy = ''; render();});
registerPwa(toast);
