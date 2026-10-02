// Builds `dist/` from `src/`: one bundle with Yjs and lib0 inside, and the licences of what it
// carries beside it. The package the catalogue signs is `module.json` + `dist/`.
//
// Two things of the libraries are changed on the way in, so the bundle holds no web address and
// does not touch browser storage (the plugin frame has none: everything goes through `ft.records`):
// - Yjs's warning about being imported twice ends with a link to its issue tracker: the link goes.
// - lib0's `storage.js` probes `localStorage` (only to read debug flags): it is replaced by its own
//   in-memory fallback, which is what it uses wherever `localStorage` is missing.
// If either text is not found (a new version), the build stops rather than ship it unchanged.
import { build } from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const YJS_LINK = " - https://github.com/yjs/yjs/issues/438";

const MEMORY_STORAGE = `
class VarStoragePolyfill {
  constructor () { this.map = new Map() }
  setItem (key, newValue) { this.map.set(key, newValue) }
  getItem (key) { return this.map.get(key) }
}
export const varStorage = new VarStoragePolyfill()
export const onChange = () => true
export const offChange = () => true
`;

const sanitise = {
  name: "sanitise",
  setup(context) {
    context.onLoad({ filter: /[\\/]yjs[\\/]dist[\\/]yjs\.mjs$/ }, ({ path }) => {
      const code = readFileSync(path, "utf8");
      if (!code.includes(YJS_LINK)) throw new Error("yjs: the link to strip is not there any more; check the bundle by hand");
      return { contents: code.replaceAll(YJS_LINK, ""), loader: "js" };
    });
    context.onLoad({ filter: /[\\/]lib0[\\/]storage\.js$/ }, ({ path }) => {
      if (!readFileSync(path, "utf8").includes("export const varStorage")) throw new Error("lib0: storage.js changed; check what it exports");
      return { contents: MEMORY_STORAGE, loader: "js" };
    });
  },
};

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/index.js"],
  bundle: true,
  format: "esm",
  minify: true,
  target: ["es2022"],
  outfile: "dist/index.js",
  legalComments: "none",
  logLevel: "info",
  plugins: [sanitise],
});

copyFileSync("THIRD_PARTY_NOTICES.md", "dist/THIRD_PARTY_NOTICES.md");
