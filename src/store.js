// Never told when the plugin closes, so an account is written after every change, body first.
// A keeper only sees its own place, so an account kept in another conversation doesn't exist for it.

import { Account, bodyKey, metaKey, placePrefix } from "./model.js";

export class Keeper {
  constructor(records, place) {
    this.records = records;
    this.place = place;
    this.prefix = placePrefix(place);
    this.full = false;
    this.listeners = new Set();
    this.dirty = new Map();
    this.running = null;
  }

  onFull(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  watch(account) {
    return account.onChange(() => {
      this.save(account);
    });
  }

  save(account) {
    this.dirty.set(account.id, account);
    this.running ??= this.drain();
    return this.running;
  }

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
      ok = (await this.records.set(bodyKey(this.place, account.id), account.body())) === true && (await this.records.set(metaKey(this.place, account.id), account.meta())) === true;
    } catch {
      ok = false;
    }
    if (this.full === ok) {
      this.full = !ok;
      for (const listener of this.listeners) listener(this.full);
    }
    return ok;
  }

  async index() {
    let keys = [];
    try {
      keys = (await this.records.keys(this.prefix)) || [];
    } catch {
      keys = [];
    }
    const ids = new Set();
    for (const key of keys) {
      if (typeof key !== "string" || !key.startsWith(this.prefix)) continue;
      const match = /^([^/]+)\/(meta|body)$/.exec(key.slice(this.prefix.length));
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
      const meta = JSON.parse(await this.records.get(metaKey(this.place, id)));
      if (meta && typeof meta === "object" && meta.id === id && typeof meta.name === "string") return meta;
    } catch {
    }
    const account = await this.load(id);
    return account ? JSON.parse(account.meta()) : null;
  }

  async load(id) {
    try {
      const body = await this.records.get(bodyKey(this.place, id));
      const meta = await this.records.get(metaKey(this.place, id));
      return Account.parse(id, body, meta);
    } catch {
      return null;
    }
  }

  async forget(id) {
    this.dirty.delete(id);
    await this.settled();
    await this.records.forget(bodyKey(this.place, id));
    await this.records.forget(metaKey(this.place, id));
  }
}
