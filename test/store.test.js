// Keeping accounts in `ft.records` (plan-plugins-nuevos §8): `split/<id>/meta` and
// `split/<id>/body` on every change, because the plugin is never told it is being closed; one
// save after another; and a full quota says so without losing what is on screen.
import { describe, expect, it } from "vitest";
import { Account, HALF, bodyKey, metaKey } from "../src/model.js";
import { Keeper } from "../src/store.js";
import { fakeCore } from "./fake-core.js";

const kept = (core, id) => Account.parse(id, core.records.get(bodyKey(id)), core.records.get(metaKey(id)));
const whats = (account) => account.entries().map((one) => one.what);
const spend = (account, what, amount = 1000) => account.add({ amount, what, iPaid: true, split: HALF });

describe("the keeper", () => {
  it("saves an account on every change, body and meta", async () => {
    const core = fakeCore();
    const keeper = new Keeper(core.ft.records);
    const account = new Account({ name: "Lisboa", currency: "EUR" });
    keeper.watch(account);
    spend(account, "Dinner");
    await keeper.settled();
    expect(whats(kept(core, account.id))).toEqual(["Dinner"]);
    expect(JSON.parse(core.records.get(metaKey(account.id)))).toMatchObject({ name: "Lisboa", currency: "EUR", count: 1, balance: 500 });
    expect(kept(core, account.id).who).toBe(account.who);
    for (let at = 0; at < 10; at += 1) spend(account, `item ${at}`);
    await keeper.settled();
    expect(kept(core, account.id).entries()).toHaveLength(11);
    expect(core.ft.records.set.mock.calls.length).toBeLessThan(2 * 11);
  });

  it("saves what came from the twin too, and stops when told to", async () => {
    const core = fakeCore();
    const keeper = new Keeper(core.ft.records);
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
    const keeper = new Keeper(core.ft.records);
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
    const keeper = new Keeper(core.ft.records);
    expect(await keeper.save(new Account({ name: "x", currency: "EUR" }))).toBe(false);
    expect(keeper.full).toBe(true);
  });

  it("lists what is kept, newest first, even when a meta is broken or missing, and forgets", async () => {
    const core = fakeCore();
    const keeper = new Keeper(core.ft.records);
    await keeper.save(new Account({ id: "a", name: "Old", currency: "EUR", updatedAt: 1 }));
    await keeper.save(new Account({ id: "b", name: "Recent", currency: "JPY" }));
    const orphan = new Account({ id: "c", name: "Orphan", currency: "KWD" });
    spend(orphan, "x");
    core.records.set(bodyKey("c"), orphan.body());
    core.records.set(metaKey("d"), "{broken");
    core.records.set("list/e/meta", JSON.stringify({ id: "e", name: "not ours" }));
    const index = await keeper.index();
    expect(index.map((one) => one.id)).toEqual(["c", "b", "a"]);
    expect(index.find((one) => one.id === "c")).toMatchObject({ name: "Orphan", currency: "KWD", count: 1 });
    expect((await keeper.load("b")).currency).toBe("JPY");
    expect(await keeper.load("nothing")).toBeNull();
    await keeper.forget("b");
    expect(core.records.has(bodyKey("b"))).toBe(false);
    expect(core.records.has(metaKey("b"))).toBe(false);
  });
});
