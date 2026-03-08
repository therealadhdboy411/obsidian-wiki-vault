// ============================================================================
// TERM CACHE
// ============================================================================

import { TFile, getAllTags } from 'obsidian';
import type { App } from 'obsidian';
import type { WikiVaultSettings, MatchResult } from './types';
import type { WikiVaultLogger } from './logger';
import {
    getSingularForm, getPluralForm, escapeRegExp, yieldToUI,
} from './utils';

/**
 * ⚡ BOLT: TermCache indexes all wikilink targets in the vault.
 *
 * Key optimisations:
 *   • Only indexes terms that appear as [[wikilinks]] — much smaller than
 *     every word in every note.
 *   • Pre-computes reverse synonym map so lookups are O(1).
 *   • Stores TFile references directly so callers never re-query the vault.
 */
export class TermCache {
    app: App;
    settings: WikiVaultSettings;
    logger: WikiVaultLogger;

    /** Map from canonical term (lowercase) → Set of TFile references. */
    termIndex: Map<string, TFile[]> = new Map();

    /**
     * ⚡ BOLT v3.5.2: Pre-computed reverse synonym map.
     * Maps each alias (e.g. "ML") → canonical term (e.g. "Machine Learning"),
     * so we don't iterate the full synonyms object on every lookup.
     */
    private _reverseSynonyms: Map<string, string> = new Map();

    constructor(app: App, settings: WikiVaultSettings, logger: WikiVaultLogger) {
        this.app = app;
        this.settings = settings;
        this.logger = logger;
        this._buildReverseSynonyms();
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Rebuild the full term index by scanning all [[wikilinks]] in the vault.
     * Called once on startup and on "Refresh term cache" command.
     */
    async buildIndex(): Promise<void> {
        const t0 = performance.now();
        this.termIndex.clear();
        const files = this.app.vault.getMarkdownFiles();
        this.logger.debug('TermCache', `Building index from ${files.length} files`);

        let processed = 0;
        for (const file of files) {
            await this._indexFile(file);
            processed++;
            // Yield to UI every 50 files to keep Obsidian responsive
            if (processed % 50 === 0) await yieldToUI();
        }

        const elapsed = Math.round(performance.now() - t0);
        this.logger.info('TermCache', `Index built — ${this.termIndex.size} terms from ${files.length} files in ${elapsed}ms`);
    }

    /**
     * Lightweight refresh — re-scans modified files only.
     * Safe to call on every vault event (debounced by the plugin).
     */
    async refresh(): Promise<void> {
        // For simplicity, full rebuild. Could be optimised with mtime tracking.
        await this.buildIndex();
    }

    /** Find all TFiles that contain a wikilink to `term`. */
    getFilesForTerm(term: string): TFile[] {
        const key = term.toLowerCase();
        return (
            this.termIndex.get(key) ??
            this.termIndex.get(getSingularForm(key)) ??
            this.termIndex.get(getPluralForm(key)) ??
            []
        );
    }

    /**
     * Given a search term, return all match entries including synonyms and morphological variants.
     */
    findMatches(term: string): MatchResult[] {
        const results: MatchResult[] = [];
        const seen = new Set<string>();

        const addCandidate = (candidate: string) => {
            const lower = candidate.toLowerCase();
            if (seen.has(lower)) return;
            seen.add(lower);
            const files = this.getFilesForTerm(lower);
            if (files.length > 0) {
                results.push({
                    text: candidate,
                    startWord: 0,
                    endWord: 0,
                    wordCount: candidate.split(/\s+/).length,
                    files,
                });
            }
        };

        addCandidate(term);
        addCandidate(getSingularForm(term));
        addCandidate(getPluralForm(term));

        // Expand via synonym map
        const canonical = this._reverseSynonyms.get(term.toLowerCase());
        if (canonical) addCandidate(canonical);
        // Also check if term IS a canonical that has aliases
        for (const [from, to] of Object.entries(this.settings.synonyms ?? {})) {
            if (to.toLowerCase() === term.toLowerCase() && !seen.has(from.toLowerCase())) {
                addCandidate(from);
            }
        }

        return results;
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /**
     * ⚡ BOLT: Pre-compute reverse synonym map so lookups are O(1).
     * Called once on construction and after settings save.
     */
    _buildReverseSynonyms(): void {
        this._reverseSynonyms.clear();
        for (const [from, to] of Object.entries(this.settings.synonyms ?? {})) {
            this._reverseSynonyms.set(from.toLowerCase(), to);
        }
        this.logger.debug('TermCache', `Reverse synonyms: ${this._reverseSynonyms.size} entries`);
    }

    /**
     * Index all [[wikilinks]] found in a single file.
     * Extracts the link target (before any | alias separator).
     */
    private async _indexFile(file: TFile): Promise<void> {
        const links = this.app.metadataCache.getFileCache(file)?.links ?? [];
        for (const link of links) {
            // link.link is the raw target, may include subpath (#heading) and alias (|alias)
            const target = link.link.split('#')[0].split('|')[0].trim();
            if (!target || target.length < (this.settings.minWordLengthForAutoDetect ?? 3)) continue;

            const key = target.toLowerCase();
            // Skip if this file is already in the list for this key
            const existing = this.termIndex.get(key);
            if (existing) {
                if (!existing.includes(file)) existing.push(file);
            } else {
                this.termIndex.set(key, [file]);
            }
        }
    }

    /**
     * Build a regex for a term that matches whole words (optional) and
     * also handles common morphological variants.
     */
    buildRegex(term: string): RegExp {
        const escaped = escapeRegExp(term);
        const singular = escapeRegExp(getSingularForm(term));
        const plural = escapeRegExp(getPluralForm(term));
        const pattern = [escaped, singular, plural].filter((v, i, a) => a.indexOf(v) === i).join('|');
        const wb = this.settings.matchWholeWordsOnly ? '\\b' : '';
        return new RegExp(`${wb}(${pattern})${wb}`, 'gi');
    }

    /** Return terms sorted by mention count (most-linked first) for priority queue. */
    getTermsByPriority(): Array<{ term: string; count: number }> {
        const entries = Array.from(this.termIndex.entries()).map(([term, files]) => ({
            term,
            count: files.length,
        }));
        entries.sort((a, b) => b.count - a.count);
        return entries;
    }
}
