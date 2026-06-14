import JsSIP from 'jssip';

let jssipLoaderPromise = null;

export function ensureJsSIPLoaded() {
  console.log('[ECardVisitor] JsSIP load start', {
    windowJsSIPExists: Boolean(window.JsSIP),
    hasPendingPromise: Boolean(jssipLoaderPromise),
  });

  if (window.JsSIP) {
    console.log('[ECardVisitor] JsSIP load success', { source: 'window.JsSIP' });
    return Promise.resolve(window.JsSIP);
  }

  if (jssipLoaderPromise) return jssipLoaderPromise;

  jssipLoaderPromise = Promise.resolve(JsSIP).then((moduleJsSIP) => {
    window.JsSIP = moduleJsSIP;
    console.log('[ECardVisitor] JsSIP load success', {
      source: 'local-dependency',
      windowJsSIPExists: Boolean(window.JsSIP),
    });
    return moduleJsSIP;
  }).catch((error) => {
    console.log('[ECardVisitor] JsSIP load error', {
      name: error?.name || '',
      message: error?.message || '',
    });
    throw error;
  });

  return jssipLoaderPromise;
}
