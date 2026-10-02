// Every icon of Split is an Ionicon, drawn through one function (`icon` in `src/icons.js`): the
// ones the app lends are `./icon/<name>.svg`, painted as a CSS mask; the ones it does not lend are
// carried in the bundle, as the very SVG of the `ionicons` package, drawn inline in currentColor.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ICONS, OWN_ICONS, icon } from "../src/icons.js";

/**
 * The icons the app lends to plugins: `ICONS` in `src-tauri/src/plugins.rs` of the app, branch
 * `games-section`, commit c3df572 (2026-10-02).
 */
const LENT_BY_APP = ["add-outline", "alarm-outline", "arrow-back-outline", "arrow-redo-outline", "arrow-undo-outline", "arrow-up-outline", "brush-outline", "calculator-outline", "chatbubble-outline", "checkmark-outline", "close-outline", "cloud-done-outline", "cloud-outline", "cloud-upload-outline", "color-palette-outline", "crop-outline", "document-text-outline", "download-outline", "ellipsis-horizontal-outline", "expand-outline", "eye-outline", "folder-open-outline", "folder-outline", "grid-outline", "hand-left-outline", "image-outline", "key-outline", "link-outline", "location-outline", "lock-closed-outline", "move-outline", "options-outline", "pause-outline", "pencil-outline", "play-outline", "refresh-outline", "remove-outline", "resize-outline", "save-outline", "search-outline", "send-outline", "square-outline", "text-outline", "time-outline", "trash-outline"];

const ionicon = (name) => readFileSync(join(import.meta.dirname, "..", "node_modules", "ionicons", "dist", "svg", `${name}.svg`), "utf8").trim();

describe("the icons", () => {
  it("asks the app only for icons it lends, and carries only the ones it does not", () => {
    for (const name of APP_ICONS) expect(LENT_BY_APP, name).toContain(name);
    for (const name of OWN_ICONS) expect(LENT_BY_APP, name).not.toContain(name);
    expect(OWN_ICONS.length).toBeGreaterThan(0);
  });

  it("carries each of its own as the very SVG of ionicons 8.1.0, with no address but the SVG namespace and no script", () => {
    const version = JSON.parse(readFileSync(join(import.meta.dirname, "..", "node_modules", "ionicons", "package.json"), "utf8")).version;
    expect(version).toBe("8.1.0");
    for (const name of OWN_ICONS) {
      const svg = icon(name);
      expect(svg, name).toContain(ionicon(name));
      expect(svg).not.toMatch(/<script|https:\/\//i);
      expect([...svg.matchAll(/http:\/\/[^\s"']*/g)].map((match) => match[0])).toEqual(["http://www.w3.org/2000/svg"]);
    }
  });

  it("draws a lent icon as a mask of ./icon/<name>.svg, and its own inline", () => {
    expect(icon("send-outline")).toContain("--i:url(./icon/send-outline.svg)");
    expect(icon("sync-outline")).toContain("<svg");
    expect(icon("sync-outline")).not.toContain("./icon/");
  });

  it("hides an icon beside a text from screen readers, and names one that stands alone", () => {
    expect(icon("sync-outline")).toContain('aria-hidden="true"');
    expect(icon("send-outline")).toContain('aria-hidden="true"');
    const named = icon("alert-circle-outline", { label: "Warning <b>" });
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Warning &lt;b&gt;"');
    expect(named).not.toContain("aria-hidden");
  });

  it("refuses a name it does not have, rather than draw nothing", () => {
    expect(() => icon("rocket-outline")).toThrow(/rocket-outline/);
  });
});
