export function registerPwa(onError: (message: string) => void) {
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch(() =>
        onError('オフライン用リソースを保存できません。オンラインで再読み込みしてください'),
      );
  }
}
