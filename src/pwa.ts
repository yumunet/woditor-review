export function registerPwa(onError: (message: string) => void) {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.register('/sw.js').catch(() => onError('オフライン用リソースを保存できません。オンラインで再読み込みしてください'));
  }
}
