# Contributing to WikiVault Unified

Thank you for your interest! This document covers everything needed to get a local development environment running.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | ≥ 18 | [nodejs.org](https://nodejs.org) |
| npm | ≥ 9 | Bundled with Node |
| Obsidian | ≥ 0.15.0 | [obsidian.md](https://obsidian.md) |
| git | any | — |

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/your-username/wikivault-unified
cd wikivault-unified

# 2. Install
npm install

# 3. Configure
cp data.json.example data.json
# Edit data.json and set your API key

# 4. Watch-build (rebuilds on save)
npm run dev
```

Then symlink (or copy) the plugin folder into your test vault:

```bash
# macOS / Linux
ln -s "$(pwd)" "/path/to/your/vault/.obsidian/plugins/wikivault-unified"

# Windows (PowerShell, run as Administrator)
New-Item -ItemType SymbolicLink `
  -Path "$env:APPDATA\obsidian\vaults\YourVault\.obsidian\plugins\wikivault-unified" `
  -Target (Get-Location)
```

Enable the plugin in **Obsidian → Settings → Community Plugins**.

---

## Project Structure

```
wikivault-unified/
├── src/                   # TypeScript source (compiled → main.js)
│   └── main.ts            # Entry point — all plugin code
├── main.js                # Compiled output (committed for Obsidian)
├── manifest.json          # Obsidian plugin manifest
├── versions.json          # Version → minAppVersion map
├── data.json              # Your local settings (gitignored — never commit)
├── data.json.example      # Safe settings template for contributors
├── esbuild.config.mjs     # Build pipeline
├── tsconfig.json          # TypeScript config
├── eslint.config.mjs      # Linting rules
├── .prettierrc            # Code formatting
├── .gitignore             # Excludes data.json, node_modules, etc.
├── CHANGELOG.md           # Release notes
├── scripts/
│   ├── setup-repo.sh      # One-command GitHub repo initializer
│   └── version.mjs        # Version bump utility
└── .github/workflows/
    ├── ci.yml             # PR checks (lint, typecheck, build)
    └── release.yml        # Tag → GitHub Release automation
```

---

## Available Scripts

| Script | What it does |
|--------|-------------|
| `npm run dev` | Watch-rebuild with sourcemaps (development) |
| `npm run build` | Production build, minified, no sourcemaps |
| `npm run lint` | ESLint on `src/**/*.ts` |
| `npm run format` | Prettier format in-place |
| `npm run format:check` | Prettier check (used in CI) |
| `npm run typecheck` | TypeScript type-check without emitting |
| `npm run validate` | format:check + lint + typecheck (full pre-commit check) |
| `npm run version` | Bump patch version across manifest + versions + package |

---

## Releasing a New Version

```bash
# 1. Bump version (patch | minor | major)
npm run version patch

# 2. Commit and tag
git add .
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git tag "$(node -p "require('./package.json').version")"

# 3. Push (CI runs; then the release workflow fires on the tag)
git push && git push --tags
```

The release workflow will:
- Build `main.js`
- Bundle `main.js + manifest.json + versions.json + data.json.example` into a `.zip`
- Create a GitHub Release with install instructions

---

## Code Style

- **TypeScript** — strict mode enabled, no `any` without justification
- **Prettier** — auto-formatting on save (configure your editor or run `npm run format`)
- **ESLint** — must pass with zero warnings before merge
- **Comments** — explain *why*, not *what*; use `⚡ BOLT:` and `🛡️ SENTINEL:` prefixes for performance/security annotations

---

## Security Notes

- **Never commit `data.json`** — it contains your API key. It is gitignored.
- If you accidentally commit a key, rotate it immediately in your provider's dashboard.
- See `SENTINEL` comments in `main.js` for documented security decisions.

---

## Bug Reports & Feature Requests

Please open a GitHub Issue with:
- Obsidian version
- Plugin version
- The relevant log file from `WikiVault/Logs/` (redact your API key if it appears)
- Steps to reproduce
