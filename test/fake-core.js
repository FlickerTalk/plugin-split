// A fake FlickerTalk core for a plugin's tests: what the frame's `ft` answers, kept in memory, and
// a link that joins two of them as two phones in one conversation. It copies the rules of the
// real core that a plugin can trip over (app `src-tauri/src/plugins.rs`, `PluginSheet.vue`,
// `ft-core/src/plugins.rs`):
// - `records`: values are strings; a write over the quota answers `false` (the frame turns the
//   core's error into `false`); a key is at most 128 bytes.
// - `live.send`: `false` when there is no conversation, no link, or the link is down; a message
//   over 48 KiB decoded is refused (`false`). `true` means it left, not that anyone heard it: when
//   the twin is not open in that conversation, the message is dropped without a word.
// - `say` and `send` close the plugin, as the app does.
// Nothing here is specific to one plugin; copy it as it is.
import { vi } from "vitest";

export const LIVE_LIMIT = 48 * 1024;
const bytes = (text) => new TextEncoder().encode(String(text)).length;

/** One phone's core, as one plugin's frame sees it. */
export function fakeCore({ quota = 4 * 1024 * 1024, lang = "en" } = {}) {
  const records = new Map();
  const openers = [];
  const hearers = [];
  const closers = [];
  const core = {
    records,
    quota,
    /** Everything this frame tried to send over `live`, whether it left or not. */
    sent: [],
    /** What it put in the composer with `say`. */
    said: [],
    closed: 0,
    /** Whether the plugin is open in the conversation, so what its twin says reaches it. */
    listening: false,
    link: null,
    /** Opens the plugin, as the app does: `live` is true only in a conversation with it granted. */
    async open(opening = {}) {
      const given = { text: "", dark: false, lang, file: null, ref: null, reminder: null, live: false, ...opening };
      core.listening = true;
      core.live = given.live;
      for (const handler of openers) await handler(given);
    },
    /**
     * The app's ✕ or Android's Back (core 1.3.0, `ft.onClose`): the plugin's goodbyes run, and are
     * waited for, then the window goes away, as when the plugin closes itself.
     */
    async closeWindow() {
      for (const handler of closers) await handler();
      core.closed += 1;
      core.shut();
    },
    /** The plugin's window goes away: nothing reaches it any more. */
    shut() {
      core.listening = false;
    },
    /** A new frame for the same plugin on the same phone: the old one's handlers are gone. */
    reload() {
      core.listening = false;
      openers.length = 0;
      hearers.length = 0;
      closers.length = 0;
    },
    /**
     * What the twin said, handed to this frame. As in the real frame, every handler is called at
     * once and not awaited: a second message can arrive while the first is still being handled.
     * The promise only lets a test wait for the handlers to finish.
     */
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

/**
 * Joins two cores as the two phones of one conversation. What one sends reaches the other in
 * order, asynchronously, as over the direct connection, and is handled as the real frame does. `down()` is a phone in airplane mode:
 * sends answer `false`; `up()` brings it back. `idle()` waits until nothing is on the way.
 */
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
      // Delivered in order, each one as soon as it is on the other side, without waiting for
      // the handling of the one before.
      queueMicrotask(() => {
        Promise.resolve(to.hear(data))
          .catch(() => {})
          .finally(() => {
            inFlight -= 1;
          });
      });
    },
    /** Waits until nothing is on the way and nothing new set off for a while (in microtasks). */
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
