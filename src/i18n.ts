import type { Resource } from "./game/types";

export type Language = "en" | "ja";
export type TranslationCatalog = Record<string, string>;
export type TranslationParameters = Record<string, string | number>;

export const LANGUAGE_STORAGE_KEY = "catania.language";

export function defaultComputerName(language: Language, number: number): string {
  return language === "ja" ? `コンピューター${number}` : `Computer ${number}`;
}

export function detectLanguage(locales: readonly string[]): Language {
  for (const locale of locales) {
    const language = locale.toLowerCase().split("-")[0];
    if (language === "ja" || language === "en") return language;
  }
  return "en";
}

export function translate<Catalog extends TranslationCatalog>(
  language: Language,
  catalog: Catalog,
  message: keyof Catalog & string,
  parameters: TranslationParameters = {},
): string {
  const template = language === "ja" ? catalog[message]! : message;
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(parameters, name) ? String(parameters[name]) : placeholder,
  );
}

const resourceNames = {
  wood: { en: "Wood", ja: "木材" },
  brick: { en: "Brick", ja: "レンガ" },
  wool: { en: "Wool", ja: "羊毛" },
  grain: { en: "Grain", ja: "小麦" },
  ore: { en: "Ore", ja: "鉱石" },
} satisfies Record<Resource, Record<Language, string>>;

export function resourceName(language: Language, resource: Resource): string {
  return resourceNames[resource][language];
}

const pieceNames = {
  road: { en: "road", ja: "街道" },
  settlement: { en: "settlement", ja: "開拓地" },
  city: { en: "city", ja: "都市" },
  development: { en: "development", ja: "発展" },
} satisfies Record<string, Record<Language, string>>;

export function pieceName(language: Language, piece: keyof typeof pieceNames): string {
  return pieceNames[piece][language];
}
