import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { ChevronDownIcon, GlobeIcon } from "./components/Icons";
import { detectLanguage, LANGUAGE_STORAGE_KEY, translate, type Language, type TranslationCatalog, type TranslationParameters } from "./i18n";

const LanguageContext = createContext<{
  language: Language;
  setLanguage: (language: Language) => void;
}>({ language: "en", setLanguage: () => {} });

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, updateLanguage] = useState<Language>(() => {
    try {
      const savedLanguage = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
      if (savedLanguage === "en" || savedLanguage === "ja") return savedLanguage;
    } catch {
      // Browser locale remains available when storage is blocked.
    }
    return detectLanguage(navigator.languages.length ? navigator.languages : [navigator.language]);
  });

  function setLanguage(nextLanguage: Language) {
    updateLanguage(nextLanguage);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // A manual choice still works for this visit without browser storage.
    }
  }

  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "ja" ? "Catania | 小さな島、無限の可能性" : "Catania | A Little Island, Endless Possibilities";
    document.querySelector('meta[name="description"]')?.setAttribute("content", language === "ja"
      ? "Cataniaを囲もう。3〜4人で端末を回しながら楽しむ、島づくりのボードゲーム。"
      : "Gather around Catania. A local, pass-and-play island-building board game for three or four players.");
  }, [language]);

  return <LanguageContext value={{ language, setLanguage }}>{children}</LanguageContext>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}

export function useTranslation<Catalog extends TranslationCatalog>(catalog: Catalog) {
  const { language } = useLanguage();
  return (message: keyof Catalog & string, parameters?: TranslationParameters) =>
    translate(language, catalog, message, parameters);
}

export function LanguageSelector() {
  const { language, setLanguage } = useLanguage();
  return (
    <span className="relative flex w-full items-center">
      <GlobeIcon className="pointer-events-none absolute left-3 h-4 w-4 text-ink" />
      <select
        aria-label={language === "ja" ? "言語" : "Language"}
        className="min-h-11 w-full min-w-0 appearance-none rounded-lg border border-line bg-paper pl-9 pr-8 text-xs font-medium text-ink transition-colors hover:bg-moss/45"
        value={language}
        onChange={event => setLanguage(event.target.value as Language)}
      >
        <option value="en" lang="en">English</option>
        <option value="ja" lang="ja">日本語</option>
      </select>
      <ChevronDownIcon className="pointer-events-none absolute right-2.5 h-3.5 w-3.5 text-muted" />
    </span>
  );
}
