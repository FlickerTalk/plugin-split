// Keeping accounts in `ft.records` (plan-plugins-nuevos §8): `split/<id>/meta` and
// `split/<id>/body` on every change, because the plugin is never told it is being closed; one
// save after another; and a full quota says so without losing what is on screen.
import { describe, expect, it } from "vitest";
import { Account, HALF, LOCAL_PLACE, bodyKey, metaKey } from "../src/model.js";
import { Keeper } from "../src/store.js";
import { fakeCore } from "./fake-core.js";

/** The place of the tests: a conversation's chat id, as the core gives it. */
const CHAT = "c".repeat(43);
const kept = (core, id, place = CHAT) => Account.parse(id, core.records.get(bodyKey(place, id)), core.records.get(metaKey(place, id)));
const whats = (account) => account.entries().map((one) => one.what);
const spend = (account, what, amount = 1000) => account.add({ amount, what, iPaid: true, split: HALF });

describe("the keeper", () => {
  it("saves an account on every change, body and meta", async () => {
    const core = fakeCore();
    const keeper = new Keeper(core.ft.records, CHAT);
    const account = new Account({ name: "Lisboa", currency: "EUR" });
    keeper.watch(account);
    spend(account, "Dinner");
    await keeper.settled();
    expect(whats(kept(core, account.id))).toEqual(["Dinner"]);
    expect(JSON.parse(core.records.get(metaKey(CHAT, account.id)))).toMatchObject({ name: "Lisboa", currency: "EUR", count: 1, balance: 500 });
    expect(kept(core, account.id).who).toBe(account.who);
    for (let at = 0; at < 10; at += 1) spend(account, `item ${at}`);
    await keeper.settled();
    expect(kept(core, account.id).entries()).toHaveLength(11);
    expect(core.ft.records.set.mock.calls.length).toBeLessThan(2 * 11);
  });

  it("saves what came from the twin too, and stops when told to", async () => {
    const core = fakeCore();
    const keeper = new Keeper(core.ft.records, CHAT);
    const account = new Account({ name: "x", currency: "EUR" });
    const stop = keeper.watch(account);
    const other = Account.parse(account.id, account.body());
    spend(other, "from the other phone");
    const { encodeStateAsUpdate, applyUpdate } = await import("yjs");
    applyUpdate(account.doc, encodeStateAsUpdate(other.doc), "live");
    await keeper.settled();
    expect(whats(kept(core, account.id))).toEqual(["from the other phone"]);
    stop();
    spend(account, "not saved");
    await keeper.settled();
    expect(whats(kept(core, account.id))).toEqual(["from the other phone"]);
  });

  it("says when the quota is full, keeps the account on screen, and recovers when there is room", async () => {
    const core = fakeCore({ quota: 900 });
    const keeper = new Keeper(core.ft.records, CHAT);
    const states = [];
    keeper.onFull((full) => states.push(full));
    const account = new Account({ name: "Lisboa", currency: "EUR" });
    keeper.watch(account);
    spend(account, "Dinner");
    await keeper.settled();
    expect(keeper.full).toBe(false);
    for (let at = 0; at < 20; at += 1) spend(account, `a long expense to fill the quota number ${at}`);
    await keeper.settled();
    expect(keeper.full).toBe(true);
    expect(states).toEqual([true]);
    expect(account.entries()).toHaveLength(21);
    expect(kept(core, account.id)).not.toBeNull();
    core.quota = 1_000_000;
    spend(account, "room again");
    await keeper.settled();
    expect(keeper.full).toBe(false);
    expect(states).toEqual([true, false]);
    expect(kept(core, account.id).entries()).toHaveLength(22);
  });

  it("treats a core that fails as full, not as saved", async () => {
    const core = fakeCore();
    core.ft.records.set = async () => {
      throw new Error("gone");
    };
    const keeper = new Keeper(core.ft.records, CHAT);
    expect(await keeper.save(new Account({ name: "x", currency: "EUR" }))).toBe(false);
    expect(keeper.full).toBe(true);
  });

  it("lists what is kept, newest first, even when a meta is broken or missing, and forgets", async () => {
    const core = fakeCore();
    const keeper = new Keeper(core.ft.records, CHAT);
    await keeper.save(new Account({ id: "a", name: "Old", currency: "EUR", updatedAt: 1 }));
    await keeper.save(new Account({ id: "b", name: "Recent", currency: "JPY" }));
    const orphan = new Account({ id: "c", name: "Orphan", currency: "KWD" });
    spend(orphan, "x");
    core.records.set(bodyKey(CHAT, "c"), orphan.body());
    core.records.set(metaKey(CHAT, "d"), "{broken");
    core.records.set("list/e/meta", JSON.stringify({ id: "e", name: "not ours" }));
    core.records.set(metaKey(LOCAL_PLACE, "f"), new Account({ id: "f", name: "another place", currency: "EUR" }).meta());
    const index = await keeper.index();
    expect(index.map((one) => one.id)).toEqual(["c", "b", "a"]);
    expect(index.find((one) => one.id === "c")).toMatchObject({ name: "Orphan", currency: "KWD", count: 1 });
    expect((await keeper.load("b")).currency).toBe("JPY");
    expect(await keeper.load("nothing")).toBeNull();
    await keeper.forget("b");
    expect(core.records.has(bodyKey(CHAT, "b"))).toBe(false);
    expect(core.records.has(metaKey(CHAT, "b"))).toBe(false);
  });

  it("lists, loads, saves and forgets only within its own place: the same id in two places never mixes", async () => {
    const core = fakeCore();
    const other = "d".repeat(43);
    const here = new Keeper(core.ft.records, CHAT);
    const there = new Keeper(core.ft.records, other);
    const local = new Keeper(core.ft.records, LOCAL_PLACE);
    const mine = new Account({ id: "same", name: "Here", currency: "EUR" });
    spend(mine, "here only");
    await here.save(mine);
    expect([...core.records.keys()].sort()).toEqual([`split/${CHAT}/same/body`, `split/${CHAT}/same/meta`]);
    expect(await there.index()).toEqual([]);
    expect(await local.index()).toEqual([]);
    expect(await there.load("same")).toBeNull();
    expect(await local.load("same")).toBeNull();
    // The same id in another place is another account.
    const theirs = new Account({ id: "same", name: "There", currency: "JPY" });
    await there.save(theirs);
    expect((await here.load("same")).name).toBe("Here");
    expect(whats(await here.load("same"))).toEqual(["here only"]);
    expect((await there.load("same")).currency).toBe("JPY");
    expect((await here.index()).map((one) => one.name)).toEqual(["Here"]);
    await there.forget("same");
    expect(await there.load("same")).toBeNull();
    expect((await here.load("same")).name).toBe("Here");
  });
});
