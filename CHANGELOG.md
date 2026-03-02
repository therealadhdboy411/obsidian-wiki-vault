# Changelog

All notable changes to WikiVault Unified are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

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
