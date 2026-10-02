// The plugin as the user sees it (plan-plugins-nuevos §8), against the fake core: accounts with one
// currency; expenses typed with a decimal comma or point; the balance; settling up; 📤 written from
// the side of whoever sends it, in their language; the 21 languages; and two phones in one
// conversation going live, losing each other and meeting again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMAT } from "./src/index.js";
import { HELLO, UPDATE, VERSION, decode, encode } from "./src/live.js";
import { Account, bodyKey, metaKey } from "./src/model.js";
import { connect, fakeCore } from "./test/fake-core.js";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "module.json"), "utf8"));

/** Intl puts a no-break space between number and symbol in some languages: compare as spaces. */
const plain = (text) => String(text).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

const flush = async () => {
  for (let at = 0; at < 60; at += 1) await Promise.resolve();
};

/** One phone with the plugin open: `live` when opened from a conversation with it granted. */
async function phone(core, opening = { live: true }) {
  globalThis.ft = core.ft;
  const element = document.createElement("ft-split");
  document.body.append(element);
  await core.open(opening);
  await flush();
  return element;
}

const inside = (element) => element.shadowRoot;
const settle = async (...elements) => {
  await flush();
  for (const element of elements) await element.keeper.settled();
  await flush();
};
async function press(element, act, extra = "") {
  const button = inside(element).querySelector(`[data-act="${act}"]${extra}`);
  if (!button) throw new Error(`no button ${act}${extra}`);
  button.click();
  await settle(element);
}
/** Fills a form's fields by name and submits it. */
async function fill(element, form, values) {
  const node = inside(element).querySelector(`form[data-form="${form}"]`);
  if (!node) throw new Error(`no form ${form}`);
  for (const [name, value] of Object.entries(typeof values === "string" ? { value: values } : values)) {
    const field = node.querySelector(`[name="${name}"]`);
    if (!field) throw new Error(`no field ${name} in ${form}`);
    field.value = value;
  }
  node.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await settle(element);
}
const choose = (element, scope, field, value) => press(element, "choose", `[data-scope="${scope}"][data-field="${field}"][data-value="${value}"]`);
/** Adds an expense through the form: who paid (`me` or `other`) and the split (`half` or `all`). */
async function spend(element, amount, what, paid = "me", split = "half") {
  await choose(element, "add", "paid", paid);
  await choose(element, "add", "split", split);
  await fill(element, "add", { amount, what });
}
const rows = (element) => [...inside(element).querySelectorAll("[data-entry]")].map((row) => plain(`${row.querySelector(".what").textContent} ${row.querySelector(".amount").textContent} | ${row.querySelector(".who").textContent}`));
const balanceOf = (element) => plain(inside(element).querySelector("[data-balance]")?.textContent ?? "");
const statusOf = (element) => inside(element).querySelector("[data-status]")?.textContent ?? "";
const entryId = (element, what) => [...inside(element).querySelectorAll("[data-entry]")].find((row) => row.querySelector(".what").textContent === what)?.dataset.entry;
async function newAccount(element, name, currency = "EUR") {
  await fill(element, "new", { value: name, currency });
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("the manifest", () => {
  it("asks for live and to propose a text, nothing more, on core 1.1.0", () => {
    expect(manifest).toEqual({
      id: "com.flickertalk.split",
      name: "Split",
      version: "1.0.0",
      minCoreVersion: "1.1.0",
      components: ["ft-split"],
      permissions: { live: true, send: "propose" },
      summary: expect.any(String),
    });
    expect(manifest.summary.length).toBeLessThanOrEqual(200);
    expect(FORMAT).toBe("ftsplit");
  });
});

describe("one phone", () => {
  it("makes an account in a currency, adds expenses typed with a comma or a point, and keeps them", async () => {
    const core = fakeCore();
    const element = await phone(core, { live: false });
    expect(inside(element).textContent).toContain("No accounts yet");
    expect(inside(element).textContent).toContain("For two people");
    const currencies = [...inside(element).querySelectorAll('form[data-form="new"] select[name="currency"] option')].map((one) => one.value);
    expect(currencies).toEqual(Intl.supportedValuesOf("currency"));
    await newAccount(element, "Lisboa");
    expect(inside(element).querySelector("[data-name]").textContent).toBe("Lisboa");
    expect(balanceOf(element)).toBe("All square ✅");

    await spend(element, "12,50", "Dinner", "me", "half");
    expect(balanceOf(element)).toBe("Owes you €6.25");
    await spend(element, "8.40", "Museum", "other", "all");
    expect(rows(element)).toEqual(["Museum €8.40 | The other person paid · All for me", "Dinner €12.50 | I paid · ½ Half each"]);
    expect(balanceOf(element)).toBe("You owe €2.15");
    const id = element.account.id;
    const kept = Account.parse(id, core.records.get(bodyKey(id)), core.records.get(metaKey(id)));
    expect(kept.totals()).toEqual({ total: 2090, mine: 1250, theirs: 840, balance: -215 });
    expect(kept.currency).toBe("EUR");

    // Edit, then remove.
    await press(element, "edit", `[data-id="${entryId(element, "Museum")}"]`);
    await choose(element, "edit", "split", "half");
    await fill(element, "edit", { amount: "9", what: "Museum tickets" });
    expect(rows(element)[0]).toBe("Museum tickets €9.00 | The other person paid · ½ Half each");
    expect(balanceOf(element)).toBe("Owes you €1.75");
    await press(element, "edit", `[data-id="${entryId(element, "Museum tickets")}"]`);
    await press(element, "remove");
    expect(rows(element)).toEqual(["Dinner €12.50 | I paid · ½ Half each"]);
    expect(Account.parse(id, core.records.get(bodyKey(id))).entries()).toHaveLength(1);

    await press(element, "back");
    expect(plain(inside(element).querySelector("[data-act=open]").textContent)).toContain("Owes you €6.25");
  });

  it("refuses an amount it cannot read exactly, and says how to write one", async () => {
    const element = await phone(fakeCore(), { live: false });
    await newAccount(element, "Lisboa");
    for (const amount of ["12,505", "abc", "-3", "0"]) {
      await fill(element, "add", { amount, what: "Dinner" });
      expect(rows(element)).toEqual([]);
      expect(plain(inside(element).querySelector("[data-error]").textContent)).toContain("Write an amount like 12.50");
    }
    await fill(element, "add", { amount: "12,50", what: "" });
    expect(rows(element)).toEqual([]);
    await fill(element, "add", { amount: "12,50", what: "Dinner" });
    expect(rows(element)).toHaveLength(1);
    expect(inside(element).querySelector("[data-error]").textContent).toBe("");
  });

  it("takes each currency's decimals: yen with none, dinar with three", async () => {
    const element = await phone(fakeCore(), { live: false });
    await newAccount(element, "Tokio", "JPY");
    await spend(element, "15,5", "Sushi");
    expect(rows(element)).toEqual([]);
    expect(plain(inside(element).querySelector("[data-error]").textContent)).toContain("Write an amount like 1250");
    await spend(element, "1.500", "Sushi");
    await spend(element, "1001", "Ramen");
    expect(rows(element)).toEqual(["Ramen ¥1,001 | I paid · ½ Half each", "Sushi ¥1,500 | I paid · ½ Half each"]);
    expect(balanceOf(element)).toBe("Owes you ¥1,250");
    await press(element, "back");
    await newAccount(element, "Kuwait", "KWD");
    await spend(element, "1,001", "Tea", "other");
    expect(balanceOf(element)).toBe(plain(`You owe ${new Intl.NumberFormat("en", { style: "currency", currency: "KWD" }).format(0.5)}`));
    expect(balanceOf(element)).toContain("0.500");
  });

  it("settles up after asking inside the plugin, never with confirm()", async () => {
    globalThis.confirm = vi.fn(() => true);
    const element = await phone(fakeCore(), { live: false });
    await newAccount(element, "Lisboa");
    expect(inside(element).querySelector('[data-act="settle"]')).toBeNull();
    await spend(element, "25", "Dinner");
    await press(element, "settle");
    expect(plain(inside(element).textContent)).toContain("Record that the other person paid you €12.50?");
    await press(element, "cancelSettle");
    expect(balanceOf(element)).toBe("Owes you €12.50");
    await press(element, "settle");
    await press(element, "confirmSettle");
    expect(balanceOf(element)).toBe("All square ✅");
    expect(rows(element)[0]).toBe("💸 Settled up €12.50 | The other person paid");
    expect(inside(element).querySelector('[data-act="settle"]')).toBeNull();
    expect(globalThis.confirm).not.toHaveBeenCalled();
    delete globalThis.confirm;
  });

  it("asks inside the plugin before deleting an account", async () => {
    const core = fakeCore();
    const element = await phone(core, { live: false });
    await newAccount(element, "Lisboa");
    await press(element, "back");
    await press(element, "delete");
    expect(inside(element).textContent).toContain("Delete “Lisboa” from this phone?");
    await press(element, "cancelDelete");
    expect(core.records.size).toBe(2);
    await press(element, "delete");
    await press(element, "confirmDelete");
    expect(core.records.size).toBe(0);
    expect(inside(element).textContent).toContain("No accounts yet");
  });

  it("proposes the summary in the chat, written from the sender's side and in their language", async () => {
    const core = fakeCore({ lang: "es" });
    const element = await phone(core, { live: false });
    await newAccount(element, "Lisboa");
    await spend(element, "200", "Piso", "me", "half");
    await spend(element, "112,40", "Coche", "other", "half");
    await press(element, "send");
    expect(core.said.map(plain)).toEqual(["🧾 Lisboa · total 312,40 € · yo pagué 200,00 € · tú 112,40 € · me debes 43,80 €"]);
  });

  it("speaks the phone's language, right to left in Arabic", async () => {
    const element = await phone(fakeCore({ lang: "es" }), { live: false });
    expect(inside(element).textContent).toContain("Todavía no hay cuentas");
    const arabic = await phone(fakeCore({ lang: "ar" }), { live: false });
    expect(arabic.getAttribute("dir")).toBe("rtl");
    expect(arabic.getAttribute("lang")).toBe("ar");
    expect(element.getAttribute("dir")).toBe("ltr");
  });

  it("offers live only from a conversation, and says so otherwise", async () => {
    const element = await phone(fakeCore(), { live: false });
    await newAccount(element, "Lisboa");
    expect(inside(element).querySelector('[data-act="live"]')).toBeNull();
    expect(inside(element).textContent).toContain("To share it, open Split from a conversation");
    const inChat = await phone(fakeCore(), { live: true });
    await newAccount(inChat, "Lisboa");
    expect(inside(inChat).querySelector('[data-act="live"]')).not.toBeNull();
    expect(inside(inChat).textContent).toContain("only while you both have this account open in this conversation");
    expect(inside(inChat).textContent).toContain("For two people");
  });

  it("never speaks on its own when opened, nor when an account that was never shared is entered", async () => {
    const core = fakeCore();
    const element = await phone(core);
    await newAccount(element, "Lisboa");
    await spend(element, "10", "Dinner");
    await press(element, "back");
    await press(element, "open");
    expect(core.sent).toHaveLength(0);
  });

  it("says when the phone has no room left, and keeps the account on screen", async () => {
    const core = fakeCore({ quota: 900 });
    const element = await phone(core, { live: false });
    await newAccount(element, "Lisboa");
    for (let at = 0; at < 12; at += 1) await spend(element, "1", `something long enough to fill the room ${at}`);
    expect(rows(element)).toHaveLength(12);
    expect(inside(element).querySelector("[data-warning]").textContent).toContain("No room left on this phone");
    core.quota = 1_000_000;
    await spend(element, "1", "fits now");
    expect(inside(element).querySelector("[data-warning]").textContent).toBe("");
  });
});

/** Two phones in one conversation, both with Split open. */
async function twoPhones({ langA = "en", langB = "en" } = {}) {
  const coreA = fakeCore({ lang: langA });
  const coreB = fakeCore({ lang: langB });
  const link = connect(coreA, coreB);
  const a = await phone(coreA);
  const b = await phone(coreB);
  const idle = async () => {
    await link.idle();
    await settle(a, b);
  };
  return { coreA, coreB, link, a, b, idle };
}

describe("two phones", () => {
  it("go live: the other phone opens the account by itself, and sees each expense from its own side", async () => {
    const { coreB, a, b, idle } = await twoPhones();
    await newAccount(a, "Lisboa");
    await spend(a, "30", "Hotel", "me", "half");
    await press(a, "live");
    await idle();
    expect(b.account?.id).toBe(a.account.id);
    expect(inside(b).querySelector("[data-name]").textContent).toBe("Lisboa");
    expect(rows(b)).toEqual(["Hotel €30.00 | The other person paid · ½ Half each"]);
    expect(balanceOf(a)).toBe("Owes you €15.00");
    expect(balanceOf(b)).toBe("You owe €15.00");
    expect(statusOf(a)).toContain("Live");
    expect(statusOf(b)).toContain("Live");

    await spend(b, "10", "Taxi", "me", "all");
    await idle();
    expect(rows(a)[0]).toBe("Taxi €10.00 | The other person paid · All for me");
    expect(balanceOf(a)).toBe("Owes you €5.00");
    expect(balanceOf(b)).toBe("You owe €5.00");
    const kept = Account.parse(b.account.id, coreB.records.get(bodyKey(b.account.id)), coreB.records.get(metaKey(b.account.id)));
    expect(kept.totals().balance).toBe(-500);
    expect(JSON.parse(coreB.records.get(metaKey(b.account.id)))).toMatchObject({ shared: true, currency: "EUR" });
  });

  it("each propose the summary from their own side, in their own language", async () => {
    const { coreA, coreB, a, b, idle } = await twoPhones({ langA: "es", langB: "en" });
    await newAccount(a, "Lisboa");
    await press(a, "live");
    await idle();
    await spend(a, "200", "Piso", "me", "half");
    await spend(b, "112.40", "Car", "me", "half");
    await idle();
    await press(a, "send");
    await press(b, "send");
    expect(coreA.said.map(plain)).toEqual(["🧾 Lisboa · total 312,40 € · yo pagué 200,00 € · tú 112,40 € · me debes 43,80 €"]);
    expect(coreB.said.map(plain)).toEqual(["🧾 Lisboa · total €312.40 · I paid €112.40 · you €200.00 · I owe you €43.80"]);
  });

  it("show the nickname each one gives themselves instead of “the other person”", async () => {
    const { a, b, idle } = await twoPhones();
    await newAccount(a, "Lisboa");
    await press(a, "live");
    await idle();
    await fill(a, "nick", "Ana");
    await spend(a, "10", "Coffee");
    await idle();
    expect(rows(b)).toEqual(["Coffee €10.00 | Ana paid · ½ Half each"]);
    expect(inside(b).querySelector('form[data-form="nick"] input').value).toBe("");
  });

  it("keep what each did offline and join it when one goes live again", async () => {
    const { a, b, link, idle } = await twoPhones();
    await newAccount(a, "Lisboa");
    await spend(a, "10", "Before");
    await press(a, "live");
    await idle();
    link.down();
    await spend(a, "4", "Offline on a");
    await spend(b, "6", "Offline on b");
    await idle();
    expect(statusOf(a)).toContain("can't be reached");
    expect(statusOf(b)).toContain("can't be reached");
    expect(statusOf(a)).toContain("Your changes stay on this phone");
    link.up();
    await press(a, "live");
    await idle();
    const whats = (element) => rows(element).map((row) => row.split(" €")[0]).sort();
    expect(whats(a)).toEqual(["Before", "Offline on a", "Offline on b"]);
    expect(whats(b)).toEqual(whats(a));
    expect(balanceOf(a)).toBe("Owes you €4.00");
    expect(balanceOf(b)).toBe("You owe €4.00");
    expect(statusOf(a)).toContain("Live");
  });

  it("keep a deletion on one phone against an edit of the same expense on the other: deleted on both", async () => {
    const { a, b, link, idle } = await twoPhones();
    await newAccount(a, "Lisboa");
    await spend(a, "10", "Taxi");
    await spend(a, "4", "Coffee");
    await press(a, "live");
    await idle();
    link.down();
    await press(a, "edit", `[data-id="${entryId(a, "Taxi")}"]`);
    await press(a, "remove");
    await press(b, "edit", `[data-id="${entryId(b, "Taxi")}"]`);
    await fill(b, "edit", { amount: "30", what: "Taxi and tip" });
    expect(rows(b)).toContain("Taxi and tip €30.00 | The other person paid · ½ Half each");
    link.up();
    await press(b, "live");
    await idle();
    expect(rows(a)).toEqual(["Coffee €4.00 | I paid · ½ Half each"]);
    expect(rows(b)).toEqual(["Coffee €4.00 | The other person paid · ½ Half each"]);
    expect(balanceOf(a)).toBe("Owes you €2.00");
    expect(balanceOf(b)).toBe("You owe €2.00");
  });

  it("say so when the other phone does not answer in 8 seconds, without pretending", async () => {
    vi.useFakeTimers();
    const { coreB, a, idle } = await twoPhones();
    coreB.shut();
    await newAccount(a, "Lisboa");
    await press(a, "live");
    await idle();
    expect(statusOf(a)).toContain("Waiting");
    await vi.advanceTimersByTimeAsync(8000);
    await settle(a);
    expect(statusOf(a)).toContain("doesn't have Split open in this conversation");
    expect(statusOf(a)).toContain("may not have it, may not have allowed it, or may have it closed");
    expect(statusOf(a)).not.toContain("Live:");
  });

  it("catch up by themselves when one closes the plugin and comes back to the shared account", async () => {
    const { coreB, a, b, idle } = await twoPhones();
    await newAccount(a, "Lisboa");
    await press(a, "live");
    await idle();
    const id = a.account.id;
    await press(b, "close");
    await idle();
    expect(coreB.closed).toBe(1);
    expect(statusOf(a)).toContain("closed the account");
    await spend(a, "8", "While b was away");
    await idle();
    document.body.removeChild(b);
    coreB.reload();
    const again = await phone(coreB);
    await press(again, "open", `[data-id="${id}"]`);
    await idle();
    expect(rows(again)).toEqual(["While b was away €8.00 | The other person paid · ½ Half each"]);
    expect(statusOf(again)).toContain("Live");
    expect(statusOf(a)).toContain("Live");
  });

  it("offer to join when the other opens an account while this one is on another", async () => {
    const { a, b, idle } = await twoPhones();
    await newAccount(b, "Mine");
    await newAccount(a, "Lisboa");
    await spend(a, "10", "Dinner");
    await press(a, "live");
    await idle();
    expect(b.account.name).toBe("Mine");
    expect(inside(b).querySelector("[data-invite]").textContent).toContain("The other person opened “Lisboa”");
    await press(b, "join");
    await idle();
    expect(b.account.id).toBe(a.account.id);
    expect(balanceOf(b)).toBe("You owe €5.00");
    expect(statusOf(b)).toContain("Live");
  });

  it("ignore a hello whose account id could not be a record key, and write nothing", async () => {
    const coreB = fakeCore();
    const b = await phone(coreB);
    for (const doc of ["a/b", "", "x".repeat(200), "has space"]) {
      await coreB.hear(encode({ p: "ftsplit", v: VERSION, k: HELLO, doc, who: "w", app: "1.0.0", sv: "AA==", title: "Evil" }));
    }
    // Another plugin's format is not ours either.
    await coreB.hear(encode({ p: "ftlist", v: VERSION, k: HELLO, doc: "x", who: "w", app: "1.0.0", sv: "AA==", title: "Evil" }));
    await coreB.hear("garbage");
    await settle(b);
    expect(b.account).toBeNull();
    expect(coreB.records.size).toBe(0);
    expect(coreB.sent).toHaveLength(0);
    expect(inside(b).textContent).not.toContain("Evil");
  });

  it("say to update when the other phone speaks a newer version, and apply nothing", async () => {
    const { coreB, a, b, idle } = await twoPhones();
    await newAccount(a, "Lisboa");
    await press(a, "live");
    await idle();
    const before = rows(b);
    await coreB.hear(encode({ p: "ftsplit", v: VERSION + 1, k: UPDATE, doc: a.account.id, who: a.account.who, app: "2.0.0", u: "AAA=" }));
    await settle(b);
    expect(statusOf(b)).toContain("newer Split");
    expect(rows(b)).toEqual(before);
  });

  it("send only messages under the core's 48 KiB", async () => {
    const { a, b, link, idle } = await twoPhones();
    await newAccount(a, "Big");
    for (let at = 0; at < 300; at += 1) a.account.add({ amount: 100 + at, what: `${"expense ".repeat(9)}${at}`, iPaid: true, split: "half" });
    await settle(a);
    await press(a, "live");
    await idle();
    expect(b.account.entries()).toHaveLength(300);
    for (const { data } of link.carried) expect(atob(data).length).toBeLessThanOrEqual(48 * 1024);
    expect(link.carried.every(({ data }) => decode(data, "ftsplit"))).toBe(true);
  });
});
