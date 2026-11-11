export type Filter = 'all' | 'pending' | 'comment' | 'done';
export interface Command {
  enLine?: number | null;
  line: number; code: number; kind: string | null; depth: number; numbers: number[];
  strings: string[]; parentCode: number | null; opaque: boolean;
  ja: string; en: string; displayLineJa: number; displayLineEn: number;
}
export interface Slot {
  enLine?: number;
  sourceMissing?: boolean;
  sourceOverride?: string;
  id: string; line: number; start: number; end: number; source: string; translation: string;
  kind: string; key: string; title: string; position?: number; command: Command | null;
  fingerprint: string; warnings: string[];
  csv?:{row:number;item:number|null;dataName:boolean};
}
export interface Post { id: string; author: 'user' | 'ai'; text: string; createdAt: string; decision?: Decision; requestId?: string }
export type Decision = 'accepted' | 'rejected' | 'partial' | 'needs_review';
export interface Thread { id: string; resolved: boolean; posts: Post[] }
export interface Change {
  id: string; slotId: string; before: string; after: string; threadId: string | null;
  status: 'pending' | 'committed' | 'discarded'; createdAt: string; origin: 'ai' | 'reload';
  aiPostId?: string;
  rejectedBy?: string;
}
export interface Item {
  id: string; slotIds: string[]; title: string; code: number | null; depth: number | null;
  lastLine: number; approved: boolean; threads: Thread[]; changes: Change[];
}
export interface ReviewFile {
  path: string; type: 'common' | 'database' | 'map'; jaText: string; enText: string;
  jaBom: boolean; enBom: boolean; sourceVersion: string; version: string;
  slots: Slot[]; items: Item[]; commands: Command[]; usages: Record<string, number[]>;
  excluded: Array<Partial<Slot> & { reason: string }>; warnings: string[];
  manualGroups?: string[][];
  errors?: string[];
}
export interface Diagnostic { path: string; severity: 'error' | 'warning' | 'skip'; message: string; line?: number; enLine?: number }
export interface DiagnosticDocument {path:string;jaText?:string;enText?:string}
export type ReviewMode = 'comments' | 'initial';
export interface ReviewTarget {
  path: string; fileVersion: string; itemId: string; slotIds: string[];
  slots: {id: string; source: string; translation: string; line: number; key: string; kind: string; position?: number}[];
  context: Command[];
}
export interface InitialReviewTarget extends ReviewTarget {
  sourceVersion: string; title: string; threads: Thread[]; pendingChanges: Pick<Change, 'id' | 'slotId' | 'before' | 'after'>[];
}
export interface ReviewRequest {
  schemaVersion: 1; requestId: string; createdAt: string; mode?: ReviewMode;
  entries: (ReviewTarget & {commentId: string; posts: Post[]; pendingChanges?: Pick<Change, 'id' | 'slotId' | 'before' | 'after'>[]})[];
  targets?: InitialReviewTarget[];
}
export interface Workspace {
  schemaVersion: 1; files: ReviewFile[]; diagnostics: Diagnostic[]; requests: ReviewRequest[];
  importedResponses: string[]; updatedAt: string;
  diagnosticDocuments?: DiagnosticDocument[];
}
export const emptyWorkspace = (): Workspace => ({schemaVersion: 1, files: [], diagnostics: [], requests: [], importedResponses: [], updatedAt: new Date().toISOString()});
export const sourceText = (slot: Slot) => slot.sourceOverride ?? slot.source;
export function itemTitle(file:ReviewFile,item:Item):string {
  const slot=item.slotIds.length===1 ? file.slots.find(s=>s.id===item.slotIds[0]) : undefined;
  const index=slot && /^CSELF_NAME_(\d+)$/.exec(slot.key)?.[1];
  if(index!==undefined) return `セルフ変数名 ${Number(index)}`;
  const choice=file.type==='database' && slot ? /^CHOICE_NAME_(\d+)_(\d+)$/.exec(slot.key) : null;
  if(choice) return `選択肢名 ${Number(choice[1])}-${Number(choice[2])+1}`;
  const field=file.type==='database' && slot ? /^ITEMNAME(\d+)$/.exec(slot.key)?.[1] : undefined;
  return field!==undefined ? `項目名 ${Number(field)}` : item.title;
}
export const unresolved = (item: Item) => item.threads.filter(t => !t.resolved);
export const isDone = (item: Item) => item.approved && !unresolved(item).length && !item.changes.some(c => c.status === 'pending');
export const matches = (item: Item, filter: Filter) => filter === 'all' || (filter === 'done' ? isDone(item) : filter === 'pending' ? !isDone(item) : unresolved(item).length > 0);
