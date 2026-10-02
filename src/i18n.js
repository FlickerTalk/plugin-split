// How a FlickerTalk plugin speaks the app's 21 languages (Plan §84): the mechanism only, with no
// text of its own, so other plugins can copy this file as it is. English is the source; a tag the
// phone gives that is not one of the 21 resolves to its base, then to English. Texts may have
// holes like `{name}`. Dates, numbers and money never go in a catalogue: they go through `Intl`.

/** The languages of the app, English first. */
export const LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "ro", "pl", "ru", "uk", "tr", "ar", "hi", "bn", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"];

const RTL = new Set(["ar"]);
const TRADITIONAL = new Set(["tw", "hk", "mo", "hant"]);

/** Which of the 21 a phone's language tag means: exact, then its base, then English. */
export function resolve(lang) {
  const tag = String(lang ?? "").trim();
  if (!tag) return "en";
  const lower = tag.toLowerCase();
  const exact = LANGUAGES.find((one) => one.toLowerCase() === lower);
  if (exact) return exact;
  const parts = lower.split(/[-_]/);
  if (parts[0] === "zh") return parts.slice(1).some((part) => TRADITIONAL.has(part)) ? "zh-TW" : "zh-CN";
  return LANGUAGES.includes(parts[0]) ? parts[0] : "en";
}

/** Which way the text runs, for the `dir` attribute. */
export function dirOf(lang) {
  return RTL.has(resolve(lang)) ? "rtl" : "ltr";
}

const HOLE = /\{([a-zA-Z0-9_]+)\}/g;

/** `t(lang, key, holes)` over a catalogue `{ en: {...}, es: {...}, … }`. */
export function makeT(catalogue) {
  return (lang, key, holes = {}) => {
    const text = catalogue[resolve(lang)]?.[key] ?? catalogue.en?.[key] ?? key;
    return text.replace(HOLE, (whole, name) => (Object.hasOwn(holes, name) ? String(holes[name]) : whole));
  };
}

const holesOf = (text) => [...new Set([...String(text).matchAll(HOLE)].map((match) => match[1]))].sort().join(",");

/** What is wrong with a catalogue: every language, every key of English, no empty text, same holes. */
export function problemsOf(catalogue) {
  const problems = [];
  const english = catalogue.en ?? {};
  for (const lang of LANGUAGES) {
    const texts = catalogue[lang];
    if (!texts) {
      problems.push(`${lang}: missing language`);
      continue;
    }
    for (const key of Object.keys(english)) {
      if (!(key in texts)) problems.push(`${lang}.${key}: missing`);
      else if (typeof texts[key] !== "string" || !texts[key].trim()) problems.push(`${lang}.${key}: empty`);
      else if (holesOf(texts[key]) !== holesOf(english[key])) problems.push(`${lang}.${key}: holes differ from English`);
    }
    for (const key of Object.keys(texts)) if (!(key in english)) problems.push(`${lang}.${key}: not in English`);
  }
  return problems;
}
