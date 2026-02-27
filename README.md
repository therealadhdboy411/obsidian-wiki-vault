# WikiVault Unified ⚡🛡️

> AI-powered wiki generation for Obsidian — with link-based indexing, context depth modes, pause/resume control, and structured session logging.

[![CI](https://github.com/your-username/wikivault-unified/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/wikivault-unified/actions/workflows/ci.yml)
![Obsidian](https://img.shields.io/badge/Obsidian-%3E%3D0.15.0-blueviolet)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Version](https://img.shields.io/badge/version-3.1.0-green)

---

## What It Does

WikiVault Unified scans your Obsidian vault for unresolved wikilinks and automatically generates structured wiki notes for each term. Each note is enriched with:

- **AI-generated summary** (Mistral, OpenAI, or any OpenAI-compatible endpoint)
- **Wikipedia excerpt** with a link to the full article
- **Dictionary definition** from the free Dictionary API
- **Mentions** — every place the term appears in your notes, with surrounding context
- **Auto-generated tags** pulled from your existing note metadata
- **Related concepts** extracted from wikilinks in context
- **Copilot-friendly frontmatter** (`type: wiki-note`, `copilot-index: true`, `source-notes`) for Obsidian Copilot integration

---

## Features

| Feature | Description |
|---------|-------------|
| 🤖 AI Summaries | Supports Mistral, OpenAI, LM Studio, and any OpenAI-compatible API |
| ⚡ Link-Based Indexing | Only indexes terms with inbound wikilinks — ~85% smaller index than full-vault scan |
| 🎚️ Context Depth Modes | **Partial** (default), **Full**, or **Performance** — choose speed vs. thoroughness |
| ⏸️ Pause / Resume / Cancel | Control generation mid-run without losing progress |
| 🛡️ Write Safety | Strict guards prevent any writes outside the wiki/log directories |
| 📊 Performance Diagnostics | Full performance report in logs: throughput, cache hit rates, timing per phase |
| 📂 Categories | Auto-assigns notes to subject folders based on source file path or tags |
| 📝 Structured Logs | Session logs with error indexes, performance stats, and diagnostic reports |
| ⚡ Priority Queue | Processes most-referenced terms first |
| 🔤 Synonyms | Configurable abbreviation expansion (e.g. ATP → Adenosine Triphosphate) |
| 🧠 API Response Caching | In-memory caches for Wikipedia and Dictionary — eliminates duplicate fetches |
| ⏱️ HH:MM:SS ETA | Progress notification updates every 5 seconds with estimated time remaining |

---

## Performance

WikiVault Unified is designed to never freeze your Obsidian workspace:

- **Deferred startup** — Index builds after layout is ready, not during plugin load
- **UI yielding** — All loops (`buildIndex`, file pre-reading, context scanning, batches) yield to the event loop every 50–100 iterations so you can switch tabs, edit files, and navigate freely during indexing
- **File content caching** — All vault files are read once into memory (via `cachedRead`), reducing I/O from O(terms × files) to O(files)
- **Debounced file-switch** — The `runOnFileSwitch` setting uses a 5-second debounce to prevent generation spam during rapid navigation

### Context Depth Modes

| Mode | What it does | Speed |
|------|-------------|-------|
| **Partial** (default) | Detects `[[wikilinks]]` only, extracts surrounding paragraph | ~3× faster than Full |
| **Full** | Detects wikilinks + virtual/fuzzy mentions via term matching | Most thorough |
| **Performance** | Detects `[[wikilinks]]` only, extracts just the link line | ~10× faster than Full |

---

## Installation

### Option A — BRAT (recommended for early access)

1. Install [BRAT](https://github.com/TfTHacker/obsidian42-brat) from the Obsidian Community Plugins browser
2. Run **BRAT: Add a beta plugin** → paste `your-username/wikivault-unified`

### Option B — Manual

1. Go to [Releases](https://github.com/your-username/wikivault-unified/releases/latest)
2. Download `wikivault-unified-x.y.z.zip`
3. Unzip into `.obsidian/plugins/wikivault-unified/` inside your vault
4. Enable in **Settings → Community Plugins**

---

## Configuration

On first run, the plugin will use sensible defaults. To configure:

1. Open **Settings → WikiVault Unified**
2. Set your **AI Provider** and paste your **API Key** (stored locally, never sent anywhere except your chosen AI endpoint)
3. Set **Context Depth** under Performance to control speed vs. thoroughness
4. Configure **Categories** to match your vault's folder structure
5. Optionally add **Synonyms** for domain-specific abbreviations

> **Your API key is stored in `data.json` inside the plugin folder. This file is gitignored and should never be committed.**

### Supported AI Providers

| Provider | Endpoint | Notes |
|----------|----------|-------|
| Mistral AI | `https://api.mistral.ai/v1` | Default |
| OpenAI | `https://api.openai.com/v1` | GPT-4o, etc. |
| LM Studio | `http://localhost:1234/v1` | Local models |
| Any OpenAI-compatible | Custom URL | Set `apiType: openai` |

---

## Usage

### Generate Wiki Notes

Click the **book icon** in the left ribbon, or run the command:
> **WikiVault: Generate missing Wiki notes**

### Commands

| Command | Description |
|---------|-------------|
| Generate missing Wiki notes | Scan for unresolved links and generate notes |
| Refresh term cache | Force-rebuild the term index |
| **Pause wiki generation** | Pause the current generation run |
| **Resume wiki generation** | Resume a paused generation run |
| **Cancel wiki generation** | Cancel generation entirely |
| Open latest log | Open the most recent session log in the editor |
| Flush log to vault now | Write buffered log entries immediately |

### Reading Logs

Logs are written to `WikiVault/Logs/session-YYYY-MM-DD_HH-MM-SS.md`.
Each log contains:

- A **session summary table** (notes generated/failed/skipped, API calls, cache hits, runtime)
- A **📊 performance diagnostic report** (throughput, context depth, cache hit rate, content size)
- An **error quick-reference** at the top
- A **full chronological log** with JSON context for every event

---

## Safety

WikiVault Unified includes strict safety mechanisms to protect your vault:

- **Write-safety guard** — All write operations pass through `assertSafeWritePath()`, which blocks any writes outside the wiki notes and log directories
- **Path traversal protection** — Terms are sanitized via `sanitizeTermForPath()` before being used in file paths
- **No existing file modification** — Your personal notes are never touched; only files in the wiki output directory are created or updated

---

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full developer guide.

```bash
git clone https://github.com/your-username/wikivault-unified
cd wikivault-unified
npm install
cp data.json.example data.json   # then add your API key
npm run dev                       # watch-build
```

---

## License

[Apache 2.0](LICENSE) — © Manus
