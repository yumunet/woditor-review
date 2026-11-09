import type {Workspace} from './model';
import {GoogleDrive, DriveAuthError, type DriveRevision} from './drive-api';
import {authorizeDrive, loadGoogleIdentity} from './drive-auth';
import {synchronize, workspaceHash, type SyncBase, type SyncResolution} from './drive-sync';
import {readSetting, writeSetting, restoreJson} from './storage';
export interface DriveState {clientId: string; ready: boolean; working: boolean; email: string; connected: boolean; automatic: boolean; message: string; lastSync?: string; conflicts: DriveRevision[]; recovery?: Workspace}
interface Options {getWorkspace(): Workspace; applyWorkspace(workspace: Workspace, expectedHash: string): Promise<void>; canAutoSync(): boolean; changed(): void}
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
export class DriveController {
  state: DriveState = {clientId: '', ready: false, working: false, email: '', connected: false, automatic: false, message: 'Googleに接続すると、別の端末とレビューを同期できます。', conflicts: []};
  private session?: {token: string; expiresAt: number};
  private base?: SyncBase;
  private accountKey = '';
  private timer?: ReturnType<typeof setInterval>;
  private remote = new GoogleDrive(() => {
    if (!this.session || Date.now() >= this.session.expiresAt) throw new DriveAuthError(); return this.session.token;
  });
  constructor(private options: Options) {}
  async initialize() {
    const config = await readSetting<{clientId?: string; automatic?: boolean}>('drive-config');
    this.state.clientId = typeof config?.clientId === 'string' ? config.clientId : import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '';
    this.state.automatic = config?.automatic === true;
    const recovery = await readSetting<string>('drive-recovery');
    if (typeof recovery === 'string') {try {this.state.recovery = restoreJson(recovery);} catch {/* Ignore an invalid recovery record. */}}
  }
  async prepare() {
    if (!this.state.clientId || this.state.ready) return;
    try {await loadGoogleIdentity(); this.state.ready = true;} catch (error) {this.state.message = message(error);}
    this.options.changed();
  }
  async configure(clientId: string) {
    clientId = clientId.trim();
    if (!/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('Webアプリ用のOAuthクライアントIDを入力してください');
    this.disconnect(); this.state.clientId = clientId;
    await this.saveConfig(); this.state.message = '設定を保存しました。「Googleに接続」で接続してください。'; await this.prepare(); this.options.changed();
  }
  private saveConfig() {return writeSetting('drive-config', {clientId: this.state.clientId, automatic: this.state.automatic});}
  async setAutomatic(value: boolean) {this.state.automatic = value; await this.saveConfig(); this.options.changed();}
  async connect() {
    if (this.state.working) return;
    // Popup must be requested before the first await in this user-driven handler.
    const authorization = authorizeDrive(this.state.clientId);
    this.state.working = true; this.state.message = 'Googleに接続中…'; this.options.changed();
    try {
      this.session = await authorization;
      const account = await this.remote.account(); this.state.email = account.email;
      this.accountKey = `drive-base:${this.state.clientId}:${account.id}`;
      const base = await readSetting<SyncBase>(this.accountKey);
      this.base = base && typeof base.revision === 'string' && typeof base.hash === 'string' ? base : undefined;
      this.state.connected = true; this.state.conflicts = []; this.state.lastSync = this.base?.syncedAt; this.state.message = '接続しました。「今すぐ同期」でレビューを同期できます。';
      if (this.timer) clearInterval(this.timer);
      this.timer = setInterval(() => {if (this.state.automatic && this.options.canAutoSync() && !this.state.conflicts.length) void this.sync();}, 60000);
    } catch (error) {this.session = undefined; this.state.connected = false; this.state.message = message(error);}
    finally {this.state.working = false; this.options.changed();}
  }
  disconnect() {
    this.session = undefined; this.base = undefined; this.accountKey = ''; if (this.timer) clearInterval(this.timer);
    this.state.connected = false; this.state.email = ''; this.state.conflicts = []; this.state.lastSync = undefined; this.state.message = '接続を解除しました。端末とDriveのデータは保持されています。'; this.options.changed();
  }
  async sync(resolution?: SyncResolution) {
    if (this.state.working || !this.state.connected) return;
    this.state.working = true; this.state.message = '同期中…'; this.options.changed();
    const local = structuredClone(this.options.getWorkspace());
    try {
      const startHash = await workspaceHash(local);
      const result = await synchronize(this.remote, local, this.base, deviceName(), resolution);
      if (result.kind === 'conflict') {this.state.conflicts = result.heads; this.state.message = '端末とDriveに異なる変更があります。使うデータを選んでください。';}
      else {
        if (result.workspace) {
          if (await workspaceHash(this.options.getWorkspace()) !== startHash) throw new Error('同期中に端末のデータが変わりました。もう一度同期してください');
          await writeSetting('drive-recovery', JSON.stringify(local)); this.state.recovery = local;
          await this.options.applyWorkspace(result.workspace, startHash);
        }
        this.state.conflicts = []; this.state.message = result.kind === 'uploaded' ? '端末の変更をDriveに保存しました。' : result.kind === 'downloaded' ? 'Driveの変更を端末に反映しました。' : '同期済みです。';
      }
      if (result.base) {this.base = result.base; this.state.lastSync = result.base.syncedAt; await writeSetting(this.accountKey, result.base);}
    } catch (error) {
      if (error instanceof DriveAuthError) {this.session = undefined; this.state.connected = false;}
      this.state.message = message(error);
    } finally {this.state.working = false; this.options.changed();}
  }
}
function deviceName() {
  const agent = navigator.userAgent;
  return /iPhone|iPad/.test(agent) ? 'iPhone・iPad' : /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows' : /Mac/.test(agent) ? 'Mac' : 'ブラウザ';
}
