// Money as Split keeps it (plan-plugins-nuevos §8): whole numbers of a currency's minor unit, never
// floating point; how many decimals a currency has comes from `Intl`, so JPY has none and KWD
// three; an amount may be typed with a decimal comma or a decimal point; and it is shown through
// `Intl` in the phone's language.
import { describe, expect, it } from "vitest";
import { MAX_MINOR, currencies, digitsOf, formatMoney, isCurrency, parseAmount, toDecimal } from "../src/money.js";

const nbsp = (text) => text.replace(/[  ]/g, " ");

describe("a currency", () => {
  it("has the decimals Intl gives it: two for EUR, none for JPY, three for KWD", () => {
    expect(digitsOf("EUR")).toBe(2);
    expect(digitsOf("USD")).toBe(2);
    expect(digitsOf("JPY")).toBe(0);
    expect(digitsOf("KWD")).toBe(3);
  });

  it("is a code Intl knows, and the list to choose from is Intl's", () => {
    expect(isCurrency("EUR")).toBe(true);
    expect(isCurrency("eur")).toBe(false);
    expect(isCurrency("EURO")).toBe(false);
    expect(isCurrency("")).toBe(false);
    expect(isCurrency(null)).toBe(false);
    expect(currencies()).toEqual(Intl.supportedValuesOf("currency"));
    expect(currencies()).toContain("JPY");
  });
});

describe("an amount typed by hand", () => {
  it("takes a decimal comma or a decimal point and becomes whole minor units", () => {
    expect(parseAmount("12,50", "EUR")).toBe(1250);
    expect(parseAmount("12.50", "EUR")).toBe(1250);
    expect(parseAmount("12.5", "EUR")).toBe(1250);
    expect(parseAmount("12", "EUR")).toBe(1200);
    expect(parseAmount(" 0,07 ", "EUR")).toBe(7);
    expect(parseAmount(",5", "EUR")).toBe(50);
    expect(parseAmount("12,", "EUR")).toBe(1200);
  });

  it("never goes through floating point: 0.1 + 0.2 style amounts are exact", () => {
    expect(parseAmount("0,29", "EUR")).toBe(29);
    expect(parseAmount("1.005", "KWD")).toBe(1005);
    expect(parseAmount("4.35", "USD")).toBe(435);
    expect(parseAmount("9007199254.74", "USD")).toBeNull();
  });

  it("reads thousands separators when both marks are used, the last one being the decimal one", () => {
    expect(parseAmount("1.234,56", "EUR")).toBe(123456);
    expect(parseAmount("1,234.56", "USD")).toBe(123456);
    expect(parseAmount("1 234,56", "EUR")).toBe(123456);
    expect(parseAmount("1 234,56", "EUR")).toBe(123456);
    expect(parseAmount("1.234.567", "EUR")).toBe(123456700);
  });

  it("follows each currency's decimals: none for JPY, three for KWD", () => {
    expect(parseAmount("1500", "JPY")).toBe(1500);
    expect(parseAmount("1.500", "JPY")).toBe(1500);
    expect(parseAmount("1,500", "JPY")).toBe(1500);
    expect(parseAmount("15,5", "JPY")).toBeNull();
    expect(parseAmount("1,250", "KWD")).toBe(1250);
    expect(parseAmount("1.25", "KWD")).toBe(1250);
    expect(parseAmount("1,2345", "KWD")).toBeNull();
  });

  it("refuses what is not an amount instead of guessing", () => {
    for (const text of ["", "  ", "abc", "12,505", "-5", "+5", "1e3", "0", "0,00", "12..5", "1,2,3.4.5", "€12", "Infinity", null, undefined]) {
      expect(parseAmount(text, "EUR"), String(text)).toBeNull();
    }
    expect(parseAmount("1", "nope")).toBeNull();
    expect(parseAmount("9".repeat(20), "EUR")).toBeNull();
  });

  it("has a ceiling that keeps every sum a safe whole number", () => {
    expect(MAX_MINOR * 10_000).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    expect(parseAmount(String(MAX_MINOR / 100), "EUR")).toBe(MAX_MINOR);
    expect(parseAmount(String(MAX_MINOR / 100 + 1), "EUR")).toBeNull();
  });
});

describe("an amount shown", () => {
  it("is written as an exact decimal from its minor units", () => {
    expect(toDecimal(1250, "EUR")).toBe("12.50");
    expect(toDecimal(7, "EUR")).toBe("0.07");
    expect(toDecimal(-4380, "EUR")).toBe("-43.80");
    expect(toDecimal(1500, "JPY")).toBe("1500");
    expect(toDecimal(1005, "KWD")).toBe("1.005");
  });

  it("goes through Intl in the phone's language", () => {
    expect(nbsp(formatMoney(31240, "EUR", "es"))).toBe("312,40 €");
    expect(nbsp(formatMoney(31240, "EUR", "en"))).toBe("€312.40");
    expect(nbsp(formatMoney(1500, "JPY", "en"))).toBe("¥1,500");
    expect(formatMoney(1005, "KWD", "en")).toContain("1.005");
    expect(formatMoney(1250, "EUR", "ar")).toBe(new Intl.NumberFormat("ar", { style: "currency", currency: "EUR" }).format(12.5));
  });

  it("falls back to English for a language Intl does not take", () => {
    expect(nbsp(formatMoney(1250, "EUR", "not a tag!"))).toBe("€12.50");
  });
});
