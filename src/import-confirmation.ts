import type { FileImportSummary } from './exchange';

export function importConfirmationView(
  summary: FileImportSummary,
  resetChangedApproval: boolean,
): string {
  return `<dl class="import-summary"><dt>上書きするファイル</dt><dd>${summary.overwrittenFiles}件</dd><dt>英訳が変わる項目</dt><dd>${summary.changedItems}件</dd><dt>破棄する保留案</dt><dd>${summary.discardedPending}件</dd></dl><p class="hint">コメントと解決状態は保持します。</p><label class="import-approval-option"><input type="checkbox" id="reset-import-approval" ${resetChangedApproval ? 'checked' : ''}><span>変更された項目を未確認に戻す</span></label>`;
}
