export const LANDING_LOCALES = ['zh-Hans', 'zh-Hant'];
export const DEFAULT_LANDING_LOCALE = 'zh-Hant';
export const LANDING_LOCALE_STORAGE_KEY = 'qrtalkieLandingLocale';

/** 将浏览器/URL 语言标签归一到首页支持的两种语言；非中文返回 null。 */
export function normalizeLandingLocale(value) {
  const tag = String(value || '').trim().toLowerCase().replace(/_/g, '-');
  if (!tag) return null;
  if (tag === 'zh-hans' || tag.startsWith('zh-hans-') || tag === 'zh-cn' || tag === 'zh-sg' || tag === 'zh-my') {
    return 'zh-Hans';
  }
  if (tag === 'zh-hant' || tag.startsWith('zh-hant-') || tag === 'zh-tw' || tag === 'zh-hk' || tag === 'zh-mo') {
    return 'zh-Hant';
  }
  // 单独 zh 与「不支持的语言」一致走繁体
  if (tag === 'zh') return 'zh-Hant';
  return null;
}

/** URL ?lang= → localStorage → 浏览器语言 → 繁体。 */
export function resolveLandingLocale() {
  if (typeof window === 'undefined') return DEFAULT_LANDING_LOCALE;

  try {
    const fromUrl = normalizeLandingLocale(new URLSearchParams(window.location.search).get('lang'));
    if (fromUrl) return fromUrl;
  } catch {
    /* 忽略 URL 解析失败 */
  }

  try {
    const stored = normalizeLandingLocale(window.localStorage.getItem(LANDING_LOCALE_STORAGE_KEY));
    if (stored) return stored;
  } catch {
    /* 隐私模式可能禁用 localStorage */
  }

  const candidates = [];
  if (Array.isArray(window.navigator?.languages)) candidates.push(...window.navigator.languages);
  if (window.navigator?.language) candidates.push(window.navigator.language);
  for (const candidate of candidates) {
    const normalized = normalizeLandingLocale(candidate);
    if (normalized) return normalized;
  }

  return DEFAULT_LANDING_LOCALE;
}
