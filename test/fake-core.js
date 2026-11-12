import { vi } from "vitest";

export const LIVE_LIMIT = 48 * 1024;
const bytes = (text) => new TextEncoder().encode(String(text)).length;

export function fakeCore({ quota = 4 * 1024 * 1024, lang = "en" } = {}) {
  const records = new Map();
  const openers = [];
  const hearers = [];
  const closers = [];
  const core = {
    records,
    quota,
    sent: [],
    said: [],
    closed: 0,
    listening: false,
    link: null,
    async open(opening = {}) {
      const given = { text: "", dark: false, lang, file: null, ref: null, reminder: null, live: false, ...opening };
      core.listening = true;
      core.live = given.live;
      for (const handler of openers) await handler(given);
    },
    async closeWindow() {
      for (const handler of closers) await handler();
      core.closed += 1;
      core.shut();
    },
    shut() {
      core.listening = false;
    },
    reload() {
      core.listening = false;
      openers.length = 0;
      hearers.length = 0;
      closers.length = 0;
    },
    hear(data) {
      if (!core.listening) return Promise.resolve();
      return Promise.all(hearers.map((handler) => handler(data)));
    },
    used() {
      let total = 0;
      for (const [key, value] of records) total += bytes(key) + bytes(value);
      return total;
    },
    ft: {
      onOpen: (handler) => openers.push(handler),
      onClose: (handler) => closers.push(handler),
      pickFile: vi.fn(async () => null),
      send: vi.fn(() => core.shut()),
      say: vi.fn((text) => {
        core.said.push(String(text));
        core.shut();
      }),
      save: vi.fn(async () => true),
      close: vi.fn(() => {
        core.closed += 1;
        core.shut();
      }),
      records: {
        get: vi.fn(async (key) => records.get(String(key)) ?? null),
        set: vi.fn(async (key, value) => {
          key = String(key);
          value = String(value);
          if (bytes(key) > 128) return false;
          const before = records.has(key) ? bytes(key) + bytes(records.get(key)) : 0;
          if (core.used() - before + bytes(key) + bytes(value) > core.quota) return false;
          records.set(key, value);
          return true;
        }),
        forget: vi.fn(async (key) => (records.delete(String(key)), true)),
        keys: vi.fn(async (prefix = "") => [...records.keys()].filter((key) => key.startsWith(String(prefix))).sort()),
        usage: vi.fn(async () => ({ used: core.used(), quota: core.quota })),
      },
      live: {
        send: vi.fn(async (data) => {
          core.sent.push(String(data));
          if (!core.live || !core.link || !core.link.isUp) return false;
          let size;
          try {
            size = atob(String(data)).length;
          } catch {
            return false;
          }
          if (size > LIVE_LIMIT) return false;
          core.link.carry(core, String(data));
          return true;
        }),
        onMessage: (handler) => hearers.push(handler),
      },
    },
  };
  return core;
}

export function connect(a, b) {
  let inFlight = 0;
  const link = {
    isUp: true,
    carried: [],
    down() {
      link.isUp = false;
    },
    up() {
      link.isUp = true;
    },
    carry(from, data) {
      const to = from === a ? b : a;
      link.carried.push({ from, data });
      inFlight += 1;
      queueMicrotask(() => {
        Promise.resolve(to.hear(data))
          .catch(() => {})
          .finally(() => {
            inFlight -= 1;
          });
      });
    },
    async idle() {
      let quiet = 0;
      for (let round = 0; round < 10_000; round += 1) {
        await new Promise((resolve) => queueMicrotask(resolve));
        quiet = inFlight === 0 ? quiet + 1 : 0;
        if (quiet >= 50) return;
      }
      throw new Error("the link never went quiet");
    },
  };
  a.link = link;
  b.link = link;
  return link;
}
