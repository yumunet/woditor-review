import type { Change, Decision, Item, ReviewFile, ReviewRequest, Workspace } from './model';
import { unresolved } from './model';
import { now, uid } from './review-state';
import { initialContext } from './ui';
import { zipSync, strToU8 } from 'fflate';
import { preserveGroups } from './grouping';

export function createRequest(workspace: Workspace, selected: string[]): ReviewRequest {
  const request: ReviewRequest = {schemaVersion: 1, requestId: uid(), createdAt: now(), entries: []};
  for (const file of workspace.files.filter(f => selected.includes(f.path))) for (const item of file.items) {
    const slots = item.slotIds.map(id => file.slots.find(s => s.id === id)!);
    const line = slots[0].command ? slots[0].line : file.usages[slots[0].id]?.[0];
    for (const thread of unresolved(item)) request.entries.push({path: file.path, fileVersion: file.version,
      itemId: item.id, slotIds: [...item.slotIds], commentId: thread.id,
      slots: slots.map(s => ({id: s.id, source: s.source, translation: s.translation, line: s.line, key: s.key, kind: s.kind, position: s.position})),
      posts: structuredClone(thread.posts), context: line === undefined ? [] : initialContext(file, line, 3, 3)});
  }
  if (!request.entries.length) throw new Error('選択したファイルに未解決コメントがありません');
  return request;
}

export const chatInstructions = (request: ReviewRequest) => `添付のWoditor Review依頼JSON（schemaVersion: 1 / requestId: ${request.requestId}）と英訳TXTをレビューしてください。
各指摘への判断 accepted（採用）/ rejected（不採用）/ partial（一部採用）/ needs_review（要確認）、理由、必要な修正を作成してください。
完成した英訳TXT一式と review_response.json の両方を出力してください。JSONの組み立てと検証は python/woditor_review_tool.py を使用してください。
回答形式: {"schemaVersion":1,"requestId":"${request.requestId}","responses":[{"commentId":"依頼のcommentId","path":"依頼のpath","itemId":"依頼のitemId","fileVersion":"依頼のfileVersion","decision":"accepted","reason":"判断理由","changes":[{"slotId":"対象Slot ID","before":"現在の英訳","after":"新訳"}]}],"suggestions":[]}。
responses は依頼の全commentIdに1件ずつ回答し、ID・相対パス・バージョンを変更しないでください。変更しない場合は changes: [] としてください。
新規改善案は suggestions に {id,path,itemId,fileVersion,reason,changes} として記載してください。
1つのSlotへの重複した変更は避け、変更は担当する1つの指摘に集約してください。グループ化されたコメントもSlotごとに変更を指定してください。
コマンド構造・メタデータのキー・CSV・表示用COMMAND_TEXTセクション・BOM・改行形式・制御文字・置換文字列を保持してください。名前指定フィールドは変更しないでください。
不確実な対応付けや翻訳は推測せず needs_review としてください。AI判断はユーザー承認ではありません。`;

interface Edit {slotId: string; before: string; after: string}
interface Answer {commentId: string; path: string; itemId: string; fileVersion: string; decision: Decision; reason: string; explanation?: string; changes: Edit[]}
interface Suggestion {id: string; path: string; itemId: string; fileVersion: string; reason: string; changes: Edit[]}
export interface ReviewResponse {schemaVersion: 1; requestId: string; responses: Answer[]; suggestions: Suggestion[]}
export function validateResponse(value: unknown): asserts value is ReviewResponse {
  const fail = () => {throw new Error('回答JSONのスキーマが不正です');};
  const obj = (v: any) => !!v && typeof v === 'object' && !Array.isArray(v);
  const text = (v: any) => typeof v === 'string' && v.length > 0;
  const keys = (v: any, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
  const edits = (v: any) => Array.isArray(v) && v.every(e => obj(e) && keys(e, ['slotId','before','after']) && text(e.slotId) && typeof e.before === 'string' && typeof e.after === 'string' && !e.after.includes('\0') && !/[\r\n]/.test(e.after));
  const v = value as any;
  if (!obj(v) || !keys(v, ['schemaVersion','requestId','responses','suggestions']) || v.schemaVersion !== 1 || !text(v.requestId) || !Array.isArray(v.responses) || !Array.isArray(v.suggestions)) return fail();
  for (const a of v.responses) if (!obj(a) || !keys(a, ['commentId','path','itemId','fileVersion','decision','reason','explanation','changes']) || !text(a.commentId) || !text(a.path) || !text(a.itemId) || !/^[a-f0-9]{64}$/.test(a.fileVersion) || !['accepted','rejected','partial','needs_review'].includes(a.decision) || !text(a.reason) || a.explanation !== undefined && typeof a.explanation !== 'string' || !edits(a.changes)) return fail();
  for (const a of v.suggestions) if (!obj(a) || !keys(a, ['id','path','itemId','fileVersion','reason','changes']) || !text(a.id) || !text(a.path) || !text(a.itemId) || !/^[a-f0-9]{64}$/.test(a.fileVersion) || !text(a.reason) || !edits(a.changes)) return fail();
}

function propose(file: ReviewFile, item: Item, edit: Edit, threadId: string | null, origin: 'ai' | 'reload', aiPostId?: string) {
  const slot = file.slots.find(s => s.id === edit.slotId);
  if (!slot || !item.slotIds.includes(edit.slotId) || slot.translation !== edit.before) throw new Error(`翻訳単位・変更前の英訳が一致しません: ${edit.slotId}`);
  if (edit.before === edit.after) return;
  if (item.changes.some(c => c.slotId === edit.slotId && c.status === 'pending')) throw new Error(`既に保留中の変更があります: ${edit.slotId}`);
  if (slot.kind === 'command_string' && /(?<!\\)"/.test(edit.after)) throw new Error('コマンド内の引用符は <dqrt> を使用してください');
  const change: Change = {id: uid(), ...edit, threadId, origin, aiPostId, status: 'pending', createdAt: now()};
  item.changes.push(change); item.approved = false;
}

export function importResponse(workspace: Workspace, value: unknown, revised?: ReviewFile[]): Workspace {
  validateResponse(value);
  const request = workspace.requests.find(r => r.requestId === value.requestId);
  if (!request) throw new Error('対応するレビュー依頼がありません');
  if (workspace.importedResponses.includes(value.requestId)) throw new Error('この回答は既に取り込み済みです');
  const seen = new Set<string>();
  if (value.responses.length !== request.entries.length) throw new Error('回答IDの欠落・件数不一致があります');
  const next = structuredClone(workspace);
  const touched = new Set<string>();
  const apply = (a: Answer | Suggestion, threadId: string, postId: string, source: string) => {
    const file = next.files.find(f => f.path === a.path), item = file?.items.find(i => i.id === a.itemId);
    if (!file || !item || file.version !== a.fileVersion) throw new Error(`ファイル・項目ID・バージョンが一致しません: ${a.path}`);
    touched.add(a.path);
    for (const edit of a.changes) {
      const key = a.path + '\0' + edit.slotId;
      if (seen.has('slot:' + key)) throw new Error(`翻訳単位の変更が重複しています: ${edit.slotId}`);
      seen.add('slot:' + key);
      propose(file, item, edit, threadId, 'ai', postId);
    }
    return {file, item};
  };
  for (const a of value.responses) {
    if (seen.has(a.commentId)) throw new Error('回答コメントIDが重複しています');
    seen.add(a.commentId);
    const entry = request.entries.find(e => e.commentId === a.commentId);
    if (!entry || entry.path !== a.path || entry.itemId !== a.itemId || entry.fileVersion !== a.fileVersion) throw new Error('依頼と回答のIDが一致しません');
    if (a.changes.some(c => !entry.slotIds.includes(c.slotId))) throw new Error('依頼対象外の翻訳単位です');
    const postId = uid(), {item} = apply(a, a.commentId, postId, 'response');
    const thread = item.threads.find(t => t.id === a.commentId);
    if (!thread || thread.resolved || JSON.stringify(thread.posts) !== JSON.stringify(entry.posts)) throw new Error('依頼後にコメントが変更・解決されています');
    thread.posts.push({id: postId, author: 'ai', text: a.reason + (a.explanation ? '\n' + a.explanation : ''), createdAt: now(), decision: a.decision, requestId: value.requestId});
    item.approved = false;
  }
  for (const a of value.suggestions) {
    if (!request.entries.some(e => e.path === a.path && e.itemId === a.itemId && e.fileVersion === a.fileVersion)) throw new Error('改善提案の項目・バージョンは依頼に含まれていません');
    if (seen.has('suggestion:' + a.id) || next.files.some(f => f.items.some(i => i.threads.some(t => t.id === a.id)))) throw new Error('改善提案IDが重複しています');
    seen.add('suggestion:' + a.id);
    const postId = uid(), {item} = apply(a, a.id, postId, 'suggestion');
    item.threads.push({id: a.id, resolved: false, posts: [{id: postId, author: 'ai', text: a.reason, createdAt: now(), decision: 'needs_review', requestId: value.requestId}]});
    item.approved = false;
  }
  if (revised) {
    for (const updated of revised) {
      const file = next.files.find(f => f.path === updated.path);
      if (!file || file.sourceVersion !== updated.sourceVersion) throw new Error('修正TXTの原文バージョンが一致しません');
      for (const slot of updated.slots) {
        const old = file.slots.find(s => s.id === slot.id && s.source === slot.source && s.fingerprint === slot.fingerprint);
        if (!old) throw new Error('修正TXTの翻訳単位が一致しません');
        const item = file.items.find(i => i.slotIds.includes(old.id))!;
        const pending = item.changes.find(c => c.slotId === old.id && c.status === 'pending');
        if (pending) {if (pending.after !== slot.translation) throw new Error('回答JSONと修正TXTの新訳が一致しません');}
        else if (old.translation !== slot.translation) {
          const answers = value.responses.filter(a => a.path === file.path && a.itemId === item.id);
          const threadId = answers.length === 1 ? answers[0].commentId : uid();
          let thread = item.threads.find(t => t.id === threadId);
          if (!thread) {thread = {id: threadId, resolved: false, posts: [{id: uid(), author: 'ai', text: '修正TXTに回答JSONで説明されていない変更があります。新訳を確認してください。', createdAt: now(), decision: 'needs_review'}]}; item.threads.push(thread);}
          propose(file, item, {slotId: old.id, before: old.translation, after: slot.translation}, threadId, 'ai', thread.posts.at(-1)!.id);
        }
      }
      file.enText = updated.enText; file.enBom = updated.enBom; file.version = updated.version; file.commands = updated.commands;
    }
    for (const path of touched) if (!revised.some(f => f.path === path)) throw new Error(`修正TXTが不足しています: ${path}`);
  }
  next.importedResponses.push(value.requestId); next.updatedAt = now(); return next;
}

export function sourceZip(workspace: Workspace) {
  return zipSync(Object.fromEntries(workspace.files.map(f => [`ja-JP/texts/${f.path}`, strToU8((f.jaBom ? '\uFEFF' : '') + f.jaText)])));
}

export function mergeFiles(workspace: Workspace, incoming: ReviewFile[]): Workspace {
  const next = structuredClone(workspace);
  for (const candidate of incoming) {
    const old = next.files.find(f => f.path === candidate.path);
    if (!old) {next.files.push(structuredClone(candidate)); continue;}
    try {
      const file = structuredClone(candidate), map = new Map<string, string>();
      const sameSource = file.sourceVersion === old.sourceVersion;
      for (const slot of file.slots) {
        const options = old.slots.filter(s => s.fingerprint === slot.fingerprint && (!sameSource || s.id === slot.id));
        if (options.length === 1) map.set(slot.id, options[0].id);
      }
      preserveGroups(file, old, map);
      const matched = new Set<string>();
      for (const item of file.items) {
        const oldIds = item.slotIds.map(id => map.get(id));
        const previous = old.items.filter(i => i.slotIds.length === oldIds.length && i.slotIds.every((id, index) => id === oldIds[index]));
        if (previous.length !== 1) continue;
        const prior = previous[0]; matched.add(prior.id);
        for (const id of item.slotIds) {
          const target = file.slots.find(s => s.id === id)!, source = old.slots.find(s => s.id === map.get(id))!;
          const existing = prior.changes.find(c => c.slotId === source.id && c.status === 'pending');
          if (existing && target.translation !== existing.after && target.translation !== source.translation) throw new Error('保留中の変更と異なる新訳があります');
        }
      }
      if (old.items.some(i => (i.approved || i.threads.length || i.changes.length) && !matched.has(i.id))) throw new Error('原文・構造が変わり、既存レビューを一意に対応付けできません');
      const rename = new Map<string, string>();
      for (const slot of file.slots) rename.set(slot.id, map.get(slot.id) ?? 'N:' + uid());
      for (const item of file.items) {
        const prior = old.items.find(i => i.slotIds.length === item.slotIds.length && i.slotIds.every((id, index) => id === map.get(item.slotIds[index])));
        const newValues = item.slotIds.map(id => file.slots.find(s => s.id === id)!);
        if (prior) {
          const edits = newValues.map(s => ({slotId: rename.get(s.id)!, before: old.slots.find(oldSlot => oldSlot.id === rename.get(s.id))!.translation, after: s.translation}));
          Object.assign(item, structuredClone(prior));
          for (let index = 0; index < edits.length; index++) {
            const edit = edits[index], existing = item.changes.find(c => c.slotId === edit.slotId && c.status === 'pending');
            newValues[index].translation = edit.before;
            if (!existing && edit.before !== edit.after) {item.changes.push({id: uid(), ...edit, origin: 'reload', threadId: null, status: 'pending', createdAt: now()}); item.approved = false;}
          }
        } else {item.slotIds = item.slotIds.map(id => rename.get(id)!); item.id = 'N:' + uid();}
      }
      for (const slot of file.slots) slot.id = rename.get(slot.id)!;
      file.usages = Object.fromEntries(Object.entries(file.usages).map(([id, hits]) => [rename.get(id)!, hits]));
      if (old.manualGroups) file.manualGroups = file.items.filter(i => i.code === 103).map(i => [...i.slotIds]);
      next.files[next.files.indexOf(old)] = file;
    } catch (error) {next.diagnostics.push({path: candidate.path, severity: 'error', message: `再読み込みを適用しませんでした: ${String(error)}`});}
  }
  next.updatedAt = now(); return next;
}
