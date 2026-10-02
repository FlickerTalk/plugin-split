// The common live protocol (plan-plugins-nuevos §4), apart from any plugin: the envelope, the
// parts, the versions, the garbage, the hello that waits ~8 s for an answer, and two phones that
// meet, part and meet again. The replica here is a plain set of strings, not Yjs, to show that
// the protocol does not care what is kept. Copy this file with `src/live.js` and
// `test/fake-core.js`; it names nothing of List.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACK_WAIT, BYE, HELLO, Inbox, LiveSession, PART, PART_SIZE, SYNC, UPDATE, VERSION, decode, encode, fromBase64, inOrder, isNewer, newWho, split, toBase64 } from "../src/live.js";
import { LIVE_LIMIT, connect, fakeCore } from "./fake-core.js";

const FORMAT = "fttest";
const base = (fields) => ({ p: FORMAT, v: VERSION, doc: "d1", who: "w-a", app: "1.0.0", ...fields });

/** A replica that is a set of strings: `have` is the sorted set, a payload a list of strings. */
class SetReplica {
  constructor(items = []) {
    this.items = new Set(items);
    this.listeners = new Set();
  }
  add(item) {
    this.items.add(item);
    for (const listener of this.listeners) listener(JSON.stringify([item]));
  }
  have() {
    return JSON.stringify([...this.items].sort());
  }
  missing(have) {
    const theirs = new Set(JSON.parse(have));
    const lack = [...this.items].filter((item) => !theirs.has(item));
    return lack.length ? JSON.stringify(lack) : null;
  }
  apply(payload) {
    const items = JSON.parse(payload);
    if (!Array.isArray(items)) throw new Error("not a payload");
    for (const item of items) this.items.add(item);
  }
  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  sorted() {
    return [...this.items].sort();
  }
}

/** One phone as a plugin would wire it: an inbox, and a session made when a hello arrives. */
function phone(core, replica, { doc = "d1", who, peer = null, ackWait } = {}) {
  const inbox = new Inbox(FORMAT);
  const statuses = [];
  const peers = [];
  let session = null;
  const make = () =>
    new LiveSession({
      format: FORMAT,
      app: "1.0.0",
      doc,
      who,
      peer,
      replica,
      ackWait,
      send: (data) => core.ft.live.send(data),
      onStatus: (status) => statuses.push(status),
      onPeer: (them) => peers.push(them),
    });
  core.ft.live.onMessage(async (data) => {
    const message = inbox.take(data);
    if (!message || message.doc !== doc) return;
    if (!session) {
      if (message.k !== HELLO) return;
      session = make();
    }
    await session.hear(message);
  });
  return {
    replica,
    statuses,
    peers,
    get session() {
      return session;
    },
    start(options) {
      session ??= make();
      return session.start(options);
    },
  };
}

async function pair({ a = [], b = [] } = {}) {
  const coreA = fakeCore();
  const coreB = fakeCore();
  const link = connect(coreA, coreB);
  await coreA.open({ live: true });
  await coreB.open({ live: true });
  const one = phone(coreA, new SetReplica(a), { who: "w-a" });
  const two = phone(coreB, new SetReplica(b), { who: "w-b" });
  return { coreA, coreB, link, one, two };
}

afterEach(() => vi.useRealTimers());

describe("the envelope", () => {
  it("is JSON in UTF-8 in base64, with format, version, kind, document, participant and app", () => {
    const message = base({ k: HELLO, title: "Compra 🛒 قائمة" });
    const data = encode(message);
    expect(typeof data).toBe("string");
    expect(JSON.parse(new TextDecoder().decode(fromBase64(data)))).toEqual(message);
    expect(decode(data, FORMAT)).toEqual(message);
    expect(fromBase64(toBase64(new Uint8Array([0, 1, 255])))).toEqual(new Uint8Array([0, 1, 255]));
  });

  it("is null for garbage, another format, or a message without what every message has", () => {
    expect(decode("%%% not base64", FORMAT)).toBeNull();
    expect(decode(toBase64(new TextEncoder().encode("not json")), FORMAT)).toBeNull();
    expect(decode(encode([1, 2]), FORMAT)).toBeNull();
    expect(decode(encode(null), FORMAT)).toBeNull();
    expect(decode(encode(base({ k: HELLO, p: "ftother" })), FORMAT)).toBeNull();
    expect(decode(encode(base({ k: HELLO, p: undefined })), FORMAT)).toBeNull();
    expect(decode(encode(base({ k: 7 })), FORMAT)).toBeNull();
    expect(decode(encode(base({ k: HELLO, doc: 3 })), FORMAT)).toBeNull();
    expect(decode(encode(base({ k: HELLO, who: undefined })), FORMAT)).toBeNull();
    expect(decode(encode(base({ k: HELLO, v: 0 })), FORMAT)).toBeNull();
    expect(decode(encode(base({ k: HELLO, v: "1" })), FORMAT)).toBeNull();
    expect(decode(encode(base({ k: HELLO, v: 1.5 })), FORMAT)).toBeNull();
    expect(decode(undefined, FORMAT)).toBeNull();
  });

  it("refuses a document or participant id outside a closed format: they become record keys", () => {
    for (const bad of ["a/b", "", "x".repeat(65), "two words", "nul\u0000", "dot.dot", "../up", "ü"]) {
      expect(decode(encode(base({ k: HELLO, doc: bad })), FORMAT), `doc ${JSON.stringify(bad)}`).toBeNull();
      expect(decode(encode(base({ k: HELLO, who: bad })), FORMAT), `who ${JSON.stringify(bad)}`).toBeNull();
    }
    for (const good of ["x", "x".repeat(64), "0000abcdefxyz12", "A-b_9", newWho()]) {
      expect(decode(encode(base({ k: HELLO, doc: good, who: good })), FORMAT)).not.toBeNull();
    }
    // A part's id too, and a whole put back together must meet the same rules.
    const inbox = new Inbox(FORMAT);
    expect(inbox.take(encode(base({ k: PART, id: "a/b", n: 1, i: 0, data: encode(base({ k: HELLO })) })))).toBeNull();
    expect(inbox.take(encode(base({ k: PART, id: "x".repeat(65), n: 1, i: 0, data: encode(base({ k: HELLO })) })))).toBeNull();
    expect(inbox.take(encode(base({ k: PART, id: "ok", n: 1, i: 0, data: encode(base({ k: HELLO })) })))).toMatchObject({ k: HELLO });
  });

  it("keeps fields it does not know, so a newer twin's extras do no harm", () => {
    expect(decode(encode(base({ k: HELLO, later: { x: 1 } })), FORMAT).later).toEqual({ x: 1 });
  });

  it("gives every participant a fresh random id", () => {
    const one = newWho();
    expect(one).toMatch(/^[0-9a-f]{32}$/);
    expect(newWho()).not.toBe(one);
  });
});

describe("the parts", () => {
  it("cut what does not fit in one message, each part a whole envelope under the core's limit", () => {
    const message = base({ k: SYNC, u: "x".repeat(150_000) + "ü€🛒" });
    const parts = split(message);
    expect(parts.length).toBeGreaterThan(3);
    for (const part of parts) {
      expect(fromBase64(part).length).toBeLessThanOrEqual(LIVE_LIMIT);
      expect(decode(part, FORMAT)).toMatchObject({ p: FORMAT, v: VERSION, k: PART, doc: "d1", who: "w-a" });
    }
    expect(split(base({ k: HELLO }))).toHaveLength(1);
    expect(PART_SIZE).toBeLessThan(LIVE_LIMIT);
  });

  it("are put back together in any order, once, and a broken part is ignored", () => {
    const message = base({ k: SYNC, u: "y".repeat(100_000) });
    const parts = split(message);
    const inbox = new Inbox(FORMAT);
    const shuffled = [...parts].reverse();
    const results = shuffled.map((part) => inbox.take(part));
    expect(results.slice(0, -1).every((one) => one === null)).toBe(true);
    expect(results.at(-1)).toEqual(message);
    // The same part again starts nothing whole.
    expect(inbox.take(parts[0])).toBeNull();
    // Out of range, missing fields, absurd counts.
    expect(inbox.take(encode(base({ k: PART, id: "z", n: 2, i: 5, data: "" })))).toBeNull();
    expect(inbox.take(encode(base({ k: PART, id: "z", n: 2, i: 1 })))).toBeNull();
    expect(inbox.take(encode(base({ k: PART, id: "z", n: 1e9, i: 0, data: "" })))).toBeNull();
    expect(inbox.take(encode(base({ k: PART, id: "z", n: 2, i: 0.5, data: "" })))).toBeNull();
    // Parts whose whole is garbage give nothing.
    expect(inbox.take(encode(base({ k: PART, id: "g", n: 1, i: 0, data: "!!!" })))).toBeNull();
  });

  it("do not pile up without end: the oldest half-message is dropped", () => {
    const inbox = new Inbox(FORMAT, { maxPending: 2 });
    const first = split(base({ k: SYNC, u: "a".repeat(90_000) }));
    const second = split(base({ k: SYNC, u: "b".repeat(90_000) }));
    const third = split(base({ k: SYNC, u: "c".repeat(90_000) }));
    inbox.take(first[0]);
    inbox.take(second[0]);
    inbox.take(third[0]);
    for (const part of first.slice(1)) expect(inbox.take(part)).toBeNull();
    let whole = null;
    for (const part of third.slice(1)) whole = inbox.take(part) ?? whole;
    expect(whole.u).toBe("c".repeat(90_000));
  });
});

describe("handling what arrives", () => {
  it("goes one message after another, in order, even when one is slow or fails", async () => {
    const done = [];
    const handle = inOrder(async (name, wait) => {
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (name === "broken") throw new Error("broken");
      done.push(name);
    });
    // The frame calls the handler for each message without waiting for the one before.
    const all = [handle("first", 20), handle("broken", 0), handle("second", 0)];
    await Promise.all(all);
    expect(done).toEqual(["first", "second"]);
  });
});

describe("the versions", () => {
  it("passes a newer message on untouched, so the plugin can say to update, and never applies it", async () => {
    const newer = encode(base({ k: UPDATE, v: VERSION + 1, u: JSON.stringify(["from the future"]) }));
    const inbox = new Inbox(FORMAT);
    const message = inbox.take(newer);
    expect(isNewer(message)).toBe(true);
    expect(isNewer(base({ k: HELLO }))).toBe(false);
    // Parts of a newer version are not put together: their shape may have changed.
    const newerPart = encode(base({ k: PART, v: VERSION + 1, id: "n", n: 1, i: 0, data: "" }));
    expect(isNewer(inbox.take(newerPart))).toBe(true);

    const core = fakeCore();
    await core.open({ live: true });
    const replica = new SetReplica();
    const statuses = [];
    const session = new LiveSession({ format: FORMAT, app: "1.0.0", doc: "d1", who: "w-b", replica, send: core.ft.live.send, onStatus: (status, detail) => statuses.push([status, detail]) });
    expect(await session.hear({ ...message, app: "2.0.0" })).toBeNull();
    expect(replica.sorted()).toEqual([]);
    expect(statuses).toEqual([["outdated", { app: "2.0.0" }]]);
    expect(core.sent).toHaveLength(0);
  });
});

describe("two phones", () => {
  it("meet: a hello, a sync each way, and both have everything", async () => {
    const { link, one, two } = await pair({ a: ["milk"], b: ["bread"] });
    expect(await one.start()).toBe(true);
    expect(one.statuses[0]).toBe("waiting");
    await link.idle();
    expect(one.statuses).toEqual(["waiting", "joined"]);
    expect(one.replica.sorted()).toEqual(["bread", "milk"]);
    expect(two.replica.sorted()).toEqual(["bread", "milk"]);
    expect(one.session.status).toBe("joined");
    expect(two.session.status).toBe("joined");
    expect(one.peers).toEqual(["w-b"]);
    expect(two.peers).toEqual(["w-a"]);
    const kinds = link.carried.map(({ data }) => decode(data, FORMAT).k);
    expect(kinds).toEqual([HELLO, SYNC, SYNC]);
  });

  it("then carry each change as it happens, without echo", async () => {
    const { link, one, two } = await pair();
    await one.start();
    await link.idle();
    const before = link.carried.length;
    one.replica.add("eggs");
    two.replica.add("salt");
    await link.idle();
    expect(one.replica.sorted()).toEqual(["eggs", "salt"]);
    expect(two.replica.sorted()).toEqual(["eggs", "salt"]);
    const after = link.carried.slice(before).map(({ data }) => decode(data, FORMAT).k);
    expect(after).toEqual([UPDATE, UPDATE]);
  });

  it("when both say hello at once, still meet, and stop answering", async () => {
    const { link, one, two } = await pair({ a: ["a"], b: ["b"] });
    await Promise.all([one.start(), two.start()]);
    await link.idle();
    expect(one.replica.sorted()).toEqual(["a", "b"]);
    expect(two.replica.sorted()).toEqual(["a", "b"]);
    expect(link.carried.length).toBeLessThanOrEqual(6);
  });

  it("carry a sync too big for one message in parts", async () => {
    const big = Array.from({ length: 4000 }, (_, at) => `item number ${at} with some words in it`);
    const { link, one, two } = await pair({ b: big });
    await one.start();
    await link.idle();
    expect(one.replica.items.size).toBe(4000);
    expect(link.carried.some(({ data }) => decode(data, FORMAT).k === PART)).toBe(true);
  });

  it("say so when nobody answers the hello in about 8 seconds", async () => {
    vi.useFakeTimers();
    const { coreB, one } = await pair();
    coreB.shut();
    expect(ACK_WAIT).toBe(8000);
    expect(await one.start()).toBe(true);
    await vi.advanceTimersByTimeAsync(ACK_WAIT - 1);
    expect(one.session.status).toBe("waiting");
    await vi.advanceTimersByTimeAsync(1);
    expect(one.session.status).toBe("silent");
    expect(one.statuses).toEqual(["waiting", "silent"]);
  });

  it("say so at once when the hello cannot leave, and send nothing more", async () => {
    vi.useFakeTimers();
    const { link, coreA, one } = await pair();
    link.down();
    expect(await one.start()).toBe(false);
    expect(one.session.status).toBe("unreachable");
    one.replica.add("offline");
    await vi.advanceTimersByTimeAsync(ACK_WAIT * 2);
    expect(one.session.status).toBe("unreachable");
    expect(coreA.sent).toHaveLength(1);
  });

  it("keep what each did offline and join it when they meet again", async () => {
    const { link, one, two } = await pair({ a: ["start"] });
    await one.start();
    await link.idle();
    link.down();
    one.replica.add("done offline by one");
    two.replica.add("done offline by two");
    await link.idle();
    expect(one.session.status).toBe("unreachable");
    expect(two.session.status).toBe("unreachable");
    expect(one.replica.sorted()).toEqual(["done offline by one", "start"]);
    link.up();
    expect(await two.start({ resume: true })).toBe(true);
    await link.idle();
    const all = ["done offline by one", "done offline by two", "start"];
    expect(one.replica.sorted()).toEqual(all);
    expect(two.replica.sorted()).toEqual(all);
    expect(one.session.status).toBe("joined");
    expect(two.session.status).toBe("joined");
  });

  it("heal by themselves when one hears its twin again after losing it", async () => {
    const { link, one, two } = await pair();
    await one.start();
    await link.idle();
    link.down();
    two.replica.add("lost on the way");
    await link.idle();
    expect(two.session.status).toBe("unreachable");
    expect(one.session.status).toBe("joined");
    link.up();
    // One never noticed and keeps sending; two hears it, takes it, and says hello to catch up.
    one.replica.add("after");
    await link.idle();
    expect(one.replica.sorted()).toEqual(["after", "lost on the way"]);
    expect(two.replica.sorted()).toEqual(["after", "lost on the way"]);
    expect(two.session.status).toBe("joined");
  });

  it("hear a bye, and stop sending until they meet again", async () => {
    const { link, one, two } = await pair();
    await one.start();
    await link.idle();
    await two.session.stop();
    await link.idle();
    expect(one.session.status).toBe("left");
    const before = link.carried.length;
    one.replica.add("alone");
    await link.idle();
    expect(link.carried.length).toBe(before);
    expect(decode(link.carried.at(-1).data, FORMAT).k).toBe(BYE);
  });
});

describe("who may join", () => {
  it("is anyone who answers a share, but only the known twin when a list is resumed", async () => {
    const coreA = fakeCore();
    const coreB = fakeCore();
    const link = connect(coreA, coreB);
    await coreA.open({ live: true });
    await coreB.open({ live: true });
    // Phone A resumes a document it shared with "w-friend"; a stranger answers.
    const mine = new SetReplica(["secret"]);
    const one = phone(coreA, mine, { who: "w-a", peer: "w-friend" });
    const stranger = phone(coreB, new SetReplica(["junk"]), { who: "w-stranger" });
    await one.start({ resume: true });
    await link.idle();
    // The stranger only gets a hello, without content, and its answer is not taken.
    expect(stranger.replica.sorted()).toEqual(["junk"]);
    expect(mine.sorted()).toEqual(["secret"]);
    expect(one.session.status).toBe("waiting");
    expect(one.peers).toEqual([]);
  });

  it("does not answer a resumed hello from someone who is not the known twin", async () => {
    const core = fakeCore();
    await core.open({ live: true });
    const replica = new SetReplica(["mine"]);
    const session = new LiveSession({ format: FORMAT, app: "1.0.0", doc: "d1", who: "w-a", peer: "w-friend", replica, send: core.ft.live.send });
    expect(await session.hear(base({ k: HELLO, who: "w-stranger", sv: "[]", resume: true }))).toBeNull();
    expect(core.sent).toHaveLength(0);
    // The known twin, resuming, is answered.
    expect(await session.hear(base({ k: HELLO, who: "w-friend", sv: "[]", resume: true }))).toBe(HELLO);
    expect(core.sent).toHaveLength(1);
  });

  it("takes a new twin who shares the document openly, and says who it is", async () => {
    const core = fakeCore();
    await core.open({ live: true });
    const peers = [];
    const session = new LiveSession({ format: FORMAT, app: "1.0.0", doc: "d1", who: "w-a", peer: "w-old", replica: new SetReplica(), send: core.ft.live.send, onPeer: (them) => peers.push(them) });
    expect(await session.hear(base({ k: HELLO, who: "w-new", sv: "[]" }))).toBe(HELLO);
    expect(peers).toEqual(["w-new"]);
    expect(session.peer).toBe("w-new");
  });

  it("ignores another document, an unknown kind, and a payload that does not apply", async () => {
    const core = fakeCore();
    await core.open({ live: true });
    const replica = new SetReplica(["x"]);
    const session = new LiveSession({ format: FORMAT, app: "1.0.0", doc: "d1", who: "w-a", replica, send: core.ft.live.send });
    expect(await session.hear(base({ k: HELLO, doc: "d2", who: "w-b", sv: "[]" }))).toBeNull();
    expect(await session.hear(base({ k: "dance", who: "w-b" }))).toBeNull();
    expect(await session.hear(base({ k: UPDATE, who: "w-b", u: "{not json" }))).toBeNull();
    expect(await session.hear(base({ k: SYNC, who: "w-b", u: 42 }))).toBeNull();
    expect(replica.sorted()).toEqual(["x"]);
  });
});
