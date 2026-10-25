import apiClient from './apiClient';

let cachedPromise = null;

function deriveFallback(prefix) {
  try {
    const host = String(window.location.hostname || '').trim().toLowerCase();
    if (!host || host === 'localhost' || /^\d+(\.\d+){3}$/.test(host)) return '';
    const labels = host.split('.').filter(Boolean);
    const prefixes = new Set(['cloud', 'www', 'console', 'app', 'portal', 'sip', 'pbx']);
    if (labels.length > 1 && prefixes.has(labels[0])) labels.shift();
    if (labels.length < 2) return '';
    return `${prefix}.${labels.join('.')}`;
  } catch {
    return '';
  }
}

export function getDomainConfig() {
  if (cachedPromise) return cachedPromise;
  cachedPromise = apiClient.get('/public/config')
    .then((data) => ({
      sipDomain: String(data?.sipDomain || '').trim() || deriveFallback('sip'),
      webrtcDomain: String(data?.webrtcDomain || '').trim() || deriveFallback('pbx'),
    }))
    .catch(() => ({
      sipDomain: deriveFallback('sip'),
      webrtcDomain: deriveFallback('pbx'),
    }));
  return cachedPromise;
}
