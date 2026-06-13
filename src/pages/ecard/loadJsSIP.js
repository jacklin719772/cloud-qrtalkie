let jssipLoaderPromise = null;

export function ensureJsSIPLoaded() {
  if (window.JsSIP) return Promise.resolve(window.JsSIP);
  if (jssipLoaderPromise) return jssipLoaderPromise;

  jssipLoaderPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-qrtalkie-jssip="true"]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.JsSIP));
      existing.addEventListener('error', () => reject(new Error('JsSIP 載入失敗')));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/jssip@3.10.1/dist/jssip.min.js';
    script.async = true;
    script.defer = true;
    script.dataset.qrtalkieJssip = 'true';
    script.onload = () => resolve(window.JsSIP);
    script.onerror = () => reject(new Error('JsSIP 載入失敗'));
    document.head.appendChild(script);
  });

  return jssipLoaderPromise;
}

