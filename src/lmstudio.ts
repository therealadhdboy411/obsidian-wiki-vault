// ============================================================================
// LM STUDIO NATIVE V1 CLIENT
// ============================================================================

import { requestUrl } from 'obsidian';
import type { WikiVaultSettings } from './types';
import type { WikiVaultLogger } from './logger';
import { detectHardwareMode, getHardwareModeParams } from './utils';

/**
 * Client for LM Studio's proprietary /api/v1/chat endpoint.
 * Supports:
 *   • Stateful conversations via response_id chaining (saves tokens on long sessions)
 *   • SSE streaming (text appears progressively for a better UX)
 *   • Hardware-aware parameter tuning (context length, max_tokens, gpu_layers)
 */
export class LMStudioV1Client {
    private settings: WikiVaultSettings;
    private logger: WikiVaultLogger;
    private _lastResponseId: string | null = null;

    constructor(settings: WikiVaultSettings, logger: WikiVaultLogger) {
        this.settings = settings;
        this.logger = logger;
        // Re-hydrate thread from persisted state
        this._lastResponseId = settings.lmstudioV1LastResponseId ?? null;
    }

    /** Reset the conversation thread (clears response_id). */
    resetThread(): void {
        this._lastResponseId = null;
        this.settings.lmstudioV1LastResponseId = null;
        this.logger.debug('LMStudioV1', 'Thread reset');
    }

    /**
     * Send a single chat message and return the full assistant reply as a string.
     * Falls back to standard completion if streaming is disabled.
     */
    async chat(
        userMessage: string,
        systemPrompt: string | null,
        useStateful = true,
    ): Promise<string | null> {
        const endpoint = (this.settings.lmstudioV1Endpoint || 'http://localhost:1234').replace(/\/+$/, '');
        const url = `${endpoint}/api/v1/chat`;
        const hwMode = detectHardwareMode(this.settings);
        const hwParams = getHardwareModeParams(hwMode);

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (this.settings.lmstudioV1ApiToken) {
            headers['Authorization'] = `Bearer ${this.settings.lmstudioV1ApiToken}`;
        }

        const messages: Array<{ role: string; content: string }> = [];
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
        messages.push({ role: 'user', content: userMessage });

        const stateful = useStateful && (this.settings.lmstudioV1Stateful !== false);
        const streaming = this.settings.lmstudioV1StreamingEnabled !== false;

        const body: Record<string, unknown> = {
            messages,
            model: this.settings.modelName || undefined,
            max_tokens: hwParams.maxTokens,
            temperature: hwParams.temperature,
            stream: streaming,
            context_length: hwParams.contextLength,
        };
        if (hwParams.gpuLayers >= 0) body['gpu_layers'] = hwParams.gpuLayers;
        // Thread continuation
        if (stateful && this._lastResponseId) {
            body['response_id'] = this._lastResponseId;
        }

        this.logger.debug('LMStudioV1', `POST ${url}`, {
            stateful,
            streaming,
            hwMode,
            prevResponseId: this._lastResponseId?.slice(0, 12) ?? null,
        });

        try {
            if (streaming) {
                return await this._streamChat(url, headers, body, stateful);
            } else {
                return await this._blockingChat(url, headers, body, stateful);
            }
        } catch (err) {
            this.logger.error('LMStudioV1', 'chat() failed', err);
            return null;
        }
    }

    // ── Streaming (SSE) path ───────────────────────────────────────────────────

    private async _streamChat(
        url: string,
        headers: Record<string, string>,
        body: Record<string, unknown>,
        stateful: boolean,
    ): Promise<string | null> {
        // Obsidian's requestUrl doesn't support real streaming, so we do a blocking
        // POST and process the SSE response body line-by-line.
        const resp = await requestUrl({
            url,
            method: 'POST',
            headers,
            timeout: 120_000,
            body: JSON.stringify(body),
        });

        const text = resp.text;
        const chunks: string[] = [];
        let newResponseId: string | null = null;

        for (const line of text.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data:')) continue;
            const data = trimmed.slice(5).trim();
            if (data === '[DONE]') break;
            try {
                const parsed = JSON.parse(data);
                const delta = parsed?.choices?.[0]?.delta?.content;
                if (delta) chunks.push(delta);
                // Capture response_id for stateful threading
                if (!newResponseId && parsed?.id) newResponseId = parsed.id;
            } catch {
                // Malformed SSE chunk — skip
            }
        }

        if (stateful && newResponseId) {
            this._lastResponseId = newResponseId;
            this.settings.lmstudioV1LastResponseId = newResponseId;
            this.logger.debug('LMStudioV1', `Thread updated → ${newResponseId.slice(0, 12)}…`);
        }

        return chunks.length > 0 ? chunks.join('') : null;
    }

    // ── Blocking (non-streaming) path ─────────────────────────────────────────

    private async _blockingChat(
        url: string,
        headers: Record<string, string>,
        body: Record<string, unknown>,
        stateful: boolean,
    ): Promise<string | null> {
        const resp = await requestUrl({
            url,
            method: 'POST',
            headers,
            timeout: 120_000,
            body: JSON.stringify({ ...body, stream: false }),
        });

        const data = resp.json;
        const text = data?.choices?.[0]?.message?.content ?? null;
        if (stateful && data?.id) {
            this._lastResponseId = data.id;
            this.settings.lmstudioV1LastResponseId = data.id;
        }
        return text;
    }
}
