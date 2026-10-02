// The plugin as the user sees it (plan-plugins-nuevos §8), against the fake core: accounts with one
// currency; expenses typed with a decimal comma or point; the balance; settling up; 📤 written from
// the side of whoever sends it, in their language; the 21 languages; and two phones in one
// conversation going live, losing each other and meeting again.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FORMAT } from "./src/index.js";
import { HELLO, Inbox, UPDATE, VERSION, decode, encode, fromBase64 } from "./src/live.js";
import { Account, LOCAL_PLACE, bodyKey, metaKey } from "./src/model.js";
import { APP_ICONS, OWN_ICONS } from "./src/icons.js";
import { connect, fakeCore } from "./test/fake-core.js";

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, "module.json"), "utf8"));

/** Intl puts a no-break space between number and symbol in some languages: compare as spaces. */
const plain = (text) => String(text).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();

const flush = async () => {
  for (let at = 0; at < 60; at += 1) await Promise.resolve();
};

/** A conversation's id as the core gives it in `onOpen`: 43 of `A-Z a-z 0-9 _ -`. */
const chat = (tag) => tag.padEnd(43, "x");
let phones = 0;

/**
 * One phone with the plugin open: `live` when opened from a conversation with it granted. Opened
 * live, it is in that phone's conversation (its `chat`, the same each time) unless told another.
 */
async function phone(core, opening = { live: true }) {
  core.chat ??= chat(`phone${(phones += 1)}`);
  const given = opening.live && !("chat" in opening) ? { ...opening, chat: core.chat } : opening;
  globalThis.ft = core.ft;
  const element = document.createElement("ft-split");
  document.body.append(element);
  await core.open(given);
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
/** An Enter key on a field, as a keyboard sends it (`composing`: while a word is being composed). */
const enter = (field, composing = false) => field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true, cancelable: true, isComposing: composing }));

/**
 * Fills the fields of one action by name and does it as a finger would: the action's button
 * (`click`), or Enter in its first field (`enter`, or `composing` for an Enter that only ends a
 * word). Never a `submit` event: the plugin's frame is sandboxed without `allow-forms`, and
 * Android's WebView blocks submitting a form there before any `submit` is fired.
 */
async function fill(element, form, values, how = "click") {
  const node = inside(element).querySelector(`[data-form="${form}"]`);
  if (!node) throw new Error(`no fields ${form}`);
  for (const [name, value] of Object.entries(typeof values === "string" ? { value: values } : values)) {
    const field = node.querySelector(`[name="${name}"]`);
    if (!field) throw new Error(`no field ${name} in ${form}`);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }
  if (how === "click") {
    const go = node.querySelector('[data-act="submit"]');
    if (!go) throw new Error(`no button for ${form}`);
    go.click();
  } else {
    enter(node.querySelector("input"), how === "composing");
  }
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
  it("asks for live and to propose a text, nothing more, on core 1.3.0 (which tells the conversation)", () => {
    expect(manifest).toEqual({
      id: "com.flickertalk.split",
      name: "Split",
      version: "1.0.0",
      minCoreVersion: "1.3.0",
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
    const currencies = [...inside(element).querySelectorAll('[data-form="new"] select[name="currency"] option')].map((one) => one.value);
    expect(currencies).toEqual(Intl.supportedValuesOf("currency"));
    await newAccount(element, "Lisboa");
    expect(inside(element).querySelector("[data-name]").textContent).toBe("Lisboa");
    expect(balanceOf(element)).toBe("All square");

    await spend(element, "12,50", "Dinner", "me", "half");
    expect(balanceOf(element)).toBe("Owes you €6.25");
    await spend(element, "8.40", "Museum", "other", "all");
    expect(rows(element)).toEqual(["Museum €8.40 | The other person paid · All for me", "Dinner €12.50 | I paid · ½ Half each"]);
    expect(balanceOf(element)).toBe("You owe €2.15");
    const id = element.account.id;
    const kept = Account.parse(id, core.records.get(bodyKey(LOCAL_PLACE, id)), core.records.get(metaKey(LOCAL_PLACE, id)));
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
    expect(Account.parse(id, core.records.get(bodyKey(LOCAL_PLACE, id))).entries()).toHaveLength(1);

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
    expect(balanceOf(element)).toBe("All square");
    expect(rows(element)[0]).toBe("Settled up €12.50 | The other person paid");
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
    // In a conversation: outside one there is no composer to put it in.
    const element = await phone(core, { live: true });
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
    const kept = Account.parse(b.account.id, coreB.records.get(bodyKey(coreB.chat, b.account.id)), coreB.records.get(metaKey(coreB.chat, b.account.id)));
    expect(kept.totals().balance).toBe(-500);
    expect(JSON.parse(coreB.records.get(metaKey(coreB.chat, b.account.id)))).toMatchObject({ shared: true, currency: "EUR" });
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
    expect(inside(b).querySelector('[data-form="nick"] input').value).toBe("");
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
    // One transaction: the test is about a document too big for one message, not about 300
    // separate changes (each would redraw the whole list with the view mounted).
    a.account.doc.transact(() => {
      for (let at = 0; at < 300; at += 1) a.account.add({ amount: 100 + at, what: `${"expense ".repeat(9)}${at}`, iPaid: true, split: "half" });
    });
    await settle(a);
    await press(a, "live");
    await idle();
    expect(b.account.entries()).toHaveLength(300);
    for (const { data } of link.carried) expect(atob(data).length).toBeLessThanOrEqual(48 * 1024);
    expect(link.carried.every(({ data }) => decode(data, "ftsplit"))).toBe(true);
    expect(link.carried.some(({ data }) => decode(data, "ftsplit").k === "part")).toBe(true);
  });
});

describe("a third person", () => {
  /** A and B share "Lisboa"; C is a third phone with Split open. */
  async function shared() {
    const coreA = fakeCore();
    const coreB = fakeCore();
    const coreC = fakeCore();
    let link = connect(coreA, coreB);
    const a = await phone(coreA);
    const b = await phone(coreB);
    globalThis.ft = coreC.ft;
    const c = await phone(coreC);
    await newAccount(a, "Lisboa");
    await spend(a, "30", "Hotel");
    await press(a, "live");
    await link.idle();
    await settle(a, b);
    expect(b.account.id).toBe(a.account.id);
    return { coreA, coreB, coreC, a, b, c, link, relink: (to) => (link = connect(coreA, to)), idle: async (...elements) => {
      await link.idle();
      await settle(...elements);
    } };
  }

  it("does not see a shared account in another conversation, and going live again from it only resumes with the same person", async () => {
    vi.useFakeTimers();
    const { coreA, coreB, coreC, a, b, c, relink, idle } = await shared();
    const id = a.account.id;
    const peer = a.account.peer;
    expect(peer).toBe(b.account.who);
    // A opens Split in the conversation with C: that conversation has its own accounts.
    await press(a, "close");
    document.body.removeChild(a);
    coreA.reload();
    relink(coreC);
    const mark = coreA.sent.length;
    const withC = await phone(coreA, { live: true, chat: chat("withC") });
    await idle(withC, c);
    expect(inside(withC).querySelector(`[data-id="${id}"]`)).toBeNull();
    expect(inside(withC).textContent).toContain("No accounts yet");
    expect(coreA.sent.slice(mark)).toEqual([]);
    expect(c.account).toBeNull();
    expect(coreC.records.size).toBe(0);
    expect(coreC.sent).toHaveLength(0);
    // Back in the conversation with B, with B's Split closed: A resumes, nobody answers.
    await press(withC, "close");
    document.body.removeChild(withC);
    coreA.reload();
    relink(coreB);
    coreB.shut();
    const back = await phone(coreA);
    await press(back, "open", `[data-id="${id}"]`);
    await idle(back, b);
    await vi.advanceTimersByTimeAsync(8000);
    await settle(back);
    expect(statusOf(back)).toContain("doesn't have Split open in this conversation");
    // B opens it again; the user presses 🔄: it only ever resumes, and B answers.
    coreB.listening = true;
    await press(back, "live");
    await idle(back, b);
    const hellos = coreA.sent.slice(mark).map((data) => decode(data, "ftsplit")).filter((one) => one?.k === HELLO);
    expect(hellos).toHaveLength(2);
    for (const hello of hellos) expect(hello).toMatchObject({ resume: true, doc: id });
    for (const hello of hellos) expect(hello.title).toBeUndefined();
    expect(back.account.peer).toBe(peer);
    expect(JSON.parse(coreA.records.get(metaKey(coreA.chat, id))).peer).toBe(peer);
    expect(statusOf(back)).toContain("Live");
    await spend(b, "10", "Taxi");
    await idle(back, b);
    expect(rows(back)[0]).toBe("Taxi €10.00 | The other person paid · ½ Half each");
    expect(balanceOf(back)).toBe("Owes you €10.00");
  });

  it("gets nothing when a third phone says hello for an account two people share", async () => {
    const { coreA, a, idle } = await shared();
    const id = a.account.id;
    const peer = a.account.peer;
    const intruder = (title) => encode({ p: "ftsplit", v: VERSION, k: HELLO, doc: id, who: "cccccccc", app: "1.0.0", sv: "AA==", title });
    // While A is live on it with B…
    let before = coreA.sent.length;
    await coreA.hear(intruder("Lisboa"));
    await idle(a);
    expect(coreA.sent.slice(before)).toEqual([]);
    expect(a.account.peer).toBe(peer);
    expect(statusOf(a)).toContain("Live");
    // …and from the list of accounts.
    await press(a, "back");
    await idle(a);
    before = coreA.sent.length;
    await coreA.hear(intruder("Lisboa"));
    await idle(a);
    expect(coreA.sent.slice(before)).toEqual([]);
    expect(a.account).toBeNull();
    expect(JSON.parse(coreA.records.get(metaKey(coreA.chat, id))).peer).toBe(peer);
  });

  it("shows a warning instead of a balance when the account holds more than two people, and offers neither 💸 nor 📤", async () => {
    const core = fakeCore();
    const first = new Account({ name: "Lisboa", currency: "EUR" });
    first.add({ amount: 3000, what: "by a", iPaid: true, split: "half" });
    for (const what of ["by b", "by c"]) {
      const other = Account.parse(first.id, first.body());
      other.add({ amount: 1000, what, iPaid: true, split: "half" });
      const { encodeStateAsUpdate, applyUpdate } = await import("yjs");
      applyUpdate(first.doc, encodeStateAsUpdate(other.doc));
    }
    core.records.set(bodyKey(LOCAL_PLACE, first.id), first.body());
    core.records.set(metaKey(LOCAL_PLACE, first.id), first.meta());
    const element = await phone(core, { live: false });
    expect(plain(inside(element).querySelector("[data-act=open]").textContent)).toContain("more than two people");
    await press(element, "open");
    expect(balanceOf(element)).toContain("more than two people");
    expect(balanceOf(element)).not.toMatch(/Owes you|You owe|All square/);
    expect(inside(element).querySelector('[data-act="settle"]')).toBeNull();
    expect(inside(element).querySelector('[data-act="send"]')).toBeNull();
    expect(plain(inside(element).querySelector("[data-total]").textContent)).toBe("Total spent: €50.00");
  });
});

describe("conversations", () => {
  const reopen = async (core, element, opening) => {
    await press(element, "close");
    document.body.removeChild(element);
    core.reload();
    return phone(core, opening);
  };
  const names = (element) => [...inside(element).querySelectorAll("[data-act=open] .title")].map((one) => one.textContent);
  const KEY = /^split\/(local|[A-Za-z0-9_-]{43})\/[A-Za-z0-9_-]{1,64}\/(meta|body)$/;

  it("keep their own accounts: one chat's are not in another's, nor outside any conversation", async () => {
    const core = fakeCore();
    const one = await phone(core, { live: true, chat: chat("one") });
    await newAccount(one, "Lisboa");
    await spend(one, "10", "Dinner");
    expect([...core.records.keys()].sort()).toEqual([`split/${chat("one")}/${one.account.id}/body`, `split/${chat("one")}/${one.account.id}/meta`]);
    const two = await reopen(core, one, { live: true, chat: chat("two") });
    expect(names(two)).toEqual([]);
    expect(inside(two).textContent).toContain("No accounts yet");
    await newAccount(two, "Oporto");
    const local = await reopen(core, two, { live: false });
    expect(names(local)).toEqual([]);
    await newAccount(local, "Mine");
    expect(core.records.has(`split/local/${local.account.id}/meta`)).toBe(true);
    const back = await reopen(core, local, { live: true, chat: chat("one") });
    expect(names(back)).toEqual(["Lisboa"]);
    await press(back, "open");
    expect(rows(back)).toEqual(["Dinner €10.00 | I paid · ½ Half each"]);
    for (const key of core.records.keys()) expect(key).toMatch(KEY);
    expect(core.records.size).toBe(6);
  });

  it("take no chat, or a chat id of any other shape, as no conversation: this phone only, never live", async () => {
    for (const opening of [{ live: true, chat: undefined }, { live: true, chat: "short" }, { live: true, chat: `${"x".repeat(42)}/` }, { live: true, chat: `${"x".repeat(42)}.` }, { live: true, chat: "x".repeat(44) }, { live: false, chat: chat("granted not") }]) {
      const core = fakeCore();
      const element = await phone(core, opening);
      expect(inside(element).textContent).toContain("only on this phone");
      // What arrives over live is ignored: no account, no answer.
      await core.hear(encode({ p: "ftsplit", v: VERSION, k: HELLO, doc: "someone", who: "w", app: "1.0.0", sv: "AA==", title: "From live" }));
      await settle(element);
      expect(element.account).toBeNull();
      await newAccount(element, "Mine");
      await spend(element, "5", "Coffee");
      expect(inside(element).querySelector('[data-act="live"]')).toBeNull();
      expect(inside(element).textContent).toContain("To share it, open Split from a conversation");
      await core.hear(encode({ p: "ftsplit", v: VERSION, k: HELLO, doc: element.account.id, who: "w", app: "1.0.0", sv: "AA==", title: "x" }));
      await core.hear(encode({ p: "ftsplit", v: VERSION, k: HELLO, doc: element.account.id, who: "w", app: "1.0.0", sv: "AA==", resume: true }));
      await settle(element);
      expect(inside(element).querySelector("[data-invite]").textContent).toBe("");
      expect(core.sent).toEqual([]);
      expect([...core.records.keys()].every((key) => key.startsWith("split/local/"))).toBe(true);
      document.body.innerHTML = "";
    }
  });

  it("do not say the account is this phone's only when opened in one", async () => {
    const element = await phone(fakeCore());
    expect(inside(element).textContent).not.toContain("only on this phone");
  });

  it("stop the attack: a resumed hello for an account shared in another conversation gets nothing", async () => {
    // A shares "X" with C, in their conversation.
    const coreA = fakeCore();
    const coreC = fakeCore();
    let link = connect(coreA, coreC);
    const a = await phone(coreA);
    let c = await phone(coreC);
    await newAccount(a, "X");
    await spend(a, "30", "Secret hotel");
    await press(a, "live");
    await link.idle();
    await settle(a, c);
    const id = a.account.id;
    const whoA = a.account.who;
    expect(c.account.id).toBe(id);
    expect(c.account.entries()).toHaveLength(1);
    // Later C has Split open in the conversation with B, and B's modified app poses as A.
    const coreB = fakeCore();
    link = connect(coreB, coreC);
    c = await reopen(coreC, c, { live: true, chat: chat("CwithB") });
    const mark = coreC.sent.length;
    await coreC.hear(encode({ p: "ftsplit", v: VERSION, k: HELLO, doc: id, who: whoA, app: "1.0.0", sv: "AA==", resume: true }));
    await link.idle();
    await settle(c);
    expect(coreC.sent.slice(mark)).toEqual([]);
    expect(c.account).toBeNull();
    expect(names(c)).toEqual([]);
    // A hello that does not resume makes a new, empty account in this conversation, with nothing of C's.
    await coreC.hear(encode({ p: "ftsplit", v: VERSION, k: HELLO, doc: id, who: whoA, app: "1.0.0", sv: "AA==", title: "X" }));
    await link.idle();
    await settle(c);
    expect(c.account.id).toBe(id);
    expect(c.account.entries()).toEqual([]);
    const replies = coreC.sent.slice(mark).map((data) => decode(data, "ftsplit"));
    expect(replies.length).toBeGreaterThan(0);
    for (const reply of replies) {
      expect(reply.u).toBeUndefined();
      expect(JSON.stringify(reply)).not.toContain("Secret");
    }
    // C's copy in the conversation with A is untouched; the two never mix.
    expect(Account.parse(id, coreC.records.get(bodyKey(coreC.chat, id))).entries().map((one) => one.what)).toEqual(["Secret hotel"]);
    const here = coreC.records.get(bodyKey(chat("CwithB"), id));
    if (here) expect(Account.parse(id, here).entries()).toEqual([]);
  });

  it("never let the chat id leave the phone: not in what live carries, nor in the summary", async () => {
    const { coreA, coreB, link, a, b, idle } = await twoPhones();
    await newAccount(a, "Lisboa");
    await spend(a, "30", "Hotel");
    await press(a, "live");
    await idle();
    await spend(b, "12,40", "Taxi", "me", "all");
    await fill(a, "nick", "Ana");
    await fill(b, "nick", "Luis");
    await idle();
    await press(a, "settle");
    await press(a, "confirmSettle");
    await idle();
    await press(b, "send");
    await idle();
    await press(a, "send");
    const secrets = [coreA.chat, coreB.chat];
    expect(secrets.every((one) => /^[A-Za-z0-9_-]{43}$/.test(one))).toBe(true);
    const inbox = new Inbox("ftsplit");
    const seen = [];
    for (const { data } of link.carried) {
      seen.push(data, new TextDecoder().decode(fromBase64(data)));
      const message = inbox.take(data);
      if (!message) continue;
      seen.push(JSON.stringify(message));
      for (const field of ["u", "sv"]) if (typeof message[field] === "string") seen.push(String.fromCharCode(...fromBase64(message[field])));
    }
    seen.push(...coreA.said, ...coreB.said);
    expect(link.carried.length).toBeGreaterThan(4);
    expect(coreA.said).toHaveLength(1);
    expect(coreB.said).toHaveLength(1);
    for (const text of seen) for (const secret of secrets) expect(text.includes(secret)).toBe(false);
  });
});

describe("found in the iOS simulator", () => {
  it("offers no ➤ outside a conversation, and sending there does nothing and leaves the account usable", async () => {
    const core = fakeCore();
    const element = await phone(core, { live: false });
    await newAccount(element, "Mine");
    await spend(element, "10", "Dinner");
    expect(inside(element).querySelector('[data-act="send"]')).toBeNull();
    await element.sendSummary();
    await settle(element);
    expect(core.ft.say).not.toHaveBeenCalled();
    expect(element.account?.name).toBe("Mine");
    await spend(element, "4", "Coffee");
    expect(rows(element)).toHaveLength(2);
  });

  it("offers ➤ in a conversation, even without live allowed, and it puts the summary in the composer", async () => {
    const core = fakeCore();
    const element = await phone(core, { live: false, chat: chat("noLive") });
    await newAccount(element, "Lisboa");
    await spend(element, "10", "Dinner");
    expect(inside(element).querySelector('[data-act="live"]')).toBeNull();
    await press(element, "send");
    expect(core.ft.say).toHaveBeenCalledTimes(1);
    expect(plain(core.said[0])).toBe("🧾 Lisboa · total €10.00 · I paid €10.00 · you €0.00 · you owe me €5.00");
  });

  it("goes dark when the app says so, with an attribute WebKit understands", async () => {
    const dark = await phone(fakeCore(), { live: false, dark: true });
    expect(dark.hasAttribute("dark")).toBe(true);
    const light = await phone(fakeCore(), { live: false, dark: false });
    expect(light.hasAttribute("dark")).toBe(false);
    // Opened again light, the attribute goes.
    const core = fakeCore();
    const again = await phone(core, { live: false, dark: true });
    await core.open({ live: false, dark: false });
    await settle(again);
    expect(again.hasAttribute("dark")).toBe(false);
    const css = inside(dark).querySelector("style").textContent;
    expect(css).toContain(":host([dark])");
    expect(css).toContain("prefers-color-scheme: dark");
    expect(css).not.toContain(":host-context");
  });
});

describe("icons, not emoji", () => {
  const PICTOGRAPH = /\p{Extended_Pictographic}/u;

  /** Everything the view paints, at many moments: what is on screen, attributes included. */
  async function everyScreen() {
    const shots = [];
    const snap = (element) => shots.push(inside(element).innerHTML);
    // Outside a conversation: empty, then accounts with a balance, even, and more than two people.
    const local = fakeCore({ quota: 4000 });
    const crowded = new Account({ name: "Crowded", currency: "EUR" });
    crowded.add({ amount: 3000, what: "by a", iPaid: true, split: "half" });
    for (const what of ["by b", "by c"]) {
      const other = Account.parse(crowded.id, crowded.body());
      other.add({ amount: 1000, what, iPaid: true, split: "half" });
      const { encodeStateAsUpdate, applyUpdate } = await import("yjs");
      applyUpdate(crowded.doc, encodeStateAsUpdate(other.doc));
    }
    local.records.set(bodyKey(LOCAL_PLACE, crowded.id), crowded.body());
    local.records.set(metaKey(LOCAL_PLACE, crowded.id), crowded.meta());
    const readOnly = new Account({ name: "Newer", currency: "EUR" });
    readOnly.doc.getMap("info").set("schema", 99);
    local.records.set(bodyKey(LOCAL_PLACE, readOnly.id), readOnly.body());
    local.records.set(metaKey(LOCAL_PLACE, readOnly.id), readOnly.meta());
    const one = await phone(local, { live: false });
    snap(one);
    await newAccount(one, "Even");
    snap(one);
    await press(one, "back");
    await newAccount(one, "Lisboa");
    await spend(one, "25", "Dinner");
    await spend(one, "12,505", "Bad");
    snap(one);
    await press(one, "settle");
    snap(one);
    await press(one, "confirmSettle");
    await press(one, "edit", `[data-id="${entryId(one, "Dinner")}"]`);
    snap(one);
    await press(one, "cancelEdit");
    for (let at = 0; at < 30; at += 1) await spend(one, "1", `filling the little room there is ${at}`);
    snap(one);
    await press(one, "back");
    snap(one);
    await press(one, "open", `[data-id="${crowded.id}"]`);
    snap(one);
    await press(one, "back");
    await press(one, "open", `[data-id="${readOnly.id}"]`);
    snap(one);
    await press(one, "back");
    await press(one, "delete");
    snap(one);
    one.show(Account.received("waiting"));
    snap(one);
    // In conversations: live, joined, an invite, the other leaving, unreachable, silent, newer.
    vi.useFakeTimers();
    const { coreA, coreB, link, a, b, idle } = await twoPhones();
    snap(a);
    await newAccount(b, "Mine");
    await newAccount(a, "Lisboa");
    await spend(a, "30", "Hotel");
    coreB.shut();
    await press(a, "live");
    snap(a);
    await vi.advanceTimersByTimeAsync(8000);
    await settle(a);
    snap(a);
    coreB.listening = true;
    await press(a, "live");
    await press(a, "live");
    await idle();
    snap(a);
    snap(b);
    await press(b, "join");
    await idle();
    snap(a);
    snap(b);
    link.down();
    await spend(a, "1", "Offline");
    snap(a);
    link.up();
    await press(b, "back");
    await idle();
    snap(a);
    await coreA.hear(encode({ p: "ftsplit", v: VERSION + 1, k: UPDATE, doc: a.account.id, who: b.account?.who ?? "w", app: "2.0.0", u: "AAA=" }));
    await settle(a);
    snap(a);
    return shots;
  }

  it("paints no emoji anywhere: every screen, every state, every attribute", async () => {
    const shots = await everyScreen();
    expect(shots.length).toBeGreaterThan(15);
    for (const html of shots) expect(html.match(PICTOGRAPH)?.[0] ?? null, html.slice(0, 300)).toBeNull();
  });

  it("asks the app only for icons it lends, carries the rest, and every button can be named", async () => {
    const shots = await everyScreen();
    const asked = new Set(shots.flatMap((html) => [...html.matchAll(/\.\/icon\/([a-z0-9-]+)\.svg/g)].map((match) => match[1])));
    expect(asked.size).toBeGreaterThan(4);
    for (const name of asked) expect(APP_ICONS.has(name), name).toBe(true);
    const inline = shots.reduce((sum, html) => sum + (html.match(/<i class="i own"/g)?.length ?? 0), 0);
    expect(inline).toBeGreaterThan(10);
    for (const html of shots) {
      const box = document.createElement("div");
      box.innerHTML = html;
      for (const button of box.querySelectorAll("button")) {
        const named = (button.getAttribute("aria-label") ?? "").trim() || button.textContent.trim();
        expect(named, button.outerHTML).not.toBe("");
      }
      for (const drawn of box.querySelectorAll("i.i")) expect(drawn.getAttribute("aria-hidden") === "true" || drawn.hasAttribute("aria-label"), drawn.outerHTML).toBe(true);
      // A button with an icon and a text lays them out side by side (one class attribute only).
      for (const button of box.querySelectorAll('[data-act="live"], [data-act="settle"], [data-act="confirmSettle"]')) expect(button.classList.contains("text"), button.outerHTML).toBe(true);
    }
    expect(OWN_ICONS).toEqual(expect.arrayContaining(["sync-outline", "cash-outline", "people-outline", "phone-portrait-outline", "checkmark-circle-outline", "alert-circle-outline"]));
  });

  it("paints no <form> anywhere: the sandboxed frame on Android would block it", async () => {
    for (const html of await everyScreen()) expect(html).not.toMatch(/<form[\s>]/i);
  });

  it("keeps its emoji only in the text it proposes for the chat", async () => {
    const core = fakeCore();
    const element = await phone(core);
    await newAccount(element, "Lisboa");
    await press(element, "send");
    expect(core.said[0]).toMatch(/^🧾 Lisboa · .* · we're even ✅$/u);
  });
});

describe("found on Android phones", () => {
  it("does each action with its button and with Enter, with no form to submit", async () => {
    for (const how of ["click", "enter"]) {
      const core = fakeCore();
      const element = await phone(core);
      await fill(element, "new", { value: "Lisboa", currency: "EUR" }, how);
      expect(element.account?.name, how).toBe("Lisboa");
      await choose(element, "add", "paid", "me");
      await fill(element, "add", { amount: "10", what: "Dinner" }, how);
      expect(rows(element), how).toEqual(["Dinner €10.00 | I paid · ½ Half each"]);
      await press(element, "edit", `[data-id="${entryId(element, "Dinner")}"]`);
      await fill(element, "edit", { amount: "12", what: "Dinner out" }, how);
      expect(rows(element), how).toEqual(["Dinner out €12.00 | I paid · ½ Half each"]);
      await press(element, "rename");
      await fill(element, "rename", "Oporto", how);
      expect(inside(element).querySelector("[data-name]").textContent, how).toBe("Oporto");
      await fill(element, "nick", "Ana", how);
      expect(element.account.nick, how).toBe("Ana");
      await press(element, "settle");
      await press(element, "confirmSettle");
      expect(balanceOf(element), how).toBe("All square");
      expect(inside(element).querySelector("form"), how).toBeNull();
      document.body.innerHTML = "";
    }
  });

  it("does not take the Enter that only ends a composed word", async () => {
    const element = await phone(fakeCore());
    await fill(element, "new", { value: "Lisboa" }, "composing");
    expect(element.account).toBeNull();
    await fill(element, "new", { value: "Lisboa" }, "enter");
    expect(element.account?.name).toBe("Lisboa");
  });

  /** Types an amount as a keyboard does: the value changes and an `input` event follows. */
  async function type(element, value, form = "add") {
    const field = inside(element).querySelector(`[data-form="${form}"] [name="amount"]`);
    field.value = value;
    field.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    await settle(element);
    return plain(inside(element).querySelector(`[data-form="${form}"] [data-preview]`).textContent);
  }
  const money = (lang, currency, value) => plain(new Intl.NumberFormat(lang, { style: "currency", currency }).format(value));

  it("shows the amount as it will be written while it is typed, in the account's currency", async () => {
    const element = await phone(fakeCore());
    await newAccount(element, "Lisboa");
    expect(plain(inside(element).querySelector('[data-form="add"] [data-preview]').textContent)).toBe("");
    expect(await type(element, "1")).toBe("= €1.00");
    expect(await type(element, "12")).toBe("= €12.00");
    expect(await type(element, "12,5")).toBe("= €12.50");
    expect(await type(element, "12,50")).toBe("= €12.50");
    expect(await type(element, "12.50")).toBe("= €12.50");
    // The Samsung keypad has no comma: "12,50" typed as "1250" shows what it really is.
    expect(await type(element, "1250")).toBe("= €1,250.00");
    expect(await type(element, "12,505")).toContain("Write an amount like 12.50");
    expect(await type(element, "")).toBe("");
    // The button does nothing with an amount that is not one.
    await type(element, "12,505");
    inside(element).querySelector('[data-form="add"] [data-act="submit"]').click();
    await settle(element);
    expect(rows(element)).toEqual([]);
    // The same while editing an expense.
    await fill(element, "add", { amount: "10", what: "Dinner" });
    await press(element, "edit", `[data-id="${entryId(element, "Dinner")}"]`);
    expect(await type(element, "30,5", "edit")).toBe("= €30.50");
  });

  it("shows it in the phone's language, and with each currency's decimals", async () => {
    const spanish = await phone(fakeCore({ lang: "es" }));
    await newAccount(spanish, "Lisboa");
    expect(await type(spanish, "1250")).toBe(`= ${money("es", "EUR", 1250)}`);
    expect(await type(spanish, "12,5")).toBe(`= ${money("es", "EUR", 12.5)}`);
    const yen = await phone(fakeCore());
    await newAccount(yen, "Tokio", "JPY");
    expect(await type(yen, "1.500")).toBe("= ¥1,500");
    expect(await type(yen, "15,5")).toContain("Write an amount like 1250");
    const dinar = await phone(fakeCore());
    await newAccount(dinar, "Kuwait", "KWD");
    expect(await type(dinar, "1,25")).toBe(`= ${money("en", "KWD", 1.25)}`);
    expect(await type(dinar, "1,25")).toContain("1.250");
  });

  it("keeps a comfortable width on a tablet, and the phone as it was", async () => {
    const element = await phone(fakeCore());
    const css = inside(element).querySelector("style").textContent;
    expect(css).toMatch(/\.view\s*\{[^}]*max-inline-size:\s*640px/);
    expect(css).toMatch(/\.view\s*\{[^}]*margin-inline:\s*auto/);
  });
});


describe("a narrow phone", () => {
  it("puts the account's title on its own line, whole, with the buttons on a row below", async () => {
    const element = await phone(fakeCore());
    const long = "Viaje a Lisboa con los primos en septiembre, gastos de todos";
    await newAccount(element, long);
    const header = inside(element).querySelector("[data-header]");
    const title = header.querySelector("[data-name]");
    expect(title.textContent).toBe(long);
    // The title is not an item of the flexible row of buttons, which could shrink it to nothing.
    expect(title.closest(".bar")).toBeNull();
    expect(header.classList.contains("bar")).toBe(false);
    const buttons = header.querySelector(".bar");
    expect(buttons).not.toBeNull();
    expect(title.compareDocumentPosition(buttons) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const act of ["back", "rename", "live", "send", "close"]) expect(buttons.querySelector(`[data-act="${act}"]`), act).not.toBeNull();
    // Renaming takes the title's line too.
    await press(element, "rename");
    expect(header.querySelector('[data-form="rename"]').closest(".bar")).toBeNull();
    const css = inside(element).querySelector("style").textContent;
    expect(css).not.toContain("ellipsis");
    expect(css).toMatch(/\.title-line\s*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).not.toMatch(/h1\s*\{[^}]*nowrap/);
    // Buttons never go under 44 px, and a row of them wraps rather than leave a 320 px screen.
    expect(css).toMatch(/\nbutton\s*\{[^}]*min-width:\s*44px[^}]*height:\s*44px/);
    expect(css).toMatch(/\.bar\s*\{[^}]*flex-wrap:\s*wrap/);
  });
});

describe("the element as a browser makes it", () => {
  it("leaves no attribute and no child from its constructor, and takes lang and dir only when opened", async () => {
    await import("./src/index.js");
    const made = document.createElement("ft-split");
    expect([...made.attributes].map((one) => one.name)).toEqual([]);
    expect(made.childNodes.length).toBe(0);
    const core = fakeCore({ lang: "ar" });
    globalThis.ft = core.ft;
    document.body.append(made);
    await core.open({ live: false });
    await settle(made);
    expect(made.getAttribute("lang")).toBe("ar");
    expect(made.getAttribute("dir")).toBe("rtl");
    expect(made.language).toBe("ar");
  });
});
