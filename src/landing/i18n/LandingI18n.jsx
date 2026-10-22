import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LANDING_LOCALE,
  LANDING_LOCALE_STORAGE_KEY,
  normalizeLandingLocale,
  resolveLandingLocale,
} from './locale.js';
import { createLandingTranslator } from './index.js';

const LandingI18nContext = createContext(null);

const FALLBACK = {
  locale: 'zh-Hans',
  setLocale: () => {},
  t: (template) => String(template ?? ''),
};

const PAGE_TITLES = {
  'zh-Hans': 'QRTalkie - 安全即时通讯与物联网应用',
  'zh-Hant': 'QRTalkie - 安全即時通訊與物聯網應用',
};

export function LandingI18nProvider({ children }) {
  const [locale, setLocaleState] = useState(resolveLandingLocale);
  const previousTitleRef = useRef(typeof document !== 'undefined' ? document.title : '');

  const setLocale = useCallback((next) => {
    const normalized = normalizeLandingLocale(next) || DEFAULT_LANDING_LOCALE;
    setLocaleState(normalized);
    try {
      window.localStorage.setItem(LANDING_LOCALE_STORAGE_KEY, normalized);
    } catch {
      /* 隐私模式下不影响本次会话切换 */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = PAGE_TITLES[locale] || PAGE_TITLES[DEFAULT_LANDING_LOCALE];
  }, [locale]);

  useEffect(() => () => {
    // 首页卸载（进入控制台）时恢复原页面 title
    document.title = previousTitleRef.current;
  }, []);

  const t = useMemo(() => createLandingTranslator(locale), [locale]);
  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LandingI18nContext.Provider value={value}>{children}</LandingI18nContext.Provider>;
}

export function useLandingI18n() {
  const context = useContext(LandingI18nContext);
  if (!context) throw new Error('useLandingI18n must be used within LandingI18nProvider');
  return context;
}

/** 独立电子名片页等无 Provider 场景：默认简体、不翻译。 */
export function useLandingI18nOptional() {
  return useContext(LandingI18nContext) || FALLBACK;
}

/** 需要区分「有无 Provider」时使用（如电子名片聊天面板默认繁体）。 */
export function useLandingI18nContextOptional() {
  return useContext(LandingI18nContext);
}
