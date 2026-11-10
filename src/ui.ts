import type { Filter, Item, ReviewFile } from './model';
import { isDone, matches } from './model';

export const escape = (s: string | number) => String(s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]!));
const paths: Record<string, string> = {
  radius:'<path d="M4 8h16M4 16h16M12 3v18m-3-3 3 3 3-3m-6-12 3-3 3 3"/>',
  language:'<path d="M3 5h12M9 3v2M5 5c1 5 4 8 9 10M13 5c-1 5-4 8-9 10m10 6 4-11 4 11m-6-4h4"/>',
  numbers:'<path d="M4 4h1v6M3 10h4M3 15c4-3 5 1 1 3l-1 3h4M11 6h10M11 12h10M11 18h10"/>',
  wrap:'<path d="M3 5h18M3 10h13a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 15h3"/>',
  back: '<path d="m15 18-6-6 6-6"/>', next: '<path d="m9 6 6 6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>', check: '<path d="m5 12 4 4L19 6"/>',
  'check-circle': '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  undo: '<path d="M3 10h10a7 7 0 0 1 0 14M3 10l5-5M3 10l5 5" transform="translate(0 -3)"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', menu: '<circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/>',
  'item-jump': '<path d="M8 6h12M8 12h5M8 18h5M3 6h1M3 12h1M3 18h1m13-8 4 4-4 4m-3-4h7"/>',
  comment: '<path d="M20 15a3 3 0 0 1-3 3H8l-5 4V6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3Z"/>',
  folder: '<path d="M3 6h7l2 2h9v12H3Z"/>', file: '<path d="M5 3h9l5 5v13H5Z M14 3v6h5"/>',
  reply: '<path d="m9 5-6 6 6 6M3 11h10a7 7 0 0 1 7 7"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14Z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M3 16v5h18v-5"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  cloud: '<path d="M6 18a4 4 0 0 1-1-7.9 7 7 0 0 1 13.4-1.4A4.7 4.7 0 0 1 18 18Z"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M5 8a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3"/>',
  alert: '<path d="M12 3 2 21h20ZM12 9v5M12 17h.01"/>',
  split: '<path d="M12 21v-7M5 3v4l7 7 7-7V3M2 6l3-3 3 3M16 6l3-3 3 3"/>',
  merge: '<path d="m5 21 7-7 7 7M12 14V3M8 7l4-4 4 4"/>',
};
export const icon = (name: string) => `<svg class="svg" viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.file}</svg>`;
export const folderTriangle = () => '<svg class="folder-triangle" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 2 8 5 2 8Z"/></svg>';
const menuIcons: Record<string,string> = {load:'upload',diagnostics:'alert',export:'spark',response:'download',english:'file',drive:'cloud',backup:'download',restore:'undo','split-group':'split','merge-group':'merge'};
export const menuIcon = (action: string) => icon(menuIcons[action] ?? 'file');
export const filters: [Filter, string][] = [['all', 'すべて'], ['pending', '未確認'], ['comment', 'コメントあり'], ['done', '確認済み']];
export const filterButtons = (filter: Filter, scope: string) => `<div class="filters" aria-label="${scope === 'home' ? 'ファイル' : '項目'}フィルター">${filters.map(([key, label]) => `<button class="pill ${key === filter ? 'active' : ''}" data-action="filter" data-scope="${scope}" data-value="${key}" aria-pressed="${key === filter}">${label}</button>`).join('')}</div>`;
export const compact = (n: number) => n < 1000 ? String(n) : `${Math.round(n / 100) / 10}K`;
export const progress = (items: Item[]) => ({total: items.length, done: items.filter(isDone).length});
export const percent = (done: number, total: number) => total ? Math.round(done / total * 100) : null;
export interface TreeNode { path: string; name: string; file?: ReviewFile; children: TreeNode[]; total: number; done: number; visible: boolean }
export function fileTree(files: ReviewFile[], filter: Filter): TreeNode {
  const root: TreeNode = {path: '', name: '全体', children: [], total: 0, done: 0, visible: false};
  for (const file of files) {
    let node = root;
    const parts = file.path.split('/');
    parts.forEach((name, index) => {
      const path = parts.slice(0, index + 1).join('/');
      let child = node.children.find(c => c.path === path);
      if (!child) {child = {path, name, children: [], total: 0, done: 0, visible: false}; node.children.push(child);}
      if (index === parts.length - 1) child.file = file;
      node = child;
    });
  }
  const collator = new Intl.Collator('ja', {numeric: true});
  const visit = (node: TreeNode) => {
    node.children.sort((a, b) => Number(!!a.file) - Number(!!b.file) || collator.compare(a.name, b.name));
    node.children.forEach(visit);
    if (node.file) {
      Object.assign(node, progress(node.file.items));
      node.visible = filter === 'all' || node.file.items.some(i => matches(i, filter));
    } else {
      node.total = node.children.reduce((n, c) => n + c.total, 0);
      node.done = node.children.reduce((n, c) => n + c.done, 0);
      node.visible = node.children.some(c => c.visible);
    }
  };
  visit(root); return root;
}

export const initialContext = (file: ReviewFile, line: number, before: number, after: number) => {
  const index = file.commands.findIndex(c => c.line === line);
  return index < 0 ? [] : file.commands.slice(Math.max(0, index - before), index + after + 1);
};
