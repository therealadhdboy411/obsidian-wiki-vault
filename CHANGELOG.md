# Changelog

All notable changes to WikiVault Unified are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [3.7.0] — 2025-03-05

### Added

- **LM Studio Native v1 API support** — stateful conversations, SSE streaming, and hardware-aware model defaults
- **Hardware Optimization Modes** — auto-detects and tunes parameters for CPU (laptop), GPU (desktop), Android (NPU), and iOS (ANE)
- **Title Case naming** — wiki note titles and filenames now use Title Case (e.g., "Action Potential") instead of ALL CAPS
- **Auto-update pass** — existing wiki notes are regenerated when source notes are modified or AI summary is missing
- **"Find Best Model" button** — automated probe of Mistral models to find the best working one for your account
- **Token exhaustion recovery** — preserves existing summaries and adds a warning callout if the AI response is truncated
- **Enhanced Category sorting** — weighted path-segment scorer and term-level keyword matching for smarter auto-organisation
- **DoS hardening** — null-byte stripping and 200-character term length caps for filesystem safety

### Changed

- **Performance Optimization (BOLT v3.5 & v3.6)** — 15+ deep sweeps eliminating ~80,000 redundant operations per pass
- **Note Layout redesign** — Title (UPPERCASE) → TOC → AI Summary (plain prose) → Wikipedia → Dictionary → Mentions
- **Metadata caching** — eliminated redundant `getFileCache()` and `getAllTags()` calls during generation
- **String assembly** — replaced `+=` with array-join patterns to drastically reduce GC pressure and memory usage

### Fixed

- **Title Case acronym preservation** — (DNA, ATP, NMJ, ADHD) now correctly preserved while "SHOUTED" legacy terms are title-cased
- **Category vote logic** — single unmatched files can no longer drag a term into "General" (requires ≥2 default votes)
- **Race condition guard** — prevents "File already exists" errors during concurrent batch processing

## [3.0.0] — 2025-02-25

### Added

- **WikiVaultLogger** — structured session logging to markdown files in your vault
  - Auto-flushes every 30 seconds (survives crashes)
  - Error quick-reference index at top of each log file
  - Session summary table: notes generated/failed/skipped, API calls, runtime
  - Full stack traces for every error with JSON context blobs
  - Log pruning: auto-deletes files older than `maxLogAgeDays`
  - Four log levels: `DEBUG | INFO | WARN | ERROR`
  - New commands: _Open Latest Log_, _Flush Log to Vault Now_
  - New settings section: Logging & Diagnostics

- **Performance timers** — every major operation wrapped with `logger.time()` reporting duration in milliseconds
- **Pause / Resume / Cancel** — new commands and internal logic to control active generation runs
- **Context Depth Modes** — settings to choose between `full`, `partial` (default), and `performance` scanning depths
- **API Response Caching** — in-memory caches for Wikipedia and Dictionary data to eliminate duplicate network fetches
- **Copilot-friendly Frontmatter** — added `type: wiki-note` and `copilot-index: true` for better RAG integration

### Changed

- **API fetch deduplication** — Wikipedia and Dictionary data is now fetched once per term and reused for both display and AI context injection (was fetched twice, doubling API calls)
- **Debounced modify handler** — vault `modify` events now debounce 2 seconds before refreshing the term cache (was triggering on every save, causing index thrashing)
- **Incremental cache refresh** — `TermCache.refresh()` now returns a boolean indicating whether anything changed
- **UI Yielding** — critical loops now periodically yield to the event loop to prevent UI freezes during heavy operations

### Fixed

- **⚡ Performance: morphological variant hoisting** _(Bolt)_
  - `getSingularForm(term)` and `getPluralForm(term)` were called inside the innermost scan loop (once per line, per file). Now computed once per term and referenced as variables.
  - Benchmark: **~126× faster** for `extractContext` across a realistic vault (144,000 redundant calls eliminated)

- **🛡️ Security: path traversal via unsanitized term** _(Sentinel)_
  - Terms from `unresolvedLinks` (e.g. `[[../../.obsidian/app.json]]`) could escape the wiki directory and create/overwrite arbitrary vault files
  - Fix: `sanitizeTermForPath()` strips `..`, path separators, and filesystem-unsafe characters before any file path is constructed

- **🛡️ Security: SSRF protection for API endpoints** _(Sentinel)_
  - User-configurable API endpoints are now validated via `validateEndpointUrl()` to block `localhost` and private IP ranges

- **🛡️ Security: Write-safety guard** _(Sentinel)_
  - `assertSafeWritePath()` ensures all file writes stay within the wiki or log directories

- **🛡️ Security: API key exposed in plaintext settings UI** _(Sentinel)_
  - API key input field now renders as `type="password"` with `autocomplete="off"`

---

## [2.x] — Legacy

Previous versions combined the Virtual Linker rendering engine with the
original WikiVault note generator. See git history for details.
