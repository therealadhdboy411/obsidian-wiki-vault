# Vault Wiki — Plugin Integration Guide

This document explains how Vault Wiki can work alongside other Obsidian plugins, and how external tools can interact with its outputs.

---

## Table of Contents

1. [How Vault Wiki Works (Integration Model)](#how-vault-wiki-works)
2. [Obsidian Copilot](#obsidian-copilot)
3. [Dataview](#dataview)
4. [Templater](#templater)
5. [QuickAdd](#quickadd)
6. [Canvas](#canvas)
7. [Excalidraw](#excalidraw)
8. [Smart Connections](#smart-connections)
9. [Note Refactor](#note-refactor)
10. [Breadcrumbs](#breadcrumbs)
11. [Tag Wrangler](#tag-wrangler)
12. [Spaced Repetition / Anki](#spaced-repetition--anki)
13. [Publishing: Obsidian Publish + Quartz](#publishing-obsidian-publish--quartz)
14. [Building a Plugin that Extends Vault Wiki](#building-a-plugin-that-extends-vault-wiki)
15. [Vault Wiki's Public API Surface](#vault-wikis-public-api-surface)

---

## How Vault Wiki Works

Understanding this makes integrations obvious.

**Input:** Vault Wiki scans your `.md` files for `[[wikilinks]]` and builds a term index. For each term that doesn't already have a wiki note, it calls an AI API (cloud or local) to generate a structured summary, then writes it to your configured `Wiki/` directory.

**Output:** Plain Markdown files in `Wiki/<Category>/<Subcategory>/<Term>.md`, with this frontmatter structure:

```yaml
---
title: "Neural Network"
tags: [wiki, neuroscience, machine-learning]
related:
  - "[[Activation Function]]"
  - "[[Backpropagation]]"
category: "Computer Science"
subcategory: "Machine Learning"
source_files:
  - "Notes/Lecture 3.md"
  - "Notes/Project Brief.md"
generated_by: "Vault Wiki v1.1.0 · mistral-small-latest"
generated_at: "2025-01-15T14:32:00Z"
wikipedia: "https://en.wikipedia.org/wiki/Neural_network"
---
```

This means **Vault Wiki is fully read-by-anything** — any plugin that can read Markdown or YAML frontmatter can consume its output.

---

## Obsidian Copilot

[Obsidian Copilot](https://github.com/logancyang/obsidian-copilot) is the most synergistic integration. Vault Wiki generates structured wiki notes; Copilot can use those notes as RAG context for its AI chat.

### Strategy A — Point Copilot at your Wiki folder

Copilot's **Custom Index Paths** setting lets you restrict which files it uses for retrieval. Adding your `Wiki/` directory means Copilot's chat will draw answers from Vault Wiki's generated entries.

**Setup:**
1. Open Copilot settings → **QA** tab → **Use Custom Index Paths**.
2. Add your wiki directory (default: `Wiki`).
3. Click **Force Re-index**.

Now when you ask Copilot a question, it searches your wiki notes first. Vault Wiki acts as a structured, pre-processed knowledge base that Copilot retrieves from.

### Strategy B — Use Vault Wiki to pre-generate context that Copilot then cites

Copilot works best when your vault has dense, accurate notes. Vault Wiki fills gaps automatically, so Copilot always has something to retrieve for every wikilink term you use.

**Workflow:**
```
You write notes with [[wikilinks]]
         ↓
Vault Wiki auto-generates Wiki/<Term>.md for each one
         ↓
Copilot indexes Wiki/ + your other notes
         ↓
You ask Copilot "explain Neural Network in the context of my project"
         ↓
Copilot retrieves Wiki/Machine Learning/Neural Network.md + your project notes
```

### Strategy C — Share AI providers (avoid double API costs)

Both plugins can call the same AI endpoint. If you use Mistral or OpenAI, configure the same API key in both. If you use a local Ollama instance, point both plugins at `http://localhost:11434/v1`.

**Recommended shared setup for local use:**

| Setting | Copilot | Vault Wiki |
|---------|---------|-----------|
| Provider | Ollama | Ollama |
| Endpoint | `http://localhost:11434` | `http://localhost:11434/v1` |
| Model | `llama3.2` | `llama3.2` |
| API key | (none) | (none) |

### Strategy D — Copilot → Vault Wiki handoff

You can use Copilot to draft content, then Vault Wiki to cross-link and expand it. The typical flow:

1. Chat with Copilot: "Draft a note on Receptor Tyrosine Kinase signaling."
2. Copilot writes a note with lots of `[[wikilinks]]`.
3. Run "Vault Wiki: Generate missing wiki notes" — all those linked terms now get wiki pages.
4. Your vault has instant depth on every concept Copilot mentioned.

### Avoiding Conflicts

- Do **not** point Vault Wiki and Copilot at the same output folder. Copilot may overwrite Vault Wiki notes.
- If using Copilot's "Auto Note Taker" feature, ensure it writes to a different directory than `Wiki/`.
- Both plugins can coexist on the same Ollama/LM Studio instance; they call independently.

---

## Dataview

[Dataview](https://github.com/blacksmithgu/obsidian-dataview) can query Vault Wiki's structured frontmatter.

### List all wiki notes in a category

````markdown
```dataview
TABLE category, subcategory, generated_at
FROM "Wiki"
WHERE category = "Neuroscience"
SORT generated_at DESC
```
````

### Show terms with related concepts

````markdown
```dataview
LIST related
FROM "Wiki"
WHERE length(related) > 3
SORT file.name ASC
```
````

### Find wiki notes generated from a specific source file

````markdown
```dataview
LIST
FROM "Wiki"
WHERE contains(source_files, "Notes/Lecture 3.md")
```
````

### Build a category index

````markdown
```dataview
TABLE rows.file.link AS "Terms", rows.subcategory AS "Subcategory"
FROM "Wiki"
GROUP BY category
SORT category ASC
```
````

### Track coverage: which wikilinks don't have a wiki note yet?

This requires a custom DataviewJS query:

````markdown
```dataviewjs
const allLinks = new Set();
for (const page of dv.pages('"Notes"')) {
    for (const link of page.file.outlinks) {
        allLinks.add(link.path);
    }
}

const wikiPaths = new Set(dv.pages('"Wiki"').map(p => p.file.path));
const missing = [...allLinks].filter(l => !wikiPaths.has(l) && l.endsWith('.md'));
dv.list(missing.map(p => dv.fileLink(p)));
```
````

---

## Templater

[Templater](https://github.com/SilentVoid13/Templater) can use Vault Wiki's API surface to trigger generation from templates.

### Template: auto-generate wiki on new note creation

Create a template file (`Templates/Auto-Wiki.md`):

```javascript
<%*
// Get the note's wikilinks
const file = tp.file.find_tfile(tp.file.path(true));
const cache = app.metadataCache.getFileCache(file);
const links = cache?.links?.map(l => l.link) ?? [];

if (links.length > 0) {
    const vw = app.plugins.plugins["vault-wiki"];
    if (vw) {
        new Notice(`Vault Wiki: queuing ${links.length} terms…`);
        // Non-blocking — generation runs in background
        vw.generator.generateForTerms(links, [file]);
    }
}
-%>
```

Set this as your default template in Templater settings, and every new note you create will automatically queue wiki generation for its wikilinks.

### Template: insert a wiki summary inline

```javascript
<%*
const term = await tp.system.prompt("Wiki term to look up:");
const vw = app.plugins.plugins["vault-wiki"];
if (!vw || !term) return;

// Find the wiki note if it exists
const slug = term.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const candidates = app.vault.getMarkdownFiles().filter(f =>
    f.path.startsWith(vw.settings.customDirectoryName) &&
    f.basename.toLowerCase() === term.toLowerCase()
);

if (candidates.length > 0) {
    const content = await app.vault.read(candidates[0]);
    tR += `\n> [!wiki] ${term}\n> ${content.split('\n').slice(5, 8).join('\n> ')}\n`;
} else {
    tR += `[[${term}]] _(wiki note not yet generated)_`;
}
-%>
```

---

## QuickAdd

[QuickAdd](https://github.com/chhoumann/quickadd) macros can chain Vault Wiki generation with other actions.

### Macro: capture term + generate wiki

```javascript
// QuickAdd macro script
module.exports = async function(params) {
    const { quickAddApi: qA, app } = params;
    
    // Prompt for a term
    const term = await qA.inputPrompt("Enter wiki term:");
    if (!term) return;
    
    // Get the active file as context
    const activeFile = app.workspace.getActiveFile();
    
    // Trigger Vault Wiki generation
    const vw = app.plugins.plugins["vault-wiki"];
    if (vw) {
        await vw.generateWikiNoteForTerm(term, activeFile);
        new Notice(`Wiki note created for: ${term}`);
    }
    
    // Insert a wikilink at cursor
    const editor = app.workspace.activeEditor?.editor;
    if (editor) {
        editor.replaceSelection(`[[${term}]]`);
    }
};
```

### Macro: bulk generate from a list file

```javascript
module.exports = async function(params) {
    const { app } = params;
    
    // Read terms from a designated "to-generate" file
    const listFile = app.vault.getAbstractFileByPath("Wiki/to-generate.md");
    if (!listFile) return;
    
    const content = await app.vault.read(listFile);
    const terms = content
        .split('\n')
        .map(l => l.replace(/^[-*]\s*/, '').trim())
        .filter(t => t.length > 2);
    
    const vw = app.plugins.plugins["vault-wiki"];
    if (vw && terms.length > 0) {
        new Notice(`Vault Wiki: generating ${terms.length} terms…`);
        await vw.generator.generateForTerms(terms, []);
        new Notice(`Vault Wiki: done!`);
    }
};
```

---

## Canvas

Vault Wiki notes work in Canvas because they're just Markdown files. Some tips:

- **Auto-populate a Canvas from a category:** Write a DataviewJS script that creates Canvas JSON programmatically from all notes in `Wiki/Neuroscience/`.
- **Concept map workflow:** Use Canvas to visually arrange wiki notes. Their `related` frontmatter field makes natural edges between nodes.

---

## Excalidraw

[Excalidraw for Obsidian](https://github.com/zsviczian/obsidian-excalidraw-plugin) can embed wiki notes as card-style frames. Use the "Embed file" feature to embed `Wiki/Category/Term.md` into a drawing as a live-linked card.

---

## Smart Connections

[Smart Connections](https://github.com/brianpetro/obsidian-smart-connections) builds semantic embeddings of your vault. Vault Wiki acts as a **force multiplier**: its structured entries contain definitions, mechanisms, and cross-references that are highly semantically rich — improving Smart Connections' retrieval quality for terms that previously had thin notes.

**Best practice:** Run Vault Wiki's full generation pass first, then run Smart Connections' indexing pass. The wiki notes provide precise semantic anchors for every term in your vault.

---

## Note Refactor

[Note Refactor](https://github.com/lynchjames/note-refactor-obsidian) extracts selections into new notes. A useful combo:

1. Write a long document with inline explanations of concepts.
2. Use Note Refactor to split each explanation into its own note.
3. Run Vault Wiki to enrich those notes with AI-generated summaries and cross-links.

---

## Breadcrumbs

[Breadcrumbs](https://github.com/SkepticMystic/breadcrumbs) builds hierarchical navigation from frontmatter. Vault Wiki's frontmatter is compatible out of the box:

```yaml
# Add to Vault Wiki's generated notes to create a Breadcrumbs hierarchy
parent: "[[Machine Learning]]"     # category link
```

To add this automatically, extend the `writeFinalNote()` method in `NoteGenerator` to include a `parent` field derived from `CategoryManager.assignCategory()`.

---

## Tag Wrangler

[Tag Wrangler](https://github.com/pjeby/tag-wrangler) can rename and merge tags. Since Vault Wiki generates tags automatically from source file tags + category keywords, Tag Wrangler is useful for normalising them after a generation run.

**Recommended workflow:**
1. Generate wiki notes.
2. Use Tag Wrangler's "Rename tag" to consolidate variants (e.g. `#neuroscience` + `#neuro` → `#neuroscience`).
3. Re-run Vault Wiki — it reads existing tags and won't duplicate.

---

## Spaced Repetition / Anki

[Spaced Repetition](https://github.com/st3v3nmw/obsidian-spaced-repetition) and [Obsidian to Anki](https://github.com/Pseudonium/Obsidian_to_Anki) can convert wiki notes into flashcards.

Vault Wiki generates notes in structured prose. To make them Anki-friendly, add a Templater post-processor that converts wiki entries to Q&A format:

```javascript
// Templater script: add #flashcard tags to wiki notes
<%*
const content = tp.file.content;
// Wrap the first paragraph as a question-answer pair
const lines = content.split('\n');
const firstPara = lines.find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
if (firstPara) {
    // Obsidian Spaced Repetition format
    tR += `\n\n---\n\nWhat is ${tp.file.title}?\n?\n${firstPara}\n\n#flashcard\n`;
}
-%>
```

---

## Publishing: Obsidian Publish + Quartz

Vault Wiki notes are plain Markdown with standard frontmatter — they work with both Obsidian Publish and static-site generators like [Quartz](https://quartz.jzhao.xyz/).

**For Quartz:** The `related` frontmatter array becomes backlinks automatically. The `category`/`subcategory` fields can be used as Quartz tags with a simple frontmatter transformer:

```js
// quartz/plugins/transformers/vaultWikiMeta.ts
import { QuartzTransformerPlugin } from "../types"

export const VaultWikiMeta: QuartzTransformerPlugin = () => ({
  name: "VaultWikiMeta",
  markdownPlugins() {
    return []
  },
  externalResources() {
    return {}
  },
  // Convert vault-wiki category/subcategory to Quartz tags
  frontmatterTransform(frontmatter) {
    if (frontmatter.category) {
      frontmatter.tags = frontmatter.tags ?? []
      frontmatter.tags.push(frontmatter.category.toLowerCase().replace(/ /g, "-"))
    }
    if (frontmatter.subcategory) {
      frontmatter.tags.push(frontmatter.subcategory.toLowerCase().replace(/ /g, "-"))
    }
    return frontmatter
  },
})
```

---

## Building a Plugin that Extends Vault Wiki

If you want to build an Obsidian plugin that adds features to Vault Wiki (custom AI providers, a graph view of wiki terms, etc.), you can access the plugin's runtime instance directly.

### Accessing the Plugin Instance

```typescript
import { App } from "obsidian";

function getVaultWiki(app: App) {
    return (app as any).plugins.plugins["vault-wiki"] as VaultWikiAPI | undefined;
}
```

### Runtime API (available on the plugin instance)

```typescript
interface VaultWikiAPI {
    // Settings (read-only outside plugin; use saveSettings to persist changes)
    settings: VaultWikiSettings;

    // Core components
    termCache:       TermCache;
    categoryManager: CategoryManager;
    generator:       NoteGenerator;
    logger:          WikiVaultLogger;
    crypto:          VaultWikiCrypto;

    // Commands
    generateWikiNotes():                    Promise<void>;
    generateWikiNotesForFile(file: TFile):  Promise<void>;
    generateWikiNoteForTerm(term: string, sourceFile?: TFile): Promise<void>;

    // Settings persistence
    loadSettings():  Promise<void>;
    saveSettings():  Promise<void>;
}
```

### Example: External plugin that adds a Vault Wiki button to the toolbar

```typescript
import { Plugin, addIcon } from "obsidian";

export default class MyExtensionPlugin extends Plugin {
    async onload() {
        this.addRibbonIcon("zap", "My Wiki Extension", async () => {
            const vw = (this.app as any).plugins.plugins["vault-wiki"];
            if (!vw) {
                new Notice("Vault Wiki is not installed.");
                return;
            }
            
            // Trigger generation
            await vw.generateWikiNotes();
        });
    }
}
```

### Example: Reading the term index

```typescript
const vw = getVaultWiki(app);
if (!vw) return;

// All indexed terms
const terms = [...vw.termCache.termIndex.keys()];

// Files that mention a specific term
const files = vw.termCache.termIndex.get("Neural Network") ?? [];

// Trigger a cache refresh
await vw.termCache.buildIndex();
```

### Example: Generating a single wiki note programmatically

```typescript
const vw = getVaultWiki(app);
if (!vw) return;

// Generate wiki notes for specific terms
await vw.generator.generateForTerms(
    ["Mitochondria", "ATP Synthesis"],   // terms to generate
    [],                                   // source files for context (optional)
);
```

### Example: Listening for generation events

Vault Wiki doesn't yet have a formal event emitter, but you can poll the logger for state changes:

```typescript
const vw = getVaultWiki(app);
// Check generation state
const isGenerating = vw?.generator._running ?? false;

// Watch settings changes via Obsidian's standard mechanism
this.registerInterval(window.setInterval(() => {
    const count = vw?.termCache.termIndex.size ?? 0;
    console.log(`Wiki has ${count} indexed terms`);
}, 5000));
```

---

## Vault Wiki's Public API Surface

The following table summarises what is safe to read and call from external plugins. Items marked 🔒 are internal implementation details that may change between versions.

### Plugin-level (WikiVaultUnifiedPlugin)

| Property / Method | Type | Safe to call externally? |
|-------------------|------|--------------------------|
| `settings` | object | ✅ Read. Don't write without `saveSettings()`. |
| `termCache` | TermCache | ✅ |
| `categoryManager` | CategoryManager | ✅ |
| `generator` | NoteGenerator | ✅ (use public methods) |
| `logger` | WikiVaultLogger | ✅ Read. |
| `crypto` | VaultWikiCrypto | ✅ (encrypt/decrypt only) |
| `generateWikiNotes()` | async → void | ✅ |
| `generateWikiNotesForFile(file)` | async → void | ✅ |
| `generateWikiNoteForTerm(term, file?)` | async → void | ✅ |
| `saveSettings()` | async → void | ✅ |
| `loadSettings()` | async → void | ✅ |
| `_setStatus(text)` | → void | 🔒 Internal |

### TermCache

| Property / Method | Safe? |
|-------------------|-------|
| `termIndex` | ✅ `Map<string, TFile[]>` |
| `headingIndex` | ✅ `Map<string, string>` |
| `buildIndex()` | ✅ |
| `refresh()` | ✅ |
| `_buildReverseSynonyms()` | 🔒 |

### NoteGenerator

| Property / Method | Safe? |
|-------------------|-------|
| `generateAll()` | ✅ (prefer `generateWikiNotes()` on plugin) |
| `generateForTerms(terms, files)` | ✅ |
| `pause()` | ✅ |
| `resume()` | ✅ |
| `cancel()` | ✅ |
| `_running` | ✅ Read-only — true if generation in progress |
| `_cancelled` | 🔒 |
| `_callAIRaw()` | 🔒 |

### Global Utility Functions

These are module-level functions safe to call if you import or eval the plugin:

```javascript
parseModelSizeB(modelName)          // → number | null
parseModelQuant(modelName)          // → string | null
getAutoConfigFromModel(name, hw, p) // → auto config object
detectHardwareMode(settings)        // → "cpu"|"gpu"|"android"|"ios"
sanitizeTermForPrompt(term)         // → string
fetchOllamaModels(endpoint)         // → Promise<[{name, sizeB}] | null>
fetchLMStudioModels(endpoint)       // → Promise<string[] | null>
```

---

*For questions about integrations, open a GitHub Discussion. For bugs, open an Issue.*
