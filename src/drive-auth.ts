export const driveScope = 'https://www.googleapis.com/auth/drive.appdata';
const scope = `${driveScope} openid email`;
interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}
interface GoogleOAuth {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    include_granted_scopes: boolean;
    callback: (r: TokenResponse) => void;
    error_callback: () => void;
  }): { requestAccessToken(config: { prompt: string }): void };
}
const oauth = () =>
  (window as unknown as { google?: { accounts?: { oauth2?: GoogleOAuth } } }).google?.accounts
    ?.oauth2;
let loading: Promise<void> | undefined;
export function loadGoogleIdentity(): Promise<void> {
  if (oauth()) return Promise.resolve();
  if (!loading)
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      const timer = setTimeout(
        () => finish(new Error('Google認証の読み込みがタイムアウトしました')),
        20000,
      );
      const finish = (error?: Error) => {
        clearTimeout(timer);
        if (error) {
          script.remove();
          loading = undefined;
          reject(error);
        } else resolve();
      };
      script.onload = () =>
        oauth() ? finish() : finish(new Error('Google認証を準備できませんでした'));
      script.onerror = () =>
        finish(new Error('Google認証を読み込めません。通信を確認してください'));
      document.head.append(script);
    });
  return loading;
}
export function authorizeDrive(clientId: string): Promise<{ token: string; expiresAt: number }> {
  // Called directly from a click: do not await script loading before opening the popup.
  return new Promise((resolve, reject) => {
    const api = oauth();
    if (!api) {
      reject(new Error('Google認証の準備ができていません'));
      return;
    }
    api
      .initTokenClient({
        client_id: clientId,
        scope,
        include_granted_scopes: false,
        callback: (result) => {
          const granted = result.scope?.split(' ') ?? [];
          if (result.error || !result.access_token || !granted.includes(driveScope)) {
            reject(new Error('Driveへのアクセスが許可されませんでした'));
            return;
          }
          resolve({
            token: result.access_token,
            expiresAt: Date.now() + Math.max(0, Number(result.expires_in ?? 0) - 30) * 1000,
          });
        },
        error_callback: () =>
          reject(new Error('Google接続がキャンセルされたか、ポップアップが開けませんでした')),
      })
      .requestAccessToken({ prompt: 'select_account' });
  });
}
