import { DEFAULT_LANDING_LOCALE } from './locale.js';
import zhHant from './zh-Hant.js';

const DICTIONARIES = { 'zh-Hant': zhHant };

/** 以简体中文原文为 key；繁体缺失时回退原文，便于逐条补齐。 */
export function createLandingTranslator(locale) {
  const dictionary = locale === DEFAULT_LANDING_LOCALE ? DICTIONARIES[locale] : null;
  return function translate(template, vars) {
    const source = String(template ?? '');
    if (!source) return '';
    let text = dictionary?.[source] ?? source;
    if (vars) {
      text = text.replace(/\{(\w+)\}/g, (match, key) => (
        Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key] ?? '') : match
      ));
    }
    return text;
  };
}
