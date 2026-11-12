// The frame has no browser storage and the bundle may hold no web address, hence the two patches.
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
