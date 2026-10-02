// An account of Split (plan-plugins-nuevos §8): a Yjs document with one currency and a map of
// expenses, each expense its own map, so two phones editing different fields of one expense keep
// both. An expense has `amount` (whole minor units, `money.js`), `what`, `paid` (who paid),
// `split` (`half`, or `all` for the one who did not pay), `kind` (`expense`, or `settle` for
// "💸 Settle up") and `at`; deleting one marks it `gone`, so a deletion on one phone and an edit
// on the other leave it deleted on both.
//
// Who is who: the plugin knows no names. Each phone has its own participant id (`who`, random,
// kept in the meta record, never in the document). `paid` is the payer's `who`, or `!` and the
// `who` of the phone that wrote it when the payer was "the other person", whose id that phone may
// not know yet. So "I paid" on one phone reads "the other person paid" on the other, with no
// name and no account. Each one may give themselves a nickname, kept in `people` by `who`.

import * as Y from "yjs";
import { fromBase64, newWho, toBase64 } from "./live.js";
import { MAX_MINOR, isCurrency } from "./money.js";

/** Where the plugin keeps its accounts, one meta record and one body record each. */
export const PREFIX = "split/";
export const metaKey = (id) => `${PREFIX}${id}/meta`;
export const bodyKey = (id) => `${PREFIX}${id}/body`;

/** The shape of the document. An account with a higher schema came from a newer plugin: read only. */
export const SCHEMA = 1;
export const MAX_NAME = 60;
export const MAX_WHAT = 80;
export const MAX_NICK = 30;
/** The origin of what this phone does. */
export const LOCAL = "local";

/** Splits: in half (the one who paid puts the odd cent), or all of it for the one who did not pay. */
export const HALF = "half";
export const ALL = "all";
const SPLITS = new Set([HALF, ALL]);
/** Kinds of entry: an expense, or the payment that settles the balance. */
export const EXPENSE = "expense";
export const SETTLE = "settle";
const KINDS = new Set([EXPENSE, SETTLE]);

/** An id for an account or an expense: time first, so ids sort as things were made. */
export function newId(now = Date.now()) {
  const random = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0");
  return `${now.toString(36).padStart(9, "0")}${random}`;
}

const clean = (text, limit) => String(text ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const isAmount = (value) => Number.isSafeInteger(value) && value > 0 && value <= MAX_MINOR;

/** A short hash of a text (cyrb53): two phones settling the same balance write the same id. */
function hash(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let at = 0; at < text.length; at += 1) {
    const code = text.charCodeAt(at);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

export class Account {
  /**
   * A new account, or one whose document comes from elsewhere (`doc`): then nothing is written in
   * it, so an account received from the twin takes its name, currency and schema from the twin.
   * `who`, `peer` and `shared` belong to this phone only and live in the meta record.
   */
  constructor({ id = newId(), name = "", currency = "", doc = null, who = newWho(), peer = null, shared = false, updatedAt = Date.now() } = {}) {
    if (!doc && !isCurrency(currency)) throw new RangeError(`not a currency: ${currency}`);
    this.id = id;
    this.who = who;
    this.peer = peer;
    this.shared = shared;
    this.updatedAt = updatedAt;
    this.doc = doc ?? new Y.Doc();
    this.expenses = this.doc.getMap("expenses");
    this.info = this.doc.getMap("info");
    this.people = this.doc.getMap("people");
    if (!doc) {
      this.doc.transact(() => {
        this.info.set("schema", SCHEMA);
        this.info.set("name", clean(name, MAX_NAME));
        this.info.set("currency", currency);
      }, LOCAL);
    }
    this.doc.on("update", () => {
      this.updatedAt = Date.now();
    });
  }

  /** An account this phone does not have yet, to be filled by the twin. */
  static received(id) {
    return new Account({ id, doc: new Y.Doc() });
  }

  get name() {
    const name = this.info.get("name");
    return typeof name === "string" ? name : "";
  }

  get currency() {
    const currency = this.info.get("currency");
    return typeof currency === "string" ? currency : "";
  }

  /** Whether the account has its currency (one received from the twin gets it with the first sync). */
  get ready() {
    return isCurrency(this.currency);
  }

  get readOnly() {
    const schema = this.info.get("schema");
    if (typeof schema === "number" && schema > SCHEMA) return true;
    return this.info.has("currency") && !this.ready;
  }

  get writable() {
    return this.ready && !this.readOnly;
  }

  /** Hears every change of the document: `origin` says whose it was. */
  onChange(listener) {
    const heard = (_, origin) => listener(origin);
    this.doc.on("update", heard);
    return () => this.doc.off("update", heard);
  }

  rename(name) {
    const value = clean(name, MAX_NAME);
    if (!this.writable || !value) return false;
    if (value !== this.name) this.doc.transact(() => this.info.set("name", value), LOCAL);
    return true;
  }

  /** This phone's nickname, which the other phone shows instead of "the other person". */
  get nick() {
    const nick = this.people.get(this.who);
    return typeof nick === "string" ? nick : "";
  }

  get otherNick() {
    for (const [who, nick] of this.people.entries()) if (who !== this.who && typeof nick === "string" && nick) return nick;
    return "";
  }

  setNick(nick) {
    if (!this.writable) return false;
    const value = clean(nick, MAX_NICK);
    if (value !== this.nick) this.doc.transact(() => this.people.set(this.who, value), LOCAL);
    return true;
  }

  /** `paid` as written in the document, for "I paid" (`true`) or "the other person paid". */
  paidBy(iPaid) {
    return iPaid ? this.who : `!${this.who}`;
  }

  /** Whether `paid`, as written in the document, means this phone's person paid. */
  isMine(paid) {
    return paid.startsWith("!") ? paid.slice(1) !== this.who : paid === this.who;
  }

  /** Adds an expense; returns its id, or null when it is not one. */
  add({ amount, what, iPaid, split, now = Date.now() } = {}) {
    const value = clean(what, MAX_WHAT);
    if (!this.writable || !isAmount(amount) || !value || !SPLITS.has(split)) return null;
    const id = newId(now);
    this.write(id, { amount, what: value, paid: this.paidBy(Boolean(iPaid)), split, kind: EXPENSE, at: now });
    return id;
  }

  /** Writes a new entry, always after the latest one, so the order holds within one millisecond. */
  write(id, fields) {
    let latest = -Infinity;
    for (const entry of this.expenses.values()) {
      const at = entry instanceof Y.Map ? entry.get("at") : null;
      if (typeof at === "number" && at > latest) latest = at;
    }
    fields.at = Math.max(fields.at, latest + 1);
    this.doc.transact(() => {
      const entry = new Y.Map();
      this.expenses.set(id, entry);
      for (const [key, value] of Object.entries(fields)) entry.set(key, value);
    }, LOCAL);
  }

  /** The live (not deleted) map of an entry, or null. */
  entry(id) {
    const entry = this.expenses.get(id);
    return entry instanceof Y.Map && entry.get("gone") !== true ? entry : null;
  }

  /** Changes some of an expense's amount, what, who paid and split; false if any is not valid. */
  edit(id, { amount, what, iPaid, split } = {}) {
    const entry = this.entry(id);
    if (!this.writable || !entry || entry.get("kind") !== EXPENSE) return false;
    const changes = {};
    if (amount !== undefined) {
      if (!isAmount(amount)) return false;
      changes.amount = amount;
    }
    if (what !== undefined) {
      const value = clean(what, MAX_WHAT);
      if (!value) return false;
      changes.what = value;
    }
    if (split !== undefined) {
      if (!SPLITS.has(split)) return false;
      changes.split = split;
    }
    if (iPaid !== undefined) {
      const paid = entry.get("paid");
      if (typeof paid !== "string" || this.isMine(paid) !== Boolean(iPaid)) changes.paid = this.paidBy(Boolean(iPaid));
    }
    const changed = Object.entries(changes).filter(([key, value]) => entry.get(key) !== value);
    if (changed.length) this.doc.transact(() => changed.forEach(([key, value]) => entry.set(key, value)), LOCAL);
    return true;
  }

  /** Deletes an entry by marking it gone, so an edit made meanwhile on the other phone cannot bring it back. */
  remove(id) {
    const entry = this.entry(id);
    if (!this.writable || !entry) return false;
    this.doc.transact(() => entry.set("gone", true), LOCAL);
    return true;
  }

  /**
   * "💸 Settle up": the one who owes pays the balance. Two phones that settle the same balance
   * while apart write the same entry, so it counts once. Returns its id, or null when even.
   */
  settle({ now = Date.now() } = {}) {
    if (!this.writable) return null;
    const { balance } = this.totals();
    const amount = Math.abs(balance);
    if (!isAmount(amount)) return null;
    const covered = this.entries().map((one) => one.id).sort().join(",");
    const id = `s${hash(`${covered}|${amount}`)}`;
    // When the other person owes, they are the one who pays.
    this.write(id, { amount, what: "", paid: this.paidBy(balance < 0), split: ALL, kind: SETTLE, at: now });
    return id;
  }

  /** The entries, newest first, from this phone's side (`mine`: this phone's person paid). What is not an entry is skipped. */
  entries() {
    const all = [];
    for (const [id, entry] of this.expenses.entries()) {
      if (!(entry instanceof Y.Map) || entry.get("gone") === true) continue;
      const amount = entry.get("amount");
      const paid = entry.get("paid");
      const split = entry.get("split");
      const kind = entry.get("kind");
      if (!isAmount(amount) || typeof paid !== "string" || !paid || !SPLITS.has(split) || !KINDS.has(kind)) continue;
      const what = entry.get("what");
      const at = entry.get("at");
      all.push({ id, amount, what: typeof what === "string" ? what : "", mine: this.isMine(paid), split, kind, at: typeof at === "number" ? at : 0 });
    }
    return all.sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  /**
   * What was spent (`total`), what each paid (`mine`, `theirs`) — settlements are not spending —
   * and the `balance` from this phone's side: positive, the other person owes; negative, this
   * phone's person owes. In half, the one who did not pay owes the smaller half.
   */
  totals() {
    let total = 0;
    let mine = 0;
    let theirs = 0;
    let balance = 0;
    for (const one of this.entries()) {
      const owed = one.split === HALF ? Math.floor(one.amount / 2) : one.amount;
      balance += one.mine ? owed : -owed;
      if (one.kind !== EXPENSE) continue;
      total += one.amount;
      if (one.mine) mine += one.amount;
      else theirs += one.amount;
    }
    return { total, mine, theirs, balance };
  }

  /** The body record: the whole document as one Yjs update, in base64. */
  body() {
    return toBase64(Y.encodeStateAsUpdate(this.doc));
  }

  /** The meta record: what the list of accounts shows, and this phone's side of the live session. */
  meta() {
    const count = this.entries().filter((one) => one.kind === EXPENSE).length;
    const { balance } = this.totals();
    return JSON.stringify({ id: this.id, name: this.name, currency: this.currency, count, balance, updatedAt: this.updatedAt, who: this.who, peer: this.peer, shared: this.shared });
  }

  /** An account read back from its records; null when the body is not one. */
  static parse(id, body, meta = null) {
    if (typeof body !== "string" || !body) return null;
    const doc = new Y.Doc();
    try {
      const update = fromBase64(body);
      Y.decodeUpdate(update);
      Y.applyUpdate(doc, update, "load");
    } catch {
      return null;
    }
    let read = {};
    try {
      read = (typeof meta === "string" && JSON.parse(meta)) || {};
    } catch {
      read = {};
    }
    return new Account({
      id,
      doc,
      who: typeof read.who === "string" && read.who && read.who.length <= 64 ? read.who : newWho(),
      peer: typeof read.peer === "string" ? read.peer : null,
      shared: read.shared === true,
      updatedAt: typeof read.updatedAt === "number" ? read.updatedAt : Date.now(),
    });
  }
}
