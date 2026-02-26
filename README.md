# WikiVault Unified ⚡🛡️

> AI-powered wiki generation for Obsidian — with Virtual Linker integration, smart multi-word matching, category organization, and structured session logging.

[![CI](https://github.com/your-username/wikivault-unified/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/wikivault-unified/actions/workflows/ci.yml)
![Obsidian](https://img.shields.io/badge/Obsidian-%3E%3D0.15.0-blueviolet)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![Version](https://img.shields.io/badge/version-3.0.0-green)

---

## What It Does

WikiVault Unified scans your Obsidian vault for unresolved wikilinks and automatically generates structured wiki notes for each term. Each note is enriched with:

- **AI-generated summary** (Mistral, OpenAI, or any OpenAI-compatible endpoint)
- **Wikipedia excerpt** with a link to the full article
- **Dictionary definition** from the free Dictionary API
- **Mentions** — every place the term appears in your notes, with surrounding context
- **Auto-generated tags** pulled from your existing note metadata
- **Related concepts** extracted from wikilinks in context
- **Virtual link highlighting** — terms matching your notes are visually linked in reading view without modifying the source file

---

## Features

| Feature | Description |
|---------|-------------|
| 🤖 AI Summaries | Supports Mistral, OpenAI, LM Studio, and any OpenAI-compatible API |
| 🔗 Virtual Linker | Highlights matching terms in reading view — no file modification |
| 🧠 Smart Matching | 1–3 word phrase matching with morphological variants (singular/plural) |
| 📂 Categories | Auto-assigns notes to subject folders based on source file path or tags |
| 📝 Structured Logs | Session logs written to your vault with error indexes and performance stats |
| ⚡ Priority Queue | Processes most-referenced terms first |
| 🔤 Synonyms | Configurable abbreviation expansion (e.g. ATP → Adenosine Triphosphate) |

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
3. Configure **Categories** to match your vault's folder structure
4. Optionally add **Synonyms** for domain-specific abbreviations

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

### Other Commands

| Command | Description |
|---------|-------------|
| Refresh term cache | Force-rebuild the term index |
| Open latest log | Open the most recent session log in the editor |
| Flush log to vault now | Write buffered log entries immediately |

### Reading Logs

Logs are written to `WikiVault/Logs/session-YYYY-MM-DD_HH-MM-SS.md`.
Each log contains:
- A **session summary table** (notes generated/failed/skipped, API calls, runtime)
- An **error quick-reference** at the top
- A **full chronological log** with JSON context for every event

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
