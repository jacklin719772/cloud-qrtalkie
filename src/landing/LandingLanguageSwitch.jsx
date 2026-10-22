import React, { useEffect, useRef, useState } from 'react';
import { useLandingI18n } from './i18n/LandingI18n.jsx';

const OPTIONS = [
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁體中文' },
];

export default function LandingLanguageSwitch() {
  const { locale, setLocale, t } = useLandingI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const current = OPTIONS.find((option) => option.value === locale) || OPTIONS[1];

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <li className="qrt-lang-switch" ref={rootRef}>
      <button
        type="button"
        className="qrt-lang-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t('选择语言')}
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9c-2.4-2.5-3.6-5.5-3.6-9S9.6 5.5 12 3z" />
        </svg>
        <span>{current.label}</span>
        <svg className={`qrt-lang-caret${open ? ' is-open' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="qrt-lang-menu" role="listbox" aria-label={t('语言')}>
          {OPTIONS.map((option) => {
            const active = option.value === locale;
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={active ? 'is-active' : ''}
                  onClick={() => {
                    setLocale(option.value);
                    setOpen(false);
                  }}
                >
                  <span>{option.label}</span>
                  {active && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 4 4L19 6" />
                    </svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
