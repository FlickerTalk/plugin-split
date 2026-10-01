// Keeping accounts in `ft.records`, the plugin's own room on this phone (4 MB, `storage: small`).
// The plugin is never told it is being closed (finding 5 of the plan), so an account is written
// after every change: the body (the whole Yjs document) first, then the meta. Saves go one after
// another; changes that arrive while one is on its way are written together right after it.
// A write the core refuses (the quota is full) leaves the account on screen and says so.
// The same keeper as List's `store.js`, over accounts.

import { Account, PREFIX, bodyKey, metaKey } from "./model.js";

const KEY = /^split\/([^/]+)\/(meta|body)$/;

export class Keeper {
  constructor(records) {
    this.records = records;
    this.full = false;
    this.listeners = new Set();
    this.dirty = new Map();
    this.running = null;
  }

  /** Hears the quota filling up (`true`) and having room again (`false`). */
  onFull(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Saves the account on every change of its document, from this phone or from the twin. */
  watch(account) {
    return account.onChange(() => {
      this.save(account);
    });
  }

  /** Saves an account; resolves true once it and everything queued with it are written. */
  save(account) {
    this.dirty.set(account.id, account);
    this.running ??= this.drain();
    return this.running;
  }

  /** Resolves when nothing is waiting to be written. */
  settled() {
    return this.running ?? Promise.resolve(!this.full);
  }

  async drain() {
    let ok = true;
    while (this.dirty.size) {
      const [id, account] = this.dirty.entries().next().value;
      this.dirty.delete(id);
      ok = await this.write(account);
    }
    this.running = null;
    return ok;
  }

  async write(account) {
    let ok = false;
    try {
      ok = (await this.records.set(bodyKey(account.id), account.body())) === true && (await this.records.set(metaKey(account.id), account.meta())) === true;
    } catch {
      ok = false;
    }
    if (this.full === ok) {
      this.full = !ok;
      for (const listener of this.listeners) listener(this.full);
    }
    return ok;
  }

  /** What the list of accounts shows: every kept account's meta, newest first. */
  async index() {
    let keys = [];
    try {
      keys = (await this.records.keys(PREFIX)) || [];
    } catch {
      keys = [];
    }
    const ids = new Set();
    for (const key of keys) {
      const match = KEY.exec(key);
      if (match) ids.add(match[1]);
    }
    const metas = [];
    for (const id of ids) {
      const meta = await this.readMeta(id);
      if (meta) metas.push(meta);
    }
    return metas.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  }

  async readMeta(id) {
    try {
      const meta = JSON.parse(await this.records.get(metaKey(id)));
      if (meta && typeof meta === "object" && meta.id === id && typeof meta.name === "string") return meta;
    } catch {
      // A broken meta: the body still says what the account is.
    }
    const account = await this.load(id);
    return account ? JSON.parse(account.meta()) : null;
  }

  /** A kept account, or null. */
  async load(id) {
    try {
      const body = await this.records.get(bodyKey(id));
      const meta = await this.records.get(metaKey(id));
      return Account.parse(id, body, meta);
    } catch {
      return null;
    }
  }

  async forget(id) {
    this.dirty.delete(id);
    await this.settled();
    await this.records.forget(bodyKey(id));
    await this.records.forget(metaKey(id));
  }
}
