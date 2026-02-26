/**
 * Version bump script — run via `npm run version`
 *
 * Usage: node scripts/version.mjs [patch|minor|major]
 * Default: patch
 *
 * Updates:
 *   - manifest.json  (version field)
 *   - versions.json  (adds new version → minAppVersion entry)
 *   - package.json   (version field)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

function readJson(file) {
  return JSON.parse(readFileSync(resolve(root, file), "utf8"));
}
function writeJson(file, data) {
  writeFileSync(resolve(root, file), JSON.stringify(data, null, "\t") + "\n");
}

const bumpType = process.argv[2] ?? "patch";
const manifest = readJson("manifest.json");
const versions = readJson("versions.json");
const pkg = readJson("package.json");

const [major, minor, patch] = manifest.version.split(".").map(Number);
let next;
if (bumpType === "major") next = `${major + 1}.0.0`;
else if (bumpType === "minor") next = `${major}.${minor + 1}.0`;
else next = `${major}.${minor}.${patch + 1}`;

manifest.version = next;
pkg.version = next;
versions[next] = manifest.minAppVersion;

writeJson("manifest.json", manifest);
writeJson("versions.json", versions);
writeJson("package.json", pkg);

console.log(`✅ Bumped version to ${next}`);
