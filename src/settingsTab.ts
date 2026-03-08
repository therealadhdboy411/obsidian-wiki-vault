// ============================================================================
// SETTINGS TAB
// ============================================================================

import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { WikiVaultUnifiedPlugin } from './main';
import { PROVIDERS, PROVIDER_MAP, PROMPT_PRESETS } from './constants';
import {
    detectHardwareMode, hardwareModeLabel, getDefaultModelForHardware,
    getAutoConfig, detectPromptPreset,
} from './utils';

export class WikiVaultSettingTab extends PluginSettingTab {
    plugin: WikiVaultUnifiedPlugin;

    constructor(app: App, plugin: WikiVaultUnifiedPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        // ── Section helper ──────────────────────────────────────────────────────
        const makeSection = (parent: HTMLElement, emoji: string, title: string, openByDefault = false) => {
            const details = parent.createEl('details');
            if (openByDefault) details.setAttribute('open', '');
            Object.assign(details.style, {
                margin: '4px 0',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '8px',
                overflow: 'hidden',
            });
            const summary = details.createEl('summary');
            Object.assign(summary.style, {
                cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center',
                gap: '0.5em', padding: '0.6em 1em', background: 'var(--background-secondary)',
                fontWeight: '600', fontSize: '0.95em', userSelect: 'none', borderRadius: '8px',
            });
            summary.setAttribute('aria-label', `${title} settings section`);
            const emojiEl = summary.createEl('span', { text: emoji });
            emojiEl.setAttribute('aria-hidden', 'true');
            summary.createEl('span', { text: title });
            const chevron = summary.createEl('span', { text: '›' });
            Object.assign(chevron.style, {
                marginLeft: 'auto', fontSize: '1.1em', opacity: '0.4',
                transition: 'transform 0.18s',
                transform: openByDefault ? 'rotate(90deg)' : 'rotate(0deg)',
            });
            details.addEventListener('toggle', () => {
                chevron.style.transform = details.open ? 'rotate(90deg)' : 'rotate(0deg)';
            });
            const body = details.createDiv();
            Object.assign(body.style, { padding: '0.1em 0.5em 0.7em' });
            return body;
        };

        // ── Header ──────────────────────────────────────────────────────────────
        const headerWrap = containerEl.createDiv();
        Object.assign(headerWrap.style, { marginBottom: '1em' });
        const titleRow = headerWrap.createDiv();
        Object.assign(titleRow.style, { display: 'flex', alignItems: 'center', gap: '0.6em', flexWrap: 'wrap', marginBottom: '0.3em' });
        const h1 = titleRow.createEl('h1', { text: 'Vault Wiki' });
        Object.assign(h1.style, { margin: '0', fontSize: '1.5em' });
        const badge = titleRow.createEl('span', { text: 'v0.9.0 · Early Beta' });
        Object.assign(badge.style, {
            fontSize: '0.68em', fontWeight: '700', letterSpacing: '0.04em',
            padding: '0.15em 0.55em', borderRadius: '999px',
            background: 'var(--color-orange, #f97316)', color: '#fff', verticalAlign: 'middle',
        });
        headerWrap.createEl('p', { text: 'AI-powered wiki generation for Obsidian · by adhdboy411 & Claude', cls: 'setting-item-description' })
            .style.cssText = 'margin: 0 0 0.6em; font-size: 0.82em;';

        const betaWarn = headerWrap.createEl('div');
        betaWarn.style.cssText = 'background: rgba(249,115,22,0.09); border-left: 3px solid var(--color-orange, #f97316); border-radius: 4px; padding: 0.5em 0.85em; margin-bottom: 0.6em; font-size: 0.81em; color: var(--text-muted);';
        betaWarn.innerHTML = '⚠️ <strong>Early Beta</strong> — functional but not fully hardened. Back up your vault before first run.';

        const whatsNew = headerWrap.createEl('div');
        whatsNew.style.cssText = 'background: var(--background-modifier-hover, rgba(120,80,255,0.07)); border-left: 3px solid var(--interactive-accent, #7c3aed); border-radius: 4px; padding: 0.5em 0.85em; margin-bottom: 0.6em; font-size: 0.8em; color: var(--text-muted);';
        whatsNew.innerHTML = '<strong>✨ v0.9.0</strong> &nbsp;⚡ <b>stripMarkupForAI()</b> — ~15–30% fewer tokens&nbsp;|&nbsp;📂 <b>AI Subcategories</b>&nbsp;|&nbsp;🗣️ <b>Prompt presets</b>';

        // Live status
        const termCount = this.plugin.termCache?.termIndex?.size ?? 0;
        const gen = this.plugin.generator;
        const statusBar = headerWrap.createEl('div');
        statusBar.style.cssText = 'display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap; background: var(--background-secondary); border-radius: 6px; padding: 0.4em 0.8em; font-size: 0.82em;';
        statusBar.setAttribute('role', 'status'); statusBar.setAttribute('aria-live', 'polite');
        const idxChip = statusBar.createEl('span');
        idxChip.innerHTML = termCount > 0 ? `✅ <strong>${termCount}</strong> terms indexed` : '⏳ Index building…';
        const sep = statusBar.createEl('span', { text: '·' }); sep.style.cssText = 'opacity: 0.3;';
        const genChip = statusBar.createEl('span');
        genChip.textContent = gen?.isPaused ? '⏸ Paused' : '▶ Ready';

        // ── Mode selector ───────────────────────────────────────────────────────
        const mode = this.plugin.settings.settingsMode || 'auto';
        const modeSelectorWrap = containerEl.createDiv();
        modeSelectorWrap.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin: 0.6em 0 1em;';
        modeSelectorWrap.createEl('span', { text: 'Mode:' }).style.cssText = 'font-size: 0.82em; font-weight: 600; color: var(--text-muted);';
        const modeGroup = modeSelectorWrap.createEl('div');
        modeGroup.style.cssText = 'display: flex; border: 1px solid var(--background-modifier-border); border-radius: 6px; overflow: hidden;';
        modeGroup.setAttribute('role', 'group'); modeGroup.setAttribute('aria-label', 'Settings complexity mode');
        const modeButtons: [string, string, string][] = [
            ['auto', '⚡ Auto', 'Smart defaults — auto-configured from hardware and model'],
            ['manual', '⚙️ Manual', 'All main settings visible and editable'],
            ['advanced', '🔬 Advanced', 'Everything, including performance tuning and diagnostics'],
        ];
        modeButtons.forEach(([val, label, tip]) => {
            const btn = modeGroup.createEl('button', { text: label });
            const active = val === mode;
            btn.style.cssText = [
                'padding: 0.3em 0.8em; font-size: 0.82em; cursor: pointer; border: none;',
                'border-right: 1px solid var(--background-modifier-border);',
                active ? 'background: var(--interactive-accent); color: var(--text-on-accent); font-weight: 600;'
                    : 'background: var(--background-primary); color: var(--text-normal);',
            ].join(' ');
            btn.title = tip;
            btn.setAttribute('aria-pressed', String(active));
            btn.addEventListener('click', async () => {
                this.plugin.settings.settingsMode = val as 'auto' | 'manual' | 'advanced';
                await this.plugin.saveSettings();
                this.display();
            });
        });
        const modeDesc = modeSelectorWrap.createEl('span');
        const modeDescs: Record<string, string> = { auto: '— auto-configured from hardware + model', manual: '— all main settings editable', advanced: '— full control + diagnostics' };
        modeDesc.textContent = modeDescs[mode] || '';
        modeDesc.style.cssText = 'font-size: 0.78em; color: var(--text-muted);';

        // Auto mode config card
        if (mode === 'auto') {
            const hw = detectHardwareMode(this.plugin.settings);
            const ac = getAutoConfig(hw, this.plugin.settings.provider);
            const hwLabel = hardwareModeLabel(hw);
            const presetLabel = { small: '🟢 Small', balanced: '🟡 Balanced', detailed: '🔵 Detailed' }[ac.promptPreset] || ac.promptPreset;
            const depthLabel = { partial: 'Partial (wikilinks)', full: 'Full (+ virtual)', performance: 'Performance (line only)' }[ac.contextDepth] || ac.contextDepth;
            const autoCard = containerEl.createEl('div');
            autoCard.style.cssText = 'background: var(--background-secondary); border-radius: 8px; padding: 0.75em 1em; margin-bottom: 0.75em; font-size: 0.82em; border: 1px solid var(--background-modifier-border);';
            autoCard.innerHTML = [
                `<div style="font-weight:700; margin-bottom:0.4em;">⚡ Auto Configuration</div>`,
                `<div style="display:grid; grid-template-columns:1fr 1fr; gap:0.3em 1em;">`,
                `<span style="color:var(--text-muted)">Hardware</span><span>${hwLabel}</span>`,
                `<span style="color:var(--text-muted)">Batch size</span><span>${ac.batchSize} notes/batch</span>`,
                `<span style="color:var(--text-muted)">AI context cap</span><span>${(ac.aiContextMaxChars / 1000).toFixed(0)}k chars</span>`,
                `<span style="color:var(--text-muted)">Context depth</span><span>${depthLabel}</span>`,
                `<span style="color:var(--text-muted)">Prompt preset</span><span>${presetLabel}</span>`,
                `</div>`,
                `<div style="margin-top:0.5em;color:var(--text-muted);font-size:0.9em;">Switch to <strong>Manual</strong> or <strong>Advanced</strong> to override.</div>`,
            ].join('');
        }

        // ── Quick Actions ───────────────────────────────────────────────────────
        containerEl.createEl('h2', { text: 'Quick Actions' }).style.cssText =
            'margin: 0.8em 0 0.4em; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.1em; color: var(--text-muted);';
        const actionRow = containerEl.createDiv();
        actionRow.style.cssText = 'display: flex; gap: 0.5em; flex-wrap: wrap; margin-bottom: 0.4em;';

        const genBtn = actionRow.createEl('button', { text: '▶ Generate Now' });
        genBtn.style.cssText = 'padding: 0.4em 1em; border-radius: 6px; cursor: pointer; font-weight: 600; background: var(--interactive-accent); color: var(--text-on-accent); border: none; font-size: 0.88em;';
        genBtn.setAttribute('aria-label', 'Start wiki note generation');
        genBtn.addEventListener('click', () => this.plugin.generateWikiNotes());

        const reindexBtn = actionRow.createEl('button', { text: '🔄 Reindex' });
        reindexBtn.style.cssText = 'padding: 0.4em 0.8em; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); font-size: 0.88em; background: var(--background-primary);';
        reindexBtn.setAttribute('aria-label', 'Rebuild term index');
        reindexBtn.addEventListener('click', async () => {
            reindexBtn.textContent = 'Indexing…'; reindexBtn.disabled = true;
            try {
                await this.plugin.termCache.buildIndex();
                const cnt = this.plugin.termCache.termIndex.size;
                this.plugin._setStatus(`📖 Vault Wiki: ${cnt} terms`);
                new Notice(`Reindex complete — ${cnt} terms.`);
                this.display();
            } finally { reindexBtn.textContent = '🔄 Reindex'; reindexBtn.disabled = false; }
        });

        const genStatusEl = containerEl.createEl('p');
        genStatusEl.style.cssText = 'font-size: 0.8em; color: var(--text-muted); margin: 0.2em 0;';
        const updateGenStatus = () => {
            if (!gen) { genStatusEl.setText('⏳ Generator not ready'); return; }
            genStatusEl.setText(gen.isPaused ? '⏸ Generation is PAUSED' : '▶ Generator idle');
        };
        updateGenStatus();

        const ctrlRow = containerEl.createDiv();
        ctrlRow.style.cssText = 'display: flex; gap: 0.4em; flex-wrap: wrap; margin-bottom: 1em;';
        const makeCtrlBtn = (text: string, ariaLabel: string, onClick: () => void, danger = false) => {
            const b = ctrlRow.createEl('button', { text });
            b.style.cssText = `padding: 0.25em 0.7em; border-radius: 5px; cursor: pointer; font-size: 0.8em; border: 1px solid var(--background-modifier-border); background: var(--background-primary); ${danger ? 'color: var(--color-red, #dc2626);' : ''}`;
            b.setAttribute('aria-label', ariaLabel);
            b.addEventListener('click', onClick);
            return b;
        };
        makeCtrlBtn('⏸ Pause', 'Pause generation', () => { this.plugin.generator?.pause(); new Notice('Generation paused.'); updateGenStatus(); });
        makeCtrlBtn('▶ Resume', 'Resume generation', () => { this.plugin.generator?.resume(); new Notice('Generation resumed.'); updateGenStatus(); });
        makeCtrlBtn('⏹ Cancel', 'Cancel generation', () => { this.plugin.generator?.cancel(); new Notice('Generation cancelled.'); updateGenStatus(); }, true);

        new Setting(containerEl)
            .setName('Auto-Update Existing Notes')
            .setDesc('Re-generate notes whose source files changed since last run.')
            .addToggle(t => t.setValue(this.plugin.settings.autoUpdateExistingNotes ?? true)
                .onChange(async v => { this.plugin.settings.autoUpdateExistingNotes = v; await this.plugin.saveSettings(); }));

        // ── AI Provider ─────────────────────────────────────────────────────────
        const aiSec = makeSection(containerEl, '🤖', 'AI Provider', true);

        new Setting(aiSec).setName('Provider')
            .setDesc('Which AI service to use.')
            .addDropdown(dd => {
                for (const p of PROVIDERS) dd.addOption(p.id, `${p.emoji} ${p.label}`);
                dd.setValue(this.plugin.settings.provider)
                    .onChange(async value => {
                        this.plugin.settings.provider = value;
                        const pCfg = PROVIDER_MAP.get(value);
                        if (pCfg) {
                            const curEndpoint = this.plugin.settings.openaiEndpoint || '';
                            const defaultEndpoints = PROVIDERS.map(p => p.defaultEndpoint).filter(Boolean);
                            const isDefaultEndpoint = defaultEndpoints.includes(curEndpoint) || curEndpoint === '';
                            if (isDefaultEndpoint && pCfg.defaultEndpoint && value !== 'lmstudio-v1') {
                                this.plugin.settings.openaiEndpoint = pCfg.defaultEndpoint!;
                            }
                            if (pCfg.defaultModel) {
                                this.plugin.settings.modelName = pCfg.defaultModel;
                            } else if (value === 'lmstudio-openai' || value === 'lmstudio-v1') {
                                this.plugin.settings.modelName = getDefaultModelForHardware(detectHardwareMode(this.plugin.settings));
                            }
                            if (value === 'lmstudio-v1' && pCfg.defaultEndpoint) {
                                this.plugin.settings.lmstudioV1Endpoint = pCfg.defaultEndpoint!;
                            }
                        }
                        await this.plugin.saveSettings();
                        this.display();
                    });
                return dd;
            });

        const provider = this.plugin.settings.provider;
        const isV1 = provider === 'lmstudio-v1';
        const isLMStudio = isV1 || provider === 'lmstudio-openai';

        if (isV1) {
            const hwMode = detectHardwareMode(this.plugin.settings);
            const hwLabel = hardwareModeLabel(hwMode);
            const v1InfoEl = aiSec.createEl('div');
            v1InfoEl.style.cssText = 'background: rgba(34,197,94,0.09); border: 1px solid rgba(34,197,94,0.3); border-radius: 6px; padding: 0.6em 0.9em; margin: 0.5em 0; font-size: 0.81em;';
            v1InfoEl.innerHTML = `✅ <strong>LM Studio Native v1</strong> — stateful, SSE streaming.<br>Hardware: <strong>${hwLabel}</strong> · Model: <code>${getDefaultModelForHardware(hwMode)}</code>`;

            new Setting(aiSec).setName('LM Studio Endpoint').setDesc('Base URL (no trailing /api/v1).')
                .addText(t => { t.inputEl.placeholder = 'http://localhost:1234'; t.setValue(this.plugin.settings.lmstudioV1Endpoint || 'http://localhost:1234').onChange(async v => { this.plugin.settings.lmstudioV1Endpoint = v.trim().replace(/\/+$/, ''); await this.plugin.saveSettings(); }); });
            new Setting(aiSec).setName('API Token').setDesc('Optional Bearer token.')
                .addText(t => { t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.setValue(this.plugin.settings.lmstudioV1ApiToken || '').onChange(async v => { this.plugin.settings.lmstudioV1ApiToken = v; await this.plugin.saveSettings(); }); });
            new Setting(aiSec).setName('Stateful Conversations').setDesc('Reuse response_id to save tokens.')
                .addToggle(t => t.setValue(this.plugin.settings.lmstudioV1Stateful !== false).onChange(async v => { this.plugin.settings.lmstudioV1Stateful = v; this.plugin.settings.lmstudioV1LastResponseId = null; await this.plugin.saveSettings(); }));
            new Setting(aiSec).setName('SSE Streaming')
                .addToggle(t => t.setValue(this.plugin.settings.lmstudioV1StreamingEnabled !== false).onChange(async v => { this.plugin.settings.lmstudioV1StreamingEnabled = v; await this.plugin.saveSettings(); }));
            new Setting(aiSec).setName('Reset Thread').setDesc('Clear stored response_id.')
                .addButton(btn => btn.setButtonText('↺ Reset Thread').onClick(async () => { this.plugin.settings.lmstudioV1LastResponseId = null; this.plugin.generator?._lmstudioV1?.resetThread(); await this.plugin.saveSettings(); new Notice('Thread reset.', 3000); }));
        }

        if (isLMStudio) {
            const hwSec = makeSection(aiSec, '⚙️', 'Hardware Optimization', false);
            const autoMode = detectHardwareMode({ ...this.plugin.settings, hardwareMode: 'auto' });
            new Setting(hwSec).setName('Hardware Mode')
                .setDesc('Tunes context length and batch parameters.')
                .addDropdown(dd => dd
                    .addOption('auto', `Auto-detect (currently: ${hardwareModeLabel(autoMode)})`)
                    .addOption('cpu', '💻 CPU / Integrated GPU')
                    .addOption('gpu', '🖥️ Discrete GPU')
                    .addOption('android', '📱 Android')
                    .addOption('ios', '🍎 iPhone / iPad')
                    .setValue(this.plugin.settings.hardwareMode || 'auto')
                    .onChange(async v => { this.plugin.settings.hardwareMode = v as 'auto' | 'cpu' | 'gpu' | 'android' | 'ios'; await this.plugin.saveSettings(); }));
            new Setting(hwSec).setName('Show in Status Bar')
                .addToggle(t => t.setValue(this.plugin.settings.showHardwareModeInStatus !== false).onChange(async v => { this.plugin.settings.showHardwareModeInStatus = v; await this.plugin.saveSettings(); }));
        }

        if (provider === 'anthropic') {
            const infoEl = aiSec.createEl('div');
            infoEl.style.cssText = 'background: rgba(234,88,12,0.08); border: 1px solid rgba(234,88,12,0.3); border-radius: 6px; padding: 0.6em 0.9em; margin: 0.5em 0; font-size: 0.81em;';
            infoEl.innerHTML = `🔶 <strong>Anthropic Claude</strong> — native Messages API. Keys start with <code>sk-ant-…</code>`;
            new Setting(aiSec).setName('Anthropic API Key')
                .setDesc('Stored locally — never sent except to api.anthropic.com over HTTPS.')
                .addText(t => { t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.inputEl.placeholder = 'sk-ant-…'; t.setValue(this.plugin.settings.anthropicApiKey || '').onChange(async v => { this.plugin.settings.anthropicApiKey = v.trim(); await this.plugin.saveSettings(); }); });
        }

        if (!isV1 && provider !== 'anthropic') {
            const endpointPlaceholders: Record<string, string> = Object.fromEntries(
                PROVIDERS.filter(p => p.defaultEndpoint).map(p => [p.id, p.defaultEndpoint!])
            );
            endpointPlaceholders.custom = 'https://your-api/v1';
            new Setting(aiSec).setName('API Endpoint').setDesc('Full URL to the /v1 endpoint.')
                .addText(t => { t.inputEl.placeholder = endpointPlaceholders[provider] ?? ''; t.setValue(this.plugin.settings.openaiEndpoint).onChange(async v => { this.plugin.settings.openaiEndpoint = v.trim(); await this.plugin.saveSettings(); }); });
            const pCfg = PROVIDER_MAP.get(provider);
            if (pCfg?.requiresKey) {
                new Setting(aiSec).setName('API Key')
                    .addText(t => { t.inputEl.type = 'password'; t.inputEl.autocomplete = 'off'; t.setValue(this.plugin.settings.openaiApiKey).onChange(async v => { this.plugin.settings.openaiApiKey = v.trim(); await this.plugin.saveSettings(); }); });
            }
        }

        // Model Name
        const modelSetting = new Setting(aiSec).setName('Model Name').setDesc('ID of the model to use.');
        const pCfgSuggestions = PROVIDER_MAP.get(provider);
        if (pCfgSuggestions?.models?.length) {
            modelSetting.addDropdown(dd => {
                dd.addOption('', '— type a custom model ID below —');
                for (const m of pCfgSuggestions.models) dd.addOption(m, m);
                dd.setValue(pCfgSuggestions.models.includes(this.plugin.settings.modelName) ? this.plugin.settings.modelName : '');
                dd.onChange(async v => { if (!v) return; this.plugin.settings.modelName = v; await this.plugin.saveSettings(); this.display(); });
            });
        }
        modelSetting.addText(t => {
            t.inputEl.placeholder = getDefaultModelForHardware(detectHardwareMode(this.plugin.settings));
            t.setValue(this.plugin.settings.modelName);
            t.onChange(async v => {
                const trimmed = v.trim();
                if (!trimmed || trimmed.length > 200) return;
                this.plugin.settings.modelName = trimmed;
                await this.plugin.saveSettings();
                new Notice(`Model → "${trimmed}"`, 2500);
            });
        });

        // Test Connection
        const testResultEl = aiSec.createEl('p');
        testResultEl.style.cssText = 'font-size: 0.81em; color: var(--text-muted); margin: 0.2em 0;';
        testResultEl.textContent = 'Click Test to verify your AI connection.';
        const testRow = aiSec.createDiv();
        testRow.style.cssText = 'display: flex; gap: 0.5em; flex-wrap: wrap; margin-top: 0.3em;';
        const testBtn = testRow.createEl('button', { text: '🔌 Test Connection' });
        testBtn.style.cssText = 'padding: 0.35em 0.8em; border-radius: 6px; cursor: pointer; border: 1px solid var(--interactive-accent); color: var(--interactive-accent); font-size: 0.84em; background: var(--background-primary);';
        testBtn.setAttribute('aria-label', 'Test AI connection');
        testBtn.addEventListener('click', async () => {
            testBtn.textContent = '⏳ Testing…'; testBtn.disabled = true;
            testResultEl.style.color = 'var(--text-muted)';
            try {
                const r = await this.plugin.testAIConnection();
                testResultEl.textContent = r.message;
                testResultEl.style.color = r.success ? 'var(--color-green, #16a34a)' : 'var(--color-red, #dc2626)';
            } finally { testBtn.textContent = '🔌 Test Connection'; testBtn.disabled = false; }
        });

        if (provider === 'mistral' || provider === 'openai') {
            const findBtn = testRow.createEl('button', { text: '🔍 Find Best Model' });
            findBtn.style.cssText = 'padding: 0.35em 0.8em; border-radius: 6px; cursor: pointer; border: 1px solid var(--background-modifier-border); font-size: 0.84em; background: var(--background-primary);';
            findBtn.addEventListener('click', async () => {
                findBtn.textContent = '⏳ Scanning…'; findBtn.disabled = true;
                try {
                    const r = await this.plugin.findWorkingMistralModel();
                    testResultEl.textContent = r.message;
                    testResultEl.style.color = r.success ? 'var(--color-green, #16a34a)' : 'var(--color-red, #dc2626)';
                    if (r.success) this.display();
                } finally { findBtn.textContent = '🔍 Find Best Model'; findBtn.disabled = false; }
            });
        }

        // ── AI Prompts (manual/advanced only) ───────────────────────────────────
        if (mode !== 'auto') {
            const promptSec = makeSection(aiSec, '🗣️', 'AI Prompts', false);
            const currentPreset = detectPromptPreset(this.plugin.settings.systemPrompt, this.plugin.settings.userPromptTemplate);
            const estTokens = (str: string) => Math.round((str || '').length / 4);

            const presetInfoEl = promptSec.createEl('div');
            presetInfoEl.style.cssText = 'background: var(--background-secondary); border-radius: 6px; padding: 0.5em 0.85em; margin-bottom: 0.6em; font-size: 0.81em;';
            const renderPresetInfo = (key: string) => {
                const p = PROMPT_PRESETS[key];
                presetInfoEl.innerHTML = p ? `<strong>${p.label}</strong> — ${p.desc}` : '✏️ <strong>Custom</strong> — manually edited prompts.';
            };
            renderPresetInfo(currentPreset);

            const presetRow = promptSec.createDiv();
            presetRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; flex-wrap: wrap; margin-bottom: 0.75em;';
            presetRow.createEl('label', { text: 'Preset:' }).style.cssText = 'font-size: 0.85em; font-weight: 600;';
            const presetSelect = presetRow.createEl('select');
            presetSelect.style.cssText = 'padding: 0.25em 0.5em; border-radius: 5px; font-size: 0.85em; border: 1px solid var(--background-modifier-border); background: var(--background-primary); cursor: pointer;';
            presetSelect.setAttribute('aria-label', 'Select a prompt preset');
            ([['small', '🟢 Small (1–3B)'], ['balanced', '🟡 Balanced (7B)'], ['detailed', '🔵 Detailed (13B+)'], ['custom', '✏️ Custom']] as [string, string][]).forEach(([val, lbl]) => {
                const opt = presetSelect.createEl('option', { text: lbl, value: val });
                if (val === currentPreset) opt.selected = true;
            });

            let sysTextarea: HTMLTextAreaElement | null = null;
            let userTextarea: HTMLTextAreaElement | null = null;
            const applyPresetBtn = presetRow.createEl('button', { text: 'Apply' });
            applyPresetBtn.style.cssText = 'padding: 0.25em 0.7em; border-radius: 5px; font-size: 0.82em; cursor: pointer; background: var(--interactive-accent); color: var(--text-on-accent); border: none;';
            applyPresetBtn.addEventListener('click', async () => {
                const key = presetSelect.value;
                const preset = PROMPT_PRESETS[key];
                if (!preset) return;
                this.plugin.settings.systemPrompt = preset.system;
                this.plugin.settings.userPromptTemplate = preset.user;
                await this.plugin.saveSettings();
                if (sysTextarea) { sysTextarea.value = preset.system; sysTokenEl.textContent = `≈ ${estTokens(preset.system)} tokens`; }
                if (userTextarea) { userTextarea.value = preset.user; userTokenEl.textContent = `≈ ${estTokens(preset.user)} tokens`; }
                renderPresetInfo(key);
                new Notice(`Prompts set to ${preset.label}`, 2500);
            });
            presetSelect.addEventListener('change', () => renderPresetInfo(presetSelect.value));

            // System prompt
            const sysWrap = promptSec.createDiv(); sysWrap.style.cssText = 'margin-bottom: 0.75em;';
            const sysHeaderRow = sysWrap.createDiv(); sysHeaderRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.3em;';
            sysHeaderRow.createEl('span', { text: 'System Prompt' }).style.cssText = 'font-weight: 600; font-size: 0.9em;';
            const sysTokenEl = sysHeaderRow.createEl('span', { text: `≈ ${estTokens(this.plugin.settings.systemPrompt)} tokens` });
            sysTokenEl.style.cssText = 'font-size: 0.75em; color: var(--text-muted); margin-left: auto; font-family: var(--font-monospace);';
            const sysArea = sysWrap.createEl('textarea');
            sysArea.value = this.plugin.settings.systemPrompt; sysArea.rows = 3;
            sysArea.style.cssText = 'width: 100%; font-size: 0.83em; resize: vertical; border-radius: 4px; padding: 0.4em; border: 1px solid var(--background-modifier-border); background: var(--background-primary); color: var(--text-normal); font-family: var(--font-monospace);';
            sysTextarea = sysArea;
            sysArea.addEventListener('input', async () => {
                this.plugin.settings.systemPrompt = sysArea.value;
                sysTokenEl.textContent = `≈ ${estTokens(sysArea.value)} tokens`;
                presetSelect.value = 'custom'; renderPresetInfo('custom');
                await this.plugin.saveSettings();
            });
            const sysResetBtn = sysWrap.createEl('button', { text: '↺ Reset to preset' });
            sysResetBtn.style.cssText = 'margin-top: 0.25em; font-size: 0.75em; padding: 0.15em 0.5em; border-radius: 4px; cursor: pointer; border: 1px solid var(--background-modifier-border); background: transparent; color: var(--text-muted);';
            sysResetBtn.addEventListener('click', async () => {
                const preset = PROMPT_PRESETS[presetSelect.value];
                if (!preset) return;
                this.plugin.settings.systemPrompt = preset.system;
                sysArea.value = preset.system; sysTokenEl.textContent = `≈ ${estTokens(preset.system)} tokens`;
                await this.plugin.saveSettings();
            });

            // User prompt
            const userWrap = promptSec.createDiv(); userWrap.style.cssText = 'margin-bottom: 0.5em;';
            const userHeaderRow = userWrap.createDiv(); userHeaderRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.3em;';
            userHeaderRow.createEl('span', { text: 'User Prompt Template' }).style.cssText = 'font-weight: 600; font-size: 0.9em;';
            const userTokenEl = userHeaderRow.createEl('span', { text: `≈ ${estTokens(this.plugin.settings.userPromptTemplate)} tokens` });
            userTokenEl.style.cssText = 'font-size: 0.75em; color: var(--text-muted); margin-left: auto; font-family: var(--font-monospace);';
            userWrap.createEl('p', { text: 'Use {{term}} and {{context}} as placeholders.' }).style.cssText = 'font-size: 0.78em; color: var(--text-muted); margin: 0 0 0.3em;';
            const userArea = userWrap.createEl('textarea');
            userArea.value = this.plugin.settings.userPromptTemplate; userArea.rows = 4;
            userArea.style.cssText = sysArea.style.cssText;
            userTextarea = userArea;
            userArea.addEventListener('input', async () => {
                this.plugin.settings.userPromptTemplate = userArea.value;
                userTokenEl.textContent = `≈ ${estTokens(userArea.value)} tokens`;
                presetSelect.value = 'custom'; renderPresetInfo('custom');
                await this.plugin.saveSettings();
            });
            const userResetBtn = userWrap.createEl('button', { text: '↺ Reset to preset' });
            userResetBtn.style.cssText = sysResetBtn.style.cssText;
            userResetBtn.addEventListener('click', async () => {
                const preset = PROMPT_PRESETS[presetSelect.value];
                if (!preset) return;
                this.plugin.settings.userPromptTemplate = preset.user;
                userArea.value = preset.user; userTokenEl.textContent = `≈ ${estTokens(preset.user)} tokens`;
                await this.plugin.saveSettings();
            });
        }

        // ── Organization ────────────────────────────────────────────────────────
        const orgSec = makeSection(containerEl, '📁', 'Organization', true);
        new Setting(orgSec).setName('Wiki Directory').setDesc('Vault folder where wiki notes are saved.')
            .addText(t => { t.inputEl.placeholder = 'Wiki'; t.setValue(this.plugin.settings.customDirectoryName).onChange(async v => { this.plugin.settings.customDirectoryName = v; await this.plugin.saveSettings(); }); });

        new Setting(orgSec).setName('Use Categories').setDesc('Organise notes into subject subfolders.')
            .addToggle(t => t.setValue(this.plugin.settings.useCategories).onChange(async v => { this.plugin.settings.useCategories = v; await this.plugin.saveSettings(); this.display(); }));

        if (this.plugin.settings.useCategories) {
            orgSec.createEl('p', { text: 'Priority order: Source Folder → Tags → Keywords → Default.', cls: 'setting-item-description' });
            const catListEl = orgSec.createDiv();
            const renderCategoryList = () => {
                catListEl.empty();
                const cats = this.plugin.settings.categories || [];
                if (cats.length === 0) catListEl.createEl('p', { text: 'No categories yet.', cls: 'setting-item-description' });
                cats.forEach((cat, idx) => {
                    const box = catListEl.createDiv();
                    box.style.cssText = 'border: 1px solid var(--background-modifier-border); border-radius: 6px; padding: 10px 12px; margin-bottom: 8px;';
                    const hdrRow = box.createDiv();
                    hdrRow.style.cssText = 'display: flex; align-items: center; gap: 0.5em; margin-bottom: 0.5em;';
                    hdrRow.createEl('strong', { text: cat.name || '(unnamed)' });

                    const enabledLbl = hdrRow.createEl('label');
                    enabledLbl.style.cssText = 'display: flex; align-items: center; gap: 0.3em; font-size: 0.82em; color: var(--text-muted); margin-left: auto; cursor: pointer;';
                    const enabledChk = enabledLbl.createEl('input');
                    enabledChk.type = 'checkbox'; enabledChk.checked = cat.enabled !== false;
                    enabledChk.addEventListener('change', async () => { this.plugin.settings.categories[idx].enabled = enabledChk.checked; await this.plugin.saveSettings(); });
                    enabledLbl.append('Enabled');

                    const delBtn = hdrRow.createEl('button', { text: '✕' });
                    delBtn.style.cssText = 'padding: 0.1em 0.45em; border-radius: 4px; cursor: pointer; color: var(--color-red, #dc2626); border: 1px solid currentColor; font-size: 0.75em; background: transparent;';
                    delBtn.addEventListener('click', async () => {
                        this.plugin.settings.categories.splice(idx, 1);
                        if (this.plugin.settings.defaultCategory === cat.name)
                            this.plugin.settings.defaultCategory = this.plugin.settings.categories[0]?.name || '';
                        await this.plugin.saveSettings();
                        this.plugin.categoryManager?._buildCategoryMap();
                        renderCategoryList();
                    });

                    const addField = (label: string, desc: string, val: string, ph: string, saveFn: (v: string) => Promise<void>) =>
                        new Setting(box).setName(label).setDesc(desc)
                            .addText(t => t.setPlaceholder(ph).setValue(val || '').onChange(async v => { await saveFn(v); this.plugin.categoryManager?._buildCategoryMap(); }));

                    addField('Name', '', cat.name, 'e.g. Neuroscience', async v => { this.plugin.settings.categories[idx].name = v; await this.plugin.saveSettings(); });
                    addField('Path', 'Vault folder for this category', cat.path, 'e.g. Wiki/Neuroscience', async v => { this.plugin.settings.categories[idx].path = v; await this.plugin.saveSettings(); });
                    addField('Source Folder', 'Route notes from this folder here', cat.sourceFolder, 'e.g. Notes/Neuro/', async v => { this.plugin.settings.categories[idx].sourceFolder = v; await this.plugin.saveSettings(); });
                    addField('Tags', 'Comma-separated tags', (cat.tags || []).join(', '), 'e.g. neuroscience, biology', async v => { this.plugin.settings.categories[idx].tags = v.split(',').map(s => s.trim()).filter(Boolean); await this.plugin.saveSettings(); });
                    addField('Keywords', 'Comma-separated keywords', (cat.keywords || []).join(', '), 'e.g. neuron, synapse', async v => { this.plugin.settings.categories[idx].keywords = v.split(',').map(s => s.trim()).filter(Boolean); await this.plugin.saveSettings(); });
                });
            };
            renderCategoryList();
            new Setting(orgSec).addButton(btn => btn.setButtonText('＋ Add Category').setCta().onClick(async () => {
                this.plugin.settings.categories.push({ name: 'New Category', path: 'Wiki/New Category', sourceFolder: '', tags: [], keywords: [], enabled: true });
                await this.plugin.saveSettings(); this.plugin.categoryManager?._buildCategoryMap(); renderCategoryList();
            }));
            const catNames = (this.plugin.settings.categories || []).map(c => c.name);
            if (catNames.length > 0) {
                new Setting(orgSec).setName('Default Category').setDesc('Fallback when no rule matches.')
                    .addDropdown(dd => { catNames.forEach(n => dd.addOption(n, n)); dd.setValue(this.plugin.settings.defaultCategory || catNames[0]).onChange(async v => { this.plugin.settings.defaultCategory = v; await this.plugin.saveSettings(); }); });
            }
        }

        // ── AI Subcategories (manual/advanced) ─────────────────────────────────
        if (mode !== 'auto') {
            const subcatSec = makeSection(containerEl, '📂', 'AI Subcategories', false);
            new Setting(subcatSec).setName('Enable AI Subcategories')
                .setDesc('Requires a working AI provider and "Use Categories" enabled above.')
                .addToggle(t => t.setValue(this.plugin.settings.aiSubcategoriesEnabled ?? false).onChange(async v => { this.plugin.settings.aiSubcategoriesEnabled = v; await this.plugin.saveSettings(); this.display(); }));

            if (this.plugin.settings.aiSubcategoriesEnabled) {
                new Setting(subcatSec).setName('Context Characters').setDesc('Characters sent to classifier. 600 is plenty.')
                    .addSlider(s => s.setLimits(100, 2000, 100).setValue(this.plugin.settings.aiSubcategoryContextChars ?? 600).setDynamicTooltip().onChange(async v => { this.plugin.settings.aiSubcategoryContextChars = v; await this.plugin.saveSettings(); }));
                new Setting(subcatSec).setName('Clear Subcategory Cache')
                    .addButton(btn => btn.setButtonText('🗑 Clear Cache').setWarning().onClick(() => {
                        if (this.plugin.generator) { this.plugin.generator._subcatCache.clear(); this.plugin.generator._subcatByCategory.clear(); }
                        new Notice('Subcategory cache cleared.', 4000); this.display();
                    }));
            }
        }

        // ── Knowledge Sources (manual/advanced) ────────────────────────────────
        if (mode !== 'auto') {
            const ksSec = makeSection(containerEl, '📚', 'Knowledge Sources', false);
            new Setting(ksSec).setName('Wikipedia Excerpts').addToggle(t => t.setValue(this.plugin.settings.useWikipedia).onChange(async v => { this.plugin.settings.useWikipedia = v; await this.plugin.saveSettings(); }));
            new Setting(ksSec).setName('Wikipedia in AI Context').addToggle(t => t.setValue(this.plugin.settings.useWikipediaInContext).onChange(async v => { this.plugin.settings.useWikipediaInContext = v; await this.plugin.saveSettings(); }));
            new Setting(ksSec).setName('Dictionary API').addToggle(t => t.setValue(this.plugin.settings.useDictionaryAPI).onChange(async v => { this.plugin.settings.useDictionaryAPI = v; await this.plugin.saveSettings(); }));
            new Setting(ksSec).setName('Dictionary in AI Context').addToggle(t => t.setValue(this.plugin.settings.useDictionaryInContext).onChange(async v => { this.plugin.settings.useDictionaryInContext = v; await this.plugin.saveSettings(); }));
            new Setting(ksSec).setName('Glossary File').addText(t => { t.inputEl.placeholder = 'Definitions.md'; t.setValue(this.plugin.settings.glossaryBasePath).onChange(async v => { this.plugin.settings.glossaryBasePath = v; await this.plugin.saveSettings(); }); });
        }

        // ── Generation Features (manual/advanced) ───────────────────────────────
        if (mode !== 'auto') {
            const featSec = makeSection(containerEl, '✍️', 'Generation Features', false);
            new Setting(featSec).setName('Generate Tags').addToggle(t => t.setValue(this.plugin.settings.generateTags).onChange(async v => { this.plugin.settings.generateTags = v; await this.plugin.saveSettings(); }));
            new Setting(featSec).setName('Max Tags').addSlider(s => s.setLimits(1, 30, 1).setValue(this.plugin.settings.maxTags).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxTags = v; await this.plugin.saveSettings(); }));
            new Setting(featSec).setName('Tags Include # Prefix').addToggle(t => t.setValue(this.plugin.settings.tagsIncludeHashPrefix).onChange(async v => { this.plugin.settings.tagsIncludeHashPrefix = v; await this.plugin.saveSettings(); }));
            new Setting(featSec).setName('Related Concepts').addToggle(t => t.setValue(this.plugin.settings.generateRelatedConcepts).onChange(async v => { this.plugin.settings.generateRelatedConcepts = v; await this.plugin.saveSettings(); }));
            new Setting(featSec).setName('Max Related Concepts').addSlider(s => s.setLimits(1, 20, 1).setValue(this.plugin.settings.maxRelatedConcepts).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxRelatedConcepts = v; await this.plugin.saveSettings(); }));
            new Setting(featSec).setName('Track AI Model').addToggle(t => t.setValue(this.plugin.settings.trackModel).onChange(async v => { this.plugin.settings.trackModel = v; await this.plugin.saveSettings(); }));
            new Setting(featSec).setName('AI Summary Disclaimer').addText(t => t.setValue(this.plugin.settings.aiSummaryDisclaimer).onChange(async v => { this.plugin.settings.aiSummaryDisclaimer = v; await this.plugin.saveSettings(); }));
            new Setting(featSec).setName('Extract Key Concepts').addToggle(t => t.setValue(this.plugin.settings.extractKeyConceptsFromSummary ?? true).onChange(async v => { this.plugin.settings.extractKeyConceptsFromSummary = v; await this.plugin.saveSettings(); }));
        }

        // ── Performance (advanced only) ─────────────────────────────────────────
        if (mode === 'advanced') {
            const perfSec = makeSection(containerEl, '⚡', 'Performance', false);
            new Setting(perfSec).setName('AI Context Max Chars').setDesc('Hard cap on characters sent to AI per term.')
                .addSlider(s => s.setLimits(2000, 60000, 1000).setValue(this.plugin.settings.aiContextMaxChars ?? 20000).setDynamicTooltip().onChange(async v => { this.plugin.settings.aiContextMaxChars = v; await this.plugin.saveSettings(); }));
            new Setting(perfSec).setName('Context Depth')
                .addDropdown(dd => dd.addOption('partial', 'Partial — wikilinks only').addOption('full', 'Full — wikilinks + virtual').addOption('performance', 'Performance — link line only')
                    .setValue(this.plugin.settings.contextDepth).onChange(async v => { this.plugin.settings.contextDepth = v as 'full' | 'partial' | 'performance'; await this.plugin.saveSettings(); }));
            new Setting(perfSec).setName('Batch Size')
                .addSlider(s => s.setLimits(1, 20, 1).setValue(this.plugin.settings.batchSize).setDynamicTooltip().onChange(async v => { this.plugin.settings.batchSize = v; await this.plugin.saveSettings(); }));
            new Setting(perfSec).setName('Priority Queue').addToggle(t => t.setValue(this.plugin.settings.usePriorityQueue).onChange(async v => { this.plugin.settings.usePriorityQueue = v; await this.plugin.saveSettings(); }));
            new Setting(perfSec).setName('Show Progress Notification').addToggle(t => t.setValue(this.plugin.settings.showProgressNotification).onChange(async v => { this.plugin.settings.showProgressNotification = v; await this.plugin.saveSettings(); }));
        }

        // ── Term Matching (advanced only) ───────────────────────────────────────
        if (mode === 'advanced') {
            const matchSec = makeSection(containerEl, '🔍', 'Term Matching', false);
            new Setting(matchSec).setName('Min Word Length').addSlider(s => s.setLimits(2, 10, 1).setValue(this.plugin.settings.minWordLengthForAutoDetect).setDynamicTooltip().onChange(async v => { this.plugin.settings.minWordLengthForAutoDetect = v; await this.plugin.saveSettings(); }));
            new Setting(matchSec).setName('Max Words to Match').addSlider(s => s.setLimits(1, 5, 1).setValue(this.plugin.settings.maxWordsToMatch).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxWordsToMatch = v; await this.plugin.saveSettings(); }));
            new Setting(matchSec).setName('Prefer Longer Matches').addToggle(t => t.setValue(this.plugin.settings.preferLongerMatches).onChange(async v => { this.plugin.settings.preferLongerMatches = v; await this.plugin.saveSettings(); }));
            new Setting(matchSec).setName('Whole Words Only').addToggle(t => t.setValue(this.plugin.settings.matchWholeWordsOnly).onChange(async v => { this.plugin.settings.matchWholeWordsOnly = v; await this.plugin.saveSettings(); }));
        }

        // ── Logging (advanced only) ─────────────────────────────────────────────
        if (mode === 'advanced') {
            const logSec = makeSection(containerEl, '📋', 'Logging & Diagnostics', false);
            new Setting(logSec).setName('Enable Logging').addToggle(t => t.setValue(this.plugin.settings.enableLogging).onChange(async v => { this.plugin.settings.enableLogging = v; await this.plugin.saveSettings(); }));
            new Setting(logSec).setName('Log Level')
                .addDropdown(dd => dd.addOption('DEBUG', 'DEBUG').addOption('INFO', 'INFO (default)').addOption('WARN', 'WARN').addOption('ERROR', 'ERROR')
                    .setValue(this.plugin.settings.logLevel).onChange(async v => { this.plugin.settings.logLevel = v as 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'; await this.plugin.saveSettings(); }));
            new Setting(logSec).setName('Log Directory').addText(t => { t.inputEl.placeholder = 'VaultWiki/Logs'; t.setValue(this.plugin.settings.logDirectory).onChange(async v => { this.plugin.settings.logDirectory = v; await this.plugin.saveSettings(); }); });
            new Setting(logSec).setName('Max Log Age (days)').addSlider(s => s.setLimits(1, 90, 1).setValue(this.plugin.settings.maxLogAgeDays).setDynamicTooltip().onChange(async v => { this.plugin.settings.maxLogAgeDays = v; await this.plugin.saveSettings(); }));
            new Setting(logSec).setName('Open Latest Log').addButton(btn => btn.setButtonText('📄 Open Log').onClick(() => this.plugin.openLatestLog()));
        }
    }
}
