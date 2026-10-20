// The app's words in English, Afrikaans and Setswana. English is complete; the other two are
// first drafts (meta.needs_review) to be checked by a first-language speaker, listed in
// docs/translations-review.md. A key missing from a draft shows the English text, never a key.
//
// t('home.tankLeft', { litres: 120 }) -> "About 120 L left — estimate". The choice is saved on
// this phone and sent to the API, so Telegram messages use the same language.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo, useSyncExternalStore } from 'react';
import en from './en.json';
import af from './af.json';
import tn from './tn.json';

export type Language = 'en' | 'af' | 'tn';
export type TranslationKey = keyof typeof en.strings;

type Dictionary = { meta: { language: string; name: string; needs_review: boolean }; strings: Partial<Record<TranslationKey, string>> };

const DICTIONARIES: Record<Language, Dictionary> = {
  en: en as Dictionary,
  af: af as Dictionary,
  tn: tn as Dictionary,
};

export const LANGUAGES: { value: Language; name: string; beta: boolean }[] = (['en', 'af', 'tn'] as Language[]).map(value => ({
  value,
  name: DICTIONARIES[value].meta.name,
  beta: DICTIONARIES[value].meta.needs_review,
}));

const STORAGE_KEY = 'agroflow_language';

let current: Language = 'en';
const listeners = new Set<() => void>();
let onChangeHook: ((lang: Language) => void) | null = null;

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'af' || value === 'tn';
}

export function getLanguage(): Language {
  return current;
}

export function translate(lang: Language, key: TranslationKey, params?: Record<string, string | number>): string {
  const text = DICTIONARIES[lang].strings[key] ?? DICTIONARIES.en.strings[key] ?? key;
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
}

export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  return translate(current, key, params);
}

// Called once at start-up: the saved choice, else English.
export async function loadLanguage(): Promise<Language> {
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (isLanguage(saved)) setCurrent(saved);
  } catch { /* English */ }
  return current;
}

function setCurrent(lang: Language) {
  if (lang === current) return;
  current = lang;
  listeners.forEach(fn => fn());
}

export async function setLanguage(lang: Language): Promise<void> {
  setCurrent(lang);
  try {
    await AsyncStorage.setItem(STORAGE_KEY, lang);
  } catch { /* still changed for this session */ }
  onChangeHook?.(lang);
}

// The API client registers this so the farmer's choice reaches the Telegram messages.
export function onLanguageChange(fn: (lang: Language) => void) {
  onChangeHook = fn;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Re-renders the screen when the language changes. `t` keeps the same identity until the
// language changes, so screens can list it in effect dependencies without re-running them on
// every render.
export function useI18n(): { lang: Language; t: typeof t; setLanguage: typeof setLanguage } {
  const lang = useSyncExternalStore(subscribe, getLanguage, getLanguage);
  return useMemo(() => ({
    lang,
    t: (key: TranslationKey, params?: Record<string, string | number>) => translate(lang, key, params),
    setLanguage,
  }), [lang]);
}

// For tests only.
export function resetLanguageForTests() {
  current = 'en';
  listeners.clear();
  onChangeHook = null;
}
