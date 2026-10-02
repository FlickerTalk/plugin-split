// A Yjs document as the replica of the common live protocol: what it has is its state vector,
// what the twin lacks is the update since that, and what the twin sends is applied with an
// origin that is never sent back. Copy this file with `src/live-yjs.js` (a plugin without Yjs
// does not need either).
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { LIVE_ORIGIN, yjsReplica } from "../src/live-yjs.js";
import { HELLO, Inbox, LiveSession, fromBase64, toBase64 } from "../src/live.js";
import { connect, fakeCore } from "./fake-core.js";

const texts = (doc) => [...doc.getMap("things").values()].sort();

describe("a Yjs replica", () => {
  it("says what it has, what another lacks, and takes what comes", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const ra = yjsReplica(a);
    const rb = yjsReplica(b);
    a.getMap("things").set("1", "milk");
    expect(rb.missing(ra.have())).toBeNull();
    const lack = ra.missing(rb.have());
    expect(typeof lack).toBe("string");
    rb.apply(lack);
    expect(texts(b)).toEqual(["milk"]);
    expect(ra.missing(rb.have())).toBeNull();
    expect(fromBase64(ra.have())).toEqual(Y.encodeStateVector(a));
  });

  it("tells local changes, never what it took from the twin", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const heard = [];
    yjsReplica(b).onChange((payload) => heard.push(payload));
    const stop = yjsReplica(a).onChange(() => {});
    a.getMap("things").set("1", "from a");
    yjsReplica(b).apply(toBase64(Y.encodeStateAsUpdate(a)));
    expect(heard).toEqual([]);
    b.getMap("things").set("2", "from b");
    expect(heard).toHaveLength(1);
    expect(typeof heard[0]).toBe("string");
    stop();
  });

  it("refuses garbage and leaves the document as it was", () => {
    const doc = new Y.Doc();
    doc.getMap("things").set("1", "kept");
    const replica = yjsReplica(doc);
    expect(() => replica.apply("%%%")).toThrow();
    expect(() => replica.apply(toBase64(new Uint8Array([200, 1, 2, 3, 4, 5])))).toThrow();
    expect(() => replica.missing("%%%")).toThrow();
    expect(texts(doc)).toEqual(["kept"]);
    expect(LIVE_ORIGIN).toBeTruthy();
  });

  it("joins two documents edited apart over the live protocol, item by item", async () => {
    const coreA = fakeCore();
    const coreB = fakeCore();
    const link = connect(coreA, coreB);
    await coreA.open({ live: true });
    await coreB.open({ live: true });
    const a = new Y.Doc();
    const b = new Y.Doc();
    // The same item on both, then changed apart: one key on each side.
    const item = new Y.Map();
    a.getMap("items").set("x", item);
    item.set("text", "milk");
    item.set("done", false);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    a.getMap("items").get("x").set("done", true);
    b.getMap("items").get("x").set("text", "oat milk");

    const sessionA = new LiveSession({ format: "fttest", app: "1", doc: "d", who: "a", replica: yjsReplica(a), send: coreA.ft.live.send });
    const inboxB = new Inbox("fttest");
    let sessionB = null;
    coreB.ft.live.onMessage(async (data) => {
      const message = inboxB.take(data);
      if (message?.k === HELLO) sessionB ??= new LiveSession({ format: "fttest", app: "1", doc: "d", who: "b", replica: yjsReplica(b), send: coreB.ft.live.send });
      await sessionB?.hear(message);
    });
    const inboxA = new Inbox("fttest");
    coreA.ft.live.onMessage((data) => sessionA.hear(inboxA.take(data)));
    await sessionA.start();
    await link.idle();
    for (const doc of [a, b]) expect(doc.getMap("items").get("x").toJSON()).toEqual({ text: "oat milk", done: true });
    // And then live: a change on one side is on the other, once.
    b.getMap("items").get("x").set("done", false);
    await link.idle();
    expect(a.getMap("items").get("x").get("done")).toBe(false);
    sessionA.close();
    sessionB.close();
  });
});
