// ============================================================================
// MAIN PLUGIN CLASS — Entry point for Obsidian
// ============================================================================

import { Notice, Plugin, TFile, TFolder } from 'obsidian';
import { DEFAULT_SETTINGS } from './constants';
import { WikiVaultLogger } from './logger';
import { TermCache } from './termCache';
import { CategoryManager } from './categoryManager';
import { NoteGenerator } from './noteGenerator';
import { WikiVaultSettingTab } from './settingsTab';
import type { WikiVaultSettings } from './types';
import {
    detectHardwareMode, hardwareModeLabel, debounce,
} from './utils';

export class WikiVaultUnifiedPlugin extends Plugin {
    settings!: WikiVaultSettings;
    logger!: WikiVaultLogger;
    termCache!: TermCache;
    categoryManager!: CategoryManager;
    generator!: NoteGenerator;
    statusBarItem!: HTMLElement;

    // ⚡ Cached hardware mode (set once per session)
    _hwMode: string | null = null;

    async onload(): Promise<void> {
        console.log('Vault Wiki: Loading…');
        // 🛡️ SENTINEL: Wrap entire onload so a startup error shows a friendly Notice.
        try {
            await this.loadSettings();

            // ── Logger ─────────────────────────────────────────────────────────────
            this.logger = new WikiVaultLogger(this.app, this.settings);

            // ── Core components ────────────────────────────────────────────────────
            this.termCache = new TermCache(this.app, this.settings, this.logger);
            this.categoryManager = new CategoryManager(this.app, this.settings, this.logger);
            this.generator = new NoteGenerator(
                this.app, this.settings, this.termCache, this.categoryManager, this.logger,
            );

            // 🎨 PALETTE: Status bar chip
            this.statusBarItem = this.addStatusBarItem();
            this.statusBarItem.title = 'Vault Wiki — click to open settings';
            this.statusBarItem.setAttribute('aria-label', 'Vault Wiki status');
            this.statusBarItem.style.cursor = 'pointer';
            this.statusBarItem.addEventListener('click', () => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.app as any).setting?.open?.();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (this.app as any).setting?.openTabById?.('vault-wiki');
            });
            this._setStatus('⏳ Vault Wiki: Indexing…');

            // ⚡ BOLT: Defer index build until layout is ready so Obsidian's UI renders first
            this.app.workspace.onLayoutReady(async () => {
                await this.termCache.buildIndex();
                const termCount = this.termCache.termIndex.size;
                this._hwMode = detectHardwareMode(this.settings) as string;
                const hwSuffix = this.settings.showHardwareModeInStatus
                    ? ` · ${hardwareModeLabel(this._hwMode)}`
                    : '';
                this._setStatus(`📖 Vault Wiki: ${termCount} terms${hwSuffix}`);
                this.logger.info('Plugin', `Index ready — ${termCount} terms`, { hwMode: this._hwMode });
                if (termCount > 0) new Notice(`Vault Wiki: Ready — ${termCount} terms indexed`, 4000);
            });

            // ── Commands & UI ──────────────────────────────────────────────────────
            this.addRibbonIcon('book-open', 'Vault Wiki: Generate Notes', () => {
                this.generateWikiNotes();
            });

            this.addCommand({
                id: 'generate-wiki-notes',
                name: 'Generate missing wiki notes',
                callback: () => this.generateWikiNotes(),
            });

            this.addCommand({
                id: 'refresh-term-cache',
                name: 'Refresh term cache',
                callback: async () => {
                    await this.termCache.buildIndex();
                    new Notice('Vault Wiki: Term cache refreshed!');
                    this.logger.info('Plugin', 'Term cache manually rebuilt via command');
                },
            });

            // ⚡ BOLT: Pause / Resume / Cancel
            this.addCommand({
                id: 'pause-generation',
                name: 'Pause wiki generation',
                callback: () => {
                    this.generator.pause();
                    new Notice('Vault Wiki: Generation PAUSED. Use \'Resume\' to continue.');
                    this.logger.info('Plugin', 'Generation paused by user');
                },
            });

            this.addCommand({
                id: 'resume-generation',
                name: 'Resume wiki generation',
                callback: () => {
                    this.generator.resume();
                    new Notice('Vault Wiki: Generation RESUMED.');
                    this.logger.info('Plugin', 'Generation resumed by user');
                },
            });

            this.addCommand({
                id: 'cancel-generation',
                name: 'Cancel wiki generation',
                callback: () => {
                    this.generator.cancel();
                    new Notice('Vault Wiki: Generation CANCELLED.');
                    this.logger.info('Plugin', 'Generation cancelled by user');
                },
            });

            this.addCommand({
                id: 'open-latest-log',
                name: 'Open latest log file',
                callback: () => this.openLatestLog(),
            });

            this.addCommand({
                id: 'flush-log',
                name: 'Flush log to vault now',
                callback: async () => {
                    await this.logger._flush();
                    new Notice('Vault Wiki: Log flushed!');
                },
            });

            this.addSettingTab(new WikiVaultSettingTab(this.app, this));

            // ── Auto-run on startup ────────────────────────────────────────────────
            if (this.settings.runOnStartup) {
                this.app.workspace.onLayoutReady(() => {
                    this.logger.info('Plugin', 'runOnStartup triggered');
                    this.generateWikiNotes();
                });
            }

            // ⚡ BOLT: Debounced file-switch generation (5 s cooldown)
            const debouncedGenerate = debounce(() => {
                this.generateWikiNotes();
            }, 5000);

            this.registerEvent(
                this.app.workspace.on('file-open', (file) => {
                    if (this.settings.runOnFileSwitch && file) {
                        this.logger.debug('Plugin', `runOnFileSwitch: debounced trigger by ${file.path}`);
                        debouncedGenerate();
                    }
                }),
            );

            // ── Cache refresh on vault modify (debounced) ──────────────────────────
            const debouncedRefresh = debounce(() => {
                this.termCache.refresh();
            }, 2000);

            this.registerEvent(
                this.app.vault.on('modify', (file) => {
                    if (file instanceof TFile) debouncedRefresh();
                }),
            );

            this.logger.markSessionStart();
            this.logger.info('Plugin', 'Vault Wiki loaded successfully');
            console.log('Vault Wiki: Loaded successfully!');
        } catch (err: unknown) {
            // 🛡️ SENTINEL: Graceful startup failure
            const e = err as { message?: string };
            console.error('Vault Wiki: Fatal startup error', err);
            new Notice(
                `Vault Wiki failed to load: ${e?.message ?? String(err)}. `
                + 'Check the developer console for details.',
                10_000,
            );
        }
    }

    async generateWikiNotes(): Promise<void> {
        this.logger.info('Plugin', 'generateWikiNotes invoked');
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
        const hwSuffix = this.settings.showHardwareModeInStatus ? ` · ${hardwareModeLabel(hwMode)}` : '';
        this._setStatus(`📖 Vault Wiki: ${termCount} terms${hwSuffix}`);
    }

    /** Test the configured AI connection and surface the result as a Notice. */
    async testAIConnection(): Promise<{ success: boolean; message: string; model?: string; latencyMs?: number }> {
        new Notice('Vault Wiki: Testing AI connection…', 3000);
        const result = await this.generator.testAIConnection();
        new Notice(`Vault Wiki: ${result.message}`, result.success ? 6000 : 10000);
        this.logger.info('Plugin', 'AI connection test', result);
        return result;
    }

    /** v3.5.0: Auto-probe Mistral models smallest-first, apply the first working one. */
    async findWorkingMistralModel(): Promise<{ success: boolean; model: string | null; message: string }> {
        new Notice('Vault Wiki: Scanning Mistral models (smallest first)…', 3000);
        const result = await this.generator.findWorkingMistralModel();
        if (result.success && result.model) {
            this.settings.modelName = result.model;
            await this.saveSettings();
        }
        new Notice(`Vault Wiki: ${result.message}`, result.success ? 8000 : 10000);
        this.logger.info('Plugin', 'findWorkingMistralModel', result);
        return result;
    }

    /** 🎨 PALETTE: Update the persistent status bar chip. */
    _setStatus(text: string): void {
        if (this.statusBarItem) this.statusBarItem.setText(text);
    }

    /** Opens the most recently modified log file in the workspace. */
    async openLatestLog(): Promise<void> {
        try {
            const logDir = this.settings.logDirectory || 'VaultWiki/Logs';
            const folder = this.app.vault.getAbstractFileByPath(logDir);
            if (!(folder instanceof TFolder) || folder.children.length === 0) {
                new Notice('Vault Wiki: No log files found yet.');
                return;
            }
            const logs = folder.children
                .filter(f => f instanceof TFile && f.name.startsWith('session-'))
                .sort((a, b) => (b as TFile).stat.mtime - (a as TFile).stat.mtime);
            if (logs.length === 0) { new Notice('Vault Wiki: No log files found yet.'); return; }
            await this.app.workspace.getLeaf(false).openFile(logs[0] as TFile);
        } catch (err) {
            this.logger.error('Plugin', 'Failed to open latest log', err);
        }
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    // ⚡ BOLT: Removed full reindex on every settings save.
    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
        if (this.logger) {
            this.logger.settings = this.settings;
            this.logger.info('Plugin', 'Settings saved and applied');
        }
        // ⚡ BOLT v3.5.2: Rebuild pre-computed lookup maps when settings change
        if (this.termCache) this.termCache._buildReverseSynonyms();
        if (this.categoryManager) this.categoryManager._buildCategoryMap();
    }

    onunload(): void {
        this.logger?.info('Plugin', 'Vault Wiki unloading');
        this.logger?.destroy();
        console.log('Vault Wiki: Unloading…');
    }
}

// Obsidian requires this default export
export default WikiVaultUnifiedPlugin;
