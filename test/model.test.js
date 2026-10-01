// An account as a document (plan-plugins-nuevos §8): one currency, expenses each in their own Yjs
// map (amount in minor units, what, who paid, split in half or all for the one who did not pay);
// the balance from each phone's side; the odd cent; settling up; deleting by marking `gone`; two
// copies edited apart that join; and the records it is kept in.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { ALL, Account, HALF, MAX_NAME, MAX_WHAT, PREFIX, SCHEMA, SETTLE, bodyKey, metaKey } from "../src/model.js";
import { parseAmount } from "../src/money.js";

/** Two phones' copies of one account, exchanging everything both ways. */
const exchange = (a, b) => {
  const fromA = Y.encodeStateAsUpdate(a.doc, Y.encodeStateVector(b.doc));
  const fromB = Y.encodeStateAsUpdate(b.doc, Y.encodeStateVector(a.doc));
  Y.applyUpdate(b.doc, fromA, "test");
  Y.applyUpdate(a.doc, fromB, "test");
};
/** The other phone's copy: same document, its own participant id. */
const otherPhone = (account) => Account.parse(account.id, account.body());

describe("an account", () => {
  it("has a name and one currency, and refuses a currency Intl does not know", () => {
    const account = new Account({ name: "  Lisboa  ", currency: "EUR" });
    expect(account.name).toBe("Lisboa");
    expect(account.currency).toBe("EUR");
    expect(account.ready).toBe(true);
    expect(account.doc.getMap("info").get("schema")).toBe(SCHEMA);
    expect(() => new Account({ name: "x", currency: "euro" })).toThrow(RangeError);
    expect(new Account({ name: "n".repeat(500), currency: "EUR" }).name).toHaveLength(MAX_NAME);
    expect(account.rename(" Oporto ")).toBe(true);
    expect(account.rename("  ")).toBe(false);
    expect(account.name).toBe("Oporto");
  });

  it("keeps each expense as its own map: amount in minor units, what, who paid, split, when", () => {
    const account = new Account({ name: "Lisboa", currency: "EUR" });
    const id = account.add({ amount: 1250, what: "  Dinner  ", iPaid: true, split: HALF, now: 1234 });
    const expense = account.doc.getMap("expenses").get(id);
    expect(expense).toBeInstanceOf(Y.Map);
    expect(expense.toJSON()).toEqual({ amount: 1250, what: "Dinner", paid: account.who, split: HALF, kind: "expense", at: 1234 });
    expect(account.entries()).toEqual([{ id, amount: 1250, what: "Dinner", mine: true, split: HALF, kind: "expense", at: 1234 }]);
    expect(account.add({ amount: 12.5, what: "x", iPaid: true, split: HALF })).toBeNull();
    expect(account.add({ amount: 0, what: "x", iPaid: true, split: HALF })).toBeNull();
    expect(account.add({ amount: -5, what: "x", iPaid: true, split: HALF })).toBeNull();
    expect(account.add({ amount: 100, what: "x", iPaid: true, split: "thirds" })).toBeNull();
    expect(account.add({ amount: 100, what: "w".repeat(500), iPaid: false, split: ALL })).not.toBeNull();
    expect(account.entries()[0].what).toHaveLength(MAX_WHAT);
  });

  it("lists the newest expense first", () => {
    const account = new Account({ name: "x", currency: "EUR" });
    account.add({ amount: 100, what: "old", iPaid: true, split: HALF, now: 1 });
    account.add({ amount: 100, what: "new", iPaid: true, split: HALF, now: 2 });
    expect(account.entries().map((one) => one.what)).toEqual(["new", "old"]);
  });
});

describe("the balance", () => {
  it("adds up: half of what one paid, or all of it, is owed by the other", () => {
    const account = new Account({ name: "Lisboa", currency: "EUR" });
    account.add({ amount: 3000, what: "Hotel", iPaid: true, split: HALF });
    expect(account.totals()).toEqual({ total: 3000, mine: 3000, theirs: 0, balance: 1500 });
    account.add({ amount: 1000, what: "Their ticket", iPaid: false, split: ALL });
    expect(account.totals()).toEqual({ total: 4000, mine: 3000, theirs: 1000, balance: 500 });
    account.add({ amount: 800, what: "My ticket", iPaid: false, split: ALL });
    // The other paid 8,00 that was all mine: now I owe 3,00.
    expect(account.totals()).toEqual({ total: 4800, mine: 3000, theirs: 1800, balance: -300 });
    account.add({ amount: 600, what: "Coffee", iPaid: true, split: HALF });
    expect(account.totals().balance).toBe(0);
  });

  it("lets the one who paid put the odd cent of a half", () => {
    const account = new Account({ name: "x", currency: "EUR" });
    account.add({ amount: 1001, what: "Lunch", iPaid: true, split: HALF });
    // 10,01 in half: I paid, so I put 5,01 and the other owes me 5,00.
    expect(account.totals().balance).toBe(500);
    account.add({ amount: 1, what: "Gum", iPaid: true, split: HALF });
    expect(account.totals().balance).toBe(500);
    account.add({ amount: 333, what: "Bread", iPaid: false, split: HALF });
    // The other paid 3,33: they put 1,67 and I owe 1,66.
    expect(account.totals().balance).toBe(500 - 166);
  });

  it("is the same with no decimals (JPY) and with three (KWD), always whole minor units", () => {
    const yen = new Account({ name: "Tokio", currency: "JPY" });
    yen.add({ amount: parseAmount("1001", "JPY"), what: "Ramen", iPaid: true, split: HALF });
    expect(yen.totals()).toEqual({ total: 1001, mine: 1001, theirs: 0, balance: 500 });
    const dinar = new Account({ name: "Kuwait", currency: "KWD" });
    dinar.add({ amount: parseAmount("1,001", "KWD"), what: "Tea", iPaid: false, split: HALF });
    expect(dinar.totals()).toEqual({ total: 1001, mine: 0, theirs: 1001, balance: -500 });
    for (const account of [yen, dinar]) for (const value of Object.values(account.totals())) expect(Number.isInteger(value)).toBe(true);
  });

  it("is told from each phone's side: what I paid on one phone the other person paid on the other", () => {
    const a = new Account({ name: "Lisboa", currency: "EUR" });
    // Written on A before B ever had the account: B's participant id is not known yet.
    a.add({ amount: 20000, what: "Flat", iPaid: true, split: HALF });
    a.add({ amount: 11240, what: "Car", iPaid: false, split: HALF });
    const b = otherPhone(a);
    expect(b.who).not.toBe(a.who);
    expect(a.totals()).toEqual({ total: 31240, mine: 20000, theirs: 11240, balance: 4380 });
    expect(b.totals()).toEqual({ total: 31240, mine: 11240, theirs: 20000, balance: -4380 });
    expect(b.entries().map((one) => [one.what, one.mine])).toEqual(a.entries().map((one) => [one.what, !one.mine]));
    // Written on B: still the right way round on A.
    b.add({ amount: 1000, what: "Museum", iPaid: true, split: ALL });
    exchange(a, b);
    expect(a.totals().balance).toBe(4380 - 1000);
    expect(b.totals().balance).toBe(-4380 + 1000);
    expect(a.entries().find((one) => one.what === "Museum").mine).toBe(false);
  });

  it("changes who paid, the split, the amount or what, from either phone", () => {
    const a = new Account({ name: "x", currency: "EUR" });
    const id = a.add({ amount: 1000, what: "Taxi", iPaid: true, split: HALF });
    const b = otherPhone(a);
    expect(b.edit(id, { iPaid: true })).toBe(true);
    exchange(a, b);
    expect(a.totals().balance).toBe(-500);
    expect(a.edit(id, { split: ALL, amount: 2000, what: "Taxis" })).toBe(true);
    exchange(a, b);
    expect(b.entries()[0]).toMatchObject({ amount: 2000, what: "Taxis", mine: true, split: ALL });
    expect(b.totals().balance).toBe(2000);
    expect(a.edit(id, { amount: 1.5 })).toBe(false);
    expect(a.edit(id, { what: "  " })).toBe(false);
    expect(a.edit("nobody", { amount: 1 })).toBe(false);
  });
});

describe("settling up", () => {
  it("records that the one who owes paid it all, so the balance is even; nothing when even", () => {
    const account = new Account({ name: "x", currency: "EUR" });
    expect(account.settle()).toBeNull();
    account.add({ amount: 2500, what: "Dinner", iPaid: true, split: HALF });
    const id = account.settle();
    expect(account.totals()).toEqual({ total: 2500, mine: 2500, theirs: 0, balance: 0 });
    const settlement = account.entries().find((one) => one.id === id);
    expect(settlement).toMatchObject({ kind: SETTLE, amount: 1250, mine: false, split: ALL });
    expect(account.settle()).toBeNull();
    // The other way round: I owe, I pay.
    account.add({ amount: 600, what: "Ice cream", iPaid: false, split: ALL });
    const again = account.settle();
    expect(account.entries().find((one) => one.id === again)).toMatchObject({ kind: SETTLE, amount: 600, mine: true });
    expect(account.totals().balance).toBe(0);
  });

  it("counts once when both phones settle the same balance while apart", () => {
    const a = new Account({ name: "x", currency: "EUR" });
    a.add({ amount: 2500, what: "Dinner", iPaid: true, split: HALF });
    const b = otherPhone(a);
    a.settle();
    b.settle();
    exchange(a, b);
    expect(a.entries().filter((one) => one.kind === SETTLE)).toHaveLength(1);
    expect(a.totals().balance).toBe(0);
    expect(b.totals().balance).toBe(0);
  });
});

describe("two copies edited apart", () => {
  it("join: what each added is in both", () => {
    const a = new Account({ name: "x", currency: "EUR" });
    a.add({ amount: 1000, what: "one", iPaid: true, split: HALF });
    const b = otherPhone(a);
    a.add({ amount: 400, what: "on a", iPaid: true, split: HALF });
    b.add({ amount: 600, what: "on b", iPaid: true, split: HALF });
    exchange(a, b);
    expect(a.entries().map((one) => one.what).sort()).toEqual(["on a", "on b", "one"]);
    expect(b.entries().map((one) => one.what).sort()).toEqual(["on a", "on b", "one"]);
    expect(a.totals().balance).toBe(500 + 200 - 300);
    expect(b.totals().balance).toBe(-a.totals().balance);
  });

  it("keep a deletion on one against an edit of the same expense on the other: deleted on both", () => {
    const a = new Account({ name: "x", currency: "EUR" });
    const id = a.add({ amount: 1000, what: "Taxi", iPaid: true, split: HALF });
    const b = otherPhone(a);
    expect(a.remove(id)).toBe(true);
    expect(b.edit(id, { amount: 3000, what: "Taxi and tip" })).toBe(true);
    exchange(a, b);
    expect(a.entries()).toEqual([]);
    expect(b.entries()).toEqual([]);
    expect(a.totals()).toEqual({ total: 0, mine: 0, theirs: 0, balance: 0 });
    expect(b.totals()).toEqual({ total: 0, mine: 0, theirs: 0, balance: 0 });
    // Marked gone, not removed: the map is still there.
    expect(a.doc.getMap("expenses").get(id).get("gone")).toBe(true);
    expect(a.remove(id)).toBe(false);
    expect(a.edit(id, { amount: 5 })).toBe(false);
  });

  it("keep two edits of different fields of the same expense", () => {
    const a = new Account({ name: "x", currency: "EUR" });
    const id = a.add({ amount: 1000, what: "Taxi", iPaid: true, split: HALF });
    const b = otherPhone(a);
    a.edit(id, { amount: 1200 });
    b.edit(id, { what: "Airport taxi" });
    exchange(a, b);
    expect(a.entries()[0]).toMatchObject({ amount: 1200, what: "Airport taxi" });
    expect(b.entries()[0]).toMatchObject({ amount: 1200, what: "Airport taxi" });
  });
});

describe("who is who", () => {
  it("is me, or the other person, or the nickname each one gives themselves", () => {
    const a = new Account({ name: "x", currency: "EUR" });
    const b = otherPhone(a);
    expect(a.nick).toBe("");
    expect(a.otherNick).toBe("");
    expect(a.setNick("  Ana  ")).toBe(true);
    b.setNick("Luis");
    exchange(a, b);
    expect(a.nick).toBe("Ana");
    expect(a.otherNick).toBe("Luis");
    expect(b.nick).toBe("Luis");
    expect(b.otherNick).toBe("Ana");
    a.setNick("");
    exchange(a, b);
    expect(b.otherNick).toBe("");
  });
});

describe("what came from elsewhere", () => {
  it("skips an expense that is not one, instead of counting it", () => {
    const account = new Account({ name: "x", currency: "EUR" });
    account.add({ amount: 1000, what: "good", iPaid: true, split: HALF });
    const expenses = account.doc.getMap("expenses");
    const bad = [
      { amount: 12.5, what: "float", paid: account.who, split: HALF },
      { amount: -100, what: "negative", paid: account.who, split: HALF },
      { amount: "100", what: "string", paid: account.who, split: HALF },
      { amount: 1e20, what: "huge", paid: account.who, split: HALF },
      { amount: 100, what: "split", paid: account.who, split: "thirds" },
      { amount: 100, what: "nobody", paid: 7, split: HALF },
    ];
    account.doc.transact(() => {
      bad.forEach((fields, at) => {
        const map = new Y.Map();
        expenses.set(`bad${at}`, map);
        for (const [key, value] of Object.entries(fields)) map.set(key, value);
      });
      expenses.set("plain", "not a map");
    });
    expect(account.entries().map((one) => one.what)).toEqual(["good"]);
    expect(account.totals().balance).toBe(500);
  });

  it("opens read only when it comes from a newer plugin, or its currency is not one", () => {
    const account = new Account({ name: "x", currency: "EUR" });
    account.doc.getMap("info").set("schema", SCHEMA + 1);
    expect(account.readOnly).toBe(true);
    expect(account.add({ amount: 100, what: "x", iPaid: true, split: HALF })).toBeNull();
    expect(account.rename("y")).toBe(false);
    expect(account.settle()).toBeNull();
    const odd = new Account({ name: "x", currency: "EUR" });
    odd.doc.getMap("info").set("currency", "nope");
    expect(odd.readOnly).toBe(true);
  });

  it("is not ready while a received account has no currency yet", () => {
    const received = Account.received("abc");
    expect(received.ready).toBe(false);
    expect(received.add({ amount: 100, what: "x", iPaid: true, split: HALF })).toBeNull();
  });
});

describe("the records", () => {
  it("are split/<id>/meta and split/<id>/body, and read back", () => {
    expect(PREFIX).toBe("split/");
    expect(metaKey("abc")).toBe("split/abc/meta");
    expect(bodyKey("abc")).toBe("split/abc/body");
    const account = new Account({ name: "Lisboa", currency: "EUR", peer: "p", shared: true });
    account.add({ amount: 2000, what: "Flat", iPaid: true, split: HALF });
    account.setNick("Ana");
    const back = Account.parse(account.id, account.body(), account.meta());
    expect(back.who).toBe(account.who);
    expect(back.peer).toBe("p");
    expect(back.shared).toBe(true);
    expect(back.entries()).toEqual(account.entries());
    expect(back.nick).toBe("Ana");
    expect(JSON.parse(account.meta())).toMatchObject({ id: account.id, name: "Lisboa", currency: "EUR", count: 1, balance: 1000, who: account.who, peer: "p", shared: true });
    expect(Account.parse("x", "not base64!")).toBeNull();
    expect(Account.parse("x", "")).toBeNull();
    // A broken meta: a new participant id, the document still there.
    const lost = Account.parse(account.id, account.body(), "{broken");
    expect(lost.entries()).toHaveLength(1);
    expect(lost.who).not.toBe(account.who);
  });
});
