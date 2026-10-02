// What the catalogue signs is `module.json` + `dist/`: the build must leave it small, without a
// web address, without anything the plugin frame forbids, and with the licences of what it carries.
// Run `npm run build` before these tests (CI does it; `dist/` is committed).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIST = join(import.meta.dirname, "dist");
/** The plan's cap for this plugin (plan-plugins-nuevos §8: about 160 KB, cap 400 KB). */
const CAP = 400 * 1024;
/** `http://` is allowed only as a known XML namespace, which is a name and never fetched. */
const NAMESPACES = ["http://www.w3.org/2000/svg", "http://www.w3.org/1999/xhtml", "http://www.w3.org/1999/xlink", "http://www.w3.org/XML/1998/namespace"];

function files(dir = DIST) {
  const all = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) all.push(...files(path));
    else all.push(path);
  }
  return all;
}

describe("the package", () => {
  it("is one bundle and the notices, under the cap", () => {
    const names = files().map((path) => path.slice(DIST.length + 1)).sort();
    expect(names).toEqual(["THIRD_PARTY_NOTICES.md", "index.js"]);
    const total = files().reduce((sum, path) => sum + statSync(path).size, 0);
    expect(total).toBeGreaterThan(20_000);
    expect(total).toBeLessThan(CAP);
  });

  it("has no web address in any file", () => {
    for (const path of files()) {
      const text = readFileSync(path, "utf8");
      expect(text, path).not.toMatch(/https:\/\//i);
      const plain = [...text.matchAll(/http:\/\/[^\s"'`)<>]*/gi)].map((match) => match[0]);
      for (const address of plain) expect(NAMESPACES, `${path}: ${address}`).toContain(address);
    }
  });

  it("uses nothing the frame forbids: no network, no eval, no workers, no browser storage, no modals", () => {
    const code = readFileSync(join(DIST, "index.js"), "utf8");
    for (const forbidden of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /EventSource/, /sendBeacon/, /\beval\s*\(/, /new Function\s*\(/, /\bWorker\s*\(/, /SharedWorker/, /WebAssembly/, /localStorage/, /sessionStorage/, /indexedDB/, /\bconfirm\s*\(/, /\bprompt\s*\(/, /\balert\s*\(/, /\bimport\s*\(/]) {
      expect(code, String(forbidden)).not.toMatch(forbidden);
    }
    expect(code).toContain("ft-split");
  });

  it("runs as it is: the bundle defines the element and keeps an account through the fake core", async () => {
    const { fakeCore } = await import("./test/fake-core.js");
    const core = fakeCore();
    globalThis.ft = core.ft;
    await import("./dist/index.js");
    const element = document.createElement("ft-split");
    document.body.append(element);
    await core.open({ live: false });
    const form = element.shadowRoot.querySelector('form[data-form="new"]');
    form.querySelector("input").value = "Lisboa";
    form.querySelector("select").value = "JPY";
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    for (let at = 0; at < 50; at += 1) await Promise.resolve();
    await element.keeper.settled();
    expect(element.shadowRoot.querySelector("[data-name]").textContent).toBe("Lisboa");
    expect(element.account.currency).toBe("JPY");
    expect([...core.records.keys()].sort()).toEqual([`split/local/${element.account.id}/body`, `split/local/${element.account.id}/meta`]);
  });

  it("carries the licence of everything inside the bundle", () => {
    const notices = readFileSync(join(DIST, "THIRD_PARTY_NOTICES.md"), "utf8");
    expect(notices).toBe(readFileSync(join(import.meta.dirname, "THIRD_PARTY_NOTICES.md"), "utf8"));
    for (const name of ["yjs 13.6.33", "lib0 0.2.118"]) expect(notices).toContain(name);
    expect(notices.match(/Permission is hereby granted, free of charge/g).length).toBeGreaterThanOrEqual(2);
  });
});
