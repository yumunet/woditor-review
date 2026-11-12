import type { ReviewFile, Item } from './model';
import type { Preferences } from './preferences';
import { escape as e, icon, initialContext } from './ui';
import { commandColor } from './command-colors';
export type ContextMenu = 'radius' | 'language' | null;
export interface ContextState {
  usageIndex: number;
  before: number;
  after: number;
  menu: ContextMenu;
}
const tool = (
  name: string,
  label: string,
  action: string,
  value: string,
  pressed?: boolean,
  attributes = '',
) =>
  `<button class="icon context-option" data-tooltip="${label}" aria-label="${label}" data-action="${action}" data-value="${value}" ${attributes} ${pressed === undefined ? '' : `aria-pressed="${pressed}"`}>${icon(name)}</button>`;
export function contextView(file: ReviewFile, item: Item, prefs: Preferences, state: ContextState) {
  const slot = file.slots.find((s) => s.id === item.slotIds[0])!,
    usages = file.usages[slot.id];
  if (!slot.command && !usages) return '';
  const line = usages ? usages[state.usageIndex] : slot.command ? slot.line : undefined,
    index = file.commands.findIndex((c) => c.line === line);
  const commands = prefs.contextFull
    ? file.commands
    : line === undefined
      ? []
      : initialContext(file, line, state.before, state.after);
  const marked = new Set(prefs.contextFull && usages ? usages : line === undefined ? [] : [line]);
  let ordinal = 0;
  const numbers = new Map(
    file.commands.map((c) => [c, c[prefs.contextLanguage] ? ordinal++ : null]),
  );
  const dropdown = (kind: Exclude<ContextMenu, null>, name: string, label: string) =>
    `<span class="context-setting">${tool(name, label, 'context-menu', kind, undefined, `aria-haspopup="listbox" aria-expanded="${state.menu === kind && !(kind === 'radius' && prefs.contextFull)}" ${kind === 'radius' && prefs.contextFull ? 'disabled' : ''}`)}${
      state.menu === kind && !(kind === 'radius' && prefs.contextFull)
        ? `<div class="context-popover" role="listbox" aria-label="${label}">${(kind === 'radius'
            ? Array.from({ length: 8 }, (_, i) => [String(i + 3), `${i + 3}行`])
            : [
                ['ja', '日本語'],
                ['en', '英語'],
              ]
          )
            .map(
              ([value, text]) =>
                `<button role="option" aria-selected="${kind === 'radius' ? Number(value) === prefs.contextRadius : value === prefs.contextLanguage}" data-action="context-${kind}" data-value="${value}">${text}</button>`,
            )
            .join('')}</div>`
        : ''
    }</span>`;
  return `<button class="context-title" data-action="context" aria-expanded="${prefs.contextOpen}">周辺コマンド<span class="chevron ${prefs.contextOpen ? 'open' : ''}">${prefs.contextOpen ? '閉じる' : '開く'}${icon('down')}</span></button>${prefs.contextOpen ? `<div class="command-frame"><div class="context-tools"><div class="usage-tools">${usages ? `<span>${prefs.contextFull ? `使用箇所 ${usages.length}件` : `使用箇所 ${usages.length ? state.usageIndex + 1 : 0} / ${usages.length}`}</span>${prefs.contextFull ? '' : `<button class="icon" aria-label="前の使用箇所" data-action="usage" data-value="-1" ${state.usageIndex <= 0 ? 'disabled' : ''}>${icon('back')}</button><button class="icon" aria-label="次の使用箇所" data-action="usage" data-value="1" ${state.usageIndex >= usages.length - 1 ? 'disabled' : ''}>${icon('next')}</button>`}` : ''}</div><div class="context-options">${dropdown('radius', 'radius', '前後の行数')}${tool('file', 'ファイル全体を表示', 'context-toggle', 'contextFull', prefs.contextFull)}${dropdown('language', 'language', '表示言語')}${tool('numbers', '行番号', 'context-toggle', 'contextLineNumbers', prefs.contextLineNumbers)}${tool('wrap', '行の折り返し', 'context-toggle', 'contextWrap', prefs.contextWrap)}</div></div><div class="command-lines ${prefs.contextWrap ? '' : 'no-wrap'}">${commands.length ? `${prefs.contextFull ? '' : `<button class="expand" data-action="expand" data-value="before" ${index - state.before <= 0 ? 'disabled' : ''}>前をさらに表示</button>`}${commands.map((c) => `<div class="command ${marked.has(c.line) ? 'current' : ''}" style="color:${commandColor(c[prefs.contextLanguage])}" data-command-line="${c.line}" ${marked.has(c.line) ? 'aria-current="true"' : ''}>${prefs.contextLineNumbers ? `<span class="command-number" aria-label="行番号">${numbers.get(c) ?? '—'}</span>` : ''}<span class="command-code">${e(c[prefs.contextLanguage])}</span></div>`).join('')}${prefs.contextFull ? '' : `<button class="expand" data-action="expand" data-value="after" ${index + state.after >= file.commands.length - 1 ? 'disabled' : ''}>後をさらに表示</button>`}` : '<div class="empty">直接参照はありません</div>'}</div></div>` : ''}`;
}
export function positionContextMenu(root: HTMLElement) {
  const popup = root.querySelector<HTMLElement>('.context-popover');
  if (!popup) return;
  const anchor = popup.previousElementSibling!.getBoundingClientRect(),
    bounds = root.getBoundingClientRect();
  const rect = popup.getBoundingClientRect();
  popup.style.left = `${Math.max(bounds.left + 6, Math.min(anchor.right - rect.width, bounds.right - rect.width - 6))}px`;
  popup.style.top = `${Math.max(bounds.top + 6, anchor.bottom + rect.height > bounds.bottom - 6 ? anchor.top - rect.height : anchor.bottom + 4)}px`;
}
