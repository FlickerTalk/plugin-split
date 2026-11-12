// Amounts are whole minor units (cents, fils…), never floats.

// sums of thousands of these, even with four decimals, stay safe integers
export const MAX_MINOR = 100_000_000_000;

const CODE = /^[A-Z]{3}$/;
const digitCache = new Map();

export function isCurrency(code) {
  if (typeof code !== "string" || !CODE.test(code)) return false;
  try {
    new Intl.NumberFormat("en", { style: "currency", currency: code });
    return true;
  } catch {
    return false;
  }
}

export function digitsOf(currency) {
  if (!digitCache.has(currency)) {
    const { maximumFractionDigits } = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions();
    digitCache.set(currency, maximumFractionDigits);
  }
  return digitCache.get(currency);
}

export function currencies() {
  return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : ["EUR", "USD", "GBP", "JPY"];
}

const SPACES = /[\s   ]/g;

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

export function toDecimal(minor, currency) {
  const digits = digitsOf(currency);
  const sign = minor < 0 ? "-" : "";
  const plain = String(Math.abs(minor)).padStart(digits + 1, "0");
  return digits ? `${sign}${plain.slice(0, -digits)}.${plain.slice(-digits)}` : `${sign}${plain}`;
}

export function formatMoney(minor, currency, lang) {
  const decimal = toDecimal(minor, currency);
  let format;
  try {
    format = new Intl.NumberFormat(lang, { style: "currency", currency });
  } catch {
    format = new Intl.NumberFormat("en", { style: "currency", currency });
  }
  // a string stays exact where Intl reads decimal strings, elsewhere it's read as a number
  return format.format(decimal);
}
