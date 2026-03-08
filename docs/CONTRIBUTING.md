# Contributing to Vault Wiki

Welcome, and thank you for wanting to contribute! This guide covers everything from setting up your dev environment to submitting a pull request.

---

## Table of Contents

1. [Before You Start](#before-you-start)
2. [Repository Structure](#repository-structure)
3. [Development Setup](#development-setup)
4. [Architecture Deep-Dive](#architecture-deep-dive)
5. [Adding a New AI Provider](#adding-a-new-ai-provider)
6. [Code Conventions](#code-conventions)
7. [Testing](#testing)
8. [Submitting a Pull Request](#submitting-a-pull-request)
9. [Commit Style](#commit-style)
10. [License Requirements for Contributors](#license-requirements-for-contributors)

---

## Before You Start

- Read [DEBUGGING.md](./DEBUGGING.md) — it will save you hours.
- Browse [INTEGRATION.md](./INTEGRATION.md) if you're adding cross-plugin features.
- Check open issues before starting something new — someone may already be working on it.
- All contributions must comply with the Apache 2.0 + Commons Clause license. No ads, no paywalls, no telemetry. See [LICENSE.md](./LICENSE.md).

---

## Repository Structure

```
vault-wiki/
├── main.js           ← compiled single-file plugin (the thing Obsidian loads)
├── manifest.json     ← plugin metadata (version, name, minAppVersion)
├── package.json      ← npm project + build scripts
├── esbuild.config.mjs← build configuration
├── src/              ← TypeScript sources (if using TS build)
│   └── main.ts
├── styles.css        ← optional global styles (loaded by Obsidian separately)
├── LICENSE.md
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md   ← you are here
├── INTEGRATION.md
└── DEBUGGING.md
```

> **Note:** The repository ships `main.js` as a compiled bundle so users can install without a build step. If you are developing, edit the source and rebuild — do **not** hand-edit `main.js`.

---

## Development Setup

### Prerequisites

| Tool    | Version   | Notes                                    |
|---------|-----------|------------------------------------------|
| Node.js | ≥ 18 LTS  | `node --version` to check                |
| npm     | ≥ 9       | comes with Node                          |
| Obsidian| ≥ 1.0.0   | for live testing                         |

### Steps

```bash
# 1. Fork + clone
git clone https://github.com/adhdboy411/vault-wiki.git
cd vault-wiki

# 2. Install dependencies
npm install

# 3. Build once
npm run build

# 4. Watch mode — rebuilds on every save
npm run dev

# 5. Symlink into your test vault (replace path)
ln -s "$(pwd)" ~/Documents/TestVault/.obsidian/plugins/vault-wiki
```

After symlinking, enable the plugin in Obsidian Settings → Community Plugins.
In Obsidian, run `Ctrl+Shift+I` (Windows/Linux) or `Cmd+Option+I` (Mac) to open DevTools.

### Hot-reload with `npm run dev`

The watch script uses `esbuild` with `--watch`. Every time you save a `.ts` / `.js` source file:
1. `main.js` is rebuilt in ~100–300 ms.
2. In Obsidian, run the command **"Reload app without saving"** (`Ctrl+R` / `Cmd+R`) to pick up changes without restarting.
3. Or install the [Hot-Reload plugin](https://github.com/pjeby/hot-reload) — it watches `main.js` and reloads automatically.

---

## Architecture Deep-Dive

The entire plugin compiles to a single `main.js`. The file is structured top-to-bottom as a dependency graph — lower layers never import from higher ones.

```
Layer 0 — Obsidian import
  import_obsidian = require("obsidian")

Layer 1 — Constants & Configuration
  DEFAULT_SETTINGS   All user-configurable settings + defaults
  PROVIDERS[]        Canonical AI provider descriptors
  PROVIDER_MAP       Map<id, descriptor> for O(1) lookup
  IRREGULAR_PLURALS  English irregular plural lookup table

Layer 2 — Pure Utility Functions
  getProviderConfig(settings)             → provider descriptor
  getApiKey(settings, providerId)         → decrypted key string
  setApiKey(settings, providerId, key)    → writes to providerApiKeys map
  providerNeedsKey(settings)              → bool
  sanitizeTermForPath(term)               → filesystem-safe filename
  sanitizeTermForPrompt(term)             → injection-safe prompt string
  validateEndpointUrl(url)                → error string | null
  validateEndpointProtocol(url)           → error string | null
  maskApiKey(key)                         → "sk-●●●●1234"
  debounce(fn, wait)                      → debounced function

Layer 3 — Security
  VaultWikiCrypto    AES-GCM-256 key encryption/decryption

Layer 4 — Model Intelligence
  MODEL_KNOWN_SIZES  Map<substring, paramCount>
  parseModelSizeB(name)                   → number | null
  parseModelQuant(name)                   → 'q2'|'q4'|'q8'|'fp16'|null
  getAutoConfig(hwMode, provider)         → config (legacy fallback)
  getAutoConfigFromModel(name, hw, prov)  → config (model-aware)
  stripMarkupForAI(text, maxChars?)       → stripped string
  detectHardwareMode(settings)            → "cpu"|"gpu"|"android"|"ios"
  getHardwareModeParams(mode)             → { context_length }
  getDefaultModelForHardware(mode)        → model id string
  hardwareModeLabel(mode)                 → "💻 CPU" etc.
  PROMPT_PRESETS                          small | balanced | detailed
  detectPromptPreset(system, user)        → preset key | "custom"

Layer 5 — AI Clients
  fetchOllamaModels(endpoint)             → [{ name, sizeB }] | null
  fetchLMStudioModels(endpoint)           → string[] | null
  LMStudioV1Client                        native /api/v1/chat client

Layer 6 — Core Engine
  TermCache           builds + maintains the vault term index
  CategoryManager     assigns wiki notes to category folders
  NoteGenerator       generates wiki notes, calls AI, writes files

Layer 7 — Plugin Shell
  WikiVaultUnifiedPlugin   onload, commands, context menus, lifecycle

Layer 8 — Settings UI
  WikiVaultSettingTab      display(), all settings sections
```

### Data Flow

```
Vault files
    │
    ▼
TermCache.buildIndex()           Scans .md files, builds:
    │                              - termIndex: Map<term, TFile[]>
    │                              - headingIndex: Map<term, heading>
    │                              - aliasIndex: Map<alias, term>
    ▼
NoteGenerator.generateAll()      For each missing term:
    │                              1. extractContext(term) → raw paragraphs
    │                              2. stripMarkupForAI(context) → clean text
    │                              3. sanitizeTermForPrompt(term) → safe term
    │                              4. _callAIRaw() / _callAnthropicAPI()
    │                              5. writeFinalNote(term, content)
    ▼
CategoryManager.assignCategory() Picks best wiki subfolder
    │
    ▼
Vault write                      assertSafeWritePath() guard
```

---

## Adding a New AI Provider

This is the most common contribution. It takes 3–4 steps.

### Step 1 — Add a descriptor to `PROVIDERS[]`

Find the `PROVIDERS` array (line ~363 in `main.js` / equivalent in source) and add an entry:

```js
{
  id: "myprovider",              // unique snake_case id
  label: "My Provider",          // shown in the Settings dropdown
  emoji: "🔥",                   // shown as a prefix in the dropdown
  defaultEndpoint: "https://api.myprovider.ai/v1",
  defaultModel: "my-model-7b",
  apiFormat: "openai",           // "openai" | "anthropic" | "lmstudio-v1"
  requiresKey: true,             // false for local providers
  localOnly: false,              // true for localhost-only
  keyHeader: "Authorization",    // "Authorization" → Bearer, "x-api-key" → direct
  models: [                      // suggested model IDs for the picker
    "my-model-7b",
    "my-model-14b",
  ],
},
```

### Step 2 — Add a key slot to `DEFAULT_SETTINGS.providerApiKeys`

```js
providerApiKeys: {
  // ... existing entries ...
  myprovider: "",     // ← add this
},
```

### Step 3 — Handle non-OpenAI API format (if needed)

If your provider uses the standard OpenAI `/v1/chat/completions` format, **you're done** — the existing `_callAIRaw()` method handles it automatically.

If it has a custom format (like Anthropic's `/v1/messages`), add a handler in `_callAIRaw()`:

```js
// Inside NoteGenerator._callAIRaw()
if (provider === "myprovider") {
  return this._callMyProviderAPI(term, context);
}
```

Then implement `_callMyProviderAPI()` following the same pattern as `_callAnthropicAPI()`.

### Step 4 — Add to `MODEL_KNOWN_SIZES` (optional but encouraged)

```js
const MODEL_KNOWN_SIZES = new Map([
  // ... existing entries ...
  ['my-model-7b',  7 ],
  ['my-model-14b', 14],
]);
```

That's it. The Settings UI (dropdown, key field, model picker), auto-config, key encryption, and connection testing all work automatically from the `PROVIDERS` table.

---

## Code Conventions

### Naming

| What | Convention | Example |
|------|-----------|---------|
| Classes | PascalCase | `NoteGenerator` |
| Public methods | camelCase | `generateAll()` |
| Private methods | `_camelCase` | `_callAIRaw()` |
| Constants | UPPER_SNAKE | `DEFAULT_SETTINGS` |
| Boolean variables | `is/has/can` prefix | `isCloud`, `hasKey` |

### Comments

Every exported function needs a JSDoc block:

```js
/**
 * Short one-line description.
 *
 * Longer explanation if the logic is non-obvious.
 *
 * @param {string} term — The wiki term to look up.
 * @param {object} [opts] — Optional configuration.
 * @returns {string|null} Result, or null on failure.
 */
function myFunction(term, opts) { … }
```

For significant internal optimisations, add an inline note with the category tag:

```js
// ⚡ BOLT: hoisted out of per-note loop — was called 200× per pass
const hwMode = detectHardwareMode(settings);
```

Category tags: `⚡ BOLT` (perf), `🛡️ SENTINEL` (security), `🎨 PALETTE` (UX).

### Error Handling

- **Never swallow errors silently** in user-facing paths. Either log + surface via `Notice`, or rethrow.
- Use `this.logger.error()` for errors, `this.logger.warn()` for recoverable issues.
- Wrap async plugin entry points in try/catch (see `onload`, `generateWikiNotes`).

### Security Rules

1. **Never read `settings.providerApiKeys` directly.** Use `getApiKey(settings, providerId)`.
2. **Never write API keys directly.** Use `setApiKey(settings, providerId, key)`.
3. **Always sanitize terms.** Call `sanitizeTermForPrompt(term)` before any AI interpolation.
4. **Always validate endpoints.** Call `validateEndpointProtocol(url)` before any network call.
5. **Always use `assertSafeWritePath()`.** Never write vault files without it.

---

## Testing

There is no automated test suite yet — this is a known gap and contributions are very welcome.

### Manual Testing Checklist

Before submitting a PR, please verify:

- [ ] Plugin loads without errors (`Ctrl+Shift+I` → Console → no red errors on startup)
- [ ] Settings panel opens and all sections render
- [ ] API key can be saved and survives a reload (check it still shows in the field)
- [ ] Test Connection button works for your provider
- [ ] Generation produces a wiki note in the correct folder
- [ ] Right-click menu appears on `.md` files
- [ ] Right-click menu works in the editor (with and without selected text)
- [ ] Plugin works on mobile (if you have access — use Obsidian Sync + a phone)

### Debugging Tools

See [DEBUGGING.md](./DEBUGGING.md) for the full suite of debugging commands, console helpers, and diagnostic techniques.

Quick start: In Obsidian DevTools console:

```js
// Get the plugin instance
const vw = app.plugins.plugins["vault-wiki"];

// Dump current settings (keys masked automatically)
vw.debugDumpSettings?.();

// Run a self-test
vw.debugSelfTest?.();
```

---

## Submitting a Pull Request

1. Fork the repository and create a branch: `feat/my-feature` or `fix/issue-123`.
2. Make your changes in source files (not in `main.js` directly if using TS).
3. Run `npm run build` and verify the output compiles without errors.
4. Fill in the PR template: what changed, why, how to test it.
5. Ensure your changes comply with the license (no ads, no paywalls, no telemetry).

PRs are reviewed within a few days. Feedback is constructive — if something needs changing, it's not a rejection.

---

## Commit Style

```
<type>(<scope>): short description

Optional body explaining why, not what.

Refs: #issue-number
```

**Types:**

| Type | When to use | Tag |
|------|------------|-----|
| `feat` | New feature or capability | |
| `fix` | Bug fix | |
| `perf` | Performance improvement | ⚡ BOLT |
| `sec` | Security improvement | 🛡️ SENTINEL |
| `ux` | UX / UI improvement | 🎨 PALETTE |
| `docs` | Documentation only | |
| `refactor` | Restructuring without behaviour change | |
| `break` | Breaking change (rare — needs discussion first) | |

**Examples:**

```
feat(providers): add Cohere provider support

perf(indexer): hoist detectHardwareMode() out of per-note loop

sec(crypto): increase PBKDF2 iterations to 200k

fix(mobile): safe-area insets not applied on iPad

docs(integration): add Dataview integration example
```

---

## License Requirements for Contributors

By submitting a pull request, you agree that your contribution is licensed under Apache 2.0 + Commons Clause + the Pro-Consumer Addendum. Specifically:

- Your contribution may not introduce advertising, telemetry, or monetisation mechanisms.
- Your contribution may not add any feature that gates functionality behind a paywall or account.
- If you include code from a third-party library, ensure its license is compatible with Apache 2.0 and include an attribution comment.

If you're unsure whether something is allowed, open an issue and ask before writing code.

---

*Thank you for making Vault Wiki better for everyone. 🙏*
