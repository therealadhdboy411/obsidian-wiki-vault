// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

import { requestUrl } from 'obsidian';
import { IRREGULAR_PLURALS } from './constants';
import type { WikiVaultSettings, AutoConfig } from './types';

// ── String / morphology ──────────────────────────────────────────────────────

export function getSingularForm(word: string): string {
    if (!word) return word;
    const lower = word.toLowerCase();
    for (const [singular, plural] of Object.entries(IRREGULAR_PLURALS)) {
        if (lower === plural) {
            return word[0] === word[0].toUpperCase()
                ? singular[0].toUpperCase() + singular.slice(1)
                : singular;
        }
    }
    if (lower.endsWith('ies') && lower.length > 4) return word.slice(0, -3) + 'y';
    if (lower.endsWith('ses') || lower.endsWith('xes') || lower.endsWith('zes') || lower.endsWith('ches') || lower.endsWith('shes')) return word.slice(0, -2);
    if (lower.endsWith('s') && !lower.endsWith('ss') && lower.length > 3) return word.slice(0, -1);
    return word;
}

export function getPluralForm(word: string): string {
    if (!word) return word;
    const lower = word.toLowerCase();
    if (IRREGULAR_PLURALS[lower]) {
        const plural = IRREGULAR_PLURALS[lower];
        return word[0] === word[0].toUpperCase()
            ? plural[0].toUpperCase() + plural.slice(1)
            : plural;
    }
    if (lower.endsWith('y') && !/[aeiou]y$/i.test(lower)) return word.slice(0, -1) + 'ies';
    if (/(?:s|x|z|ch|sh)$/i.test(lower)) return word + 'es';
    return word + 's';
}

export function toTitleCase(str: string): string {
    return str.replace(/\w\S*/g, txt => txt[0].toUpperCase() + txt.slice(1).toLowerCase());
}

/** Escape a string for use in a RegExp. */
export function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Sanitize a term for use as a filename / vault path segment.
 * 🛡️ SENTINEL: Rejects path traversal sequences, colons, and other
 *              dangerous characters that could escape the wiki directory.
 */
export function sanitizeTermForPath(term: string): string {
    // Collapse internal whitespace
    let safe = term.trim().replace(/\s+/g, ' ');
    // Strip characters illegal on Windows / macOS / Linux filesystems
    safe = safe.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-');
    // 🛡️ SENTINEL: reject path traversal sequences
    safe = safe.replace(/\.{2,}/g, '-');
    // Collapse resulting runs of dashes
    safe = safe.replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'Untitled';
}

/**
 * Returns true if the term is appropriate to look up in dictionary/Wikipedia.
 * Filters out very short terms, numbers, codes, and markdown artefacts.
 */
export function isLookupableTerm(term: string): boolean {
    if (!term || term.length < 3) return false;
    // Skip pure numbers / codes
    if (/^\d+$/.test(term)) return false;
    // Skip if looks like a file extension or markdown artefact
    if (/^[#*\-_!`[\](){}]/.test(term)) return false;
    // Skip single-letter tokens after splitting (normally caught by minWordLength)
    if (/^[a-zA-Z]$/.test(term)) return false;
    return true;
}

// ── Markup / token helpers ───────────────────────────────────────────────────

/**
 * ⚡ BOLT v0.9.0: Strip Markdown and Obsidian-specific markup before sending
 * to AI to save tokens. Removes wikilinks, code blocks, images, emphasis, etc.
 * Deduplicates empty lines, then hard-caps at `maxChars` characters.
 *
 * BEFORE: Raw markdown sent to AI — ~15–30% of tokens were formatting noise.
 * AFTER:  Plain prose only — up to 600 extra context chars fit in the same budget.
 */
export function stripMarkupForAI(text: string, maxChars: number): string {
    if (!text) return '';
    let s = text;
    // Remove fenced code blocks (content unlikely to be useful prose)
    s = s.replace(/```[\s\S]*?```/g, '');
    // Remove inline code
    s = s.replace(/`[^`]+`/g, '');
    // Remove images ![alt](url)
    s = s.replace(/!\[.*?\]\(.*?\)/g, '');
    // Unwrap wikilinks [[Target|Alias]] → Alias or Target
    s = s.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2');
    s = s.replace(/\[\[([^\]]+)\]\]/g, '$1');
    // Unwrap markdown links [text](url) → text
    s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
    // Remove frontmatter
    s = s.replace(/^---[\s\S]*?---\n?/, '');
    // Remove HTML tags
    s = s.replace(/<[^>]+>/g, '');
    // Remove emphasis/bold/italic markers
    s = s.replace(/\*{1,3}([^*]+)\*{1,3}/g, '$1');
    s = s.replace(/_{1,3}([^_]+)_{1,3}/g, '$1');
    // Remove heading markers
    s = s.replace(/^#{1,6}\s+/gm, '');
    // Remove horizontal rules
    s = s.replace(/^[-*_]{3,}\s*$/gm, '');
    // Remove blockquote markers
    s = s.replace(/^>\s?/gm, '');
    // Collapse excessive blank lines
    s = s.replace(/\n{3,}/g, '\n\n');
    // Hard cap
    if (s.length > maxChars) s = s.slice(0, maxChars);
    return s.trim();
}

// ── UI & async helpers ───────────────────────────────────────────────────────

/** Creates a debounced function that delays invoking `fn` until after `wait` ms. */
export function debounce<T extends (...args: unknown[]) => unknown>(fn: T, wait: number): (...args: Parameters<T>) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: Parameters<T>) => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, wait);
    };
}

/**
 * ⚡ BOLT: Yield to the UI event loop so Obsidian can repaint between
 * heavy synchronous loops. Call with `await yieldToUI()` inside loops.
 */
export function yieldToUI(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
}

/** Format milliseconds into HH:MM:SS (or MM:SS for < 1h). */
export function formatETA(ms: number): string {
    if (!isFinite(ms) || ms < 0) return '--:--';
    const totalSec = Math.round(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** Build a fixed-width progress bar string. */
export function formatProgressBar(done: number, total: number, width = 20): string {
    if (total <= 0) return `[${'░'.repeat(width)}]`;
    const filled = Math.round(width * Math.min(done / total, 1));
    return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}

// ── Security / validation ────────────────────────────────────────────────────

/**
 * 🛡️ SENTINEL: Validates that an endpoint URL is safe to contact.
 * Blocks private / loopback IPs (SSRF), file:// URIs, and other
 * dangerous schemes. Returns an error string or null if safe.
 */
export function validateEndpointUrl(url: string): string | null {
    if (!url) return 'Endpoint URL is empty.';
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return `Invalid URL: "${url}"`;
    }
    // Only allow HTTP and HTTPS
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return `Unsafe protocol "${parsed.protocol}". Only http:// and https:// are allowed.`;
    }
    const host = parsed.hostname.toLowerCase();
    // Block obvious SSRF targets
    const SSRF_BLOCKED = [
        /^169\.254\./, // Link-local (AWS metadata)
        /^10\./, // RFC 1918
        /^172\.(1[6-9]|2[0-9]|3[01])\./, // RFC 1918
        /^192\.168\./, // RFC 1918
        /^0\.0\.0\.0$/, // Unspecified
        /^::1$/, // IPv6 loopback
        /^fc00:/i, /^fd/i, // IPv6 ULA
        /^fe80:/i, // IPv6 link-local
        /\.internal$/i, /\.local$/i, // mDNS / internal hostnames
        /^metadata\.google\.internal$/i, // GCP metadata
    ];
    // NOTE: localhost / 127.x are intentionally NOT blocked — needed for LM Studio / Ollama.
    for (const pattern of SSRF_BLOCKED) {
        if (pattern.test(host)) {
            return `Blocked host "${host}" — potential SSRF risk.`;
        }
    }
    return null; // safe
}

/**
 * 🛡️ SENTINEL: Quick protocol-only check before a full URL parse.
 * Returns an error string or null if the protocol is acceptable.
 */
export function validateEndpointProtocol(url: string): string | null {
    if (!url) return null; // empty — let validateEndpointUrl() handle it
    const lower = url.toLowerCase();
    if (lower.startsWith('http://') || lower.startsWith('https://')) return null;
    const proto = lower.split(':')[0];
    return `Blocked protocol "${proto}" — only http:// and https:// are allowed.`;
}

/**
 * 🛡️ SENTINEL: Verify a resolved absolute path is inside the expected
 * wiki directory before writing. Throws if the path looks unsafe.
 */
export function assertSafeWritePath(
    resolvedPath: string,
    wikiRoot: string,
): void {
    // Normalise to forward slashes for comparison
    const norm = resolvedPath.replace(/\\/g, '/');
    const root = wikiRoot.replace(/\\/g, '/');
    if (!norm.startsWith(root)) {
        throw new Error(
            `🛡️ SENTINEL: Write blocked — path "${resolvedPath}" is outside wiki root "${wikiRoot}".`,
        );
    }
    // Extra defence: reject traversal sequences that survived normalisation
    if (norm.includes('../') || norm.includes('..\\')) {
        throw new Error(
            `🛡️ SENTINEL: Write blocked — path traversal detected in "${resolvedPath}".`,
        );
    }
}

/** Mask an API key for safe display in logs. */
export function maskApiKey(key: string | undefined | null): string {
    if (!key || key.length < 8) return '(none)';
    return key.slice(0, 4) + '••••' + key.slice(-4);
}

// ── Hardware detection ───────────────────────────────────────────────────────

export type HardwareMode = 'gpu' | 'cpu' | 'android' | 'ios';

/**
 * Detect the runtime hardware class for optimising LM Studio parameters.
 * Falls back to 'cpu' if detection is unavailable.
 */
export function detectHardwareMode(settings: WikiVaultSettings): HardwareMode {
    // Allow manual override
    if (settings.hardwareMode && settings.hardwareMode !== 'auto') {
        return settings.hardwareMode as HardwareMode;
    }
    const ua = (typeof navigator !== 'undefined' ? navigator.userAgent : '') || '';
    // Mobile detection first (mobile GPUs behave more like CPU-class for LLMs)
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
    // Heuristic: more than 8 logical cores suggests a desktop likely with dGPU
    const cores = (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : 0) || 4;
    return cores > 8 ? 'gpu' : 'cpu';
}

export interface HardwareModeParams {
    contextLength: number;
    maxTokens: number;
    temperature: number;
    gpuLayers: number;
}

/** Return LM Studio native-v1 tuning params for a given hardware mode. */
export function getHardwareModeParams(mode: HardwareMode): HardwareModeParams {
    switch (mode) {
        case 'gpu':
            return { contextLength: 32768, maxTokens: 2048, temperature: 0.3, gpuLayers: -1 };
        case 'ios':
        case 'android':
            return { contextLength: 2048, maxTokens: 512, temperature: 0.4, gpuLayers: 0 };
        case 'cpu':
        default:
            return { contextLength: 8192, maxTokens: 1024, temperature: 0.35, gpuLayers: 0 };
    }
}

/** Human-readable label for a hardware mode. */
export function hardwareModeLabel(mode: HardwareMode | string): string {
    switch (mode) {
        case 'gpu': return '🖥️ GPU';
        case 'android': return '📱 Android';
        case 'ios': return '🍎 iOS';
        case 'cpu': default: return '💻 CPU';
    }
}

/** Default model name tuned for a hardware class. */
export function getDefaultModelForHardware(mode: HardwareMode | string): string {
    switch (mode) {
        case 'gpu': return 'qwen2.5-14b-instruct';
        case 'ios':
        case 'android': return 'tinyllama-1.1b-chat-v1.0';
        case 'cpu': default: return 'qwen2.5-7b-instruct';
    }
}

/**
 * Build the "Auto" configuration for a given hardware+provider combination.
 * Returns sane defaults the plugin will use when settingsMode === 'auto'.
 */
export function getAutoConfig(hw: HardwareMode | string, provider: string): AutoConfig {
    const isLocal = provider === 'lmstudio-v1' || provider === 'lmstudio-openai' || provider === 'ollama';
    if (isLocal) {
        switch (hw) {
            case 'gpu':
                return { batchSize: 5, aiContextMaxChars: 30_000, contextDepth: 'full', promptPreset: 'detailed' };
            case 'ios':
            case 'android':
                return { batchSize: 1, aiContextMaxChars: 4_000, contextDepth: 'performance', promptPreset: 'small' };
            case 'cpu': default:
                return { batchSize: 2, aiContextMaxChars: 10_000, contextDepth: 'partial', promptPreset: 'balanced' };
        }
    }
    // Cloud providers — generous limits
    return { batchSize: 10, aiContextMaxChars: 40_000, contextDepth: 'full', promptPreset: 'detailed' };
}

/**
 * Detect which PROMPT_PRESETS key matches the current system+user prompts.
 * Returns the key ('small' | 'balanced' | 'detailed') or 'custom'.
 */
export function detectPromptPreset(system: string, user: string): string {
    // Import PROMPT_PRESETS lazily to avoid circular import (constants → utils loop)
    const { PROMPT_PRESETS } = require('./constants') as typeof import('./constants');
    for (const [key, preset] of Object.entries(PROMPT_PRESETS)) {
        if (preset.system === system && preset.user === user) return key;
    }
    return 'custom';
}

// ── Misc ─────────────────────────────────────────────────────────────────────

/** Simple HEAD request to check if a URL is reachable (for validate-before-fetch). */
export async function isUrlReachable(url: string): Promise<boolean> {
    try {
        const resp = await requestUrl({ url, method: 'HEAD', timeout: 5000 });
        return resp.status < 400;
    } catch {
        return false;
    }
}
