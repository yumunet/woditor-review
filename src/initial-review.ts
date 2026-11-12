import {sourceText, itemTitle, type ReviewRequest, type Workspace,type ReviewFile} from './model';
import {now, uid} from './review-state';
import {initialContext} from './ui';
import type {ReviewResponse} from './exchange';
import {propose,applyRevisedFiles} from './review-proposals';

export function createInitialRequest(workspace: Workspace, selected: string[]): ReviewRequest {
  const targets = workspace.files.filter(f => selected.includes(f.path)).flatMap(file => file.items.map(item => {
    const slots = item.slotIds.map(id => file.slots.find(s => s.id === id)!);
    const line = slots[0].command ? slots[0].line : file.usages[slots[0].id]?.[0];
    return {path: file.path, fileVersion: file.version, sourceVersion: file.sourceVersion, itemId: item.id, title: itemTitle(file,item), slotIds: [...item.slotIds],
      slots: slots.map(s => ({id: s.id, source: sourceText(s), translation: s.translation, line: s.enLine ?? s.line, key: s.key, kind: s.kind, position: s.position})),
      context: line === undefined ? [] : initialContext(file, line, 3, 3), threads: structuredClone(item.threads),
      pendingChanges: item.changes.filter(c => c.status === 'pending').map(({id,slotId,before,after}) => ({id,slotId,before,after}))};
  }));
  if (!targets.length) throw new Error('選択したファイルにレビュー対象の項目がありません');
  return {schemaVersion: 1, requestId: uid(), createdAt: now(), mode: 'initial', entries: [], targets};
}

export function initialInstructions(request: ReviewRequest, responseName: string) {
  return `添付の依頼JSON（requestId: ${request.requestId}）のtargetsと英訳TXTを使い、原文と既存の英訳を比較してください。
誤訳・訳抜け・不自然な英語・用語の不統一を探し、問題のある項目だけに日本語で指摘コメントを作成してください。既存のthreadsと重複する指摘は避け、不確実な点は断定しないでください。原文が空なら誤訳と断定せず、英語として判断できる問題だけ指摘してください。
reasonには日本語の問題点・修正理由だけを書き、修正後の英訳はchanges.afterに分けてください。不確実で修正案を作れない指摘はchanges: []。pendingChangesがあるSlotは変更せず、採用・承認はユーザーに任せてください。
判断JSON: {"responses":[],"suggestions":[{"path":"対象のpath","itemId":"対象のitemId","reason":"指摘・修正理由","changes":[{"slotId":"対象ID","before":"slots.translation","after":"修正後の英訳"}]}]}。問題がなければsuggestions: []。同じSlotの修正は1件にまとめてください。
提供の woditor_review_tool.py の build → validate で ${responseName} を作成し、修正案があれば apply で別フォルダに修正済み英訳TXTを出力してZIPも返してください。ID・相対パス・バージョン、コマンド構造・CSVの行列と数値・特殊文字列を保持してください。コマンドの改行と引用符は<\\n>・<dqrt>を使い、引用符付きCSV設定値には実際の改行を使えます。`;
}

export function importInitialResponse(workspace: Workspace, request: ReviewRequest, response: ReviewResponse, revised?:ReviewFile[]): Workspace {
  if (response.responses.length) throw new Error('初回レビューの修正案はsuggestionsに指定してください');
  if (!request.targets?.length || request.entries.length) throw new Error('初回レビュー依頼の形式が不正です');
  for (const target of request.targets) {
    const file = workspace.files.find(f => f.path === target.path), item = file?.items.find(i => i.id === target.itemId);
    if (!file || !item || file.version !== target.fileVersion || file.sourceVersion !== target.sourceVersion || JSON.stringify(item.slotIds) !== JSON.stringify(target.slotIds)) throw new Error(`依頼後に原文・英訳・項目構成が変わっています: ${target.path}`);
    for (const expected of target.slots) {
      const slot = file.slots.find(s => s.id === expected.id);
      if (!slot || sourceText(slot) !== expected.source || slot.translation !== expected.translation) throw new Error(`依頼後に原文・英訳が変わっています: ${target.path}`);
    }
  }
  const next = structuredClone(workspace), seen = new Set(next.files.flatMap(f => f.items.flatMap(i => i.threads.map(t => t.id)))),changed=new Set<string>(),touched=new Set<string>();
  for (const suggestion of response.suggestions) {
    const target=request.targets.find(t=>t.path===suggestion.path && t.itemId===suggestion.itemId && t.fileVersion===suggestion.fileVersion);
    if (!target) throw new Error('初回レビューの指摘先が依頼対象にありません');
    if (seen.has(suggestion.id)) throw new Error('指摘コメントIDが重複しています'); seen.add(suggestion.id);
    const file=next.files.find(f=>f.path===suggestion.path)!,item=file.items.find(i=>i.id===suggestion.itemId)!,postId=uid();
    for(const edit of suggestion.changes) {
      const key=suggestion.path+'\0'+edit.slotId,expected=target.slots.find(slot=>slot.id===edit.slotId);
      if(changed.has(key) || !target.slotIds.includes(edit.slotId) || !expected || expected.translation!==edit.before) throw new Error('初回レビューの修正案が重複・対象外、または変更前の英訳が一致しません');
      if(item.changes.some(c=>c.slotId===edit.slotId && c.status==='pending')) throw new Error('既に保留中の変更があります');
      changed.add(key);propose(file,item,edit,suggestion.id,'ai',postId);
    }
    item.threads.push({id: suggestion.id, resolved: false, posts: [{id: postId, author: 'ai', text: suggestion.reason, createdAt: now(), decision: 'needs_review', requestId: request.requestId}]});
    touched.add(file.path);
    item.approved = false;
  }
  if(revised) applyRevisedFiles(next,response,revised,touched,true);
  next.importedResponses.push(request.requestId); next.updatedAt = now(); return next;
}
