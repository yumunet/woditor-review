import { diffChars } from 'diff';
import { escape } from './ui';
export function characterDiff(before: string, after: string): {before: string; after: string} {
  const parts = diffChars(before, after);
  return {
    before: parts.filter(p => !p.added).map(p => p.removed ? `<span class="diff-deleted">${escape(p.value)}</span>` : escape(p.value)).join(''),
    after: parts.filter(p => !p.removed).map(p => p.added ? `<span class="diff-added">${escape(p.value)}</span>` : escape(p.value)).join(''),
  };
}
