// Split for FlickerTalk (plan-plugins-nuevos §8): shared expenses between two people, kept on this
// phone. Accounts with one currency each; an expense has an amount, what it was for, who paid and
// how it splits (in half, or all of it for the one who did not pay); the balance says who owes
// whom; "💸 Settle up" records the payment that evens it. From a conversation, "🔄 Live" lets the
// two phones keep one account at once over the core's direct channel (`live.js`); what each does
// apart is kept here and joins the other's when both have it open. 📤 puts a summary in the
// composer, said by whoever sends it. Nothing leaves this frame but what the user sends, and what
// live says to the same plugin on the other phone.

import { name as APP_NAME, version as APP_VERSION } from "../module.json";
import { dirOf, makeT } from "./i18n.js";
import { HELLO, Inbox, LiveSession, inOrder, isNewer } from "./live.js";
import { yjsReplica } from "./live-yjs.js";
import { ALL, Account, HALF, MAX_NAME, MAX_NICK, MAX_WHAT, SETTLE } from "./model.js";
import { currencies, formatMoney, isCurrency, parseAmount, toDecimal } from "./money.js";
import { Keeper } from "./store.js";
import { STRINGS } from "./strings.js";

/** The `p` of every live message of this plugin. */
export const FORMAT = "ftsplit";
/** The amount the hint shows as an example, in minor units (12.50, 1250 yen, 1.250 dinars). */
const EXAMPLE = 1250;
const DEFAULT_CURRENCY = "EUR";

const t = makeT(STRINGS);

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[one]);

const STYLE = `
:host { display: block; font: 15px system-ui, sans-serif; color: #111; --paper: #fff; --line: #d8d8d8; --soft: #666; --accent: #e0562b; --good: #1f8a4c; }
@media (prefers-color-scheme: dark) { :host { color: #f4f4f4; --paper: #111; --line: #3a3a3a; --soft: #aaa; --good: #5fd08f; } }
:host-context([data-dark]) { color: #f4f4f4; --paper: #111; --line: #3a3a3a; --soft: #aaa; --good: #5fd08f; }
* { box-sizing: border-box; }
.bar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 4px 0 8px; }
.grow { flex: 1; min-width: 0; }
h1 { font-size: 18px; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
button {
  appearance: none; border: 1px solid currentColor; background: transparent; color: inherit;
  border-radius: 10px; min-width: 44px; height: 44px; font: inherit; padding: 0 10px; cursor: pointer; opacity: .8;
}
button.on { opacity: 1; box-shadow: inset 0 0 0 2px currentColor; }
button.danger { color: var(--accent); }
button.plain { border: 0; }
.i { display: block; width: 22px; height: 22px; margin: auto; background: currentColor; -webkit-mask: var(--i) center/contain no-repeat; mask: var(--i) center/contain no-repeat; }
form { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 0; }
form.wide { flex: 1; }
.row { display: flex; gap: 6px; width: 100%; }
input, select { flex: 1; min-width: 0; font: inherit; color: inherit; background: transparent; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; height: 44px; }
select { flex: 0 1 40%; }
input[name="amount"] { flex: 0 1 35%; }
.choices { display: flex; flex-wrap: wrap; gap: 6px; width: 100%; }
.choices button { flex: 1 1 40%; }
ul { list-style: none; margin: 8px 0 0; padding: 0; }
li { display: flex; align-items: center; gap: 8px; border-bottom: 1px solid var(--line); min-height: 52px; }
li form { padding: 8px 0; width: 100%; }
li .open { flex: 1; display: flex; flex-direction: column; align-items: flex-start; text-align: start; border: 0; border-radius: 0; height: auto; padding: 10px 4px; opacity: 1; }
.main { flex: 1; display: flex; flex-direction: column; padding: 8px 0; min-width: 0; }
.what { overflow-wrap: anywhere; }
.title { font-weight: 600; }
.meta, .who { color: var(--soft); font-size: 13px; }
.amount { font-variant-numeric: tabular-nums; white-space: nowrap; }
[data-kind="settle"] .what { color: var(--good); }
.balance { font-size: 20px; font-weight: 600; margin: 8px 0 0; }
.status, .hint, .warn, .note { margin: 4px 0; }
.status:empty, .warn:empty, .note:empty { display: none; }
.hint, .note { color: var(--soft); font-size: 13px; }
.warn { color: var(--accent); width: 100%; }
.invite { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px; border: 1px solid var(--line); border-radius: 10px; margin: 4px 0; }
.invite:empty { display: none; }
.invite span { flex: 1; min-width: 60%; }
.confirm { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 0; }
.confirm span { flex: 1 1 100%; }
.empty { color: var(--soft); text-align: center; padding: 32px 0; }
.nick { margin-top: 16px; }
`;

const icon = (name) => `<i class="i" style="--i:url(./icon/${name}.svg)"></i>`;
const button = (act, label, name, extra = "") => `<button type="button" data-act="${act}" aria-label="${escape(label)}" ${extra}>${icon(name)}</button>`;

/** The plugin's view: the accounts this phone keeps, or one account. */
class SplitElement extends HTMLElement {
  constructor() {
    super();
    this.root = this.attachShadow({ mode: "open" });
    this.lang = "en";
    this.mayLive = false;
    this.screen = "home";
    this.metas = [];
    this.account = null;
    this.session = null;
    this.status = "off";
    this.stops = [];
    this.draft = { iPaid: true, split: HALF };
    this.editing = null;
    this.editDraft = null;
    this.renaming = false;
    this.settling = false;
    this.confirming = null;
    this.invite = null;
    this.pendingTitle = "";
    this.badAmount = false;
    this.shape = "";
  }

  connectedCallback() {
    this.ft = globalThis.ft;
    this.keeper = new Keeper(this.ft.records);
    this.keeper.onFull(() => this.paintWarning());
    this.inbox = new Inbox(FORMAT);
    this.root.innerHTML = `<style>${STYLE}</style><div class="view"></div>`;
    this.view = this.root.querySelector(".view");
    this.root.addEventListener("click", (event) => this.onClick(event));
    this.root.addEventListener("submit", (event) => this.onSubmit(event));
    this.root.addEventListener("keydown", (event) => this.onKey(event));
    this.ft.onOpen((opening) => this.onOpen(opening));
    // The frame does not wait for one message to be handled before handing the next.
    this.ft.live?.onMessage?.(inOrder((data) => this.onLive(data)));
    this.paint();
  }

  T(key, holes = {}) {
    return t(this.lang, key, { app: APP_NAME, ...holes });
  }

  /** An amount of the open account, as the phone's language writes it. */
  money(minor, currency = this.account?.currency) {
    return formatMoney(minor, currency, this.lang);
  }

  /** An amount as one types it: no symbol, no grouping, the language's decimal mark. */
  plainAmount(minor) {
    let mark = ".";
    try {
      mark = new Intl.NumberFormat(this.lang).formatToParts(1.5).find((part) => part.type === "decimal")?.value ?? ".";
    } catch {
      mark = ".";
    }
    return toDecimal(minor, this.account.currency).replace(".", mark);
  }

  /** "Owes you …", "You owe …" or "All square ✅", from this phone's side. */
  balanceText(balance, currency) {
    if (!isCurrency(currency)) return "";
    if (balance > 0) return this.T("owesYou", { amount: this.money(balance, currency) });
    if (balance < 0) return this.T("youOwe", { amount: this.money(-balance, currency) });
    return this.T("even");
  }

  currencyName(code) {
    try {
      return new Intl.DisplayNames(this.lang, { type: "currency" }).of(code) ?? code;
    } catch {
      return code;
    }
  }

  // ---- What the app hands over ----

  async onOpen(opening) {
    this.lang = opening.lang || "en";
    this.mayLive = Boolean(opening.live);
    this.setAttribute("lang", this.lang);
    this.setAttribute("dir", dirOf(this.lang));
    this.metas = await this.keeper.index();
    this.paint();
  }

  // ---- Accounts ----

  /** Puts an account on screen and keeps it on every change, from this phone or from the twin. */
  show(account, { title = "" } = {}) {
    this.account = account;
    this.screen = "account";
    this.status = "off";
    this.editing = null;
    this.editDraft = null;
    this.renaming = false;
    this.settling = false;
    this.invite = null;
    this.badAmount = false;
    this.pendingTitle = typeof title === "string" ? title.slice(0, MAX_NAME) : "";
    this.stops.push(this.keeper.watch(account));
    this.stops.push(account.onChange(() => this.changed()));
    this.paint();
  }

  /** Opens a kept account; if it was shared and this is a conversation, says hello on its own. */
  async enter(id) {
    const account = await this.keeper.load(id);
    if (!account) return;
    this.show(account);
    if (this.mayLive && account.shared && account.peer && !account.readOnly) await this.startLive({ resume: true });
  }

  /** Leaves the account on screen: a bye if live, and everything written. */
  async leave() {
    if (this.session) {
      const session = this.session;
      this.session = null;
      await session.stop();
    }
    this.status = "off";
    for (const stop of this.stops.splice(0)) stop();
    await this.keeper.settled();
    this.account = null;
    this.editing = null;
    this.renaming = false;
    this.settling = false;
  }

  async home() {
    await this.leave();
    this.screen = "home";
    this.metas = await this.keeper.index();
    this.paint();
  }

  // ---- Live ----

  makeSession(account) {
    const session = new LiveSession({
      format: FORMAT,
      app: APP_VERSION,
      doc: account.id,
      who: account.who,
      peer: account.peer,
      replica: yjsReplica(account.doc),
      send: (data) => this.ft.live.send(data),
      onStatus: (status) => {
        if (this.session !== session) return;
        this.status = status;
        this.paintStatus();
      },
      onPeer: (who) => {
        account.peer = who;
        account.shared = true;
        if (account.ready) this.keeper.save(account);
      },
    });
    return session;
  }

  async startLive({ resume = false } = {}) {
    if (!this.account) return;
    this.session ??= this.makeSession(this.account);
    this.paintStatus();
    await this.session.start({ resume, title: this.account.name });
  }

  async toggleLive() {
    if (this.session && (this.status === "joined" || this.status === "waiting")) {
      const session = this.session;
      this.session = null;
      this.status = "off";
      this.paintStatus();
      await session.stop();
      return;
    }
    await this.startLive({ resume: false });
  }

  /** What the twin says: for the live account, or a hello for one that is not live here. */
  async onLive(data) {
    const message = this.inbox.take(data);
    if (!message) return;
    if (this.session && message.doc === this.session.doc) {
      await this.session.hear(message);
      return;
    }
    if (isNewer(message)) {
      if (this.account && this.account.id === message.doc) {
        this.status = "outdated";
        this.paintStatus();
      }
      return;
    }
    if (message.k !== HELLO || !this.mayLive || typeof message.sv !== "string") return;
    const here = this.account && this.account.id === message.doc ? this.account : null;
    const known = here ?? (await this.keeper.load(message.doc));
    // A resumed hello only reopens what this phone shared with that same person.
    if (message.resume && (!known || (known.peer && known.peer !== message.who))) return;
    if (known?.readOnly) return;
    if (this.screen === "account" && this.account && !here) {
      const title = typeof message.title === "string" ? message.title.slice(0, MAX_NAME) : "";
      this.invite = { message, name: known?.name || title || this.T("received") };
      this.paintInvite();
      return;
    }
    await this.join(message, known);
  }

  async join(message, known) {
    let account = known;
    if (!account || account !== this.account) {
      if (this.screen === "account") await this.leave();
      account = known ?? Account.received(message.doc);
      this.show(account, { title: message.title });
    }
    this.session = this.makeSession(account);
    await this.session.hear(message);
  }

  // ---- Clicks and forms ----

  async onClick(event) {
    const target = event.target.closest("button[data-act]");
    if (!target) return;
    const { act, id } = target.dataset;
    switch (act) {
      case "close":
        await this.leave();
        return this.ft.close();
      case "back":
        return this.home();
      case "open":
        return this.enter(id);
      case "delete":
        this.confirming = id;
        return this.paint();
      case "cancelDelete":
        this.confirming = null;
        return this.paint();
      case "confirmDelete":
        this.confirming = null;
        await this.keeper.forget(id);
        this.metas = await this.keeper.index();
        return this.paint();
      case "choose":
        return this.choose(target.dataset);
      case "edit":
        return this.startEdit(id);
      case "cancelEdit":
        this.editing = null;
        return this.paintEntries();
      case "remove": {
        const editing = this.editing;
        this.editing = null;
        if (!this.account?.remove(editing)) this.paintEntries();
        return;
      }
      case "settle":
        this.settling = true;
        return this.paintSummary();
      case "cancelSettle":
        this.settling = false;
        return this.paintSummary();
      case "confirmSettle":
        this.settling = false;
        if (!this.account?.settle()) this.paintSummary();
        return;
      case "rename":
        this.renaming = true;
        this.paintHeader();
        return this.view.querySelector('form[data-form="rename"] input')?.focus?.();
      case "live":
        return this.toggleLive();
      case "send":
        return this.sendSummary();
      case "join": {
        const invite = this.invite;
        this.invite = null;
        if (!invite) return;
        return this.join(invite.message, await this.keeper.load(invite.message.doc));
      }
      case "notNow":
        this.invite = null;
        return this.paintInvite();
      default:
    }
  }

  /** Who paid (`me`, `other`) or the split (`half`, `all`), for a new expense or the one being edited. */
  choose({ scope, field, value }) {
    const draft = scope === "edit" ? this.editDraft : this.draft;
    if (!draft) return;
    if (field === "paid") draft.iPaid = value === "me";
    if (field === "split" && (value === HALF || value === ALL)) draft.split = value;
    this.paintChoices(scope);
  }

  startEdit(id) {
    const one = this.account?.entries().find((entry) => entry.id === id);
    if (!one) return;
    this.editing = id;
    this.editDraft = { iPaid: one.mine, split: one.split };
    this.paintEntries();
    this.view.querySelector('form[data-form="edit"] input')?.focus?.();
  }

  async onSubmit(event) {
    const form = event.target.closest("form[data-form]");
    if (!form) return;
    event.preventDefault();
    const field = (name) => form.querySelector(`[name="${name}"]`);
    const value = field("value")?.value ?? "";
    switch (form.dataset.form) {
      case "new": {
        const currency = field("currency")?.value;
        if (!isCurrency(currency)) return;
        const account = new Account({ name: value, currency });
        await this.keeper.save(account);
        return this.show(account);
      }
      case "add":
        return this.addExpense(field("amount"), field("what"));
      case "edit":
        return this.saveEdit(field("amount").value, field("what").value);
      case "rename":
        this.renaming = false;
        this.account?.rename(value);
        return this.paintHeader();
      case "nick":
        this.account?.setNick(value);
        return;
      default:
    }
  }

  addExpense(amountInput, whatInput) {
    const account = this.account;
    if (!account?.writable) return;
    const amount = parseAmount(amountInput.value, account.currency);
    this.badAmount = amount === null;
    this.paintError();
    if (amount === null) return amountInput.focus?.();
    if (!account.add({ amount, what: whatInput.value, iPaid: this.draft.iPaid, split: this.draft.split })) return whatInput.focus?.();
    amountInput.value = "";
    whatInput.value = "";
    amountInput.focus?.();
  }

  saveEdit(amountText, what) {
    const account = this.account;
    const amount = parseAmount(amountText, account?.currency);
    const node = this.view.querySelector("[data-edit-error]");
    if (amount === null) {
      if (node) node.textContent = this.T("badAmount", { example: this.plainAmount(EXAMPLE) });
      return;
    }
    const editing = this.editing;
    const entry = account.entries().find((one) => one.id === editing);
    const changes = entry?.kind === SETTLE ? {} : { amount, what, ...this.editDraft };
    this.editing = null;
    if (!account.edit(editing, changes)) {
      this.editing = editing;
      this.paintEntries();
      return;
    }
    // Nothing changed: the document says nothing, so put the row back here.
    this.paintEntries();
  }

  onKey(event) {
    if (event.key !== "Escape") return;
    if (this.editing) {
      this.editing = null;
      this.paintEntries();
    } else if (this.renaming) {
      this.renaming = false;
      this.paintHeader();
    }
  }

  /** 📤's text, said by whoever sends it: what was spent, what each paid, and who owes whom. */
  summary() {
    const account = this.account;
    const { total, mine, theirs, balance } = account.totals();
    const owe = balance > 0 ? this.T("sumOwesMe", { amount: this.money(balance) }) : balance < 0 ? this.T("sumIOwe", { amount: this.money(-balance) }) : this.T("sumEven");
    return [`🧾 ${account.name || this.pendingTitle || this.T("untitled")}`, this.T("sumTotal", { amount: this.money(total) }), this.T("sumMine", { amount: this.money(mine) }), this.T("sumTheirs", { amount: this.money(theirs) }), owe].join(" · ");
  }

  /** 📤: the summary in the composer. The app closes the plugin, so leave cleanly first. */
  async sendSummary() {
    if (!this.account?.ready) return;
    const text = this.summary();
    await this.leave();
    this.ft.say(text);
  }

  // ---- Painting ----

  /** A change of the document, from this phone or from the twin. */
  changed() {
    const shape = this.shapeOf();
    if (shape !== this.shape) return this.paint();
    this.paintName();
    this.paintSummary();
    this.paintChoices("add");
    this.paintEntries();
  }

  /** What decides which parts the account screen has: when it changes, the screen is drawn again. */
  shapeOf() {
    return this.account ? `${this.account.ready}/${this.account.readOnly}` : "";
  }

  paint() {
    if (!this.view) return;
    this.shape = this.shapeOf();
    this.view.innerHTML = this.screen === "account" && this.account ? this.accountScreen() : this.homeScreen();
    if (this.screen === "account") {
      this.paintHeader();
      this.paintStatus();
      this.paintWarning();
      this.paintInvite();
      this.paintSummary();
      this.paintChoices("add");
      this.paintError();
      this.paintEntries();
    }
  }

  homeScreen() {
    const T = (key, holes) => this.T(key, holes);
    const chosen = this.metas.find((meta) => isCurrency(meta.currency))?.currency ?? DEFAULT_CURRENCY;
    const options = currencies()
      .map((code) => `<option value="${escape(code)}"${code === chosen ? " selected" : ""}>${escape(`${code} · ${this.currencyName(code)}`)}</option>`)
      .join("");
    const rows = this.metas
      .map((meta) => {
        const name = meta.name || T("untitled");
        if (this.confirming === meta.id) {
          return `<li class="confirm"><span>${escape(T("confirmDelete", { name }))}</span>
            <button type="button" class="danger" data-act="confirmDelete" data-id="${escape(meta.id)}">${escape(T("delete"))}</button>
            <button type="button" data-act="cancelDelete">${escape(T("cancel"))}</button></li>`;
        }
        const balance = Number.isSafeInteger(meta.balance) ? this.balanceText(meta.balance, meta.currency) : "";
        const shared = meta.shared ? ` · 🔄 ${T("shared")}` : "";
        return `<li><button type="button" class="open" data-act="open" data-id="${escape(meta.id)}"><span class="title">${escape(name)}</span><span class="meta">${escape(`${balance}${shared}`)}</span></button>
          ${button("delete", T("delete"), "trash-outline", `data-id="${escape(meta.id)}"`)}</li>`;
      })
      .join("");
    return `
      <div class="bar"><h1 class="grow">${escape(T("title"))}</h1>${button("close", T("close"), "close-outline")}</div>
      <p class="hint">👥 ${escape(T("forTwo"))}</p>
      <form data-form="new"><input name="value" maxlength="${MAX_NAME}" autocomplete="off" placeholder="${escape(T("namePlaceholder"))}" aria-label="${escape(T("newAccount"))}"><select name="currency" aria-label="${escape(T("currency"))}">${options}</select><button type="submit" aria-label="${escape(T("newAccount"))}">${icon("add-outline")}</button></form>
      ${rows ? `<ul>${rows}</ul>` : `<p class="empty">${escape(T("empty"))}</p>`}`;
  }

  accountScreen() {
    const T = (key) => this.T(key);
    const account = this.account;
    const note = account.readOnly ? T("readOnly") : account.ready ? "" : T("waitingData");
    const writable = account.writable;
    return `
      <div class="bar" data-header></div>
      <p class="status" data-status aria-live="polite"></p>
      <p class="hint" data-hint>${escape(this.mayLive ? T("liveHint") : T("needsChat"))}</p>
      <p class="hint">👥 ${escape(T("forTwo"))}</p>
      <p class="warn" data-warning role="alert"></p>
      <p class="note">${escape(note)}</p>
      <div class="invite" data-invite></div>
      <div data-summary aria-live="polite"></div>
      ${
        writable
          ? `<form data-form="add"><div class="row"><input name="amount" inputmode="decimal" autocomplete="off" maxlength="24" placeholder="${escape(T("amount"))}" aria-label="${escape(T("amount"))}"><input name="what" maxlength="${MAX_WHAT}" autocomplete="off" enterkeyhint="done" placeholder="${escape(T("what"))}" aria-label="${escape(T("what"))}"></div>
             <div class="choices" data-choices="add"></div><p class="warn" data-error role="alert"></p>
             <button type="submit" aria-label="${escape(T("add"))}">${icon("add-outline")}</button></form>`
          : ""
      }
      <ul data-entries></ul>
      ${writable ? `<form class="nick" data-form="nick"><input name="value" maxlength="${MAX_NICK}" autocomplete="off" value="${escape(account.nick)}" placeholder="${escape(T("nick"))}" aria-label="${escape(T("nick"))}"><button type="submit" aria-label="${escape(T("save"))}">${icon("checkmark-outline")}</button></form>` : ""}`;
  }

  paintHeader() {
    const header = this.view?.querySelector("[data-header]");
    if (!header || !this.account) return;
    const T = (key) => this.T(key);
    const account = this.account;
    const live = this.session && (this.status === "joined" || this.status === "waiting");
    const title = this.renaming
      ? `<form class="wide" data-form="rename"><input name="value" maxlength="${MAX_NAME}" autocomplete="off" value="${escape(account.name)}" aria-label="${escape(T("rename"))}"><button type="submit" aria-label="${escape(T("save"))}">${icon("checkmark-outline")}</button></form>`
      : `<h1 class="grow" data-name>${escape(this.nameOf())}</h1>`;
    header.innerHTML = `
      ${button("back", T("back"), "arrow-back-outline")}
      ${title}
      ${!this.renaming && account.writable ? button("rename", T("rename"), "pencil-outline") : ""}
      ${this.mayLive && !account.readOnly ? `<button type="button" data-act="live" class="${live ? "on" : ""}" aria-pressed="${live ? "true" : "false"}" aria-label="${escape(live ? T("stopLive") : T("live"))}">🔄 ${escape(T("live"))}</button>` : ""}
      ${account.ready ? button("send", T("send"), "send-outline") : ""}
      ${button("close", T("close"), "close-outline")}`;
  }

  nameOf() {
    return this.account.name || this.pendingTitle || this.T("untitled");
  }

  paintName() {
    const name = this.renaming ? null : this.view?.querySelector("[data-name]");
    if (name) name.textContent = this.nameOf();
  }

  paintStatus() {
    this.paintHeader();
    const node = this.view?.querySelector("[data-status]");
    if (!node) return;
    const T = (key) => this.T(key);
    const texts = {
      waiting: T("waiting"),
      joined: T("joined"),
      silent: `${T("silent")} ${T("kept")}`,
      unreachable: `${T("unreachable")} ${T("kept")}`,
      left: `${T("left")} ${T("kept")}`,
      outdated: T("outdated"),
    };
    node.textContent = texts[this.status] ?? "";
  }

  paintWarning() {
    const node = this.view?.querySelector("[data-warning]");
    if (node) node.textContent = this.keeper.full ? this.T("full") : "";
  }

  paintError() {
    const node = this.view?.querySelector("[data-error]");
    if (node) node.textContent = this.badAmount && this.account ? this.T("badAmount", { example: this.plainAmount(EXAMPLE) }) : "";
  }

  paintInvite() {
    const node = this.view?.querySelector("[data-invite]");
    if (!node) return;
    if (!this.invite) {
      node.innerHTML = "";
      return;
    }
    node.innerHTML = `<span>${escape(this.T("joinPrompt", { name: this.invite.name }))}</span>
      <button type="button" data-act="join">${escape(this.T("join"))}</button>
      <button type="button" data-act="notNow">${escape(this.T("notNow"))}</button>`;
  }

  /** The balance, what was spent, and "💸 Settle up" (asked inside the plugin, never with confirm()). */
  paintSummary() {
    const node = this.view?.querySelector("[data-summary]");
    const account = this.account;
    if (!node || !account) return;
    if (!account.ready) {
      node.innerHTML = "";
      return;
    }
    const T = (key, holes) => this.T(key, holes);
    const { total, balance } = account.totals();
    if (balance === 0) this.settling = false;
    let settle = "";
    if (this.settling && account.writable) {
      const ask = balance > 0 ? T("settleTheyPay", { amount: this.money(balance) }) : T("settleYouPay", { amount: this.money(-balance) });
      settle = `<div class="confirm"><span>${escape(ask)}</span>
        <button type="button" data-act="confirmSettle">${escape(T("settle"))}</button>
        <button type="button" data-act="cancelSettle">${escape(T("cancel"))}</button></div>`;
    } else if (balance !== 0 && account.writable) {
      settle = `<button type="button" data-act="settle">${escape(T("settle"))}</button>`;
    }
    node.innerHTML = `<p class="balance" data-balance>${escape(this.balanceText(balance, account.currency))}</p>
      <p class="meta" data-total>${escape(T("total", { amount: this.money(total) }))}</p>${settle}`;
  }

  /** Labels from this phone's side: who paid, and for whom it all is. */
  paidLabel(mine) {
    const other = this.account.otherNick;
    if (mine) return this.T("iPaid");
    return other ? this.T("nickPaid", { name: other }) : this.T("otherPaid");
  }

  splitLabel(mine, split) {
    if (split === HALF) return this.T("half");
    if (!mine) return this.T("allForMe");
    const other = this.account.otherNick;
    return other ? this.T("allForNick", { name: other }) : this.T("allForOther");
  }

  choicesOf(scope, draft) {
    const choice = (field, value, on, label) =>
      `<button type="button" data-act="choose" data-scope="${scope}" data-field="${field}" data-value="${value}" class="${on ? "on" : ""}" aria-pressed="${on}">${escape(label)}</button>`;
    return [
      choice("paid", "me", draft.iPaid, this.paidLabel(true)),
      choice("paid", "other", !draft.iPaid, this.paidLabel(false)),
      choice("split", HALF, draft.split === HALF, this.splitLabel(draft.iPaid, HALF)),
      choice("split", ALL, draft.split === ALL, this.splitLabel(draft.iPaid, ALL)),
    ].join("");
  }

  paintChoices(scope) {
    const node = this.view?.querySelector(`[data-choices="${scope}"]`);
    const draft = scope === "edit" ? this.editDraft : this.draft;
    if (node && draft && this.account) node.innerHTML = this.choicesOf(scope, draft);
  }

  paintEntries() {
    const node = this.view?.querySelector("[data-entries]");
    const account = this.account;
    if (!node || !account) return;
    const entries = account.entries();
    if (this.editing && !entries.some((one) => one.id === this.editing)) this.editing = null;
    // What is being typed in the row being edited survives a change from the other phone.
    const form = node.querySelector('form[data-form="edit"]');
    const draft = form && form.closest("li")?.dataset.editing === this.editing ? { amount: form.querySelector('[name="amount"]')?.value, what: form.querySelector('[name="what"]')?.value } : null;
    const T = (key) => this.T(key);
    const writable = account.writable;
    const rows = entries.map((one) => {
      const settlement = one.kind === SETTLE;
      if (one.id === this.editing && writable) {
        const fields = settlement
          ? ""
          : `<div class="row"><input name="amount" inputmode="decimal" autocomplete="off" maxlength="24" value="${escape(this.plainAmount(one.amount))}" aria-label="${escape(T("amount"))}"><input name="what" maxlength="${MAX_WHAT}" autocomplete="off" value="${escape(one.what)}" aria-label="${escape(T("what"))}"></div>
             <div class="choices" data-choices="edit"></div><p class="warn" data-edit-error role="alert"></p>
             <button type="submit" aria-label="${escape(T("save"))}">${icon("checkmark-outline")}</button>`;
        return `<li data-editing="${escape(one.id)}"><form class="wide" data-form="edit">${fields}
          ${button("remove", T("remove"), "trash-outline", 'class="danger"')}${button("cancelEdit", T("cancel"), "close-outline")}</form></li>`;
      }
      const what = settlement ? T("settled") : one.what;
      const who = settlement ? this.paidLabel(one.mine) : `${this.paidLabel(one.mine)} · ${this.splitLabel(one.mine, one.split)}`;
      const edit = writable ? button("edit", T("edit"), "pencil-outline", `class="plain" data-id="${escape(one.id)}"`) : "";
      return `<li data-entry="${escape(one.id)}" data-kind="${one.kind}"><div class="main"><span class="what">${escape(what)}</span><span class="who">${escape(who)}</span></div><span class="amount">${escape(this.money(one.amount))}</span>${edit}</li>`;
    });
    node.innerHTML = rows.length ? rows.join("") : account.ready ? `<li class="empty">${escape(T("noExpenses"))}</li>` : "";
    this.paintChoices("edit");
    if (draft) {
      const again = node.querySelector('form[data-form="edit"]');
      if (again?.querySelector('[name="amount"]') && draft.amount !== undefined) again.querySelector('[name="amount"]').value = draft.amount;
      if (again?.querySelector('[name="what"]') && draft.what !== undefined) again.querySelector('[name="what"]').value = draft.what;
    }
  }
}

if (typeof customElements !== "undefined" && !customElements.get("ft-split")) customElements.define("ft-split", SplitElement);
