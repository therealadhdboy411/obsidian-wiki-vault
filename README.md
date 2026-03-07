# Vault Wiki — Obsidian Plugin

> **Public Beta v1.0.0** — AI-powered wiki generation for Obsidian  
> By [adhdboy411](https://github.com/adhdboy411) & Claude

Vault Wiki automatically generates rich, linked wiki notes for every `[[wikilink]]` in your vault. Point it at any AI provider, run it once, and watch your unresolved links turn into full wiki notes with AI summaries, Wikipedia excerpts, dictionary definitions, and source mentions — all cross-linked and tagged.

---

## Features

- **Multi-provider AI** — Anthropic Claude, OpenAI, Mistral, Groq, Ollama, OpenRouter, Together AI, LM Studio (OpenAI-compat & native v1)
- **Smart matching** — finds multi-word terms, handles plurals, synonyms, and abbreviations
- **Category system** — auto-assigns notes to subject folders (Anatomy, Biochemistry, General, etc.)
- **AI subcategories** — optional second-level folder classification via AI
- **Wikipedia + Dictionary** — enriches every note with real definitions and encyclopedia excerpts
- **Virtual linker** — renders `[[wikilinks]]` as styled links even before the target note exists
- **Hardware-aware** — auto-detects CPU/GPU/mobile and tunes LM Studio accordingly
- **Progress bar** — live ETA notice during generation
- **Pause/Resume/Cancel** — full control over long generation runs
- **Structured logging** — session logs written to your vault for debugging

---

## Supported Providers

| Provider | Type | Notes |
|---|---|---|
| 🌊 Mistral AI | Cloud | `mistral-small-latest` default |
| 🤖 OpenAI | Cloud | `gpt-4o-mini` default |
| 🔶 Anthropic Claude | Cloud | Native `/v1/messages` API; `claude-3-5-haiku` default |
| ⚡ Groq | Cloud | Ultra-fast inference; `llama-3.1-8b-instant` default |
| 🦙 Ollama | Local | OpenAI-compat on `localhost:11434`; `llama3.2` default |
| 🌐 OpenRouter | Cloud | Access 200+ models via one key |
| 🤝 Together AI | Cloud | `Meta-Llama-3.1-8B-Instruct-Turbo` default |
| 🏠 LM Studio (OpenAI) | Local | OpenAI-compat mode on `localhost:1234` |
| 🏠 LM Studio (Native v1) | Local | Stateful + SSE streaming; hardware-optimized ✨ |
| ⚙️ Custom endpoint | Any | Any OpenAI-compatible API |

---

## Installation

### Option A — Simple install (recommended for users)

1. In Obsidian, open **Settings → Community Plugins → Browse**
2. Search for **Vault Wiki**
3. Click **Install**, then **Enable**

If the plugin is not yet in the community registry, use **Option B**.

### Option B — Manual install

1. Download the latest release from [GitHub Releases](https://github.com/adhdboy411/vault-wiki/releases)
2. Unzip into your vault's plugin folder:  
   `<vault>/.obsidian/plugins/vault-wiki/`
3. The folder must contain exactly:
   - `main.js`
   - `manifest.json`
4. Reload Obsidian (`Ctrl/Cmd+R`) and enable the plugin under **Settings → Community Plugins**

### Option C — Build from source

> **Important:** The released `main.js` is the *single compiled output*. Building from source produces an identical file — no extra steps needed.

```bash
# Prerequisites: Node.js 18+ and npm
git clone https://github.com/adhdboy411/vault-wiki.git
cd vault-wiki
npm install
npm run build
```

Copy `main.js` and `manifest.json` into your vault plugin folder (see Option B above).  
The build output is deterministic — you get exactly the same `main.js` as the release.

---

## Quick Start

1. **Add some wikilinks** to your notes — e.g. `[[Action Potential]]`, `[[Sarcomere]]`, `[[Photosynthesis]]`
2. Open **Settings → Vault Wiki → AI Provider** and pick your provider
3. Add your API key (for cloud providers)
4. Click **Generate Wiki Notes** (ribbon icon 📖 or `Ctrl+P → Vault Wiki: Generate`)
5. Wiki notes appear in your `Wiki/` folder

---

## Configuration

### Settings Modes

| Mode | Description |
|---|---|
| **Auto** | Smart defaults — only pick a provider; everything else computed from hardware |
| **Manual** | All main settings visible (default for existing installs) |
| **Advanced** | Everything, including logging, term matching internals, raw sliders |

### Wiki Directory

By default, notes are written to `Wiki/` in your vault root. Change this under **Settings → Vault Wiki → Wiki Directory**.

> **Note:** The wiki folder is automatically excluded as a *source* of new terms — Vault Wiki will never read its own output as input. This prevents feedback loops.

### Categories

Define subject categories (e.g. Anatomy, Biochemistry, General) with paths, source folder hints, and tags. Vault Wiki auto-assigns each term to the best-matching category based on path, filename, and frontmatter signals.

### Synonyms / Abbreviations

Map short forms to full terms (e.g. `ACh → Acetylcholine`). Synonyms expand during matching, Wikipedia lookups, and dictionary lookups.

---

## Provider Setup

### Anthropic Claude

1. Get your key at [console.anthropic.com](https://console.anthropic.com)
2. Keys start with `sk-ant-…`
3. Select **🔶 Anthropic Claude** in Settings → Provider
4. Paste your key in **Anthropic API Key**
5. Recommended model: `claude-3-5-haiku-20241022` (fast + affordable)

### Groq

1. Get your key at [console.groq.com](https://console.groq.com)
2. Select **⚡ Groq** in Settings → Provider
3. Recommended model: `llama-3.1-8b-instant` (extremely fast, free tier available)

### Ollama (local, no key needed)

1. Install [Ollama](https://ollama.ai) and run `ollama pull llama3.2`
2. Select **🦙 Ollama** — endpoint auto-fills to `http://localhost:11434/v1`
3. No API key required

### LM Studio (Native v1, recommended for local)

1. Install [LM Studio](https://lmstudio.ai), load a model, enable the Local Server
2. Select **🏠 LM Studio — Native v1 ✨**
3. Hardware mode is auto-detected (CPU/GPU/Android/iOS)

### OpenRouter

1. Get your key at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Select **🌐 OpenRouter** — many free models available
3. Recommended free model: `meta-llama/llama-3.1-8b-instruct:free`

---

## Commands

| Command | Description |
|---|---|
| `Vault Wiki: Generate missing wiki notes` | Main command — runs full generation pass |
| `Vault Wiki: Refresh term cache` | Rebuild the term index manually |
| `Vault Wiki: Pause wiki generation` | Pause an in-progress run |
| `Vault Wiki: Resume wiki generation` | Resume after pause |
| `Vault Wiki: Cancel wiki generation` | Stop current run entirely |
| `Vault Wiki: Open latest log file` | View the most recent session log |
| `Vault Wiki: Flush log to vault now` | Force-write buffered log entries |

---

## Security

- **API keys** are stored locally in `.obsidian/plugins/vault-wiki/data.json` — they are never sent anywhere except the configured AI endpoint
- **Path traversal protection** — term names are sanitized before use as file paths; `..` sequences and unsafe characters are stripped
- **Write-safety guard** — Vault Wiki will only write to the wiki directory and log directory; any attempt to write outside is blocked
- **HTTPS enforcement** — cloud providers warn loudly if configured with an HTTP endpoint (your API key would be sent unencrypted)
- **SSRF protection** — endpoint URLs are validated against protocol and hostname rules before any network request

---

## Troubleshooting

**"No unresolved links found"**  
Create some `[[wikilinks]]` in your notes first. Vault Wiki only generates notes for terms that are actively linked from your notes.

**AI returns empty / null**  
- Check your API key is correct (Settings → AI Provider → Test Connection)
- Verify the model name is valid for your provider
- For LM Studio: ensure a model is loaded in the server

**Wiki notes not appearing in the right category**  
- Check your category `sourceFolder` setting — it should match the folder where your source notes live
- Add relevant `tags` to the category definition

**Performance is slow**  
- Switch to Settings → Performance → Batch Size (increase for cloud APIs)
- Use Context Depth: `partial` or `performance` instead of `full`
- Use a smaller/faster model (Groq's free tier is excellent for this)

---

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for full history.

### v1.0.0 — Public Beta
- 🚀 No longer a dev/early beta — ready for general use
- ✅ Added providers: Anthropic Claude, Groq, Ollama, OpenRouter, Together AI
- 🛡️ Security hardening: HTTPS enforcement, key trimming, model name validation, SSRF improvements
- ⚡ Performance: AbortController on streaming, per-term cancel checks, provider config table
- 🎨 UX: per-provider model suggestions, cleaner provider cards, better empty states

---

## Contributing

Issues and PRs welcome at [github.com/adhdboy411/vault-wiki](https://github.com/adhdboy411/vault-wiki).

---

*Vault Wiki is a community plugin and is not affiliated with Obsidian, Anthropic, OpenAI, or any other AI provider.*
