import type { Diagnostic, DiagnosticDocument } from './model';
import { escape } from './ui';
export type TextLanguage = 'ja' | 'en';
export interface TextView {
  document: DiagnosticDocument;
  diagnostic: Diagnostic;
  language: TextLanguage;
  offsets: Partial<Record<TextLanguage, number>>;
  lines: Partial<Record<TextLanguage, string[]>>;
}
export const textLineHeight = 22;
export function createTextView(document: DiagnosticDocument, diagnostic: Diagnostic): TextView {
  return {
    document,
    diagnostic,
    language:
      document.jaText !== undefined && (diagnostic.line || !diagnostic.enLine) ? 'ja' : 'en',
    offsets: {},
    lines: {},
  };
}
export function viewLines(view: TextView): string[] | undefined {
  const lang = view.language,
    text = lang === 'ja' ? view.document.jaText : view.document.enText;
  if (text === undefined) return undefined;
  return (view.lines[lang] ??= text.split(/\r\n|\r|\n/));
}
export function targetLine(view: TextView): number {
  return Math.max(
    1,
    Math.min(
      viewLines(view)?.length ?? 1,
      (view.language === 'ja' ? view.diagnostic.line : view.diagnostic.enLine) ?? 1,
    ),
  );
}
export function textViewMarkup(view: TextView): string {
  const lines = viewLines(view);
  return `<div class="text-toolbar"><button class="text-act" data-action="diagnostic-back">‹ 読み込み結果</button><div role="tablist" aria-label="テキストの言語">${(['ja', 'en'] as const).map((lang) => `<button class="pill ${lang === view.language ? 'active' : ''}" role="tab" aria-selected="${lang === view.language}" data-action="text-language" data-value="${lang}" ${(lang === 'ja' ? view.document.jaText : view.document.enText) === undefined ? 'disabled' : ''}>${lang === 'ja' ? '日本語' : '英語'}</button>`).join('')}</div></div><div class="text-file-path">${escape(view.document.path)}${lines ? ` · ${targetLine(view)}行 / ${lines.length}行` : ''}</div>${lines ? `<div class="sheet-body text-scroll" tabindex="0" aria-label="ファイルのテキスト"><div class="text-document" style="height:${lines.length * textLineHeight}px"><div class="text-window"></div></div></div>` : '<div class="sheet-body empty">テキストはありません</div>'}`;
}
export function paintTextView(view: TextView, scroller: HTMLElement) {
  const lines = viewLines(view),
    window = scroller.querySelector<HTMLElement>('.text-window');
  if (!lines || !window) return;
  const lo = Math.max(0, Math.floor(scroller.scrollTop / textLineHeight) - 12);
  const hi = Math.min(
    lines.length,
    lo + Math.max(80, Math.ceil(scroller.clientHeight / textLineHeight) + 24),
  );
  const target = targetLine(view);
  window.style.top = `${lo * textLineHeight}px`;
  window.innerHTML = lines
    .slice(lo, hi)
    .map(
      (line, index) =>
        `<div class="text-row ${lo + index + 1 === target ? 'focus-line' : ''}" data-text-line="${lo + index + 1}" ${lo + index + 1 === target ? 'aria-current="true"' : ''}><span class="line-number">${lo + index + 1}</span><code>${escape(line)}</code></div>`,
    )
    .join('');
}
