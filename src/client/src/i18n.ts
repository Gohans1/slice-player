import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import vi from "./locales/vi.json";

export const defaultNS = "translation";
export const resources = {
  en: { translation: en },
  vi: { translation: vi },
} as const;

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "en",
    defaultNS,
    supportedLngs: ["en", "vi"],
    load: "languageOnly",
    nonExplicitSupportedLngs: true,
    returnNull: false,
    react: {
      useSuspense: false,
    },
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ["localStorage", "navigator"],
      caches: ["localStorage"],
      lookupLocalStorage: "slice-player-lang",
    },
  });

if (typeof document !== "undefined" && i18n.resolvedLanguage) {
  document.documentElement.lang = i18n.resolvedLanguage;
}

i18n.on("languageChanged", (lng) => {
  if (typeof document !== "undefined") {
    document.documentElement.lang = lng;
  }
});

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: (typeof resources)["en"];
    returnNull: false;
  }
}

export default i18n;
