import {sourceText, itemTitle, type ReviewRequest, type Workspace} from './model';
import {now, uid} from './review-state';
import {initialContext} from './ui';
import type {ReviewResponse} from './exchange';

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
英訳は変更せず、採用・承認も行いません。pendingChangesは未確定の参考情報です。指摘には問題点・理由・必要なら改善例を記載してください。
判断JSON: {"responses":[],"suggestions":[{"path":"対象のpath","itemId":"対象のitemId","reason":"指摘コメント"}]}。問題がなければsuggestions: []。
提供の woditor_review_tool.py の build → validate で ${responseName} を作成してください。ID・相対パス・バージョンを保持し、修正済みTXTやZIPは作らないでください。`;
}

export function importInitialResponse(workspace: Workspace, request: ReviewRequest, response: ReviewResponse, revisedProvided: boolean): Workspace {
  if (response.responses.length || response.suggestions.some(s => s.changes.length) || revisedProvided) throw new Error('初回レビューは指摘コメントだけを取り込みます。英訳の変更・修正ZIPは指定できません');
  if (!request.targets?.length || request.entries.length) throw new Error('初回レビュー依頼の形式が不正です');
  for (const target of request.targets) {
    const file = workspace.files.find(f => f.path === target.path), item = file?.items.find(i => i.id === target.itemId);
    if (!file || !item || file.version !== target.fileVersion || file.sourceVersion !== target.sourceVersion || JSON.stringify(item.slotIds) !== JSON.stringify(target.slotIds)) throw new Error(`依頼後に原文・英訳・項目構成が変わっています: ${target.path}`);
    for (const expected of target.slots) {
      const slot = file.slots.find(s => s.id === expected.id);
      if (!slot || sourceText(slot) !== expected.source || slot.translation !== expected.translation) throw new Error(`依頼後に原文・英訳が変わっています: ${target.path}`);
    }
  }
  const next = structuredClone(workspace), seen = new Set(next.files.flatMap(f => f.items.flatMap(i => i.threads.map(t => t.id))));
  for (const suggestion of response.suggestions) {
    if (!request.targets.some(t => t.path === suggestion.path && t.itemId === suggestion.itemId && t.fileVersion === suggestion.fileVersion)) throw new Error('初回レビューの指摘先が依頼対象にありません');
    if (seen.has(suggestion.id)) throw new Error('指摘コメントIDが重複しています'); seen.add(suggestion.id);
    const item = next.files.find(f => f.path === suggestion.path)!.items.find(i => i.id === suggestion.itemId)!;
    item.threads.push({id: suggestion.id, resolved: false, posts: [{id: uid(), author: 'ai', text: suggestion.reason, createdAt: now(), decision: 'needs_review', requestId: request.requestId}]});
    item.approved = false;
  }
  next.importedResponses.push(request.requestId); next.updatedAt = now(); return next;
}
