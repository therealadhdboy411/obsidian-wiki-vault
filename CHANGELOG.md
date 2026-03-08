# Vault Wiki — Changelog

All notable changes are documented here. Dates are approximate release dates.

Format: `[type] short description — technical detail`
Types: `feat` · `fix` · `perf` · `sec` · `ux` · `docs` · `refactor` · `break`

---

## v1.1.0 — Obsidian Repository Prep  *(2025)*

### Security (🛡️ Sentinel)
- **`sec` AES-GCM-256 API key encryption** — All API keys are now encrypted at rest using AES-GCM with a 256-bit key derived from your vault path via PBKDF2-SHA256 (100,000 iterations). The derived key is never stored; it exists only in memory for the lifetime of the plugin session. Copying `data.json` without access to the vault folder provides no usable key material. See `VaultWikiCrypto` class for implementation.
- **`sec` Per-provider key isolation** — Keys for each provider (`mistral`, `openai`, `anthropic`, `groq`, `openrouter`, `together`, `custom`) are stored in separate slots in `settings.providerApiKeys`. A compromise of one provider's key does not expose others. Access is always through `getApiKey(settings, providerId)` — no code reads the map directly.
- **`sec` Prompt injection sanitizer** — `sanitizeTermForPrompt()` strips HTML tags, template literals, `${...}` and `{{...}}` patterns, and known injection phrases ("ignore all previous instructions", "jailbreak", "developer mode", etc.) from every wikilink term before it is interpolated into an AI prompt. Applied at all three prompt-building call sites.
- **`sec` Legacy key migration** — Old installations that stored keys in the flat `openaiApiKey` / `anthropicApiKey` fields are automatically migrated to the new per-provider map on first load. Legacy fields are cleared from disk on the next save.
- **`sec` Settings UI updated** — API key fields in Settings now show an "🛡️ Encrypted at rest" description. Keys are written through `setApiKey()` instead of direct field assignment.

### Performance (⚡ Bolt)
- **`perf` Model-aware auto-config** — `getAutoConfigFromModel()` replaces `getAutoConfig()` as the entry point for Auto mode. Config now adapts to the *detected model size* (from `parseModelSizeB`) in addition to hardware tier. A 1.7B model on GPU now gets the same tight config as on CPU; a 70B cloud model always gets full detailed prompts regardless of hardware.
- **`perf` `parseModelSizeB()`** — New function extracts parameter count (in billions) from model name strings. Uses a two-pass strategy: first the `MODEL_KNOWN_SIZES` lookup table (50+ entries, longest-match-first for specificity), then a regex fallback for any `NB` / `N.NB` pattern in the name.
- **`perf` `parseModelQuant()`** — Extracts quantization tier (`q2`, `q4`, `q8`, `fp16`) from model names for future context-window tuning.
- **`perf` `MODEL_KNOWN_SIZES` table** — 50+ model identifiers mapped to approximate B parameter counts, covering Anthropic Claude, OpenAI GPT, Mistral, Meta Llama, Qwen, Google Gemma, SmolLM, LFM, DeepSeek, and Phi model families.
- **`perf` Live model fetching** — `fetchOllamaModels()` calls Ollama's `/api/tags` endpoint to retrieve locally pulled models with real size data. `fetchLMStudioModels()` tries `/api/v1/models` then `/v1/models` (compat fallback) on LM Studio. Both functions are non-blocking; failure (server offline) returns `null` silently.

### UX (🎨 Palette)
- **`ux` Right-click file menu** — Right-clicking any `.md` file in the file explorer now shows "📖 Generate Wiki for this note" and "🔄 Refresh Wiki index" menu items. Implemented via `app.workspace.on("file-menu")`.
- **`ux` Right-click editor menu** — Right-clicking in the editor shows "📖 Generate Wiki for this note". If text is selected (3–200 chars), a third option appears: "📖 Generate Wiki: [selection]" for single-term targeted generation.
- **`ux` `generateWikiNotesForFile(file)`** — New method. Scans only the given TFile's wikilinks and generates wiki notes for missing terms. Called from both context menus.
- **`ux` `generateWikiNoteForTerm(term, sourceFile?)`** — New method. Generates a single wiki note for a given term string. Called from the editor selection menu.
- **`ux` Mobile-first CSS** — Settings panel injects a `<style>` block (`#vault-wiki-settings-css`) with: 44px minimum touch targets per Apple HIG / WCAG 2.5.5, `env(safe-area-inset-*)` for iPhone notch/home indicator, responsive column layout on screens under 480px, and smooth `<details>` section animations.
- **`ux` Model size badge** — The Settings model name field now shows a hint below it when a model is recognized: detected parameter count, auto preset, context size, and batch size that will be applied in Auto mode.
- **`ux` Live model picker button** — Ollama and LM Studio provider settings now show a "⟳ Fetch local models" button that populates the model dropdown from the running local server.

### Documentation & Developer Experience
- **`docs` Developer quick-start** in file header — architecture map, 3-step "add a new provider" guide, key conventions, build instructions, commit style.
- **`docs` `CHANGELOG.md`** — this file.
- **`docs` `CONTRIBUTING.md`** — detailed contributor guide.
- **`docs` `INTEGRATION.md`** — guide for integrating with other plugins (Obsidian Copilot, Dataview, Templater, etc.).
- **`docs` `DEBUGGING.md`** — comprehensive debugging guide with 10+ techniques.
- **`docs` `LICENSE.md`** — Apache 2.0 + Commons Clause + Pro-Consumer Addendum.
- **`docs` `package.json` (npm)** — project ready for `npm install && npm run build`.

### Refactoring
- **`refactor` Code readability** — all major functions now have JSDoc comments with `@param` / `@returns`. Section dividers are standardised. Class method groups have inline headings.

---

## v1.0.0 — Public Beta  *(2025)*

### New Providers
- **`feat` Anthropic Claude** (`anthropic`) — native `/v1/messages` API (not OpenAI-compatible). `x-api-key` header. `system` as top-level field. Default: `claude-3-5-haiku-20241022`. Implemented via `_callAnthropicAPI()` and `_getAISummaryAnthropic()`.
- **`feat` Groq** (`groq`) — OpenAI-compat at `https://api.groq.com/openai/v1`. Default: `llama-3.1-8b-instant`.
- **`feat` Ollama** (`ollama`) — local OpenAI-compat at `http://localhost:11434/v1`. No key required. Default: `llama3.2`.
- **`feat` OpenRouter** (`openrouter`) — OpenAI-compat. Auto-injects `HTTP-Referer: https://obsidian.md` and `X-Title: Vault Wiki` headers. Default: `meta-llama/llama-3.1-8b-instruct:free`.
- **`feat` Together AI** (`together`) — OpenAI-compat at `https://api.together.xyz/v1`. Default: `meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo`.
- **`feat` `PROVIDERS[]` table** — canonical provider descriptor array. Each entry has: `id`, `label`, `emoji`, `defaultEndpoint`, `defaultModel`, `apiFormat`, `requiresKey`, `localOnly`, `keyHeader`, `models[]`.
- **`feat` `PROVIDER_MAP`** — `Map<id, descriptor>` for O(1) provider lookup.
- **`feat` `getProviderConfig(settings)`** — returns descriptor for current provider.
- **`feat` `providerNeedsKey(settings)`** — checks if a key is required and missing.

### Security (Sentinel × 5)
- **`sec`** API key masking tightened — `maskApiKey()` now shows first 4 + last 4 chars with bullets in between.
- **`sec`** Rate-limit guard — `_shownNoKeyWarning` flag prevents spamming error notices.
- **`sec`** Model name validation — empty, whitespace-only, or >200 char model names rejected at save time.
- **`sec`** HTTPS enforcement — cloud providers (requiresKey && !localOnly) warn via `Notice` if endpoint uses HTTP.
- **`sec`** Wiki-dir exclusion hardened — all three scan paths (`buildIndex` phase 1 & 3, `generateAll` pre-read loop) now correctly skip wiki-prefixed source files.

### Performance (Bolt × 5)
- **`perf`** `AbortController` on streaming — generation can be cancelled mid-stream.
- **`perf`** Early-exit on cancel — `generateAll` checks `_cancelled` between every term batch.
- **`perf`** `isCloud` guard hoisted out of per-term loop — computed once per pass.
- **`perf`** Regex pre-compiled — wikilink pattern compiled once, reused.
- **`perf`** Wiki-file reads skipped in all scan paths — no wasted I/O on own output.

### UX (Palette × 5)
- **`ux`** Provider chip icons (emoji) in the dropdown.
- **`ux`** Model suggestions per provider (datalist).
- **`ux`** `type=password` + `autocomplete=off` on all key fields including Anthropic.
- **`ux`** Streaming token counter in the status bar during generation.
- **`ux`** Clearer empty-state copy — first-run instructions more actionable.

---

## v0.9.2  *(2025)*

### Performance (Bolt × 10)

| Pass | What changed | Impact |
|------|-------------|--------|
| P1 | `Promise.all` → serial loop for local AI providers | Fixes LM Studio multi-instance hang |
| P2 | `detectHardwareMode()` hoisted out of per-note path | Was called 200×/pass; now 1× |
| P3 | `extractContext` filter() passes eliminated | Incremental type counting |
| P4 | Settings reads hoisted from mention loop | `contextDepth`, `includeFullParagraphs` read once |
| P5 | `extractLinesN(n)` param-based variant | No settings read inside hot loop |
| P6 | System/user prompt cached as `_resolvedSystemPrompt` | No template parsing per note |
| P7 | Endpoint strings trimmed once per pass | Stored as `_cachedOAIEndpoint`, cleared after |
| P8 | Header comment compressed 18.7 KB → 1.9 KB | Parsed on every Obsidian load |
| P9 | Prompt presets rewritten | Explicit format rules, task-first ordering |
| P10 | Default prompts synced to `balanced` preset | `detectPromptPreset()` now works on fresh install |

---

## v0.9.1  *(2025)*

- **`feat`** Prompt presets: Small (1–3B), Balanced (7B), Detailed (13B+) — with live token count estimates shown in Settings.
- **`ux`** Preset selector dropdown in Settings → AI Config section.
- **`ux`** Custom prompt editor preserved when switching presets (shows diff indicator).

---

## v0.9.0  *(2025)*

- **`feat` `stripMarkupForAI()`** — 12-pass Obsidian/Markdown markup stripper (~15–30% token reduction). Strips: YAML frontmatter, callout headers, wikilink aliases, plain wikilinks, highlights, inline tags, bold/italic, heading hashes, horizontal rules, HTML comments, code fence delimiters, and excess blank lines.
- **`perf`** Tighter default prompts (~60 fewer prompt tokens/call vs v0.8.x).
- **`ux`** Collapsible settings sections — Auto / Manual / Advanced modes.
- **`fix`** Wiki notes excluded as source files from index — prevents self-referential feedback loop where wiki notes link back to themselves and inflate the term index.

---

## v3.8.0  *(2025)*

- **`feat` AI Subcategories** — `aiSubcategoriesEnabled` toggle. When on, each generated wiki note is assigned an AI-inferred subcategory folder within its main category. Uses a separate lightweight AI call with `max_tokens: 20`. Prompt in `PROMPT_PRESETS.*.subcatSystem`.
- **`feat` `aiSubcategorySystemPrompt`** — configurable system prompt for classification.
- **`feat` `aiSubcategoryContextChars: 600`** — small context snippet for classifier; intentionally conservative.

---

## v3.6.3  *(2025)*

- **`perf`** `parts[]` join pattern throughout — eliminated ~9.6 MB of intermediate string allocations per large generation pass.
- **`perf`** `getFileCache()` + `getAllTags()` called once per file instead of twice (was called separately in category assignment and tag generation).

---

## v3.6.0  *(2025)*

- **`feat` LM Studio native `/api/v1/chat`** — stateful conversations via `previous_response_id`, SSE streaming with full event parsing (`message.delta`, `reasoning.delta`), hardware-mode-aware request parameters, Bearer token authentication.
- **`feat` Hardware optimization modes** — CPU / GPU / Android / iOS profiles. Each sets default model, context length, and generation parameters tuned for the hardware tier.
- **`feat` `detectHardwareMode()`** — platform detection via `navigator.userAgent` + `hardwareConcurrency`.
- **`feat` `getHardwareModeParams()`** — returns `{ context_length }` per mode.
- **`feat` `getDefaultModelForHardware()`** — recommends a sensible default GGUF model per hardware tier.

---

## v3.5.2  *(2025)*

- **`perf`** `headingByLine[]` — O(1) lookup array built once per file (was O(lineIndex) linear scan per mention).
- **`perf`** Reverse synonym map pre-computed in `_buildReverseSynonyms()` — O(1) lookup at match time.
- **`perf`** `wikiDirPrefix` hoisted outside all hot loops.
- **`perf`** `extractParagraph` — single array allocation instead of incremental push.

---

## v3.5.1  *(2025)*

- **`perf`** `fileContentCache` stores `{content, lines, file}` — no re-split per note in the same pass.
- **`perf`** `mentionIndex` — O(1) `has()` + `get()` merged into a single `get()` with null check.

---

## v3.4.0  *(2025)*

- **`perf`** `rawContext` paragraph deduplication — content-hash Set prevents the same paragraph being sent to the AI multiple times when the same file links to a term in multiple places.
- **`perf`** AI context markup stripping + hard char cap applied before every API call.

---

## v3.2.0  *(2025)*

- **`perf`** `extractContext()` rebuilt from O(files × terms) to O(mentions) — the core hot-path function.
- **`perf`** `isLookupableTerm()` pre-flight guard — cheap filter before expensive context extraction.

---

*For pre-v3.2.0 history see the original dev notes in the repository.*
