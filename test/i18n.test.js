// The translation mechanism, apart from any plugin's texts: which of the app's 21 languages a
// phone's tag resolves to, which way the text runs, the holes in a text, and the check every
// plugin runs on its own catalogue. Copy this file with `src/i18n.js`; it names no text of List.
import { describe, expect, it } from "vitest";
import { LANGUAGES, dirOf, makeT, problemsOf, resolve } from "../src/i18n.js";

const tiny = () => {
  const catalogue = {};
  for (const lang of LANGUAGES) catalogue[lang] = { hello: `hi-${lang} {name}`, plain: `plain-${lang}` };
  return catalogue;
};

describe("the languages", () => {
  it("are the 21 of the app, English first", () => {
    expect(LANGUAGES).toEqual(["en", "es", "fr", "de", "it", "pt", "ro", "pl", "ru", "uk", "tr", "ar", "hi", "bn", "id", "vi", "th", "ja", "ko", "zh-CN", "zh-TW"]);
  });

  it("resolve a phone's tag: exact, then its base, then the right Chinese, then English", () => {
    expect(resolve("es")).toBe("es");
    expect(resolve("pt-BR")).toBe("pt");
    expect(resolve("PT-br")).toBe("pt");
    expect(resolve("zh-CN")).toBe("zh-CN");
    expect(resolve("zh")).toBe("zh-CN");
    expect(resolve("zh-Hans-CN")).toBe("zh-CN");
    expect(resolve("zh-TW")).toBe("zh-TW");
    expect(resolve("zh-HK")).toBe("zh-TW");
    expect(resolve("zh-Hant")).toBe("zh-TW");
    expect(resolve("xx")).toBe("en");
    expect(resolve("")).toBe("en");
    expect(resolve(undefined)).toBe("en");
  });

  it("run right to left only in Arabic", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("ar-EG")).toBe("rtl");
    expect(dirOf("es")).toBe("ltr");
    expect(dirOf(undefined)).toBe("ltr");
  });
});

describe("a text", () => {
  it("comes in the phone's language with its holes filled, and falls back to English", () => {
    const catalogue = tiny();
    delete catalogue.fr.plain;
    const t = makeT(catalogue);
    expect(t("es", "hello", { name: "Ana" })).toBe("hi-es Ana");
    expect(t("pt-BR", "plain")).toBe("plain-pt");
    expect(t("fr", "plain")).toBe("plain-en");
    expect(t("xx", "plain")).toBe("plain-en");
    expect(t("en", "nothing")).toBe("nothing");
  });

  it("leaves a hole it has no value for, and fills the same hole twice", () => {
    const t = makeT({ en: { two: "{a} and {a}, {b}" } });
    expect(t("en", "two", { a: 1 })).toBe("1 and 1, {b}");
  });
});

describe("the check of a catalogue", () => {
  it("passes a complete one", () => {
    expect(problemsOf(tiny())).toEqual([]);
  });

  it("lets a translation use a hole once where English uses it twice", () => {
    const catalogue = tiny();
    catalogue.en.hello = "{name}, hi {name}";
    expect(problemsOf(catalogue)).toEqual([]);
  });

  it("finds a missing language, a missing or extra key, an empty text and a lost hole", () => {
    const catalogue = tiny();
    delete catalogue.th;
    delete catalogue.ja.plain;
    catalogue.ko.extra = "x";
    catalogue.de.plain = "";
    catalogue.ru.hello = "no hole";
    const problems = problemsOf(catalogue);
    expect(problems).toContain("th: missing language");
    expect(problems).toContain("ja.plain: missing");
    expect(problems).toContain("ko.extra: not in English");
    expect(problems).toContain("de.plain: empty");
    expect(problems).toContain("ru.hello: holes differ from English");
    expect(problems).toHaveLength(5);
  });
});
