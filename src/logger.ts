// ============================================================================
// LOGGER
// ============================================================================

import { TFile, TFolder } from 'obsidian';
import type { App } from 'obsidian';
import type { WikiVaultSettings, LogEntry, LogStats } from './types';

const LOG_BUFFER_MAX = 500;
const FLUSH_INTERVAL_MS = 10_000; // 10 s

export class WikiVaultLogger {
    app: App;
    settings: WikiVaultSettings;
    private _buffer: LogEntry[] = [];
    private _flushTimer: ReturnType<typeof setInterval> | null = null;
    private _sessionFile: string | null = null;
    private _sessionStart: number = Date.now();
    stats: LogStats = {
        generated: 0,
        skipped: 0,
        failed: 0,
        apiCalls: 0,
        apiErrors: 0,
        cacheHits: 0,
        totalMs: 0,
    };

    constructor(app: App, settings: WikiVaultSettings) {
        this.app = app;
        this.settings = settings;
        if (settings.enableLogging) {
            this._flushTimer = setInterval(() => this._flush(), FLUSH_INTERVAL_MS);
        }
    }

    // ── Public logging API ───────────────────────────────────────────────────

    debug(context: string, message: string, extra?: unknown): void {
        if (this._shouldLog('DEBUG')) this._enqueue('DEBUG', context, message, extra);
    }

    info(context: string, message: string, extra?: unknown): void {
        if (this._shouldLog('INFO')) this._enqueue('INFO', context, message, extra);
    }

    warn(context: string, message: string, extra?: unknown): void {
        if (this._shouldLog('WARN')) this._enqueue('WARN', context, message, extra);
    }

    error(context: string, message: string, extra?: unknown): void {
        if (this._shouldLog('ERROR')) this._enqueue('ERROR', context, message, extra);
    }

    /** Measure an async operation and log its duration at DEBUG level. */
    async time<T>(context: string, label: string, fn: () => Promise<T>): Promise<T> {
        const t0 = performance.now();
        try {
            const result = await fn();
            const ms = Math.round(performance.now() - t0);
            this.debug(context, `${label} took ${ms}ms`);
            return result;
        } catch (err) {
            const ms = Math.round(performance.now() - t0);
            this.error(context, `${label} failed after ${ms}ms`, err);
            throw err;
        }
    }

    /** Called once at plugin load to set the session boundary in the log. */
    markSessionStart(): void {
        const now = new Date();
        const dateStr = now.toISOString().slice(0, 10);
        const timeStr = now.toISOString().slice(11, 19).replace(/:/g, '-');
        this._sessionFile = `${this.settings.logDirectory || 'VaultWiki/Logs'}/session-${dateStr}-${timeStr}.md`;
        this._sessionStart = Date.now();
        this.info('Logger', `=== Session started ===`);
    }

    // ── Internal ─────────────────────────────────────────────────────────────

    private _levelValue(level: string): number {
        return { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 }[level] ?? 1;
    }

    private _shouldLog(level: string): boolean {
        if (!this.settings.enableLogging) return false;
        return this._levelValue(level) >= this._levelValue(this.settings.logLevel ?? 'INFO');
    }

    private _enqueue(level: LogEntry['level'], context: string, message: string, extra?: unknown): void {
        const entry: LogEntry = {
            ts: new Date().toISOString(),
            level,
            context,
            message,
            extra: extra !== undefined ? extra : null,
        };
        this._buffer.push(entry);
        // Console mirror
        const tag = `[VaultWiki:${context}]`;
        if (level === 'ERROR') console.error(tag, message, extra ?? '');
        else if (level === 'WARN') console.warn(tag, message, extra ?? '');
        else if (level === 'DEBUG') console.debug(tag, message, extra ?? '');
        else console.log(tag, message, extra ?? '');
        // Auto-flush if buffer is getting large
        if (this._buffer.length >= LOG_BUFFER_MAX) this._flush();
    }

    async _flush(): Promise<void> {
        if (this._buffer.length === 0) return;
        if (!this.settings.enableLogging) { this._buffer = []; return; }

        const lines = this._buffer.map(e => {
            const extraStr = e.extra != null
                ? '\n  ' + (typeof e.extra === 'string' ? e.extra : JSON.stringify(e.extra, null, 2)).replace(/\n/g, '\n  ')
                : '';
            return `${e.ts} [${e.level}] [${e.context}] ${e.message}${extraStr}`;
        });
        this._buffer = [];

        const targetFile = this._sessionFile
            ?? `${this.settings.logDirectory || 'VaultWiki/Logs'}/session-fallback.md`;

        try {
            // Ensure parent directory exists
            const dir = targetFile.split('/').slice(0, -1).join('/');
            if (dir) await this._ensureFolder(dir);

            const existing = this.app.vault.getAbstractFileByPath(targetFile);
            if (existing instanceof TFile) {
                const prev = await this.app.vault.read(existing);
                await this.app.vault.modify(existing, prev + '\n' + lines.join('\n'));
            } else {
                const header = [
                    '---',
                    `vault_wiki_log: true`,
                    `session_start: "${new Date(this._sessionStart).toISOString()}"`,
                    '---',
                    '',
                    '# Vault Wiki Session Log',
                    '',
                ].join('\n');
                await this.app.vault.create(targetFile, header + lines.join('\n'));
            }
        } catch (err) {
            console.error('[VaultWiki:Logger] Failed to flush log buffer', err);
        }
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

    /** Summarise stats into a log string. */
    summariseStats(): string {
        const s = this.stats;
        return (
            `Generated: ${s.generated} | Skipped: ${s.skipped} | Failed: ${s.failed} | ` +
            `API calls: ${s.apiCalls} | API errors: ${s.apiErrors} | ` +
            `Cache hits: ${s.cacheHits} | Total time: ${Math.round(s.totalMs / 1000)}s`
        );
    }

    /** Stop the periodic flush timer (call from onunload). */
    destroy(): void {
        if (this._flushTimer !== null) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
    }
}
