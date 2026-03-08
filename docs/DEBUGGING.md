# Vault Wiki — Debugging Guide

This guide covers every debugging tool and technique available in Vault Wiki, from quick one-liners to deep diagnostic sessions.

---

## Table of Contents

1. [Quick-Start: DevTools Console](#quick-start-devtools-console)
2. [Built-in Debug Commands](#built-in-debug-commands)
3. [Console Helper Object: `window.VWDebug`](#console-helper-object-windowvwdebug)
4. [Log Files](#log-files)
5. [Settings Dump](#settings-dump)
6. [Provider & Connection Diagnostics](#provider--connection-diagnostics)
7. [Term Index Inspector](#term-index-inspector)
8. [AI Payload Inspector](#ai-payload-inspector)
9. [Crypto & Key Diagnostics](#crypto--key-diagnostics)
10. [Performance Profiling](#performance-profiling)
11. [Mobile Debugging](#mobile-debugging)
12. [Network Request Inspector](#network-request-inspector)
13. [Reproducing Issues](#reproducing-issues)
14. [Common Issues & Fixes](#common-issues--fixes)

---

## Quick-Start: DevTools Console

Open the developer console:

| Platform | Shortcut |
|----------|---------|
| Windows / Linux | `Ctrl + Shift + I` |
| macOS | `Cmd + Option + I` |
| Mobile (Obsidian) | Settings → About → "Enable debug mode", then shake device |

Get the plugin instance in one line:

```javascript
const vw = app.plugins.plugins["vault-wiki"];
```

If `vw` is `undefined`, the plugin failed to load. Check the Console tab for red errors on startup.

---

## Built-in Debug Commands

Vault Wiki registers several debug commands in the Command Palette (`Ctrl/Cmd + P`):

| Command | What it does |
|---------|-------------|
| `Vault Wiki: Open latest log file` | Opens the most recent session log in the editor |
| `Vault Wiki: Flush log to vault now` | Forces a log write (normally deferred) |
| `Vault Wiki: Refresh term cache` | Rebuilds the entire term index |
| `Vault Wiki: Pause wiki generation` | Suspends mid-run generation |
| `Vault Wiki: Resume wiki generation` | Resumes paused generation |
| `Vault Wiki: Cancel wiki generation` | Cancels and resets state |

---

## Console Helper Object: `window.VWDebug`

Vault Wiki exposes a `window.VWDebug` object when the plugin loads. This gives you a structured API for interactive debugging in the console.

```javascript
// Access the helper
window.VWDebug
```

### Available methods

```javascript
// ── Status ─────────────────────────────────────────────────────────────────

VWDebug.status()
// Prints a compact status overview:
//   Provider, model, hardware mode, term count, generation state,
//   log level, wiki directory, last error (if any).

VWDebug.version()
// → "Vault Wiki v1.1.0 · mistral-small-latest · 247 terms indexed"

// ── Settings ────────────────────────────────────────────────────────────────

VWDebug.dumpSettings()
// Prints current settings to console. API keys are masked (first 4 + last 4 chars).
// Returns the settings object (copy-paste safe).

VWDebug.dumpDefaults()
// Prints DEFAULT_SETTINGS — useful for comparing what changed from defaults.

VWDebug.diffSettings()
// Shows only settings that differ from DEFAULT_SETTINGS.
// Example output:
//   provider:    "ollama"  (default: "mistral")
//   modelName:   "llama3.2"  (default: "mistral-medium-latest")

VWDebug.resetSettings()
// ⚠️ DESTRUCTIVE — resets all settings to defaults and saves.
// Use only when settings are corrupted.

// ── Term Index ──────────────────────────────────────────────────────────────

VWDebug.dumpIndex()
// Prints all indexed terms with source file counts.

VWDebug.searchIndex("neural")
// Finds all indexed terms containing "neural" (case-insensitive).
// → ["Neural Network", "Neural Plasticity", "Artificial Neural Network"]

VWDebug.termFiles("Neural Network")
// Shows which source files mention "Neural Network".

VWDebug.indexStats()
// → { terms: 247, files: 89, categories: 4, synonyms: 11 }

// ── AI / Provider ───────────────────────────────────────────────────────────

VWDebug.testConnection()
// Runs the provider connection test and prints the result.
// Same as clicking "Test Connection" in Settings.

VWDebug.dryRun("Neural Network")
// Extracts context for "Neural Network" and prints what would be sent to the AI
// WITHOUT actually calling the API. Shows: sanitized term, stripped context,
// system prompt, user prompt, estimated token count.

VWDebug.callAI("Hello, reply with OK")
// Sends a raw test message to the configured AI and prints the response.
// Useful for verifying the API key and endpoint work end-to-end.

VWDebug.listProviders()
// Prints the full PROVIDERS table with all descriptor fields.

VWDebug.detectModel()
// → { name: "llama3.2", sizeB: 3, quant: "q4", autoPreset: "small", autoContext: 3000 }

// ── Encryption ──────────────────────────────────────────────────────────────

VWDebug.testEncryption()
// Encrypts "test-key-12345", decrypts it, and verifies round-trip.
// → { success: true, encrypted: "vw1:abc…", decrypted: "test-key-12345" }

VWDebug.isKeyEncrypted("mistral")
// → true / false — checks if the stored key for "mistral" has the vw1: prefix.

// ── Logging ─────────────────────────────────────────────────────────────────

VWDebug.setLogLevel("DEBUG")
// Temporarily set log level to DEBUG|INFO|WARN|ERROR (doesn't save to settings).

VWDebug.getRecentLogs(n = 50)
// Returns last N log entries as an array. Useful for scripting.

VWDebug.tailLog()
// Starts printing new log entries to the console in real time.
// Call VWDebug.stopTailLog() to stop.

// ── Generation ──────────────────────────────────────────────────────────────

VWDebug.generateForTerm("Neural Network")
// Runs full wiki generation for a single term and prints timing + result.

VWDebug.dumpGenerationQueue()
// Shows the current queue of terms waiting to be generated.

VWDebug.clearGenerationQueue()
// Empties the queue (cancels queued items without affecting in-progress ones).

// ── File System ─────────────────────────────────────────────────────────────

VWDebug.listWikiFiles()
// Lists all files under the wiki directory with their generated_at timestamps.

VWDebug.findWikiNote("Neural Network")
// Searches for an existing wiki note for "Neural Network" and prints its path + metadata.

VWDebug.dumpWikiNote("Neural Network")
// Prints the full content of an existing wiki note.

// ── Hardware ────────────────────────────────────────────────────────────────

VWDebug.detectHardware()
// → { mode: "cpu", cores: 8, platform: "Win32", ua: "Mozilla/5.0 …" }

VWDebug.autoConfig()
// → { batchSize: 4, aiContextMaxChars: 3000, contextDepth: "partial", promptPreset: "small" }
// Shows what Auto mode would use for the current model + hardware.
```

### Implementation Note

`window.VWDebug` is registered in `WikiVaultUnifiedPlugin.onload()` and removed in `onunload()`. It is **only available in development builds or when Obsidian's safe mode is off**. The helper is intentionally not available in stripped/minified production builds to avoid surface area.

---

## Log Files

Vault Wiki writes structured session logs to your vault under `VaultWiki/Logs/` (configurable).

### Log file format

```markdown
# Vault Wiki Session Log
Session: 2025-01-15T14:32:00Z
Plugin version: 1.1.0
Provider: mistral · mistral-small-latest
Hardware: cpu

---

[14:32:01.123] INFO  Plugin         Vault Wiki loaded successfully
[14:32:01.456] INFO  TermCache      Index ready — 247 terms indexed
[14:32:10.789] INFO  NoteGenerator  generateAll: starting (247 terms, batch 4)
[14:32:11.012] DEBUG NoteGenerator  Calling AI API { endpoint: "https://api.mistral.ai/v1", model: "mistral-small-latest", apiKey: "XxXx●●●●1234" }
[14:32:12.345] INFO  NoteGenerator  Generated: "Neural Network" (1.23s)
[14:32:12.678] WARN  NoteGenerator  Skipping "ATP" — existing wiki note is up to date
[14:32:45.901] INFO  NoteGenerator  generateAll: complete (12/247 generated, 0 errors)
```

### Viewing logs

1. Run the command: `Vault Wiki: Open latest log file`
2. Or navigate to `VaultWiki/Logs/` in the file explorer.

### Log levels

| Level | What it includes |
|-------|-----------------|
| `ERROR` | Failures that stopped something from working |
| `WARN` | Recoverable issues (skipped notes, rate limits) |
| `INFO` | Normal operation milestones |
| `DEBUG` | Every API call, every term considered, every cache hit/miss |

To enable DEBUG logging: Settings → Advanced → Log Level → DEBUG.

---

## Settings Dump

```javascript
// In DevTools console:
const vw = app.plugins.plugins["vault-wiki"];

// Full settings (keys masked)
const s = {...vw.settings};
for (const [k,v] of Object.entries(s.providerApiKeys)) {
    s.providerApiKeys[k] = v ? `${v.slice(0,4)}●●●●${v.slice(-4)}` : "(not set)";
}
console.log(JSON.stringify(s, null, 2));
```

Or use the built-in helper:

```javascript
VWDebug.dumpSettings();
```

---

## Provider & Connection Diagnostics

### Test connection from console

```javascript
const vw = app.plugins.plugins["vault-wiki"];
const result = await vw.generator.testConnection();
console.log(result);
// → { success: true, message: "✅ Connected! Model: mistral-small-latest — replied in 423ms", model: "...", latencyMs: 423 }
```

### Check what endpoint and key will be used

```javascript
const vw = app.plugins.plugins["vault-wiki"];
const s = vw.settings;
console.log({
    provider: s.provider,
    endpoint: s.openaiEndpoint,
    model: s.modelName,
    keySet: !!s.providerApiKeys[s.provider],
    // Don't log the actual key — just check it's there
});
```

### Fetch Ollama model list

```javascript
const models = await fetchOllamaModels("http://localhost:11434");
console.log(models);
// → [{ name: "llama3.2", sizeB: 3 }, { name: "mistral", sizeB: 7 }]
// null → Ollama not running
```

### Fetch LM Studio model list

```javascript
const models = await fetchLMStudioModels("http://localhost:1234");
console.log(models);
// → ["lmstudio-community/Qwen3.5-1.7B-Instruct-GGUF", ...]
// null → LM Studio not running or no models loaded
```

---

## Term Index Inspector

```javascript
const vw = app.plugins.plugins["vault-wiki"];
const idx = vw.termCache.termIndex;

// Total terms
console.log(`${idx.size} terms indexed`);

// Find all terms matching a substring
const matches = [...idx.keys()].filter(t => t.toLowerCase().includes("neuro"));
console.log(matches);

// Find terms that only appear in one file (likely niche terms)
const rare = [...idx.entries()].filter(([_, files]) => files.length === 1);
console.log(`Rare terms (1 source): ${rare.length}`);

// Find the most-referenced terms
const sorted = [...idx.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);
console.table(sorted.map(([term, files]) => ({ term, sources: files.length })));
```

---

## AI Payload Inspector

See exactly what will be sent to the AI before calling it:

```javascript
const vw = app.plugins.plugins["vault-wiki"];
const gen = vw.generator;

// Manually extract context for a term
const contextData = await gen.extractContext("Neural Network");
console.log("Raw context snippets:", contextData.rawContext.slice(0, 3));

// Strip markup (as the AI call would)
const stripped = stripMarkupForAI(contextData.rawContext.join('\n\n'), 20000);
console.log("Stripped context length:", stripped.length, "chars");
console.log("Estimated tokens:", Math.ceil(stripped.length / 4));

// Sanitize the term
const safe = sanitizeTermForPrompt("Neural Network");
console.log("Sanitized term:", safe);

// Build the prompt
const systemPrompt = gen._resolvedSystemPrompt || vw.settings.systemPrompt;
const userTemplate = gen._resolvedUserTemplate || vw.settings.userPromptTemplate;
const userPrompt = userTemplate
    .replace('{{term}}', safe)
    .replace('{{context}}', stripped.slice(0, 1000) + "…[truncated]");

console.log("=== SYSTEM PROMPT ===");
console.log(systemPrompt);
console.log("=== USER PROMPT (first 500 chars) ===");
console.log(userPrompt.slice(0, 500));
```

---

## Crypto & Key Diagnostics

```javascript
const vw = app.plugins.plugins["vault-wiki"];
const crypto = vw.crypto;

// Test encryption round-trip
const test = "my-test-api-key";
const encrypted = await crypto.encrypt(test);
const decrypted = await crypto.decrypt(encrypted);
console.log({
    original: test,
    encrypted: encrypted.slice(0, 30) + "…",
    decrypted,
    match: test === decrypted  // should be true
});

// Check which keys are stored (without revealing them)
const keys = vw.settings.providerApiKeys;
for (const [provider, key] of Object.entries(keys)) {
    const status = key ? `SET (${key.length} chars)` : "not set";
    console.log(`  ${provider}: ${status}`);
}

// Check raw data.json to verify encryption is in effect
const raw = await app.plugins.loadData?.() || {};
// If data.json has "vw1:" prefix, encryption is working
console.log("Keys encrypted in data.json:", 
    Object.values(raw.providerApiKeys || {}).every(v => !v || v.startsWith("vw1:"))
);
```

---

## Performance Profiling

### Time a full generation pass

```javascript
const vw = app.plugins.plugins["vault-wiki"];

const t0 = performance.now();
await vw.generateWikiNotes();
const elapsed = performance.now() - t0;

console.log(`Generation: ${(elapsed/1000).toFixed(1)}s`);
console.log(vw.logger.stats);
// → { apiCalls: 12, notesGenerated: 12, notesSkipped: 235, errors: 0 }
```

### Profile the term index build

```javascript
const vw = app.plugins.plugins["vault-wiki"];
const t0 = performance.now();
await vw.termCache.buildIndex();
console.log(`Index build: ${(performance.now()-t0).toFixed(0)}ms for ${vw.termCache.termIndex.size} terms`);
```

### Identify slow notes

```javascript
// Manually time context extraction for each term in the index
const vw = app.plugins.plugins["vault-wiki"];
const timings = [];

for (const term of [...vw.termCache.termIndex.keys()].slice(0, 20)) {
    const t0 = performance.now();
    await vw.generator.extractContext(term);
    timings.push({ term, ms: Math.round(performance.now()-t0) });
}

timings.sort((a,b) => b.ms - a.ms);
console.table(timings.slice(0, 10));  // top 10 slowest
```

### Memory snapshot

```javascript
// Check heap size before and after a generation pass
const before = performance.memory?.usedJSHeapSize / 1e6;
await app.plugins.plugins["vault-wiki"].generateWikiNotes();
const after = performance.memory?.usedJSHeapSize / 1e6;
console.log(`Heap: ${before?.toFixed(1)} MB → ${after?.toFixed(1)} MB`);
```

---

## Mobile Debugging

Obsidian on mobile doesn't have DevTools by default.

### Method 1 — Log file inspection

Enable logging (Settings → Advanced → Enable Logging). After running generation, open `VaultWiki/Logs/` in the file explorer. The log file is plain Markdown readable in Obsidian itself.

### Method 2 — Remote DevTools (Android)

1. Connect phone via USB. Enable USB Debugging in Android Developer Options.
2. Open `chrome://inspect/#devices` on your desktop Chrome.
3. Find the Obsidian webview and click "Inspect".
4. Full DevTools available.

### Method 3 — Remote DevTools (iOS)

1. Enable Web Inspector in iPhone Settings → Safari → Advanced.
2. Connect to Mac, open Safari → Develop menu → [Your iPhone] → Obsidian.
3. Full Web Inspector available.

### Method 4 — In-app status notice logging

Add debug notices to your workflow temporarily:

```javascript
// In DevTools console (if accessible) or by patching temporarily:
const vw = app.plugins.plugins["vault-wiki"];
const origGen = vw.generator.generateAll.bind(vw.generator);
vw.generator.generateAll = async function(...args) {
    new Notice("VW: generateAll starting");
    const result = await origGen(...args);
    new Notice("VW: generateAll done");
    return result;
};
```

---

## Network Request Inspector

Vault Wiki uses Obsidian's `requestUrl()` function (not `fetch()`), which bypasses the browser network panel.

To inspect actual requests, temporarily patch `requestUrl`:

```javascript
const orig = app.plugins.plugins["vault-wiki"].app.plugins.plugins["vault-wiki"].constructor;

// Patch at the import level (advanced):
// In DevTools, before generation runs:
const origReq = window._obsidian?.requestUrl || require?.("obsidian")?.requestUrl;
// This technique depends on Obsidian internals — fragile but sometimes useful.
```

**Recommended approach:** Use the built-in logger at DEBUG level, which logs every request's URL, model, and masked key. Enable it with:

```javascript
VWDebug.setLogLevel("DEBUG");
// Then trigger generation — every requestUrl call logs to console + file
```

---

## Reproducing Issues

When filing a bug report, please include:

1. **Settings dump** (run `VWDebug.dumpSettings()` — keys are automatically masked)
2. **Log file** from `VaultWiki/Logs/` covering the session where the bug occurred
3. **Obsidian version** (Settings → About)
4. **Plugin version** (`VWDebug.version()`)
5. **Platform** (Windows/Mac/Linux/iOS/Android)
6. **What you did** (steps to reproduce)
7. **What happened** (actual result)
8. **What you expected** (expected result)

### Minimal reproduction

If the bug involves a specific note or term:

```javascript
// Get a single-term test case
const vw = app.plugins.plugins["vault-wiki"];
await vw.generateWikiNoteForTerm("YourProblemTerm");
// Share the console output
```

---

## Common Issues & Fixes

### "No API key set" notice keeps appearing

**Cause:** The key is set for the wrong provider slot.

**Fix:**
```javascript
const vw = app.plugins.plugins["vault-wiki"];
const s = vw.settings;
console.log("Current provider:", s.provider);
console.log("Keys set:", Object.fromEntries(
    Object.entries(s.providerApiKeys).map(([k,v]) => [k, !!v])
));
// Find your provider and confirm it has a key
```

If the key is in the wrong slot, re-enter it in Settings with the correct provider selected.

---

### Generation hangs at "X terms"

**Cause:** Usually the AI API call is timing out or the local server (Ollama/LM Studio) stopped responding.

**Fix:**
```javascript
VWDebug.testConnection();    // check if the provider is still reachable
VWDebug.setLogLevel("DEBUG"); // enable verbose logging
// Then trigger generation and watch console for timeout errors
```

Also try: Settings → AI Config → Batch Size → reduce to 1 to isolate which term is hanging.

---

### Wiki notes appear in wrong folder

**Cause:** Category assignment is picking the wrong category, or `customDirectoryName` is misconfigured.

**Fix:**
```javascript
const vw = app.plugins.plugins["vault-wiki"];
const category = vw.categoryManager.assignCategory(
    app.vault.getMarkdownFiles().find(f => f.basename === "SomeTerm")
);
console.log(category);
// Shows what category/path was assigned and why
```

---

### "Decryption failure" in logs after moving vault

**Cause:** `VaultWikiCrypto` derives its key from the vault path. If the path changed, all stored keys are unreadable.

**Fix:** Re-enter your API keys in Settings. They will be re-encrypted with the new path-derived key on the next save.

---

### Settings panel is blank / not rendering

**Cause:** JavaScript error in `display()` — usually from a missing plugin instance or corrupted settings.

**Fix:**
```javascript
// Check for errors in console (red), then:
const vw = app.plugins.plugins["vault-wiki"];
await vw.loadSettings();     // reload from disk
// Then reopen Settings
```

If still broken:
```javascript
VWDebug.resetSettings();    // ⚠️ resets everything to defaults
```

---

### "Invalid endpoint" error for Ollama

**Cause:** Ollama uses `http://localhost:11434` (no `/v1`), but the OpenAI-compat path needs `/v1`.

**Fix:**
- For the **Ollama** provider: endpoint should be `http://localhost:11434/v1`
- For manual curl testing: `http://localhost:11434/api/tags`

---

### Performance: generation is very slow

**Diagnosis:**
```javascript
VWDebug.autoConfig();
// Check batchSize — if it's 1 or 2, you're on a mobile profile by mistake.

VWDebug.detectHardware();
// Check mode — if it says "android" on a desktop, override it in Settings.
```

**Fix:** Settings → Hardware Mode → set manually to "cpu" or "gpu".

---

*If your issue isn't listed here, open a GitHub Issue with the output of `VWDebug.dumpSettings()` and your most recent log file.*
