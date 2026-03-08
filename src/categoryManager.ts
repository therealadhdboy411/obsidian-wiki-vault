// ============================================================================
// CATEGORY MANAGER
// ============================================================================

import { TFile, getAllTags } from 'obsidian';
import type { App } from 'obsidian';
import type { WikiVaultSettings, CategoryConfig } from './types';
import type { WikiVaultLogger } from './logger';

/**
 * Manages category assignment for wiki notes.
 *
 * Priority order for category matching:
 *   1. Source folder (explicit path prefix match)
 *   2. Tags (file has any tag in category.tags)
 *   3. Keywords (file name contains a keyword)
 *   4. Default category (fallback)
 *
 * ⚡ BOLT v3.5.2: Pre-computes a category lookup map (_catMap) on construction
 * and after settings save so that assignCategory() avoids repeated array scans.
 */
export class CategoryManager {
    app: App;
    settings: WikiVaultSettings;
    logger: WikiVaultLogger;

    /** Pre-computed signal map for fast O(1) category lookups. */
    private _catMap: {
        bySourceFolder: Array<{ prefix: string; cat: CategoryConfig }>;
        byTag: Map<string, CategoryConfig>;
        byKeyword: Array<{ lower: string; cat: CategoryConfig }>;
    } = { bySourceFolder: [], byTag: new Map(), byKeyword: [] };

    constructor(app: App, settings: WikiVaultSettings, logger: WikiVaultLogger) {
        this.app = app;
        this.settings = settings;
        this.logger = logger;
        this._buildCategoryMap();
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    /**
     * Determine which CategoryConfig should host a given source file.
     * Returns the default category if no rule matches.
     */
    assignCategory(file: TFile): CategoryConfig {
        if (!this.settings.useCategories) return this._defaultCat();

        // 1. Source folder match
        for (const entry of this._catMap.bySourceFolder) {
            if (file.path.startsWith(entry.prefix)) return entry.cat;
        }

        // 2. Tag match
        const cache = this.app.metadataCache.getFileCache(file);
        const fileTags = getAllTags(cache) ?? [];
        for (const tag of fileTags) {
            const stripped = tag.replace(/^#/, '');
            const cat = this._catMap.byTag.get(stripped.toLowerCase());
            if (cat) return cat;
        }

        // 3. Keyword match (against file name)
        const nameLower = file.basename.toLowerCase();
        for (const kw of this._catMap.byKeyword) {
            if (nameLower.includes(kw.lower)) return kw.cat;
        }

        return this._defaultCat();
    }

    /**
     * Return the vault path for a category by name.
     * Falls back to the wiki root if the category has no path.
     */
    getCategoryPath(catName: string): string {
        const cat = this.settings.categories?.find(c => c.name === catName);
        return cat?.path ?? this.settings.customDirectoryName ?? 'Wiki';
    }

    /**
     * Ensure the folder for a category exists. Creates it if missing.
     */
    async ensureCategoryFolder(cat: CategoryConfig): Promise<void> {
        const folderPath = cat.path || `${this.settings.customDirectoryName ?? 'Wiki'}/${cat.name}`;
        const existing = this.app.vault.getAbstractFileByPath(folderPath);
        if (!existing) {
            try {
                await this.app.vault.createFolder(folderPath);
                this.logger.debug('CategoryManager', `Created category folder: ${folderPath}`);
            } catch (err) {
                // May already exist due to race — that's fine
                this.logger.debug('CategoryManager', `Folder already exists or create failed: ${folderPath}`);
            }
        }
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /**
     * ⚡ BOLT: Pre-compute lookup maps from settings arrays.
     * Called on construction and after settings save.
     */
    _buildCategoryMap(): void {
        this._catMap = { bySourceFolder: [], byTag: new Map(), byKeyword: [] };
        const cats = (this.settings.categories ?? []).filter(c => c.enabled !== false);

        for (const cat of cats) {
            // Source folder
            if (cat.sourceFolder) {
                this._catMap.bySourceFolder.push({
                    prefix: cat.sourceFolder.endsWith('/') ? cat.sourceFolder : cat.sourceFolder + '/',
                    cat,
                });
            }
            // Tags
            for (const tag of (cat.tags ?? [])) {
                const lower = tag.replace(/^#/, '').toLowerCase();
                if (lower && !this._catMap.byTag.has(lower)) {
                    this._catMap.byTag.set(lower, cat);
                }
            }
            // Keywords
            for (const kw of (cat.keywords ?? [])) {
                const lower = kw.toLowerCase().trim();
                if (lower) this._catMap.byKeyword.push({ lower, cat });
            }
        }

        this.logger.debug('CategoryManager', `Category map rebuilt — ${cats.length} enabled categories`);
    }

    private _defaultCat(): CategoryConfig {
        const name = this.settings.defaultCategory;
        return (
            this.settings.categories?.find(c => c.name === name) ??
            this.settings.categories?.[0] ?? {
                name: 'General',
                path: this.settings.customDirectoryName ?? 'Wiki',
                sourceFolder: '',
                tags: [],
                keywords: [],
                enabled: true,
            }
        );
    }
}
