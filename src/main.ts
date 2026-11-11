import './styles.css';
import { emptyWorkspace, isDone, matches, sourceText, itemTitle, unresolved, type Workspace, type ReviewFile, type Item, type Filter, type ReviewRequest, type ReviewMode } from './model';
import { escape as e, icon, menuIcon, folderTriangle, filterButtons, fileTree, compact, percent, type TreeNode } from './ui';
import {contextView,positionContextMenu,type ContextMenu} from './context-view';
import {installTooltips} from './tooltips';
import {installViewport} from './viewport';
import {updateCommentScroll} from './comment-scroll';
import { parseArchives, renderTranslations } from './parser-client';
import { addComment, approveItem, deleteComment, discardRejectedChanges, editComment, latestComment, nextAfterApproval, setResolved, undoApproval } from './review-state';
import { backupFileName, backupJson, download, loadWorkspace, restoreJson, saveWorkspace } from './storage';
import { chatInstructions, createRequest, importResponse, mergeFiles, reviewFileNames, sourceZip } from './exchange';
import { characterDiff } from './diff';
import {displaySlotText} from './display-text';
import { strToU8, zipSync } from 'fflate';
import { registerPwa } from './pwa';
import { canMerge, canSplit, mergeGroup, splitGroup } from './grouping';
import { diagnosticDocument,diagnosticItem,diagnosticsView,replaceDiagnosticDocuments,withoutReplacedDiagnostics } from './diagnostics';
import { threadView } from './comments';
import { updateManualSources } from './source-edit';
import {newlineWarning,slotWarnings} from './translation-warnings';
import {itemRows} from './item-picker';
import {createTextView,paintTextView,targetLine,textLineHeight,textViewMarkup,type TextView,type TextLanguage} from './text-viewer';
import {navigationQuestion,navigationTarget} from './navigation';
import {DriveController} from './drive-controller';
import {driveView} from './drive-view';
import {workspaceHash} from './drive-sync';
import {ScreenHistory} from './screen-history';
import {loadPreferences,preferencesFrom,savePreferences,type Preferences} from './preferences';
import {exportTree,folderFiles} from './export-tree';

const root = document.querySelector<HTMLDivElement>('#app')!;
const hideTooltips=installTooltips();
const commentResize=new ResizeObserver(()=>updateCommentScroll(root));
let workspace: Workspace = emptyWorkspace();
let workspaceRevision=0;
let path: string | null = null, currentId: string | null = null;
let homeFilter: Filter = 'all', itemFilter: Filter = 'all';
let itemQuery='';
let textView:TextView|null=null;
const expanded = new Set<string>();
let folderScroll=0,renderedPath:string|null=null;
let preservePreviousScreen=false;
let menu = false, sheet: string | null = null;
let contextMenu:ContextMenu=null;
let before = 3, after = 3, usageIndex = 0, busy = '', notice = '';
let toastTimer: ReturnType<typeof setTimeout>;
let noticeInstructions: string | null = null, instructionsPreview: string | null = null;
function updateBusy(message: string) {busy = message; const el = root.querySelector('.busy > div:last-child'); if (el) el.textContent = message;}
let lastFocus: HTMLElement | null = null;
let commentTab: 'open' | 'all' = 'open', replyTarget: string | null = null;
let diagnosticTab: 'error' | 'warning' | 'skip' = 'error';
let editTarget: {threadId: string; postId: string} | null = null;
let commentDraft='',commentDraftItem='';
let commentAnchor:string|null=null;
let confirmation: {question: string; run: () => void | Promise<void>} | null = null;
let exportSelection = new Set<string>(), preparedRequest: ReviewRequest | null = null;
const exportCollapsed=new Set<string>();
let reviewMode: ReviewMode = 'comments';
let preferences=preferencesFrom(undefined);
function setPreferences(next:Partial<Preferences>) {
  preferences={...preferences,...next};void savePreferences(preferences).catch(error=>toast(`設定を保存できません：${String(error)}`));
}
let screenHistory:ScreenHistory<ReturnType<typeof screenState>>|undefined;
function screenState() {
  return {workspaceRevision,path,currentId,sheet,menu,homeFilter,itemFilter,itemQuery,before,after,usageIndex,contextMenu,
    commentTab,commentAnchor,diagnosticTab,textView:textView && {...textView,offsets:{...textView.offsets}},
    confirmation,instructionsPreview,reviewMode,exportSelection:new Set(exportSelection),preparedRequest};
}
function historyScreen() {
  return {preservePrevious:preservePreviousScreen,base:path ? `file:${path}` : 'home',layers:[...(sheet ? [`sheet:${sheet}`] : menu ? ['menu'] : []),
    ...(contextMenu ? ['context-menu:'+contextMenu] : []),...(instructionsPreview!==null ? ['instructions'] : []),...(confirmation ? ['confirmation'] : [])],value:screenState()};
}
function restoreScreen(state:ReturnType<typeof screenState>) {
  ({path,currentId,sheet,menu,homeFilter,itemFilter,itemQuery,before,after,usageIndex,contextMenu,
    commentTab,commentAnchor,diagnosticTab,textView,confirmation,instructionsPreview,reviewMode,preparedRequest}=state);
  exportSelection=new Set(state.exportSelection);
  reviewMode=preferences.reviewMode??reviewMode;
  if(preferences.contextFull && contextMenu==='radius') contextMenu=null;
  before=after=preferences.contextRadius;
  if(state.workspaceRevision!==workspaceRevision) {contextMenu=null;sheet=null;menu=false;confirmation=null;instructionsPreview=null;textView=null;preparedRequest=null;}
  if(path && !currentFile()) {path=currentId=sheet=null;menu=false;confirmation=null;instructionsPreview=null;}
  if(path && !currentItem()) reconcileCurrent();
  render();if(sheet==='text') refreshTextView(true);
  const focus=instructionsPreview!==null ? '.instructions-dialog button' : confirmation ? '.dialog button' : sheet==='comments' && !commentAnchor ? '#comment-form textarea' : sheet ? '.sheet .icon' : '.top .icon';
  root.querySelector<HTMLElement>(focus)?.focus({preventScroll:true});
  if(sheet==='comments' && !confirmation && instructionsPreview===null) revealComment();
}
const sheetTitles: Record<string,string> = {load: 'ファイルを読み込む', items: '翻訳項目', comments: 'コメント', progress: '全体の進捗', diagnostics: '読み込み結果', restore: 'バックアップを復元', export: 'AIレビューを依頼', response: 'AIレビュー結果を読み込む', english: '英訳TXTを出力'};
sheetTitles.source = '原文を補う';
sheetTitles.text = 'テキスト表示';
sheetTitles.drive = 'Google Drive同期';
const drive = new DriveController({getWorkspace: () => workspace,
  applyWorkspace: async (next, expectedHash) => {
    if (busy || confirmation || instructionsPreview || sheet && sheet !== 'drive') throw new Error('編集中の画面を閉じてから、もう一度同期してください');
    busy = 'Driveの変更を保存中…'; render();
    try {
      if (await workspaceHash(workspace) !== expectedHash) throw new Error('同期中に端末のデータが変わりました。もう一度同期してください');
      await saveWorkspace(next); workspace = next; workspaceRevision++; path = currentId = null; preparedRequest = null; textView = null;
    } finally {busy = ''; render();}
  }, canAutoSync: () => !busy && !sheet && !confirmation && !instructionsPreview && document.visibilityState === 'visible',
  changed: () => {if (sheet === 'drive') render();},
});
const currentFile = () => workspace.files.find(f => f.path === path);
const currentItem = () => currentFile()?.items.find(i => i.id === currentId);
const targets = () => currentFile()?.items.filter(i => matches(i, itemFilter)) ?? [];
function toastMarkup() {return notice ? `<div class="toast" role="status">${e(notice)}${noticeInstructions ? '<button data-action="preview-instructions">指示文を確認</button>' : ''}</div>` : '';}
function toast(message: string, instructions: string | null = null) {notice = message; noticeInstructions = instructions; clearTimeout(toastTimer); root.querySelector('.toast')?.remove(); if (!menu) root.querySelector('.menu')?.remove(); root.insertAdjacentHTML('beforeend', toastMarkup()); screenHistory?.sync(historyScreen()); toastTimer = setTimeout(() => {notice = ''; noticeInstructions = null; root.querySelector('.toast')?.remove();}, instructions ? 10000 : 5000);}
function closeInstructions() {instructionsPreview = null; render(); root.querySelector<HTMLElement>('[data-action="preview-instructions"], [data-action="copy-instructions"]')?.focus();}
function exportFiles() {return workspace.files.filter(f => sheet === 'english' || reviewMode === 'initial' || f.items.some(i => unresolved(i).length));}
function resetExportSelection() {exportSelection = new Set(exportFiles().filter(f => !path || f.path === path).map(f => f.path)); preparedRequest = null;}
function exportRows() {
  const files = exportFiles(), checked = files.filter(f => exportSelection.has(f.path)).length;
  return `<div class="sheet-body"><label class="export-row export-all"><input id="export-all" type="checkbox" ${files.length && checked === files.length ? 'checked' : ''} ${!files.length ? 'disabled' : ''}>すべて選択</label>${files.length ? exportTree(files,exportSelection,exportCollapsed) : '<div class="empty">出力対象のファイルはありません</div>'}</div>`;
}
function openSheet(name:string,postId:string|null=null) {
  lastFocus=document.activeElement as HTMLElement;sheet=name;menu=false;commentAnchor=name==='comments'?postId:null;
  if(name==='diagnostics') diagnosticTab='error';
  if(name==='export') {reviewMode=preferences.reviewMode??(workspace.files.some(f=>(!path||f.path===path)&&f.items.some(i=>unresolved(i).length))?'comments':'initial');setPreferences({reviewMode});}
  if(name==='export'||name==='english') resetExportSelection();
  render();
  root.querySelector<HTMLElement>(name==='comments'&&!commentAnchor?'#comment-form textarea':'.sheet .icon, .sheet input, .sheet button:not(.handle)')?.focus({preventScroll:true});
  if(name==='items') revealCurrentItem();
  if(name==='comments') revealComment();
}
function closeSheet() {sheet = null;commentAnchor=null; render(); lastFocus?.focus();}
function revealComment() {
  if(!commentAnchor) return;
  const list=root.querySelector<HTMLElement>('.comments-list');
  const post=[...root.querySelectorAll<HTMLElement>('[data-post-id]')].find(element=>element.dataset.postId===commentAnchor);
  if(!list||!post) return;
  post.focus({preventScroll:true});
  list.scrollTop+=post.getBoundingClientRect().top-list.getBoundingClientRect().top-12;
  updateCommentScroll(root);
}
function revealCurrentItem() {
  const body=root.querySelector<HTMLElement>('.sheet-body'),active=root.querySelector<HTMLElement>('.pick-row.active');
  if(body) body.scrollTop=active ? body.scrollTop+active.getBoundingClientRect().top-body.getBoundingClientRect().top-(body.clientHeight-active.clientHeight)/2 : 0;
}
function persist(changedPath?: string) {void saveWorkspace(workspace, changedPath).catch(error => toast(`保存できませんでした。バックアップしてください：${String(error)}`));}
function ask(question: string, run: () => void | Promise<void>) {confirmation = {question, run}; render(); root.querySelector<HTMLElement>('[data-action="confirm-cancel"]')?.focus();}
function reconcileCurrent() {
  // A resolved comment item stays available for inspection until the user
  // navigates away. The live targets() list still drives counts and movement.
  if(itemFilter==='comment' && currentItem()) return;
  if (!targets().some(i => i.id === currentId)) {currentId = targets()[0]?.id ?? null; if (!currentId && sheet === 'comments') sheet = null;}
}
function selectItem(id: string) {currentId = id; before = after = preferences.contextRadius; usageIndex = 0; contextMenu=null;commentAnchor=null;}
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
function context(file:ReviewFile,item:Item) {return contextView(file,item,preferences,{usageIndex,before,after,menu:contextMenu});}
function review(file: ReviewFile) {
  const item = currentItem(), preview=item && latestComment(item), list = targets(), index = list.findIndex(i => i.id === currentId);
  const previous=navigationTarget(workspace.files,file.path,currentId,itemFilter,homeFilter,-1);
  const next=navigationTarget(workspace.files,file.path,currentId,itemFilter,homeFilter,1);
  let body = '<div class="empty">対象の項目はありません</div>';
  if (item) {
    const slots = item.slotIds.map(id => file.slots.find(s => s.id === id)!);
    const pending = item.changes.filter(c => c.status === 'pending');
    const oldText = slots.map(s => displaySlotText(file,s,s.translation)).join('\n');
    const diff = pending.length ? characterDiff(oldText, slots.map(s => displaySlotText(file,s,pending.find(c => c.slotId === s.id)?.after ?? s.translation)).join('\n')) : null;
    body = `<button class="entry-open" data-action="items"><span class="entry-title">${e(itemTitle(file,item))}</span><span class="status ${isDone(item) ? 'done' : ''}">${isDone(item) ? '確認済み' : '未確認'}</span>${icon('list')}</button><div class="pair"><div><div class="label">原文</div><div class="text-box source">${e(slots.map(s=>displaySlotText(file,s,sourceText(s))).join('\n'))}</div>${slots.some(s=>s.sourceMissing) ? '<button class="text-act" data-action="source-edit">原文を補う</button>' : ''}</div><div><div class="label">${diff ? '変更前の英訳' : '英訳'}</div><div class="text-box translation">${diff?.before ?? e(oldText)}</div>${slots.flatMap(s=>slotWarnings(s,file)).map(w => `<p class="slot-warning ${w === newlineWarning ? 'subtle' : ''}">${e(w)}</p>`).join('')}</div>${diff ? `<div><div class="label">変更後の英訳</div><div class="text-box translation-after">${diff.after}</div></div>` : ''}${pending.some(c=>c.rejectedBy) ? '<div class="rejected-proposal"><p class="hint">AIの再審で不採用になった変更があります。</p><button class="text-act" data-action="discard-rejected">不採用の変更を破棄</button></div>' : ''}</div>${context(file, item)}`;
  }
  return `<main class="scroll review">${!item ? `<button class="entry-open" data-action="items">項目を選択${icon('list')}</button>` : ''}${body}</main><footer class="bottom"><button class="comment-trigger" data-action="comments" ${!item ? 'disabled' : ''}>${icon('comment')}<span class="comment-label">コメント</span>${item?.threads.length ? `<span class="bubble">${item.threads.length}</span>` : ''}</button><span class="counter" aria-live="polite">${index + 1} / ${list.length}</span><button class="prevnext" data-action="prev" aria-label="前の項目" ${!previous ? 'disabled' : ''}>${icon('back')}</button><button class="prevnext next" data-action="next" aria-label="次の項目" ${!next ? 'disabled' : ''}>${icon('next')}</button></footer>${item && preview ? `<button class="float-comment" data-action="comment-preview" data-value="${e(preview.post.id)}"><div class="float-head">未解決 ${unresolved(item).length}件</div><div class="float-preview">${e(preview.post.text)}</div></button>` : ''}${item ? `<button class="approve ${isDone(item) ? 'undo' : ''}" data-action="approve">${icon(isDone(item) ? 'undo' : 'check-circle')}${isDone(item) ? '未確認に戻す' : '承認'}</button>` : ''}`;
}
function commentsBody() {
  const item = currentItem(); if (!item) return '<div class="empty">対象の項目はありません</div>';
  const threads = item.threads.filter(t => commentTab === 'all' || !t.resolved);
  return `<div class="filters"><button class="pill ${commentTab === 'open' ? 'active' : ''}" data-action="comment-tab" data-value="open">未解決</button><button class="pill ${commentTab === 'all' ? 'active' : ''}" data-action="comment-tab" data-value="all">すべてのコメント</button></div><div class="comment-scroll"><div class="sheet-body comments-list">${threads.map(threadView).join('') || '<div class="empty">コメントはありません</div>'}</div><button class="scroll-hint scroll-up" aria-label="コメントを上にスクロール" data-action="comment-scroll" data-value="-1" hidden>${icon('down')}</button><button class="scroll-hint scroll-down" aria-label="コメントを下にスクロール" data-action="comment-scroll" data-value="1" hidden>${icon('down')}</button></div><form class="sheet-foot" id="comment-form"><textarea name="text" aria-label="コメント内容" placeholder="${editTarget ? 'コメントを編集' : replyTarget ? '返信を入力' : 'コメントを入力'}" required>${e(commentDraft)}</textarea><div class="send-row"><span>${editTarget ? '編集中' : replyTarget ? '返信先を選択中' : ''}${editTarget || replyTarget ? '<button class="text-act" type="button" data-action="cancel-compose">キャンセル</button>' : ''}</span><button type="submit" class="primary">${editTarget ? '保存' : '送信'}</button></div></form>`;
}
function progressRows(node: TreeNode, depth = 0): string {
  return `<div class="progress-detail" style="--depth:${depth}"><span>${e(node.name)}</span><span>${node.done.toLocaleString()} / ${node.total.toLocaleString()}</span></div>${node.children.filter(c => !c.file).map(c => progressRows(c, depth + 1)).join('')}`;
}
function sheetBody() {
  if (sheet === 'drive') return driveView(drive.state);
  if(sheet==='text' && textView) return textViewMarkup(textView);
  if (sheet === 'source') {
    const file=currentFile(), item=currentItem();
    if (!file || !item) return '';
    return `<form class="form source-edit" id="source-form">${file.slots.filter(s=>item.slotIds.includes(s.id) && s.sourceMissing).map(s=>`<label>原文<textarea name="${e(s.id)}" aria-label="補完する原文">${e(sourceText(s))}</textarea></label>`).join('')}<button class="primary" type="submit">保存</button></form>`;
  }
  if (sheet === 'load') return `<form class="form" id="load-form"><label>日本語原文 ZIP${workspace.files.length ? '（省略すると現在の原文を使用）' : ''}<input type="file" name="ja" accept=".zip,application/zip" ${workspace.files.length ? '' : 'required'}></label><label>英訳済み ZIP<input type="file" name="en" accept=".zip,application/zip" required></label><button class="primary" type="submit">読み込む</button></form>`;
  if (sheet === 'items') return `${filterButtons(itemFilter, 'item')}<div class="item-search"><input type="search" id="item-search" aria-label="翻訳項目を検索" placeholder="原文・英訳を検索" value="${e(itemQuery)}"></div><div class="sheet-body">${itemRows(currentFile()!,targets(),currentId,itemQuery)}</div>`;
  if (sheet === 'progress') return `<div class="sheet-body">${progressRows(fileTree(workspace.files, 'all'))}</div>`;
  if (sheet === 'diagnostics') return diagnosticsView(workspace.diagnostics, diagnosticTab,workspace);
  if (sheet === 'comments') return commentsBody();
  if (sheet === 'restore') return '<form class="form" id="restore-form"><label>バックアップ JSON<input type="file" name="backup" accept=".json,application/json" required></label><button class="primary" type="submit">復元する</button></form>';
  if (sheet === 'export') return `<fieldset class="review-mode"><legend>依頼内容</legend><label><input type="radio" name="review-mode" value="initial" ${reviewMode === 'initial' ? 'checked' : ''}>英訳をチェックして指摘を作る</label><label><input type="radio" name="review-mode" value="comments" ${reviewMode === 'comments' ? 'checked' : ''}>既存コメントに回答・修正する</label></fieldset>${exportRows()}<div class="sheet-foot"><div class="export-actions"><button class="primary" data-action="export-request" ${!exportSelection.size ? 'disabled' : ''}>JSONを出力</button><button class="text-act" data-action="english-zip" ${!exportSelection.size ? 'disabled' : ''}>英訳TXTを出力</button></div><div class="send-row"><button class="text-act" data-action="copy-instructions" ${!exportSelection.size ? 'disabled' : ''}>${icon('copy')}指示文をコピー</button></div></div>`;
  if (sheet === 'response') return '<form class="form" id="response-form"><label>回答JSON<input type="file" name="answer" accept=".json,application/json" required></label><label>修正済み英訳 ZIP（任意）<input type="file" name="revised" accept=".zip,application/zip"></label><button class="primary" type="submit">回答を読み込む</button></form>';
  if (sheet === 'english') return `${exportRows()}<div class="sheet-foot"><button class="primary" data-action="english-zip" ${!exportSelection.size ? 'disabled' : ''}>英訳TXTを出力</button></div>`;
  return '<div class="sheet-body"><div class="empty">コメントはありません</div></div>';
}
function render() {
  hideTooltips();
  commentResize.disconnect();
  const draftItem=JSON.stringify([workspaceRevision,path,currentId]);
  if(commentDraftItem!==draftItem) {commentDraftItem=draftItem;commentDraft='';replyTarget=null;editTarget=null;}

  const folder=root.querySelector('.file-scroll');if(folder) folderScroll=folder.scrollTop;
  const scroll = renderedPath===path ? root.querySelector('.review')?.scrollTop ?? 0 : 0;
  const sheetScroll = root.querySelector('.sheet-body')?.scrollTop ?? 0;
  const file = currentFile(), tree = fileTree(workspace.files, homeFilter), p = percent(tree.done, tree.total);
  root.innerHTML = `<header class="top">${file ? `<button class="icon" aria-label="戻る" data-action="home">${icon('back')}</button>` : ''}<h1 title="${e(file?.path ?? 'Woditor Review')}">${e(file?.path.split('/').at(-1) ?? 'Woditor Review')}</h1>${!file ? `<button class="overall" data-action="progress" aria-label="全体の進捗"><span class="ring" style="--progress:${p ?? 0}%"></span>${p === null ? '—' : p + '%'}</button>` : ''}<button class="icon" aria-label="メニュー" data-action="menu" aria-expanded="${menu}">${icon('menu')}</button></header>${menu ? `<div class="menu-dismiss" data-action="dismiss-menu" aria-hidden="true"></div><nav class="menu" aria-label="メニュー"><button data-action="load">ファイルを読み込む</button><button data-action="diagnostics">読み込み結果 (エラー${workspace.diagnostics.filter(d => d.severity === 'error').length})</button><button data-action="export">AIレビューを依頼</button><button data-action="response">AIレビュー結果を読み込む</button><button data-action="backup">状態をバックアップ</button><button data-action="restore">バックアップを復元</button></nav>` : ''}${file ? review(file) : `${filterButtons(homeFilter, 'home')}<main class="scroll file-scroll">${workspace.files.length ? treeRows(tree) || '<div class="empty">対象のファイルはありません</div>' : `<div class="empty">日本語と英語のTXTを読み込んでください<br><button class="primary" data-action="load">${icon('upload')} ファイルを読み込む</button></div>`}</main>`}${sheet ? `<div class="scrim" data-action="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="${e(({load: 'ファイルを読み込む', items: '翻訳項目', comments: 'コメント', progress: '全体の進捗', diagnostics: '読み込み結果'} as Record<string,string>)[sheet] ?? '')}"><button class="handle" aria-label="下にスワイプして閉じる" tabindex="-1"></button><div class="sheet-head"><h2>${({load: 'ファイルを読み込む', items: '翻訳項目', comments: 'コメント', progress: '全体の進捗', diagnostics: '読み込み結果'} as Record<string,string>)[sheet] ?? ''}</h2><button class="icon" aria-label="閉じる" data-action="close">${icon('close')}</button></div>${sheetBody()}</section>` : ''}${toastMarkup()}${busy ? `<div class="busy" role="status"><div class="spinner"></div><div>${e(busy)}</div></div>` : ''}`;
  root.querySelector('.sheet')?.setAttribute('aria-label', sheetTitles[sheet ?? ''] ?? '');
  root.querySelector('.menu [data-action="backup"]')?.insertAdjacentHTML('beforebegin', '<button data-action="english">英訳TXTを出力</button>');
  root.querySelector('.menu [data-action="backup"]')?.insertAdjacentHTML('beforebegin', '<button data-action="drive">Google Drive同期</button>');
  const group = currentItem();
  if (file && group?.code === 103) root.querySelector('.menu')?.insertAdjacentHTML('beforeend', `<button data-action="split-group" ${canSplit(group) ? '' : 'disabled'}>コメントを行ごとに分割</button><button data-action="merge-group" ${canMerge(file, group) ? '' : 'disabled'}>次のコメントと結合</button>`);
  const heading = root.querySelector('.sheet h2'); if (heading) heading.textContent = sheetTitles[sheet ?? ''] ?? '';
  root.querySelectorAll<HTMLButtonElement>('.menu [data-action]').forEach(button => button.insertAdjacentHTML('afterbegin', menuIcon(button.dataset.action!)));
  root.querySelector('.review')?.scrollTo(0, scroll);
  root.querySelector('.file-scroll')?.scrollTo(0,folderScroll);renderedPath=path;
  root.querySelector('.sheet-body')?.scrollTo(0, sheetScroll);
  const all = root.querySelector<HTMLInputElement>('#export-all');
  if (all) {const count = exportFiles().filter(f => exportSelection.has(f.path)).length; all.indeterminate = count > 0 && count < exportFiles().length;}
  root.querySelectorAll<HTMLInputElement>('[data-export-folder]').forEach(input=>{
    const files=folderFiles(exportFiles(),input.dataset.exportFolder!),count=files.filter(f=>exportSelection.has(f.path)).length;
    input.indeterminate=count>0 && count<files.length;
  });
  if (instructionsPreview !== null) root.insertAdjacentHTML('beforeend', `<div class="dialog-overlay instructions-overlay"><section class="dialog instructions-dialog" role="dialog" aria-modal="true" aria-label="指示文"><div class="instructions-head"><h2>指示文</h2><button class="icon" aria-label="指示文を閉じる" data-action="close-instructions">${icon('close')}</button></div><pre class="instructions-text" tabindex="0">${e(instructionsPreview)}</pre></section></div>`);
  if(sheet==='text') refreshTextView();
  positionContextMenu(root);
  const comments=root.querySelector('.comments-list');if(comments) commentResize.observe(comments);
  updateCommentScroll(root);
  root.classList.toggle('has-comments', !!currentItem() && unresolved(currentItem()!).length > 0);
  if (confirmation) root.insertAdjacentHTML('beforeend', `<div class="dialog-overlay"><section class="dialog" role="alertdialog" aria-modal="true" aria-label="確認"><p>${e(confirmation.question)}</p><div class="dialog-actions"><button data-action="confirm-cancel">キャンセル</button><button class="primary" data-action="confirm-ok">確定</button></div></section></div>`);
  screenHistory?.sync(historyScreen());
  preservePreviousScreen=false;
}

document.addEventListener('pointerdown',event=>{if((menu||contextMenu) && !root.contains(event.target as Node)) {menu=false;contextMenu=null;render();}});
root.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if(contextMenu && !(event.target as HTMLElement).closest('.context-popover,[data-action=context-menu]')) {contextMenu=null;render();return;}
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
  if (action === 'drive') {openSheet('drive'); void drive.prepare(); return;}
  if (action === 'drive-connect') {void drive.connect(); return;}
  if (action === 'drive-disconnect') {drive.disconnect(); return;}
  if (action === 'drive-sync') {void drive.sync(); return;}
  if (action === 'drive-recovery' && drive.state.recovery) {download(backupFileName(), backupJson(drive.state.recovery)); return;}
  if (action === 'drive-use-local' || action === 'drive-use-remote') {
    const expectedHeads = drive.state.conflicts.map(r => r.id);
    ask(action === 'drive-use-local' ? 'この端末の状態をDriveにも採用しますか？' : '選んだDriveの状態をこの端末に反映しますか？同期前の端末データは復旧用に保存します。',
      () => drive.sync({use: action === 'drive-use-local' ? 'local' : 'remote', revision: value, expectedHeads})); return;
  }
  if (action === 'home') {path = null; currentId = null; sheet = null;}
  else if (action === 'folder') {if (expanded.has(value!)) expanded.delete(value!); else expanded.add(value!);}
  else if (action === 'export-folder') {if(exportCollapsed.has(value!)) exportCollapsed.delete(value!);else exportCollapsed.add(value!);}
  else if (action === 'file') {path = value!; itemFilter = homeFilter; itemQuery=''; selectItem(targets()[0]?.id ?? '');}
  else if (action === 'filter') {if (scope === 'home') homeFilter = value as Filter; else {const retaining=itemFilter==='comment' && value==='comment' && !!currentItem();itemFilter = value as Filter; if (!retaining && !targets().some(i => i.id === currentId)) currentId = targets()[0]?.id ?? null;}}
  else if (action === 'pick') {selectItem(value!); closeSheet(); return;}
  else if (action === 'close') {closeSheet(); return;}
  else if (action === 'prev') {move(-1); return;}
  else if (action === 'next') {move(1); return;}
  else if(action==='context') {contextMenu=null;setPreferences({contextOpen:!preferences.contextOpen});}
  else if(action==='context-menu') contextMenu=contextMenu===value?null:value as ContextMenu;
  else if(action==='context-radius') {const radius=Number(value);if(radius>=3 && radius<=10) {setPreferences({contextRadius:radius});before=after=radius;}contextMenu=null;}
  else if(action==='context-language') {if(value==='ja'||value==='en') setPreferences({contextLanguage:value});contextMenu=null;}
  else if(action==='context-toggle' && ['contextFull','contextLineNumbers','contextWrap'].includes(value!)) {const key=value as 'contextFull'|'contextLineNumbers'|'contextWrap';setPreferences({[key]:!preferences[key]});}
  else if (action === 'expand') {if (value === 'before') before += 8; else after += 8;}
  else if (action === 'usage') {usageIndex += Number(value); before = after = preferences.contextRadius;}
  else if (action === 'approve') {
    const item = currentItem(), file = currentFile(); if (!item || !file) return;
    const approve = () => {approveItem(item, file.slots, true); if(itemFilter!=='comment') selectItem(nextAfterApproval(file.items, item.id, i => matches(i, itemFilter))); persist(file.path); render();};
    if (isDone(item)) {ask('確認済みを未確認に戻しますか？', () => {undoApproval(item); persist(file.path);}); return;}
    if (unresolved(item).length) {ask('未解決コメントを解決にしますか？', approve); return;}
    try {approve();} catch(error) {toast(String(error));} return;
  }
  else if (action === 'comment-tab') commentTab = value as 'open' | 'all';
  else if(action==='comment-preview') {openSheet('comments',value??null);return;}
  else if(action==='comment-scroll') {const list=root.querySelector('.comments-list');list?.scrollBy({top:Number(value)*Math.max(120,list.clientHeight*.7),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});return;}
  else if (action === 'diagnostic-tab') diagnosticTab = value as typeof diagnosticTab;
  else if(action==='diagnostic-item') {
    const diagnostic=workspace.diagnostics[Number(value)],target=diagnostic && diagnosticItem(workspace,diagnostic);
    if(!target) {toast('対応する翻訳項目がありません');return;}
    preservePreviousScreen=true;path=target.file.path;itemFilter='all';itemQuery='';sheet=null;selectItem(target.item.id);render();root.querySelector('.review')?.scrollTo(0,0);return;
  }
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
  else if (action === 'reply') {if(editTarget) commentDraft='';replyTarget = value!; editTarget = null; render(); root.querySelector<HTMLTextAreaElement>('textarea')?.focus(); return;}
  else if (action === 'edit') {editTarget = {threadId: button.dataset.thread!, postId: button.dataset.post!}; replyTarget = null; commentDraft=currentItem()?.threads.find(t=>t.id===editTarget!.threadId)?.posts.find(p=>p.id===editTarget!.postId)?.text??''; render(); root.querySelector<HTMLTextAreaElement>('textarea')?.focus(); return;}
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
  else if (action === 'cancel-compose') {replyTarget = null; editTarget = null; commentDraft='';}
  else if (action === 'source-edit') {openSheet('source'); return;}
  else if (action === 'split-group' || action === 'merge-group') {
    const file = currentFile(), item = currentItem(); if (!file || !item) return;
    ask(action === 'split-group' ? 'コメントを行ごとに分割し、未確認に戻しますか？' : '次のコメントと結合し、未確認に戻しますか？', () => {currentId = action === 'split-group' ? splitGroup(file, item.id) : mergeGroup(file, item.id); persist(file.path); reconcileCurrent();}); return;
  }
  else if (action === 'backup') {download(backupFileName(), backupJson(workspace)); toast('バックアップを出力しました'); return;}
  else if (['export-request', 'copy-instructions', 'english-zip'].includes(action!)) {void exportReview(action!); return;}
  else if (['load', 'items', 'comments', 'progress', 'diagnostics', 'restore', 'export', 'response', 'english'].includes(action!)) {openSheet(action!); return;}
  render();
});
root.addEventListener('input',event=>{
  const input=event.target as HTMLInputElement;
  if(input.matches('#comment-form textarea')) {commentDraft=input.value;return;}
  if(input.id!=='item-search' || sheet!=='items') return;
  itemQuery=input.value;
  const body=root.querySelector('.sheet-body');
  if(body) {body.innerHTML=itemRows(currentFile()!,targets(),currentId,itemQuery);body.scrollTop=0;}
});
root.addEventListener('scroll',event=>{
  const element=event.target as HTMLElement;
  if(sheet==='text' && textView && element.matches('.text-scroll')) paintTextView(textView,element);
  if(element.matches('.comments-list')) updateCommentScroll(root);
},true);
root.addEventListener('change', event => {const el = event.target as HTMLInputElement; if (el.name === 'review-mode') {reviewMode = el.value as ReviewMode; setPreferences({reviewMode}); resetExportSelection(); render(); return;} if(el.dataset.exportFolder) {for(const file of folderFiles(exportFiles(),el.dataset.exportFolder)) {if(el.checked) exportSelection.add(file.path);else exportSelection.delete(file.path);}preparedRequest=null;render();return;} if (el.id === 'drive-auto') {void drive.setAutomatic(el.checked).catch(error => toast(String(error))); return;} if (el.id === 'export-all') {exportSelection = new Set(el.checked ? exportFiles().map(f => f.path) : []); preparedRequest = null; render(); return;} if (el.dataset.exportPath) {if (el.checked) exportSelection.add(el.dataset.exportPath); else exportSelection.delete(el.dataset.exportPath); preparedRequest = null; render();}});
root.addEventListener('submit', async event => {
  const form = event.target as HTMLFormElement;
  if (form.id === 'drive-config-form') {
    event.preventDefault(); try {await drive.configure(String(new FormData(form).get('clientId') ?? ''));} catch (error) {toast(String(error));} return;
  }
  if (form.id === 'source-form') {
    event.preventDefault(); const file=currentFile(), item=currentItem(); if(!file || !item) return;
    try {updateManualSources(file,item,new Map([...new FormData(form)].map(([id,text])=>[id,String(text)]))); persist(file.path); closeSheet();} catch(error){toast(String(error));} return;
  }
  if (form.id === 'comment-form') {
    event.preventDefault(); const item = currentItem(), file = currentFile(); if (!item || !file) return;
    const text = new FormData(form).get('text') as string;
    try {if (editTarget) editComment(item, editTarget.threadId, editTarget.postId, text); else addComment(item, text, replyTarget ?? undefined); replyTarget = null; editTarget = null; commentDraft=''; persist(file.path); reconcileCurrent(); render();} catch (error) {toast(String(error));}
    return;
  }
  if (form.id === 'restore-form') {
    event.preventDefault(); const file = new FormData(form).get('backup') as File;
    try {const restored = restoreJson(await file.text()); ask('現在の作業状態をバックアップで置き換えますか？', async () => {await saveWorkspace(restored); workspace = restored; workspaceRevision++; path = currentId = null; sheet = null; expanded.clear(); render(); toast('バックアップを復元しました');});} catch (error) {toast(String(error));} return;
  }
  if (form.id === 'response-form') {
    event.preventDefault(); const data = new FormData(form), answer = data.get('answer') as File, revised = data.get('revised') as File;
    busy = '修正データを確認中…'; render();
    try {
      const answerValue = JSON.parse(await answer.text());
      const initialReview = workspace.requests.some(r => r.requestId === answerValue?.requestId && r.mode === 'initial');
      if (initialReview && revised?.size) throw new Error('初回レビューでは指摘JSONだけを指定してください');
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
      workspace = importResponse(workspace, answerValue, parsed);
      workspaceRevision++;
      workspace.diagnostics.push(...diagnostics);
      workspace.diagnosticDocuments=documents;
      await saveWorkspace(workspace); sheet = null; reconcileCurrent(); busy = ''; render(); toast(initialReview ? `AIの指摘を${answerValue.suggestions.length}件読み込みました` : '変更を読み込みました。再確認してください');
    } catch (error) {busy = ''; render(); toast(String(error));} return;
  }
  if (form.id !== 'load-form') return;
  event.preventDefault();
  const data = new FormData(form), ja = data.get('ja') as File, en = data.get('en') as File;
  if (!en?.size || !ja?.size && !workspace.files.length) return;
  const englishOnly = !ja?.size;
  busy = '読み込み中…'; sheet = null; render();
  try {
    const original = englishOnly ? sourceZip(workspace).buffer as ArrayBuffer : await ja.arrayBuffer();
    const result = await parseArchives(original, await en.arrayBuffer(), updateBusy, englishOnly);
    diagnosticTab = 'error';
    const documents=replaceDiagnosticDocuments(workspace.diagnosticDocuments,result.diagnosticDocuments,[...result.files.map(f=>f.path),...result.diagnostics.map(d=>d.path)]);
    if (!result.files.length) {workspace.diagnostics = result.diagnostics;workspace.diagnosticDocuments=documents;await saveWorkspace(workspace);sheet = 'diagnostics'; busy = ''; render(); return;}
    if (workspace.files.length) {
      const attempted = [...result.files.map(f => f.path), ...result.diagnostics.map(d => d.path)];
      workspace = mergeFiles({...workspace, diagnostics: withoutReplacedDiagnostics(workspace.diagnostics, attempted)}, result.files);
      workspace.diagnostics.push(...result.diagnostics);
    } else workspace = {...emptyWorkspace(), ...result};
    workspace.diagnosticDocuments=documents;
    workspaceRevision++;
    if (englishOnly) reconcileCurrent(); else path = currentId = null;
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
      if (!preparedRequest) {preparedRequest = createRequest(workspace, [...exportSelection], reviewMode); workspace.requests.push(preparedRequest);}
      if (action === 'export-request') download(reviewFileNames(preparedRequest).request, JSON.stringify(preparedRequest, null, 2));
      else {await navigator.clipboard.writeText(chatInstructions(preparedRequest));}
    }
    await saveWorkspace(workspace);
    busy = ''; render(); if (action === 'copy-instructions' && preparedRequest) toast('指示文をコピーしました', chatInstructions(preparedRequest));
  } catch (error) {busy = ''; render(); if (action === 'copy-instructions' && preparedRequest) toast('コピーできませんでした。指示文を確認してコピーしてください', chatInstructions(preparedRequest)); else toast(String(error));}
}
document.addEventListener('keydown', event => {
  const input = (event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]');
  if (event.key === 'Escape') {if(contextMenu) {contextMenu=null;render();return;}if (instructionsPreview !== null) {closeInstructions(); return;} if (confirmation) {confirmation = null; render();} else if (sheet) closeSheet(); else {menu = false; render();} return;}
  if (event.key === 'Tab' && (sheet || confirmation || instructionsPreview !== null)) {
    const container = instructionsPreview !== null ? root.querySelector('.instructions-dialog')! : confirmation ? root.querySelector('.dialog')! : root.querySelector('.sheet')!;
    const focusable = [...container.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input, textarea, select, [tabindex="0"]')];
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {event.preventDefault(); last?.focus();}
    else if (!event.shiftKey && document.activeElement === last) {event.preventDefault(); first?.focus();}
  }
  if (!input && !sheet && !confirmation && !contextMenu && !menu && path && !busy && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1);}
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
screenHistory=new ScreenHistory(historyScreen(),restoreScreen);
installViewport(root,()=>{positionContextMenu(root);updateCommentScroll(root);});
busy = '保存したデータを読み込み中…'; render();
void Promise.all([loadWorkspace(), drive.initialize(),loadPreferences()]).then(([saved,,settings]) => {if (saved) workspace = saved;preferences=settings;before=after=settings.contextRadius;reviewMode=settings.reviewMode??reviewMode;}).catch(error => {notice = `保存データを読み込めません：${String(error)}`;}).finally(() => {busy = ''; render();});
registerPwa(toast);
