import {escape as e} from './ui';
import type {DriveState} from './drive-controller';
const date = (value: string) => Number.isNaN(Date.parse(value)) ? '' : new Date(value).toLocaleString();
export function driveView(state: DriveState) {
  const disabled = state.working ? 'disabled' : '';
  return `<div class="sheet-body"><div class="drive-panel">
    <p class="hint">原文・英訳・コメント・承認状態をGoogle Driveのアプリ専用領域に保存し、同じGoogleアカウントの端末間で同期します。</p>
    <details ${!state.clientId ? 'open' : ''}><summary>接続設定</summary><form id="drive-config-form" class="drive-config"><label>OAuthクライアントID<input name="clientId" aria-label="Google OAuthクライアントID" value="${e(state.clientId)}" placeholder="…apps.googleusercontent.com" required ${disabled}></label><p class="hint">サイトの管理者がGoogle Cloudで作成したWebアプリ用IDを設定してください。クライアントシークレットは不要です。</p><button class="text-act" type="submit" ${disabled}>設定を保存</button></form></details>
    <p class="drive-status" role="status" aria-live="polite">${e(state.message)}</p>
    ${state.email ? `<p class="hint">接続先：${e(state.email)}</p>` : ''}
    ${state.lastSync ? `<p class="hint">最終同期：${e(date(state.lastSync))}</p>` : ''}
    <div class="drive-actions">${state.connected ? `<button class="primary" data-action="drive-sync" ${disabled}>今すぐ同期</button><button class="text-act" data-action="drive-disconnect" ${disabled}>接続を解除</button>` : `<button class="primary" data-action="drive-connect" ${disabled} ${!state.ready || !state.clientId ? 'disabled' : ''}>Googleに接続</button>`}</div>
    <label class="drive-auto"><input id="drive-auto" type="checkbox" ${state.automatic ? 'checked' : ''} ${disabled}>アプリを開いている間、1分ごとに自動同期</label>
    ${state.conflicts.length ? `<section class="drive-conflicts"><h3>使うデータを選択</h3><p class="hint">両方に変更があります。採用する状態を選んでください。選ばなかったDriveの状態も履歴に残ります。端末の状態を置き換える前に、復旧用のコピーを残します。</p><button class="text-act" data-action="drive-use-local" ${disabled}>この端末のデータを使う</button>${state.conflicts.map(revision => `<button class="text-act" data-action="drive-use-remote" data-value="${e(revision.id)}" ${disabled}>Driveのデータを使う：${e(revision.device)} · ${e(date(revision.modifiedTime))}</button>`).join('')}</section>` : ''}
    ${state.recovery ? '<button class="text-act" data-action="drive-recovery">同期前の端末データをバックアップ保存</button>' : ''}
    <p class="hint">接続を解除しても端末・Driveのデータは残ります。認証の期限が切れた場合は再接続してください。自動同期はこのアプリを開いている間だけ動作します。</p>
  </div></div>`;
}
