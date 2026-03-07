// esbuild.config.mjs
// Build configuration for Vault Wiki Obsidian plugin.
//
// Usage:
//   node esbuild.config.mjs           — single build (dev mode, source maps)
//   node esbuild.config.mjs --watch   — watch mode (rebuilds on every save)
//   NODE_ENV=production node esbuild.config.mjs  — production (minified, no source maps)
//
// Output: main.js  (single-file bundle Obsidian loads directly)

import esbuild from "esbuild";
import fs from "fs";
import process from "process";
import builtins from "builtin-modules";

const isWatch = process.argv.includes("--watch");
const isProd  = process.env.NODE_ENV === "production";

const banner = `/*
Vault Wiki — v${JSON.parse(fs.readFileSync("manifest.json", "utf8")).version}
Built: ${new Date().toISOString()}
License: Apache-2.0 + Commons Clause (see LICENSE.md)
*/`;

/** @type {import('esbuild').BuildOptions} */
const buildOptions = {
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle:       true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format:    "cjs",
  target:    "es2020",
  logLevel:  "info",
  sourcemap: isProd ? false : "inline",
  treeShaking: true,
  minify:    isProd,
  outfile:   "main.js",

  // Define to allow conditional compilation (e.g. debug-only code)
  define: {
    "__DEV__":     JSON.stringify(!isProd),
    "__VERSION__": JSON.stringify(
      JSON.parse(fs.readFileSync("manifest.json", "utf8")).version
    ),
  },
};

if (isWatch) {
  const ctx = await esbuild.context(buildOptions);
  await ctx.watch();
  console.log("👀 Watching for changes… (Ctrl+C to stop)");
  console.log("   Tip: install Hot-Reload plugin in Obsidian for instant reloads.");
} else {
  const result = await esbuild.build(buildOptions);
  if (result.errors.length > 0) {
    process.exit(1);
  }
  const size = fs.statSync("main.js").size;
  console.log(`✅ Built main.js — ${(size / 1024).toFixed(1)} KB${isProd ? " (minified)" : " (dev)"}`);
}
