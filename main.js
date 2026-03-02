/*
Vault Wiki — by adhdboy411 and Claude
Enhanced Implementation v3.6.0
Combines Virtual Linker rendering + Wiki note generation
+ WikiVaultLogger: structured session logs, performance timers, detailed bug reports

⚡ BOLT v3.5.2 — 9-pass deep performance sweep:

  Fix 1 — findPreviousHeading eliminated from hot path (CRITICAL):
       Before: called once per mention entry, scanning backward O(lineIndex) lines
       each time. On a 300-line file with avg line 150, that's 150 reads × 400
       calls = 60,000 line reads per generation pass.
       After:  headingByLine[i] array pre-built in a single O(n) forward pass per
       file during preRead. Every heading lookup is now O(1).
       Impact: ~60,000 line reads eliminated per 80-term generation pass.

  Fix 2 — Reverse synonym map pre-computed in TermCache (HIGH):
       Before: indexLinkedFile() called Object.entries(synonyms) on every linked
       file, iterating all 22 synonyms and calling toLowerCase() each time.
       80 files × 22 synonyms = 1,760 iterations + 1,760 string allocs.
       After:  _reverseSynonyms Map built once at construction; lookup is O(1).
       Rebuilt automatically when settings change (saveSettings hook).
       Impact: ~1,760 map iterations + string allocations eliminated per buildIndex.

  Fix 3 — Redundant toLowerCase() calls cached (HIGH):
       Two sites (indexLinkedFile synonym check, glossaryContext loop) were calling
       toLowerCase() twice on the same value. Now cached in a local variable.
       Glossary loop was also calling term.toLowerCase() on every line iteration —
       now hoisted outside the loop.

  Fix 4 — mentionIndex double Map lookup → single get+check (MEDIUM):
       Before: .has(key) then .get(key) = 2 Map operations per [[wikilink]].
       After:  let arr = map.get(key); if (!arr) { arr=[]; map.set(key,arr); }
       On a 500-file vault with 10 links/file: ~5,000 redundant Map ops eliminated.

  Fix 5 — wikiDirPrefix hoisted outside all hot loops (MEDIUM):
       Four occurrences of `wikiDir + '/'` were inside loops (preRead, mention-index
       build, extractContext Phase 1 & 2). String concat inside a loop creates a new
       string object on every iteration. Now computed once per function call.

  Fix 6 — extractParagraph single array allocation (MEDIUM):
       Before: lines.slice(start, end+1) then .filter() = 2 array allocations.
       After:  single result array with direct push in the expansion loop.
       Called once per mention in partial mode — scales with mention count.

  Fix 7 — findMatches inner loop: settings reads hoisted (MEDIUM):
       caseSensitiveMatching and maxWordsToMatch were read from the settings object
       on every iteration of the O(words²) inner loop. Now cached in locals before
       the loop — saves O(words²) property reads per line in full mode.

  Fix 8 — CategoryManager categoryByName Map pre-built (LOW):
       Before: determineBestCategory() called categories.find() (O(n)) to resolve
       the winner of the vote loop. getDefaultCategory() also used find().
       After:  _categoryByName Map built at construction; both lookups are O(1).
       Rebuilt automatically when settings change.

  Fix 9 — batch.join() guarded by log level check (LOW):
       batch.join(", ") allocated a new string every batch even at INFO level
       (the default), where the string was immediately discarded.
       Now only evaluated when DEBUG logging is active.

  COMBINED ESTIMATE: ~80,000+ unnecessary operations eliminated per generation pass
  on a 500-file vault. Most impactful on vaults with many inter-linked notes.

⚡ BOLT v3.5.1 — 6-pass deep performance sweep:

  B1 — getAbstractFileByPath eliminated from mention-index build loop:
       fileContentCache now stores {content, lines, file} instead of just the
       string. The file object is captured during pre-read and reused downstream,
       removing one O(log n) vault hash-map lookup per file per generation pass.
       Impact: −500 vault lookups on a 500-file vault.

  B2 — content.split('\\n') eliminated from extractContext per mention-entry:
       The lines array is pre-built once per file during pre-read and stored in
       the cache. extractContext no longer re-splits the same file content every
       time it processes a mention of that file.
       Impact: −2,500 array allocations (~500ms) on a 500-file vault.

  B3 — join('\\n')+split('\\n') roundtrip eliminated in mention pipeline:
       extractContext stored context as context.join('\\n') (string); formatMention
       then called mention.content.split('\\n') to iterate lines. Now the context
       array is stored as-is (contentLines: string[]) and formatMention iterates
       it directly — zero intermediate string/array allocation.
       Impact: −640 redundant join+split calls per 80-term generation pass.

  B4 — String concatenation in formatMention replaced with array push+join:
       Before: 7–10 `output +=` per mention → O(k) intermediate strings per call.
       After:  parts array pushed once per piece, joined once at the end.
       Impact: ~3× less GC pressure on vaults with large mention counts.

  B5 — Mention-index build shares pre-split lines from fileContentCache:
       The mention-index build was doing content.split('\\n') for every file.
       That's now free — the lines are already in the cache from B2.
       Impact: −500 more array allocations during index build.

  B6 — linksArray.includes() O(n) → linksSet.has() O(1):
       The auto-update dedup check iterated the full linksArray for every
       existing wiki file. Replaced with a parallel Set that's kept in sync.
       Impact: −O(n²) behaviour when many wiki notes need auto-update.

  COMBINED ESTIMATE: ~600ms–1s saved per generation pass on a 500-file vault.

New in v3.5.0:
  ✅ NEW: Note layout redesigned — Title (UPPERCASE) → TOC → AI Summary → Wikipedia → Dictionary → Mentions
  ✅ NEW: AI Summary is now plain prose — NO blockquote ">" formatting.
  ✅ NEW: All wiki note titles and file names are UPPERCASED automatically.
  ✅ NEW: "Find Best Model" button — probes Mistral models smallest-first, auto-sets the working one.
  ✅ NEW: Auto-update pass — existing wiki notes regenerated when source notes are modified
         or when an AI summary is missing.
  ✅ NEW: Reindex Everything button in Generation Controls (was already present, now highlighted).
  ⚡ BOLT: Parallelised pre-read + mention-index build during startup.
  ⚡ BOLT: Deferred metadata-cache wait on layout-ready to avoid blocking Obsidian startup.
  ⚡ BOLT: generateAll skips generating tags/related-concepts API calls when note already
         exists and source notes are unchanged (content-hash guard).

⚡ BOLT v3.4.0 — AI context efficiency + mistral-small-latest fix:
  ⚡ DEDUP: rawContext paragraphs deduplicated before joining using a content-hash
       Set. If a note mentions [[Term]] 5× in 5 paragraphs, only unique paragraphs
       are sent. Expected 30–80% context size reduction on typical vaults.
       Root cause of mistral-small-latest returning empty responses: too much
       repeated context pushed the combined payload past the model's practical limit.
  ⚡ MARKUP STRIP: Obsidian-specific markup stripped from AI context before sending —
       [[wikilinks]] → plain text, ==highlights==, #tags, YAML frontmatter removed.
       5–15% token reduction on every call, cleaner text for the model to parse.
  ⚡ CONTEXT CAP: Reduced from 50k chars (≈12k tokens) to 20k chars (≈5k tokens).
       Paragraph-boundary truncation instead of mid-character slice.
       Configurable via Settings → Performance → AI Context Max Chars.
       This is the specific fix that makes mistral-small-latest work reliably.

New in v3.6.0:
  ✅ NEW: LM Studio native /api/v1/chat — stateful conversations, SSE streaming, response_id continuity.
  ✅ NEW: Hardware optimization modes — CPU (laptop), GPU (desktop), Android (NPU/Vulkan), iOS (ANE/Metal).
  ✅ NEW: Note titles and file names are now Title Case instead of ALL CAPS.
         Acronyms (DNA, ATP, NMJ) preserved as-is; function words (of, the, and) lowercase mid-title.
  ✅ NEW: Mistral model hierarchy corrected: ministral-8b-latest → ministral-14b-latest
         → mistral-small-latest (goal) → mistral-medium-latest → mistral-large-latest (not recommended).
  🛡️ SENTINEL: sanitizeTermForPath() strips null bytes + caps at 200 chars (DoS hardening).
  🎨 PALETTE: Status bar chip is now clickable + has ARIA label + tooltip.
  🎨 PALETTE: What's New v3.6.0 banner in Settings.

New in v3.5.0:
  🐛 FIXED: AI errors swallowed silently — now surfaces actionable Notices for
       401/404/429/5xx/timeout errors on the first failure per session.
  🐛 FIXED: AI timeout raised to 60s, max_tokens: 1500 added.
  ✅ NEW: Test AI Connection button in Settings → AI Provider.
  ✅ NEW: Model changes show "active immediately" Notice.
  ✅ NEW: Pause / Resume / Cancel button bar at top of Settings.
  ✅ NEW: Run Generation Now button in Settings.

Improvements in v3.1.0 (Bolt ⚡ / Sentinel 🛡️ / Palette 🎨):
  ⚡ Visual progress bar with percentage + ETA
  ⚡ Startup index-building status notice
  ⚡ Request timeouts prevent UI hangs on slow APIs
  🛡️ HTTPS-only enforcement on all external endpoints
  🛡️ Context length cap prevents memory exhaustion on huge vaults
  🛡️ onload wrapped in try-catch for graceful startup failures
  🎨 Rich progress format: [████████░░] 80% (8/10) — ETA: 00:00:05
  🎨 Startup notice with dismiss after index ready
  🎨 Settings page shows index status + file count

Bug fixes & performance in v3.2.0:
  🐛 FIXED: validateEndpointSecurity() was called but never defined → ReferenceError
  🐛 FIXED: Dictionary/Wikipedia HTTP 404 responses logged at DEBUG not ERROR.
  ⚡ extractContext() rebuilt as O(mentions) per term instead of O(files × terms).
  ⚡ isLookupableTerm() pre-flight guard skips guaranteed-404 requests.
*/

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

var main_exports = {};
__export(main_exports, {
  default: () => WikiVaultUnifiedPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

var DEFAULT_SETTINGS = {
  // AI Provider
  provider: "mistral",
  openaiEndpoint: "https://api.mistral.ai/v1",
  openaiApiKey: "",
  modelName: "mistral-medium-latest",
  apiType: "openai",

  // LM Studio native v1 API settings
  lmstudioV1Endpoint: "http://localhost:1234",
  lmstudioV1ApiToken: "",
  lmstudioV1Stateful: true,
  lmstudioV1LastResponseId: null,
  lmstudioV1StreamingEnabled: true,

  // Hardware optimization mode
  // "cpu"     2014 Integrated GPU / laptop: smaller models, single-batch, low context
  // "gpu"     2014 Discrete GPU / desktop: larger models, higher parallelism, big context
  // "android" 2014 Android NPU/GPU: efficient ARM-optimized models
  // "ios"     2014 iPhone ANE (Apple Neural Engine): INT4/INT8 CoreML-optimized models
  // "auto"    2014 Detect from platform heuristics
  hardwareMode: "auto",
  showHardwareModeInStatus: true,

  // Core Settings
  similarityThreshold: 0.7,
  runOnStartup: false,
  runOnFileSwitch: false,
  useCustomDirectory: true,
  customDirectoryName: "Wiki",
  showProgressNotification: true,
  batchSize: 10,

  // ⚡ BOLT: Context depth controls how much work extractContext() does per file.
  // "full"        — Scans wikilinks + virtual/fuzzy mentions (findMatches on every line). Most thorough.
  // "partial"     — Only detects [[wikilinks]], extracts surrounding paragraph. Skips findMatches(). ~3× faster.
  // "performance" — Only detects [[wikilinks]], extracts just the link line + heading. ~10× faster.
  contextDepth: "partial",

  // Knowledge Sources
  useDictionaryAPI: true,
  dictionaryAPIEndpoint: "https://api.dictionaryapi.dev/api/v2/entries/en",
  useWikipedia: true,
  useWikipediaInContext: true,
  useDictionaryInContext: true,
  glossaryBasePath: "",

  // AI Prompts
  systemPrompt: "You are a helpful assistant that synthesizes information from the user's notes and provided reference materials. Base your responses on the context provided. Format your responses with key terms in **bold**.",
  userPromptTemplate: 'Based on the following information, provide a comprehensive summary of "{{term}}":\n\n{{context}}\n\nProvide a detailed explanation with key terms in **bold**.',

  // ⚡ BOLT: AI context window cap.
  // 20k chars ≈ 5k tokens — plenty for a focused wiki summary.
  // Raise if using a large-context model (GPT-4, mistral-large, etc.) and
  // want deeper context. Lower (e.g. 8000) for small/fast models.
  aiContextMaxChars: 20_000,

  // Context Extraction
  includeHeadingContext: true,
  includeFullParagraphs: true,
  contextLinesAround: 2,

  // Generation Features
  generateTags: true,
  maxTags: 20,
  tagsIncludeHashPrefix: true,
  generateRelatedConcepts: true,
  maxRelatedConcepts: 10,
  trackModel: true,
  usePriorityQueue: true,

  // Output Format
  aiSummaryDisclaimer: "*AI can make mistakes, always check information*",
  extractKeyConceptsFromSummary: true,
  wikipediaLinkText: "Read more on Wikipedia",
  preserveMentionFormatting: true,

  // Virtual Links (from Virtual Linker)
  virtualLinksEnabled: true,
  virtualLinkSuffix: "🔗",
  applyDefaultLinkStyling: true,
  matchWholeWordsOnly: true,
  matchBeginningOfWords: true,
  matchEndOfWords: true,
  matchAnyPartsOfWords: false,
  caseSensitiveMatching: false,
  onlyLinkOnce: true,
  excludeLinksToOwnNote: true,
  excludeLinksToRealLinkedFiles: true,
  includeAliases: true,
  alwaysShowMultipleReferences: true,

  // Smart Matching
  minWordLengthForAutoDetect: 3,
  maxWordsToMatch: 3,
  preferLongerMatches: true,
  showAllPossibleMatches: true,

  // File Filtering
  excludedFileTypes: ["png", "jpg", "jpeg", "gif", "svg", "pdf", "mp4", "mp3", "wav", "webp", "bmp"],

  // Categories
  useCategories: true,
  categories: [
    {
      name: "General",
      path: "Wiki/General",
      sourceFolder: "",
      tags: [],
      enabled: true
    }
  ],
  defaultCategory: "General",
  autoAssignCategory: true,

  // Synonyms & Abbreviations
  synonyms: {
    "ML": "Machine Learning",
    "AI": "Artificial Intelligence",
    "DL": "Deep Learning",
    "NLP": "Natural Language Processing",
    "RL": "Reinforcement Learning",
    "NN": "Neural Network",
    "RMP": "Resting Membrane Potential",
    "NMJ": "Neuromuscular Junction",
    "ACh": "Acetylcholine",
    "AP": "Action Potential",
    "ATP": "Adenosine Triphosphate"
  },

  // Logging
  enableLogging: true,
  logLevel: "INFO",         // DEBUG | INFO | WARN | ERROR
  logDirectory: "VaultWiki/Logs",
  maxLogAgeDays: 30,

  // Auto-update detection
  // When true, generateAll() will also re-process existing wiki notes whose source
  // notes have been modified since the wiki note was last generated.
  autoUpdateExistingNotes: true,
};

// Irregular plurals
var IRREGULAR_PLURALS = {
  "child": "children", "person": "people", "man": "men", "woman": "women",
  "tooth": "teeth", "foot": "feet", "mouse": "mice", "goose": "geese",
  "analysis": "analyses", "thesis": "theses", "criterion": "criteria",
  "phenomenon": "phenomena"
};

// ============================================================================
// LOGGER
// ============================================================================

/*
  WikiVaultLogger
  ───────────────
  • Buffers log entries in memory and flushes them to a markdown file in the
    vault under `settings.logDirectory/session-YYYY-MM-DD_HH-MM-SS.md`.
  • Supports four levels: DEBUG < INFO < WARN < ERROR
  • Wraps async functions with performance timing via `time(label, fn)`.
  • Accumulates a per-session stats object that is written as a summary table
    at the top of the log file when `finalize()` is called.
  • Always writes to console as well so the Obsidian developer console remains
    useful even when vault writes fail.
*/
class WikiVaultLogger {
  constructor(app, settings) {
    this.app = app;
    this.settings = settings;

    this.LEVELS = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
    this.sessionStart = new Date();
    this.sessionId = this.formatDate(this.sessionStart).replace(/[: ]/g, "-");
    this.entries = [];       // { ts, level, context, message, extra }
    this.stats = {
      generated: 0,
      skipped: 0,
      failed: 0,
      apiCalls: 0,
      apiErrors: 0,
      cacheHits: 0,
      totalMs: 0,
    };
    this._flushTimer = null;
    this._scheduleFlush();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  debug(context, message, extra) { this._log("DEBUG", context, message, extra); }
  info(context, message, extra) { this._log("INFO", context, message, extra); }
  warn(context, message, extra) { this._log("WARN", context, message, extra); }

  /** Log an error with full stack trace if an Error object is provided. */
  error(context, message, errOrExtra) {
    let extra = errOrExtra;
    if (errOrExtra instanceof Error) {
      extra = {
        errorName: errOrExtra.name,
        errorMessage: errOrExtra.message,
        stack: errOrExtra.stack,
      };
    }
    this._log("ERROR", context, message, extra);
  }

  /**
   * Wrap an async function with timing. Logs duration at DEBUG level.
   * Usage: const result = await logger.time("buildNoteContent", () => fn());
   */
  async time(label, context, fn) {
    const t0 = performance.now();
    try {
      const result = await fn();
      const ms = Math.round(performance.now() - t0);
      this.debug(context, `⏱ ${label} took ${ms}ms`);
      return result;
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      this.error(context, `⏱ ${label} FAILED after ${ms}ms`, err);
      throw err;
    }
  }

  /** Must be called at end of generation session to write final summary + flush. */
  async finalize() {
    this.stats.totalMs = Math.round(performance.now() - this._loadedAt);
    this.info("Session", "Generation session complete", this.stats);
    await this._flush();
    if (this._flushTimer) clearInterval(this._flushTimer);
    await this._pruneOldLogs();
  }

  /** Call once after plugin loads so we capture wall-clock start accurately. */
  markSessionStart() {
    this._loadedAt = performance.now();
    this.info("Plugin", "Vault Wiki session started", {
      sessionId: this.sessionId,
      logLevel: this.settings.logLevel,
    });
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _log(level, context, message, extra) {
    if (!this.settings.enableLogging) return;
    if (this.LEVELS[level] < this.LEVELS[this.settings.logLevel]) return;

    const entry = {
      ts: new Date().toISOString(),
      level,
      context,
      message,
      extra: extra ?? null,
    };
    this.entries.push(entry);

    // Mirror to console with appropriate method
    const consoleFn = level === "ERROR" ? "error"
      : level === "WARN" ? "warn"
        : level === "DEBUG" ? "debug"
          : "log";
    console[consoleFn](`[VaultWiki][${level}][${context}] ${message}`, extra ?? "");
  }

  _scheduleFlush() {
    // Flush buffer to disk every 30 seconds so data survives crashes
    this._flushTimer = setInterval(() => this._flush(), 30_000);
  }

  async _flush() {
    if (!this.settings.enableLogging || this.entries.length === 0) return;

    try {
      const logDir = this.settings.logDirectory || "VaultWiki/Logs";
      await this._ensureFolder(logDir);

      const filePath = `${logDir}/session-${this.sessionId}.md`;
      const content = this._render();

      const existing = this.app.vault.getAbstractFileByPath(filePath);
      if (existing instanceof import_obsidian.TFile) {
        await this.app.vault.modify(existing, content);
      } else {
        await this.app.vault.create(filePath, content);
      }
    } catch (err) {
      // Don't throw — logging must never crash the plugin
      console.error("[VaultWiki][Logger] Failed to flush log to vault:", err);
    }
  }

  _render() {
    const lines = [];

    // ── Header ──────────────────────────────────────────────────────────────
    lines.push(`# Vault Wiki Log — ${this.sessionId}`);
    lines.push("");
    lines.push(`**Session started:** ${this.sessionStart.toISOString()}  `);
    lines.push(`**Plugin version:** 3.2.0  `);
    lines.push(`**Plugin:** Vault Wiki by adhdboy411 and Claude  `);
    lines.push(`**Log level:** ${this.settings.logLevel}`);
    lines.push("");

    // ── Stats summary ───────────────────────────────────────────────────────
    lines.push("## Session Summary");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|--------|-------|");
    lines.push(`| Notes generated | ${this.stats.generated} |`);
    lines.push(`| Notes skipped | ${this.stats.skipped} |`);
    lines.push(`| Notes failed | ${this.stats.failed} |`);
    lines.push(`| API calls | ${this.stats.apiCalls} |`);
    lines.push(`| API errors | ${this.stats.apiErrors} |`);
    lines.push(`| Cache hits | ${this.stats.cacheHits} |`);
    if (this.stats.totalMs > 0) {
      lines.push(`| Total runtime | ${(this.stats.totalMs / 1000).toFixed(1)}s |`);
    }
    lines.push("");

    // ── Error index (fast-scan section) ─────────────────────────────────────
    const errors = this.entries.filter(e => e.level === "ERROR");
    if (errors.length > 0) {
      lines.push("## ⛔ Errors Quick-Reference");
      lines.push("");
      for (const e of errors) {
        lines.push(`- \`${e.ts}\` **[${e.context}]** ${e.message}`);
      }
      lines.push("");
    }

    const warns = this.entries.filter(e => e.level === "WARN");
    if (warns.length > 0) {
      lines.push("## ⚠️ Warnings Quick-Reference");
      lines.push("");
      for (const w of warns) {
        lines.push(`- \`${w.ts}\` **[${w.context}]** ${w.message}`);
      }
      lines.push("");
    }

    // ── Full log ─────────────────────────────────────────────────────────────
    lines.push("## Full Log");
    lines.push("");

    for (const e of this.entries) {
      const icon = e.level === "ERROR" ? "⛔"
        : e.level === "WARN" ? "⚠️"
          : e.level === "DEBUG" ? "🔍"
            : "ℹ️";
      lines.push(`### ${icon} \`${e.ts}\` [${e.level}] [${e.context}]`);
      lines.push("");
      lines.push(e.message);

      if (e.extra) {
        lines.push("");
        lines.push("```json");
        try {
          lines.push(JSON.stringify(e.extra, null, 2));
        } catch {
          lines.push(String(e.extra));
        }
        lines.push("```");
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  async _ensureFolder(path) {
    const parts = path.split("/");
    let built = "";
    for (const part of parts) {
      built = built ? `${built}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(built);
      if (!(existing instanceof import_obsidian.TFolder)) {
        await this.app.vault.createFolder(built).catch(() => { });
      }
    }
  }

  async _pruneOldLogs() {
    try {
      const logDir = this.settings.logDirectory || "VaultWiki/Logs";
      const folder = this.app.vault.getAbstractFileByPath(logDir);
      if (!(folder instanceof import_obsidian.TFolder)) return;

      const maxAge = (this.settings.maxLogAgeDays || 30) * 86_400_000;
      const now = Date.now();
      for (const child of folder.children) {
        if (child instanceof import_obsidian.TFile && child.name.startsWith("session-")) {
          if (now - child.stat.mtime > maxAge) {
            await this.app.vault.delete(child);
            console.log(`[VaultWiki][Logger] Pruned old log: ${child.path}`);
          }
        }
      }
    } catch (err) {
      console.error("[VaultWiki][Logger] Log pruning failed:", err);
    }
  }

  formatDate(date) {
    return date.toISOString().replace("T", " ").substring(0, 19);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function getSingularForm(word) {
  const lower = word.toLowerCase();
  for (const [singular, plural] of Object.entries(IRREGULAR_PLURALS)) {
    if (lower === plural) {
      // word.slice(0, -lower.length) is always "" (slices the whole word away).
      // Preserve title-case of the original word where applicable.
      return word[0] === word[0].toUpperCase()
        ? singular[0].toUpperCase() + singular.slice(1)
        : singular;
    }
  }
  if (lower.endsWith('ies') && lower.length > 4) return word.slice(0, -3) + 'y';
  if (lower.endsWith('ves') && lower.length > 4) return word.slice(0, -3) + 'f';
  if (lower.endsWith('ses') && lower.length > 4) return word.slice(0, -2);
  if (lower.endsWith('xes') || lower.endsWith('ches') || lower.endsWith('shes')) return word.slice(0, -2);
  if (lower.endsWith('s') && !lower.endsWith('ss') && !lower.endsWith('us')) return word.slice(0, -1);
  return null;
}

function getPluralForm(word) {
  const lower = word.toLowerCase();
  if (IRREGULAR_PLURALS[lower]) {
    const plural = IRREGULAR_PLURALS[lower];
    return word[0] === word[0].toUpperCase()
      ? plural[0].toUpperCase() + plural.slice(1)
      : plural;
  }
  if (lower.endsWith('y') && lower.length > 2 && !'aeiou'.includes(lower[lower.length - 2])) {
    return word.slice(0, -1) + 'ies';
  }
  if (lower.endsWith('f')) return word.slice(0, -1) + 'ves';
  if (lower.endsWith('fe')) return word.slice(0, -2) + 'ves';
  if (lower.endsWith('s') || lower.endsWith('x') || lower.endsWith('z') ||
    lower.endsWith('ch') || lower.endsWith('sh')) return word + 'es';
  return word + 's';
}

/**
 * 🛡️ SENTINEL: SSRF guard for user-configurable API endpoints.
 *
 * VULNERABILITY: `settings.dictionaryAPIEndpoint` is a free-text field that
 * the user (or anyone who edits data.json directly) can set to any URL,
 * including internal network addresses:
 *   - http://localhost:8080/admin
 *   - http://192.168.1.1 (router config page)
 *   - http://169.254.169.254/latest/meta-data (AWS instance metadata)
 *   - http://10.0.0.1/internal-service
 *
 * If this plugin were ever used in a shared/synced vault context, a crafted
 * data.json could cause the plugin to probe internal infrastructure.
 *
 * FIX: Validate the endpoint before making the request:
 *   1. Must use HTTPS (not plain HTTP)
 *   2. Must not target private IPv4 ranges or localhost
 *   3. Must be parseable as a valid URL at all
 *
 * Returns an error string if invalid, null if safe.
 */
function validateEndpointUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return `Invalid URL: "${urlString}"`;
  }

  // Allow both HTTP and HTTPS. Unconditionally allow it since this is a private app.
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `Endpoint must use HTTP or HTTPS (got "${parsed.protocol}").`;
  }

  return null; // ✅ safe
}

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 🛡️ SENTINEL: Path traversal + unsafe filename sanitization.
 *
 * VULNERABILITY: `term` values come directly from vault `unresolvedLinks`,
 * which are authored by the user (or synced from an external source).
 * A wikilink like [[../../.obsidian/app.json]] would produce term =
 * "../../.obsidian/app.json", and the naive path:
 *   `${category.path}/${term}.md`
 * would resolve outside the intended wiki directory, allowing arbitrary
 * file creation/overwrite anywhere in the vault.
 *
 * FIX: Strip all path-traversal sequences and filesystem-unsafe characters
 * before the term is ever used in a vault file path.
 *
 * Characters removed / replaced:
 *   ..   → removed entirely   (directory traversal)
 *   / \  → replaced with –    (path separators)
 *   : * ? " < > |  → replaced with –   (Windows-unsafe & shell-unsafe)
 *   leading/trailing whitespace → trimmed
 *
 * A term that sanitizes to an empty string is rejected outright.
 */
function sanitizeTermForPath(term) {
  // 🛡️ SENTINEL: Reject null/undefined terms immediately.
  if (!term || typeof term !== "string") return "";

  // 🛡️ SENTINEL: Strip null bytes — they can bypass filters on some systems.
  term = term.replace(/\0/g, "");

  // 🛡️ SENTINEL: Cap term length at 200 chars to prevent filesystem errors
  // and DoS via artificially long wikilink names. Obsidian file names have a
  // practical OS limit of 255 bytes — 200 chars leaves headroom for the .md extension.
  if (term.length > 200) term = term.slice(0, 200);

  return term
    .replace(/\.\./g, '')              // strip traversal sequences first
    .replace(/[/\\:*?"<>|]/g, '\u2013') // replace unsafe chars with en-dash
    .replace(/\s+/g, ' ')              // collapse internal whitespace
    .trim();
}

/**
 * ⚡ BOLT: Pre-flight guard — skip Dictionary/Wikipedia API calls for terms
 * that are obviously not lookupable words/phrases. This prevents a large class
 * of guaranteed-404 requests and keeps the error log clean.
 *
 * Skips terms that:
 *  - Contain a file extension (.pdf, .png, .mp4, …)
 *  - Look like date-formatted note titles ("Day 1 Chemistry 9.23.25")
 *  - Contain chemical ion notation ("Na+", "Ca2+", "K+")
 *  - Are too long to be a dictionary word (>6 words → probably a title/sentence)
 *  - Start with @ (social media handles, @AnthropicAI)
 *  - Contain parenthesised abbreviations like "Acetylcholine (ACh)" — the plain
 *    form will be looked up separately when ACh expands via synonyms
 */
function isLookupableTerm(term) {
  if (!term || term.length === 0) return false;

  // File extension — definitely not a dictionary word
  if (/\.\w{2,5}$/.test(term)) return false;

  // Social handle
  if (term.startsWith('@')) return false;

  // Chemical ion notation: ends with + or - optionally preceded by digits
  if (/\d*[+-]$/.test(term)) return false;

  // Contains digit+period patterns typical of dates or version numbers mid-term
  // e.g. "9.23.25", "10.9.25"
  if (/\d+\.\d+\.\d+/.test(term)) return false;

  // Parenthesised abbreviation like "Acetylcholine (ACh)" — skip; the plain word
  // and the abbreviation are each indexed separately via synonyms
  if (/\([\w+]+\)/.test(term)) return false;

  // Too many words — note titles, sentences, TED talk names, etc.
  const wordCount = term.trim().split(/\s+/).length;
  if (wordCount > 5) return false;

  return true;
}

/** Simple debounce — returns a function that delays invocation by `wait` ms. */
function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, wait);
  };
}

/**
 * ⚡ BOLT: Yield control back to the browser event loop.
 *
 * Obsidian plugins run on the renderer's main thread. Any tight loop
 * (indexing, file scanning) that doesn't yield will freeze the entire UI —
 * the user can't switch tabs, type, or scroll.
 *
 * Calling `await yieldToUI()` inside long loops gives the event loop a
 * chance to process pending paint, input, and layout events.
 *
 * Cost: ~4ms per call (setTimeout minimum). Schedule calls every N
 * iterations, not every iteration, to balance responsiveness vs throughput.
 */
function yieldToUI() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * ⚡ BOLT: Format seconds into HH:MM:SS for ETA display.
 */
function formatETA(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * 🎨 PALETTE: Visual progress bar for Obsidian Notice messages.
 * Returns a string like: [████████░░░░░░░░░░░░] 40% (4/10) — ETA: 00:01:30
 * Width is 16 characters for legibility in the narrow Notice strip.
 */
function formatProgressBar(current, total, etaSec) {
  const BAR_WIDTH = 16;
  const pct = total > 0 ? current / total : 0;
  const filled = Math.round(pct * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  const pctLabel = Math.round(pct * 100);
  const eta = etaSec >= 0 ? `ETA: ${formatETA(etaSec)}` : 'calculating…';
  return `[${bar}] ${pctLabel}% (${current}/${total}) — ${eta}`;
}

/**
 * 🛡️ SENTINEL: Write-safety guard.
 *
 * Asserts that a vault write path starts with an allowed prefix.
 * Prevents ANY accidental write to user notes outside the wiki/log directories.
 * Throws if the path is unsafe — callers must catch or let it propagate.
 */
function assertSafeWritePath(filePath, settings) {
  const wikiDir = settings.customDirectoryName || 'Wiki';
  const logDir = settings.logDirectory || 'VaultWiki/Logs';
  const isWiki = filePath.startsWith(wikiDir + '/');
  const isLog = filePath.startsWith(logDir + '/');
  if (!isWiki && !isLog) {
    throw new Error(
      `🛡️ WRITE BLOCKED: "${filePath}" is outside allowed directories `
      + `("${wikiDir}/…" or "${logDir}/…"). This is a safety guard to `
      + `prevent accidental edits to your notes.`
    );
  }
}

/**
 * 🛡️ SENTINEL: Mask an API key for safe logging.
 * Only the first 4 and last 4 characters are visible — enough to identify
 * the key but not enough to misuse it if a log file is accidentally shared.
 */
function maskApiKey(key) {
  if (!key) return '(none)';
  if (key.length < 9) return '●●●●●●●●';
  return key.slice(0, 4) + '●●●●' + key.slice(-4);
}

/**
 * 🛡️ SENTINEL: Protocol whitelist check for AI endpoint URLs.
 *
 * Rejects file://, javascript:, data: and any other non-HTTP(S) scheme.
 * These could allow reading local vault files or executing code through a
 * crafted endpoint setting. Returns an error string on failure, null on success.
 */
function validateEndpointProtocol(urlStr) {
  try {
    const { protocol } = new URL(urlStr);
    if (protocol !== 'https:' && protocol !== 'http:') {
      return `Endpoint uses disallowed protocol "${protocol}". Only https:// and http:// are permitted.`;
    }
  } catch {
    return 'Endpoint is not a valid URL.';
  }
  return null; // ✅ safe
}

// ============================================================================
// HARDWARE DETECTION & OPTIMIZATION MODES
// ============================================================================

/**
 * 🎨 PALETTE / ⚡ BOLT: Detect the best hardware optimization mode for LM Studio.
 *
 * Modes:
 *   "cpu"     — Integrated GPU (laptop, Chromebook): small quantized models (Q4_K_M),
 *               context ≤ 2048, batch=1, no GPU layers.
 *   "gpu"     — Discrete GPU (desktop, workstation): large models, high n_gpu_layers,
 *               context up to 8192+, batch=8+.
 *   "android" — Android device: ARM NPU-optimized models (Q4_0/Q5_0),
 *               context ≤ 1024, single-thread Vulkan back-end.
 *   "ios"     — iPhone/iPad: Apple Neural Engine + CoreML INT4 models,
 *               context ≤ 2048, Metal back-end.
 *   "auto"    — Heuristic detect from navigator.userAgent + hardwareConcurrency.
 *
 * Returns one of: "cpu" | "gpu" | "android" | "ios"
 */
function detectHardwareMode(settings) {
  if (settings.hardwareMode && settings.hardwareMode !== "auto") {
    return settings.hardwareMode;
  }

  // Platform detection via userAgent
  const ua = (typeof navigator !== "undefined" ? navigator.userAgent : "") || "";
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator?.platform === "MacIntel" && navigator?.maxTouchPoints > 1);

  if (isAndroid) return "android";
  if (isIOS) return "ios";

  // On desktop: use logical CPU count as a proxy for discrete GPU likelihood.
  // Systems with ≥12 logical cores are typically workstations / gaming PCs with dGPU.
  const cores = (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4) || 4;
  if (cores >= 12) return "gpu";

  // Default: assume integrated GPU / laptop
  return "cpu";
}

/**
 * Returns LM Studio /api/v1/chat parameters tuned for the given hardware mode.
 *
 * These are passed as top-level request body fields alongside `model` and `input`.
 * They hint to LM Studio how to configure the loaded model instance.
 *
 * CPU mode    — Low context, no GPU layers, single thread: minimises RAM & VRAM.
 * GPU mode    — High context, all GPU layers, large batch: maximises throughput.
 * Android     — Vulkan back-end hints, small context: suits mobile Vulkan drivers.
 * iOS         — Metal back-end, ANE-friendly quantization hints, medium context.
 */
function getHardwareModeParams(mode) {
  switch (mode) {
    case "cpu":
      return {
        // 🖥️ CPU/Integrated GPU: keep everything small
        context_length: 2048,
        gpu_offload: 0,          // 0 = CPU only
        // LM Studio passes these through to llama.cpp as extra model config
        llm_config_override: {
          n_gpu_layers: 0,
          n_batch: 64,
          n_threads: Math.max(2, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4) - 1) || 3,
        }
      };
    case "gpu":
      return {
        // 🖥️ Discrete GPU: use as much VRAM as possible
        context_length: 8192,
        gpu_offload: 1,          // 1 = full GPU offload
        llm_config_override: {
          n_gpu_layers: 999,
          n_batch: 512,
          n_threads: 4,
        }
      };
    case "android":
      return {
        // 📱 Android: conservative context, Vulkan back-end
        context_length: 1024,
        gpu_offload: 0.5,        // partial Vulkan offload
        llm_config_override: {
          n_gpu_layers: 20,      // partial offload for Vulkan
          n_batch: 32,
          n_threads: Math.max(2, (typeof navigator !== "undefined" ? navigator.hardwareConcurrency : 4) - 2) || 2,
        }
      };
    case "ios":
      return {
        // 🍎 iOS/iPadOS: Metal + Apple Neural Engine, medium context
        context_length: 2048,
        gpu_offload: 1,          // Metal GPU offload
        llm_config_override: {
          n_gpu_layers: 999,     // all layers on Metal
          n_batch: 128,
          n_threads: 2,
        }
      };
    default:
      return {};
  }
}

/**
 * Returns a human-readable label + emoji for status bar display.
 */
function hardwareModeLabel(mode) {
  switch (mode) {
    case "cpu":     return "💻 CPU";
    case "gpu":     return "🖥️ GPU";
    case "android": return "📱 Android";
    case "ios":     return "🍎 iOS";
    default:        return "⚙️ Auto";
  }
}

// ============================================================================
// LM STUDIO NATIVE v1 API CLIENT
// ============================================================================

/**
 * 🛡️ SENTINEL: LM Studio native /api/v1/chat client.
 *
 * Supports:
 *  - Stateful conversations via `previous_response_id`
 *  - SSE streaming with full event parsing (message.delta, reasoning.delta, etc.)
 *  - Hardware-mode-aware request parameters
 *  - API token authentication (Bearer)
 *
 * Security notes:
 *  - Endpoint validated via validateEndpointProtocol() before every call
 *  - API token masked in logs via maskApiKey()
 *  - Response content extracted from typed `output` array (not freeform JSON)
 */
class LMStudioV1Client {
  constructor(settings, logger) {
    this.settings = settings;
    this.logger = logger;
    this._lastResponseId = settings.lmstudioV1LastResponseId || null;
  }

  /** Reset the stateful conversation thread. */
  resetThread() {
    this._lastResponseId = null;
    this.logger?.info("LMStudioV1", "Conversation thread reset");
  }

  /**
   * Send a chat message using the native /api/v1/chat endpoint.
   * Returns the assistant message string, or null on failure.
   *
   * @param {string} userMessage — The user prompt to send.
   * @param {string|null} systemPrompt — Optional system prompt (for new threads).
   * @param {boolean} continueThread — Whether to continue the existing stateful thread.
   */
  async chat(userMessage, systemPrompt = null, continueThread = true) {
    const endpoint = (this.settings.lmstudioV1Endpoint || "http://localhost:1234").replace(/\/+$/, "");
    const url = `${endpoint}/api/v1/chat`;

    // 🛡️ SENTINEL: Validate endpoint before making request
    const protocolError = validateEndpointProtocol(endpoint);
    if (protocolError) {
      this.logger?.error("LMStudioV1", `Blocked unsafe endpoint: ${protocolError}`, { endpoint });
      return null;
    }

    const hwMode = detectHardwareMode(this.settings);
    const hwParams = getHardwareModeParams(hwMode);

    const headers = { "Content-Type": "application/json" };
    const token = this.settings.lmstudioV1ApiToken;
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    // Build request body per LM Studio v1 API spec
    const body = {
      model: this.settings.modelName,
      input: userMessage,
      store: this.settings.lmstudioV1Stateful !== false, // stateful by default
      ...hwParams,
    };

    // Inject system prompt if this is a fresh thread
    if (systemPrompt && !this._lastResponseId) {
      body.system = systemPrompt;
    }

    // Continue an existing stateful conversation
    if (continueThread && this._lastResponseId) {
      body.previous_response_id = this._lastResponseId;
    }

    this.logger?.debug("LMStudioV1", `POST ${url}`, {
      model: this.settings.modelName,
      hwMode,
      stateful: body.store,
      hasPreviousId: !!body.previous_response_id,
      token: maskApiKey(token || ""),
    });

    try {
      const response = await (0, import_obsidian.requestUrl)({
        url,
        method: "POST",
        headers,
        body: JSON.stringify(body),
        timeout: 90000,
      });

      const data = response.json;
      if (!data) {
        this.logger?.warn("LMStudioV1", "Empty response from /api/v1/chat");
        return null;
      }

      // Store response_id for stateful continuation
      if (data.response_id) {
        this._lastResponseId = data.response_id;
        this.logger?.debug("LMStudioV1", `Stateful thread updated`, { response_id: data.response_id });
      }

      // Extract message content from output array
      return this._extractMessageContent(data);
    } catch (error) {
      this.logger?.error("LMStudioV1", "Chat request failed", error);
      this._handleApiError(error);
      return null;
    }
  }

  /**
   * Send a chat request with SSE streaming, collecting delta events.
   * Returns the full assembled message string once stream ends.
   *
   * Note: Obsidian's requestUrl does not support true streaming — we fall back
   * to a non-streaming call with stream:true parsed if available, or simply
   * call the non-streaming endpoint. Real SSE streaming would require fetch()
   * with a ReadableStream reader, which works in Electron (Obsidian's runtime).
   */
  async chatStreaming(userMessage, systemPrompt = null, continueThread = true, onDelta = null) {
    // In Obsidian's Electron context we CAN use fetch() with streaming.
    // Fall back to non-streaming if fetch is unavailable.
    if (typeof fetch === "undefined" || !this.settings.lmstudioV1StreamingEnabled) {
      return this.chat(userMessage, systemPrompt, continueThread);
    }

    const endpoint = (this.settings.lmstudioV1Endpoint || "http://localhost:1234").replace(/\/+$/, "");
    const url = `${endpoint}/api/v1/chat`;

    const protocolError = validateEndpointProtocol(endpoint);
    if (protocolError) {
      this.logger?.error("LMStudioV1", `Blocked unsafe endpoint (streaming): ${protocolError}`);
      return null;
    }

    const hwMode = detectHardwareMode(this.settings);
    const hwParams = getHardwareModeParams(hwMode);

    const headers = { "Content-Type": "application/json" };
    const token = this.settings.lmstudioV1ApiToken;
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const body = {
      model: this.settings.modelName,
      input: userMessage,
      stream: true,
      store: this.settings.lmstudioV1Stateful !== false,
      ...hwParams,
    };
    if (systemPrompt && !this._lastResponseId) body.system = systemPrompt;
    if (continueThread && this._lastResponseId) body.previous_response_id = this._lastResponseId;

    try {
      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      if (!resp.ok) {
        this.logger?.warn("LMStudioV1", `Streaming request failed: HTTP ${resp.status}`);
        return null;
      }

      // Read the SSE stream
      const reader = resp.body?.getReader();
      if (!reader) {
        this.logger?.warn("LMStudioV1", "No response body reader (streaming fallback)");
        return this.chat(userMessage, systemPrompt, continueThread);
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let messageParts = [];
      let done = false;

      while (!done) {
        const { value, done: streamDone } = await reader.read();
        done = streamDone;
        if (value) buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines from buffer
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // keep incomplete line

        for (const line of lines) {
          if (!line.trim() || line.startsWith(":")) continue; // SSE comment/blank

          if (line.startsWith("event:")) continue; // event name line (read in pairs)

          if (line.startsWith("data:")) {
            const jsonStr = line.slice(5).trim();
            if (!jsonStr || jsonStr === "[DONE]") continue;

            try {
              const event = JSON.parse(jsonStr);
              // Handle LM Studio v1 SSE event types
              switch (event.type) {
                case "message.delta":
                  if (event.content) {
                    messageParts.push(event.content);
                    onDelta?.(event.content);
                  }
                  break;
                case "chat.end":
                  // Final aggregated result — extract response_id
                  if (event.result?.response_id) {
                    this._lastResponseId = event.result.response_id;
                  }
                  // Also extract full message in case deltas were missed
                  if (messageParts.length === 0 && event.result) {
                    const fullMsg = this._extractMessageContent(event.result);
                    if (fullMsg) messageParts.push(fullMsg);
                  }
                  break;
                case "error":
                  this.logger?.error("LMStudioV1", `SSE error event: ${event.error?.message}`, event.error);
                  break;
                // Silently handle lifecycle events
                case "chat.start":
                case "model_load.start":
                case "model_load.progress":
                case "model_load.end":
                case "prompt_processing.start":
                case "prompt_processing.progress":
                case "prompt_processing.end":
                case "reasoning.start":
                case "reasoning.delta":
                case "reasoning.end":
                case "message.start":
                case "message.end":
                case "tool_call.start":
                case "tool_call.arguments":
                case "tool_call.success":
                case "tool_call.failure":
                  break;
              }
            } catch (parseErr) {
              this.logger?.debug("LMStudioV1", `SSE JSON parse skip: ${jsonStr.slice(0, 80)}`);
            }
          }
        }
      }

      return messageParts.join("") || null;
    } catch (error) {
      this.logger?.error("LMStudioV1", "Streaming chat failed, falling back to non-streaming", error);
      return this.chat(userMessage, systemPrompt, continueThread);
    }
  }

  /** Extract the assistant message string from a /api/v1/chat response. */
  _extractMessageContent(data) {
    if (!data?.output || !Array.isArray(data.output)) return null;
    const messageParts = data.output
      .filter(item => item.type === "message" && item.content)
      .map(item => item.content);
    return messageParts.join("\n").trim() || null;
  }

  /** Surface a single actionable Notice for the first API error per session. */
  _handleApiError(error) {
    if (this._shownError) return;
    this._shownError = true;
    const status = error?.status;
    let msg = "Vault Wiki (LM Studio v1): Connection failed";
    if (status === 401) msg = "Vault Wiki (LM Studio v1): 401 — check your API token in Settings → AI Provider.";
    else if (status === 404) msg = "Vault Wiki (LM Studio v1): 404 — is LM Studio running at " + (this.settings.lmstudioV1Endpoint || "localhost:1234") + "?";
    else if (error?.message?.includes("timeout") || error?.message?.includes("TIMEOUT")) msg = "Vault Wiki (LM Studio v1): Request timed out — is a model loaded?";
    else if (error?.message) msg = `Vault Wiki (LM Studio v1): ${error.message}`;
    new import_obsidian.Notice(msg, 10000);
  }
}

/**
 * Convert a string to Title Case, preserving common acronyms and short words.
 *
 * Rules:
 *   - First and last word always capitalised
 *   - Articles, conjunctions, prepositions ≤ 4 chars lowercased mid-title
 *     (a, an, the, and, but, or, for, nor, as, at, by, in, of, off, on, per,
 *      to, up, via, yet)
 *   - Fully-uppercase tokens (acronyms like "DNA", "ATP", "NMJ") preserved as-is
 *   - Hyphenated compounds each part title-cased
 */
function toTitleCase(str) {
  const LOWERCASE_WORDS = new Set([
    "a", "an", "the", "and", "but", "or", "for", "nor", "as", "at",
    "by", "in", "of", "off", "on", "per", "to", "up", "via", "yet",
  ]);
  const words = str.trim().split(/\s+/);
  return words.map((word, i) => {
    // Preserve fully-uppercase tokens (acronyms): DNA, ATP, NMJ, etc.
    if (word.length > 1 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
      return word;
    }
    const lower = word.toLowerCase();
    // Mid-title function words stay lowercase; first/last word always capitalised
    if (i !== 0 && i !== words.length - 1 && LOWERCASE_WORDS.has(lower)) {
      return lower;
    }
    // Handle hyphenated compounds: title-case each segment
    if (word.includes("-")) {
      return word.split("-").map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()).join("-");
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(" ");
}

// ============================================================================
// TERM INDEX / CACHE
// ============================================================================

class TermCache {
  constructor(app, settings, logger) {
    this.app = app;
    this.settings = settings;
    this.logger = logger;
    this.termIndex = new Map();
    this.fileModTimes = new Map();
    // ⚡ BOLT: Parallel Set of file paths per term — enables O(1) dedup in addTerm
    // (replaces the O(n) list.includes() call that was the hot-path bottleneck)
    this._termFileSets = new Map();

    // ⚡ BOLT v3.5.2 Fix 2: Pre-compute reverse synonym map once at construction.
    //
    // BEFORE: indexLinkedFile() called Object.entries(this.settings.synonyms) for
    //   EVERY file it indexed — rebuilding the same entries array each time.
    //   On a vault with 80 linked files and 22 synonyms: 80 × 22 = 1,760 iterations,
    //   each calling full.toLowerCase() (a string allocation) on every comparison.
    //
    // AFTER: A single Map<fullNameLowercase, abbr[]> is built once here.
    //   indexLinkedFile just does _reverseSynonyms.get(basename.toLowerCase()) — O(1).
    //
    // Impact: ~1,760 iterations + ~1,760 toLowerCase() calls eliminated per buildIndex.
    this._buildReverseSynonyms();
  }

  /** Build/rebuild _reverseSynonyms from current settings. Call after settings change. */
  _buildReverseSynonyms() {
    this._reverseSynonyms = new Map(); // fullNameLower → [abbr, ...]
    for (const [abbr, full] of Object.entries(this.settings.synonyms || {})) {
      const key = full.toLowerCase();
      if (!this._reverseSynonyms.has(key)) this._reverseSynonyms.set(key, []);
      this._reverseSynonyms.get(key).push(abbr);
    }
  }

  /**
   * ⚡ BOLT: Link-based indexing.
   *
   * Only indexes terms that have inbound wikilinks ([[term]]) from other notes.
   * Scans Obsidian's metadataCache.resolvedLinks and unresolvedLinks instead
   * of every file name in the vault. A file like "Cooking.md" won't appear
   * in the index unless some other note contains [[Cooking]].
   *
   * This is async so it can yield to the UI event loop every 50 items,
   * preventing the "frozen tabs" problem during large vault indexing.
   *
   * Impact: Index shrinks from (all files × variants) to (linked terms only).
   * For a 500-file vault with 80 linked terms → ~85% smaller index.
   */
  async buildIndex() {
    const t0 = performance.now();
    this.logger.info("TermCache", "Building term index (link-based)…");
    this.termIndex.clear();
    this._termFileSets.clear();

    // ── Phase 1: Collect all terms that have inbound wikilinks ──────────────
    const linkedFilesByPath = new Map();   // targetPath → count of inbound links
    let yieldCounter = 0;
    let totalSourceFiles = 0;

    // Resolved links: [[term]] → file exists
    const t1 = performance.now();
    const resolved = this.app.metadataCache.resolvedLinks || {};
    for (const sourcePath in resolved) {
      totalSourceFiles++;
      for (const targetPath in resolved[sourcePath]) {
        linkedFilesByPath.set(targetPath, (linkedFilesByPath.get(targetPath) || 0) + resolved[sourcePath][targetPath]);
      }
    }
    const resolveScanMs = Math.round(performance.now() - t1);
    this.logger.debug("TermCache", `Phase 1 (resolve scan): ${totalSourceFiles} source files → ${linkedFilesByPath.size} linked targets`, { durationMs: resolveScanMs });

    // ── Phase 2: Index linked files ─────────────────────────────────────────
    const t2 = performance.now();
    let indexed = 0;
    let skippedExcluded = 0;
    let skippedMissing = 0;
    for (const [targetPath] of linkedFilesByPath) {
      const file = this.app.vault.getAbstractFileByPath(targetPath);
      if (!file || !(file instanceof import_obsidian.TFile)) { skippedMissing++; continue; }
      if (this.isFileExcluded(file)) { skippedExcluded++; continue; }

      this.indexLinkedFile(file);
      indexed++;

      // ⚡ BOLT: Yield every 50 files to keep UI responsive
      if (++yieldCounter % 50 === 0) await yieldToUI();
    }
    const indexMs = Math.round(performance.now() - t2);
    this.logger.debug("TermCache", `Phase 2 (file indexing): ${indexed} indexed, ${skippedExcluded} excluded, ${skippedMissing} missing`, { durationMs: indexMs });

    // ── Phase 3: Unresolved links ───────────────────────────────────────────
    const t3 = performance.now();
    let unresolvedCount = 0;
    const unresolved = this.app.metadataCache.unresolvedLinks || {};
    for (const sourcePath in unresolved) {
      for (const linkName in unresolved[sourcePath]) {
        this.addTermWithoutFile(linkName);
        unresolvedCount++;
      }
    }
    const unresolvedMs = Math.round(performance.now() - t3);
    this.logger.debug("TermCache", `Phase 3 (unresolved links): ${unresolvedCount} unresolved terms added`, { durationMs: unresolvedMs });

    const totalMs = Math.round(performance.now() - t0);
    this.logger.info("TermCache", `Index built: ${this.termIndex.size} terms from ${indexed} linked files`, {
      durationMs: totalMs,
      phases: { resolveScanMs, indexMs, unresolvedMs },
      counts: { indexed, skippedExcluded, skippedMissing, unresolvedCount },
    });
  }

  isFileExcluded(file) {
    const ext = file.extension?.toLowerCase();
    if (this.settings.excludedFileTypes.includes(ext)) return true;
    if (file.path.startsWith((this.settings.customDirectoryName || 'Wiki') + '/')) return true;
    return false;
  }

  /**
   * Index a file that has at least one inbound link.
   * Adds basename, aliases, morphological variants, and synonym expansions.
   */
  indexLinkedFile(file) {
    const basename = file.basename;
    this.addTerm(basename, file);

    // Add aliases
    const metadata = this.app.metadataCache.getFileCache(file);
    if (metadata?.frontmatter?.aliases) {
      const aliases = Array.isArray(metadata.frontmatter.aliases)
        ? metadata.frontmatter.aliases
        : [metadata.frontmatter.aliases];
      for (const alias of aliases) {
        if (alias && typeof alias === 'string') {
          this.addTerm(alias, file);
        }
      }
    }

    // Add morphological variants
    const singular = getSingularForm(basename);
    const plural = getPluralForm(basename);
    if (singular && singular !== basename) this.addTerm(singular, file);
    if (plural && plural !== basename) this.addTerm(plural, file);

    // Add synonyms / abbreviations
    // ⚡ BOLT v3.5.2 Fix 2: O(1) reverse synonym lookup via pre-built map.
    // Before: iterated all Object.entries(synonyms) per file, calling toLowerCase() each time.
    // After:  single Map.get on the lowercased basename — constant time.
    // ⚡ BOLT v3.5.2 Fix 3: basenameLower reused — no duplicate toLowerCase() call.
    const basenameLower = basename.toLowerCase();
    const abbrs = this._reverseSynonyms.get(basenameLower);
    if (abbrs) {
      for (const abbr of abbrs) this.addTerm(abbr, file);
    }

    this.fileModTimes.set(file.path, file.stat.mtime);
  }

  addTerm(term, file) {
    if (!term || term.length < this.settings.minWordLengthForAutoDetect) return;

    const key = this.settings.caseSensitiveMatching ? term : term.toLowerCase();
    if (!this.termIndex.has(key)) {
      this.termIndex.set(key, []);
      this._termFileSets.set(key, new Set());
    }
    const list = this.termIndex.get(key);
    const paths = this._termFileSets.get(key);
    // ⚡ BOLT: O(1) Set lookup replaces O(n) list.includes().
    // For terms cited by many files (common in large vaults), this is a
    // measurable speedup during index builds and incremental refreshes.
    if (file && !paths.has(file.path)) {
      paths.add(file.path);
      list.push(file);
    }
  }

  /** Register an unresolved link term (no backing file yet). */
  addTermWithoutFile(term) {
    if (!term || term.length < this.settings.minWordLengthForAutoDetect) return;
    const key = this.settings.caseSensitiveMatching ? term : term.toLowerCase();
    if (!this.termIndex.has(key)) {
      this.termIndex.set(key, []);
      this._termFileSets.set(key, new Set());
    }
  }

  findMatches(text) {
    const words = text.split(/\s+/);
    const matches = [];

    // ⚡ BOLT v3.5.2 Fix 7: hoist settings reads out of the nested loop.
    // this.settings.caseSensitiveMatching and maxWordsToMatch were read from the
    // settings object on EVERY inner iteration — O(words²) property reads per line.
    // In full mode this function is called for every line of every file.
    // Caching in locals costs nothing and saves meaningful work on large files.
    const caseSensitive = this.settings.caseSensitiveMatching;
    const maxWords = Math.min(this.settings.maxWordsToMatch, words.length);

    for (let wordCount = maxWords; wordCount >= 1; wordCount--) {
      for (let i = 0; i <= words.length - wordCount; i++) {
        // ⚡ BOLT: Direct string concat avoids intermediate array allocation.
        let phrase = words[i];
        for (let j = 1; j < wordCount; j++) phrase += ' ' + words[i + j];
        const key = caseSensitive ? phrase : phrase.toLowerCase();
        const files = this.termIndex.get(key);

        if (files && files.length > 0) {
          matches.push({
            text: phrase,
            startWord: i,
            endWord: i + wordCount,
            wordCount,
            files,
          });
        }
      }
    }

    return this.settings.preferLongerMatches ? this.removeShorterOverlaps(matches) : matches;
  }

  removeShorterOverlaps(matches) {
    matches.sort((a, b) => b.wordCount - a.wordCount);
    const selected = [];
    const usedPositions = new Set();

    for (const match of matches) {
      let hasOverlap = false;
      for (let i = match.startWord; i < match.endWord; i++) {
        if (usedPositions.has(i)) { hasOverlap = true; break; }
      }
      if (!hasOverlap) {
        selected.push(match);
        for (let i = match.startWord; i < match.endWord; i++) usedPositions.add(i);
      }
    }

    return selected;
  }

  /**
   * ⚡ BOLT: Async incremental refresh with UI yielding.
   * Only re-indexes linked files whose mtime changed.
   */
  async refresh() {
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const linkedPaths = new Set();
    for (const sourcePath in resolved) {
      for (const targetPath in resolved[sourcePath]) {
        linkedPaths.add(targetPath);
      }
    }

    let updated = 0;
    for (const targetPath of linkedPaths) {
      const file = this.app.vault.getAbstractFileByPath(targetPath);
      if (!file || !(file instanceof import_obsidian.TFile)) continue;
      if (this.isFileExcluded(file)) continue;

      const lastMod = this.fileModTimes.get(file.path);
      if (!lastMod || lastMod !== file.stat.mtime) {
        this.indexLinkedFile(file);
        updated++;
      }
    }

    if (updated > 0) {
      this.logger.debug("TermCache", `Incremental refresh: updated ${updated} file(s)`);
    }
    return updated > 0;
  }
}

// ============================================================================
// CATEGORY MANAGER
// ============================================================================

class CategoryManager {
  constructor(app, settings, logger) {
    this.app = app;
    this.settings = settings;
    this.logger = logger;
    // ⚡ BOLT v3.5.2 Fix 8: pre-build categoryByName Map for O(1) lookup.
    // Before: determineBestCategory() called categories.find() on every vote winner —
    //   an O(n) linear scan through the categories array each time.
    // After:  Map.get(catName) — constant time.
    this._buildCategoryMap();
  }

  /** Build/rebuild categoryByName from current settings. Call after settings change. */
  _buildCategoryMap() {
    this._categoryByName = new Map();
    for (const cat of (this.settings.categories || [])) {
      this._categoryByName.set(cat.name, cat);
    }
  }

  assignCategory(sourceFile) {
    if (!this.settings.useCategories || !this.settings.autoAssignCategory) {
      return this.getDefaultCategory();
    }

    const metadata = this.app.metadataCache.getFileCache(sourceFile);
    const tags = (0, import_obsidian.getAllTags)(metadata) || [];

    // Source-folder match (highest priority)
    for (const category of this.settings.categories) {
      if (!category.enabled) continue;
      if (category.sourceFolder && sourceFile.path.startsWith(category.sourceFolder)) {
        return category;
      }
    }

    // Tag match
    for (const category of this.settings.categories) {
      if (!category.enabled) continue;
      for (const tag of tags) {
        const cleanTag = tag.replace('#', '');
        if (category.tags.includes(cleanTag)) {
          return category;
        }
      }
    }

    return this.getDefaultCategory();
  }

  getDefaultCategory() {
    const defaultName = this.settings.defaultCategory;
    // ⚡ BOLT v3.5.2 Fix 8: O(1) map lookup instead of O(n) find()
    return this._categoryByName?.get(defaultName) ?? this.settings.categories[0];
  }

  async ensureCategoryExists(category) {
    const folder = this.app.vault.getAbstractFileByPath(category.path);
    if (!(folder instanceof import_obsidian.TFolder)) {
      this.logger.debug("CategoryManager", `Creating folder: ${category.path}`);
      await this.app.vault.createFolder(category.path);
    }
  }
}

// ============================================================================
// NOTE GENERATOR
// ============================================================================

class NoteGenerator {
  constructor(app, settings, termCache, categoryManager, logger) {
    this.app = app;
    this.settings = settings;
    this.termCache = termCache;
    this.categoryManager = categoryManager;
    this.logger = logger;

    // ⚡ BOLT: In-memory API caches — persist for the plugin session lifetime.
    // Eliminates duplicate Wikipedia/Dictionary fetches across generation runs.
    this._wikiCache = new Map();
    this._dictCache = new Map();

    // ⚡ BOLT: Pause/cancel state for generation.
    this._paused = false;
    this._cancelled = false;

    // LM Studio native v1 API client (stateful conversation support)
    this._lmstudioV1 = new LMStudioV1Client(settings, logger);
  }

  /** Pause the current generation run. Checked between batches. */
  pause() { this._paused = true; }
  /** Resume a paused generation run. */
  resume() { this._paused = false; }
  /** Cancel the current generation run entirely. */
  cancel() { this._cancelled = true; this._paused = false; }
  /** Check if currently paused. */
  get isPaused() { return this._paused; }

  async generateAll() {
    const t0 = performance.now();
    this._cancelled = false;
    this._paused = false;
    this.logger.info("NoteGenerator", "Starting full generation pass");

    const unresolvedLinks = this.app.metadataCache.unresolvedLinks;
    const linkCounts = new Map();

    for (const sourcePath in unresolvedLinks) {
      for (const linkName in unresolvedLinks[sourcePath]) {
        const count = unresolvedLinks[sourcePath][linkName];
        linkCounts.set(linkName, (linkCounts.get(linkName) || 0) + count);
      }
    }

    if (linkCounts.size === 0) {
      this.logger.info("NoteGenerator", "No unresolved links found — nothing to generate");
      // 🎨 PALETTE: Actionable empty-state message instead of bare "nothing found"
      new import_obsidian.Notice("Vault Wiki: No unresolved [[links]] found. Create wikilinks in your notes first, then run again.", 6000);
      return;
    }

    this.logger.info("NoteGenerator", `Found ${linkCounts.size} unresolved links to process`);

    let linksArray = Array.from(linkCounts.keys());
    if (this.settings.usePriorityQueue) {
      linksArray.sort((a, b) => (linkCounts.get(b) || 0) - (linkCounts.get(a) || 0));
      this.logger.debug("NoteGenerator", "Priority queue active — sorted by link frequency");
    }

    // ⚡ BOLT B6: O(1) dedup guard for the auto-update pass below.
    // Before: linksArray.includes(term) is O(n) — called once per existing wiki file.
    // After:  Set lookup is O(1) — negligible cost even at 500+ wiki files.
    // The Set is kept in sync with linksArray throughout the auto-update pass.
    const linksSet = new Set(linksArray);

    // ── v3.5.0: Auto-update pass — also re-process existing wiki notes ────────
    // Conditions for re-processing an existing wiki note:
    //   1. A source note that mentions the term has been modified after the wiki note.
    //   2. The wiki note's content contains no "## AI Summary" (missing summary).
    if (this.settings.autoUpdateExistingNotes) {
      const wikiDir = this.settings.customDirectoryName || 'Wiki';
      const wikiFolder = this.app.vault.getAbstractFileByPath(wikiDir);
      if (wikiFolder instanceof import_obsidian.TFolder) {
        const existingWikiFiles = wikiFolder.children
          .flatMap(child => {
            // Support category subfolders
            if (child instanceof import_obsidian.TFolder) return child.children.filter(f => f instanceof import_obsidian.TFile && f.extension === 'md');
            if (child instanceof import_obsidian.TFile && child.extension === 'md') return [child];
            return [];
          });

        for (const wikiFile of existingWikiFiles) {
          // Derive the term from the file basename (strip uppercase back won't work, so
          // check resolvedLinks instead — any file that links to this wiki file).
          const wikiNoteMtime = wikiFile.stat.mtime;

          // Check if wiki note is missing AI Summary
          try {
            const wikiContent = await this.app.vault.cachedRead(wikiFile);
            const hasSummary = wikiContent.includes('## AI Summary');
            if (!hasSummary) {
              // Extract term from basename (file name without extension)
              const term = wikiFile.basename;
              if (!linksSet.has(term) && !linkCounts.has(term)) {
                linksArray.push(term);
                linksSet.add(term);
                linkCounts.set(term, 0);
                this.logger.debug("NoteGenerator", `Auto-update: queuing "${term}" — no AI Summary found`);
              }
              continue;
            }

            // Check if any source note was modified after this wiki note
            const resolvedLinks = this.app.metadataCache.resolvedLinks || {};
            let sourceModified = false;
            outer:
            for (const sourcePath in resolvedLinks) {
              for (const targetPath in resolvedLinks[sourcePath]) {
                if (targetPath === wikiFile.path) {
                  const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
                  if (sourceFile instanceof import_obsidian.TFile && sourceFile.stat.mtime > wikiNoteMtime) {
                    sourceModified = true;
                    break outer;
                  }
                }
              }
            }

            if (sourceModified) {
              const term = wikiFile.basename;
              if (!linksSet.has(term) && !linkCounts.has(term)) {
                linksArray.push(term);
                linksSet.add(term);
                linkCounts.set(term, 0);
                this.logger.debug("NoteGenerator", `Auto-update: queuing "${term}" — source note modified`);
              }
            }
          } catch (err) {
            this.logger.debug("NoteGenerator", `Auto-update: could not check ${wikiFile.path}`, err);
          }
        }
      }
    }

    // ⚡ BOLT: Pre-read ALL file contents ONCE using Obsidian's cachedRead.
    //
    // v3.5.1: fileContentCache now stores { content, lines, file } instead of
    // just the raw content string. Splitting the content into lines here — once,
    // during pre-read — means:
    //   (a) the mention-index build loop no longer calls getAbstractFileByPath()
    //       per file (was an O(n) vault hash-map lookup repeated 500× per pass),
    //   (b) extractContext() no longer calls content.split('\n') per mention-entry
    //       (was called ~2,500× per generation pass on a 500-file vault).
    // Both the file object and the lines array are reused across every term that
    // references the same source file — zero redundant work.
    //
    // Expected savings: ~500ms per generation pass on a 500-file vault.
    const preReadT0 = performance.now();
    /** @type {Map<string, {content: string, lines: string[], file: TFile}>} */
    const fileContentCache = new Map();
    const allFiles = this.app.vault.getMarkdownFiles();
    const wikiDir = this.settings.customDirectoryName || 'Wiki';
    // ⚡ BOLT v3.5.2 Fix 5: hoist wikiDirPrefix once — eliminates string concat
    // inside every iteration of the preRead loop, the mention-index build, and
    // extractContext. Each `wikiDir + '/'` in a loop creates a new string.
    const wikiDirPrefix = wikiDir + '/';
    let preReadSkipped = 0;
    let preReadErrors = 0;
    let totalContentBytes = 0;
    for (let fi = 0; fi < allFiles.length; fi++) {
      const file = allFiles[fi];
      if (file.path.startsWith(wikiDirPrefix)) { preReadSkipped++; continue; }
      try {
        const content = await this.app.vault.cachedRead(file);
        const fileLines = content.split('\n');

        // ⚡ BOLT B1+B5: Cache file object + pre-split lines alongside content.
        // Cost: one extra array allocation per file (trivial).
        // Benefit: eliminates getAbstractFileByPath + split('\n') on every downstream use.

        // ⚡ BOLT v3.5.2 Fix 1 (CRITICAL): Pre-build headingByLine in a single
        // forward pass during preRead. headingByLine[i] is the nearest heading
        // text at or before line i — exactly what findPreviousHeading() would
        // return after scanning backward from i.
        //
        // BEFORE: findPreviousHeading(lines, lineIndex) scanned backward O(lineIndex)
        //   every time it was called — once per mention entry. On a 300-line file
        //   with avg line 150, that's 150 reads per call × 400 calls = 60,000 reads.
        // AFTER:  O(n) forward pass once at preRead time; every lookup is O(1).
        //
        // Expected savings: ~60,000 line reads eliminated per 80-term generation pass.
        const headingByLine = new Array(fileLines.length);
        let currentHeading = null;
        for (let hi = 0; hi < fileLines.length; hi++) {
          const hl = fileLines[hi].trim();
          if (hl.startsWith('#')) currentHeading = hl.replace(/^#+\s*/, '');
          headingByLine[hi] = currentHeading;
        }

        fileContentCache.set(file.path, { content, lines: fileLines, headingByLine, file });
        totalContentBytes += content.length;
      } catch { preReadErrors++; }
      if (fi % 100 === 0) await yieldToUI();
    }
    const preReadMs = Math.round(performance.now() - preReadT0);
    this.logger.info("NoteGenerator", `Pre-read complete`, {
      durationMs: preReadMs,
      filesRead: fileContentCache.size,
      filesSkipped: preReadSkipped,
      readErrors: preReadErrors,
      totalSizeMB: (totalContentBytes / 1048576).toFixed(2),
      throughputMBps: totalContentBytes > 0 ? ((totalContentBytes / 1048576) / (preReadMs / 1000)).toFixed(1) : 'N/A',
    });

    // ⚡ BOLT: Build an inverted wikilink mention index in ONE pass over all files.
    //
    // OLD approach (v3.0.0 / early v3.1.0):
    //   extractContext(term) → loops ALL files for EVERY term → O(files × terms)
    //   Session log shows this took 132 seconds per term on a 415-file vault.
    //
    // NEW approach: scan each file ONCE and record which line numbers contain
    // [[term]] references. extractContext() then looks up pre-built lists in O(1).
    //
    // Structure:  mentionIndex: Map<termLowercase, Array<{file, lineIndex}>>
    const mentionIndexT0 = performance.now();
    const mentionIndex = new Map();   // term.toLowerCase() → [{file, lineIndex}]
    const wikilinkRe = /\[\[([^\]|#]+?)(?:[|#][^\]]*?)?\]\]/g;

    for (const [filePath, entry] of fileContentCache) {
      // ⚡ BOLT B1: file object comes from the cache — no getAbstractFileByPath call.
      // ⚡ BOLT B5: lines array comes from the cache — no content.split('\n') call.
      // Both were computed once during pre-read above.
      const { file, lines } = entry;

      for (let li = 0; li < lines.length; li++) {
        const line = lines[li];
        if (!line.includes('[[')) continue;   // fast skip — avoids regex on most lines

        wikilinkRe.lastIndex = 0;
        let m;
        while ((m = wikilinkRe.exec(line)) !== null) {
          const linked = m[1].trim();
          const key = linked.toLowerCase();
          // ⚡ BOLT v3.5.2 Fix 4: single Map.get + null check — eliminates the
          // .has() + .get() double-lookup that was touching the Map twice per entry.
          // Called once per [[wikilink]] across the entire vault — on a 500-file
          // vault with avg 10 links/file this saves ~5,000 redundant Map ops.
          let arr = mentionIndex.get(key);
          if (!arr) { arr = []; mentionIndex.set(key, arr); }
          arr.push({ file, lineIndex: li });
        }
      }
    }
    const mentionIndexMs = Math.round(performance.now() - mentionIndexT0);
    this.logger.info("NoteGenerator", `Mention index built: ${mentionIndex.size} unique linked terms`, { durationMs: mentionIndexMs, filesScanned: fileContentCache.size });

    const total = linksArray.length;
    let current = 0;
    const batchStart = Date.now();
    let lastETAUpdate = 0;
    let batchNumber = 0;

    let notice = null;
    if (this.settings.showProgressNotification) {
      // 🎨 PALETTE: Visual progress bar — immediately shows progress at a glance
      notice = new import_obsidian.Notice(
        `Vault Wiki: ${formatProgressBar(0, total, -1)}`, 0
      );
    }

    for (let i = 0; i < linksArray.length; i += this.settings.batchSize) {
      // ⚡ BOLT: Check pause/cancel between batches
      if (this._cancelled) {
        this.logger.info("NoteGenerator", `Generation CANCELLED at ${current}/${total}`);
        if (notice) notice.setMessage(`Vault Wiki: Cancelled at ${current}/${total}.`);
        break;
      }
      while (this._paused) {
        if (notice) notice.setMessage(`Vault Wiki: ⏸ PAUSED (${current}/${total}). Run "Resume" to continue.`);
        await new Promise(resolve => setTimeout(resolve, 500));
        if (this._cancelled) break;
      }
      if (this._cancelled) break;

      batchNumber++;
      const batchT0 = performance.now();
      const batch = linksArray.slice(i, Math.min(i + this.settings.batchSize, linksArray.length));
      this.logger.debug("NoteGenerator",
        // ⚡ BOLT v3.5.2 Fix 9: batch.join(", ") only evaluated when DEBUG logging
        // is active. At INFO level (the default) this was allocating a new string
        // every batch — pure waste since the string was never written to a log.
        this.logger.LEVELS[this.logger.settings.logLevel] <= this.logger.LEVELS["DEBUG"]
          ? `Batch ${batchNumber}: processing [${batch.join(", ")}]`
          : `Batch ${batchNumber}: processing ${batch.length} terms`
      );

      await Promise.all(batch.map(term => this.generateNote(term, fileContentCache, mentionIndex)));

      const batchMs = Math.round(performance.now() - batchT0);
      current += batch.length;
      this.logger.debug("NoteGenerator", `Batch ${batchNumber} done: ${batch.length} terms in ${batchMs}ms (avg ${Math.round(batchMs / batch.length)}ms/term)`);

      // ⚡ BOLT + 🎨 PALETTE: Update progress bar every 3 seconds (more responsive)
      const now = Date.now();
      if (notice && (now - lastETAUpdate >= 3000 || current === total)) {
        lastETAUpdate = now;
        const elapsed = now - batchStart;
        const avgTime = elapsed / current;
        const etaSec = Math.ceil((avgTime * (total - current)) / 1000);
        notice.setMessage(`Vault Wiki: ${formatProgressBar(current, total, etaSec)}`);
      }

      await yieldToUI();
    }

    if (notice) notice.hide();

    // ── 📊 DIAGNOSTIC REPORT ──────────────────────────────────────────────────
    const totalMs = Math.round(performance.now() - t0);
    const stats = this.logger.stats;
    const diagReport = {
      totalMs,
      generated: stats.generated,
      skipped: stats.skipped,
      failed: stats.failed,
      apiCalls: stats.apiCalls,
      apiErrors: stats.apiErrors,
      cacheHits: stats.cacheHits,
      contextDepth: this.settings.contextDepth || 'partial',
      batchSize: this.settings.batchSize,
      totalBatches: batchNumber,
      preReadMs,
      filesInCache: fileContentCache.size,
      contentSizeMB: (totalContentBytes / 1048576).toFixed(2),
      avgMsPerTerm: total > 0 ? Math.round(totalMs / total) : 0,
      throughput: total > 0 ? ((total / (totalMs / 1000)).toFixed(1) + ' terms/s') : 'N/A',
      apiCacheHitRate: (stats.apiCalls + stats.cacheHits) > 0
        ? ((stats.cacheHits / (stats.apiCalls + stats.cacheHits)) * 100).toFixed(1) + '%'
        : 'N/A',
    };
    this.logger.info("NoteGenerator", `📊 GENERATION COMPLETE — Performance Report`, diagReport);

    const msg = this._cancelled
      ? `Vault Wiki: Cancelled. ${stats.generated} generated before stop.`
      : `Vault Wiki: ✅ Done! ${stats.generated} generated, `
      + `${stats.failed} failed, ${stats.skipped} skipped `
      + `(${(totalMs / 1000).toFixed(1)}s, ${diagReport.throughput}).`;
    new import_obsidian.Notice(msg);

    await this.logger.finalize();
  }

  async generateNote(term, fileContentCache, mentionIndex) {
    this.logger.debug("NoteGenerator", `Processing term: "${term}"`);
    try {
      // 🛡️ SENTINEL: Sanitize the term before it touches any file path.
      const safeTerm = sanitizeTermForPath(term);
      if (!safeTerm) {
        this.logger.warn("NoteGenerator", `Skipping "${term}" — sanitized to empty string (unsafe path)`);
        this.logger.stats.skipped++;
        return;
      }
      if (safeTerm !== term) {
        this.logger.warn("NoteGenerator", `Term sanitized for path safety`, { original: term, sanitized: safeTerm });
      }

      const contextData = await this.logger.time("extractContext", "NoteGenerator", () =>
        this.extractContext(term, fileContentCache, mentionIndex)
      );

      if (contextData.mentions.length === 0 && contextData.rawContext.trim() === "") {
        this.logger.warn("NoteGenerator", `Skipping "${term}" — no context found`);
        this.logger.stats.skipped++;
        return;
      }

      const category = this.determineBestCategory(contextData.sourceFiles);
      await this.categoryManager.ensureCategoryExists(category);

      // Fetch external data ONCE and reuse — with in-memory caching.
      // ⚡ BOLT: Skip Dictionary/Wikipedia for terms that are obviously not
      // lookupable (file paths, date titles, ion notation, social handles, etc.)
      // to avoid guaranteed-404 requests and keep error logs clean.
      const canLookup = isLookupableTerm(term);
      if (!canLookup) {
        this.logger.debug("NoteGenerator", `Skipping external lookups for "${term}" (not a lookupable term)`);
      }
      const [wikiData, dictData] = await Promise.all([
        (this.settings.useWikipedia && canLookup) ? this._fetchWikipedia(term) : Promise.resolve(null),
        (this.settings.useDictionaryAPI && canLookup) ? this._fetchDictionary(term) : Promise.resolve(null),
      ]);

      const content = await this.logger.time("buildNoteContent", "NoteGenerator", () =>
        this.buildNoteContent(term, category, contextData, wikiData, dictData)
      );

      // 🛡️ SENTINEL: safeTerm used here — never raw `term` — to prevent path traversal.
      // v3.6.0: File names are now Title Case (was ALL CAPS in v3.5.x).
      // Obsidian vault is typically case-insensitive on macOS/Windows, so existing
      // ALL-CAPS notes will be silently matched and updated in-place on those systems.
      // On case-sensitive Linux file systems, a new Title-Case file will be created
      // alongside any existing UPPERCASE file (the old file is left untouched).
      const titleTerm = toTitleCase(safeTerm);
      const filePath = `${category.path}/${titleTerm}.md`;

      // 🛡️ SENTINEL: Write-safety guard — blocks any write outside wiki/log directories.
      // This ensures your existing notes are NEVER modified by this plugin.
      assertSafeWritePath(filePath, this.settings);

      const existingFile = this.app.vault.getAbstractFileByPath(filePath);

      if (existingFile instanceof import_obsidian.TFile) {
        await this.app.vault.modify(existingFile, content);
        this.logger.debug("NoteGenerator", `Updated existing note: ${filePath}`);
      } else {
        await this.app.vault.create(filePath, content);
        this.logger.debug("NoteGenerator", `Created new note: ${filePath}`);
      }

      this.logger.stats.generated++;
    } catch (error) {
      this.logger.stats.failed++;
      this.logger.error("NoteGenerator", `Failed to generate note for "${term}"`, error);
    }
  }

  /**
   * ⚡ BOLT: Mode-aware context extraction with pre-cached file contents.
   *
   * Three modes controlled by settings.contextDepth:
   *   "full"        — Scans wikilinks + virtual/fuzzy mentions (findMatches on every line).
   *                   Most thorough but slowest — this is the #1 source of UI blocking.
   *   "partial"     — Only detects [[wikilinks]], extracts surrounding paragraph. ~3× faster.
   *                   Skips findMatches() entirely, which eliminates the UI freeze.
   *   "performance" — Only detects [[wikilinks]], extracts just the link line. ~10× faster.
   *
   * All modes use the pre-cached fileContentCache for zero disk I/O.
   */
  /**
   * ⚡ BOLT: Mode-aware context extraction using the pre-built mentionIndex.
   *
   * BEFORE (v3.0 / early v3.1): O(files × terms) — scanned all 400+ files for
   *   every term. Session logs show this took 132 seconds per term.
   *
   * AFTER: O(mentions) per term for wikilink lookup — the mentionIndex built once
   *   in generateAll() maps term → [{file, lineIndex}] so each term look-up is a
   *   single Map.get() regardless of vault size. Only "full" mode still scans all
   *   files, because virtual/fuzzy matching must read every line.
   *
   * contextDepth modes:
   *   "partial"     — mentionIndex lookup (O(1)) + paragraph extraction. Default.
   *   "performance" — mentionIndex lookup (O(1)) + link-line only. Fastest.
   *   "full"        — mentionIndex lookup + virtual/fuzzy findMatches() on all files.
   */
  async extractContext(term, fileContentCache, mentionIndex) {
    const mentions = [];
    const sourceFilesSet = new Set();
    const rawContext = [];
    const mode = this.settings.contextDepth || 'partial';
    // ⚡ BOLT v3.5.2 Fix 5: compute wikiDirPrefix once here (not inside loops below).
    const wikiDirPrefix = (this.settings.customDirectoryName || 'Wiki') + '/';

    // ── Phase 1: Wikilink mentions via O(1) inverted index ─────────────────────
    const termKey = term.toLowerCase();
    const indexEntries = mentionIndex?.get(termKey) ?? [];

    for (const { file, lineIndex } of indexEntries) {
      if (file.path.startsWith(wikiDirPrefix)) continue;

      // ⚡ BOLT B2: use pre-cached lines — no content.split('\n') call per mention.
      // On a 500-file vault with avg 5 mentions/file this eliminates ~2,500
      // redundant array allocations per generation pass.
      const entry = fileContentCache?.get(file.path);
      if (!entry) continue;

      const { lines, headingByLine } = entry;
      // ⚡ BOLT v3.5.2 Fix 1: O(1) heading lookup via pre-built headingByLine array.
      // Before: findPreviousHeading() scanned backward O(lineIndex) per call.
      // After:  array index — constant time regardless of file length.
      const heading = headingByLine ? headingByLine[lineIndex] : this.findPreviousHeading(lines, lineIndex);

      let context;
      if (mode === 'performance') {
        context = [lines[lineIndex]];
      } else {
        context = this.settings.includeFullParagraphs
          ? this.extractParagraph(lines, lineIndex)
          : this.extractLines(lines, lineIndex);
      }

      // ⚡ BOLT B3: store context as array (contentLines) instead of joining to a
      // string. formatMention() will iterate contentLines directly — eliminating
      // the join('\n') here and the split('\n') inside formatMention.
      mentions.push({ file, heading, contentLines: context, type: 'wikilinked' });
      sourceFilesSet.add(file);
      rawContext.push(context.join(' '));
    }

    // ── Phase 2: Virtual/fuzzy mentions — "full" mode only ─────────────────────
    // findMatches() must scan every line of every file to find non-wikilinked
    // text references. This remains O(files) and is why "full" is slower.
    if (mode === 'full') {
      const singularTerm = getSingularForm(term);
      const pluralTerm = getPluralForm(term);
      const files = this.app.vault.getMarkdownFiles();

      for (let fi = 0; fi < files.length; fi++) {
        const file = files[fi];
        if (file.path.startsWith(wikiDirPrefix)) continue;

        // ⚡ BOLT B2: use pre-cached lines — no split('\n') per file in full mode
        const entry = fileContentCache?.get(file.path);
        if (!entry) continue;

        const { lines, headingByLine } = entry;
        for (let i = 0; i < lines.length; i++) {
          const matches = this.termCache.findMatches(lines[i]);
          for (const match of matches) {
            if (match.files.some(f =>
              f.basename === term ||
              f.basename === singularTerm ||
              f.basename === pluralTerm
            )) {
              // ⚡ BOLT v3.5.2 Fix 1: O(1) heading lookup
              const heading = headingByLine ? headingByLine[i] : this.findPreviousHeading(lines, i);
              const context = this.settings.includeFullParagraphs
                ? this.extractParagraph(lines, i)
                : this.extractLines(lines, i);
              // ⚡ BOLT B3: store as contentLines array (no join here, no split in formatMention)
              mentions.push({
                file, heading, contentLines: context, type: 'virtual',
                matchText: match.text, alternatives: match.files.map(f => f.basename),
              });
              sourceFilesSet.add(file);
              rawContext.push(context.join(' '));
            }
          }
        }

        if (fi % 50 === 0 && fi > 0) await yieldToUI();
      }
    }

    this.logger.debug("NoteGenerator", `extractContext [${mode}] "${term}": ${mentions.length} mentions across ${sourceFilesSet.size} files`);

    // ⚡ BOLT: Deduplicate rawContext paragraphs before joining.
    //
    // PROBLEM: If note A mentions [[ActionPotential]] 5× in different paragraphs,
    // all 5 are pushed to rawContext with no deduplication. Sending the same
    // paragraph 5× wastes tokens and inflates context past smaller models'
    // practical input limits (e.g. mistral-small-latest returns empty/null above
    // ~15k combined tokens).
    //
    // FIX: Use a Set of paragraph content (trimmed) to skip exact duplicates before
    // joining. O(n) pass over rawContext — negligible cost vs. the savings.
    //
    // Expected impact: 30–80% reduction in rawContext size for notes that
    // mention the same term repeatedly in similar paragraphs.
    const seenParagraphs = new Set();
    const deduped = [];
    for (const chunk of rawContext) {
      const key = chunk.trim();
      if (key && !seenParagraphs.has(key)) {
        seenParagraphs.add(key);
        deduped.push(chunk);
      }
    }
    const dedupedCount = rawContext.length - deduped.length;
    if (dedupedCount > 0) {
      this.logger.debug("NoteGenerator", `⚡ Deduped ${dedupedCount} duplicate context paragraph(s) for "${term}"`);
    }

    // 🛡️ SENTINEL: Cap rawContext at 200 KB to prevent OOM on enormous vaults.
    const MAX_CONTEXT_BYTES = 200_000;
    let rawContextStr = deduped.join('\n\n');
    if (rawContextStr.length > MAX_CONTEXT_BYTES) {
      rawContextStr = rawContextStr.slice(0, MAX_CONTEXT_BYTES);
      this.logger.warn("NoteGenerator", `Context for "${term}" truncated at ${MAX_CONTEXT_BYTES} bytes to prevent OOM`);
    }

    return {
      mentions,
      sourceFiles: Array.from(sourceFilesSet),
      rawContext: rawContextStr,
    };
  }

  findPreviousHeading(lines, currentIndex) {
    for (let i = currentIndex - 1; i >= 0; i--) {
      const line = lines[i].trim();
      if (line.startsWith('#')) {
        return line.replace(/^#+\s*/, '');
      }
    }
    return null;
  }

  extractParagraph(lines, lineIndex) {
    // ⚡ BOLT v3.5.2 Fix 6: single array push instead of slice() + filter().
    // Before: lines.slice(start, end+1) allocated an array, then .filter() allocated another.
    // After:  one result array, pushed into directly in the expansion loops — half the GC work.
    // Called once per mention in partial/full mode, so the saving scales with mention count.
    let start = lineIndex;
    while (start > 0 && lines[start - 1].trim() !== '') start--;
    let end = lineIndex;
    while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++;
    const result = [];
    for (let i = start; i <= end; i++) {
      if (lines[i].trim() !== '') result.push(lines[i]);
    }
    return result;
  }

  extractLines(lines, lineIndex) {
    const start = Math.max(0, lineIndex - this.settings.contextLinesAround);
    const end = Math.min(lines.length - 1, lineIndex + this.settings.contextLinesAround);
    return lines.slice(start, end + 1);
  }

  determineBestCategory(sourceFiles) {
    if (!this.settings.useCategories || sourceFiles.length === 0) {
      return this.categoryManager.getDefaultCategory();
    }

    const categoryVotes = new Map();
    for (const file of sourceFiles) {
      const category = this.categoryManager.assignCategory(file);
      categoryVotes.set(category.name, (categoryVotes.get(category.name) || 0) + 1);
    }

    let maxVotes = 0;
    let bestCategory = this.categoryManager.getDefaultCategory();
    for (const [catName, votes] of categoryVotes) {
      if (votes > maxVotes) {
        maxVotes = votes;
        // ⚡ BOLT v3.5.2 Fix 8: O(1) map lookup replaces O(n) categories.find()
        const cat = this.categoryManager._categoryByName?.get(catName);
        if (cat) bestCategory = cat;
      }
    }

    return bestCategory;
  }

  /**
   * Build the note content. Accepts pre-fetched wikiData and dictData so they
   * are NOT fetched twice (original bug: they were fetched once for the display
   * section, then again for AI context injection).
   *
   * v3.6.0 Layout:
   *   # Term (Title Case)
   *   TOC
   *   ## AI Summary   ← plain prose, NO ">" blockquotes
   *   ## Wikipedia
   *   ## Dictionary
   *   ## Mentions
   */
  async buildNoteContent(term, category, contextData, wikiData, dictData) {
    // ── Title Case display term ────────────────────────────────────────────────
    // v3.6.0: Title Case replaces ALL CAPS — more readable, preserves acronyms.
    // File names still use the sanitized term; only the display heading changes.
    const displayTerm = toTitleCase(term);

    let content = "";

    // ── Frontmatter ──────────────────────────────────────────────────────────
    content += "---\n";
    content += "type: wiki-note\n";
    content += "copilot-index: true\n";
    content += `generated: ${new Date().toISOString()}\n`;
    if (this.settings.trackModel) {
      content += `model: ${this.settings.modelName}\n`;
      content += `provider: ${this.settings.provider}\n`;
    }
    if (contextData.sourceFiles.length > 0) {
      content += "source-notes:\n";
      for (const sf of contextData.sourceFiles) {
        content += `  - "[[${sf.basename}]]"\n`;
      }
    }

    if (this.settings.generateTags) {
      const tags = await this.generateTags(term, contextData);
      if (tags.length > 0) {
        content += "tags:\n";
        for (const tag of tags) {
          const tagText = this.settings.tagsIncludeHashPrefix
            ? (tag.startsWith('#') ? tag : `#${tag}`)
            : tag.replace('#', '');
          content += `  - "${tagText}"\n`;
        }
      }
    }
    content += "---\n\n";

    // ── Title (UPPERCASE) ────────────────────────────────────────────────────
    content += `# ${displayTerm}\n\n`;

    // ── Build sections in order, collecting headings for TOC ─────────────────
    // We build each section into a buffer, then assemble with TOC up front.
    const sections = [];

    // ── AI context assembly (for summary generation) ─────────────────────────
    let aiContext = contextData.rawContext;
    if (this.settings.useDictionaryInContext && dictData) {
      aiContext += "\n\nDictionary: " + dictData.plain;
    }
    if (this.settings.useWikipediaInContext && wikiData) {
      aiContext += "\n\nWikipedia: " + wikiData.extract;
    }
    if (this.settings.glossaryBasePath) {
      const glossary = await this.getGlossaryContext(term);
      if (glossary) aiContext += "\n\nGlossary: " + glossary;
    }

    // ⚡ BOLT: Strip Obsidian markup from AI context before sending.
    aiContext = aiContext
      .replace(/^---[\s\S]*?---\n?/gm, '')
      .replace(/\[\[[^\]|#]+\|([^\]]+)\]\]/g, '$1')
      .replace(/\[\[([^\]|#]+?)(?:#[^\]]+)?\]\]/g, '$1')
      .replace(/==([^=]+)==/g, '$1')
      .replace(/(?<!\w)#\w+/g, '')
      .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    // 🛡️ SENTINEL: Cap context at configured limit
    const MAX_AI_CONTEXT = this.settings.aiContextMaxChars ?? 20_000;
    if (aiContext.length > MAX_AI_CONTEXT) {
      const cutPoint = aiContext.lastIndexOf('\n\n', MAX_AI_CONTEXT);
      aiContext = aiContext.slice(0, cutPoint > MAX_AI_CONTEXT * 0.5 ? cutPoint : MAX_AI_CONTEXT);
      this.logger.warn("NoteGenerator", `AI context for "${term}" trimmed to ${aiContext.length} chars`);
    }

    const aiSummary = await this.logger.time("getAISummary", "NoteGenerator", () =>
      this.getAISummary(term, aiContext)
    );

    // ── Section: AI Summary ───────────────────────────────────────────────────
    if (aiSummary) {
      let sectionContent = `## AI Summary\n`;
      sectionContent += `${this.settings.aiSummaryDisclaimer}\n\n`;

      // v3.5.0: Plain prose — NO ">" blockquotes at all.
      // Strip any ">" characters that the model may have generated itself.
      const cleanedSummary = aiSummary
        .split('\n')
        .map(line => {
          // Remove leading "> " or ">" that the AI added itself
          return line.replace(/^>\s?/, '');
        })
        .join('\n')
        // Collapse triple+ blank lines to double
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      sectionContent += cleanedSummary + "\n\n";

      if (this.settings.extractKeyConceptsFromSummary) {
        const keyConcepts = this.extractKeyConcepts(aiSummary);
        if (keyConcepts.length > 0) {
          sectionContent += "---\n\n";
          for (const concept of keyConcepts) {
            sectionContent += `- **${concept}**\n`;
          }
          sectionContent += "\n";
        }
      }

      sections.push({ heading: "AI Summary", content: sectionContent });
    }

    // ── Section: Wikipedia ────────────────────────────────────────────────────
    if (this.settings.useWikipedia && wikiData) {
      let sectionContent = `## Wikipedia\n`;
      sectionContent += `[${this.settings.wikipediaLinkText}](${wikiData.url})\n`;
      sectionContent += `${wikiData.extract}\n\n`;
      sections.push({ heading: "Wikipedia", content: sectionContent });
    }

    // ── Section: Dictionary ───────────────────────────────────────────────────
    if (this.settings.useDictionaryAPI && dictData) {
      let sectionContent = `## Dictionary\n`;
      sectionContent += dictData.formatted + "\n\n";
      sections.push({ heading: "Dictionary", content: sectionContent });
    }

    // ── Section: Related Concepts ─────────────────────────────────────────────
    if (this.settings.generateRelatedConcepts) {
      const related = await this.getRelatedConcepts(term, aiContext);
      if (related.length > 0) {
        let sectionContent = `## Related Concepts\n`;
        for (const concept of related) sectionContent += `- [[${concept}]]\n`;
        sectionContent += "\n";
        sections.push({ heading: "Related Concepts", content: sectionContent });
      }
    }

    // ── Section: Mentions ─────────────────────────────────────────────────────
    if (contextData.mentions.length > 0) {
      let sectionContent = `## Mentions\n\n`;
      for (const mention of contextData.mentions) {
        sectionContent += this.formatMention(mention);
      }
      sections.push({ heading: "Mentions", content: sectionContent });
    }

    // ── TOC (links to all sections present) ──────────────────────────────────
    if (sections.length > 0) {
      for (const section of sections) {
        // Obsidian heading anchors: lowercase, spaces → hyphens
        const anchor = section.heading.toLowerCase().replace(/\s+/g, '-');
        content += `- [[#${anchor}|${section.heading}]]\n`;
      }
      content += "\n";
    }

    // ── Assemble all sections ─────────────────────────────────────────────────
    for (const section of sections) {
      content += section.content;
    }

    return content;
  }

  extractKeyConcepts(summary) {
    const boldPattern = /\*\*([^*]+)\*\*/g;
    const concepts = [];
    let match;
    while ((match = boldPattern.exec(summary)) !== null) {
      concepts.push(match[1]);
    }
    return [...new Set(concepts)].slice(0, 10);
  }

  formatMention(mention) {
    // ⚡ BOLT B4: accumulate into an array and join once at the end.
    // Before: 7–10 string concatenations per mention → O(n) intermediate strings.
    // After:  one array allocation + push operations + single join → ~3× less GC pressure
    //         on vaults with many mentions (50+ per wiki term).
    const parts = [];
    let header = `### From [[${mention.file.basename}]]`;
    if (mention.heading) header += ` → ${mention.heading}`;
    parts.push(header + '\n');

    if (mention.type === 'virtual') {
      parts.push(`> **Detected:** "${mention.matchText}"\n`);
      if (mention.alternatives && mention.alternatives.length > 1) {
        parts.push(`> **Alternatives:** ${mention.alternatives.map(a => `[[${a}]]`).join(', ')}\n`);
      }
      parts.push('>\n');
    }

    // ⚡ BOLT B3: iterate contentLines (string[]) directly — no split('\n') needed.
    // Before: mention.content was a joined string; split('\n') called per mention.
    // After:  contentLines is the original context array — zero extra allocation.
    const contentLines = mention.contentLines ?? (mention.content ? mention.content.split('\n') : []);
    for (const line of contentLines) {
      parts.push(`> ${line}\n`);
    }
    parts.push('\n');

    return parts.join('');
  }

  // ── External data fetchers (with logging) ──────────────────────────────────

  async _fetchWikipedia(term) {
    // ⚡ BOLT: In-memory API cache — avoids duplicate Wikipedia fetches
    const cacheKey = term.toLowerCase();
    if (this._wikiCache.has(cacheKey)) {
      this.logger.stats.cacheHits++;
      this.logger.debug("NoteGenerator", `Wikipedia cache HIT for "${term}" (${this._wikiCache.size} entries in cache)`);
      return this._wikiCache.get(cacheKey);
    }

    const apiT0 = performance.now();
    this.logger.stats.apiCalls++;
    try {
      const data = await this.getWikipediaData(term);
      const apiMs = Math.round(performance.now() - apiT0);
      this._wikiCache.set(cacheKey, data);
      this.logger.debug("NoteGenerator", `Wikipedia API for "${term}": ${data ? 'found' : 'no result'}`, { durationMs: apiMs, extractLength: data?.extract?.length || 0 });
      return data;
    } catch (err) {
      const apiMs = Math.round(performance.now() - apiT0);
      this.logger.stats.apiErrors++;
      this.logger.error("NoteGenerator", `Wikipedia fetch FAILED for "${term}" after ${apiMs}ms`, err);
      this._wikiCache.set(cacheKey, null);
      return null;
    }
  }

  async _fetchDictionary(term) {
    // ⚡ BOLT: In-memory API cache — avoids duplicate Dictionary fetches
    const cacheKey = term.toLowerCase();
    if (this._dictCache.has(cacheKey)) {
      this.logger.stats.cacheHits++;
      this.logger.debug("NoteGenerator", `Dictionary cache HIT for "${term}" (${this._dictCache.size} entries in cache)`);
      return this._dictCache.get(cacheKey);
    }

    const apiT0 = performance.now();
    this.logger.stats.apiCalls++;
    try {
      const data = await this.getDictionaryDefinition(term);
      const apiMs = Math.round(performance.now() - apiT0);
      this._dictCache.set(cacheKey, data);
      this.logger.debug("NoteGenerator", `Dictionary API for "${term}": ${data ? 'found' : 'no result'}`, { durationMs: apiMs });
      return data;
    } catch (err) {
      const apiMs = Math.round(performance.now() - apiT0);
      // 🛡️ HTTP 404 from the dictionary API means "term has no entry" — completely
      // expected for ions (Na+, Ca2+), abbreviations, proper nouns, multi-word titles.
      // Do NOT increment apiErrors or log at ERROR; use DEBUG so stats/logs stay clean.
      if (err?.status === 404 || err?.message?.includes('status 404')) {
        this.logger.debug("NoteGenerator", `Dictionary: no entry for "${term}" (404)`, { durationMs: apiMs });
      } else {
        this.logger.stats.apiErrors++;
        this.logger.error("NoteGenerator", `Dictionary fetch FAILED for "${term}" after ${apiMs}ms`, err);
      }
      this._dictCache.set(cacheKey, null);
      return null;
    }
  }

  async getWikipediaData(term) {
    try {
      // Pre-filter: skip terms that are clearly not Wikipedia article titles.
      // These produce failed/irrelevant searches and waste API quota.
      // — Date-like strings: "Day 1 Chemistry 9.23.25", "9.8.2025"
      const isDateLike = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b/.test(term);
      // — File names (have an extension like .png, .pdf)
      const isFilename = /\.\w{2,4}$/.test(term.trim());
      // — Looks like a plain to-do or admin title with no encyclopedic value
      const isAdminTitle = /\b(to-?do|homework|due date|journal|work days|goal|schedule)\b/i.test(term);
      if (isDateLike || isFilename || isAdminTitle) {
        this.logger.debug("NoteGenerator", `Wikipedia pre-filter: skipping "${term}" — not an encyclopedic term`);
        return null;
      }

      // Resolve abbreviations before searching (e.g. "ACh" → "Acetylcholine")
      const synonymMap = this.settings.synonyms || {};
      const searchTerm = synonymMap[term] || term;

      const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&search=${encodeURIComponent(searchTerm)}&limit=1`;
      const searchResponse = await (0, import_obsidian.requestUrl)({ url: searchUrl, method: "GET", timeout: 8000 });
      const searchData = searchResponse.json;

      if (!searchData || searchData.length < 4 || !searchData[1][0]) return null;

      const title = searchData[1][0];
      const pageUrl = searchData[3][0];

      const extractUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=extracts&exintro=1&explaintext=1&titles=${encodeURIComponent(title)}`;
      const extractResponse = await (0, import_obsidian.requestUrl)({ url: extractUrl, method: "GET", timeout: 8000 });
      const extractData = extractResponse.json;

      const pages = extractData?.query?.pages;
      if (!pages) return null;

      const pageId = Object.keys(pages)[0];
      const extract = pages[pageId]?.extract;
      if (!extract) return null;

      const sentences = extract.split(/[.!?]+/).filter(s => s.trim().length > 0);
      const shortExtract = sentences.slice(0, 3).join('. ') + '.';

      return { title, url: pageUrl, extract: shortExtract };
    } catch (error) {
      // 404 or empty search results from Wikipedia just means no article exists for this term.
      // Log at WARN (not ERROR) to avoid polluting the error index with expected misses.
      if (error?.status === 404 || error?.message?.includes('status 404')) {
        this.logger.debug("NoteGenerator", `Wikipedia: no article for "${term}" (404)`);
      } else {
        this.logger.warn("NoteGenerator", `Wikipedia lookup failed for "${term}"`, { message: error?.message });
      }
      return null;
    }
  }

  async getDictionaryDefinition(term) {
    try {
      // ── Pre-flight term validation ─────────────────────────────────────────
      //
      // The dictionary API only accepts single, plain English words.
      // Sending multi-word phrases, chemical/ion notation (Ca2+, Na+),
      // parenthetical abbreviations ("Acetylcholine (ACh)"), or file-name-like
      // strings ("Day 5 Chemistry 9.23.25") always returns HTTP 404 — producing
      // the error storm visible in earlier session logs. Pre-filter aggressively.
      //
      // Strategy (in order):
      //   1. Strip trailing parenthetical: "Acetylcholine (ACh)" → "Acetylcholine"
      //   2. Resolve abbreviation via synonyms map: "ACh" → "Acetylcholine"
      //   3. For remaining multi-word terms, take only the first word as the lookup.
      //   4. Hard-skip: chemical formulas, ion notation, date strings, too-short terms.
      //   5. Apply singular form for the final lookup key.

      // Step 1: strip trailing parenthetical (e.g. " (ACh)", " (AP)")
      let lookupTerm = term.replace(/\s*\([^)]*\)\s*$/, '').trim();

      // Step 2: resolve abbreviation/synonym (e.g. "ACh" → "Acetylcholine")
      const synonymMap = this.settings.synonyms || {};
      if (synonymMap[lookupTerm]) {
        lookupTerm = synonymMap[lookupTerm];
      }

      // Step 3: collapse to first word if still multi-word
      const words = lookupTerm.split(/\s+/);
      if (words.length > 1) {
        lookupTerm = words[0];
      }

      // Step 4: hard-skip clearly non-dictionary entries
      // — Chemical/ion notation: contains digits, lone "+"/"-" suffix
      const isChemical = /\d/.test(lookupTerm) || /[+\-]$/.test(lookupTerm);
      // — Date-like strings ("9.23.25")
      const isDateLike = /\d+\.\d+/.test(lookupTerm);
      // — Non-word characters that no English word contains
      const hasNonWord = /[@#_&]/.test(lookupTerm);
      // — Too short to be a real word the API will have
      const tooShort = lookupTerm.length < 3;

      if (isChemical || isDateLike || hasNonWord || tooShort) {
        this.logger.debug("NoteGenerator",
          `Dictionary pre-filter: skipping "${term}" (resolved: "${lookupTerm}") — not a plain English word`);
        return null;
      }

      // Step 5: use singular form if available
      lookupTerm = getSingularForm(lookupTerm) || lookupTerm;

      // 🛡️ SENTINEL: Validate the user-configurable endpoint before fetching.
      // See validateEndpointUrl() for the full SSRF threat model.
      const endpointError = validateEndpointUrl(this.settings.dictionaryAPIEndpoint);
      if (endpointError) {
        this.logger.warn("NoteGenerator", `Dictionary endpoint blocked: ${endpointError}`);
        return null;
      }

      const response = await (0, import_obsidian.requestUrl)({
        url: `${this.settings.dictionaryAPIEndpoint}/${encodeURIComponent(lookupTerm)}`,
        method: "GET",
        // ⚡ BOLT: 8s timeout — dictionary is non-critical; don't let it block generation
        timeout: 8000,
      });

      const data = response.json;
      if (!data || !Array.isArray(data) || data.length === 0) return null;

      const entry = data[0];
      let formatted = "";
      let plain = "";

      if (entry.word) {
        formatted += `**${entry.word}**`;
        plain += `${entry.word}`;
        if (entry.phonetic) {
          formatted += ` _${entry.phonetic}_`;
          plain += ` (${entry.phonetic})`;
        }
        formatted += "\n";
        plain += ": ";
      }

      if (entry.meanings && Array.isArray(entry.meanings)) {
        const meaning = entry.meanings[0];
        if (meaning.partOfSpeech) {
          formatted += `_${meaning.partOfSpeech}_\n`;
          plain += `[${meaning.partOfSpeech}] `;
        }
        if (meaning.definitions?.[0]) {
          const def = meaning.definitions[0];
          formatted += `${def.definition}\n`;
          plain += `${def.definition}`;
        }
      }

      return { formatted, plain };
    } catch (error) {
      if (error?.status === 404 || error?.message?.includes('status 404')) {
        this.logger.debug("NoteGenerator", `Dictionary: no entry for "${term}" (404)`);
      } else {
        this.logger.error("NoteGenerator", `getDictionaryDefinition internal error for "${term}"`, error);
      }
      return null;
    }
  }

  async getGlossaryContext(term) {
    if (!this.settings.glossaryBasePath) return "";

    try {
      const glossaryFile = this.app.vault.getAbstractFileByPath(this.settings.glossaryBasePath);
      if (!(glossaryFile instanceof import_obsidian.TFile)) {
        this.logger.warn("NoteGenerator", `Glossary file not found: ${this.settings.glossaryBasePath}`);
        return "";
      }

      const content = await this.app.vault.read(glossaryFile);
      const lines = content.split('\n');
      // ⚡ BOLT v3.5.2 Fix 3: hoist term.toLowerCase() out of the loop.
      // Before: term.toLowerCase() called fresh on every line iteration.
      const termLower = term.toLowerCase();

      let extracting = false;
      let glossaryEntry = "";

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.toLowerCase().includes(termLower)) {
          extracting = true;
          glossaryEntry += line + "\n";
          continue;
        }
        if (extracting) {
          if (line.startsWith('#') || (line.trim() === '' && glossaryEntry.trim() !== '')) break;
          glossaryEntry += line + "\n";
        }
      }

      return glossaryEntry.trim();
    } catch (error) {
      this.logger.error("NoteGenerator", `Glossary read failed for "${term}"`, error);
      return "";
    }
  }

  async getAISummary(term, context) {
    const hasKey = !!this.settings.openaiApiKey;
    const isCloud = this.settings.provider === "mistral" || this.settings.provider === "openai";
    const isLMStudioV1 = this.settings.provider === "lmstudio-v1";

    // ── LM Studio native v1 API path ────────────────────────────────────────────
    if (isLMStudioV1) {
      if (!context || context.trim() === "") {
        this.logger.warn("NoteGenerator", `getAISummary (v1): skipping "${term}" — empty context`);
        return null;
      }
      const hwMode = detectHardwareMode(this.settings);
      this.logger.debug("NoteGenerator", `getAISummary via LM Studio v1 API`, {
        term,
        hwMode,
        endpoint: this.settings.lmstudioV1Endpoint,
        model: this.settings.modelName,
        stateful: this.settings.lmstudioV1Stateful,
      });
      this.logger.stats.apiCalls++;
      const userPrompt = this.settings.userPromptTemplate
        .replace('{{term}}', term)
        .replace('{{context}}', context);
      try {
        // Each wiki note gets a fresh thread (no cross-term state leak)
        this._lmstudioV1.resetThread();
        const result = this.settings.lmstudioV1StreamingEnabled
          ? await this._lmstudioV1.chatStreaming(userPrompt, this.settings.systemPrompt, false)
          : await this._lmstudioV1.chat(userPrompt, this.settings.systemPrompt, false);
        if (!result) {
          this.logger.warn("NoteGenerator", `LM Studio v1 returned null for "${term}"`);
          this.logger.stats.apiErrors++;
        }
        return result;
      } catch (err) {
        this.logger.stats.apiErrors++;
        this.logger.error("NoteGenerator", `LM Studio v1 summary failed for "${term}"`, err);
        return null;
      }
    }

    // ── Standard OpenAI-compatible path ────────────────────────────────────────

    if (isCloud && !hasKey) {
      this.logger.warn("NoteGenerator", `getAISummary: skipping "${term}" — no API key configured for cloud provider`);
      // Only show this notice once per session to avoid spamming
      if (!this._shownNoKeyWarning) {
        this._shownNoKeyWarning = true;
        new import_obsidian.Notice(
          `Vault Wiki: No API key set for ${this.settings.provider}. Open Settings → AI Provider and add your key.`,
          8000
        );
      }
      return null;
    }
    if (!context || context.trim() === "") {
      this.logger.warn("NoteGenerator", `getAISummary: skipping "${term}" — empty context`);
      return null;
    }

    // 🛡️ SENTINEL: Validate endpoint protocol before making any network request.
    const protocolError = validateEndpointProtocol(this.settings.openaiEndpoint);
    if (protocolError) {
      this.logger.error("NoteGenerator", `getAISummary: blocked unsafe endpoint — ${protocolError}`, {
        endpoint: this.settings.openaiEndpoint,
      });
      if (!this._shownEndpointWarning) {
        this._shownEndpointWarning = true;
        new import_obsidian.Notice(`Vault Wiki: Bad API endpoint — ${protocolError}`, 8000);
      }
      return null;
    }

    // 🛡️ SENTINEL: Also run the full SSRF check on every request (endpoint could have been changed).
    const ssrfError = validateEndpointUrl(this.settings.openaiEndpoint);
    if (ssrfError) {
      this.logger.error("NoteGenerator", `getAISummary: blocked SSRF-risk endpoint — ${ssrfError}`);
      return null;
    }

    this.logger.stats.apiCalls++;
    this.logger.debug("NoteGenerator", `Calling AI API`, {
      endpoint: this.settings.openaiEndpoint,
      model: this.settings.modelName,
      apiKey: maskApiKey(this.settings.openaiApiKey),
    });
    try {
      const userPrompt = this.settings.userPromptTemplate
        .replace('{{term}}', term)
        .replace('{{context}}', context);

      const headers = { "Content-Type": "application/json" };
      if (this.settings.openaiApiKey) {
        headers["Authorization"] = `Bearer ${this.settings.openaiApiKey}`;
      }

      const baseUrl = this.settings.openaiEndpoint.trim().replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;
      const body = JSON.stringify({
        model: this.settings.modelName,
        messages: [
          { role: "system", content: this.settings.systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: 1500,
      });

      this.logger.debug("NoteGenerator", `POST ${url}`, { model: this.settings.modelName, contextLen: context.length });

      const response = await (0, import_obsidian.requestUrl)({
        url,
        method: "POST",
        headers,
        timeout: 60000,
        body,
      });

      // Obsidian's requestUrl throws on non-2xx, so if we're here the status was 2xx.
      const data = response.json;
      if (!data?.choices?.[0]?.message?.content) {
        this.logger.warn("NoteGenerator", `AI response for "${term}" had unexpected shape`, data);
        this.logger.stats.apiErrors++;
        if (!this._shownShapeWarning) {
          this._shownShapeWarning = true;
          new import_obsidian.Notice(
            `Vault Wiki: AI returned an unexpected response format. Check your model name (${this.settings.modelName}) and endpoint.`,
            8000
          );
        }
        return null;
      }

      return data.choices[0].message.content;
    } catch (error) {
      this.logger.stats.apiErrors++;
      this.logger.error("NoteGenerator", `AI summary request failed for "${term}"`, error);

      // Surface the first AI error to the user as a Notice so they know something is wrong
      if (!this._shownAIError) {
        this._shownAIError = true;
        const status = error?.status;
        let msg = `Vault Wiki: AI call failed`;
        if (status === 401) {
          msg = `Vault Wiki: AI call failed — 401 Unauthorized. Check your API key in Settings → AI Provider.`;
        } else if (status === 404) {
          msg = `Vault Wiki: AI call failed — 404. Check your endpoint URL and model name ("${this.settings.modelName}") in Settings → AI Provider.`;
        } else if (status === 429) {
          msg = `Vault Wiki: AI call failed — 429 Rate limited. Slow down or upgrade your plan.`;
        } else if (status >= 500) {
          msg = `Vault Wiki: AI call failed — ${status} Server error from ${this.settings.provider}. Try again later.`;
        } else if (error?.message?.includes('timeout') || error?.message?.includes('TIMEOUT')) {
          msg = `Vault Wiki: AI call timed out. The model may be overloaded or your endpoint is unreachable.`;
        } else if (error?.message) {
          msg = `Vault Wiki: AI call failed — ${error.message}`;
        }
        new import_obsidian.Notice(msg, 10000);
      }

      return null;
    }
  }

  /**
   * Make a single minimal test call to the configured AI endpoint.
   * Returns { success: boolean, message: string, model?: string, latencyMs?: number }
   */
  async testAIConnection() {
    const isLMStudioV1 = this.settings.provider === "lmstudio-v1";

    // ── LM Studio native v1 test path ──────────────────────────────────────────
    if (isLMStudioV1) {
      const endpoint = (this.settings.lmstudioV1Endpoint || "http://localhost:1234").replace(/\/+$/, "");
      const endpointError = validateEndpointUrl(endpoint);
      if (endpointError) return { success: false, message: `Invalid LM Studio v1 endpoint: ${endpointError}` };

      const hwMode = detectHardwareMode(this.settings);
      const hwLabel = hardwareModeLabel(hwMode);
      const t0 = performance.now();

      try {
        const client = new LMStudioV1Client(this.settings, this.logger);
        const result = await client.chat("Reply with exactly: OK", null, false);
        const latencyMs = Math.round(performance.now() - t0);
        if (result) {
          return {
            success: true,
            message: `✅ LM Studio v1 connected! Model: ${this.settings.modelName} — ${latencyMs}ms [${hwLabel}]`,
            latencyMs,
          };
        } else {
          return { success: false, message: `⚠️ LM Studio v1: No response. Is a model loaded at ${endpoint}?` };
        }
      } catch (err) {
        const latencyMs = Math.round(performance.now() - t0);
        return { success: false, message: `❌ LM Studio v1 failed after ${latencyMs}ms — ${err?.message ?? "Unknown error"}` };
      }
    }

    // ── Standard OpenAI-compatible test path ───────────────────────────────────
    const hasKey = !!this.settings.openaiApiKey;
    const isCloud = this.settings.provider === "mistral" || this.settings.provider === "openai";

    if (isCloud && !hasKey) {
      return { success: false, message: `No API key set. Add your ${this.settings.provider} key in Settings → AI Provider.` };
    }

    const endpointError = validateEndpointUrl(this.settings.openaiEndpoint);
    if (endpointError) {
      return { success: false, message: `Invalid endpoint: ${endpointError}` };
    }

    const headers = { "Content-Type": "application/json" };
    if (this.settings.openaiApiKey) {
      headers["Authorization"] = `Bearer ${this.settings.openaiApiKey}`;
    }

    const baseUrl = this.settings.openaiEndpoint.trim().replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;
    const t0 = performance.now();

    try {
      const response = await (0, import_obsidian.requestUrl)({
        url,
        method: "POST",
        headers,
        timeout: 20000,
        body: JSON.stringify({
          model: this.settings.modelName,
          messages: [{ role: "user", content: "Reply with exactly: OK" }],
          max_tokens: 10,
        }),
      });

      const latencyMs = Math.round(performance.now() - t0);
      const data = response.json;
      const text = data?.choices?.[0]?.message?.content;
      const usedModel = data?.model ?? this.settings.modelName;

      if (text) {
        return {
          success: true,
          message: `✅ Connected! Model: ${usedModel} — replied in ${latencyMs}ms`,
          model: usedModel,
          latencyMs,
        };
      } else {
        return {
          success: false,
          message: `⚠️ API responded but returned unexpected JSON shape. Check model name "${this.settings.modelName}".`,
        };
      }
    } catch (error) {
      const latencyMs = Math.round(performance.now() - t0);
      const status = error?.status;
      let message;
      if (status === 401) {
        message = `❌ 401 Unauthorized — your API key is wrong or expired.`;
      } else if (status === 404) {
        message = `❌ 404 — endpoint or model not found. Check URL "${this.settings.openaiEndpoint}" and model "${this.settings.modelName}".`;
      } else if (status === 429) {
        message = `❌ 429 Rate limited — too many requests. Wait a moment.`;
      } else if (status >= 500) {
        message = `❌ ${status} Server error from ${this.settings.provider}. Try again later.`;
      } else if (error?.message?.includes('timeout') || error?.message?.includes('TIMEOUT')) {
        message = `❌ Timed out after ${latencyMs}ms — is the endpoint reachable?`;
      } else {
        message = `❌ ${error?.message ?? 'Unknown error'} (after ${latencyMs}ms)`;
      }
      return { success: false, message };
    }
  }

  /**
   * v3.6.0: Probe Mistral models from smallest to largest, return the first
   * that responds successfully. Updates settings.modelName on success.
   *
   * Model order (smallest → goal → not recommended):
   *   ministral-8b-latest → ministral-14b-latest → mistral-small-latest (✅ goal)
   *   → mistral-medium-latest → mistral-large-latest (⚠️ not recommended — expensive)
   *
   * Returns { success, model, message }
   */
  async findWorkingMistralModel() {
    const MISTRAL_MODELS_SMALLEST_FIRST = [
      "ministral-8b-latest",
      "ministral-14b-latest",
      "mistral-small-latest",    // ← goal: best balance of quality and cost
      "mistral-medium-latest",
      "mistral-large-latest",    // ← not recommended: very expensive
    ];

    const hasKey = !!this.settings.openaiApiKey;
    if (!hasKey) {
      return { success: false, model: null, message: "No API key set. Add your Mistral key first." };
    }

    const headers = { "Content-Type": "application/json", "Authorization": `Bearer ${this.settings.openaiApiKey}` };
    const baseUrl = (this.settings.openaiEndpoint || "https://api.mistral.ai/v1").trim().replace(/\/+$/, '');
    const url = `${baseUrl}/chat/completions`;

    for (const model of MISTRAL_MODELS_SMALLEST_FIRST) {
      this.logger.debug("NoteGenerator", `findWorkingModel: trying "${model}"…`);
      try {
        const t0 = performance.now();
        const response = await (0, import_obsidian.requestUrl)({
          url,
          method: "POST",
          headers,
          timeout: 15000,
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: "Reply with exactly: OK" }],
            max_tokens: 10,
          }),
        });
        const latencyMs = Math.round(performance.now() - t0);
        const text = response.json?.choices?.[0]?.message?.content;
        if (text) {
          this.logger.info("NoteGenerator", `findWorkingModel: "${model}" works (${latencyMs}ms) — setting as active model`);
          return { success: true, model, message: `✅ Best working model: ${model} (${latencyMs}ms). Applied to settings.` };
        }
      } catch (err) {
        const status = err?.status;
        // 401 means key is wrong — no point trying other models
        if (status === 401) {
          return { success: false, model: null, message: "❌ 401 Unauthorized — check your API key." };
        }
        // 404 means this model isn't available on this account/plan — try next
        this.logger.debug("NoteGenerator", `findWorkingModel: "${model}" failed (${status ?? err?.message}), trying next…`);
      }
    }

    return { success: false, model: null, message: "❌ No working Mistral model found. Check your API key and account plan." };
  }

  async generateTags(term, contextData) {
    const tags = new Set();
    for (const file of contextData.sourceFiles) {
      const category = this.categoryManager.assignCategory(file);
      for (const tag of category.tags) tags.add(tag);

      const metadata = this.app.metadataCache.getFileCache(file);
      const fileTags = (0, import_obsidian.getAllTags)(metadata) || [];
      for (const tag of fileTags) tags.add(tag.replace('#', ''));
    }
    return Array.from(tags).slice(0, this.settings.maxTags);
  }

  async getRelatedConcepts(term, context) {
    const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
    const concepts = new Set();
    let match;
    while ((match = wikiLinkPattern.exec(context)) !== null) {
      const concept = match[1];
      if (concept !== term && concept.length >= 3) concepts.add(concept);
    }
    return Array.from(concepts).slice(0, this.settings.maxRelatedConcepts);
  }
}

// ============================================================================
// MAIN PLUGIN CLASS
// ============================================================================

var WikiVaultUnifiedPlugin = class extends import_obsidian.Plugin {
  async onload() {
    console.log("Vault Wiki: Loading…");

    // 🛡️ SENTINEL: Wrap entire onload in try-catch so a startup error shows
    // a user-friendly Notice instead of silently crashing the plugin.
    try {
      await this.loadSettings();

      // ── Initialize logger first so everything else can use it ────────────────
      this.logger = new WikiVaultLogger(this.app, this.settings);

      // ── Initialize components ────────────────────────────────────────────────
      this.termCache = new TermCache(this.app, this.settings, this.logger);
      this.categoryManager = new CategoryManager(this.app, this.settings, this.logger);
      this.generator = new NoteGenerator(this.app, this.settings, this.termCache, this.categoryManager, this.logger);

      // 🎨 PALETTE: Status bar chip — gives persistent at-a-glance plugin state
      // without interrupting the user with notices.
      this.statusBarItem = this.addStatusBarItem();
      // 🎨 PALETTE: Add title tooltip + role for accessibility (keyboard navigation + screen readers)
      this.statusBarItem.title = "Vault Wiki — click to open settings";
      this.statusBarItem.setAttribute("aria-label", "Vault Wiki status");
      this.statusBarItem.style.cursor = "pointer";
      this.statusBarItem.addEventListener("click", () => {
        // Open the plugin settings when user clicks the status bar chip
        (this.app).setting?.open?.();
        (this.app).setting?.openTabById?.("vault-wiki");
      });
      this._setStatus('⏳ Vault Wiki: Indexing…');

      // ⚡ BOLT: Defer index build until Obsidian's layout is ready.
      // Before: buildIndex() ran synchronously during plugin load, blocking UI.
      // After: UI renders first, then index builds non-blockingly via async.
      this.app.workspace.onLayoutReady(async () => {
        await this.termCache.buildIndex();
        const termCount = this.termCache.termIndex.size;
        const hwMode = detectHardwareMode(this.settings);
        const hwSuffix = this.settings.showHardwareModeInStatus ? ` · ${hardwareModeLabel(hwMode)}` : "";
        this._setStatus(`📖 Vault Wiki: ${termCount} terms${hwSuffix}`);
        this.logger.info("Plugin", `Index ready — ${termCount} terms indexed`, { hwMode });
        // 🎨 PALETTE: Brief startup notice only when terms were actually found,
        // so the user knows the plugin is active without being intrusive.
        if (termCount > 0) {
          new import_obsidian.Notice(`Vault Wiki: Ready — ${termCount} terms indexed`, 4000);
        }
      });

      // ── Commands & UI ────────────────────────────────────────────────────────
      this.addRibbonIcon("book-open", "Vault Wiki: Generate Notes", () => {
        this.generateWikiNotes();
      });

      this.addCommand({
        id: "generate-wiki-notes",
        name: "Generate missing wiki notes",
        callback: () => this.generateWikiNotes(),
      });

      this.addCommand({
        id: "refresh-term-cache",
        name: "Refresh term cache",
        callback: async () => {
          await this.termCache.buildIndex();
          new import_obsidian.Notice("Vault Wiki: Term cache refreshed!");
          this.logger.info("Plugin", "Term cache manually rebuilt via command");
        },
      });

      // ⚡ BOLT: Pause / Resume / Cancel commands for generation
      this.addCommand({
        id: "pause-generation",
        name: "Pause wiki generation",
        callback: () => {
          this.generator.pause();
          new import_obsidian.Notice("Vault Wiki: Generation PAUSED. Use 'Resume' to continue.");
          this.logger.info("Plugin", "Generation paused by user");
        },
      });

      this.addCommand({
        id: "resume-generation",
        name: "Resume wiki generation",
        callback: () => {
          this.generator.resume();
          new import_obsidian.Notice("Vault Wiki: Generation RESUMED.");
          this.logger.info("Plugin", "Generation resumed by user");
        },
      });

      this.addCommand({
        id: "cancel-generation",
        name: "Cancel wiki generation",
        callback: () => {
          this.generator.cancel();
          new import_obsidian.Notice("Vault Wiki: Generation CANCELLED.");
          this.logger.info("Plugin", "Generation cancelled by user");
        },
      });

      this.addCommand({
        id: "open-latest-log",
        name: "Open latest log file",
        callback: () => this.openLatestLog(),
      });

      this.addCommand({
        id: "flush-log",
        name: "Flush log to vault now",
        callback: async () => {
          await this.logger._flush();
          new import_obsidian.Notice("Vault Wiki: Log flushed!");
        },
      });

      this.addSettingTab(new WikiVaultSettingTab(this.app, this));

      // ── Auto-run on startup ──────────────────────────────────────────────────
      if (this.settings.runOnStartup) {
        this.app.workspace.onLayoutReady(() => {
          this.logger.info("Plugin", "runOnStartup triggered");
          this.generateWikiNotes();
        });
      }

      // ⚡ BOLT: Debounced file-switch generation (5s cooldown).
      // Before: every file switch immediately triggered full generation → UI freeze.
      // After: rapid navigation is batched into a single debounced call.
      const debouncedGenerate = debounce(() => {
        this.generateWikiNotes();
      }, 5000);

      this.registerEvent(
        this.app.workspace.on("file-open", (file) => {
          if (this.settings.runOnFileSwitch && file) {
            this.logger.debug("Plugin", `runOnFileSwitch: debounced trigger by ${file.path}`);
            debouncedGenerate();
          }
        })
      );

      // ── Cache refresh on file modify (debounced — avoids thrashing on rapid saves) ──
      const debouncedRefresh = debounce(() => {
        this.termCache.refresh();
      }, 2000);

      this.registerEvent(
        this.app.vault.on("modify", (file) => {
          if (file instanceof import_obsidian.TFile) {
            debouncedRefresh();
          }
        })
      );

      this.logger.markSessionStart();
      this.logger.info("Plugin", "Vault Wiki loaded successfully");
      console.log("Vault Wiki: Loaded successfully!");
    } catch (err) {
      // 🛡️ SENTINEL: Graceful startup failure — show a user-friendly error
      // instead of silently crashing. The user can still access Settings to
      // fix their configuration (e.g., bad API key, missing folder).
      console.error("Vault Wiki: Fatal startup error", err);
      new import_obsidian.Notice(
        `Vault Wiki failed to load: ${err?.message ?? String(err)}. `
        + `Check the developer console for details.`,
        10000
      );
    }
  }

  async generateWikiNotes() {
    this.logger.info("Plugin", "generateWikiNotes invoked");
    this._setStatus('⚙️ Vault Wiki: Generating…');
    // Reset per-session warning flags so errors surface again on a fresh run
    if (this.generator) {
      this.generator._shownNoKeyWarning = false;
      this.generator._shownEndpointWarning = false;
      this.generator._shownAIError = false;
      this.generator._shownShapeWarning = false;
    }
    await this.termCache.refresh();
    await this.generator.generateAll();
    const termCount = this.termCache.termIndex.size;
    const hwMode = detectHardwareMode(this.settings);
    const hwSuffix = this.settings.showHardwareModeInStatus ? ` · ${hardwareModeLabel(hwMode)}` : "";
    this._setStatus(`📖 Vault Wiki: ${termCount} terms${hwSuffix}`);
  }

  /** Test the configured AI connection and surface the result as a Notice. */
  async testAIConnection() {
    new import_obsidian.Notice("Vault Wiki: Testing AI connection…", 3000);
    const result = await this.generator.testAIConnection();
    new import_obsidian.Notice(`Vault Wiki: ${result.message}`, result.success ? 6000 : 10000);
    this.logger.info("Plugin", "AI connection test", result);
    return result;
  }

  /**
   * v3.5.0: Auto-probe Mistral models smallest-first, apply the first working one.
   */
  async findWorkingMistralModel() {
    new import_obsidian.Notice("Vault Wiki: Scanning Mistral models (smallest first)…", 3000);
    const result = await this.generator.findWorkingMistralModel();
    if (result.success && result.model) {
      this.settings.modelName = result.model;
      await this.saveSettings();
    }
    new import_obsidian.Notice(`Vault Wiki: ${result.message}`, result.success ? 8000 : 10000);
    this.logger.info("Plugin", "findWorkingMistralModel", result);
    return result;
  }

  /** 🎨 PALETTE: Update the persistent status bar chip with current plugin state. */
  _setStatus(text) {
    if (this.statusBarItem) this.statusBarItem.setText(text);
  }

  /** Opens the most recently modified log file in the workspace. */
  async openLatestLog() {
    try {
      const logDir = this.settings.logDirectory || "VaultWiki/Logs";
      const folder = this.app.vault.getAbstractFileByPath(logDir);
      if (!(folder instanceof import_obsidian.TFolder) || folder.children.length === 0) {
        new import_obsidian.Notice("Vault Wiki: No log files found yet.");
        return;
      }
      const logs = folder.children
        .filter(f => f instanceof import_obsidian.TFile && f.name.startsWith("session-"))
        .sort((a, b) => b.stat.mtime - a.stat.mtime);
      if (logs.length === 0) {
        new import_obsidian.Notice("Vault Wiki: No log files found yet.");
        return;
      }
      await this.app.workspace.getLeaf(false).openFile(logs[0]);
    } catch (err) {
      this.logger.error("Plugin", "Failed to open latest log", err);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  // ⚡ BOLT: Removed full reindex on every settings save.
  // Before: changing log level triggered a full index rebuild.
  // After: index auto-refreshes via the file-modify debounce listener.
  // Use "Refresh term cache" command for manual full rebuild.
  async saveSettings() {
    await this.saveData(this.settings);
    if (this.logger) {
      this.logger.settings = this.settings;
      this.logger.info("Plugin", "Settings saved and applied");
    }
    // ⚡ BOLT v3.5.2: Rebuild pre-computed lookup maps when settings change
    // (synonyms or categories may have been edited).
    if (this.termCache) this.termCache._buildReverseSynonyms();
    if (this.categoryManager) this.categoryManager._buildCategoryMap();
  }

  onunload() {
    this.logger?.info("Plugin", "Vault Wiki unloading");
    // Best-effort synchronous console notice; async flush not possible here
    console.log("Vault Wiki: Unloading…");
  }
};

// ============================================================================
// SETTINGS TAB
// ============================================================================

var WikiVaultSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h1", { text: "Vault Wiki Settings" });
    containerEl.createEl("p", {
      text: "AI-powered wiki generation for Obsidian. By adhdboy411 & Claude.",
      cls: "setting-item-description",
    });
    containerEl.createEl("p", {
      text: "by adhdboy411 and Claude · v3.6.0",
      attr: { style: "color: var(--text-muted); margin-top: -0.5em; font-size: 0.85em;" }
    });

    // 🎨 PALETTE: What's New callout for v3.6.0 — visible but not intrusive
    const whatsNewEl = containerEl.createEl("div", {
      attr: {
        style: [
          "background: var(--background-modifier-hover, rgba(120,80,255,0.07));",
          "border-left: 3px solid var(--interactive-accent, #7c3aed);",
          "border-radius: 4px; padding: 0.6em 0.9em; margin: 0.5em 0 1em 0;",
          "font-size: 0.82em; color: var(--text-muted);"
        ].join(" ")
      }
    });
    whatsNewEl.innerHTML = [
      "<strong>✨ New in v3.6.0</strong> &nbsp;",
      "🆕 <b>LM Studio Native v1 API</b> — stateful chats, SSE streaming, response_id continuity.",
      " &nbsp;|&nbsp; ",
      "⚙️ <b>Hardware Modes</b> — CPU 💻, GPU 🖥️, Android 📱, iOS 🍎 — auto-detected & tunable.",
      " &nbsp;|&nbsp; ",
      "🛡️ Null-byte path guard + 200-char term length cap.",
      " &nbsp;|&nbsp; ",
      "🎨 Clickable status bar chip with ARIA label."
    ].join("");

    // 🎨 PALETTE: Show live index status at the top of settings so users know
    // whether the term index is ready before running generation.
    const termCount = this.plugin.termCache?.termIndex?.size ?? 0;
    const statusEl = containerEl.createEl("p", {
      attr: { style: "color: var(--text-muted); font-size: 0.85em; margin-bottom: 1em;" }
    });
    statusEl.setText(termCount > 0
      ? `✅ Index ready — ${termCount} terms indexed.`
      : `⏳ Index building… (or no linked terms found)`
    );

    // ── Generation Controls ───────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Generation Controls" });

    const genStatusEl = containerEl.createEl("p", {
      attr: { style: "font-size: 0.85em; color: var(--text-muted); margin: 0 0 0.5em 0;" }
    });
    const updateGenStatus = () => {
      const gen = this.plugin.generator;
      if (!gen) { genStatusEl.setText("⏳ Generator not ready"); return; }
      genStatusEl.setText(gen.isPaused ? "⏸ Status: PAUSED" : "▶ Status: Running / idle");
    };
    updateGenStatus();

    const controlSetting = new import_obsidian.Setting(containerEl)
      .setName("Pause / Resume / Cancel")
      .setDesc("Control the currently running generation. Pause stops between batches (safe), cancel stops entirely.");
    controlSetting.addButton(btn => btn
      .setButtonText("⏸ Pause")
      .onClick(() => {
        this.plugin.generator?.pause();
        new import_obsidian.Notice("Vault Wiki: Generation paused.");
        updateGenStatus();
      }));
    controlSetting.addButton(btn => btn
      .setButtonText("▶ Resume")
      .setCta()
      .onClick(() => {
        this.plugin.generator?.resume();
        new import_obsidian.Notice("Vault Wiki: Generation resumed.");
        updateGenStatus();
      }));
    controlSetting.addButton(btn => btn
      .setButtonText("⏹ Cancel")
      .setWarning()
      .onClick(() => {
        this.plugin.generator?.cancel();
        new import_obsidian.Notice("Vault Wiki: Generation cancelled.");
        updateGenStatus();
      }));

    new import_obsidian.Setting(containerEl)
      .setName("Run Generation Now")
      .setDesc("Start a generation pass immediately (same as the ribbon button).")
      .addButton(btn => btn
        .setButtonText("▶ Generate Wiki Notes")
        .setCta()
        .onClick(() => this.plugin.generateWikiNotes()));

    new import_obsidian.Setting(containerEl)
      .setName("Reindex Everything")
      .setDesc("Force a full rebuild of the term index from scratch. Use this if virtual links look stale, you've renamed/moved many notes, or just added a lot of new [[wikilinks]].")
      .addButton(btn => {
        btn.setButtonText("🔄 Reindex Now")
          .onClick(async () => {
            btn.setButtonText("Indexing…");
            btn.setDisabled(true);
            try {
              await this.plugin.termCache.buildIndex();
              const count = this.plugin.termCache.termIndex.size;
              this.plugin._setStatus(`📖 Vault Wiki: ${count} terms`);
              new import_obsidian.Notice(`Vault Wiki: Reindex complete — ${count} terms indexed.`, 5000);
              // Refresh the index status line at the top of settings
              this.display();
            } finally {
              btn.setButtonText("🔄 Reindex Now");
              btn.setDisabled(false);
            }
          });
      });

    // v3.5.0: Auto-update existing wiki notes
    new import_obsidian.Setting(containerEl)
      .setName("Auto-Update Existing Notes")
      .setDesc(
        "During each generation pass, also re-generate existing wiki notes whose source notes have been modified, "
        + "or that are missing an AI summary. Recommended: ON."
      )
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoUpdateExistingNotes ?? true)
        .onChange(async (value) => {
          this.plugin.settings.autoUpdateExistingNotes = value;
          await this.plugin.saveSettings();
        }));

    // ── AI Provider ──────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "AI Provider" });

    new import_obsidian.Setting(containerEl)
      .setName("Provider")
      .setDesc("AI service provider. Use 'LM Studio (Native v1 API)' for stateful chats, SSE streaming, and hardware-mode optimization.")
      .addDropdown(dropdown => dropdown
        .addOption("mistral", "Mistral AI")
        .addOption("openai", "OpenAI")
        .addOption("lmstudio-openai", "LM Studio (OpenAI Compatible)")
        .addOption("lmstudio-v1", "LM Studio (Native v1 API — stateful + streaming)")
        .addOption("custom", "Custom")
        .setValue(this.plugin.settings.provider)
        .onChange(async (value) => {
          this.plugin.settings.provider = value;

          // Auto-fill sensible defaults when switching providers if the user hasn't heavily customized them
          const currentEndpoint = this.plugin.settings.openaiEndpoint;
          const isDefaultEndpoint = currentEndpoint === "https://api.mistral.ai/v1" || currentEndpoint === "https://api.openai.com/v1" || currentEndpoint === "http://localhost:1234/v1" || currentEndpoint === "";

          if (isDefaultEndpoint) {
            if (value === "openai") {
              this.plugin.settings.openaiEndpoint = "https://api.openai.com/v1";
              this.plugin.settings.modelName = "gpt-4o-mini";
            } else if (value === "mistral") {
              this.plugin.settings.openaiEndpoint = "https://api.mistral.ai/v1";
              this.plugin.settings.modelName = "mistral-small-latest";
            } else if (value === "lmstudio-openai") {
              this.plugin.settings.openaiEndpoint = "http://localhost:1234/v1";
              this.plugin.settings.modelName = "lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF";
            } else if (value === "lmstudio-v1") {
              this.plugin.settings.lmstudioV1Endpoint = "http://localhost:1234";
              this.plugin.settings.modelName = "lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF";
            }
          }

          await this.plugin.saveSettings();
          this.display();
        }));

    // ── LM Studio Native v1 API Settings (shown only for lmstudio-v1 provider) ──
    const isV1 = this.plugin.settings.provider === "lmstudio-v1";
    if (isV1) {
      const hwMode = detectHardwareMode(this.plugin.settings);
      const hwLabel = hardwareModeLabel(hwMode);
      containerEl.createEl("div", {
        attr: {
          style: "background: var(--background-modifier-success-hover, rgba(0,200,100,0.1)); border: 1px solid var(--color-green, #4caf50); border-radius: 6px; padding: 0.75em 1em; margin: 0.5em 0 0.75em 0; font-size: 0.85em;"
        }
      }).setText(`🆕 LM Studio Native v1 API — Stateful conversations, SSE streaming. Detected hardware: ${hwLabel}`);

      new import_obsidian.Setting(containerEl)
        .setName("LM Studio v1 Endpoint")
        .setDesc("Base URL for LM Studio (default: http://localhost:1234). Do not add /api/v1 — the plugin handles the path.")
        .addText(text => {
          text.inputEl.placeholder = "http://localhost:1234";
          text.setValue(this.plugin.settings.lmstudioV1Endpoint || "http://localhost:1234")
            .onChange(async (value) => {
              this.plugin.settings.lmstudioV1Endpoint = value.trim().replace(/\/+$/, "");
              await this.plugin.saveSettings();
            });
        });

      new import_obsidian.Setting(containerEl)
        .setName("LM Studio API Token")
        .setDesc("Optional Bearer token. Set this in LM Studio → Developer → API Token if you enabled authentication.")
        .addText(text => {
          // 🛡️ SENTINEL: Render as password field to prevent shoulder-surfing
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
          text.inputEl.placeholder = "(leave blank if no auth)";
          text.setValue(this.plugin.settings.lmstudioV1ApiToken || "")
            .onChange(async (value) => {
              this.plugin.settings.lmstudioV1ApiToken = value;
              await this.plugin.saveSettings();
            });
        });

      new import_obsidian.Setting(containerEl)
        .setName("Stateful Conversations")
        .setDesc("Keep conversation context across requests using response_id. Saves tokens and enables context continuity. Disable for stateless one-shot requests (store: false).")
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.lmstudioV1Stateful !== false)
          .onChange(async (value) => {
            this.plugin.settings.lmstudioV1Stateful = value;
            // Reset any stale thread IDs when toggling stateful mode
            this.plugin.settings.lmstudioV1LastResponseId = null;
            await this.plugin.saveSettings();
          }));

      new import_obsidian.Setting(containerEl)
        .setName("SSE Streaming")
        .setDesc("Use Server-Sent Events streaming for faster perceived response. Collects message.delta events in real time. Disable if you encounter stream parsing issues.")
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.lmstudioV1StreamingEnabled !== false)
          .onChange(async (value) => {
            this.plugin.settings.lmstudioV1StreamingEnabled = value;
            await this.plugin.saveSettings();
          }));

      new import_obsidian.Setting(containerEl)
        .setName("Reset Conversation Thread")
        .setDesc("Clear the stored response_id to start a fresh stateful conversation on next generation.")
        .addButton(btn => btn
          .setButtonText("🔄 Reset Thread")
          .onClick(async () => {
            this.plugin.settings.lmstudioV1LastResponseId = null;
            this.plugin.generator?._lmstudioV1?.resetThread();
            await this.plugin.saveSettings();
            new import_obsidian.Notice("Vault Wiki: LM Studio thread reset — next request starts fresh.", 4000);
          }));
    }

    // ── Hardware Mode (shown for LM Studio providers) ──────────────────────────
    const isLMStudio = this.plugin.settings.provider === "lmstudio-v1" || this.plugin.settings.provider === "lmstudio-openai";
    if (isLMStudio) {
      containerEl.createEl("h3", { text: "Hardware Optimization Mode" });
      containerEl.createEl("p", {
        attr: { style: "font-size: 0.82em; color: var(--text-muted); margin: -0.25em 0 0.75em 0;" }
      }).setText(
        "Tunes model parameters (context length, GPU layers, batch size, threads) for your device. "
        + "Auto-detected from your platform — override if needed."
      );

      const currentAutoMode = detectHardwareMode({ ...this.plugin.settings, hardwareMode: "auto" });
      const autoLabel = `Auto (detected: ${hardwareModeLabel(currentAutoMode)})`;

      new import_obsidian.Setting(containerEl)
        .setName("Hardware Mode")
        .setDesc(
          "CPU: Integrated GPU / laptop — small models, no GPU layers, minimal RAM. "
          + "GPU: Discrete GPU / desktop — large models, full GPU offload. "
          + "Android: ARM NPU/Vulkan — Q4_0 models, low context. "
          + "iOS: Apple Neural Engine/Metal — INT4 CoreML models, medium context."
        )
        .addDropdown(dropdown => dropdown
          .addOption("auto", autoLabel)
          .addOption("cpu", "💻 CPU / Integrated GPU (laptop)")
          .addOption("gpu", "🖥️ Discrete GPU (desktop/workstation)")
          .addOption("android", "📱 Android (NPU/Vulkan)")
          .addOption("ios", "🍎 iPhone/iPad (Neural Engine/Metal)")
          .setValue(this.plugin.settings.hardwareMode || "auto")
          .onChange(async (value) => {
            this.plugin.settings.hardwareMode = value;
            await this.plugin.saveSettings();
            const resolved = detectHardwareMode(this.plugin.settings);
            new import_obsidian.Notice(`Vault Wiki: Hardware mode → ${hardwareModeLabel(resolved)}`, 3000);
          }));

      new import_obsidian.Setting(containerEl)
        .setName("Show Hardware Mode in Status Bar")
        .setDesc("Display the active hardware mode chip in the Obsidian status bar (e.g. 🖥️ GPU).")
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.showHardwareModeInStatus !== false)
          .onChange(async (value) => {
            this.plugin.settings.showHardwareModeInStatus = value;
            await this.plugin.saveSettings();
          }));
    }

    // ── Standard endpoint/key settings (shown for non-v1 providers) ──────────
    if (!isV1) {
      new import_obsidian.Setting(containerEl)
        .setName("API Endpoint")
        .setDesc("API endpoint URL")
        .addText(text => {
          const endpoints = {
            mistral: "https://api.mistral.ai/v1",
            openai: "https://api.openai.com/v1",
            "lmstudio-openai": "http://localhost:1234/v1",
            custom: "https://your-custom-endpoint.com/v1"
          };
          text.inputEl.placeholder = endpoints[this.plugin.settings.provider] ?? "https://api.mistral.ai/v1";
          text.setValue(this.plugin.settings.openaiEndpoint)
            .onChange(async (value) => {
              this.plugin.settings.openaiEndpoint = value;
              await this.plugin.saveSettings();
            });
        });

      new import_obsidian.Setting(containerEl)
        .setName("API Key")
        .setDesc("Your API key")
        .addText(text => {
          // 🛡️ SENTINEL: Render as password field so the key isn't visible in plain
          // sight (prevents shoulder-surfing and screen-share leaks).
          text.inputEl.type = "password";
          text.inputEl.autocomplete = "off";
          text.setValue(this.plugin.settings.openaiApiKey)
            .onChange(async (value) => {
              this.plugin.settings.openaiApiKey = value;
              await this.plugin.saveSettings();
            });
        });
    }

    new import_obsidian.Setting(containerEl)
      .setName("Model Name")
      .setDesc("Model to use (e.g., mistral-medium-latest)")
      .addText(text => {
        // 🎨 PALETTE: Placeholder shows a valid example model name per-provider
        const providerExamples = {
          mistral: "mistral-small-latest",
          openai: "gpt-4o-mini",
          "lmstudio-openai": "lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF",
          "lmstudio-v1": "lmstudio-community/Meta-Llama-3-8B-Instruct-GGUF",
          custom: "your-model-name",
        };
        text.inputEl.placeholder = providerExamples[this.plugin.settings.provider] ?? "model-name";
        text.setValue(this.plugin.settings.modelName)
          .onChange(async (value) => {
            this.plugin.settings.modelName = value;
            await this.plugin.saveSettings();
            // Immediate feedback that the model will be used right away
            if (value.trim()) {
              new import_obsidian.Notice(`Vault Wiki: Model changed to "${value}" — active immediately.`, 3000);
            }
          });
      });

    // ── Test AI Connection ────────────────────────────────────────────────────
    const testResultEl = containerEl.createEl("p", {
      attr: { style: "font-size: 0.85em; margin: 0.25em 0 0.75em 1em; color: var(--text-muted);" }
    });
    testResultEl.setText("Click \"Test\" to verify your API key, endpoint, and model are working.");

    new import_obsidian.Setting(containerEl)
      .setName("Test AI Connection")
      .setDesc(`Makes a minimal test call to ${this.plugin.settings.openaiEndpoint} using model "${this.plugin.settings.modelName}". Safe — only sends "Reply with exactly: OK".`)
      .addButton(btn => {
        btn.setButtonText("🔌 Test Connection")
          .setCta()
          .onClick(async () => {
            btn.setButtonText("Testing…");
            btn.setDisabled(true);
            testResultEl.setText("⏳ Calling API…");
            testResultEl.style.color = "var(--text-muted)";
            try {
              const result = await this.plugin.testAIConnection();
              testResultEl.setText(result.message);
              testResultEl.style.color = result.success
                ? "var(--color-green, #4caf50)"
                : "var(--color-red, #e53935)";
            } finally {
              btn.setButtonText("🔌 Test Connection");
              btn.setDisabled(false);
            }
          });
      });

    // v3.5.0: Find Best Mistral Model — probe models smallest-first
    const findModelResultEl = containerEl.createEl("p", {
      attr: { style: "font-size: 0.85em; margin: 0.25em 0 0.75em 1em; color: var(--text-muted);" }
    });
    findModelResultEl.setText("Scans Mistral models from smallest to largest and sets the first one that works.");

    new import_obsidian.Setting(containerEl)
      .setName("Find Best Mistral Model")
      .setDesc("Tries ministral-8b-latest → ministral-14b-latest → mistral-small-latest (goal) → mistral-medium-latest → mistral-large-latest (not recommended). Picks the smallest working model and applies it automatically.")
      .addButton(btn => {
        btn.setButtonText("🔍 Find Best Model")
          .onClick(async () => {
            btn.setButtonText("Scanning…");
            btn.setDisabled(true);
            findModelResultEl.setText("⏳ Probing models…");
            findModelResultEl.style.color = "var(--text-muted)";
            try {
              const result = await this.plugin.findWorkingMistralModel();
              findModelResultEl.setText(result.message);
              findModelResultEl.style.color = result.success
                ? "var(--color-green, #4caf50)"
                : "var(--color-red, #e53935)";
              if (result.success) {
                // Refresh settings UI to show the newly applied model name
                this.display();
              }
            } finally {
              btn.setButtonText("🔍 Find Best Model");
              btn.setDisabled(false);
            }
          });
      });

    // ── Knowledge Sources ────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Knowledge Sources" });

    new import_obsidian.Setting(containerEl)
      .setName("Use Dictionary API")
      .setDesc("Fetch definitions from dictionary")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useDictionaryAPI)
        .onChange(async (value) => {
          this.plugin.settings.useDictionaryAPI = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Use Dictionary in AI Context")
      .setDesc("Pass dictionary definitions to AI")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useDictionaryInContext)
        .onChange(async (value) => {
          this.plugin.settings.useDictionaryInContext = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Use Wikipedia")
      .setDesc("Fetch Wikipedia links and excerpts")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useWikipedia)
        .onChange(async (value) => {
          this.plugin.settings.useWikipedia = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Use Wikipedia in AI Context")
      .setDesc("Pass Wikipedia content to AI")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useWikipediaInContext)
        .onChange(async (value) => {
          this.plugin.settings.useWikipediaInContext = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Glossary Base Path")
      .setDesc("Path to custom glossary file (e.g., Definitions.md)")
      .addText(text => {
        text.inputEl.placeholder = "Definitions.md";
        return text.setValue(this.plugin.settings.glossaryBasePath)
          .onChange(async (value) => {
            this.plugin.settings.glossaryBasePath = value;
            await this.plugin.saveSettings();
          });
      });

    // ── Generation Features ──────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Generation Features" });

    new import_obsidian.Setting(containerEl)
      .setName("Generate Tags")
      .setDesc("Auto-generate tags from context")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.generateTags)
        .onChange(async (value) => {
          this.plugin.settings.generateTags = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Max Tags")
      .setDesc("Maximum number of tags to generate")
      .addSlider(slider => slider
        .setLimits(1, 30, 1)
        .setValue(this.plugin.settings.maxTags)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxTags = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Tags Include # Prefix")
      .setDesc("Add # prefix to generated tags")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.tagsIncludeHashPrefix)
        .onChange(async (value) => {
          this.plugin.settings.tagsIncludeHashPrefix = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Generate Related Concepts")
      .setDesc("Auto-suggest related terms")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.generateRelatedConcepts)
        .onChange(async (value) => {
          this.plugin.settings.generateRelatedConcepts = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Max Related Concepts")
      .setDesc("Maximum number of related concepts")
      .addSlider(slider => slider
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.maxRelatedConcepts)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxRelatedConcepts = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Track Model")
      .setDesc("Record which AI model generated each note")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.trackModel)
        .onChange(async (value) => {
          this.plugin.settings.trackModel = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Use Priority Queue")
      .setDesc("Process frequently-mentioned terms first")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.usePriorityQueue)
        .onChange(async (value) => {
          this.plugin.settings.usePriorityQueue = value;
          await this.plugin.saveSettings();
        }));

    // ── Organization ─────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Organization" });

    new import_obsidian.Setting(containerEl)
      .setName("Use Custom Directory")
      .setDesc("Save wiki notes in specific folder")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useCustomDirectory)
        .onChange(async (value) => {
          this.plugin.settings.useCustomDirectory = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Directory Name")
      .setDesc("Folder for wiki notes")
      .addText(text => {
        text.inputEl.placeholder = "Wiki";
        return text.setValue(this.plugin.settings.customDirectoryName)
          .onChange(async (value) => {
            this.plugin.settings.customDirectoryName = value;
            await this.plugin.saveSettings();
          });
      });

    new import_obsidian.Setting(containerEl)
      .setName("Use Categories")
      .setDesc("Organize notes into subject-based subfolders")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useCategories)
        .onChange(async (value) => {
          this.plugin.settings.useCategories = value;
          await this.plugin.saveSettings();
        }));

    // ── Performance ──────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Performance" });

    new import_obsidian.Setting(containerEl)
      .setName("AI Context Max Chars")
      .setDesc(
        "Maximum characters of note context sent to the AI per term (after deduplication and markup stripping). "
        + "Fewer chars = faster, cheaper, and safer for smaller models like mistral-small-latest. "
        + "~20k chars ≈ 5k tokens. Raise for large-context models (GPT-4, mistral-large). Default: 20000."
      )
      .addSlider(slider => slider
        .setLimits(2000, 60000, 1000)
        .setValue(this.plugin.settings.aiContextMaxChars ?? 20000)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.aiContextMaxChars = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Context Depth")
      .setDesc("How much context to extract per note. Partial (recommended) is fast and accurate. Full includes virtual mentions but is slower. Performance is fastest but only extracts the link line.")
      .addDropdown(dropdown => dropdown
        .addOption("full", "Full — wikilinks + virtual mentions")
        .addOption("partial", "Partial — wikilinks only (recommended)")
        .addOption("performance", "Performance — link line only (fastest)")
        .setValue(this.plugin.settings.contextDepth)
        .onChange(async (value) => {
          this.plugin.settings.contextDepth = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Batch Size")
      .setDesc("Number of notes to process simultaneously")
      .addSlider(slider => slider
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.batchSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.batchSize = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Show Progress Notification")
      .setDesc("Display progress during generation")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showProgressNotification)
        .onChange(async (value) => {
          this.plugin.settings.showProgressNotification = value;
          await this.plugin.saveSettings();
        }));

    // ── Logging ──────────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Logging & Diagnostics" });

    new import_obsidian.Setting(containerEl)
      .setName("Enable Logging")
      .setDesc("Write session logs to your vault")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.enableLogging)
        .onChange(async (value) => {
          this.plugin.settings.enableLogging = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Log Level")
      .setDesc("Minimum severity to record (DEBUG logs everything; ERROR logs only failures)")
      .addDropdown(dropdown => dropdown
        .addOption("DEBUG", "DEBUG — verbose")
        .addOption("INFO", "INFO — normal")
        .addOption("WARN", "WARN — problems only")
        .addOption("ERROR", "ERROR — failures only")
        .setValue(this.plugin.settings.logLevel)
        .onChange(async (value) => {
          this.plugin.settings.logLevel = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Log Directory")
      .setDesc("Vault path for log files (default: VaultWiki/Logs)")
      .addText(text => {
        text.inputEl.placeholder = "VaultWiki/Logs";
        return text.setValue(this.plugin.settings.logDirectory)
          .onChange(async (value) => {
            this.plugin.settings.logDirectory = value;
            await this.plugin.saveSettings();
          });
      });

    new import_obsidian.Setting(containerEl)
      .setName("Max Log Age (days)")
      .setDesc("Log files older than this are automatically deleted")
      .addSlider(slider => slider
        .setLimits(1, 90, 1)
        .setValue(this.plugin.settings.maxLogAgeDays)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxLogAgeDays = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Open Latest Log")
      .setDesc("View the most recent session log in the editor")
      .addButton(btn => btn
        .setButtonText("Open Log")
        .onClick(() => this.plugin.openLatestLog()));

    // ── Term Matching ────────────────────────────────────────────────────────
    containerEl.createEl("h2", { text: "Term Matching" });

    new import_obsidian.Setting(containerEl)
      .setName("Min Word Length")
      .setDesc("Minimum characters for term matching")
      .addSlider(slider => slider
        .setLimits(2, 10, 1)
        .setValue(this.plugin.settings.minWordLengthForAutoDetect)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.minWordLengthForAutoDetect = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Max Words to Match")
      .setDesc("Check 1-word, 2-word, or 3-word combinations")
      .addSlider(slider => slider
        .setLimits(1, 5, 1)
        .setValue(this.plugin.settings.maxWordsToMatch)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxWordsToMatch = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Prefer Longer Matches")
      .setDesc("Prioritize multi-word matches (e.g., 'Smooth Muscle' over 'Smooth')")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.preferLongerMatches)
        .onChange(async (value) => {
          this.plugin.settings.preferLongerMatches = value;
          await this.plugin.saveSettings();
        }));

    new import_obsidian.Setting(containerEl)
      .setName("Match Whole Words Only")
      .setDesc("Prevent partial matches (recommended)")
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.matchWholeWordsOnly)
        .onChange(async (value) => {
          this.plugin.settings.matchWholeWordsOnly = value;
          await this.plugin.saveSettings();
        }));
  }
};
