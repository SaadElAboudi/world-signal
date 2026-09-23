"use client";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { fr } from "./fr";
import countries from "../providers/countries.json";
export type Locale = "en" | "fr";
export function translate(text: string, locale: Locale) {
  if (locale === "en") return text;
  if (fr[text]) return fr[text];
  return text
    .replace(/(\d+) sources current/g, "$1 sources à jour")
    .replace(/(\d+) REFERENCE WINDOWS/g, "$1 PÉRIODES DE RÉFÉRENCE")
    .replace(/(\d+) REFERENCE DAYS/g, "$1 JOURS DE RÉFÉRENCE")
    .replace(
      /(\d+) matched historical days/g,
      "$1 jours historiques comparables",
    )
    .replace(
      /(\d+) (\d+)h reference windows( · provisional)?/g,
      "$1 périodes de $2 h$3",
    )
    .replace(" · provisional", " · provisoire");
}
const Context = createContext({
  locale: "en" as Locale,
  setLocale: (() => {}) as (locale: Locale) => void,
  t: (s: string) => s,
  countryName: (s: string) => s,
});
export function I18nProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState(initialLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = (value: Locale) => {
    setLocaleState(value);
    document.cookie = `world-signal-language=${value};Path=/;Max-Age=31536000;SameSite=Lax`;
    const url = new URL(window.location.href);
    url.searchParams.set("lang", value);
    window.history.replaceState(null, "", url);
  };
  const countryName = (name: string) => {
    if (locale === "en")
      return name === "United States of America" ? "United States" : name;
    const code = countries.find((country) => country.name === name)?.code;
    return code
      ? (new Intl.DisplayNames(["fr"], { type: "region" }).of(code) ?? name)
      : translate(name, locale);
  };
  return (
    <Context.Provider
      value={{ locale, setLocale, t: (s) => translate(s, locale), countryName }}
    >
      {children}
    </Context.Provider>
  );
}
export const useI18n = () => useContext(Context);
export function LanguageSwitch() {
  const { locale, setLocale } = useI18n();
  return (
    <div
      className="language-switch"
      role="group"
      aria-label={locale === "fr" ? "Langue" : "Language"}
    >
      <button
        type="button"
        lang="fr"
        aria-label="Français"
        aria-pressed={locale === "fr"}
        onClick={() => setLocale("fr")}
      >
        FR
      </button>
      <button
        type="button"
        lang="en"
        aria-label="English"
        aria-pressed={locale === "en"}
        onClick={() => setLocale("en")}
      >
        EN
      </button>
    </div>
  );
}
