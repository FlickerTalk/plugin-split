// The common live protocol of FlickerTalk's plugins (plan-plugins-nuevos §4): what a plugin says to
// its twin, the same plugin open in the same conversation on the other phone, over `ft.live`. The
// core carries it only over the direct connection, encrypted like every message, never through the
// mailbox, and drops it without a word when the twin is not open there. So:
//
// - every message is an envelope `{ p, v, k, doc, who, app, … }` as JSON → UTF-8 → base64, where
//   `p` is the plugin's format (anything else is ignored), `v` the protocol version, `k` the kind,
//   `doc` the document, `who` a random id of the participant for that document, `app` the
//   plugin's version (only to say "update"); `doc`, `who` and a part's `id` are 1 to 64 of
//   `A-Z a-z 0-9 _ -` (`ID`), or the message is dropped;
// - kinds: `hello` (what I have; waits ~8 s for an answer), `sync` (what you lack, and what I
//   have when it answers a hello), `update` (a change as it happens), `part` (a piece of what does
//   not fit in the core's 48 KiB), `bye`. Unknown kinds and fields are ignored; a newer `v` is
//   never applied, the plugin says "update" instead;
// - it speaks only when the user asks (going live, or entering something already shared): a hello
//   with no connection wakes the other phone and can take 12 s.
//
// Nothing here knows what is kept. A plugin hands a `replica`:
//   have() → string            what this side has (a Yjs state vector in base64, a hash, …)
//   missing(have) → string|null what the side that has `have` lacks; null when nothing
//   apply(payload)             takes what the twin sent; throws on garbage
//   onChange(fn) → unsubscribe  calls fn(payload) for each change made on this phone, never for
//                               what `apply` took
// Wiring, in a plugin: `ft.live.onMessage(inOrder(async (data) => { const message = inbox.take(data);
// … session.hear(message) … }))`, with one `Inbox` per plugin and one `LiveSession` per document.
// Copy this file as it is; the format name is a parameter.

/** The version of the protocol this file speaks. A newer version must keep reading 1. */
export const VERSION = 1;
/** How long a hello waits for an answer before saying the other side is not there. */
export const ACK_WAIT = 8_000;
/** What one message may carry of a bigger one, in base64 characters, under the core's 48 KiB. */
export const PART_SIZE = 40_000;

export const HELLO = "hello";
export const SYNC = "sync";
export const UPDATE = "update";
export const PART = "part";
export const BYE = "bye";

const KINDS = new Set([HELLO, SYNC, UPDATE, BYE]);

/**
 * The shape of a document, participant or part id. What the twin sends is untrusted input, and a
 * document id ends up in record keys (`list/<doc>/meta`): anything else is dropped as garbage.
 */
export const ID = /^[A-Za-z0-9_-]{1,64}$/;
export const isId = (value) => typeof value === "string" && ID.test(value);

/** Bytes as base64 and back: what `ft.live` and `ft.records` carry. */
export function toBase64(bytes) {
  let text = "";
  for (let at = 0; at < bytes.length; at += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return btoa(text);
}

export function fromBase64(text) {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let at = 0; at < raw.length; at += 1) bytes[at] = raw.charCodeAt(at);
  return bytes;
}

/** A random id for this participant in one document: two contacts cannot cross them. */
export function newWho() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((one) => one.toString(16).padStart(2, "0")).join("");
}

/** An envelope as it travels. */
export function encode(message) {
  return toBase64(new TextEncoder().encode(JSON.stringify(message)));
}

/** An envelope read back; null when it is garbage, of another format, or lacks what all have. */
export function decode(data, format) {
  if (typeof data !== "string") return null;
  let message;
  try {
    message = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(fromBase64(data)));
  } catch {
    return null;
  }
  if (!message || typeof message !== "object" || Array.isArray(message)) return null;
  if (message.p !== format || !Number.isInteger(message.v) || message.v < 1) return null;
  if (typeof message.k !== "string" || !isId(message.doc) || !isId(message.who)) return null;
  return message;
}

/** Whether a message speaks a newer protocol than this one: then it is not applied. */
export function isNewer(message) {
  return Boolean(message) && message.v > VERSION;
}

/**
 * Wraps the handler of `ft.live.onMessage` so messages are handled one after another, in the
 * order they came: the frame hands each one over without waiting for the one before. A handler
 * that fails does not stop the next.
 */
export function inOrder(handler) {
  let chain = Promise.resolve();
  return (...args) => {
    chain = chain.then(() => handler(...args)).catch(() => {});
    return chain;
  };
}

const partId = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 36 ** 6).toString(36)}`;

/** A message ready for `ft.live.send`: one, or several parts when it is too big for one. */
export function split(message) {
  const whole = encode(message);
  if (whole.length <= PART_SIZE) return [whole];
  const { p, v, doc, who, app } = message;
  const id = partId();
  const n = Math.ceil(whole.length / PART_SIZE);
  const parts = [];
  for (let i = 0; i < n; i += 1) parts.push(encode({ p, v, k: PART, doc, who, app, id, n, i, data: whole.slice(i * PART_SIZE, (i + 1) * PART_SIZE) }));
  return parts;
}

/**
 * What arrives, read: garbage and other formats are dropped, parts are put back together. A
 * message of a newer version comes out as it is, so the plugin can say "update".
 */
export class Inbox {
  constructor(format, { maxPending = 8, maxParts = 512 } = {}) {
    this.format = format;
    this.maxPending = maxPending;
    this.maxParts = maxParts;
    this.pending = new Map();
  }

  take(data) {
    const message = decode(data, this.format);
    if (!message) return null;
    if (isNewer(message) || message.k !== PART) return message;
    const { id, n, i, data: chunk } = message;
    if (!isId(id) || typeof chunk !== "string") return null;
    if (!Number.isInteger(n) || n < 1 || n > this.maxParts || !Number.isInteger(i) || i < 0 || i >= n) return null;
    const key = `${message.who}\u0000${message.doc}\u0000${id}`;
    let entry = this.pending.get(key);
    if (!entry) {
      entry = { n, parts: new Array(n).fill(null), count: 0 };
      this.pending.set(key, entry);
      while (this.pending.size > this.maxPending) this.pending.delete(this.pending.keys().next().value);
    }
    if (entry.n !== n) return null;
    if (entry.parts[i] === null) {
      entry.parts[i] = chunk;
      entry.count += 1;
    }
    if (entry.count < n) return null;
    this.pending.delete(key);
    const whole = decode(entry.parts.join(""), this.format);
    if (!whole || whole.k === PART || whole.doc !== message.doc || whole.who !== message.who) return null;
    return whole;
  }
}

/**
 * The live session of one document with its twin. Statuses, told through `onStatus`:
 * `waiting` (hello sent), `joined` (the twin answered: changes travel), `silent` (no answer in
 * `ackWait`: it may not have the plugin, may not have allowed it, or may have it closed),
 * `unreachable` (the core could not send: no connection), `left` (the twin said bye),
 * `outdated` (the twin speaks a newer version). Only `joined` sends changes; what is done
 * meanwhile goes in the next hello and sync, so nothing is lost and nothing wakes the other phone.
 *
 * `peer` is the twin's `who` once known. A hello that resumes a document is answered only from
 * the known twin, and when this side resumes, only the known twin's answer is taken: entering a
 * shared document from another conversation gives nothing to whoever is there.
 */
export class LiveSession {
  constructor({ format, app, doc, who, peer = null, replica, send, ackWait = ACK_WAIT, onStatus = () => {}, onPeer = () => {} }) {
    this.format = format;
    this.app = app;
    this.doc = doc;
    this.who = who;
    this.peer = peer;
    this.replica = replica;
    this.send = send;
    this.ackWait = ackWait;
    this.onStatus = onStatus;
    this.onPeer = onPeer;
    this.status = "off";
    this.mode = "share";
    this.timer = null;
    this.closed = false;
    this.chain = Promise.resolve(true);
    this.unwatch = replica.onChange((payload) => this.changed(payload));
  }

  envelope(k, fields = {}) {
    return { p: this.format, v: VERSION, k, doc: this.doc, who: this.who, app: this.app, ...fields };
  }

  setStatus(status, detail) {
    if (this.closed || (status === this.status && detail === undefined)) return;
    this.status = status;
    this.onStatus(status, detail);
  }

  /** Sends a message, in parts if it must, after whatever is on its way. True if all of it left. */
  say(message) {
    this.chain = this.chain.then(async () => {
      for (const part of split(message)) {
        let left = false;
        try {
          left = Boolean(await this.send(part));
        } catch {
          left = false;
        }
        if (!left) return false;
      }
      return true;
    });
    return this.chain;
  }

  /** Says hello: the user went live (`resume` false), or entered a document already shared. */
  async start({ resume = false, title } = {}) {
    if (this.closed) return false;
    this.mode = resume ? "resume" : "share";
    this.clearTimer();
    this.setStatus("waiting");
    const fields = { sv: this.replica.have() };
    if (resume) fields.resume = true;
    else if (typeof title === "string" && title) fields.title = title;
    const left = await this.say(this.envelope(HELLO, fields));
    if (this.closed) return left;
    if (!left) {
      if (this.status === "waiting") this.setStatus("unreachable");
      return false;
    }
    if (this.status === "waiting") {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.status === "waiting") this.setStatus("silent");
      }, this.ackWait);
    }
    return true;
  }

  accepts(message) {
    if (message.who === this.who) return false;
    if (!this.peer || message.who === this.peer) return true;
    if (message.k === HELLO && !message.resume) return true;
    return message.k === SYNC && this.mode === "share" && this.status === "waiting";
  }

  learn(who) {
    if (who === this.peer) return;
    this.peer = who;
    this.onPeer(who);
  }

  /** What the twin said, read by an `Inbox`. Returns the kind it took, or null if it ignored it. */
  async hear(message) {
    if (this.closed || !message || message.doc !== this.doc) return null;
    if (isNewer(message)) {
      this.setStatus("outdated", { app: typeof message.app === "string" ? message.app : null });
      return null;
    }
    if (!KINDS.has(message.k) || !this.accepts(message)) return null;
    if (message.k === HELLO) return this.heardHello(message);
    if (message.k === SYNC) return this.heardSync(message);
    if (message.k === UPDATE) return this.heardUpdate(message);
    this.clearTimer();
    this.setStatus("left");
    return BYE;
  }

  async heardHello(message) {
    if (typeof message.sv !== "string") return null;
    let missing;
    try {
      missing = this.replica.missing(message.sv);
    } catch {
      return null;
    }
    this.learn(message.who);
    this.clearTimer();
    this.setStatus("joined");
    const fields = { sv: this.replica.have() };
    if (missing) fields.u = missing;
    if (!(await this.say(this.envelope(SYNC, fields)))) this.setStatus("unreachable");
    return HELLO;
  }

  async heardSync(message) {
    if ((message.u !== undefined && typeof message.u !== "string") || (message.sv !== undefined && typeof message.sv !== "string")) return null;
    if (typeof message.u === "string") {
      try {
        this.replica.apply(message.u);
      } catch {
        return null;
      }
    }
    this.learn(message.who);
    this.clearTimer();
    this.setStatus("joined");
    if (typeof message.sv === "string") {
      let missing = null;
      try {
        missing = this.replica.missing(message.sv);
      } catch {
        missing = null;
      }
      if (missing && !(await this.say(this.envelope(SYNC, { u: missing })))) this.setStatus("unreachable");
    }
    return SYNC;
  }

  async heardUpdate(message) {
    if (typeof message.u !== "string") return null;
    try {
      this.replica.apply(message.u);
    } catch {
      return null;
    }
    // The twin is there again after this side lost it: catch up with a hello.
    if (["unreachable", "silent", "left"].includes(this.status) && message.who === this.peer) await this.start({ resume: true });
    return UPDATE;
  }

  /** A change made on this phone: sent at once when joined; otherwise the next sync carries it. */
  changed(payload) {
    if (this.closed || this.status !== "joined") return;
    this.say(this.envelope(UPDATE, { u: payload })).then((left) => {
      if (!left && this.status === "joined") this.setStatus("unreachable");
    });
  }

  clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** The user stops the live session or leaves the document: a bye if anyone is listening. */
  async stop() {
    if (!this.closed && (this.status === "joined" || this.status === "waiting")) await this.say(this.envelope(BYE));
    this.close();
  }

  close() {
    this.closed = true;
    this.clearTimer();
    this.unwatch?.();
  }
}
