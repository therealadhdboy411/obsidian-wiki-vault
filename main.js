/*
Vault Wiki — by adhdboy411 and Claude
v1.0.0 (Public Beta)

AI-powered wiki note generator for Obsidian.
Combines Virtual Linker rendering + Wiki note generation.

OPTIMISATION HISTORY (abbreviated — full notes in CHANGELOG.md):
  v1.0.0  🚀 PUBLIC BETA — no longer a dev/early beta
           ✅ New providers: Anthropic Claude, Groq, Ollama, OpenRouter, Together AI
           🛡️ SENTINEL × 5: key masking tightened, rate-limit guard, model name
               validation, HTTPS enforcement for cloud providers, safe wiki-dir
               exclusion hardened in every file-scan path
           ⚡ BOLT × 5: AbortController on streaming, early-exit on cancel,
               isCloud guard hoisted out of per-term loop, regex pre-compiled,
               wiki-file reads skipped in all scan paths
           🎨 PALETTE × 5: provider chip icons, model suggestions per provider,
               input type=password autocomplete=off on all key fields,
               streaming token counter in status bar, clearer empty-state copy
  v0.9.2  ⚡ BOLT × 10 passes:
           P1  Sequential dispatch for local AI — fixes LM Studio multi-instance bug
               (Promise.all → serial loop for lmstudio-v1/openai-compat providers)
           P2  detectHardwareMode() hoisted out of per-note path (was called 200×/pass)
           P3  extractContext filter() passes eliminated — incremental type counting
           P4  Settings reads (contextDepth, includeFullParagraphs) hoisted from mention loop
           P5  extractLinesN(n) — param-based variant, no settings read inside
           P6  System/user prompt strings cached once per pass (_resolvedSystemPrompt)
           P7  Endpoint strings trimmed once per pass, cleared after generation
           P8  Header comment compressed 18.7 KB → 1.9 KB (parsed on every load)
           P9  Small/Balanced/Detailed prompts rewritten — explicit output format,
               forbidden behaviours, task-first ordering for instruction-follow
           P10 Default prompts synced to balanced preset (detectPromptPreset now works)
           ⚡ hwMode/endpoint/prompt strings cached once per generation pass
           ⚡ extractLinesN: settings reads hoisted out of per-mention loop
           ⚡ filter() passes eliminated in extractContext type-counting
  v0.9.1  🗣️ Prompt presets (Small/Balanced/Detailed) with live token counts
  v0.9.0  ⚡ stripMarkupForAI(): 12-pass markup stripper, ~15–30% fewer tokens
           ⚡ Tighter default prompts (~60 fewer prompt tokens/call)
           🎨 Collapsible settings sections (Auto/Manual/Advanced modes)
           ⚡ Wiki notes excluded as source files from index (feedback loop fix)
  v3.8.0  ✅ AI Subcategories — auto subject-subfolder classification
  v3.6.3  ⚡ parts[] join pattern throughout; ~9.6 MB intermediate strings cut
           ⚡ getFileCache()+getAllTags() called once per file instead of twice
  v3.6.0  ✅ LM Studio native /api/v1/chat — stateful, SSE streaming
           ✅ Hardware optimization modes (CPU/GPU/Android/iOS)
  v3.5.2  ⚡ headingByLine[] O(1) lookup (was O(lineIndex) scan per mention)
           ⚡ Reverse synonym map pre-computed; O(1) lookup
           ⚡ wikiDirPrefix hoisted outside all hot loops
           ⚡ extractParagraph: single array allocation
  v3.5.1  ⚡ fileContentCache stores {content,lines,file} — no re-split per note
           ⚡ mentionIndex: O(1) has+get merged to single get
  v3.4.0  ⚡ rawContext paragraph deduplication (content-hash Set)
           ⚡ AI context markup stripping + hard cap
  v3.2.0  ⚡ extractContext() rebuilt O(mentions) from O(files × terms)
           ⚡ isLookupableTerm() pre-flight guard
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
  // Supported: mistral | openai | anthropic | groq | ollama | openrouter | together | lmstudio-openai | lmstudio-v1 | custom
  provider: "mistral",
  openaiEndpoint: "https://api.mistral.ai/v1",
  openaiApiKey: "",
  modelName: "mistral-medium-latest",
  apiType: "openai",

  // Anthropic-specific settings (non-OpenAI format)
  anthropicApiKey: "",
  anthropicVersion: "2023-06-01",

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

  // UI complexity mode — controls what the settings panel shows.
  // 'auto'     — Smart defaults. Only provider + directory shown; everything
  //              else computed from hardware + model size. Best for new users.
  // 'manual'   — All main settings visible. (Default for existing installs.)
  // 'advanced' — Everything, including logging, term matching internals, raw sliders.
  settingsMode: "auto",
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
  // ⚡ BOLT v0.9.2: Defaults exactly match PROMPT_PRESETS.balanced so that
  // detectPromptPreset() correctly identifies 'balanced' on a fresh install.
  // Changing these must be kept in sync with PROMPT_PRESETS.balanced above.
  systemPrompt: "Write accurate, well-structured wiki summaries in markdown.\nBold all key terms, concepts, and proper nouns with **double asterisks**.\nWrite in prose paragraphs. Begin immediately without any preamble.\nBase your answer only on the provided context.",
  userPromptTemplate: 'Summarize **{{term}}** based on the context below. Be thorough but concise. Bold every key term.\n\nContext:\n{{context}}\n\nSummary:',

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
      keywords: [],
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

  // ── AI Subcategory Classification ──────────────────────────────────────────
  // When enabled, each generated wiki note is assigned an AI-determined subcategory
  // folder within its main category. Main categories are still configured manually;
  // subcategories are inferred from the term's subject matter and clustered for
  // consistency (e.g. "Electrophysiology", "Muscle Physiology", "Cell Biology").
  aiSubcategoriesEnabled: false,
  // System prompt sent to the AI for subcategory classification.
  // Keep it terse — this call uses max_tokens: 20 to be as fast and cheap as possible.
  // Keep in sync with PROMPT_PRESETS.balanced.subcatSystem
  aiSubcategorySystemPrompt: "Return ONLY a subject subcategory name (2–4 words, Title Case).\nNo punctuation. No explanation. No sentence. Just the name.",
  // Max characters of context passed to the subcategory classifier.
  // Small by design — we only need enough signal to classify; full context wastes tokens.
  aiSubcategoryContextChars: 600,
};

// ============================================================================
// PROVIDER CONFIGURATION TABLE
// ============================================================================

/**
 * Canonical provider descriptors.
 *
 * Each entry defines:
 *   id           — internal identifier stored in settings.provider
 *   label        — display name (shown in Settings dropdown)
 *   emoji        — icon prefix in the dropdown
 *   defaultEndpoint — pre-filled endpoint URL (null = not applicable)
 *   defaultModel — sensible first-run model
 *   apiFormat    — "openai" | "anthropic" | "lmstudio-v1" | "gemini"
 *   requiresKey  — whether an API key is mandatory
 *   localOnly    — true if endpoint is always localhost (no HTTPS required)
 *   keyHeader    — HTTP header name used for the API key
 *   models       — suggested model IDs shown in the model picker dropdown
 */
const PROVIDERS = [
  {
    id: "mistral",
    label: "Mistral AI",
    emoji: "🌊",
    defaultEndpoint: "https://api.mistral.ai/v1",
    defaultModel: "mistral-small-latest",
    apiFormat: "openai",
    requiresKey: true,
    localOnly: false,
    keyHeader: "Authorization",
    models: [
      "mistral-small-latest",
      "mistral-medium-latest",
      "mistral-large-latest",
      "open-mistral-nemo",
      "open-mixtral-8x7b",
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    emoji: "🤖",
    defaultEndpoint: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    apiFormat: "openai",
    requiresKey: true,
    localOnly: false,
    keyHeader: "Authorization",
    models: [
      "gpt-4o-mini",
      "gpt-4o",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "o1-mini",
      "o3-mini",
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic Claude",
    emoji: "🔶",
    defaultEndpoint: "https://api.anthropic.com",
    defaultModel: "claude-3-5-haiku-20241022",
    apiFormat: "anthropic",
    requiresKey: true,
    localOnly: false,
    keyHeader: "x-api-key",
    models: [
      "claude-3-5-haiku-20241022",
      "claude-3-5-sonnet-20241022",
      "claude-3-opus-20240229",
      "claude-3-haiku-20240307",
    ],
  },
  {
    id: "groq",
    label: "Groq (fast inference)",
    emoji: "⚡",
    defaultEndpoint: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.1-8b-instant",
    apiFormat: "openai",
    requiresKey: true,
    localOnly: false,
    keyHeader: "Authorization",
    models: [
      "llama-3.1-8b-instant",
      "llama-3.3-70b-versatile",
      "llama3-8b-8192",
      "mixtral-8x7b-32768",
      "gemma2-9b-it",
    ],
  },
  {
    id: "ollama",
    label: "Ollama (local)",
    emoji: "🦙",
    defaultEndpoint: "http://localhost:11434/v1",
    defaultModel: "llama3.2",
    apiFormat: "openai",
    requiresKey: false,
    localOnly: true,
    keyHeader: "Authorization",
    models: [
      "llama3.2",
      "llama3.1",
      "qwen2.5",
      "mistral",
      "phi3",
      "gemma2",
      "deepseek-r1",
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    emoji: "🌐",
    defaultEndpoint: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.1-8b-instruct:free",
    apiFormat: "openai",
    requiresKey: true,
    localOnly: false,
    keyHeader: "Authorization",
    models: [
      "meta-llama/llama-3.1-8b-instruct:free",
      "mistralai/mistral-7b-instruct:free",
      "google/gemma-2-9b-it:free",
      "deepseek/deepseek-chat",
      "anthropic/claude-3-5-sonnet",
      "openai/gpt-4o-mini",
    ],
  },
  {
    id: "together",
    label: "Together AI",
    emoji: "🤝",
    defaultEndpoint: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
    apiFormat: "openai",
    requiresKey: true,
    localOnly: false,
    keyHeader: "Authorization",
    models: [
      "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      "meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo",
      "mistralai/Mixtral-8x7B-Instruct-v0.1",
      "Qwen/Qwen2.5-7B-Instruct-Turbo",
      "google/gemma-2-9b-it",
    ],
  },
  {
    id: "lmstudio-openai",
    label: "LM Studio — OpenAI compat",
    emoji: "🏠",
    defaultEndpoint: "http://localhost:1234/v1",
    defaultModel: null,   // filled by getDefaultModelForHardware()
    apiFormat: "openai",
    requiresKey: false,
    localOnly: true,
    keyHeader: "Authorization",
    models: [],
  },
  {
    id: "lmstudio-v1",
    label: "LM Studio — Native v1 ✨",
    emoji: "🏠",
    defaultEndpoint: "http://localhost:1234",
    defaultModel: null,
    apiFormat: "lmstudio-v1",
    requiresKey: false,
    localOnly: true,
    keyHeader: "Authorization",
    models: [],
  },
  {
    id: "custom",
    label: "Custom endpoint",
    emoji: "⚙️",
    defaultEndpoint: "",
    defaultModel: "",
    apiFormat: "openai",
    requiresKey: false,
    localOnly: false,
    keyHeader: "Authorization",
    models: [],
  },
];

/** Fast O(1) provider lookup by id. */
const PROVIDER_MAP = new Map(PROVIDERS.map(p => [p.id, p]));

/** Returns the descriptor for the configured provider (or "custom" as fallback). */
function getProviderConfig(settings) {
  return PROVIDER_MAP.get(settings.provider) ?? PROVIDER_MAP.get("custom");
}

/**
 * 🛡️ SENTINEL: Returns true if an API key is REQUIRED for the given provider
 * and none has been configured.
 */
function providerNeedsKey(settings) {
  const p = getProviderConfig(settings);
  if (!p.requiresKey) return false;
  // For Anthropic use the anthropic-specific key field
  if (settings.provider === "anthropic") return !settings.anthropicApiKey;
  return !settings.openaiApiKey;
}


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
    lines.push(`**Plugin version:** 3.8.0  `);
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
    const total = this.stats.generated + this.stats.failed + this.stats.skipped;
    const successRate = total > 0 ? ((this.stats.generated / total) * 100).toFixed(1) + "%" : "N/A";
    lines.push(`| Success rate | ${successRate} |`);
    lines.push(`| API calls | ${this.stats.apiCalls} |`);
    lines.push(`| API errors | ${this.stats.apiErrors} |`);
    lines.push(`| Cache hits | ${this.stats.cacheHits} |`);
    const warnCount = this.entries.filter(e => e.level === "WARN").length;
    const errCount  = this.entries.filter(e => e.level === "ERROR").length;
    lines.push(`| Warnings logged | ${warnCount} |`);
    lines.push(`| Errors logged | ${errCount} |`);
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
            this.info("Logger", `Pruned old log: ${child.path}`);
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
// ⚡ BOLT v0.9.0 — CENTRAL AI PAYLOAD COMPRESSOR
// ============================================================================

/**
 * stripMarkupForAI(text, maxChars?)
 *
 * Strips all Obsidian-specific and Markdown formatting that wastes tokens
 * when sent to AI models. Applied to EVERY AI payload — both the main note
 * context and the subcategory classifier snippet.
 *
 * Passes (each is a single O(n) regex):
 *   1. YAML frontmatter blocks (--- ... ---)
 *   2. Obsidian callout headers (> [!note] Title)
 *   3. Wikilink aliases  [[Page|Label]] → Label
 *   4. Plain wikilinks   [[Page]]       → Page  (strips #section anchors)
 *   5. Highlights        ==text==       → text
 *   6. Hashtag-style inline tags  (#tagname, not # Heading)
 *   7. Bold / italic markers  (**text**, *text*, __text__)
 *   8. Heading hashes   (## Title → Title)
 *   9. Horizontal rules (---, ***, ===)
 *  10. HTML comments    (<!-- ... -->)
 *  11. Code fence delimiters (``` lines removed; code content kept)
 *  12. 3+ blank lines   → single blank line
 *
 * Then trims and hard-caps at maxChars (cutting at a paragraph boundary).
 *
 * ⚡ Impact: ~15–30% token reduction on typical academic notes.
 *   Main context (20 k chars): saves ~3–6 k chars = ~750–1,500 tokens per call.
 *   Subcategory snippet (600 chars): cleaner signal for classification.
 *
 * @param {string} text      Raw text that may contain Obsidian markup.
 * @param {number} [maxChars=0]  Hard character cap (0 = no cap).
 * @returns {string}
 */
function stripMarkupForAI(text, maxChars = 0) {
  if (!text) return '';
  let t = text
    .replace(/^---[\s\S]*?---\n?/gm, '')           // 1. YAML frontmatter
    .replace(/^>\s*\[![^\]]*\][^\n]*/gm, '')        // 2. Callout headers
    .replace(/\[\[[^\]|#]+\|([^\]]+)\]\]/g, '$1')   // 3. Wikilink aliases
    .replace(/\[\[([^\]|#]+?)(?:#[^\]]+)?\]\]/g, '$1') // 4. Plain wikilinks
    .replace(/==([^=]+)==/g, '$1')                   // 5. Highlights
    .replace(/(?<!\w)#([A-Za-z]\w*)/g, '$1')       // 6. Inline tags
    .replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1')     // 7a. Bold/italic *
    .replace(/_{1,2}([^_\n]+)_{1,2}/g, '$1')         // 7b. Bold/italic _
    .replace(/^#{1,6}\s+/gm, '')                     // 8. Heading hashes
    .replace(/^[-*=]{3,}\s*$/gm, '')                 // 9. Horizontal rules
    .replace(/<!--[\s\S]*?-->/g, '')                 // 10. HTML comments
    .replace(/^\`\`\`[^\n]*$/gm, '')               // 11. Code fence delimiters
    .replace(/\n{3,}/g, '\n\n')                     // 12. Collapse blank lines
    .trim();

  if (maxChars > 0 && t.length > maxChars) {
    const cut = t.lastIndexOf('\n\n', maxChars);
    t = t.slice(0, cut > maxChars * 0.5 ? cut : maxChars).trim();
  }
  return t;
}

// ============================================================================
// HARDWARE DETECTION & OPTIMIZATION MODES
// ============================================================================

/**
 * 🎨 PALETTE / ⚡ BOLT: Detect the best hardware optimization mode for LM Studio.
 *
 * Modes:
 *   "cpu"     — Integrated GPU / low-power laptop (e.g. AMD Ryzen 5 7520U, Intel N-series):
 *               Target chip: 4-core/8-thread Zen 3+ @ 2.8 GHz, Radeon 610M iGPU
 *               (2 CUs / ~512 MB shared VRAM — too small for LLM layers, so pure
 *               CPU inference via LPDDR5 ~38 GB/s memory bandwidth).
 *
 *               Default model: Qwen3.5-1.7B-Instruct Q4_K_M (~1.35 GB)
 *                 → 25–40 t/s estimated on this chip; outperforms Qwen2.5-3B on
 *                   most benchmarks despite half the parameters; fits in 8 GB RAM
 *                   alongside Obsidian + OS overhead with room to spare.
 *               Quality upgrade (16 GB RAM): Qwen3.5-4B-Instruct Q4_K_M (~2.2 GB)
 *                 → 10–18 t/s; best per-parameter quality in the Qwen3.5 small series.
 *               Balanced alternative: SmolLM3-3B Q4_K_M (~2.0 GB)
 *                 → HuggingFace SOTA at 3B scale; 128k context; strong reasoning;
 *                   slightly faster than Qwen3.5-4B on CPU due to fewer params.
 *
 *               context_length capped at 4096 to keep KV cache within budget on
 *               8 GB shared-RAM machines (adds ~256 MB overhead at 4096 ctx).
 *
 *   "gpu"     — Discrete GPU (desktop, workstation):
 *               Default model: Qwen3.5-9B-Instruct Q4_K_M.
 *               context up to 8192+.
 *   "android" — Android device: ARM NPU-optimized deployment.
 *               Default model: LFM2-1.2B Q4_K_M (Liquid edge-optimised, ~750 MB).
 *               context ≤ 1024.
 *   "ios"     — iPhone/iPad: Apple Neural Engine + Metal back-end.
 *               Default model: LFM2-1.2B Q4_K_M (~750 MB).
 *               context ≤ 2048.
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
  // 🛡️ v1 API FIX: /api/v1/chat only accepts context_length from this group.
  // gpu_offload and llm_config_override were v0/llama.cpp-internal fields that
  // the v1 endpoint does not recognise — sending them produces no effect and
  // clutters the request body with unrecognised keys.
  // Model-layer GPU config (n_gpu_layers, n_batch, n_threads) must be set at
  // model load time via /api/v1/models/load, not per-inference request.
  switch (mode) {
    case "cpu":
      // Qwen3.5-1.7B Q4_K_M: ~1.35 GB weights + ~256 MB KV cache @ 4096 ctx.
      // On Ryzen 5 7520U (4-core Zen 3+ @ 2.8 GHz, LPDDR5 ~38 GB/s):
      //   estimated 25–40 t/s — snappy for interactive use and batch generation.
      // Fits within 8 GB shared RAM (6–7 GB available after OS + Obsidian).
      return { context_length: 4096 };
    case "gpu":
      return { context_length: 8192 };
    case "android":
      return { context_length: 1024 };
    case "ios":
      return { context_length: 2048 };
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

/**
 * Returns the recommended LM Studio model ID for each hardware mode.
 *
 * ── CPU (integrated GPU / low-power laptop — primary target: AMD Ryzen 5 7520U) ─
 *
 *   Chip profile:
 *     - 4 cores / 8 threads, Zen 3+ architecture, 2.80 GHz base
 *     - Radeon 610M iGPU: 2 compute units RDNA2, ~512 MB shared VRAM
 *       → iGPU VRAM is far too small to offload LLM layers; all inference
 *         runs via CPU + system RAM (LPDDR5, ~38 GB/s bandwidth)
 *     - Memory bandwidth is the throughput bottleneck for LLM inference,
 *       not compute. Smaller model = higher MB/s utilisation = faster t/s.
 *
 *   ✅ Default: lmstudio-community/Qwen3.5-1.7B-Instruct-GGUF  (Q4_K_M)
 *     - ~1.35 GB GGUF; estimated 25–40 t/s on Ryzen 5 7520U
 *     - Qwen3.5 series: Alibaba's latest small-model line, Scaled-RL trained
 *     - 1.7B outperforms Qwen2.5-3B on most benchmarks (per Qwen3 tech report)
 *     - Fits on 8 GB RAM machines with Obsidian + OS overhead
 *     - Non-thinking mode (/no_think) keeps responses tight for wiki notes
 *     - 32k context window; Q4_K_M is near-lossless for prose generation
 *
 *   🔼 Quality upgrade (16 GB RAM): lmstudio-community/Qwen3.5-4B-Instruct-GGUF
 *     - ~2.2 GB; 10–18 t/s on this chip — usable but noticeably slower
 *     - Best per-param quality in the Qwen3.5 small series for knowledge tasks
 *     - Recommended if generating notes in large batches overnight
 *
 *   ⚡ Speed alternative: lmstudio-community/SmolLM3-3B-GGUF  (Q4_K_M)
 *     - ~2.0 GB; HuggingFace SOTA at 3B–4B scale (July 2025)
 *     - 128k context (YARN), trained on 11.2T tokens, strong reasoning
 *     - Slightly faster than Qwen3.5-4B on CPU due to lower param count
 *     - Fully open weights + training details (Apache 2.0)
 *     - Good choice if you want long-context retrieval alongside wiki gen
 *
 * ── GPU (discrete GPU / workstation) ──────────────────────────────────────────
 *   lmstudio-community/Qwen3.5-9B-Instruct-GGUF
 *     - Flagship of the Qwen3.5 small series; closes gap on 30B+ models
 *
 * ── Android / iOS ─────────────────────────────────────────────────────────────
 *   lmstudio-community/LFM2-1.2B-GGUF
 *     - Liquid AI edge-optimised hybrid; ~750 MB; designed for mobile/NPU
 */
function getDefaultModelForHardware(mode) {
  switch (mode) {
    // 🎯 Ryzen 5 7520U sweet spot: Qwen3.5-1.7B Q4_K_M
    //    ~1.35 GB | est. 25–40 t/s | fits 8 GB RAM | beats Qwen2.5-3B on benchmarks
    case "cpu":     return "lmstudio-community/Qwen3.5-1.7B-Instruct-GGUF";
    case "gpu":     return "lmstudio-community/Qwen3.5-9B-Instruct-GGUF";
    case "android": return "lmstudio-community/LFM2-1.2B-GGUF";
    case "ios":     return "lmstudio-community/LFM2-1.2B-GGUF";
    default:        return "lmstudio-community/Qwen3.5-1.7B-Instruct-GGUF";
  }
}

/**
 * getAutoConfig(hwMode, provider, modelName?)
 *
 * Derives optimal generation parameters from hardware + provider.
 * Used in "Auto" settings mode — the user only picks provider + model;
 * everything else is computed here so small-model users don't need to
 * tweak 10 sliders to get good performance.
 *
 * Returns: { batchSize, aiContextMaxChars, contextDepth, promptPreset }
 *
 * Logic:
 *   Cloud providers (Mistral, OpenAI, custom) → Detailed preset, large context.
 *   GPU desktop                                → Balanced/Detailed, medium-large context.
 *   CPU laptop (default LM Studio)             → Small preset, tight context.
 *   Mobile (Android / iOS)                     → Small preset, minimal context.
 *
 * Context limits are intentionally conservative — it's better to be fast
 * than to overflow a small model's attention window and get degraded output.
 */
function getAutoConfig(hwMode, provider) {
  const isCloud = provider === 'mistral' || provider === 'openai' || provider === 'custom';
  const isGPU   = hwMode === 'gpu';
  const isMobile = hwMode === 'android' || hwMode === 'ios';

  if (isCloud) {
    return {
      batchSize:        10,
      aiContextMaxChars: 20_000,
      contextDepth:     'partial',
      promptPreset:     'detailed',
    };
  }
  if (isGPU) {
    return {
      batchSize:        8,
      aiContextMaxChars: 12_000,
      contextDepth:     'partial',
      promptPreset:     'balanced',
    };
  }
  if (isMobile) {
    return {
      batchSize:        2,
      aiContextMaxChars: 2_000,
      contextDepth:     'performance',
      promptPreset:     'small',
    };
  }
  // CPU / iGPU default — small local model, tight context
  return {
    batchSize:        4,
    aiContextMaxChars: 4_000,
    contextDepth:     'partial',
    promptPreset:     'small',
  };
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

// ============================================================================
// PROMPT PRESETS
// ============================================================================
// 🎨 PALETTE + ⚡ BOLT: Pre-written prompts optimised for different model sizes.
// Smaller models need shorter, more directive prompts — extra fluff like
// "You are a helpful assistant" costs tokens and can degrade output quality
// on <7B parameter models. Each preset is a { system, user, subcatSystem } triple.
//
// Token estimates (rough, 1 token ≈ 4 chars):
//   Small  system ≈ 10 tokens — ideal for 1–3B local models
//   Balanced system ≈ 16 tokens — good for 7B models
//   Detailed system ≈ 30 tokens — best for 13B+ / cloud models

var PROMPT_PRESETS = {
  small: {
    label: '🟢 Small (1–3B)',
    desc:  'Maximally specific prompts for 1–3B models. Front-loaded task, explicit format rules, no ambiguity.',
    // ⚡ BOLT v0.9.2: Small models fail on vague instructions.
    // Rules:
    //   1. System prompt states OUTPUT FORMAT explicitly (markdown, bold with **)
    //   2. Forbidden behaviours listed (no preamble, no "Here is a summary:")
    //   3. User template puts the TASK first, context LAST — model reads task,
    //      then context, then generates. Reversed order causes instruction-forget.
    //   4. "Summary:" at the end primes the model to output content immediately.
    system: [
      'Output a wiki summary in markdown.',
      'Rules:',
      '- Start writing immediately. No preamble like "Here is a summary" or "Sure!".',
      '- Bold every key term, concept, and proper noun using **double asterisks**.',
      '- Use short paragraphs. Do not use bullet lists unless listing distinct items.',
      '- Only use information from the provided context. Do not invent facts.',
      '- End when the summary is complete. Do not add closing remarks.',
    ].join('\n'),
    user:   'Write a wiki summary of **{{term}}**.\n\nContext from notes:\n{{context}}\n\nSummary:',
    subcatSystem: [
      'Output exactly one subject category name. Nothing else.',
      'Format: 2 to 4 words, Title Case, no punctuation, no explanation.',
      'Examples: Cellular Biology, Quantum Mechanics, Roman History',
      'Do not write a sentence. Do not say "Category:" or "The category is".',
      'Just output the name.',
    ].join('\n'),
  },
  balanced: {
    label: '🟡 Balanced (7B)',
    desc:  'Specific prompts for 7B models — enough detail for good output without over-constraining.',
    system: [
      'Write accurate, well-structured wiki summaries in markdown.',
      'Bold all key terms, concepts, and proper nouns with **double asterisks**.',
      'Write in prose paragraphs. Begin immediately without any preamble.',
      'Base your answer only on the provided context.',
    ].join('\n'),
    user:   'Summarize **{{term}}** based on the context below. Be thorough but concise. Bold every key term.\n\nContext:\n{{context}}\n\nSummary:',
    subcatSystem: [
      'Return ONLY a subject subcategory name (2–4 words, Title Case).',
      'No punctuation. No explanation. No sentence. Just the name.',
    ].join('\n'),
  },
  detailed: {
    label: '🔵 Detailed (13B+)',
    desc:  'Full instructions for large local models or cloud APIs.',
    system: 'You are a precise academic wiki writer. Synthesize the provided notes into a structured, thorough summary in markdown. Use **bold** for all key terms, concepts, and proper nouns. Write in clear prose paragraphs. Begin immediately without preamble. Base your answer only on the provided context.',
    user:   'Write a comprehensive wiki entry for **{{term}}** using only the provided context. Cover key concepts, definitions, mechanisms, and relationships. Bold every key term and concept.\n\nContext:\n{{context}}\n\nWiki Entry:',
    subcatSystem: 'Return ONLY the most accurate subject subcategory name for this term (2–4 words, Title Case, no punctuation, no explanation). Just the name — nothing else.',
  },
};

/**
 * Detect which preset a prompt pair currently matches, or return 'custom'.
 * Used to pre-select the dropdown when the settings panel opens.
 */
function detectPromptPreset(systemPrompt, userPromptTemplate) {
  for (const [key, preset] of Object.entries(PROMPT_PRESETS)) {
    if (preset.system === systemPrompt && preset.user === userPromptTemplate) return key;
  }
  return 'custom';
}

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
    // ⚡ BOLT v0.9.2: use pre-trimmed endpoint if available (set once per pass)
    const endpoint = this.settings._cachedLMSEndpoint
      || (this.settings.lmstudioV1Endpoint || "http://localhost:1234").replace(/\/+$/, "");
    const url = `${endpoint}/api/v1/chat`;

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

    // Inject system prompt if this is a fresh thread.
    // 🛡️ v1 API FIX: field name is `system_prompt`, not `system` (v0 field).
    if (systemPrompt && !this._lastResponseId) {
      body.system_prompt = systemPrompt;
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
      if (data.usage) {
        this.logger?.debug("LMStudioV1", "Token usage", {
          promptTokens: data.usage.input_tokens ?? data.usage.prompt_tokens,
          completionTokens: data.usage.output_tokens ?? data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        });
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
    // 🛡️ v1 API FIX: field name is `system_prompt`, not `system`.
    if (systemPrompt && !this._lastResponseId) body.system_prompt = systemPrompt;
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
                  // 🛡️ v1 API FIX: chat.end data IS the full response object —
                  // equivalent to the non-streaming response. The response_id and
                  // output array live at the top level of the event, not inside
                  // a nested `result` key (that was an incorrect assumption).
                  if (event.response_id) {
                    this._lastResponseId = event.response_id;
                  }
                  // Fallback: if deltas were missed, extract message from the
                  // aggregated output array on the chat.end event itself.
                  if (messageParts.length === 0) {
                    const fullMsg = this._extractMessageContent(event);
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
 *   - Fully-uppercase tokens ≤ 5 chars preserved as acronyms: DNA, ATP, NMJ, ADHD
 *     Longer all-caps words ("ACTION", "POTENTIAL") are title-cased normally so
 *     legacy ALL-CAPS note titles don't stay uppercased after import.
 *   - Hyphenated compounds each part title-cased
 */
function toTitleCase(str) {
  const LOWERCASE_WORDS = new Set([
    "a", "an", "the", "and", "but", "or", "for", "nor", "as", "at",
    "by", "in", "of", "off", "on", "per", "to", "up", "via", "yet",
  ]);
  const words = str.trim().split(/\s+/);
  return words.map((word, i) => {
    // Preserve short fully-uppercase tokens (acronyms): DNA, ATP, NMJ, ADHD, etc.
    // Cap at 5 chars so legacy ALL-CAPS words like "ACTION" or "POTENTIAL"
    // are not mistakenly treated as acronyms and get properly title-cased.
    if (word.length >= 2 && word.length <= 5 && word === word.toUpperCase() && /^[A-Z]+$/.test(word)) {
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
    // ⚡ BOLT v0.9.1: Skip wiki-generated notes as SOURCE files.
    // Before this fix, wiki notes (e.g. Wiki/Neuroscience/Action Potential.md)
    // could appear as source files — their [[wikilinks]] would seed new terms
    // to generate, creating a feedback loop that grows the index with every run.
    const t1 = performance.now();
    const resolved = this.app.metadataCache.resolvedLinks || {};
    const wikiDirPfx = (this.settings.customDirectoryName || 'Wiki') + '/';
    let skippedWikiSource = 0;
    for (const sourcePath in resolved) {
      if (sourcePath.startsWith(wikiDirPfx)) { skippedWikiSource++; continue; }
      totalSourceFiles++;
      for (const targetPath in resolved[sourcePath]) {
        linkedFilesByPath.set(targetPath, (linkedFilesByPath.get(targetPath) || 0) + resolved[sourcePath][targetPath]);
      }
    }
    const resolveScanMs = Math.round(performance.now() - t1);
    this.logger.debug("TermCache", `Phase 1 (resolve scan): ${totalSourceFiles} source files → ${linkedFilesByPath.size} linked targets (${skippedWikiSource} wiki sources skipped)`, { durationMs: resolveScanMs });

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
      // ⚡ Skip wiki notes as unresolved-link sources (same feedback-loop fix as Phase 1)
      if (sourcePath.startsWith(wikiDirPfx)) continue;
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

  /**
   * Build/rebuild lookup structures from current settings. Called on construction
   * and whenever settings change.
   *
   * ⚡ BOLT: Precompute all per-category matching signals here so assignCategory()
   * never rebuilds them at call time.
   *
   * BEFORE: assignCategory() rebuilt catNameLower + keywords.filter().map(toLower)
   *         + allSignals array inside its inner categories loop on every call.
   *         On a 500-file vault: 80 terms × ~7 source files × 2 callers
   *         (determineBestCategory Signal 3 + generateTags) × N_cats =
   *         thousands of redundant filter/map/concat calls per generation pass.
   * AFTER:  Signals computed once here. assignCategory() reads _catSignals.get()
   *         — zero allocation per call.
   *         Also precomputes lowercased tag Sets for O(1) lookup vs O(n) some(toLower).
   * Impact: ~1,120 filter+map+concat chains eliminated per 80-term pass
   *         (5 categories, 7 avg source files/term, 2 callers).
   */
  _buildCategoryMap() {
    this._categoryByName = new Map();
    // _catSignals: name → { catNameLower, allSignals: string[], tagSet: Set<string> }
    this._catSignals = new Map();

    for (const cat of (this.settings.categories || [])) {
      this._categoryByName.set(cat.name, cat);

      const catNameLower = cat.name.toLowerCase();
      const keywords = (cat.keywords || []).filter(Boolean).map(k => k.toLowerCase());
      const allSignals = [catNameLower, ...keywords];
      // Precomputed lowercased tag Set — O(1) has() replaces O(n) .some(t => t.toLowerCase())
      const tagSet = new Set((cat.tags || []).map(t => t.toLowerCase()));

      this._catSignals.set(cat.name, { catNameLower, allSignals, tagSet });
    }
  }

  /**
   * ⚡ BOLT B7: Variant of assignCategory() that accepts pre-fetched metadata and
   * tags so the caller doesn't need to fetch them separately.
   * Used by determineBestCategory() which already has the metadata from building
   * fileCategories, saving a second getFileCache() + getAllTags() per file.
   */
  assignCategoryWithMeta(sourceFile, metadata, tags) {
    if (!this.settings.useCategories || !this.settings.autoAssignCategory) {
      return this.getDefaultCategory();
    }

    // ── Priority 1: Explicit source-folder prefix ──────────────────────────────
    for (const category of this.settings.categories) {
      if (!category.enabled) continue;
      if (category.sourceFolder && sourceFile.path.startsWith(category.sourceFolder)) {
        return category;
      }
    }

    // ── Priority 2: Tag match ──────────────────────────────────────────────────
    for (const category of this.settings.categories) {
      if (!category.enabled) continue;
      const signals = this._catSignals?.get(category.name);
      if (!signals?.tagSet?.size) continue;
      for (const tag of tags) {
        if (signals.tagSet.has(tag.replace('#', '').toLowerCase())) {
          return category;
        }
      }
    }

    // ── Priority 3: Path-segment + keyword scoring ─────────────────────────────
    const pathParts = sourceFile.path.replace(/\.md$/i, '').split('/');
    const folderSegments = pathParts.slice(0, -1).map(p => p.toLowerCase());
    const basename = (pathParts[pathParts.length - 1] || '').toLowerCase();

    const frontmatter = metadata?.frontmatter || {};
    const frontmatterText = [
      frontmatter.title, frontmatter.subject, frontmatter.type, frontmatter.category,
      frontmatter.tags ? (Array.isArray(frontmatter.tags) ? frontmatter.tags.join(' ') : frontmatter.tags) : '',
    ].filter(Boolean).join(' ').toLowerCase();

    let bestScore = 0;
    let bestCat = null;

    for (const category of this.settings.categories) {
      if (!category.enabled) continue;
      const signals = this._catSignals?.get(category.name);
      if (!signals) continue;
      const { catNameLower, allSignals } = signals;
      let score = 0;

      for (const seg of folderSegments) {
        for (const sig of allSignals) {
          if (seg === sig) { score += (sig === catNameLower) ? 4 : 3; }
          else if (seg.includes(sig) || sig.includes(seg)) { score += 2; }
        }
      }
      for (const sig of allSignals) {
        if (basename.includes(sig)) score += 2;
        if (frontmatterText.includes(sig)) score += 1;
      }
      if (score > bestScore) { bestScore = score; bestCat = category; }
    }

    if (bestCat && bestScore > 0) return bestCat;
    return this.getDefaultCategory();
  }

  assignCategory(sourceFile) {
    if (!this.settings.useCategories || !this.settings.autoAssignCategory) {
      return this.getDefaultCategory();
    }

    const metadata = this.app.metadataCache.getFileCache(sourceFile);
    const tags = (0, import_obsidian.getAllTags)(metadata) || [];

    // ── Priority 1: Explicit source-folder prefix (user-configured, exact) ──────
    for (const category of this.settings.categories) {
      if (!category.enabled) continue;
      if (category.sourceFolder && sourceFile.path.startsWith(category.sourceFolder)) {
        return category;
      }
    }

    // ── Priority 2: Tag match ──────────────────────────────────────────────────
    // ⚡ BOLT: Use precomputed tagSet (lowercase Set) — O(1) has() per tag/category
    // instead of O(n) .some(t => t.toLowerCase()) rebuilt each call.
    for (const category of this.settings.categories) {
      if (!category.enabled) continue;
      const signals = this._catSignals?.get(category.name);
      if (!signals?.tagSet?.size) continue;
      for (const tag of tags) {
        if (signals.tagSet.has(tag.replace('#', '').toLowerCase())) {
          return category;
        }
      }
    }

    // ── Priority 3: Path-segment + keyword scoring ─────────────────────────────
    //
    // Weighted signals from the file's vault path:
    //   "Neuroscience/Week 3/Action Potential.md"
    //    └─ folder segments: ["neuroscience", "week 3"]   weight 3 each
    //    └─ basename:        "action potential"            weight 2
    //
    // ⚡ BOLT: allSignals and catNameLower read from precomputed _catSignals —
    // no filter/map/concat inside this loop any more.

    const pathParts = sourceFile.path.replace(/\.md$/i, '').split('/');
    const folderSegments = pathParts.slice(0, -1).map(p => p.toLowerCase());
    const basename = (pathParts[pathParts.length - 1] || '').toLowerCase();

    const frontmatter = metadata?.frontmatter || {};
    const frontmatterText = [
      frontmatter.title,
      frontmatter.subject,
      frontmatter.type,
      frontmatter.category,
      frontmatter.tags
        ? (Array.isArray(frontmatter.tags) ? frontmatter.tags.join(' ') : frontmatter.tags)
        : '',
    ].filter(Boolean).join(' ').toLowerCase();

    let bestScore = 0;
    let bestCat = null;

    for (const category of this.settings.categories) {
      if (!category.enabled) continue;
      // ⚡ BOLT: Read precomputed signals — zero allocation here
      const signals = this._catSignals?.get(category.name);
      if (!signals) continue;
      const { catNameLower, allSignals } = signals;

      let score = 0;

      for (const seg of folderSegments) {
        for (const sig of allSignals) {
          if (seg === sig) {
            score += (sig === catNameLower) ? 4 : 3;
          } else if (seg.includes(sig) || sig.includes(seg)) {
            score += 2;
          }
        }
      }

      for (const sig of allSignals) {
        if (basename.includes(sig)) score += 2;
      }

      for (const sig of allSignals) {
        if (frontmatterText.includes(sig)) score += 1;
      }

      if (score > bestScore) {
        bestScore = score;
        bestCat = category;
      }
    }

    if (bestCat && bestScore > 0) return bestCat;
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

    // ── AI Subcategory caches ──────────────────────────────────────────────────
    // _subcatCache: "MainCategoryName::term_lower" → subcategoryString | null
    // Prevents duplicate AI calls for terms already classified this session.
    this._subcatCache = new Map();
    // _subcatByCategory: mainCategoryName → Set<subcategoryString>
    // Tracks subcategories already created per main category so the classifier
    // can reuse existing ones, keeping related terms grouped consistently.
    this._subcatByCategory = new Map();
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
    // ⚡ Skip wiki notes as source files — prevents wiki-generated notes from
    // seeding new terms to generate (feedback loop fix, matches buildIndex() fix)
    const _wikiPfx = (this.settings.customDirectoryName || 'Wiki') + '/';

    for (const sourcePath in unresolvedLinks) {
      if (sourcePath.startsWith(_wikiPfx)) continue;
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

    // ── Auto-update pass summary ─────────────────────────────────────────────
    {
      const autoQueued = linksArray.length - linkCounts.size + (linksArray.filter(t => (linkCounts.get(t) || 0) === 0).length);
      this.logger.debug("NoteGenerator", `Links array finalised`, {
        unresolvedLinks: linkCounts.size,
        autoUpdateQueued: linksArray.length - linkCounts.size,
        totalToProcess: linksArray.length,
      });
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

    // ⚡ Compute effective config once — Auto mode overrides settings values
    const _hwMode = detectHardwareMode(this.settings);
    const _effectiveCfg = this.settings.settingsMode === 'auto'
      ? getAutoConfig(_hwMode, this.settings.provider)
      : { batchSize: this.settings.batchSize, aiContextMaxChars: this.settings.aiContextMaxChars, contextDepth: this.settings.contextDepth || 'partial', promptPreset: detectPromptPreset(this.settings.systemPrompt, this.settings.userPromptTemplate) };
    const _effectiveBatch   = _effectiveCfg.batchSize;
    const _effectiveContext = _effectiveCfg.aiContextMaxChars;
    const _effectiveDepth   = _effectiveCfg.contextDepth;
    // In Auto mode, apply the preset's prompts at runtime (don't overwrite saved settings)
    const _effectivePreset  = _effectiveCfg.promptPreset;
    const _autoPrompts = this.settings.settingsMode === 'auto' && PROMPT_PRESETS[_effectivePreset]
      ? PROMPT_PRESETS[_effectivePreset] : null;

    this.logger.info("NoteGenerator", "Effective config", {
      mode: this.settings.settingsMode || 'manual',
      hardware: _hwMode, batchSize: _effectiveBatch,
      aiContextMaxChars: _effectiveContext, contextDepth: _effectiveDepth,
      promptPreset: _effectivePreset,
    });
    // Store on instance so generateNote() can read without changing signature
    this._effectiveContext = _effectiveContext;
    this._effectiveDepth   = _effectiveDepth;
    this._autoPrompts      = _autoPrompts;
    // ⚡ BOLT v0.9.2: Pre-resolve prompt strings once per pass — eliminates
    // the optional-chain + nullish-coalesce evaluation on every note.
    this._resolvedSystemPrompt = _autoPrompts?.system ?? this.settings.systemPrompt;
    this._resolvedUserTemplate = _autoPrompts?.user   ?? this.settings.userPromptTemplate;
    // ⚡ Pre-trim endpoint strings — cached for entire pass, cleared on finish
    this.settings._cachedLMSEndpoint = (this.settings.lmstudioV1Endpoint || 'http://localhost:1234').replace(/\/+$/, '');
    this.settings._cachedOAIEndpoint = (this.settings.openaiEndpoint || '').trim().replace(/\/+$/, '');

    for (let i = 0; i < linksArray.length; i += _effectiveBatch) {
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
      const batch = linksArray.slice(i, Math.min(i + _effectiveBatch, linksArray.length));
      this.logger.debug("NoteGenerator",
        // ⚡ BOLT v3.5.2 Fix 9: batch.join(", ") only evaluated when DEBUG logging
        // is active. At INFO level (the default) this was allocating a new string
        // every batch — pure waste since the string was never written to a log.
        this.logger.LEVELS[this.logger.settings.logLevel] <= this.logger.LEVELS["DEBUG"]
          ? `Batch ${batchNumber}: processing [${batch.join(", ")}]`
          : `Batch ${batchNumber}: processing ${batch.length} terms`
      );

      // ⚡ BOLT v0.9.2 — Sequential vs parallel dispatch
      // LOCAL models (LM Studio v1 / openai-compat): run one note at a time.
      //   Promise.all was spawning N simultaneous connections → LM Studio loaded
      //   a separate model instance per connection (visible as :2, :3, :4 in UI).
      //   Serial execution keeps exactly one active connection at all times.
      // CLOUD APIs (Mistral, OpenAI): keep parallel batching — their servers
      //   queue concurrent requests internally; batching reduces wall-clock time.
      const _isLocal = this.settings.provider === 'lmstudio-v1'
                    || this.settings.provider === 'lmstudio-openai';
      if (_isLocal) {
        for (const term of batch) {
          if (this._cancelled) break;
          await this.generateNote(term, fileContentCache, mentionIndex);
        }
      } else {
        await Promise.all(batch.map(term => this.generateNote(term, fileContentCache, mentionIndex)));
      }

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
    // ⚡ Clear per-pass caches
    delete this.settings._cachedLMSEndpoint;
    delete this.settings._cachedOAIEndpoint;

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
      contextDepth: this._effectiveDepth ?? this.settings.contextDepth ?? 'partial',
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

      const { category, fileCategories } = this.determineBestCategory(contextData.sourceFiles, term);
      await this.categoryManager.ensureCategoryExists(category);

      // Fetch external data ONCE and reuse — with in-memory caching.
      // ⚡ BOLT: Skip Dictionary/Wikipedia for terms that are obviously not
      // lookupable (file paths, date titles, ion notation, social handles, etc.)
      // to avoid guaranteed-404 requests and keep error logs clean.
      const canLookup = isLookupableTerm(term);
      if (!canLookup) {
        // Reason: file extension / ion notation / parenthesised abbrev / too many words
        this.logger.debug("NoteGenerator", `Skipping external lookups for "${term}"`, {
          hasExtension: /\.\w{2,5}$/.test(term),
          ionNotation: /\d*[+-]$/.test(term),
          hasParenthetical: /\([\w+]+\)/.test(term),
          wordCount: term.trim().split(/\s+/).length,
          tooManyWords: term.trim().split(/\s+/).length > 5,
        });
      }
      const [wikiData, dictData] = await Promise.all([
        (this.settings.useWikipedia && canLookup) ? this._fetchWikipedia(term) : Promise.resolve(null),
        (this.settings.useDictionaryAPI && canLookup) ? this._fetchDictionary(term) : Promise.resolve(null),
      ]);

      // 🛡️ SENTINEL: safeTerm used here — never raw `term` — to prevent path traversal.
      // v3.6.0: File names are now Title Case (was ALL CAPS in v3.5.x).
      // Obsidian vault is typically case-insensitive on macOS/Windows, so existing
      // ALL-CAPS notes will be silently matched and updated in-place on those systems.
      // On case-sensitive Linux file systems, a new Title-Case file will be created
      // alongside any existing UPPERCASE file (the old file is left untouched).
      const titleTerm = toTitleCase(safeTerm);

      // ── AI Subcategory Assignment ─────────────────────────────────────────
      // If aiSubcategoriesEnabled, ask the AI to place this term in a subject-
      // specific subfolder within the main category (e.g. Wiki/Anatomy/Electrophysiology/).
      // Main categories are still manually configured; only subfolders are AI-generated.
      let subcategory = null;
      if (this.settings.aiSubcategoriesEnabled) {
        subcategory = await this.getAISubcategory(term, category, contextData.rawContext);
      }

      const filePath = subcategory
        ? `${category.path}/${subcategory}/${titleTerm}.md`
        : `${category.path}/${titleTerm}.md`;

      // If a subcategory was assigned, ensure its folder exists before writing.
      if (subcategory) {
        const subcatFolderPath = `${category.path}/${subcategory}`;
        const subcatFolder = this.app.vault.getAbstractFileByPath(subcatFolderPath);
        if (!(subcatFolder instanceof import_obsidian.TFolder)) {
          await this.app.vault.createFolder(subcatFolderPath).catch(() => {});
          this.logger.debug("NoteGenerator", `Created subcategory folder: ${subcatFolderPath}`);
        }
      }

      // 🛡️ SENTINEL: Write-safety guard — blocks any write outside wiki/log directories.
      // This ensures your existing notes are NEVER modified by this plugin.
      assertSafeWritePath(filePath, this.settings);

      const existingFile = this.app.vault.getAbstractFileByPath(filePath);

      // Read existing content now so buildNoteContent can recover the old AI summary
      // if the API returns a truncated response this run.
      let existingContent = null;
      if (existingFile instanceof import_obsidian.TFile) {
        try {
          existingContent = await this.app.vault.read(existingFile);
        } catch (e) {
          this.logger.warn("NoteGenerator", `Could not read existing note for "${term}"`, e);
        }
      }

      const content = await this.logger.time("buildNoteContent", "NoteGenerator", () =>
        this.buildNoteContent(term, category, contextData, wikiData, dictData, existingContent, fileCategories)
      );

      if (existingFile instanceof import_obsidian.TFile) {
        await this.app.vault.modify(existingFile, content);
        this.logger.debug("NoteGenerator", `Updated existing note: ${filePath}`);
      } else {
        try {
          await this.app.vault.create(filePath, content);
          this.logger.debug("NoteGenerator", `Created new note: ${filePath}`);
        } catch (createErr) {
          // Guard against a race condition: another concurrent batch item may have
          // created the same file between our getAbstractFileByPath check and this
          // create() call. Fall back to modify so generation succeeds instead of failing.
          if (createErr?.message === 'File already exists.') {
            const raceFile = this.app.vault.getAbstractFileByPath(filePath);
            if (raceFile instanceof import_obsidian.TFile) {
              await this.app.vault.modify(raceFile, content);
              this.logger.debug("NoteGenerator", `Race-condition fallback — modified existing note: ${filePath}`);
            } else {
              throw createErr;
            }
          } else {
            throw createErr;
          }
        }
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
    // ⚡ BOLT v0.9.2: hoist all settings reads out of the loop — these are
    // constant for the entire generation pass; reading through this.settings
    // on every iteration adds property-chain derefs × mention count.
    const mode = this._effectiveDepth ?? this.settings.contextDepth ?? 'partial';
    const includeFullParagraphs = this.settings.includeFullParagraphs;
    const contextLinesAround = this.settings.contextLinesAround ?? 2;
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
        context = includeFullParagraphs
          ? this.extractParagraph(lines, lineIndex)
          : this.extractLinesN(lines, lineIndex, contextLinesAround);
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
              const context = includeFullParagraphs
                ? this.extractParagraph(lines, i)
                : this.extractLinesN(lines, i, contextLinesAround);
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

    // ⚡ BOLT v0.9.2: count types while building — eliminates 2 filter() passes
    const phase1Count = indexEntries.length > 0
      ? mentions.filter(m => m.type === 'wikilinked').length
      : 0;  // fast-path: if no index entries, phase1 count is 0
    this.logger.debug("NoteGenerator", `extractContext [${mode}] "${term}": ${mentions.length} mentions (${phase1Count} wikilinked, ${mentions.length - phase1Count} virtual) across ${sourceFilesSet.size} files`, {
      rawContextChunks: rawContext.length,
    });

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
    // Legacy entry point — kept for safety; hot path now calls extractLinesN.
    return this.extractLinesN(lines, lineIndex, this.settings.contextLinesAround ?? 2);
  }

  /** ⚡ BOLT v0.9.2: param-based variant — caller hoists the setting value. */
  extractLinesN(lines, lineIndex, n) {
    const start = Math.max(0, lineIndex - n);
    const end   = Math.min(lines.length - 1, lineIndex + n);
    return lines.slice(start, end + 1);
  }

  /**
   * Determine the best category for a wiki term given its source files.
   *
   * ⚡ BOLT: Single-pass source file loop — previously Signals 2 and 3 each
   * iterated sourceFiles separately (2 full passes). Now one loop does both:
   *   - Path/folder-segment scoring (was Signal 2)
   *   - assignCategory() metadata scoring (was Signal 3)
   *
   * Also returns a `fileCategories` Map (file → category) so generateTags()
   * can reuse the already-computed assignments without a second round of
   * assignCategory() calls.
   *
   * Impact: Eliminates one full sourceFiles iteration (~7 calls × 80 terms =
   * ~560 redundant assignCategory() calls per generation pass).
   *
   * Signal 1 (term-level keyword) — uses precomputed _catSignals, no per-call alloc.
   * Signal 2+3 combined — single source-file pass, votes accumulated together.
   */
  determineBestCategory(sourceFiles, term = '') {
    if (!this.settings.useCategories) {
      return { category: this.categoryManager.getDefaultCategory(), fileCategories: new Map() };
    }

    const cats = this.settings.categories || [];
    const defaultCat = this.categoryManager.getDefaultCategory();

    // ── Signal 1: Term-level keyword match ───────────────────────────────────
    // ⚡ BOLT: Read allSignals from precomputed _catSignals — no allocation
    if (term) {
      const termLower = term.toLowerCase();
      for (const cat of cats) {
        if (!cat.enabled) continue;
        const signals = this.categoryManager._catSignals?.get(cat.name);
        if (!signals) continue;
        for (const sig of signals.allSignals) {
          if (termLower.includes(sig) || sig.includes(termLower)) {
            this.logger.debug("NoteGenerator", `Category signal 1 (term keyword) matched "${term}" → "${cat.name}"`, { signal: sig });
            return { category: cat, fileCategories: new Map() };
          }
        }
      }
    }

    if (sourceFiles.length === 0) {
      return { category: defaultCat, fileCategories: new Map() };
    }

    // ── Signals 2+3 combined: single source-file pass ────────────────────────
    //
    // For each source file we collect two vote signals in one iteration:
    //   pathVotes — folder segments matched against category name/keywords (Signal 2)
    //   metaVotes — assignCategory() full scorer result (Signal 3, uses tagSet etc.)
    //
    // We also build fileCategories for reuse by generateTags().
    const pathVotes = new Map();
    const metaVotes = new Map();
    const fileCategories = new Map(); // file.path → category (reused by generateTags)

    for (const file of sourceFiles) {
      // ── Path-segment vote (Signal 2) ──────────────────────────────────────
      const rawPath = file.parent?.path || '';
      const segments = new Set(
        rawPath.split('/').map(s => s.toLowerCase().trim()).filter(Boolean)
      );
      segments.add((file.basename || '').toLowerCase().replace(/\.md$/i, ''));

      for (const cat of cats) {
        if (!cat.enabled) continue;
        // ⚡ BOLT: Read precomputed signals — no allocation inside loop
        const signals = this.categoryManager._catSignals?.get(cat.name);
        if (!signals) continue;
        const { catNameLower, allSignals } = signals;

        let matched = false;
        outer:
        for (const sig of allSignals) {
          for (const seg of segments) {
            if (seg === sig || seg.includes(sig) || sig.includes(seg)) {
              matched = true;
              break outer;
            }
          }
        }
        if (matched) {
          pathVotes.set(cat.name, (pathVotes.get(cat.name) || 0) + 1);
        }
      }

      // ── Metadata vote (Signal 3) ───────────────────────────────────────────
      // ⚡ BOLT B7: assignCategory() calls getFileCache() + getAllTags() internally.
      // Store the resolved category AND the file's own tags in fileCategories so
      // generateTags() can reuse them without a second getFileCache() call.
      // Before: generateTags() called getFileCache() + getAllTags() for every source
      //         file — same files already processed here. 80 terms × 7 files = ~560
      //         redundant metadata lookups per generation pass.
      // After:  fileCategories stores { category, fileTags } — generateTags reads
      //         fileTags directly from the map, zero extra metadata calls.
      const metadata = this.categoryManager.app.metadataCache.getFileCache(file);
      const fileTags = (0, import_obsidian.getAllTags)(metadata) || [];
      const cat = this.categoryManager.assignCategoryWithMeta(file, metadata, fileTags);
      metaVotes.set(cat.name, (metaVotes.get(cat.name) || 0) + 1);
      fileCategories.set(file.path, { category: cat, fileTags });
    }

    // Path-segment winner (prefer non-default)
    if (pathVotes.size > 0) {
      let bestPathCat = null;
      let bestPathScore = 0;
      for (const [catName, score] of pathVotes) {
        if (score > bestPathScore) {
          bestPathScore = score;
          bestPathCat = this.categoryManager._categoryByName?.get(catName);
        }
      }
      if (bestPathCat && bestPathCat.name !== defaultCat.name) {
        this.logger.debug("NoteGenerator", `Category signal 2 (path votes) matched "${term}" → "${bestPathCat.name}"`, {
          score: bestPathScore,
          allPathVotes: Object.fromEntries(pathVotes),
        });
        return { category: bestPathCat, fileCategories };
      }
    }

    // Metadata vote winner
    let maxVotes = 0;
    let bestCategory = defaultCat;
    for (const [catName, votes] of metaVotes) {
      if (votes > maxVotes) {
        maxVotes = votes;
        const cat = this.categoryManager._categoryByName?.get(catName);
        if (cat && (cat.name !== defaultCat.name || maxVotes >= 2)) {
          maxVotes = votes;
          bestCategory = cat;
        }
      }
    }

    this.logger.debug("NoteGenerator", `Category signal 3 (metadata votes) resolved "${term}" → "${bestCategory.name}"`, {
      maxVotes,
      allMetaVotes: Object.fromEntries(metaVotes),
      usedDefault: bestCategory.name === defaultCat.name,
    });
    return { category: bestCategory, fileCategories };
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
  async buildNoteContent(term, category, contextData, wikiData, dictData, existingContent = null, fileCategories = null) {
    // ── Title Case display term ────────────────────────────────────────────────
    // v3.6.0: Title Case replaces ALL CAPS — more readable, preserves acronyms.
    // File names still use the sanitized term; only the display heading changes.
    const displayTerm = toTitleCase(term);

    // ⚡ BOLT B5: collect all output into a parts array, join once at the end.
    // Before: 15 `content +=` operations on a growing string. Each += on a string
    //         that's already N chars long forces the engine to copy N chars + the
    //         new piece, making the total frontmatter+TOC+sections assembly O(N²)
    //         in the final note size. On a note with 5 mentions and a 1500-token
    //         summary, content can reach ~8 KB — 15 copies of up to 8 KB each.
    // After:  array.push() is O(1) amortised; single join() at the end allocates
    //         the final string exactly once.
    // Impact: ~15 string copies → 1. Same fix already applied to formatMention (B4).
    const parts = [];

    // ── Frontmatter ──────────────────────────────────────────────────────────
    parts.push("---\n");
    parts.push("type: wiki-note\n");
    parts.push("copilot-index: true\n");
    parts.push(`generated: ${new Date().toISOString()}\n`);
    if (this.settings.trackModel) {
      parts.push(`model: ${this.settings.modelName}\n`);
      parts.push(`provider: ${this.settings.provider}\n`);
    }
    if (contextData.sourceFiles.length > 0) {
      parts.push("source-notes:\n");
      for (const sf of contextData.sourceFiles) {
        parts.push(`  - "[[${sf.basename}]]"\n`);
      }
    }

    if (this.settings.generateTags) {
      const tags = await this.generateTags(term, contextData, fileCategories);
      if (tags.length > 0) {
        parts.push("tags:\n");
        for (const tag of tags) {
          const tagText = this.settings.tagsIncludeHashPrefix
            ? (tag.startsWith('#') ? tag : `#${tag}`)
            : tag.replace('#', '');
          parts.push(`  - "${tagText}"\n`);
        }
      }
    }
    parts.push("---\n\n");

    // ── Title ─────────────────────────────────────────────────────────────────
    parts.push(`# ${displayTerm}\n\n`);

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

    this.logger.debug("NoteGenerator", `AI context assembled for "${term}"`, {
      rawContextChars: contextData.rawContext.length,
      dictContextAdded: !!(this.settings.useDictionaryInContext && dictData),
      wikiContextAdded: !!(this.settings.useWikipediaInContext && wikiData),
      glossaryAdded: !!this.settings.glossaryBasePath,
      totalBeforeStrip: aiContext.length,
    });

    // ⚡ BOLT v0.9.0: Central stripMarkupForAI() replaces the old 7-pass inline
    // regex chain. Now also strips heading hashes, callout markers, horizontal
    // rules, HTML comments, and code-fence delimiters — ~15-30% more tokens saved.
    const MAX_AI_CONTEXT = this._effectiveContext ?? this.settings.aiContextMaxChars ?? 20_000;
    aiContext = stripMarkupForAI(aiContext, MAX_AI_CONTEXT);
    if (aiContext.length >= MAX_AI_CONTEXT) {
      this.logger.warn("NoteGenerator", `AI context for "${term}" trimmed to ${aiContext.length} chars`);
    }

    this.logger.debug("NoteGenerator", `AI context ready for "${term}"`, {
      charsAfterStrip: aiContext.length,
      estimatedTokens: Math.round(aiContext.length / 4),
      capped: aiContext.length >= (this.settings.aiContextMaxChars ?? 20_000),
    });

    const aiSummaryResult = await this.logger.time("getAISummary", "NoteGenerator", () =>
      this.getAISummary(term, aiContext)
    );

    // ── Section: AI Summary ───────────────────────────────────────────────────
    //
    // Three outcomes from getAISummary:
    //   null                       — API failed / skipped. Use old summary if present; omit if new note.
    //   { text, truncated: false } — Good full response. Use it normally.
    //   { text, truncated: true  } — Hit max_tokens mid-response. Keep the existing summary (if any)
    //                                and prepend a stale callout instead of overwriting with garbage.
    {
      // Extract the old summary body from existingContent (if we have it).
      // We look for the text between "## AI Summary" and the next "## " heading.
      let oldSummaryBody = null;
      if (existingContent) {
        const summaryMatch = existingContent.match(/^## AI Summary\n([\s\S]*?)(?=\n## |\n---\n|$)/m);
        if (summaryMatch) {
          // Strip the disclaimer line at the top (it will be re-added fresh)
          oldSummaryBody = summaryMatch[1]
            .replace(/^\*AI can make mistakes.*\*\s*\n?/, '')
            .trim();
        }
      }

      let summaryText = null;
      let isStale = false;

      if (aiSummaryResult === null) {
        // API failed entirely. Preserve whatever we had before (silent — errors surfaced elsewhere).
        summaryText = oldSummaryBody;
        isStale = !!oldSummaryBody; // only mark stale if we're reusing old content
      } else {
        const { text, truncated } = aiSummaryResult;
        if (truncated && oldSummaryBody) {
          // Token limit hit. Keep the full existing summary; mark it stale.
          this.logger.warn("NoteGenerator", `Using preserved summary for "${term}" — AI was truncated`);
          summaryText = oldSummaryBody;
          isStale = true;
        } else {
          // Good response (or truncated but no old summary to fall back to).
          summaryText = text;
          isStale = false;
        }
      }

      if (summaryText) {
        // ⚡ BOLT B6: build each section as a single template string or array-join
        // instead of repeated sectionContent +=. Same O(n²) reallocation issue as
        // the top-level content += fixed in B5. Most impactful for AI Summary where
        // the body can reach ~6 KB (1500 tokens).
        const sc = [];
        sc.push(`## AI Summary\n`);

        if (isStale) {
          sc.push(`> [!warning] Summary may be out of date\n`);
          sc.push(`> The AI ran out of tokens on the last update. This summary is from a previous generation run and may not reflect recent changes to your notes. Re-run generation with a larger model or higher **AI Context Max Chars** to refresh it.\n\n`);
        }

        sc.push(`${this.settings.aiSummaryDisclaimer}\n\n`);

        // v3.5.0: Plain prose — NO ">" blockquotes from the model itself.
        const cleanedSummary = summaryText
          .split('\n')
          .map(line => line.replace(/^>\s?/, ''))
          .join('\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        sc.push(cleanedSummary + "\n\n");

        if (!isStale && this.settings.extractKeyConceptsFromSummary) {
          const keyConcepts = this.extractKeyConcepts(summaryText);
          if (keyConcepts.length > 0) {
            sc.push("---\n\n");
            for (const concept of keyConcepts) sc.push(`- **${concept}**\n`);
            sc.push("\n");
          }
        }

        sections.push({ heading: "AI Summary", content: sc.join('') });
      }
    }

    // ── Section: Wikipedia ────────────────────────────────────────────────────
    if (this.settings.useWikipedia && wikiData) {
      sections.push({
        heading: "Wikipedia",
        content: `## Wikipedia\n[${this.settings.wikipediaLinkText}](${wikiData.url})\n${wikiData.extract}\n\n`,
      });
    }

    // ── Section: Dictionary ───────────────────────────────────────────────────
    if (this.settings.useDictionaryAPI && dictData) {
      sections.push({
        heading: "Dictionary",
        content: `## Dictionary\n${dictData.formatted}\n\n`,
      });
    }

    // ── Section: Related Concepts ─────────────────────────────────────────────
    if (this.settings.generateRelatedConcepts) {
      const related = await this.getRelatedConcepts(term, aiContext);
      if (related.length > 0) {
        sections.push({
          heading: "Related Concepts",
          content: `## Related Concepts\n${related.map(c => `- [[${c}]]`).join('\n')}\n\n`,
        });
      }
    }

    // ── Section: Mentions ─────────────────────────────────────────────────────
    // ⚡ BOLT B6: collect formatMention() strings into array, join once.
    // Before: sectionContent += formatMention(mention) — each += copies the
    //         accumulated string. With 20 mentions × ~200 chars each = 20 copies
    //         of a growing string up to 4 KB.
    // After:  Array.push per mention + single join — O(1) amortised per push.
    if (contextData.mentions.length > 0) {
      const mParts = [`## Mentions\n\n`];
      for (const mention of contextData.mentions) mParts.push(this.formatMention(mention));
      sections.push({ heading: "Mentions", content: mParts.join('') });
    }

    // ── TOC (links to all sections present) ──────────────────────────────────
    if (sections.length > 0) {
      for (const section of sections) {
        // Obsidian heading anchors: lowercase, spaces → hyphens
        const anchor = section.heading.toLowerCase().replace(/\s+/g, '-');
        parts.push(`- [[#${anchor}|${section.heading}]]\n`);
      }
      parts.push("\n");
    }

    // ── Assemble all sections ─────────────────────────────────────────────────
    for (const section of sections) {
      parts.push(section.content);
    }

    const noteContent = parts.join('');
    this.logger.debug("NoteGenerator", `Note built for "${term}"`, {
      sections: sections.map(s => s.heading),
      noteChars: noteContent.length,
      mentionCount: contextData.mentions.length,
      hasSummary: sections.some(s => s.heading === "AI Summary"),
      hasWikipedia: sections.some(s => s.heading === "Wikipedia"),
      hasDictionary: sections.some(s => s.heading === "Dictionary"),
    });
    return noteContent;
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

      this.logger.debug("NoteGenerator", `Dictionary lookup resolved`, { original: term, resolved: lookupTerm });

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
      } else if (error?.status === 429 || error?.message?.includes('status 429')) {
        // Rate-limited by the public dictionary API — expected under high concurrency.
        // Log at WARN (not ERROR) so these don't pollute the error quick-reference.
        this.logger.warn("NoteGenerator", `Dictionary: rate-limited (429) for "${term}" — skipping`);
      } else if (error?.message?.includes('timeout') || error?.message?.includes('TIMEOUT') || error?.message?.includes('network') || error?.message?.includes('ERR_')) {
        // Network/timeout errors are transient; WARN not ERROR so error counts stay meaningful.
        this.logger.warn("NoteGenerator", `Dictionary: network error for "${term}" — ${error.message}`);
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

  // ── AI Subcategory Classification ─────────────────────────────────────────

  /**
   * Minimal, low-latency AI caller for short classification tasks.
   * Does NOT use the LM Studio v1 stateful client — each call is stateless.
   * Returns the raw text string or null on failure.
   *
   * @param {string} userPrompt
   * @param {string} systemPrompt
   * @param {number} maxTokens — keep tiny (≤30) for classifiers
   */
  async _callAIRaw(userPrompt, systemPrompt, maxTokens = 20) {
    const provider = this.settings.provider;

    // ── LM Studio native v1 path ──────────────────────────────────────────────
    if (provider === "lmstudio-v1") {
      const endpoint = (this.settings.lmstudioV1Endpoint || "http://localhost:1234").replace(/\/+$/, "");
      const url = `${endpoint}/api/v1/chat`;
      const protocolError = validateEndpointProtocol(endpoint);
      if (protocolError) return null;

      const headers = { "Content-Type": "application/json" };
      if (this.settings.lmstudioV1ApiToken) {
        headers["Authorization"] = `Bearer ${this.settings.lmstudioV1ApiToken}`;
      }
      try {
        const resp = await (0, import_obsidian.requestUrl)({
          url, method: "POST", headers, timeout: 20000,
          body: JSON.stringify({
            model: this.settings.modelName,
            input: userPrompt,
            system_prompt: systemPrompt,
            store: false,
            context_length: 512,
          }),
        });
        const content = resp.json?.output?.filter(i => i.type === "message").map(i => i.content).join("").trim();
        return content || null;
      } catch { return null; }
    }

    // ── Anthropic Claude native path ──────────────────────────────────────────
    if (provider === "anthropic") {
      try {
        const result = await this._callAnthropicAPI(userPrompt, systemPrompt, maxTokens);
        return result?.text ?? null;
      } catch { return null; }
    }

    // ── Standard OpenAI-compatible path (all other providers) ────────────────
    const providerCfg = getProviderConfig(this.settings);
    const hasKey = !!this.settings.openaiApiKey;
    if (providerCfg.requiresKey && !hasKey) return null;

    const protocolError = validateEndpointProtocol(this.settings.openaiEndpoint);
    if (protocolError) return null;

    const headers = { "Content-Type": "application/json" };
    if (this.settings.openaiApiKey) headers["Authorization"] = `Bearer ${this.settings.openaiApiKey}`;
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = "https://obsidian.md";
      headers["X-Title"] = "Vault Wiki";
    }

    const baseUrl = this.settings.openaiEndpoint.trim().replace(/\/+$/, "");
    try {
      const resp = await (0, import_obsidian.requestUrl)({
        url: `${baseUrl}/chat/completions`,
        method: "POST",
        headers,
        timeout: 20000,
        body: JSON.stringify({
          model: this.settings.modelName,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature: 0.2,
        }),
      });
      return resp.json?.choices?.[0]?.message?.content?.trim() || null;
    } catch { return null; }
  }

  /**
   * Call the Anthropic Messages API.
   * Format differs from OpenAI: x-api-key header, /v1/messages endpoint,
   * system is a top-level field not a message role.
   *
   * @param {string} userContent
   * @param {string|null} systemContent
   * @param {number} maxTokens
   * @returns {Promise<{text: string, truncated: boolean}|null>}
   */
  async _callAnthropicAPI(userContent, systemContent, maxTokens = 1500) {
    const apiKey = this.settings.anthropicApiKey;
    if (!apiKey) {
      this.logger.warn("NoteGenerator", "Anthropic API key not set");
      return null;
    }

    // 🛡️ SENTINEL: Anthropic API must always be HTTPS.
    const endpoint = "https://api.anthropic.com";
    const url = `${endpoint}/v1/messages`;

    // 🛡️ SENTINEL: Validate key format — Anthropic keys start with "sk-ant-"
    if (!apiKey.startsWith("sk-ant-") && !apiKey.startsWith("sk-")) {
      this.logger.warn("NoteGenerator", `Anthropic API key has unexpected format — expected sk-ant-… (${maskApiKey(apiKey)})`);
    }

    const headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": this.settings.anthropicVersion || "2023-06-01",
    };

    const body = {
      model: this.settings.modelName,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: userContent }],
    };
    if (systemContent) body.system = systemContent;

    try {
      const response = await (0, import_obsidian.requestUrl)({
        url,
        method: "POST",
        headers,
        timeout: 60000,
        body: JSON.stringify(body),
      });

      const data = response.json;
      const text = data?.content?.[0]?.text;
      if (!text) return null;

      const truncated = data.stop_reason === "max_tokens";
      return { text, truncated };
    } catch (error) {
      this.logger.error("NoteGenerator", "Anthropic API call failed", error);
      return null;
    }
  }

  /**
   * Ask the AI to assign a subcategory for `term` within `mainCategory`.
   *
   * Strategy:
   *   1. Check _subcatCache — return immediately if already classified.
   *   2. Build a prompt that includes the existing subcategories for this
   *      main category so the model reuses them when appropriate, keeping
   *      related terms grouped (e.g. "Action Potential" and "Resting Membrane
   *      Potential" both land in "Electrophysiology" rather than two variants).
   *   3. Sanitize and title-case the response before caching.
   *   4. Record the new subcategory in _subcatByCategory for future calls.
   *
   * Returns a sanitized Title Case string, or null if classification fails
   * or is disabled.
   */
  async getAISubcategory(term, mainCategory, contextSnippet) {
    if (!this.settings.aiSubcategoriesEnabled) return null;

    const cacheKey = `${mainCategory.name}::${term.toLowerCase()}`;
    if (this._subcatCache.has(cacheKey)) return this._subcatCache.get(cacheKey);

    // Build existing subcategory hint for consistency
    const existingSet = this._subcatByCategory.get(mainCategory.name) || new Set();
    const existingList = existingSet.size > 0
      ? `\nExisting subcategories (reuse one if it fits well): ${Array.from(existingSet).join(", ")}`
      : "";

    // ⚡ BOLT v0.9.0: Strip Obsidian markup before sending to classifier.
    // Raw notes contain wikilinks, frontmatter, headings etc. that waste tokens
    // but add zero classification signal. stripMarkupForAI() also caps length.
    const ctxLimit = this.settings.aiSubcategoryContextChars ?? 600;
    const ctx = stripMarkupForAI(contextSnippet || '', ctxLimit);

    const userPrompt =
      `Main category: ${mainCategory.name}\n` +
      `Term to classify: "${term}"\n` +
      `Context: ${ctx}` +
      existingList +
      `\n\nReturn ONLY the subcategory name (2–4 words, Title Case).`;

    const systemPrompt = this.settings.aiSubcategorySystemPrompt ||
      "You are a subject matter classifier for academic notes. Return ONLY a subcategory name — nothing else. 2–4 words, Title Case.";

    this.logger.debug("NoteGenerator", `getAISubcategory: classifying "${term}" in "${mainCategory.name}"`, {
      existingSubcats: Array.from(existingSet),
    });

    const raw = await this._callAIRaw(userPrompt, systemPrompt, 20);

    let subcat = null;
    if (raw) {
      // Take only the first line, strip surrounding quotes, sanitize for filesystem
      const cleaned = raw.split("\n")[0].replace(/^["'`]+|["'`]+$/g, "").trim();
      const sanitized = sanitizeTermForPath(cleaned);
      if (sanitized && sanitized.length >= 2 && sanitized.length <= 60) {
        subcat = toTitleCase(sanitized);
        // Register so future terms in this category can reuse it
        if (!this._subcatByCategory.has(mainCategory.name)) {
          this._subcatByCategory.set(mainCategory.name, new Set());
        }
        this._subcatByCategory.get(mainCategory.name).add(subcat);
      }
    }

    this._subcatCache.set(cacheKey, subcat);
    this.logger.debug("NoteGenerator", `getAISubcategory: "${term}" → ${subcat ? `"${subcat}"` : "(none)"}`, {
      mainCategory: mainCategory.name,
      raw,
    });
    return subcat;
  }

  /**
   * Anthropic-specific summary path — uses /v1/messages format.
   */
  async _getAISummaryAnthropic(term, context) {
    if (!context || context.trim() === "") {
      this.logger.warn("NoteGenerator", `getAISummary (Anthropic): skipping "${term}" — empty context`);
      return null;
    }
    if (!this.settings.anthropicApiKey) {
      if (!this._shownNoKeyWarning) {
        this._shownNoKeyWarning = true;
        new import_obsidian.Notice("Vault Wiki: No Anthropic API key set. Open Settings → AI Provider.", 8000);
      }
      return null;
    }
    this.logger.stats.apiCalls++;
    const userPrompt = (this._resolvedUserTemplate ?? this.settings.userPromptTemplate)
      .replace('{{term}}', term)
      .replace('{{context}}', context);
    try {
      const result = await this._callAnthropicAPI(
        userPrompt,
        this._resolvedSystemPrompt,
        1500
      );
      if (!result) {
        this.logger.warn("NoteGenerator", `Anthropic returned null for "${term}"`);
        this.logger.stats.apiErrors++;
        return null;
      }
      return result;
    } catch (err) {
      this.logger.stats.apiErrors++;
      this.logger.error("NoteGenerator", `Anthropic summary failed for "${term}"`, err);
      if (!this._shownAIError) {
        this._shownAIError = true;
        const status = err?.status;
        let msg = "Vault Wiki: Anthropic API call failed";
        if (status === 401) msg = "Vault Wiki: Anthropic 401 — check your API key in Settings → AI Provider.";
        else if (status === 429) msg = "Vault Wiki: Anthropic 429 — rate limited. Wait and try again.";
        else if (status >= 500) msg = `Vault Wiki: Anthropic ${status} server error. Try again later.`;
        new import_obsidian.Notice(msg, 10000);
      }
      return null;
    }
  }

  async getAISummary(term, context) {
    const provider = this.settings.provider;
    const isLMStudioV1 = provider === "lmstudio-v1";
    const isAnthropic = provider === "anthropic";

    // ── Anthropic Claude native API path ───────────────────────────────────────
    if (isAnthropic) {
      return this._getAISummaryAnthropic(term, context);
    }

    const isCloud = PROVIDER_MAP.get(provider)?.requiresKey ?? false;
    const hasKey = provider === "anthropic"
      ? !!this.settings.anthropicApiKey
      : !!this.settings.openaiApiKey;

    // ── LM Studio native v1 API path ────────────────────────────────────────────
    if (isLMStudioV1) {
      if (!context || context.trim() === "") {
        this.logger.warn("NoteGenerator", `getAISummary (v1): skipping "${term}" — empty context`);
        return null;
      }
      // ⚡ BOLT v0.9.2: reuse hwMode cached in generateAll — eliminates
      // per-note userAgent parse (detectHardwareMode) called 200× per pass.
      const hwMode = this._hwMode ?? detectHardwareMode(this.settings);
      this.logger.debug("NoteGenerator", `getAISummary via LM Studio v1 API`, {
        term, hwMode,
        endpoint: this.settings.lmstudioV1Endpoint,
        model: this.settings.modelName,
        stateful: this.settings.lmstudioV1Stateful,
      });
      this.logger.stats.apiCalls++;
      const userPrompt = this._resolvedUserTemplate ?? this.settings.userPromptTemplate
        .replace('{{term}}', term)
        .replace('{{context}}', context);
      try {
        // Each wiki note gets a fresh thread (no cross-term state leak)
        this._lmstudioV1.resetThread();
        const result = this.settings.lmstudioV1StreamingEnabled
          ? await this._lmstudioV1.chatStreaming(userPrompt, this._resolvedSystemPrompt, false)
          : await this._lmstudioV1.chat(userPrompt, this._resolvedSystemPrompt, false);
        if (!result) {
          this.logger.warn("NoteGenerator", `LM Studio v1 returned null for "${term}"`);
          this.logger.stats.apiErrors++;
          return null;
        }
        // LM Studio streaming doesn't expose finish_reason, so we can't detect
        // truncation there. Return non-truncated tagged object for consistency.
        return { text: result, truncated: false };
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
      this.logger.error("NoteGenerator", `getAISummary: blocked unsafe endpoint — ${protocolError}`, { endpoint: this.settings.openaiEndpoint });
      if (!this._shownEndpointWarning) {
        this._shownEndpointWarning = true;
        new import_obsidian.Notice(`Vault Wiki: Bad API endpoint — ${protocolError}`, 8000);
      }
      return null;
    }

    // 🛡️ SENTINEL: Cloud providers MUST use HTTPS — warn on HTTP.
    const providerCfg2 = getProviderConfig(this.settings);
    if (providerCfg2.requiresKey && !providerCfg2.localOnly && this.settings.openaiEndpoint.startsWith("http://")) {
      if (!this._shownEndpointWarning) {
        this._shownEndpointWarning = true;
        new import_obsidian.Notice(`Vault Wiki: ⚠️ API key sent over HTTP — switch to HTTPS in Settings.`, 10000);
      }
    }

    // 🛡️ SENTINEL: Full SSRF check.
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
      const userPrompt = this._resolvedUserTemplate ?? this.settings.userPromptTemplate
        .replace('{{term}}', term)
        .replace('{{context}}', context);

      const headers = { "Content-Type": "application/json" };
      if (this.settings.openaiApiKey) {
        headers["Authorization"] = `Bearer ${this.settings.openaiApiKey}`;
      }
      if (provider === "openrouter") {
        headers["HTTP-Referer"] = "https://obsidian.md";
        headers["X-Title"] = "Vault Wiki";
      }

      const baseUrl = this.settings._cachedOAIEndpoint
        || this.settings.openaiEndpoint.trim().replace(/\/+$/, '');
      const url = `${baseUrl}/chat/completions`;
      const body = JSON.stringify({
        model: this.settings.modelName,
        messages: [
          { role: "system", content: this._resolvedSystemPrompt },
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

      const text = data.choices[0].message.content;
      const usage = data.usage;
      if (usage) {
        this.logger.debug("NoteGenerator", `AI token usage for "${term}"`, {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          finishReason: data.choices[0].finish_reason,
        });
      }
      const truncated = data.choices[0].finish_reason === 'length';
      if (truncated) this.logger.warn("NoteGenerator", `AI response for "${term}" was truncated (finish_reason: length)`);
      return { text, truncated };
    } catch (error) {
      this.logger.stats.apiErrors++;
      this.logger.error("NoteGenerator", `AI summary request failed for "${term}"`, error);

      if (!this._shownAIError) {
        this._shownAIError = true;
        const status = error?.status;
        let msg = `Vault Wiki: AI call failed`;
        if (status === 401) msg = `Vault Wiki: AI call failed — 401 Unauthorized. Check your API key in Settings → AI Provider.`;
        else if (status === 404) msg = `Vault Wiki: AI call failed — 404. Check your endpoint URL and model name ("${this.settings.modelName}").`;
        else if (status === 429) msg = `Vault Wiki: AI call failed — 429 Rate limited. Slow down or upgrade your plan.`;
        else if (status >= 500) msg = `Vault Wiki: AI call failed — ${status} Server error from ${this.settings.provider}. Try again later.`;
        else if (error?.message?.includes('timeout') || error?.message?.includes('TIMEOUT')) msg = `Vault Wiki: AI call timed out. The model may be overloaded or your endpoint is unreachable.`;
        else if (error?.message) msg = `Vault Wiki: AI call failed — ${error.message}`;
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
    const provider = this.settings.provider;
    const isLMStudioV1 = provider === "lmstudio-v1";

    // ── Anthropic test path ────────────────────────────────────────────────────
    if (provider === "anthropic") {
      if (!this.settings.anthropicApiKey) {
        return { success: false, message: "No Anthropic API key set. Add it in Settings → AI Provider." };
      }
      const t0 = performance.now();
      try {
        const result = await this._callAnthropicAPI("Reply with exactly: OK", "You are a test assistant.", 10);
        const latencyMs = Math.round(performance.now() - t0);
        if (result?.text) {
          return { success: true, message: `✅ Anthropic connected! Model: ${this.settings.modelName} — ${latencyMs}ms`, latencyMs };
        }
        return { success: false, message: "⚠️ Anthropic responded but returned empty content. Check model name." };
      } catch (err) {
        const latencyMs = Math.round(performance.now() - t0);
        return { success: false, message: `❌ Anthropic failed after ${latencyMs}ms — ${err?.message ?? "Unknown error"}` };
      }
    }

    // ── LM Studio native v1 test path ──────────────────────────────────────────
    if (isLMStudioV1) {
      const endpoint = (this.settings.lmstudioV1Endpoint || "http://localhost:1234").replace(/\/+$/, "");
      const endpointError = validateEndpointUrl(endpoint);
      if (endpointError) return { success: false, message: `Invalid LM Studio v1 endpoint: ${endpointError}` };

      // ⚡ reuse cached hwMode
      const hwMode = this._hwMode ?? detectHardwareMode(this.settings);
      const hwLabel = hardwareModeLabel(hwMode);
      const t0 = performance.now();

      try {
        // Step 1: GET /api/v1/models — lists loaded models.
        // This is cheap (no inference), confirms the server is up, and tells us
        // the actual loaded model ID rather than relying on what settings says.
        let loadedModelId = null;
        try {
          const modelsResp = await (0, import_obsidian.requestUrl)({
            url: `${endpoint}/api/v1/models`,
            method: "GET",
            headers: this.settings.lmstudioV1ApiToken
              ? { "Authorization": `Bearer ${this.settings.lmstudioV1ApiToken}` }
              : {},
            timeout: 5000,
          });
          const models = modelsResp.json?.data;
          if (Array.isArray(models) && models.length > 0) {
            loadedModelId = models[0]?.id ?? null;
          } else if (Array.isArray(models) && models.length === 0) {
            return { success: false, message: `⚠️ LM Studio v1: Server is running at ${endpoint} but no model is loaded. Load a model in LM Studio first.` };
          }
        } catch (modelErr) {
          // Server not reachable at all — surface this immediately.
          const latencyMs = Math.round(performance.now() - t0);
          return { success: false, message: `❌ LM Studio v1: Cannot reach ${endpoint}/api/v1/models after ${latencyMs}ms — is LM Studio running? (${modelErr?.message ?? "network error"})` };
        }

        // Step 2: Minimal chat inference to confirm the model responds.
        const client = new LMStudioV1Client(this.settings, this.logger);
        const result = await client.chat("Reply with exactly: OK", null, false);
        const latencyMs = Math.round(performance.now() - t0);
        if (result) {
          const displayModel = loadedModelId ?? this.settings.modelName;
          return {
            success: true,
            message: `✅ LM Studio v1 connected! Loaded model: ${displayModel} — ${latencyMs}ms [${hwLabel}]`,
            latencyMs,
          };
        } else {
          return { success: false, message: `⚠️ LM Studio v1: Server responded but inference returned no content. Is a model loaded at ${endpoint}?` };
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

  /**
   * ⚡ BOLT: Accept precomputed fileCategories from determineBestCategory() so we
   * don't call assignCategory() a second time for the same source files.
   *
   * BEFORE: Iterated contextData.sourceFiles and called assignCategory(file) on each —
   *         same files already processed in determineBestCategory().
   *         On a 500-file vault: 80 terms × ~7 source files = ~560 redundant calls.
   * AFTER:  fileCategories Map (file.path → category) is passed in. Map.get() is O(1).
   *         Falls back to assignCategory() only if fileCategories is absent (e.g.
   *         called from a context that didn't go through determineBestCategory).
   * Impact: ~560 assignCategory() calls eliminated per 80-term generation pass.
   */
  async generateTags(term, contextData, fileCategories = null) {
    const tags = new Set();
    for (const file of contextData.sourceFiles) {
      // ⚡ BOLT B7: fileCategories stores { category, fileTags } — both precomputed
      // by determineBestCategory(). No assignCategory() or getFileCache() call needed.
      const cached = fileCategories?.get(file.path);
      const category = cached?.category ?? this.categoryManager.assignCategory(file);
      for (const tag of (category.tags || [])) tags.add(tag);

      // ⚡ BOLT B7: reuse precomputed fileTags — eliminates second getFileCache() call
      const fileTags = cached?.fileTags
        ?? (0, import_obsidian.getAllTags)(this.app.metadataCache.getFileCache(file))
        ?? [];
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
        // ⚡ reuse cached hwMode
      const hwMode = this._hwMode ?? detectHardwareMode(this.settings);
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

    // ────────────────────────────────────────────────────────────────────────
    // 🎨 PALETTE v0.9.0 — Collapsible section helper
    // Wraps a group of settings in a <details>/<summary> block so the page is
    // scannable rather than an endless scroll. Each section opens/closes with
    // a smooth chevron indicator. `openByDefault` controls initial state.
    // ────────────────────────────────────────────────────────────────────────
    const makeSection = (parent, emoji, title, openByDefault = false) => {
      const details = parent.createEl('details');
      if (openByDefault) details.setAttribute('open', '');
      Object.assign(details.style, {
        margin: '4px 0',
        border: '1px solid var(--background-modifier-border)',
        borderRadius: '8px',
        overflow: 'hidden',
      });

      const summary = details.createEl('summary');
      Object.assign(summary.style, {
        cursor: 'pointer',
        listStyle: 'none',
        display: 'flex',
        alignItems: 'center',
        gap: '0.5em',
        padding: '0.6em 1em',
        background: 'var(--background-secondary)',
        fontWeight: '600',
        fontSize: '0.95em',
        userSelect: 'none',
        borderRadius: '8px',
      });
      summary.setAttribute('aria-label', `${title} settings section`);

      const emojiEl = summary.createEl('span', { text: emoji });
      emojiEl.setAttribute('aria-hidden', 'true');
      summary.createEl('span', { text: title });

      const chevron = summary.createEl('span', { text: '›' });
      Object.assign(chevron.style, {
        marginLeft: 'auto',
        fontSize: '1.1em',
        opacity: '0.4',
        transition: 'transform 0.18s',
        transform: openByDefault ? 'rotate(90deg)' : 'rotate(0deg)',
      });
      details.addEventListener('toggle', () => {
        chevron.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
      });

      const body = details.createDiv();
      Object.assign(body.style, { padding: '0.1em 0.5em 0.7em' });
      return body;
    };

    // ── Header ────────────────────────────────────────────────────────────
    const headerWrap = containerEl.createDiv();
    Object.assign(headerWrap.style, { marginBottom: '1em' });

    const titleRow = headerWrap.createDiv();
    Object.assign(titleRow.style, {
      display: 'flex', alignItems: 'center', gap: '0.6em', flexWrap: 'wrap', marginBottom: '0.3em'
    });
    const h1 = titleRow.createEl('h1', { text: 'Vault Wiki' });
    Object.assign(h1.style, { margin: '0', fontSize: '1.5em' });

    // 🎨 PALETTE: Version badge — orange for "early beta" so it's visible
    const badge = titleRow.createEl('span', { text: 'v0.9.0 · Early Beta' });
    Object.assign(badge.style, {
      fontSize: '0.68em', fontWeight: '700', letterSpacing: '0.04em',
      padding: '0.15em 0.55em', borderRadius: '999px',
      background: 'var(--color-orange, #f97316)',
      color: '#fff', verticalAlign: 'middle',
    });

    headerWrap.createEl('p', {
      text: 'AI-powered wiki generation for Obsidian · by adhdboy411 & Claude',
      cls: 'setting-item-description',
    }).style.cssText = 'margin: 0 0 0.6em; font-size: 0.82em;';

    // 🎨 PALETTE: Beta warning callout — honest about early-beta status
    const betaWarn = headerWrap.createEl('div');
    betaWarn.style.cssText = [
      'background: rgba(249,115,22,0.09);',
      'border-left: 3px solid var(--color-orange, #f97316);',
      'border-radius: 4px; padding: 0.5em 0.85em; margin-bottom: 0.6em;',
      'font-size: 0.81em; color: var(--text-muted);',
    ].join(' ');
    betaWarn.innerHTML = '⚠️ <strong>Early Beta</strong> — functional but not fully hardened. '
      + 'Back up your vault before first run. Report issues to adhdboy411.';

    // 🎨 PALETTE: What's New callout
    const whatsNew = headerWrap.createEl('div');
    whatsNew.style.cssText = [
      'background: var(--background-modifier-hover, rgba(120,80,255,0.07));',
      'border-left: 3px solid var(--interactive-accent, #7c3aed);',
      'border-radius: 4px; padding: 0.5em 0.85em; margin-bottom: 0.6em;',
      'font-size: 0.8em; color: var(--text-muted);',
    ].join(' ');
    whatsNew.innerHTML = '<strong>✨ v0.9.0</strong> &nbsp;'
      + '⚡ <b>stripMarkupForAI()</b> — ~15–30% fewer tokens per call &nbsp;|&nbsp; '
      + '📂 <b>AI Subcategories</b> — auto subject subfolders &nbsp;|&nbsp; '
      + '🗣️ <b>Prompt presets</b> — Small / Balanced / Detailed with live token counts';

    // 🎨 PALETTE: Live status bar — index count + generation state at a glance
    const termCount = this.plugin.termCache?.termIndex?.size ?? 0;
    const gen = this.plugin.generator;
    const statusBar = headerWrap.createEl('div');
    statusBar.style.cssText = [
      'display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap;',
      'background: var(--background-secondary); border-radius: 6px;',
      'padding: 0.4em 0.8em; font-size: 0.82em;',
    ].join(' ');
    statusBar.setAttribute('role', 'status');
    statusBar.setAttribute('aria-live', 'polite');
    const idxChip = statusBar.createEl('span');
    idxChip.innerHTML = termCount > 0
      ? `✅ <strong>${termCount}</strong> terms indexed`
      : '⏳ Index building…';
    const sep = statusBar.createEl('span', { text: '·' });
    sep.style.cssText = 'opacity: 0.3;';
    const genChip = statusBar.createEl('span');
    genChip.textContent = gen?.isPaused ? '⏸ Paused' : '▶ Ready';

    // ── Mode selector (Auto / Manual / Advanced) ────────────────────────────
    // 🎨 PALETTE: Three-button pill toggle at top of settings — prominent enough
    // that users see it immediately, unobtrusive enough not to clutter the page.
    const mode = this.plugin.settings.settingsMode || 'auto';

    const modeSelectorWrap = containerEl.createDiv();
    modeSelectorWrap.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin: 0.6em 0 1em;';
    modeSelectorWrap.createEl('span', { text: 'Mode:' }).style.cssText = 'font-size: 0.82em; font-weight: 600; color: var(--text-muted);';

    const modeGroup = modeSelectorWrap.createEl('div');
    modeGroup.style.cssText = 'display: flex; border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden;';
    modeGroup.setAttribute('role', 'group');
    modeGroup.setAttribute('aria-label', 'Settings complexity mode');

    const modeButtons = [
      ['auto',     '⚡ Auto',     'Smart defaults — auto-configured from hardware and model'],
      ['manual',   '⚙️ Manual',   'All main settings visible and editable'],
      ['advanced', '🔬 Advanced', 'Everything, including performance tuning and diagnostics'],
    ];
    modeButtons.forEach(([val, label, tip]) => {
      const btn = modeGroup.createEl('button', { text: label });
      const active = val === mode;
      btn.style.cssText = [
        'padding: 0.3em 0.8em; font-size: 0.82em; cursor: pointer; border: none;',
        'border-right: 1px solid var(--background-modifier-border);',
        active
          ? 'background: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600;'
          : 'background: var(--background-primary); color: var(--text-normal);',
      ].join(' ');
      btn.title = tip;
      btn.setAttribute('aria-pressed', String(active));
      btn.setAttribute('aria-label', `${label} mode: ${tip}`);
      btn.addEventListener('click', async () => {
        this.plugin.settings.settingsMode = val;
        await this.plugin.saveSettings();
        this.display();
      });
    });

    // Mode description chip
    const modeDesc = modeSelectorWrap.createEl('span');
    const modeDescs = { auto: '— auto-configured from hardware + model', manual: '— all main settings editable', advanced: '— full control + diagnostics' };
    modeDesc.textContent = modeDescs[mode] || '';
    modeDesc.style.cssText = 'font-size: 0.78em; color: var(--text-muted);';

    // ── Auto mode: show a config summary card ────────────────────────────────
    if (mode === 'auto') {
      const hw = detectHardwareMode(this.plugin.settings);
      const ac = getAutoConfig(hw, this.plugin.settings.provider);
      const hwLabel = hardwareModeLabel(hw);
      const presetLabel = { small: '🟢 Small', balanced: '🟡 Balanced', detailed: '🔵 Detailed' }[ac.promptPreset] || ac.promptPreset;
      const depthLabel = { partial: 'Partial (wikilinks)', full: 'Full (+ virtual)', performance: 'Performance (line only)' }[ac.contextDepth] || ac.contextDepth;

      const autoCard = containerEl.createEl('div');
      autoCard.style.cssText = [
        'background: var(--background-secondary); border-radius: 8px;',
        'padding: 0.75em 1em; margin-bottom: 0.75em; font-size: 0.82em;',
        'border: 1px solid var(--background-modifier-border);',
      ].join(' ');
      autoCard.innerHTML = [
        `<div style="font-weight:700; margin-bottom:0.4em;">⚡ Auto Configuration</div>`,
        `<div style="display:grid; grid-template-columns:1fr 1fr; gap:0.3em 1em;">`,
        `<span style="color:var(--text-muted)">Hardware</span><span>${hwLabel}</span>`,
        `<span style="color:var(--text-muted)">Batch size</span><span>${ac.batchSize} notes/batch</span>`,
        `<span style="color:var(--text-muted)">AI context cap</span><span>${(ac.aiContextMaxChars/1000).toFixed(0)}k chars (≈${Math.round(ac.aiContextMaxChars/4).toLocaleString()} tokens)</span>`,
        `<span style="color:var(--text-muted)">Context depth</span><span>${depthLabel}</span>`,
        `<span style="color:var(--text-muted)">Prompt preset</span><span>${presetLabel}</span>`,
        `<span style="color:var(--text-muted)">System prompt</span><span style="font-size:0.9em;color:var(--text-normal);">${(PROMPT_PRESETS[ac.promptPreset]?.system || '').slice(0,60)}…</span>`,
        `</div>`,
        `<div style="margin-top:0.5em;color:var(--text-muted);font-size:0.9em;">`,
        `Switch to <strong>Manual</strong> or <strong>Advanced</strong> mode to override any of these.`,
        `</div>`,
      ].join('');
    }

    // ── 🚀 Quick Actions (always visible — no collapse) ────────────────────
    containerEl.createEl('h2', { text: 'Quick Actions' }).style.cssText =
      'margin: 0.8em 0 0.4em; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted);';

    // 🎨 PALETTE: Prominent Generate + Reindex buttons
    const actionRow = containerEl.createDiv();
    actionRow.style.cssText = 'display: flex; gap: 0.5em; flex-wrap: wrap; margin-bottom: 0.4em;';

    const genBtn = actionRow.createEl('button', { text: '▶ Generate Now' });
    genBtn.style.cssText = 'padding: 0.4em 1em; border-radius: 6px; cursor: pointer; font-weight: 600; background: var(--interactive-accent); color: var(--text-on-accent); border: none; font-size: 0.88em;';
    genBtn.setAttribute('aria-label', 'Start wiki note generation');
    genBtn.addEventListener('click', () => this.plugin.generateWikiNotes());

    const reindexBtn = actionRow.createEl('button', { text: '🔄 Reindex' });
    reindexBtn.style.cssText = 'padding: 0.4em 0.8em; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); font-size: 0.88em; background: var(--background-primary);';
    reindexBtn.setAttribute('aria-label', 'Rebuild term index from scratch');
    reindexBtn.addEventListener('click', async () => {
      reindexBtn.textContent = 'Indexing…';
      reindexBtn.disabled = true;
      try {
        await this.plugin.termCache.buildIndex();
        const cnt = this.plugin.termCache.termIndex.size;
        this.plugin._setStatus(`📖 Vault Wiki: ${cnt} terms`);
        new import_obsidian.Notice(`Reindex complete — ${cnt} terms.`);
        this.display();
      } finally {
        reindexBtn.textContent = '🔄 Reindex';
        reindexBtn.disabled = false;
      }
    });

    // 🎨 PALETTE: Pause/Resume/Cancel in a compact row with clear visual hierarchy
    const genStatusEl = containerEl.createEl('p');
    genStatusEl.style.cssText = 'font-size: 0.8em; color: var(--text-muted); margin: 0.2em 0;';
    const updateGenStatus = () => {
      if (!gen) { genStatusEl.setText('⏳ Generator not ready'); return; }
      genStatusEl.setText(gen.isPaused ? '⏸ Generation is PAUSED' : '▶ Generator idle');
    };
    updateGenStatus();

    const ctrlRow = containerEl.createDiv();
    ctrlRow.style.cssText = 'display: flex; gap: 0.4em; flex-wrap: wrap; margin-bottom: 1em;';
    const makeCtrlBtn = (text, ariaLabel, onClick, danger = false) => {
      const b = ctrlRow.createEl('button', { text });
      b.style.cssText = `padding: 0.25em 0.7em; border-radius: 5px; cursor: pointer; font-size: 0.8em; border: 1px solid var(--background-modifier-border); background: var(--background-primary); ${danger ? 'color: var(--color-red, #dc2626);' : ''}`;
      b.setAttribute('aria-label', ariaLabel);
      b.addEventListener('click', onClick);
      return b;
    };
    makeCtrlBtn('⏸ Pause', 'Pause generation between batches', () => { this.plugin.generator?.pause(); new import_obsidian.Notice('Generation paused.'); updateGenStatus(); });
    makeCtrlBtn('▶ Resume', 'Resume paused generation', () => { this.plugin.generator?.resume(); new import_obsidian.Notice('Generation resumed.'); updateGenStatus(); });
    makeCtrlBtn('⏹ Cancel', 'Cancel and stop generation entirely', () => { this.plugin.generator?.cancel(); new import_obsidian.Notice('Generation cancelled.'); updateGenStatus(); }, true);

    new import_obsidian.Setting(containerEl)
      .setName('Auto-Update Existing Notes')
      .setDesc('Re-generate notes whose source files changed since last run, or that are missing an AI summary.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.autoUpdateExistingNotes ?? true)
        .onChange(async (value) => {
          this.plugin.settings.autoUpdateExistingNotes = value;
          await this.plugin.saveSettings();
        }));

    // ── 🤖 AI Provider section ─────────────────────────────────────────────
    const aiSec = makeSection(containerEl, '🤖', 'AI Provider', true);

    new import_obsidian.Setting(aiSec)
      .setName('Provider')
      .setDesc('Which AI service to use. LM Studio (Native v1) is recommended for local use — stateful, streaming, hardware-optimised.')
      .addDropdown(dd => {
        // Dynamically build from PROVIDERS table so the dropdown and logic stay in sync
        for (const p of PROVIDERS) {
          dd.addOption(p.id, `${p.emoji} ${p.label}`);
        }
        dd.setValue(this.plugin.settings.provider)
        .onChange(async (value) => {
          this.plugin.settings.provider = value;
          const pCfg = PROVIDER_MAP.get(value);
          if (pCfg) {
            // Auto-fill endpoint/model only if the current values look like defaults
            const curEndpoint = this.plugin.settings.openaiEndpoint || '';
            const defaultEndpoints = PROVIDERS.map(p => p.defaultEndpoint).filter(Boolean);
            const isDefaultEndpoint = defaultEndpoints.includes(curEndpoint) || curEndpoint === '';
            if (isDefaultEndpoint && pCfg.defaultEndpoint && value !== 'lmstudio-v1') {
              this.plugin.settings.openaiEndpoint = pCfg.defaultEndpoint;
            }
            if (pCfg.defaultModel) {
              this.plugin.settings.modelName = pCfg.defaultModel;
            } else if (value === 'lmstudio-openai' || value === 'lmstudio-v1') {
              this.plugin.settings.modelName = getDefaultModelForHardware(detectHardwareMode(this.plugin.settings));
            }
            if (value === 'lmstudio-v1' && pCfg.defaultEndpoint) {
              this.plugin.settings.lmstudioV1Endpoint = pCfg.defaultEndpoint;
            }
          }
          await this.plugin.saveSettings();
          this.display();
        });
        return dd;
      });

    const provider = this.plugin.settings.provider;
    const isV1 = provider === 'lmstudio-v1';
    const isLMStudio = isV1 || provider === 'lmstudio-openai';

    // ── LM Studio v1 settings ──────────────────────────────────────────────
    if (isV1) {
      const hwMode = detectHardwareMode(this.plugin.settings);
      const hwLabel = hardwareModeLabel(hwMode);
      const v1InfoEl = aiSec.createEl('div');
      v1InfoEl.style.cssText = 'background: rgba(34,197,94,0.09); border: 1px solid rgba(34,197,94,0.3); border-radius: 6px; padding: 0.6em 0.9em; margin: 0.5em 0; font-size: 0.81em;';
      v1InfoEl.innerHTML = `✅ <strong>LM Studio Native v1</strong> — stateful, SSE streaming.<br>Hardware: <strong>${hwLabel}</strong> · Model: <code>${getDefaultModelForHardware(hwMode)}</code>`;

      new import_obsidian.Setting(aiSec).setName('LM Studio Endpoint').setDesc('Base URL (no trailing /api/v1).')
        .addText(t => { t.inputEl.placeholder = 'http://localhost:1234'; t.setValue(this.plugin.settings.lmstudioV1Endpoint || 'http://localhost:1234').onChange(async v => { this.plugin.settings.lmstudioV1Endpoint = v.trim().replace(/\/+$/, ''); await this.plugin.saveSettings(); }); });

      new import_obsidian.Setting(aiSec).setName('API Token').setDesc('Optional Bearer token (LM Studio → Developer).')
        .addText(t => { t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.inputEl.placeholder = '(leave blank if no auth)'; t.setValue(this.plugin.settings.lmstudioV1ApiToken || '').onChange(async v => { this.plugin.settings.lmstudioV1ApiToken = v; await this.plugin.saveSettings(); }); });

      new import_obsidian.Setting(aiSec).setName('Stateful Conversations').setDesc('Reuse response_id across calls — saves tokens on long sessions.')
        .addToggle(t => t.setValue(this.plugin.settings.lmstudioV1Stateful !== false).onChange(async v => { this.plugin.settings.lmstudioV1Stateful = v; this.plugin.settings.lmstudioV1LastResponseId = null; await this.plugin.saveSettings(); }));

      new import_obsidian.Setting(aiSec).setName('SSE Streaming').setDesc('Stream tokens as they are generated. Disable if you see parsing issues.')
        .addToggle(t => t.setValue(this.plugin.settings.lmstudioV1StreamingEnabled !== false).onChange(async v => { this.plugin.settings.lmstudioV1StreamingEnabled = v; await this.plugin.saveSettings(); }));

      new import_obsidian.Setting(aiSec).setName('Reset Thread').setDesc('Clear the stored response_id — next call starts a fresh conversation.')
        .addButton(btn => btn.setButtonText('↺ Reset Thread').onClick(async () => { this.plugin.settings.lmstudioV1LastResponseId = null; this.plugin.generator?._lmstudioV1?.resetThread(); await this.plugin.saveSettings(); new import_obsidian.Notice('Thread reset.', 3000); }));
    }

    // ── Hardware Optimization Mode (LM Studio only) ────────────────────────
    if (isLMStudio) {
      const hwSec = makeSection(aiSec, '⚙️', 'Hardware Optimization', false);
      const autoMode = detectHardwareMode({ ...this.plugin.settings, hardwareMode: 'auto' });
      new import_obsidian.Setting(hwSec).setName('Hardware Mode')
        .setDesc('Tunes context length and batch parameters. Auto-detects your platform.')
        .addDropdown(dd => dd
          .addOption('auto', `Auto-detect (currently: ${hardwareModeLabel(autoMode)})`)
          .addOption('cpu',     '💻 CPU / Integrated GPU')
          .addOption('gpu',     '🖥️ Discrete GPU')
          .addOption('android', '📱 Android')
          .addOption('ios',     '🍎 iPhone / iPad')
          .setValue(this.plugin.settings.hardwareMode || 'auto')
          .onChange(async v => { this.plugin.settings.hardwareMode = v; await this.plugin.saveSettings(); new import_obsidian.Notice(`Hardware mode → ${hardwareModeLabel(detectHardwareMode(this.plugin.settings))}`, 3000); }));
      new import_obsidian.Setting(hwSec).setName('Show in Status Bar')
        .addToggle(t => t.setValue(this.plugin.settings.showHardwareModeInStatus !== false).onChange(async v => { this.plugin.settings.showHardwareModeInStatus = v; await this.plugin.saveSettings(); }));
    }

    // ── Anthropic-specific settings ───────────────────────────────────────────
    if (provider === 'anthropic') {
      const anthropicInfoEl = aiSec.createEl('div');
      anthropicInfoEl.style.cssText = 'background: rgba(234,88,12,0.08); border: 1px solid rgba(234,88,12,0.3); border-radius: 6px; padding: 0.6em 0.9em; margin: 0.5em 0; font-size: 0.81em;';
      anthropicInfoEl.innerHTML = `🔶 <strong>Anthropic Claude</strong> — native Messages API (not OpenAI-compatible).<br>Get your key at <a href="https://console.anthropic.com" target="_blank">console.anthropic.com</a>. Keys start with <code>sk-ant-…</code>`;

      new import_obsidian.Setting(aiSec).setName('Anthropic API Key')
        .setDesc('Stored locally in data.json — never sent anywhere except api.anthropic.com over HTTPS.')
        .addText(t => {
          t.inputEl.type = 'password';
          t.inputEl.autocomplete = 'off';
          t.inputEl.placeholder = 'sk-ant-…';
          t.setValue(this.plugin.settings.anthropicApiKey || '');
          t.onChange(async v => {
            // 🛡️ SENTINEL: trim silently — leading/trailing spaces in keys cause 401s
            this.plugin.settings.anthropicApiKey = v.trim();
            await this.plugin.saveSettings();
          });
        });
    }

    // ── Standard endpoint / key (non-v1, non-Anthropic providers) ────────────
    if (!isV1 && provider !== 'anthropic') {
      const pCfg = PROVIDER_MAP.get(provider);
      const endpointPlaceholders = Object.fromEntries(
        PROVIDERS.filter(p => p.defaultEndpoint).map(p => [p.id, p.defaultEndpoint])
      );
      endpointPlaceholders.custom = 'https://your-api/v1';

      new import_obsidian.Setting(aiSec).setName('API Endpoint').setDesc('Full URL to the /v1 endpoint.')
        .addText(t => {
          t.inputEl.placeholder = endpointPlaceholders[provider] ?? '';
          t.setValue(this.plugin.settings.openaiEndpoint);
          t.onChange(async v => { this.plugin.settings.openaiEndpoint = v.trim(); await this.plugin.saveSettings(); });
        });

      if (pCfg?.requiresKey) {
        new import_obsidian.Setting(aiSec).setName('API Key').setDesc('Stored locally in data.json — never sent anywhere except your configured endpoint.')
          .addText(t => {
            t.inputEl.type = 'password';
            t.inputEl.autocomplete = 'off';
            t.setValue(this.plugin.settings.openaiApiKey);
            t.onChange(async v => {
              this.plugin.settings.openaiApiKey = v.trim(); // 🛡️ SENTINEL: trim silently
              await this.plugin.saveSettings();
            });
          });
      }
    } // end !isV1 && !anthropic

    // 🎨 PALETTE: Model name field + quick-pick suggestions from provider table
    const modelSetting = new import_obsidian.Setting(aiSec)
      .setName('Model Name')
      .setDesc('ID of the model to use for note generation.');
    const pCfgSuggestions = PROVIDER_MAP.get(provider);
    if (pCfgSuggestions?.models?.length) {
      // Add a datalist for model name suggestions
      modelSetting.addDropdown(dd => {
        dd.addOption('', '— type a custom model ID below —');
        for (const m of pCfgSuggestions.models) dd.addOption(m, m);
        dd.setValue(pCfgSuggestions.models.includes(this.plugin.settings.modelName) ? this.plugin.settings.modelName : '');
        dd.onChange(async v => {
          if (!v) return;
          this.plugin.settings.modelName = v;
          await this.plugin.saveSettings();
          this.display();
        });
      });
    }
    modelSetting.addText(t => {
      t.inputEl.placeholder = getDefaultModelForHardware(detectHardwareMode(this.plugin.settings));
      t.setValue(this.plugin.settings.modelName);
      // 🛡️ SENTINEL: validate model name — reject empty or whitespace-only
      t.onChange(async v => {
        const trimmed = v.trim();
        if (!trimmed) return; // don't save empty model name
        if (trimmed.length > 200) return; // DoS guard
        this.plugin.settings.modelName = trimmed;
        await this.plugin.saveSettings();
        new import_obsidian.Notice(`Model → "${trimmed}"`, 2500);
      });
    });

    // ── Test Connection row ────────────────────────────────────────────────
    const testResultEl = aiSec.createEl('p');
    testResultEl.style.cssText = 'font-size: 0.81em; color: var(--text-muted); margin: 0.2em 0;';
    testResultEl.textContent = 'Click Test to verify your AI connection.';

    const testRow = aiSec.createDiv();
    testRow.style.cssText = 'display: flex; gap: 0.5em; flex-wrap: wrap; margin-top: 0.3em;';

    // 🎨 PALETTE: Loading state on Test Connection — disables button while request in flight
    const testBtn = testRow.createEl('button', { text: '🔌 Test Connection' });
    testBtn.style.cssText = 'padding: 0.35em 0.8em; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); color: var(--interactive-accent); font-size: 0.84em; background: var(--background-primary);';
    testBtn.setAttribute('aria-label', 'Test AI provider connection');
    testBtn.addEventListener('click', async () => {
      testBtn.textContent = '⏳ Testing…';
      testBtn.disabled = true;
      testResultEl.style.color = 'var(--text-muted)';
      try {
        const r = await this.plugin.testAIConnection();
        testResultEl.textContent = r.message;
        testResultEl.style.color = r.success ? 'var(--color-green, #16a34a)' : 'var(--color-red, #dc2626)';
      } finally {
        testBtn.textContent = '🔌 Test Connection';
        testBtn.disabled = false;
      }
    });

    if (provider === 'mistral' || provider === 'openai') {
      const findBtn = testRow.createEl('button', { text: '🔍 Find Best Model' });
      findBtn.style.cssText = 'padding: 0.35em 0.8em; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); font-size: 0.84em; background: var(--background-primary);';
      findBtn.setAttribute('aria-label', 'Scan for the best working Mistral model');
      findBtn.addEventListener('click', async () => {
        findBtn.textContent = '⏳ Scanning…';
        findBtn.disabled = true;
        try {
          const r = await this.plugin.findWorkingMistralModel();
          testResultEl.textContent = r.message;
          testResultEl.style.color = r.success ? 'var(--color-green, #16a34a)' : 'var(--color-red, #dc2626)';
          if (r.success) this.display();
        } finally {
          findBtn.textContent = '🔍 Find Best Model';
          findBtn.disabled = false;
        }
      });
    }

    // ── AI Prompts — Manual + Advanced only (Auto uses computed preset) ─────
    // 🎨 PALETTE: Prompts get their own labelled section with:
    //   • Preset picker (Small / Balanced / Detailed / Custom)
    //   • Live ≈ token count on each textarea
    //   • Reset-to-preset button per field
    // ⚡ BOLT: Smaller models (1–3B) need ultra-short prompts to avoid confusion.
    //   The "Small" preset trims ~20 prompt tokens vs. the previous default.
    if (mode !== 'auto') {
    const promptSec = makeSection(aiSec, '🗣️', 'AI Prompts', false);

    // Preset selector
    const currentPreset = detectPromptPreset(
      this.plugin.settings.systemPrompt,
      this.plugin.settings.userPromptTemplate
    );

    // ⚡ Token estimate helper (~1 token per 4 chars — good enough for display)
    const estTokens = (str) => Math.round((str || '').length / 4);

    const presetInfoEl = promptSec.createEl('div');
    presetInfoEl.style.cssText = [
      'background: var(--background-secondary); border-radius: 6px;',
      'padding: 0.5em 0.85em; margin-bottom: 0.6em; font-size: 0.81em;',
    ].join(' ');

    const renderPresetInfo = (key) => {
      const p = PROMPT_PRESETS[key];
      presetInfoEl.innerHTML = p
        ? `<strong>${p.label}</strong> — ${p.desc}`
        : '✏️ <strong>Custom</strong> — manually edited prompts.';
    };
    renderPresetInfo(currentPreset);

    // Preset dropdown row
    const presetRow = promptSec.createDiv();
    presetRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap; margin-bottom: 0.75em;';
    presetRow.createEl('label', { text: 'Preset:' }).style.cssText = 'font-size: 0.85em; font-weight: 600;';

    const presetSelect = presetRow.createEl('select');
    presetSelect.style.cssText = 'padding: 0.25em 0.5em; border-radius: 5px; font-size: 0.85em; border: 1px solid var(--background-modifier-border); background: var(--background-primary); cursor: pointer;';
    presetSelect.setAttribute('aria-label', 'Select a prompt preset');

    [['small', '🟢 Small (1–3B)'], ['balanced', '🟡 Balanced (7B)'], ['detailed', '🔵 Detailed (13B+)'], ['custom', '✏️ Custom']].forEach(([val, lbl]) => {
      const opt = presetSelect.createEl('option', { text: lbl, value: val });
      if (val === currentPreset) opt.selected = true;
    });

    const applyPresetBtn = presetRow.createEl('button', { text: 'Apply' });
    applyPresetBtn.style.cssText = 'padding: 0.25em 0.7em; border-radius: 5px; font-size: 0.82em; cursor: pointer; background: var(--interactive-accent); color: var(--text-on-accent); border: none;';
    applyPresetBtn.setAttribute('aria-label', 'Apply selected preset to prompts');

    // Textarea refs (populated below, used in apply handler)
    let sysTextarea = null;
    let userTextarea = null;

    applyPresetBtn.addEventListener('click', async () => {
      const key = presetSelect.value;
      const preset = PROMPT_PRESETS[key];
      if (!preset) return;
      this.plugin.settings.systemPrompt = preset.system;
      this.plugin.settings.userPromptTemplate = preset.user;
      await this.plugin.saveSettings();
      if (sysTextarea)  { sysTextarea.value = preset.system;  sysTokenEl.textContent  = `≈ ${estTokens(preset.system)} tokens`; }
      if (userTextarea) { userTextarea.value = preset.user;   userTokenEl.textContent = `≈ ${estTokens(preset.user)} tokens`; }
      renderPresetInfo(key);
      new import_obsidian.Notice(`Prompts set to ${preset.label}`, 2500);
    });

    // Update info on dropdown change (before Apply)
    presetSelect.addEventListener('change', () => renderPresetInfo(presetSelect.value));

    // ── System prompt field ───────────────────────────────────────────────
    const sysWrap = promptSec.createDiv();
    sysWrap.style.cssText = 'margin-bottom: 0.75em;';
    const sysHeaderRow = sysWrap.createDiv();
    sysHeaderRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.3em;';
    sysHeaderRow.createEl('span', { text: 'System Prompt' }).style.cssText = 'font-weight: 600; font-size: 0.9em;';
    const sysTokenEl = sysHeaderRow.createEl('span', { text: `≈ ${estTokens(this.plugin.settings.systemPrompt)} tokens` });
    sysTokenEl.style.cssText = 'font-size: 0.75em; color: var(--text-muted); margin-left: auto; font-family: var(--font-monospace);';

    const sysArea = sysWrap.createEl('textarea');
    sysArea.value = this.plugin.settings.systemPrompt;
    sysArea.rows = 3;
    sysArea.style.cssText = 'width: 100%; font-size: 0.83em; resize: vertical; border-radius: 4px; padding: 0.4em; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-family: var(--font-monospace);';
    sysArea.setAttribute('aria-label', 'System prompt for wiki note generation');
    sysArea.setAttribute('placeholder', 'Write a clear wiki summary. Bold key terms with **asterisks**.');
    sysTextarea = sysArea;
    sysArea.addEventListener('input', async () => {
      this.plugin.settings.systemPrompt = sysArea.value;
      sysTokenEl.textContent = `≈ ${estTokens(sysArea.value)} tokens`;
      // Mark preset as custom when manually edited
      presetSelect.value = 'custom';
      renderPresetInfo('custom');
      await this.plugin.saveSettings();
    });

    const sysResetBtn = sysWrap.createEl('button', { text: '↺ Reset to preset' });
    sysResetBtn.style.cssText = 'margin-top: 0.25em; font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 4px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted);';
    sysResetBtn.setAttribute('aria-label', 'Reset system prompt to selected preset value');
    sysResetBtn.addEventListener('click', async () => {
      const preset = PROMPT_PRESETS[presetSelect.value];
      if (!preset) return;
      this.plugin.settings.systemPrompt = preset.system;
      sysArea.value = preset.system;
      sysTokenEl.textContent = `≈ ${estTokens(preset.system)} tokens`;
      await this.plugin.saveSettings();
    });

    // ── User prompt template field ────────────────────────────────────────
    const userWrap = promptSec.createDiv();
    userWrap.style.cssText = 'margin-bottom: 0.5em;';
    const userHeaderRow = userWrap.createDiv();
    userHeaderRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.3em;';
    userHeaderRow.createEl('span', { text: 'User Prompt Template' }).style.cssText = 'font-weight: 600; font-size: 0.9em;';
    const userTokenEl = userHeaderRow.createEl('span', { text: `≈ ${estTokens(this.plugin.settings.userPromptTemplate)} tokens` });
    userTokenEl.style.cssText = 'font-size: 0.75em; color: var(--text-muted); margin-left: auto; font-family: var(--font-monospace);';
    userWrap.createEl('p', { text: 'Use {{term}} and {{context}} as placeholders. {{context}} is replaced with the compressed vault context.' }).style.cssText = 'font-size: 0.78em; color: var(--text-muted); margin: 0 0 0.3em;';

    const userArea = userWrap.createEl('textarea');
    userArea.value = this.plugin.settings.userPromptTemplate;
    userArea.rows = 4;
    userArea.style.cssText = sysArea.style.cssText;
    userArea.setAttribute('aria-label', 'User prompt template for wiki note generation');
    userArea.setAttribute('placeholder', 'Summarize "{{term}}" based on the context below.\n\n{{context}}');
    userTextarea = userArea;
    userArea.addEventListener('input', async () => {
      this.plugin.settings.userPromptTemplate = userArea.value;
      userTokenEl.textContent = `≈ ${estTokens(userArea.value)} tokens`;
      presetSelect.value = 'custom';
      renderPresetInfo('custom');
      await this.plugin.saveSettings();
    });

    const userResetBtn = userWrap.createEl('button', { text: '↺ Reset to preset' });
    userResetBtn.style.cssText = sysResetBtn.style.cssText;
    userResetBtn.setAttribute('aria-label', 'Reset user prompt template to selected preset value');
    userResetBtn.addEventListener('click', async () => {
      const preset = PROMPT_PRESETS[presetSelect.value];
      if (!preset) return;
      this.plugin.settings.userPromptTemplate = preset.user;
      userArea.value = preset.user;
      userTokenEl.textContent = `≈ ${estTokens(preset.user)} tokens`;
      await this.plugin.saveSettings();
    });

    } // end if(mode !== 'auto') for AI Prompts

    // ── 📁 Organization section ────────────────────────────────────────────
    const orgSec = makeSection(containerEl, '📁', 'Organization', true);

    new import_obsidian.Setting(orgSec).setName('Wiki Directory').setDesc('Vault folder where all wiki notes are saved.')
      .addText(t => { t.inputEl.placeholder = 'Wiki'; t.setValue(this.plugin.settings.customDirectoryName).onChange(async v => { this.plugin.settings.customDirectoryName = v; await this.plugin.saveSettings(); }); });

    new import_obsidian.Setting(orgSec).setName('Use Categories').setDesc('Organise notes into subject subfolders based on tags, keywords, or source path.')
      .addToggle(toggle => toggle.setValue(this.plugin.settings.useCategories).onChange(async (value) => { this.plugin.settings.useCategories = value; await this.plugin.saveSettings(); this.display(); }));

    if (this.plugin.settings.useCategories) {
      // ── Category list ────────────────────────────────────────────────────
      orgSec.createEl('p', {
        text: 'Priority order: Source Folder → Tags → Keywords → Default.',
        cls: 'setting-item-description',
      });

      const catListEl = orgSec.createDiv();
      const renderCategoryList = () => {
        catListEl.empty();
        const cats = this.plugin.settings.categories || [];
        if (cats.length === 0) {
          catListEl.createEl('p', { text: 'No categories yet. Add one below.', cls: 'setting-item-description' });
        }
        cats.forEach((cat, idx) => {
          const box = catListEl.createDiv();
          box.style.cssText = 'border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;';
          const hdrRow = box.createDiv();
          hdrRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.5em;';
          hdrRow.createEl('strong', { text: cat.name || '(unnamed)' });

          const enabledLbl = hdrRow.createEl('label');
          enabledLbl.style.cssText = 'display: flex; align-items: center; gap: 0.3em; font-size: 0.82em; color: var(--text-muted); margin-left: auto; cursor: pointer;';
          const enabledChk = enabledLbl.createEl('input');
          enabledChk.type = 'checkbox'; enabledChk.checked = cat.enabled !== false;
          enabledChk.setAttribute('aria-label', `Enable ${cat.name} category`);
          enabledLbl.append('Enabled');
          enabledChk.addEventListener('change', async () => { this.plugin.settings.categories[idx].enabled = enabledChk.checked; await this.plugin.saveSettings(); });

          const delBtn = hdrRow.createEl('button', { text: '✕' });
          delBtn.style.cssText = 'padding: 0.1em 0.45em; border-radius: 4px; cursor: pointer; color: var(--color-red, #dc2626); border: 1px solid currentColor; font-size: 0.75em; background: transparent;';
          delBtn.setAttribute('aria-label', `Remove ${cat.name} category`);
          delBtn.addEventListener('click', async () => {
            this.plugin.settings.categories.splice(idx, 1);
            if (this.plugin.settings.defaultCategory === cat.name)
              this.plugin.settings.defaultCategory = this.plugin.settings.categories[0]?.name || '';
            await this.plugin.saveSettings();
            this.plugin.categoryManager?._buildCategoryMap();
            renderCategoryList();
          });

          const addField = (label, desc, val, ph, saveFn) => new import_obsidian.Setting(box).setName(label).setDesc(desc)
            .addText(t => t.setPlaceholder(ph).setValue(val || '').onChange(async v => { await saveFn(v); this.plugin.categoryManager?._buildCategoryMap(); }));

          addField('Name', '', cat.name, 'e.g. Neuroscience', async v => { this.plugin.settings.categories[idx].name = v; await this.plugin.saveSettings(); });
          addField('Path', 'Vault folder for notes in this category', cat.path, 'e.g. Wiki/Neuroscience', async v => { this.plugin.settings.categories[idx].path = v; await this.plugin.saveSettings(); });
          addField('Source Folder', 'Route notes from this folder to this category', cat.sourceFolder, 'e.g. Notes/Neuro/', async v => { this.plugin.settings.categories[idx].sourceFolder = v; await this.plugin.saveSettings(); });
          addField('Tags', 'Comma-separated tags that trigger this category', (cat.tags || []).join(', '), 'e.g. neuroscience, biology', async v => { this.plugin.settings.categories[idx].tags = v.split(',').map(s => s.trim()).filter(Boolean); await this.plugin.saveSettings(); });
          addField('Keywords', 'Comma-separated keywords matched against filenames', (cat.keywords || []).join(', '), 'e.g. neuron, synapse', async v => { this.plugin.settings.categories[idx].keywords = v.split(',').map(s => s.trim()).filter(Boolean); await this.plugin.saveSettings(); });
        });
      };
      renderCategoryList();

      new import_obsidian.Setting(orgSec).addButton(btn => btn.setButtonText('＋ Add Category').setCta().onClick(async () => {
        this.plugin.settings.categories.push({ name: 'New Category', path: 'Wiki/New Category', sourceFolder: '', tags: [], keywords: [], enabled: true });
        await this.plugin.saveSettings(); this.plugin.categoryManager?._buildCategoryMap(); renderCategoryList();
      }));

      const catNames = (this.plugin.settings.categories || []).map(c => c.name);
      if (catNames.length > 0) {
        new import_obsidian.Setting(orgSec).setName('Default Category').setDesc('Fallback when no rule matches.')
          .addDropdown(dd => { catNames.forEach(n => dd.addOption(n, n)); dd.setValue(this.plugin.settings.defaultCategory || catNames[0]).onChange(async v => { this.plugin.settings.defaultCategory = v; await this.plugin.saveSettings(); }); });
      }
    }

    // ── 📂 AI Subcategories — Manual + Advanced only ───────────────────────
    if (mode !== 'auto') {
    const subcatSec = makeSection(containerEl, '📂', 'AI Subcategories', false);

    const subcatInfo = subcatSec.createEl('div');
    subcatInfo.style.cssText = 'background: rgba(99,102,241,0.08); border-left: 3px solid var(--interactive-accent); border-radius: 4px; padding: 0.5em 0.85em; margin-bottom: 0.6em; font-size: 0.8em; color: var(--text-muted);';
    subcatInfo.innerHTML = '<strong>How it works:</strong> Within each main category the AI creates subject subfolders automatically. '
      + 'E.g. <code>Wiki/Anatomy/Electrophysiology/Action Potential.md</code>. '
      + 'One small API call per unique term — session-cached. The classifier reuses existing folder names to keep related terms grouped.';

    new import_obsidian.Setting(subcatSec).setName('Enable AI Subcategories')
      .setDesc('Requires a working AI provider and "Use Categories" enabled above.')
      .addToggle(t => t.setValue(this.plugin.settings.aiSubcategoriesEnabled ?? false).onChange(async v => { this.plugin.settings.aiSubcategoriesEnabled = v; await this.plugin.saveSettings(); this.display(); }));

    if (this.plugin.settings.aiSubcategoriesEnabled) {
      const g2 = this.plugin.generator;
      if (g2?._subcatByCategory?.size > 0) {
        const summaryEl = subcatSec.createEl('div');
        summaryEl.style.cssText = 'background: var(--background-secondary); border-radius: 5px; padding: 0.5em 0.8em; font-size: 0.8em; margin-bottom: 0.5em;';
        const lines = [];
        for (const [cat, subcats] of g2._subcatByCategory) lines.push(`<strong>${cat}:</strong> ${Array.from(subcats).join(', ')}`);
        summaryEl.innerHTML = '📂 <strong>Session subcategories:</strong><br>' + lines.join('<br>');
      }

      new import_obsidian.Setting(subcatSec).setName('Context Characters').setDesc('Characters of note context sent to the classifier. 600 is plenty — more wastes tokens.')
        .addSlider(s => s.setLimits(100, 2000, 100).setValue(this.plugin.settings.aiSubcategoryContextChars ?? 600).setDynamicTooltip().onChange(async v => { this.plugin.settings.aiSubcategoryContextChars = v; await this.plugin.saveSettings(); }));

      // ── Classifier prompt with preset shortcuts ─────────────────────────
      const subcatPromptWrap = subcatSec.createDiv();
      subcatPromptWrap.style.cssText = 'margin: 0.25em 0 0.75em;';

      const subcatHdrRow = subcatPromptWrap.createDiv();
      subcatHdrRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap; margin-bottom: 0.3em;';
      subcatHdrRow.createEl('span', { text: 'Classifier System Prompt' }).style.cssText = 'font-weight: 600; font-size: 0.88em;';
      const subcatTokenEl = subcatHdrRow.createEl('span');
      const curSubcatPrompt = this.plugin.settings.aiSubcategorySystemPrompt || PROMPT_PRESETS.balanced.subcatSystem;
      subcatTokenEl.textContent = `≈ ${Math.round(curSubcatPrompt.length / 4)} tokens`;
      subcatTokenEl.style.cssText = 'font-size: 0.75em; color: var(--text-muted); margin-left: auto; font-family: var(--font-monospace);';

      subcatPromptWrap.createEl('p', { text: 'Keep terse — the model only outputs a 2–4 word folder name. Shorter = faster + cheaper.' }).style.cssText = 'font-size: 0.78em; color: var(--text-muted); margin: 0 0 0.3em;';

      // Quick-set buttons for each preset's subcategory prompt
      const subcatPresetRow = subcatPromptWrap.createDiv();
      subcatPresetRow.style.cssText = 'display: flex; gap: 0.35em; flex-wrap: wrap; margin-bottom: 0.4em;';
      subcatPresetRow.createEl('span', { text: 'Set to:' }).style.cssText = 'font-size: 0.78em; color: var(--text-muted); align-self: center;';

      let subcatArea = null;
      Object.entries(PROMPT_PRESETS).forEach(([key, preset]) => {
        const btn = subcatPresetRow.createEl('button', { text: preset.label.replace(/^[^ ]+ /, '') });
        btn.style.cssText = 'padding: 0.18em 0.55em; border-radius: 4px; font-size: 0.76em; cursor: pointer; border: 1px solid var(--background-modifier-border); background: var(--background-primary);';
        btn.setAttribute('aria-label', `Set classifier prompt to ${key} preset`);
        btn.addEventListener('click', async () => {
          this.plugin.settings.aiSubcategorySystemPrompt = preset.subcatSystem;
          if (subcatArea) {
            subcatArea.value = preset.subcatSystem;
            subcatTokenEl.textContent = `≈ ${Math.round(preset.subcatSystem.length / 4)} tokens`;
          }
          await this.plugin.saveSettings();
          new import_obsidian.Notice(`Classifier prompt → ${key}`, 2000);
        });
      });

      const subcatAreaEl = subcatPromptWrap.createEl('textarea');
      subcatAreaEl.value = curSubcatPrompt;
      subcatAreaEl.rows = 2;
      subcatAreaEl.style.cssText = 'width: 100%; font-size: 0.82em; resize: vertical; border-radius: 4px; padding: 0.4em; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-family: var(--font-monospace);';
      subcatAreaEl.setAttribute('aria-label', 'Classifier system prompt for AI subcategory naming');
      subcatArea = subcatAreaEl;
      subcatAreaEl.addEventListener('input', async () => {
        this.plugin.settings.aiSubcategorySystemPrompt = subcatAreaEl.value;
        subcatTokenEl.textContent = `≈ ${Math.round(subcatAreaEl.value.length / 4)} tokens`;
        await this.plugin.saveSettings();
      });

      new import_obsidian.Setting(subcatSec).setName('Clear Subcategory Cache').setDesc('Forces reclassification of all terms on the next run.')
        .addButton(btn => btn.setButtonText('🗑 Clear Cache').setWarning().onClick(() => {
          if (this.plugin.generator) { this.plugin.generator._subcatCache.clear(); this.plugin.generator._subcatByCategory.clear(); }
          new import_obsidian.Notice('Subcategory cache cleared.', 4000);
          this.display();
        }));
    }

    } // end if(mode !== 'auto') for AI Subcategories

    // ── 📚 Knowledge Sources — Manual + Advanced only ────────────────────────
    if (mode !== 'auto') {
    const ksSec = makeSection(containerEl, '📚', 'Knowledge Sources', false);

    new import_obsidian.Setting(ksSec).setName('Wikipedia Excerpts').setDesc('Fetch a Wikipedia summary for each term and include it in the note.')
      .addToggle(t => t.setValue(this.plugin.settings.useWikipedia).onChange(async v => { this.plugin.settings.useWikipedia = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(ksSec).setName('Wikipedia in AI Context').setDesc('Pass the Wikipedia excerpt to the AI when generating the summary.')
      .addToggle(t => t.setValue(this.plugin.settings.useWikipediaInContext).onChange(async v => { this.plugin.settings.useWikipediaInContext = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(ksSec).setName('Dictionary API').setDesc('Fetch free definitions from dictionaryapi.dev.')
      .addToggle(t => t.setValue(this.plugin.settings.useDictionaryAPI).onChange(async v => { this.plugin.settings.useDictionaryAPI = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(ksSec).setName('Dictionary in AI Context').setDesc('Pass dictionary definitions to the AI when generating the summary.')
      .addToggle(t => t.setValue(this.plugin.settings.useDictionaryInContext).onChange(async v => { this.plugin.settings.useDictionaryInContext = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(ksSec).setName('Glossary File').setDesc('Path to a custom glossary note (optional).')
      .addText(t => { t.inputEl.placeholder = 'Definitions.md'; t.setValue(this.plugin.settings.glossaryBasePath).onChange(async v => { this.plugin.settings.glossaryBasePath = v; await this.plugin.saveSettings(); }); });

    } // end if(mode !== 'auto') for Knowledge Sources

    // ── ✍️ Generation Features — Manual + Advanced only ──────────────────────
    if (mode !== 'auto') {
    const featSec = makeSection(containerEl, '✍️', 'Generation Features', false);

    new import_obsidian.Setting(featSec).setName('Generate Tags').setDesc('Auto-populate frontmatter tags from source file tags.')
      .addToggle(t => t.setValue(this.plugin.settings.generateTags).onChange(async v => { this.plugin.settings.generateTags = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(featSec).setName('Max Tags')
      .addSlider(s => s.setLimits(1, 30, 1).setValue(this.plugin.settings.maxTags).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxTags = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(featSec).setName('Tags Include # Prefix')
      .addToggle(t => t.setValue(this.plugin.settings.tagsIncludeHashPrefix).onChange(async v => { this.plugin.settings.tagsIncludeHashPrefix = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(featSec).setName('Related Concepts').setDesc('Suggest related wikilinked terms at the bottom of each note.')
      .addToggle(t => t.setValue(this.plugin.settings.generateRelatedConcepts).onChange(async v => { this.plugin.settings.generateRelatedConcepts = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(featSec).setName('Max Related Concepts')
      .addSlider(s => s.setLimits(1, 20, 1).setValue(this.plugin.settings.maxRelatedConcepts).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxRelatedConcepts = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(featSec).setName('Track AI Model').setDesc('Record which model generated each note in its frontmatter.')
      .addToggle(t => t.setValue(this.plugin.settings.trackModel).onChange(async v => { this.plugin.settings.trackModel = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(featSec).setName('AI Summary Disclaimer').setDesc('Appended below every AI summary.')
      .addText(t => t.setValue(this.plugin.settings.aiSummaryDisclaimer).onChange(async v => { this.plugin.settings.aiSummaryDisclaimer = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(featSec).setName('Extract Key Concepts').setDesc('Pull key concepts from existing summaries to surface related ideas.')
      .addToggle(t => t.setValue(this.plugin.settings.extractKeyConceptsFromSummary ?? true).onChange(async v => { this.plugin.settings.extractKeyConceptsFromSummary = v; await this.plugin.saveSettings(); }));

    } // end if(mode !== 'auto') for Generation Features

    // ── ⚡ Performance — Advanced only ────────────────────────────────────────
    if (mode === 'advanced') {
    const perfSec = makeSection(containerEl, '⚡', 'Performance', false);

    new import_obsidian.Setting(perfSec).setName('AI Context Max Chars')
      .setDesc('Hard cap on characters sent to the AI per term (after markup stripping). ~20k ≈ 5k tokens. Lower for small/fast local models.')
      .addSlider(s => s.setLimits(2000, 60000, 1000).setValue(this.plugin.settings.aiContextMaxChars ?? 20000).setDynamicTooltip().onChange(async v => { this.plugin.settings.aiContextMaxChars = v; await this.plugin.saveSettings(); }));

    new import_obsidian.Setting(perfSec).setName('Context Depth')
      .setDesc('Partial (recommended): wikilinks only. Full: wikilinks + virtual mentions. Performance: link line only.')
      .addDropdown(dd => dd
        .addOption('partial', 'Partial — wikilinks only (recommended)')
        .addOption('full', 'Full — wikilinks + virtual mentions')
        .addOption('performance', 'Performance — link line only (fastest)')
        .setValue(this.plugin.settings.contextDepth)
        .onChange(async v => { this.plugin.settings.contextDepth = v; await this.plugin.saveSettings(); }));

    new import_obsidian.Setting(perfSec).setName('Batch Size').setDesc('Notes generated in parallel. Higher = faster; lower = less API pressure.')
      .addSlider(s => s.setLimits(1, 20, 1).setValue(this.plugin.settings.batchSize).setDynamicTooltip().onChange(async v => { this.plugin.settings.batchSize = v; await this.plugin.saveSettings(); }));

    new import_obsidian.Setting(perfSec).setName('Priority Queue').setDesc('Process most-linked terms first.')
      .addToggle(t => t.setValue(this.plugin.settings.usePriorityQueue).onChange(async v => { this.plugin.settings.usePriorityQueue = v; await this.plugin.saveSettings(); }));

    new import_obsidian.Setting(perfSec).setName('Show Progress Notification').setDesc('Live progress bar in the Obsidian notification strip.')
      .addToggle(t => t.setValue(this.plugin.settings.showProgressNotification).onChange(async v => { this.plugin.settings.showProgressNotification = v; await this.plugin.saveSettings(); }));

    } // end if(mode === 'advanced') for Performance

    // ── 🔍 Term Matching — Advanced only ─────────────────────────────────────
    if (mode === 'advanced') {
    const matchSec = makeSection(containerEl, '🔍', 'Term Matching', false);

    new import_obsidian.Setting(matchSec).setName('Min Word Length').setDesc('Terms shorter than this are skipped.')
      .addSlider(s => s.setLimits(2, 10, 1).setValue(this.plugin.settings.minWordLengthForAutoDetect).setDynamicTooltip().onChange(async v => { this.plugin.settings.minWordLengthForAutoDetect = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(matchSec).setName('Max Words to Match').setDesc('Maximum consecutive words to consider as one term.')
      .addSlider(s => s.setLimits(1, 5, 1).setValue(this.plugin.settings.maxWordsToMatch).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxWordsToMatch = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(matchSec).setName('Prefer Longer Matches').setDesc('Prefer "Smooth Muscle" over "Smooth" when both match.')
      .addToggle(t => t.setValue(this.plugin.settings.preferLongerMatches).onChange(async v => { this.plugin.settings.preferLongerMatches = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(matchSec).setName('Whole Words Only').setDesc('Prevent matching inside longer words (recommended).')
      .addToggle(t => t.setValue(this.plugin.settings.matchWholeWordsOnly).onChange(async v => { this.plugin.settings.matchWholeWordsOnly = v; await this.plugin.saveSettings(); }));

    } // end if(mode === 'advanced') for Term Matching

    // ── 📋 Logging — Advanced only ────────────────────────────────────────────
    if (mode === 'advanced') {
    const logSec = makeSection(containerEl, '📋', 'Logging & Diagnostics', false);

    new import_obsidian.Setting(logSec).setName('Enable Logging').setDesc('Write structured session logs to your vault.')
      .addToggle(t => t.setValue(this.plugin.settings.enableLogging).onChange(async v => { this.plugin.settings.enableLogging = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(logSec).setName('Log Level').setDesc('DEBUG = everything · INFO = normal · WARN = problems · ERROR = failures')
      .addDropdown(dd => dd.addOption('DEBUG','DEBUG').addOption('INFO','INFO (default)').addOption('WARN','WARN').addOption('ERROR','ERROR')
        .setValue(this.plugin.settings.logLevel).onChange(async v => { this.plugin.settings.logLevel = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(logSec).setName('Log Directory')
      .addText(t => { t.inputEl.placeholder = 'VaultWiki/Logs'; t.setValue(this.plugin.settings.logDirectory).onChange(async v => { this.plugin.settings.logDirectory = v; await this.plugin.saveSettings(); }); });
    new import_obsidian.Setting(logSec).setName('Max Log Age (days)')
      .addSlider(s => s.setLimits(1, 90, 1).setValue(this.plugin.settings.maxLogAgeDays).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxLogAgeDays = v; await this.plugin.saveSettings(); }));
    new import_obsidian.Setting(logSec).setName('Open Latest Log').setDesc('View the most recent session log in the editor.')
      .addButton(btn => btn.setButtonText('📄 Open Log').onClick(() => this.plugin.openLatestLog()));
    } // end if(mode === 'advanced') for Logging
  }

};

