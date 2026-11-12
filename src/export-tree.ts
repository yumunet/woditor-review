import type { ReviewFile } from './model';
import { escape, fileTree, folderTriangle, icon, type TreeNode } from './ui';
export const folderFiles = (files: ReviewFile[], path: string) =>
  files.filter((f) => f.path.startsWith(path + '/'));
export function exportTree(files: ReviewFile[], selected: Set<string>, collapsed: Set<string>) {
  const rows = (node: TreeNode, depth: number): string =>
    node.children
      .map((child) => {
        if (child.file)
          return `<label class="export-row export-leaf" style="--depth:${depth}"><input type="checkbox" aria-label="${escape(child.path)}" data-export-path="${escape(child.path)}" ${selected.has(child.path) ? 'checked' : ''}>${icon('file')}<span>${escape(child.name)}</span></label>`;
        const descendants = folderFiles(files, child.path),
          open = !collapsed.has(child.path),
          checked = descendants.filter((f) => selected.has(f.path)).length;
        return `<div class="export-branch"><div class="export-row export-folder" style="--depth:${depth}"><button type="button" class="export-toggle" aria-label="${escape(child.path)}を${open ? '閉じる' : '開く'}" aria-expanded="${open}" data-action="export-folder" data-value="${escape(child.path)}">${folderTriangle()}</button><label><input type="checkbox" aria-label="${escape(child.path)}を選択" data-export-folder="${escape(child.path)}" ${checked === descendants.length ? 'checked' : ''}>${icon('folder')}<span>${escape(child.name)}</span></label></div><div class="export-children" ${open ? '' : 'hidden'}>${rows(child, depth + 1)}</div></div>`;
      })
      .join('');
  return `<div class="export-tree" aria-label="出力対象ファイル">${rows(fileTree(files, 'all'), 0)}</div>`;
}
