import type { Diagnostic } from './model';
import { escape } from './ui';
const tabs: [Diagnostic['severity'], string][] = [['error', 'エラー'], ['warning', '警告'], ['skip', '対象外']];
export function diagnosticsView(diagnostics: Diagnostic[], active: Diagnostic['severity']) {
  const selected = diagnostics.filter(d => d.severity === active);
  const label = tabs.find(([key]) => key === active)![1];
  return `<div class="filters" role="tablist" aria-label="読み込み結果の種類">${tabs.map(([key, name]) => `<button class="pill ${active === key ? 'active' : ''}" role="tab" aria-selected="${active === key}" aria-controls="diagnostic-panel" id="diagnostic-tab-${key}" data-action="diagnostic-tab" data-value="${key}">${name} (${diagnostics.filter(d => d.severity === key).length})</button>`).join('')}</div><div class="sheet-body" id="diagnostic-panel" role="tabpanel" aria-labelledby="diagnostic-tab-${active}">${selected.map(d => `<div class="diagnostic ${d.severity}"><strong>${escape(d.path)}</strong>${escape(d.message)}</div>`).join('') || `<div class="empty">${label}はありません</div>`}</div>`;
}
export function withoutReplacedDiagnostics(diagnostics: Diagnostic[], paths: string[]): Diagnostic[] {
  const attempted = new Set(paths);
  return diagnostics.filter(d => !attempted.has(d.path));
}
