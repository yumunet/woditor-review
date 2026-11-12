import type { Decision, Item, ReviewFile, ReviewRequest, ReviewMode, Workspace } from './model';
import { sourceText, unresolved } from './model';
import { now, uid } from './review-state';
import { initialContext } from './ui';
import { zipSync, strToU8 } from 'fflate';
import { preserveGroups } from './grouping';
import { createInitialRequest, initialInstructions, importInitialResponse } from './initial-review';
import { propose, applyRevisedFiles } from './review-proposals';

const pendingForThread = (item: Item, threadId: string) =>
  item.changes
    .filter((c) => c.threadId === threadId && c.status === 'pending')
    .map(({ id, slotId, before, after }) => ({ id, slotId, before, after }));

export function createRequest(
  workspace: Workspace,
  selected: string[],
  mode: ReviewMode = 'comments',
): ReviewRequest {
  if (mode === 'initial') return createInitialRequest(workspace, selected);
  const request: ReviewRequest = {
    schemaVersion: 1,
    requestId: uid(),
    createdAt: now(),
    entries: [],
  };
  for (const file of workspace.files.filter((f) => selected.includes(f.path)))
    for (const item of file.items) {
      const slots = item.slotIds.map((id) => file.slots.find((s) => s.id === id)!);
      const line = slots[0].command ? slots[0].line : file.usages[slots[0].id]?.[0];
      for (const thread of unresolved(item))
        request.entries.push({
          path: file.path,
          fileVersion: file.version,
          itemId: item.id,
          slotIds: [...item.slotIds],
          commentId: thread.id,
          slots: slots.map((s) => ({
            id: s.id,
            source: sourceText(s),
            translation: s.translation,
            line: s.enLine ?? s.line,
            key: s.key,
            kind: s.kind,
            position: s.position,
          })),
          posts: structuredClone(thread.posts),
          pendingChanges: pendingForThread(item, thread.id),
          context: line === undefined ? [] : initialContext(file, line, 3, 3),
        });
    }
  if (!request.entries.length) throw new Error('選択したファイルに未解決コメントがありません');
  return request;
}

export const reviewFileNames = (request: Pick<ReviewRequest, 'requestId'>) => {
  const id = request.requestId.replace(/-/g, '').slice(0, 12);
  return {
    request: `review_request_${id}.json`,
    response: `review_response_${id}.json`,
    english: `en-US_${id}.zip`,
  };
};

export const chatInstructions = (request: ReviewRequest) =>
  request.mode === 'initial'
    ? initialInstructions(request, reviewFileNames(request).response)
    : `添付の依頼JSON（requestId: ${request.requestId}）と英訳TXTを、コメント履歴・pendingChanges（未確定の前回案）を踏まえてレビューしてください。
全commentIdに1件ずつ、accepted（採用）/ rejected（不採用）/ partial（一部採用）/ needs_review（要確認）と理由を回答。不確実な点は推測せず needs_review。
提供の woditor_review_tool.py の build → validate → apply を使い、${reviewFileNames(request).response} と修正済み英訳ZIPを出力してください。
build用の判断JSON: {"responses":[{"commentId":"依頼のID","decision":"accepted","reason":"理由","changes":[{"slotId":"対象ID","before":"slots.translation","after":"最終案"}]}],"suggestions":[]}。
changesはSlotごと・全回答で重複なし。保留案を維持・修正する場合も最終案を記載し、撤回は rejected と changes: []。変更なしも changes: []。追加案は suggestions に {id,path,itemId,fileVersion,reason,changes}。
依頼のID・相対パス・バージョン、TXTのコマンド構造・メタデータキー・CSVの行列構造と数値・COMMAND_TEXT・BOM・改行形式・特殊文字列・名前指定フィールドを保持。改行・引用符表記とルビは特殊文字列の保護対象外。引用符付きCSV設定値には実際の改行を使えます（引用符はツールが処理）。データ名は1行のまま編集。AI判断はユーザー承認と区別してください。`;

interface Edit {
  slotId: string;
  before: string;
  after: string;
}
interface Answer {
  commentId: string;
  path: string;
  itemId: string;
  fileVersion: string;
  decision: Decision;
  reason: string;
  explanation?: string;
  changes: Edit[];
}
interface Suggestion {
  id: string;
  path: string;
  itemId: string;
  fileVersion: string;
  reason: string;
  changes: Edit[];
}
export interface ReviewResponse {
  schemaVersion: 1;
  requestId: string;
  responses: Answer[];
  suggestions: Suggestion[];
}
export function validateResponse(value: unknown): asserts value is ReviewResponse {
  const fail = () => {
    throw new Error('回答JSONのスキーマが不正です');
  };
  const obj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: any) => typeof v === 'string' && v.length > 0;
  const keys = (v: any, allowed: string[]) => Object.keys(v).every((k) => allowed.includes(k));
  const edits = (v: any) =>
    Array.isArray(v) &&
    v.every(
      (e) =>
        obj(e) &&
        keys(e, ['slotId', 'before', 'after']) &&
        text(e.slotId) &&
        typeof e.before === 'string' &&
        typeof e.after === 'string' &&
        !e.after.includes('\0'),
    );
  const v = value as any;
  if (
    !obj(v) ||
    !keys(v, ['schemaVersion', 'requestId', 'responses', 'suggestions']) ||
    v.schemaVersion !== 1 ||
    !text(v.requestId) ||
    !Array.isArray(v.responses) ||
    !Array.isArray(v.suggestions)
  )
    return fail();
  for (const a of v.responses)
    if (
      !obj(a) ||
      !keys(a, [
        'commentId',
        'path',
        'itemId',
        'fileVersion',
        'decision',
        'reason',
        'explanation',
        'changes',
      ]) ||
      !text(a.commentId) ||
      !text(a.path) ||
      !text(a.itemId) ||
      !/^[a-f0-9]{64}$/.test(a.fileVersion) ||
      !['accepted', 'rejected', 'partial', 'needs_review'].includes(a.decision) ||
      !text(a.reason) ||
      (a.explanation !== undefined && typeof a.explanation !== 'string') ||
      !edits(a.changes)
    )
      return fail();
  for (const a of v.suggestions)
    if (
      !obj(a) ||
      !keys(a, ['id', 'path', 'itemId', 'fileVersion', 'reason', 'changes']) ||
      !text(a.id) ||
      !text(a.path) ||
      !text(a.itemId) ||
      !/^[a-f0-9]{64}$/.test(a.fileVersion) ||
      !text(a.reason) ||
      !edits(a.changes)
    )
      return fail();
}

export function importResponse(
  workspace: Workspace,
  value: unknown,
  revised?: ReviewFile[],
): Workspace {
  validateResponse(value);
  const request = workspace.requests.find((r) => r.requestId === value.requestId);
  if (!request) throw new Error('対応するレビュー依頼がありません');
  if (workspace.importedResponses.includes(value.requestId))
    throw new Error('この回答は既に取り込み済みです');
  if (request.mode === 'initial') return importInitialResponse(workspace, request, value, revised);
  const seen = new Set<string>();
  if (value.responses.length !== request.entries.length)
    throw new Error('回答IDの欠落・件数不一致があります');
  const next = structuredClone(workspace);
  const touched = new Set<string>();
  const apply = (a: Answer | Suggestion, threadId: string, postId: string, source: string) => {
    const file = next.files.find((f) => f.path === a.path),
      item = file?.items.find((i) => i.id === a.itemId);
    if (!file || !item || file.version !== a.fileVersion)
      throw new Error(`ファイル・項目ID・バージョンが一致しません: ${a.path}`);
    touched.add(a.path);
    for (const edit of a.changes) {
      const key = a.path + '\0' + edit.slotId;
      if (seen.has('slot:' + key))
        throw new Error(`翻訳単位の変更が重複しています: ${edit.slotId}`);
      seen.add('slot:' + key);
      propose(file, item, edit, threadId, 'ai', postId);
    }
    return { file, item };
  };
  for (const a of value.responses) {
    if (seen.has(a.commentId)) throw new Error('回答コメントIDが重複しています');
    seen.add(a.commentId);
    const entry = request.entries.find((e) => e.commentId === a.commentId);
    if (
      !entry ||
      entry.path !== a.path ||
      entry.itemId !== a.itemId ||
      entry.fileVersion !== a.fileVersion
    )
      throw new Error('依頼と回答のIDが一致しません');
    if (a.changes.some((c) => !entry.slotIds.includes(c.slotId)))
      throw new Error('依頼対象外の翻訳単位です');
    const file = next.files.find((f) => f.path === a.path),
      item = file?.items.find((i) => i.id === a.itemId);
    const thread = item?.threads.find((t) => t.id === a.commentId);
    if (!thread || thread.resolved || JSON.stringify(thread.posts) !== JSON.stringify(entry.posts))
      throw new Error('依頼後にコメントが変更・解決されています');
    if (
      entry.pendingChanges &&
      JSON.stringify(pendingForThread(item!, a.commentId)) !== JSON.stringify(entry.pendingChanges)
    )
      throw new Error('依頼後に保留中の変更が変更・破棄されています');
    const postId = uid();
    for (const change of item!.changes.filter(
      (c) => c.threadId === a.commentId && c.status === 'pending',
    )) {
      if (a.changes.some((edit) => edit.slotId === change.slotId)) change.status = 'discarded';
      else if (a.decision === 'rejected') change.rejectedBy = postId;
    }
    apply(a, a.commentId, postId, 'response');
    thread.posts.push({
      id: postId,
      author: 'ai',
      text: a.reason + (a.explanation ? '\n' + a.explanation : ''),
      createdAt: now(),
      decision: a.decision,
      requestId: value.requestId,
    });
    item!.approved = false;
  }
  for (const a of value.suggestions) {
    if (
      !request.entries.some(
        (e) => e.path === a.path && e.itemId === a.itemId && e.fileVersion === a.fileVersion,
      )
    )
      throw new Error('改善提案の項目・バージョンは依頼に含まれていません');
    if (
      seen.has('suggestion:' + a.id) ||
      next.files.some((f) => f.items.some((i) => i.threads.some((t) => t.id === a.id)))
    )
      throw new Error('改善提案IDが重複しています');
    seen.add('suggestion:' + a.id);
    const postId = uid(),
      { item } = apply(a, a.id, postId, 'suggestion');
    item.threads.push({
      id: a.id,
      resolved: false,
      posts: [
        {
          id: postId,
          author: 'ai',
          text: a.reason,
          createdAt: now(),
          decision: 'needs_review',
          requestId: value.requestId,
        },
      ],
    });
    item.approved = false;
  }
  if (revised) applyRevisedFiles(next, value, revised, touched);
  next.importedResponses.push(value.requestId);
  next.updatedAt = now();
  return next;
}

export function sourceZip(workspace: Workspace) {
  return zipSync(
    Object.fromEntries(
      workspace.files.map((f) => [
        `ja-JP/texts/${f.path}`,
        strToU8((f.jaBom ? '\uFEFF' : '') + f.jaText),
      ]),
    ),
  );
}

export interface FileImportOptions {
  resetChangedApproval?: boolean;
}
export interface FileImportSummary {
  overwrittenFiles: number;
  changedItems: number;
  discardedPending: number;
}
export function prepareFileImport(
  workspace: Workspace,
  incoming: ReviewFile[],
  options: FileImportOptions = {},
) {
  const next = structuredClone(workspace);
  const summary: FileImportSummary = { overwrittenFiles: 0, changedItems: 0, discardedPending: 0 },
    changedItems: Item[] = [];
  for (const candidate of incoming) {
    const old = next.files.find((f) => f.path === candidate.path);
    if (!old) {
      const file = structuredClone(candidate);
      for (const item of file.items) item.approved = false;
      next.files.push(file);
      continue;
    }
    try {
      const file = structuredClone(candidate),
        map = new Map<string, string>();
      const changed: Item[] = [];
      let discarded = 0;
      const sameSource = file.sourceVersion === old.sourceVersion;
      for (const slot of file.slots) {
        const options = old.slots.filter((s) =>
          slot.kind === 'database_csv' && sameSource && !slot.sourceMissing
            ? s.kind === 'database_csv' &&
              !s.sourceMissing &&
              s.start === slot.start &&
              s.end === slot.end &&
              s.source === slot.source
            : s.fingerprint === slot.fingerprint &&
              (slot.sourceMissing
                ? old.version === file.version
                  ? s.id === slot.id
                  : s.translation === slot.translation
                : !sameSource || s.id === slot.id),
        );
        if (options.length === 1) map.set(slot.id, options[0].id);
      }
      if (new Set(map.values()).size !== map.size)
        throw new Error('既存レビューを一意に対応付けできません');
      if (
        old.slots.some((s) => s.sourceOverride !== undefined && ![...map.values()].includes(s.id))
      )
        throw new Error('補完した原文を一意に対応付けできません');
      preserveGroups(file, old, map);
      const matched = new Set<string>();
      for (const item of file.items) {
        const oldIds = item.slotIds.map((id) => map.get(id));
        const previous = old.items.filter(
          (i) =>
            i.slotIds.length === oldIds.length &&
            i.slotIds.every((id, index) => id === oldIds[index]),
        );
        if (previous.length !== 1) continue;
        const prior = previous[0];
        matched.add(prior.id);
        for (const id of item.slotIds) {
          const target = file.slots.find((s) => s.id === id)!,
            source = old.slots.find((s) => s.id === map.get(id))!;
          if (source.sourceOverride !== undefined) target.sourceOverride = source.sourceOverride;
        }
      }
      if (
        old.items.some(
          (i) => (i.approved || i.threads.length || i.changes.length) && !matched.has(i.id),
        )
      )
        throw new Error('原文・構造が変わり、既存レビューを一意に対応付けできません');
      const rename = new Map<string, string>();
      for (const slot of file.slots) rename.set(slot.id, map.get(slot.id) ?? 'N:' + uid());
      for (const item of file.items) {
        const prior = old.items.find(
          (i) =>
            i.slotIds.length === item.slotIds.length &&
            i.slotIds.every((id, index) => id === map.get(item.slotIds[index])),
        );
        const newValues = item.slotIds.map((id) => file.slots.find((s) => s.id === id)!);
        if (prior) {
          const edits = newValues.map((s) => ({
            slotId: rename.get(s.id)!,
            before: old.slots.find((oldSlot) => oldSlot.id === rename.get(s.id))!.translation,
            after: s.translation,
          }));
          const { id, approved, threads, changes, slotIds } = structuredClone(prior);
          Object.assign(item, {
            id,
            approved,
            threads,
            changes,
            slotIds,
            title: newValues[0]?.kind === 'database_csv' ? item.title : prior.title,
          });
          item.lastLine = newValues.at(-1)!.line;
          const changedSlots = new Set(
            edits.filter((edit) => edit.before !== edit.after).map((edit) => edit.slotId),
          );
          for (const change of item.changes) {
            if (
              change.status === 'pending' &&
              (change.origin === 'reload' || changedSlots.has(change.slotId))
            ) {
              change.status = 'discarded';
              discarded++;
            }
          }
          for (const edit of edits) {
            if (edit.before !== edit.after)
              item.changes.push({
                id: uid(),
                ...edit,
                origin: 'reload',
                threadId: null,
                status: 'committed',
                createdAt: now(),
              });
          }
          if (changedSlots.size) {
            changed.push(item);
            if (options.resetChangedApproval) item.approved = false;
          }
        } else {
          item.slotIds = item.slotIds.map((id) => rename.get(id)!);
          item.id = 'N:' + uid();
          item.approved = false;
        }
      }
      for (const slot of file.slots) slot.id = rename.get(slot.id)!;
      file.usages = Object.fromEntries(
        Object.entries(file.usages).map(([id, hits]) => [rename.get(id)!, hits]),
      );
      if (old.manualGroups)
        file.manualGroups = file.items.filter((i) => i.code === 103).map((i) => [...i.slotIds]);
      next.files[next.files.indexOf(old)] = file;
      summary.overwrittenFiles++;
      summary.changedItems += changed.length;
      summary.discardedPending += discarded;
      changedItems.push(...changed);
    } catch (error) {
      next.diagnostics.push({
        path: candidate.path,
        severity: 'error',
        message: `再読み込みを適用しませんでした: ${String(error)}`,
      });
    }
  }
  next.updatedAt = now();
  return { workspace: next, summary, changedItems };
}

export function mergeFiles(
  workspace: Workspace,
  incoming: ReviewFile[],
  options: FileImportOptions = {},
): Workspace {
  return prepareFileImport(workspace, incoming, options).workspace;
}
