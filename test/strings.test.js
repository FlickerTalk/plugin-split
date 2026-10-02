// Split's own texts: the 21 languages of the app, the same keys and holes in each, nothing empty,
// and the plugin's name never written into a text (it comes from the manifest, one place).
import { describe, expect, it } from "vitest";
import { LANGUAGES, makeT, problemsOf } from "../src/i18n.js";
import { STRINGS } from "../src/strings.js";

describe("Split's catalogue", () => {
  it("speaks the 21 languages of the app, with the same keys and holes in each", () => {
    expect(Object.keys(STRINGS).sort()).toEqual([...LANGUAGES].sort());
    expect(Object.keys(STRINGS.en).length).toBeGreaterThan(40);
    expect(problemsOf(STRINGS)).toEqual([]);
  });

  it("takes the plugin's name from a hole, so renaming it is one change", () => {
    const t = makeT(STRINGS);
    expect(t("en", "silent", { app: "Split" })).toContain("Split");
    for (const lang of LANGUAGES) for (const text of Object.values(STRINGS[lang])) expect(text, lang).not.toMatch(/(?<![\p{L}\p{N}])Split(?![\p{L}\p{N}])/u);
    expect(t("es", "empty")).toBe("Todavía no hay cuentas");
  });

  it("writes the summary pieces as the sender says them, in each language", () => {
    for (const lang of LANGUAGES) {
      for (const key of ["sumTotal", "sumMine", "sumTheirs", "sumOwesMe", "sumIOwe"]) expect(STRINGS[lang][key], `${lang}.${key}`).toContain("{amount}");
      expect(STRINGS[lang].sumEven, lang).toContain("✅");
    }
  });

  it("has no emoji in any language, except in the summary that goes to the chat", () => {
    for (const lang of LANGUAGES) {
      for (const [key, text] of Object.entries(STRINGS[lang])) {
        if (key.startsWith("sum")) continue;
        expect(text.match(/\p{Extended_Pictographic}/u)?.[0] ?? null, `${lang}.${key}`).toBeNull();
      }
    }
  });
});

