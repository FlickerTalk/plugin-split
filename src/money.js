// Money in Split (plan-plugins-nuevos §8): an amount is a whole number of its currency's minor
// unit (cents, fils…), never a floating-point number, so sums and halves are exact. How many
// decimals a currency has comes from `Intl` (JPY none, EUR two, KWD three); what is shown goes
// through `Intl` in the phone's language. For two people and one currency per account this is all
// it takes: no money library (dinero.js, currency.js) is needed.

/**
 * The largest amount Split takes, in minor units. Sums of thousands of such amounts, even in a
 * currency with four decimals, stay safe whole numbers.
 */
export const MAX_MINOR = 100_000_000_000;

const CODE = /^[A-Z]{3}$/;
const digitCache = new Map();

/** Whether `code` is a currency code Intl knows (ISO 4217, upper case). */
export function isCurrency(code) {
  if (typeof code !== "string" || !CODE.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

/** How many decimals a currency has, as Intl says. */
export function digitsOf(currency) {
  if (!digitCache.has(currency)) {
    const { maximumFractionDigits } = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions();
    digitCache.set(currency, maximumFractionDigits);
  }
  return digitCache.get(currency);
}

/** The currencies to choose from: Intl's own list. */
export function currencies() {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : ["EUR", "USD", "GBP", "JPY"];
}

const SPACES = /[\s   ]/g;

/**
 * An amount typed by hand, in minor units; null when it is not one. A single mark (`,` or `.`)
 * is the decimal one, except in a currency with no decimals, where a mark before three digits
 * groups thousands. With both marks, the last one is the decimal one. Never more decimals than
 * the currency has: nothing is rounded behind the user's back.
 */
export function parseAmount(text, currency) {
  if (typeof text !== "string" || !isCurrency(currency)) return null;
  const digits = digitsOf(currency);
  const raw = text.replace(SPACES, "");
  if (!/^[0-9.,]+$/.test(raw) || !/[0-9]/.test(raw)) return null;
  const marks = [...raw.matchAll(/[.,]/g)];
  let whole = raw;
  let fraction = "";
  if (marks.length) {
    const last = marks.at(-1);
    let decimalAt = -1;
    if (new Set(marks.map((mark) => mark[0])).size === 2) {
      if (marks.filter((mark) => mark[0] === last[0]).length !== 1) return null;
      decimalAt = last.index;
    } else if (marks.length === 1) {
      const groupsThousands = digits === 0 && last.index > 0 && raw.length - last.index - 1 === 3;
      decimalAt = groupsThousands ? -1 : last.index;
    }
    if (decimalAt >= 0) {
      whole = raw.slice(0, decimalAt);
      fraction = raw.slice(decimalAt + 1);
    }
    const groups = whole.split(/[.,]/);
    if (groups.length > 1 && (groups[0].length < 1 || groups[0].length > 3 || groups.slice(1).some((group) => group.length !== 3))) return null;
    whole = groups.join("");
  }
  if (fraction.length > digits || whole.length > 15) return null;
  const minor = Number(whole || "0") * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(minor) && minor > 0 && minor <= MAX_MINOR ? minor : null;
}

/** Minor units as an exact decimal string (`1250` EUR → `"12.50"`). */
export function toDecimal(minor, currency) {
  const digits = digitsOf(currency);
  const sign = minor < 0 ? "-" : "";
  const plain = String(Math.abs(minor)).padStart(digits + 1, "0");
  return digits ? `${sign}${plain.slice(0, -digits)}.${plain.slice(-digits)}` : `${sign}${plain}`;
}

/** An amount as the phone's language writes it, through Intl (English if Intl refuses the tag). */
export function formatMoney(minor, currency, lang) {
  const decimal = toDecimal(minor, currency);
  let format;
  try {
    format = new Intl.NumberFormat(lang, { style: "currency", currency });
  } catch {
    format = new Intl.NumberFormat("en", { style: "currency", currency });
  }
  // A string keeps the amount exact where Intl reads decimals; elsewhere it is read as a number.
  return format.format(decimal);
}
