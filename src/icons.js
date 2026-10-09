// Split's icons: all Ionicons (MIT, © Ionic), drawn through `icon()` only, so moving to
// `<ion-icon>` later is a change here and nowhere else. The ones the app lends to plugins
// (`ICONS` in the app's `src-tauri/src/plugins.rs`) are `./icon/<name>.svg`, painted as a CSS
// mask; the ones it does not lend are carried here, each the very SVG of the `ionicons` 8.1.0
// package (`dist/svg/<name>.svg`, checked by `test/icons.test.js`), drawn inline in currentColor.

/** The icons Split asks the app for. */
export const APP_ICONS = new Set(["add-outline", "arrow-back-outline", "checkmark-outline", "close-outline", "download-outline", "pencil-outline", "send-outline", "trash-outline"]);

/** The icons Split carries, from ionicons 8.1.0. */
const OWN = {
  "alert-circle-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><path d="M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192 192-86 192-192Z" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32px"/><path d="M250.26 166.05 256 288l5.73-121.95a5.74 5.74 0 0 0-5.79-6h0a5.74 5.74 0 0 0-5.68 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="M256 367.91a20 20 0 1 1 20-20 20 20 0 0 1-20 20"/></svg>`,
  "cash-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><rect width="448" height="256" x="32" y="80" rx="16" ry="16" transform="matrix(-1 0 0 -1 512 416)" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="32px"/><path d="M64 384h384M96 432h320" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><circle cx="256" cy="208" r="80" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="M480 160a80 80 0 0 1-80-80M32 160a80 80 0 0 0 80-80M480 256a80 80 0 0 0-80 80M32 256a80 80 0 0 1 80 80" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/></svg>`,
  "checkmark-circle-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><path d="M448 256c0-106-86-192-192-192S64 150 64 256s86 192 192 192 192-86 192-192Z" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32px"/><path d="M352 176 217.6 336 160 272" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/></svg>`,
  "cloud-offline-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><path d="M93.72 183.25C49.49 198.05 16 233.1 16 288c0 66 54 112 120 112h184.37M467.82 377.74C485.24 363.3 496 341.61 496 312c0-59.82-53-85.76-96-88-8.89-89.54-71-144-144-144-26.16 0-48.79 6.93-67.6 18.14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="M448 448 64 64" fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32px"/></svg>`,
  "log-in-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><path d="M192 176v-40a40 40 0 0 1 40-40h160a40 40 0 0 1 40 40v240a40 40 0 0 1-40 40H240c-22.09 0-48-17.91-48-40v-40" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="m288 336 80-80-80-80M80 256h272" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/></svg>`,
  "log-out-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><path d="M304 336v40a40 40 0 0 1-40 40H104a40 40 0 0 1-40-40V136a40 40 0 0 1 40-40h152c22.09 0 48 17.91 48 40v40M368 336l80-80-80-80M176 256h256" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/></svg>`,
  "people-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><path d="M402 168c-2.93 40.67-33.1 72-66 72s-63.12-31.32-66-72c-3-42.31 26.37-72 66-72s69 30.46 66 72" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="M336 304c-65.17 0-127.84 32.37-143.54 95.41-2.08 8.34 3.15 16.59 11.72 16.59h263.65c8.57 0 13.77-8.25 11.72-16.59C463.85 335.36 401.18 304 336 304Z" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32px"/><path d="M200 185.94c-2.34 32.48-26.72 58.06-53 58.06s-50.7-25.57-53-58.06C91.61 152.15 115.34 128 147 128s55.39 24.77 53 57.94" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="M206 306c-18.05-8.27-37.93-11.45-59-11.45-52 0-102.1 25.85-114.65 76.2-1.65 6.66 2.53 13.25 9.37 13.25H154" fill="none" stroke="currentColor" stroke-linecap="round" stroke-miterlimit="10" stroke-width="32px"/></svg>`,
  "person-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><path d="M344 144c-3.92 52.87-44 96-88 96s-84.15-43.12-88-96c-4-55 35-96 88-96s92 42 88 96" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="M256 304c-87 0-175.3 48-191.64 138.6C62.39 453.52 68.57 464 80 464h352c11.44 0 17.62-10.48 15.65-21.4C431.3 352 343 304 256 304Z" fill="none" stroke="currentColor" stroke-miterlimit="10" stroke-width="32px"/></svg>`,
  "phone-portrait-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><rect width="256" height="480" x="128" y="16" rx="48" ry="48" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="M176 16h24a8 8 0 0 1 8 8h0a16 16 0 0 0 16 16h64a16 16 0 0 0 16-16h0a8 8 0 0 1 8-8h24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/></svg>`,
  "sync-outline": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" class="ionicon"><path d="M434.67 285.59v-29.8c0-98.73-80.24-178.79-179.2-178.79a179 179 0 0 0-140.14 67.36m-38.53 82v29.8C76.8 355 157 435 256 435a180.45 180.45 0 0 0 140-66.92" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/><path d="m32 256 44-44 46 44M480 256l-44 44-46-44" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32px"/></svg>`,
};

export const OWN_ICONS = Object.keys(OWN);

const escape = (text) =>
  String(text).replace(/[&<>"']/g, (one) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[one]);

/**
 * An icon. Beside a text (the usual case, also inside a button that has its own `aria-label`) it
 * is hidden from screen readers; standing alone, `label` names it.
 */
export function icon(name, { label, slot } = {}) {
  const a11y = (label ? `role="img" aria-label="${escape(label)}"` : 'aria-hidden="true"') + (slot ? ` slot="${slot}"` : "");
  if (Object.hasOwn(OWN, name)) return `<i class="i own" ${a11y}>${OWN[name]}</i>`;
  if (APP_ICONS.has(name)) return `<i class="i" ${a11y} style="--i:url(./icon/${name}.svg)"></i>`;
  throw new Error(`no icon ${name}`);
}
