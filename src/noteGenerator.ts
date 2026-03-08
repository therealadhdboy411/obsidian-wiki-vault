// ============================================================================
// NOTE GENERATOR
// ============================================================================

import { App, Notice, TFile, TFolder, getAllTags, requestUrl } from 'obsidian';
import type {
    WikiVaultSettings, ContextData, MentionEntry, FileContentCacheEntry,
    AISummaryResult, AIConnectionResult, FileCategoryEntry,
    CategoryConfig, DictionaryData, WikipediaData,
} from './types';
import type { WikiVaultLogger } from './logger';
import type { TermCache } from './termCache';
import type { CategoryManager } from './categoryManager';
import { LMStudioV1Client } from './lmstudio';
import { PROMPT_PRESETS, PROVIDER_MAP, getProviderConfig } from './constants';
import {
    sanitizeTermForPath, assertSafeWritePath, maskApiKey,
    validateEndpointUrl, validateEndpointProtocol,
    stripMarkupForAI, yieldToUI, formatETA, formatProgressBar,
    getSingularForm, getPluralForm, detectHardwareMode, getAutoConfig,
    getDefaultModelForHardware, hardwareModeLabel, isLookupableTerm,
} from './utils';

export class NoteGenerator {
    app: App;
    settings: WikiVaultSettings;
    termCache: TermCache;
    categoryManager: CategoryManager;
    logger: WikiVaultLogger;

    // ── Generation state ─────────────────────────────────────────────────────
    isPaused = false;
    private _isCancelled = false;
    private _pauseResolver: (() => void) | null = null;

    // ── Per-run caches ───────────────────────────────────────────────────────
    /** ⚡ BOLT: file path → full file content + parsed structure */
    private _fileContentCache: Map<string, FileContentCacheEntry> = new Map();
    /** ⚡ BOLT: term (lower) → files that mention it, built once per run */
    private _mentionIndex: Map<string, TFile[]> = new Map();
    /** Wikipedia excerpt cache (per run) */
    private _wikiCache: Map<string, WikipediaData | null> = new Map();
    /** Dictionary cache (per run) */
    private _dictCache: Map<string, DictionaryData | null> = new Map();
    /** AI subcategory cache (session-level) */
    _subcatCache: Map<string, string> = new Map();
    /** Subcategories seen per main-category (session) */
    _subcatByCategory: Map<string, Set<string>> = new Map();

    // ── LM Studio v1 client (lazy) ───────────────────────────────────────────
    _lmstudioV1: LMStudioV1Client | null = null;

    // ── Hardware mode (cached per run) ───────────────────────────────────────
    _hwMode: string | null = null;

    // ── Per-session warning flags ─────────────────────────────────────────────
    _shownNoKeyWarning = false;
    _shownEndpointWarning = false;
    _shownAIError = false;
    _shownShapeWarning = false;

    // ── Resolved prompts (set in generateAll, respect Auto mode) ─────────────
    _resolvedSystemPrompt = '';
    _resolvedUserTemplate = '';

    constructor(
        app: App,
        settings: WikiVaultSettings,
        termCache: TermCache,
        categoryManager: CategoryManager,
        logger: WikiVaultLogger,
    ) {
        this.app = app;
        this.settings = settings;
        this.termCache = termCache;
        this.categoryManager = categoryManager;
        this.logger = logger;
    }

    // ── Public control API ────────────────────────────────────────────────────

    pause(): void { this.isPaused = true; }
    resume(): void {
        this.isPaused = false;
        if (this._pauseResolver) { this._pauseResolver(); this._pauseResolver = null; }
    }
    cancel(): void { this._isCancelled = true; this.resume(); }

    private async _waitIfPaused(): Promise<void> {
        if (!this.isPaused) return;
        await new Promise<void>(resolve => { this._pauseResolver = resolve; });
    }

    // ── Main entry point ─────────────────────────────────────────────────────

    async generateAll(): Promise<void> {
        const t0 = performance.now();
        this._isCancelled = false;
        this._hwMode = detectHardwareMode(this.settings) as string;

        // Resolve prompts once — respect Auto/Manual/Advanced mode
        const mode = this.settings.settingsMode ?? 'auto';
        if (mode === 'auto') {
            const ac = getAutoConfig(this._hwMode, this.settings.provider);
            const preset = PROMPT_PRESETS[ac.promptPreset] ?? PROMPT_PRESETS.balanced;
            this._resolvedSystemPrompt = preset.system;
            this._resolvedUserTemplate = preset.user;
        } else {
            this._resolvedSystemPrompt = this.settings.systemPrompt;
            this._resolvedUserTemplate = this.settings.userPromptTemplate;
        }

        // Initialise LM Studio v1 client (lazy)
        if (this.settings.provider === 'lmstudio-v1') {
            this._lmstudioV1 = new LMStudioV1Client(this.settings, this.logger);
        }

        this.logger.info('NoteGenerator', 'generateAll starting', {
            terms: this.termCache.termIndex.size,
            mode,
            hwMode: this._hwMode,
        });

        // ── Pre-read all file content ⚡ BOLT B5 ──────────────────────────────
        await this._preReadFiles();
        // ── Build mention index ⚡ BOLT B6 ────────────────────────────────────
        this._buildMentionIndex();

        // Determine term order
        const allTerms = this.settings.usePriorityQueue
            ? this.termCache.getTermsByPriority().map(e => e.term)
            : Array.from(this.termCache.termIndex.keys());

        const wikiRoot = this.settings.customDirectoryName ?? 'Wiki';

        // Determine batch size (respect Auto mode)
        const batchSize = mode === 'auto'
            ? getAutoConfig(this._hwMode, this.settings.provider).batchSize
            : (this.settings.batchSize ?? 5);

        // Context max chars (respect Auto mode)
        const ctxMaxChars = mode === 'auto'
            ? getAutoConfig(this._hwMode, this.settings.provider).aiContextMaxChars
            : (this.settings.aiContextMaxChars ?? 20_000);

        let done = 0;
        const total = allTerms.length;
        let progressNote: Notice | null = null;
        const progressStart = performance.now();

        if (this.settings.showProgressNotification && total > 0) {
            progressNote = new Notice(`Vault Wiki: ${formatProgressBar(0, total)} 0/${total}`, 0);
        }

        for (let i = 0; i < allTerms.length; i += batchSize) {
            if (this._isCancelled) break;
            await this._waitIfPaused();

            const batch = allTerms.slice(i, i + batchSize);
            await Promise.all(batch.map(term => this.generateNote(term, wikiRoot, ctxMaxChars)));
            done += batch.length;
            await yieldToUI();

            // ── Progress update ──────────────────────────────────────────────────
            if (progressNote && total > 0) {
                const elapsed = performance.now() - progressStart;
                const rate = done / elapsed; // terms per ms
                const remaining = (total - done) / (rate || 0.001);
                const eta = formatETA(remaining);
                const bar = formatProgressBar(done, total);
                progressNote.setMessage(`Vault Wiki: ${bar} ${done}/${total} · ETA ${eta}`);
            }
        }

        const elapsed = Math.round(performance.now() - t0);
        this.logger.stats.totalMs += elapsed;

        if (progressNote) progressNote.hide();

        this.logger.info('NoteGenerator', `generateAll finished in ${elapsed}ms — ${this.logger.summariseStats()}`);
        if (total > 0) {
            new Notice(`Vault Wiki: Done — ${this.logger.stats.generated} generated, ${this.logger.stats.skipped} skipped`, 5000);
        }

        // Flush log at end of run
        await this.logger._flush();

        // Clear per-run caches (keep session caches like _subcatCache)
        this._fileContentCache.clear();
        this._mentionIndex.clear();
        this._wikiCache.clear();
        this._dictCache.clear();
    }

    // ── Per-note generation ───────────────────────────────────────────────────

    async generateNote(term: string, wikiRoot: string, ctxMaxChars: number): Promise<void> {
        const safeTerm = sanitizeTermForPath(term);
        if (!safeTerm || safeTerm === 'Untitled') {
            this.logger.warn('NoteGenerator', `Skipping invalid term: "${term}"`);
            this.logger.stats.skipped++;
            return;
        }

        // Determine category
        const sourceFiles = this.termCache.getFilesForTerm(term);
        let category = this.categoryManager._defaultCat?.() ?? {
            name: 'General',
            path: wikiRoot,
            sourceFolder: '',
            tags: [],
            keywords: [],
            enabled: true,
        };

        // ⚡ BOLT B7: precompute category for source files once
        const fileCategories = new Map<string, FileCategoryEntry>();
        if (this.settings.useCategories && sourceFiles.length > 0) {
            const result = await this.determineBestCategory(term, sourceFiles, fileCategories);
            if (result) category = result;
        }

        // AI Subcategory
        let subcat: string | null = null;
        if (this.settings.aiSubcategoriesEnabled && this.settings.useCategories) {
            subcat = await this.getAISubcategory(term, category.name);
        }

        // Build target path
        let noteDir = category.path ?? wikiRoot;
        if (subcat) noteDir = `${noteDir}/${subcat}`;
        const notePath = `${noteDir}/${safeTerm}.md`;

        // 🛡️ SENTINEL: Verify the resolved path is inside the wiki root
        try {
            assertSafeWritePath(notePath, wikiRoot);
        } catch (err) {
            this.logger.error('NoteGenerator', `Write blocked for "${term}"`, err);
            this.logger.stats.skipped++;
            return;
        }

        // Check auto-update logic
        const existing = this.app.vault.getAbstractFileByPath(notePath);
        if (existing instanceof TFile) {
            if (!this.settings.autoUpdateExistingNotes) {
                this.logger.debug('NoteGenerator', `Skipping existing note: ${notePath}`);
                this.logger.stats.skipped++;
                return;
            }
            // Only regenerate if source files are newer than the wiki note
            const noteTime = existing.stat.mtime;
            const anyNewer = sourceFiles.some(f => f.stat.mtime > noteTime);
            if (!anyNewer) {
                // Check if AI summary is present; if not, force regenerate
                const content = await this.app.vault.read(existing);
                const hasSummary = content.includes('## 🤖 AI Summary') && !content.includes('*No AI summary*');
                if (hasSummary) {
                    this.logger.debug('NoteGenerator', `Up to date: ${notePath}`);
                    this.logger.stats.skipped++;
                    return;
                }
            }
        }

        // Extract context
        const ctxData = await this.extractContext(term, ctxMaxChars);
        if (!ctxData.rawContext && sourceFiles.length === 0) {
            this.logger.warn('NoteGenerator', `No context for "${term}" — skipping`);
            this.logger.stats.skipped++;
            return;
        }

        // AI summary
        const aiResult = await this.getAISummary(term, ctxData.rawContext);

        // External data
        const [wikiData, dictData] = await Promise.all([
            this.settings.useWikipedia && isLookupableTerm(term) ? this._fetchWikipedia(term) : Promise.resolve(null),
            this.settings.useDictionaryAPI && isLookupableTerm(term) ? this._fetchDictionary(term) : Promise.resolve(null),
        ]);

        // Tags
        const tags = this.settings.generateTags
            ? await this.generateTags(term, ctxData, fileCategories)
            : [];

        // Related concepts
        const related = this.settings.generateRelatedConcepts
            ? await this.getRelatedConcepts(term, ctxData.rawContext)
            : [];

        // Build and write note
        const noteContent = await this.buildNoteContent({
            term,
            safeTerm,
            aiResult,
            ctxData,
            wikiData,
            dictData,
            tags,
            related,
            category,
        });

        try {
            // Ensure folder exists
            await this._ensureFolder(noteDir);

            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, noteContent);
                this.logger.info('NoteGenerator', `Updated: ${notePath}`);
            } else {
                await this.app.vault.create(notePath, noteContent);
                this.logger.info('NoteGenerator', `Created: ${notePath}`);
            }
            this.logger.stats.generated++;
        } catch (err) {
            this.logger.error('NoteGenerator', `Failed to write "${notePath}"`, err);
            this.logger.stats.failed++;
        }
    }

    // ── Context extraction ────────────────────────────────────────────────────

    async extractContext(term: string, maxChars: number): Promise<ContextData> {
        const mode = this.settings.settingsMode === 'auto'
            ? getAutoConfig(this._hwMode ?? detectHardwareMode(this.settings) as string, this.settings.provider).contextDepth
            : (this.settings.contextDepth ?? 'partial');

        const mentions: MentionEntry[] = [];
        const sourceFiles: TFile[] = [];
        const seenParagraphs = new Set<string>();
        let totalChars = 0;

        // Find files mentioning this term via wikilinks
        const termFiles = this.termCache.getFilesForTerm(term);

        for (const file of termFiles) {
            if (totalChars >= maxChars) break;
            sourceFiles.push(file);

            const cached = this._fileContentCache.get(file.path);
            if (!cached) continue;

            const { lines, headingByLine } = cached;
            // Find lines that contain [[term]] or variants
            for (let li = 0; li < lines.length; li++) {
                const line = lines[li];
                const lower = line.toLowerCase();
                const termLower = term.toLowerCase();

                // Check if this line links to our term
                const isLinked =
                    lower.includes(`[[${termLower}]]`) ||
                    lower.includes(`[[${getSingularForm(termLower)}]]`) ||
                    lower.includes(`[[${getPluralForm(termLower)}]]`) ||
                    // Handle aliases: [[Target|Alias]]
                    new RegExp(`\\[\\[${termLower}\\s*\\|`, 'i').test(lower);

                if (!isLinked) continue;

                // Gather surrounding paragraph
                const contextLines: string[] = [];
                if (mode === 'performance') {
                    contextLines.push(line.trim());
                } else {
                    const around = this.settings.contextLinesAround ?? 2;
                    const start = Math.max(0, li - around);
                    const end = Math.min(lines.length - 1, li + around);
                    for (let j = start; j <= end; j++) {
                        if (lines[j].trim()) contextLines.push(lines[j].trim());
                    }
                }

                const paragraphKey = contextLines.join(' ').slice(0, 100);
                if (seenParagraphs.has(paragraphKey)) continue;
                seenParagraphs.add(paragraphKey);

                const heading = headingByLine[li] ?? null;
                mentions.push({
                    file,
                    heading,
                    contentLines: contextLines,
                    type: 'wikilinked',
                });

                totalChars += contextLines.join(' ').length;
                if (totalChars >= maxChars) break;
            }
        }

        // Build raw context string for AI
        const stripped: string[] = [];
        for (const m of mentions) {
            const prefix = m.heading ? `[${m.file.basename} > ${m.heading}]` : `[${m.file.basename}]`;
            stripped.push(`${prefix}\n${m.contentLines.join('\n')}`);
        }

        // Append Wikipedia excerpt if configured
        let rawContext = stripped.join('\n\n');
        if (this.settings.useWikipedia && this.settings.useWikipediaInContext && isLookupableTerm(term)) {
            const wiki = await this._fetchWikipedia(term);
            if (wiki?.extract) rawContext += `\n\n[Wikipedia]\n${wiki.extract}`;
        }
        if (this.settings.useDictionaryAPI && this.settings.useDictionaryInContext && isLookupableTerm(term)) {
            const dict = await this._fetchDictionary(term);
            if (dict?.plain) rawContext += `\n\n[Dictionary]\n${dict.plain}`;
        }

        // Strip markup and apply final char cap ⚡ BOLT
        rawContext = stripMarkupForAI(rawContext, maxChars);

        return { mentions, sourceFiles, rawContext };
    }

    // ── Category determination ────────────────────────────────────────────────

    async determineBestCategory(
        term: string,
        sourceFiles: TFile[],
        fileCategories: Map<string, FileCategoryEntry>,
    ): Promise<CategoryConfig | null> {
        if (!this.settings.useCategories || !sourceFiles.length) return null;

        const scores: Map<string, number> = new Map();
        const catByName: Map<string, CategoryConfig> = new Map();

        for (const file of sourceFiles) {
            const cat = this.categoryManager.assignCategory(file);
            if (!cat) continue;
            catByName.set(cat.name, cat);
            scores.set(cat.name, (scores.get(cat.name) ?? 0) + 1);

            // Cache for generateTags() reuse ⚡ BOLT B7
            const cache = this.app.metadataCache.getFileCache(file);
            const fileTags = getAllTags(cache) ?? [];
            fileCategories.set(file.path, { category: cat, fileTags });
        }

        if (scores.size === 0) return null;
        // Return highest-scored category
        const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0];
        return catByName.get(best[0]) ?? null;
    }

    // ── Note content builder ──────────────────────────────────────────────────

    async buildNoteContent(opts: {
        term: string;
        safeTerm: string;
        aiResult: AISummaryResult | null;
        ctxData: ContextData;
        wikiData: WikipediaData | null;
        dictData: DictionaryData | null;
        tags: string[];
        related: string[];
        category: CategoryConfig;
    }): Promise<string> {
        const { term, safeTerm, aiResult, ctxData, wikiData, dictData, tags, related } = opts;
        const now = new Date().toISOString();
        const sourceFileList = ctxData.sourceFiles.map(f => `"${f.path}"`).join(', ');

        // ── Frontmatter ──────────────────────────────────────────────────────────
        const fm: string[] = [
            '---',
            `title: "${safeTerm}"`,
            `wiki_term: "${safeTerm}"`,
            `generated: "${now}"`,
        ];
        if (tags.length > 0) {
            const formatted = tags.map(t =>
                this.settings.tagsIncludeHashPrefix ? (t.startsWith('#') ? t : `#${t}`) : t.replace(/^#/, ''),
            );
            fm.push(`tags: [${formatted.join(', ')}]`);
        }
        if (this.settings.trackModel && this.settings.modelName) {
            fm.push(`ai_model: "${this.settings.modelName}"`);
        }
        if (sourceFileList) fm.push(`source_files: [${sourceFileList}]`);
        fm.push('---', '');

        // ── Title ─────────────────────────────────────────────────────────────────
        const sections: string[] = [`${fm.join('\n')}# ${safeTerm}\n`];

        // ── AI Summary ────────────────────────────────────────────────────────────
        sections.push('## 🤖 AI Summary\n');
        if (aiResult?.text) {
            sections.push(aiResult.text.trim());
            if (aiResult.truncated) {
                sections.push('\n> ⚠️ *AI response was truncated — context may be incomplete.*');
            }
            if (this.settings.aiSummaryDisclaimer) {
                sections.push(`\n\n${this.settings.aiSummaryDisclaimer}`);
            }
        } else {
            sections.push('*No AI summary generated.*');
        }

        // ── Extract key concepts (from existing summaries) ─────────────────────
        if (this.settings.extractKeyConceptsFromSummary && aiResult?.text) {
            const boldPhrases = [...aiResult.text.matchAll(/\*\*([^*]+)\*\*/g)]
                .map(m => m[1])
                .filter(p => p.toLowerCase() !== term.toLowerCase() && p.length > 2)
                .slice(0, 5);
            if (boldPhrases.length > 0) {
                sections.push(`\n\n> 🔑 **Key concepts:** ${boldPhrases.join(' · ')}`);
            }
        }

        // ── Wikipedia ─────────────────────────────────────────────────────────────
        if (wikiData?.extract) {
            sections.push(`\n\n## 📚 Wikipedia\n\n${wikiData.extract}`);
            sections.push(`\n[${this.settings.wikipediaLinkText ?? 'Read more on Wikipedia'}](${wikiData.url})`);
        }

        // ── Dictionary ───────────────────────────────────────────────────────────
        if (dictData?.formatted) {
            sections.push(`\n\n## 📖 Dictionary\n\n${dictData.formatted}`);
        }

        // ── Mentions / usage in notes ────────────────────────────────────────────
        if (ctxData.mentions.length > 0) {
            sections.push('\n\n## 📎 Mentions in Notes\n');
            for (const m of ctxData.mentions) {
                sections.push(this._formatMention(m));
            }
        }

        // ── Related concepts ─────────────────────────────────────────────────────
        if (related.length > 0) {
            sections.push('\n\n## 🔗 Related Concepts\n');
            sections.push(related.map(r => `- [[${r}]]`).join('\n'));
        }

        return sections.join('\n');
    }

    private _formatMention(m: MentionEntry): string {
        const source = m.heading
            ? `[[${m.file.basename}#${m.heading}|${m.file.basename} > ${m.heading}]]`
            : `[[${m.file.basename}]]`;
        const lines = m.contentLines.join('\n> ');
        return `\n> ${lines}\n> — ${source}\n`;
    }

    // ── Tag generation ────────────────────────────────────────────────────────

    async generateTags(
        term: string,
        ctxData: ContextData,
        fileCategories: Map<string, FileCategoryEntry>,
    ): Promise<string[]> {
        const tags = new Set<string>();
        for (const file of ctxData.sourceFiles) {
            // ⚡ BOLT B7: reuse precomputed fileTags from fileCategories
            const cached = fileCategories.get(file.path);
            const category = cached?.category ?? this.categoryManager.assignCategory(file);
            for (const tag of (category.tags ?? [])) tags.add(tag);

            const fileTags = cached?.fileTags
                ?? (getAllTags(this.app.metadataCache.getFileCache(file)) ?? []);
            for (const tag of fileTags) tags.add(tag.replace('#', ''));
        }
        return Array.from(tags).slice(0, this.settings.maxTags ?? 20);
    }

    async getRelatedConcepts(term: string, context: string): Promise<string[]> {
        const wikiLinkPattern = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
        const concepts = new Set<string>();
        let match: RegExpExecArray | null;
        while ((match = wikiLinkPattern.exec(context)) !== null) {
            const concept = match[1];
            if (concept !== term && concept.length >= 3) concepts.add(concept);
        }
        return Array.from(concepts).slice(0, this.settings.maxRelatedConcepts ?? 10);
    }

    // ── External data fetching ─────────────────────────────────────────────────

    async _fetchWikipedia(term: string): Promise<WikipediaData | null> {
        if (this._wikiCache.has(term)) return this._wikiCache.get(term) ?? null;
        const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
        try {
            const resp = await requestUrl({ url, method: 'GET', timeout: 10_000 });
            const data = resp.json;
            if (!data?.extract) { this._wikiCache.set(term, null); return null; }
            const result: WikipediaData = {
                title: data.title,
                url: data.content_urls?.desktop?.page ?? `https://en.wikipedia.org/wiki/${encodeURIComponent(term)}`,
                extract: data.extract,
            };
            this._wikiCache.set(term, result);
            return result;
        } catch {
            this._wikiCache.set(term, null);
            return null;
        }
    }

    async _fetchDictionary(term: string): Promise<DictionaryData | null> {
        if (this._dictCache.has(term)) return this._dictCache.get(term) ?? null;
        const endpoint = this.settings.dictionaryAPIEndpoint || 'https://api.dictionaryapi.dev/api/v2/entries/en';
        const url = `${endpoint}/${encodeURIComponent(term.toLowerCase())}`;
        try {
            const resp = await requestUrl({ url, method: 'GET', timeout: 8_000 });
            const data = resp.json;
            if (!Array.isArray(data) || !data[0]) { this._dictCache.set(term, null); return null; }

            const entry = data[0];
            const lines: string[] = [];
            const plainLines: string[] = [];
            for (const meaning of (entry.meanings ?? []).slice(0, 3)) {
                lines.push(`**${meaning.partOfSpeech}**`);
                plainLines.push(meaning.partOfSpeech);
                for (const def of (meaning.definitions ?? []).slice(0, 2)) {
                    lines.push(`- ${def.definition}`);
                    plainLines.push(`- ${def.definition}`);
                    if (def.example) { lines.push(`  *"${def.example}"*`); }
                }
            }

            const result: DictionaryData = {
                formatted: lines.join('\n'),
                plain: plainLines.join('\n'),
            };
            this._dictCache.set(term, result);
            return result;
        } catch {
            this._dictCache.set(term, null);
            return null;
        }
    }

    // ── AI calls ──────────────────────────────────────────────────────────────

    async getAISummary(term: string, context: string): Promise<AISummaryResult | null> {
        const provider = this.settings.provider;
        const isCloud = !['lmstudio-openai', 'lmstudio-v1', 'ollama'].includes(provider);
        const hasKey = provider === 'anthropic'
            ? !!this.settings.anthropicApiKey
            : !!this.settings.openaiApiKey;

        // ── LM Studio native v1 path ─────────────────────────────────────────
        if (provider === 'lmstudio-v1') {
            if (!this._lmstudioV1) this._lmstudioV1 = new LMStudioV1Client(this.settings, this.logger);
            const userPrompt = this._resolvedUserTemplate
                .replace('{{term}}', term)
                .replace('{{context}}', context);
            const endpointErr = validateEndpointUrl(this.settings.lmstudioV1Endpoint || 'http://localhost:1234');
            if (endpointErr) {
                this.logger.error('NoteGenerator', `LM Studio v1 endpoint invalid: ${endpointErr}`);
                return null;
            }
            try {
                this.logger.stats.apiCalls++;
                const text = await this._lmstudioV1.chat(userPrompt, this._resolvedSystemPrompt, true);
                if (!text) { this.logger.stats.apiErrors++; return null; }
                return { text, truncated: false };
            } catch (err) {
                this.logger.stats.apiErrors++;
                this.logger.error('NoteGenerator', `LM Studio v1 summary failed for "${term}"`, err);
                return null;
            }
        }

        // ── Anthropic path ───────────────────────────────────────────────────
        if (provider === 'anthropic') {
            const userPrompt = this._resolvedUserTemplate
                .replace('{{term}}', term)
                .replace('{{context}}', context);
            try {
                this.logger.stats.apiCalls++;
                return await this._callAnthropicAPI(userPrompt, this._resolvedSystemPrompt, 1500);
            } catch (err) {
                this.logger.stats.apiErrors++;
                this.logger.error('NoteGenerator', `Anthropic summary failed for "${term}"`, err);
                return null;
            }
        }

        // ── Standard OpenAI-compatible path ─────────────────────────────────
        if (isCloud && !hasKey) {
            if (!this._shownNoKeyWarning) {
                this._shownNoKeyWarning = true;
                new Notice(`Vault Wiki: No API key set for ${provider}. Open Settings → AI Provider.`, 8000);
            }
            return null;
        }

        if (!context || context.trim() === '') return null;

        const protocolError = validateEndpointProtocol(this.settings.openaiEndpoint);
        if (protocolError) {
            if (!this._shownEndpointWarning) {
                this._shownEndpointWarning = true;
                new Notice(`Vault Wiki: Bad API endpoint — ${protocolError}`, 8000);
            }
            return null;
        }

        const ssrfError = validateEndpointUrl(this.settings.openaiEndpoint);
        if (ssrfError) {
            this.logger.error('NoteGenerator', `SSRF blocked for "${term}": ${ssrfError}`);
            return null;
        }

        this.logger.stats.apiCalls++;
        const userPrompt = this._resolvedUserTemplate
            .replace('{{term}}', term)
            .replace('{{context}}', context);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.settings.openaiApiKey) headers['Authorization'] = `Bearer ${this.settings.openaiApiKey}`;
        if (provider === 'openrouter') {
            headers['HTTP-Referer'] = 'https://obsidian.md';
            headers['X-Title'] = 'Vault Wiki';
        }

        const baseUrl = (this.settings._cachedOAIEndpoint
            ?? this.settings.openaiEndpoint.trim().replace(/\/+$/, ''));
        const url = `${baseUrl}/chat/completions`;

        try {
            const response = await requestUrl({
                url,
                method: 'POST',
                headers,
                timeout: 60_000,
                body: JSON.stringify({
                    model: this.settings.modelName,
                    messages: [
                        { role: 'system', content: this._resolvedSystemPrompt },
                        { role: 'user', content: userPrompt },
                    ],
                    max_tokens: 1500,
                }),
            });

            const data = response.json;
            if (!data?.choices?.[0]?.message?.content) {
                this.logger.stats.apiErrors++;
                if (!this._shownShapeWarning) {
                    this._shownShapeWarning = true;
                    new Notice(`Vault Wiki: AI returned unexpected format. Check model "${this.settings.modelName}".`, 8000);
                }
                return null;
            }

            const text = data.choices[0].message.content as string;
            const truncated = data.choices[0].finish_reason === 'length';
            if (truncated) this.logger.warn('NoteGenerator', `AI response truncated for "${term}"`);
            return { text, truncated };
        } catch (error: unknown) {
            const err = error as { status?: number; message?: string };
            this.logger.stats.apiErrors++;
            this.logger.error('NoteGenerator', `AI request failed for "${term}"`, error);
            if (!this._shownAIError) {
                this._shownAIError = true;
                const status = err?.status;
                let msg = `Vault Wiki: AI call failed`;
                if (status === 401) msg = `Vault Wiki: 401 Unauthorized — check your API key.`;
                else if (status === 404) msg = `Vault Wiki: 404 — check endpoint and model name.`;
                else if (status === 429) msg = `Vault Wiki: 429 Rate limited. Slow down or upgrade.`;
                else if (status != null && status >= 500) msg = `Vault Wiki: ${status} Server error. Try again later.`;
                else if (err?.message?.includes('timeout')) msg = `Vault Wiki: AI timed out. Check endpoint.`;
                else if (err?.message) msg = `Vault Wiki: AI call failed — ${err.message}`;
                new Notice(msg, 10_000);
            }
            return null;
        }
    }

    private async _callAnthropicAPI(
        userPrompt: string,
        systemPrompt: string,
        maxTokens: number,
    ): Promise<AISummaryResult | null> {
        const key = this.settings.anthropicApiKey;
        if (!key) return null;
        const model = this.settings.modelName || 'claude-3-5-haiku-20241022';
        const url = 'https://api.anthropic.com/v1/messages';

        const response = await requestUrl({
            url,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': key,
                'anthropic-version': this.settings.anthropicVersion || '2023-06-01',
            },
            timeout: 60_000,
            body: JSON.stringify({
                model,
                max_tokens: maxTokens,
                system: systemPrompt,
                messages: [{ role: 'user', content: userPrompt }],
            }),
        });

        const data = response.json;
        const text = data?.content?.[0]?.text ?? null;
        if (!text) return null;
        const truncated = data?.stop_reason === 'max_tokens';
        return { text, truncated };
    }

    // ── AI subcategory classification ─────────────────────────────────────────

    async getAISubcategory(term: string, categoryName: string): Promise<string | null> {
        const cacheKey = `${categoryName}::${term}`;
        if (this._subcatCache.has(cacheKey)) return this._subcatCache.get(cacheKey) ?? null;

        // Grab a brief context snippet
        const files = this.termCache.getFilesForTerm(term);
        const contextChars = this.settings.aiSubcategoryContextChars ?? 600;
        let snippet = '';
        for (const f of files.slice(0, 2)) {
            const cached = this._fileContentCache.get(f.path);
            if (cached) { snippet += cached.content.slice(0, contextChars / files.length); }
        }
        snippet = stripMarkupForAI(snippet, contextChars);

        const systemPrompt = this.settings.aiSubcategorySystemPrompt
            || PROMPT_PRESETS.balanced.subcatSystem;
        const userPrompt = `Category: ${categoryName}\nTerm: ${term}\nContext:\n${snippet}\n\nSubcategory:`;

        // Use existing AI infrastructure (generic call with small max_tokens)
        let subcatName: string | null = null;
        try {
            if (this.settings.provider === 'lmstudio-v1' && this._lmstudioV1) {
                subcatName = await this._lmstudioV1.chat(userPrompt, systemPrompt, false);
            } else if (this.settings.provider === 'anthropic') {
                const result = await this._callAnthropicAPI(userPrompt, systemPrompt, 20);
                subcatName = result?.text ?? null;
            } else {
                // OpenAI-compatible
                const baseUrl = this.settings.openaiEndpoint.trim().replace(/\/+$/, '');
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (this.settings.openaiApiKey) headers['Authorization'] = `Bearer ${this.settings.openaiApiKey}`;
                const resp = await requestUrl({
                    url: `${baseUrl}/chat/completions`,
                    method: 'POST',
                    headers,
                    timeout: 20_000,
                    body: JSON.stringify({
                        model: this.settings.modelName,
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: userPrompt },
                        ],
                        max_tokens: 20,
                    }),
                });
                subcatName = resp.json?.choices?.[0]?.message?.content ?? null;
            }
        } catch (err) {
            this.logger.debug('NoteGenerator', `AI subcategory failed for "${term}"`, err);
            subcatName = null;
        }

        // Sanitize the result
        if (subcatName) {
            subcatName = subcatName.trim()
                .replace(/[^a-zA-Z0-9 \-_]/g, '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 50);
            if (!subcatName) subcatName = null;
        }

        this._subcatCache.set(cacheKey, subcatName ?? '');

        // Track session subcats per main category
        if (subcatName) {
            if (!this._subcatByCategory.has(categoryName)) this._subcatByCategory.set(categoryName, new Set());
            this._subcatByCategory.get(categoryName)!.add(subcatName);
        }

        return subcatName;
    }

    // ── AI connection test ────────────────────────────────────────────────────

    async testAIConnection(): Promise<AIConnectionResult> {
        const provider = this.settings.provider;

        // Anthropic
        if (provider === 'anthropic') {
            if (!this.settings.anthropicApiKey) {
                return { success: false, message: 'No Anthropic API key set.' };
            }
            const t0 = performance.now();
            try {
                const result = await this._callAnthropicAPI('Reply with exactly: OK', 'You are a test assistant.', 10);
                const latencyMs = Math.round(performance.now() - t0);
                return result?.text
                    ? { success: true, message: `✅ Anthropic connected! Model: ${this.settings.modelName} — ${latencyMs}ms`, latencyMs }
                    : { success: false, message: '⚠️ Anthropic responded but returned empty content.' };
            } catch (err: unknown) {
                const latencyMs = Math.round(performance.now() - t0);
                const e = err as { message?: string };
                return { success: false, message: `❌ Anthropic failed after ${latencyMs}ms — ${e?.message ?? 'Unknown error'}` };
            }
        }

        // LM Studio v1
        if (provider === 'lmstudio-v1') {
            const endpoint = (this.settings.lmstudioV1Endpoint || 'http://localhost:1234').replace(/\/+$/, '');
            const endpointError = validateEndpointUrl(endpoint);
            if (endpointError) return { success: false, message: `Invalid LM Studio v1 endpoint: ${endpointError}` };
            const t0 = performance.now();
            try {
                let loadedModelId: string | null = null;
                try {
                    const modelsResp = await requestUrl({
                        url: `${endpoint}/api/v1/models`,
                        method: 'GET',
                        headers: this.settings.lmstudioV1ApiToken ? { Authorization: `Bearer ${this.settings.lmstudioV1ApiToken}` } : {},
                        timeout: 5000,
                    });
                    const models = modelsResp.json?.data;
                    if (Array.isArray(models) && models.length > 0) {
                        loadedModelId = models[0]?.id ?? null;
                    } else if (Array.isArray(models) && models.length === 0) {
                        return { success: false, message: `⚠️ LM Studio v1: No model loaded at ${endpoint}.` };
                    }
                } catch (modelErr: unknown) {
                    const e = modelErr as { message?: string };
                    const latencyMs = Math.round(performance.now() - t0);
                    return { success: false, message: `❌ Cannot reach ${endpoint} after ${latencyMs}ms — is LM Studio running? (${e?.message ?? 'network error'})` };
                }
                const client = new LMStudioV1Client(this.settings, this.logger);
                const result = await client.chat('Reply with exactly: OK', null, false);
                const latencyMs = Math.round(performance.now() - t0);
                const hwLabel = hardwareModeLabel(detectHardwareMode(this.settings) as string);
                return result
                    ? { success: true, message: `✅ LM Studio v1 connected! Model: ${loadedModelId ?? this.settings.modelName} — ${latencyMs}ms [${hwLabel}]`, latencyMs }
                    : { success: false, message: `⚠️ LM Studio v1: Server responded but inference returned no content.` };
            } catch (err: unknown) {
                const e = err as { message?: string };
                const latencyMs = Math.round(performance.now() - t0);
                return { success: false, message: `❌ LM Studio v1 failed after ${latencyMs}ms — ${e?.message ?? 'Unknown error'}` };
            }
        }

        // Standard OpenAI-compatible
        const hasKey = !!this.settings.openaiApiKey;
        const isCloud = !['lmstudio-openai', 'ollama'].includes(provider);
        if (isCloud && !hasKey) {
            return { success: false, message: `No API key set for ${provider}.` };
        }
        const endpointError = validateEndpointUrl(this.settings.openaiEndpoint);
        if (endpointError) return { success: false, message: `Invalid endpoint: ${endpointError}` };

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.settings.openaiApiKey) headers['Authorization'] = `Bearer ${this.settings.openaiApiKey}`;
        const baseUrl = this.settings.openaiEndpoint.trim().replace(/\/+$/, '');
        const t0 = performance.now();
        try {
            const response = await requestUrl({
                url: `${baseUrl}/chat/completions`,
                method: 'POST',
                headers,
                timeout: 20_000,
                body: JSON.stringify({
                    model: this.settings.modelName,
                    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
                    max_tokens: 10,
                }),
            });
            const latencyMs = Math.round(performance.now() - t0);
            const data = response.json;
            const text = data?.choices?.[0]?.message?.content;
            const usedModel = data?.model ?? this.settings.modelName;
            return text
                ? { success: true, message: `✅ Connected! Model: ${usedModel} — ${latencyMs}ms`, model: usedModel, latencyMs }
                : { success: false, message: `⚠️ Unexpected response shape. Check model "${this.settings.modelName}".` };
        } catch (error: unknown) {
            const err = error as { status?: number; message?: string };
            const latencyMs = Math.round(performance.now() - t0);
            const status = err?.status;
            let message = `❌ ${err?.message ?? 'Unknown error'} (after ${latencyMs}ms)`;
            if (status === 401) message = `❌ 401 Unauthorized — check your API key.`;
            else if (status === 404) message = `❌ 404 — check endpoint "${this.settings.openaiEndpoint}" and model "${this.settings.modelName}".`;
            else if (status === 429) message = `❌ 429 Rate limited.`;
            else if (status != null && status >= 500) message = `❌ ${status} Server error. Try again later.`;
            else if (err?.message?.includes('timeout')) message = `❌ Timed out after ${latencyMs}ms — is the endpoint reachable?`;
            return { success: false, message };
        }
    }

    /** Probe Mistral models from smallest to largest. */
    async findWorkingMistralModel(): Promise<{ success: boolean; model: string | null; message: string }> {
        const MISTRAL_MODELS = [
            'ministral-8b-latest',
            'ministral-14b-latest',
            'mistral-small-latest',
            'mistral-medium-latest',
            'mistral-large-latest',
        ];
        if (!this.settings.openaiApiKey) {
            return { success: false, model: null, message: 'No API key set.' };
        }
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.settings.openaiApiKey}`,
        };
        const baseUrl = (this.settings.openaiEndpoint || 'https://api.mistral.ai/v1').trim().replace(/\/+$/, '');
        const url = `${baseUrl}/chat/completions`;

        for (const model of MISTRAL_MODELS) {
            try {
                const t0 = performance.now();
                const response = await requestUrl({
                    url,
                    method: 'POST',
                    headers,
                    timeout: 15_000,
                    body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with exactly: OK' }], max_tokens: 10 }),
                });
                const latencyMs = Math.round(performance.now() - t0);
                const text = response.json?.choices?.[0]?.message?.content;
                if (text) {
                    return { success: true, model, message: `✅ Best working model: ${model} (${latencyMs}ms). Applied to settings.` };
                }
            } catch (err: unknown) {
                const e = err as { status?: number };
                if (e?.status === 401) return { success: false, model: null, message: '❌ 401 Unauthorized — check your API key.' };
            }
        }
        return { success: false, model: null, message: '❌ No working Mistral model found.' };
    }

    // ── Pre-computation helpers ───────────────────────────────────────────────

    /** ⚡ BOLT B5: Pre-read all markdown files into content cache before generation. */
    private async _preReadFiles(): Promise<void> {
        this._fileContentCache.clear();
        const files = this.app.vault.getMarkdownFiles();
        this.logger.debug('NoteGenerator', `Pre-reading ${files.length} files`);
        let count = 0;
        for (const file of files) {
            try {
                const content = await this.app.vault.read(file);
                const lines = content.split('\n');
                // Build heading-by-line map
                const headingByLine: (string | null)[] = new Array(lines.length).fill(null);
                let currentHeading: string | null = null;
                for (let i = 0; i < lines.length; i++) {
                    const m = lines[i].match(/^#{1,6}\s+(.+)/);
                    if (m) currentHeading = m[1].trim();
                    headingByLine[i] = currentHeading;
                }
                this._fileContentCache.set(file.path, { content, lines, headingByLine, file });
            } catch {
                // Unreadable file — skip
            }
            count++;
            if (count % 100 === 0) await yieldToUI();
        }
        this.logger.debug('NoteGenerator', `Pre-read complete: ${this._fileContentCache.size} files`);
    }

    /** ⚡ BOLT B6: Build mention index mapping term → files that wikilink to it. */
    private _buildMentionIndex(): void {
        this._mentionIndex.clear();
        for (const [path, cached] of this._fileContentCache) {
            const fileLinks = this.app.metadataCache.getFileCache(cached.file)?.links ?? [];
            for (const link of fileLinks) {
                const target = link.link.split('#')[0].split('|')[0].trim().toLowerCase();
                if (!target) continue;
                const existing = this._mentionIndex.get(target);
                if (existing) {
                    if (!existing.includes(cached.file)) existing.push(cached.file);
                } else {
                    this._mentionIndex.set(target, [cached.file]);
                }
            }
        }
        this.logger.debug('NoteGenerator', `Mention index: ${this._mentionIndex.size} terms`);
    }

    private async _ensureFolder(path: string): Promise<void> {
        const existing = this.app.vault.getAbstractFileByPath(path);
        if (existing instanceof TFolder) return;
        const parts = path.split('/');
        let current = '';
        for (const part of parts) {
            current = current ? `${current}/${part}` : part;
            const node = this.app.vault.getAbstractFileByPath(current);
            if (!node) {
                try { await this.app.vault.createFolder(current); } catch { /* already exists */ }
            }
        }
    }

    // ── Glossary ──────────────────────────────────────────────────────────────

    async getGlossaryContext(term: string): Promise<string> {
        if (!this.settings.glossaryBasePath) return '';
        try {
            const file = this.app.vault.getAbstractFileByPath(this.settings.glossaryBasePath);
            if (!(file instanceof TFile)) return '';
            const content = await this.app.vault.read(file);
            // Simple line-based search for the term
            const lines = content.split('\n');
            const matching = lines.filter(l => l.toLowerCase().includes(term.toLowerCase()));
            return matching.join('\n').slice(0, 500);
        } catch {
            return '';
        }
    }
}
