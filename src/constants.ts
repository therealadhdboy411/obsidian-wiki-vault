// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

import type { WikiVaultSettings, ProviderConfig, PromptPreset } from './types';

export const DEFAULT_SETTINGS: WikiVaultSettings = {
    // AI Provider
    // Supported: mistral | openai | anthropic | groq | ollama | openrouter | together | lmstudio-openai | lmstudio-v1 | custom
    provider: 'mistral',
    openaiEndpoint: 'https://api.mistral.ai/v1',
    openaiApiKey: '',
    modelName: 'mistral-medium-latest',
    apiType: 'openai',

    // Anthropic-specific settings (non-OpenAI format)
    anthropicApiKey: '',
    anthropicVersion: '2023-06-01',

    // LM Studio native v1 API settings
    lmstudioV1Endpoint: 'http://localhost:1234',
    lmstudioV1ApiToken: '',
    lmstudioV1Stateful: true,
    lmstudioV1LastResponseId: null,
    lmstudioV1StreamingEnabled: true,

    // Hardware optimization mode
    hardwareMode: 'auto',

    // UI complexity mode
    settingsMode: 'auto',
    showHardwareModeInStatus: true,

    // Core Settings
    similarityThreshold: 0.7,
    runOnStartup: false,
    runOnFileSwitch: false,
    useCustomDirectory: true,
    customDirectoryName: 'Wiki',
    showProgressNotification: true,
    batchSize: 10,
    contextDepth: 'partial',

    // Knowledge Sources
    useDictionaryAPI: true,
    dictionaryAPIEndpoint: 'https://api.dictionaryapi.dev/api/v2/entries/en',
    useWikipedia: true,
    useWikipediaInContext: true,
    useDictionaryInContext: true,
    glossaryBasePath: '',

    // AI Prompts
    // ⚡ BOLT v0.9.2: Defaults exactly match PROMPT_PRESETS.balanced so that
    // detectPromptPreset() correctly identifies 'balanced' on a fresh install.
    systemPrompt: 'Write accurate, well-structured wiki summaries in markdown.\nBold all key terms, concepts, and proper nouns with **double asterisks**.\nWrite in prose paragraphs. Begin immediately without any preamble.\nBase your answer only on the provided context.',
    userPromptTemplate: 'Summarize **{{term}}** based on the context below. Be thorough but concise. Bold every key term.\n\nContext:\n{{context}}\n\nSummary:',

    // ⚡ BOLT: AI context window cap.
    aiContextMaxChars: 20_000,

    // Context Extraction
    includeHeadingContext: true,
    includeFullParagraphs: true,
    contextLinesAround: 2,

    // Generation Features
    generateTags: true,
    maxTags: 20,
    tagsIncludeHashPrefix: true,
    generateRelatedConcepts: true,
    maxRelatedConcepts: 10,
    trackModel: true,
    usePriorityQueue: true,

    // Output Format
    aiSummaryDisclaimer: '*AI can make mistakes, always check information*',
    extractKeyConceptsFromSummary: true,
    wikipediaLinkText: 'Read more on Wikipedia',
    preserveMentionFormatting: true,

    // Virtual Links (from Virtual Linker)
    virtualLinksEnabled: true,
    virtualLinkSuffix: '🔗',
    applyDefaultLinkStyling: true,
    matchWholeWordsOnly: true,
    matchBeginningOfWords: true,
    matchEndOfWords: true,
    matchAnyPartsOfWords: false,
    caseSensitiveMatching: false,
    onlyLinkOnce: true,
    excludeLinksToOwnNote: true,
    excludeLinksToRealLinkedFiles: true,
    includeAliases: true,
    alwaysShowMultipleReferences: true,

    // Smart Matching
    minWordLengthForAutoDetect: 3,
    maxWordsToMatch: 3,
    preferLongerMatches: true,
    showAllPossibleMatches: true,

    // File Filtering
    excludedFileTypes: ['png', 'jpg', 'jpeg', 'gif', 'svg', 'pdf', 'mp4', 'mp3', 'wav', 'webp', 'bmp'],

    // Categories
    useCategories: true,
    categories: [
        {
            name: 'General',
            path: 'Wiki/General',
            sourceFolder: '',
            tags: [],
            keywords: [],
            enabled: true,
        },
    ],
    defaultCategory: 'General',
    autoAssignCategory: true,

    // Synonyms & Abbreviations
    synonyms: {
        'ML': 'Machine Learning',
        'AI': 'Artificial Intelligence',
        'DL': 'Deep Learning',
        'NLP': 'Natural Language Processing',
        'RL': 'Reinforcement Learning',
        'NN': 'Neural Network',
        'RMP': 'Resting Membrane Potential',
        'NMJ': 'Neuromuscular Junction',
        'ACh': 'Acetylcholine',
        'AP': 'Action Potential',
        'ATP': 'Adenosine Triphosphate',
    },

    // Logging
    enableLogging: true,
    logLevel: 'INFO',
    logDirectory: 'VaultWiki/Logs',
    maxLogAgeDays: 30,

    // Auto-update detection
    autoUpdateExistingNotes: true,

    // AI Subcategory Classification
    aiSubcategoriesEnabled: false,
    aiSubcategorySystemPrompt: 'Return ONLY a subject subcategory name (2–4 words, Title Case).\nNo punctuation. No explanation. No sentence. Just the name.',
    aiSubcategoryContextChars: 600,
};

// ============================================================================
// PROVIDER CONFIGURATION TABLE
// ============================================================================

/**
 * Canonical provider descriptors.
 */
export const PROVIDERS: ProviderConfig[] = [
    {
        id: 'mistral',
        label: 'Mistral AI',
        emoji: '🌊',
        defaultEndpoint: 'https://api.mistral.ai/v1',
        defaultModel: 'mistral-small-latest',
        apiFormat: 'openai',
        requiresKey: true,
        localOnly: false,
        keyHeader: 'Authorization',
        models: [
            'mistral-small-latest',
            'mistral-medium-latest',
            'mistral-large-latest',
            'open-mistral-nemo',
            'open-mixtral-8x7b',
        ],
    },
    {
        id: 'openai',
        label: 'OpenAI',
        emoji: '🤖',
        defaultEndpoint: 'https://api.openai.com/v1',
        defaultModel: 'gpt-4o-mini',
        apiFormat: 'openai',
        requiresKey: true,
        localOnly: false,
        keyHeader: 'Authorization',
        models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-mini', 'o3-mini'],
    },
    {
        id: 'anthropic',
        label: 'Anthropic Claude',
        emoji: '🔶',
        defaultEndpoint: 'https://api.anthropic.com',
        defaultModel: 'claude-3-5-haiku-20241022',
        apiFormat: 'anthropic',
        requiresKey: true,
        localOnly: false,
        keyHeader: 'x-api-key',
        models: [
            'claude-3-5-haiku-20241022',
            'claude-3-5-sonnet-20241022',
            'claude-3-opus-20240229',
            'claude-3-haiku-20240307',
        ],
    },
    {
        id: 'groq',
        label: 'Groq (fast inference)',
        emoji: '⚡',
        defaultEndpoint: 'https://api.groq.com/openai/v1',
        defaultModel: 'llama-3.1-8b-instant',
        apiFormat: 'openai',
        requiresKey: true,
        localOnly: false,
        keyHeader: 'Authorization',
        models: [
            'llama-3.1-8b-instant',
            'llama-3.3-70b-versatile',
            'llama3-8b-8192',
            'mixtral-8x7b-32768',
            'gemma2-9b-it',
        ],
    },
    {
        id: 'ollama',
        label: 'Ollama (local)',
        emoji: '🦙',
        defaultEndpoint: 'http://localhost:11434/v1',
        defaultModel: 'llama3.2',
        apiFormat: 'openai',
        requiresKey: false,
        localOnly: true,
        keyHeader: 'Authorization',
        models: ['llama3.2', 'llama3.1', 'qwen2.5', 'mistral', 'phi3', 'gemma2', 'deepseek-r1'],
    },
    {
        id: 'openrouter',
        label: 'OpenRouter',
        emoji: '🌐',
        defaultEndpoint: 'https://openrouter.ai/api/v1',
        defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
        apiFormat: 'openai',
        requiresKey: true,
        localOnly: false,
        keyHeader: 'Authorization',
        models: [
            'meta-llama/llama-3.1-8b-instruct:free',
            'mistralai/mistral-7b-instruct:free',
            'google/gemma-2-9b-it:free',
            'deepseek/deepseek-chat',
            'anthropic/claude-3-5-sonnet',
            'openai/gpt-4o-mini',
        ],
    },
    {
        id: 'together',
        label: 'Together AI',
        emoji: '🤝',
        defaultEndpoint: 'https://api.together.xyz/v1',
        defaultModel: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
        apiFormat: 'openai',
        requiresKey: true,
        localOnly: false,
        keyHeader: 'Authorization',
        models: [
            'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
            'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
            'mistralai/Mixtral-8x7B-Instruct-v0.1',
            'Qwen/Qwen2.5-7B-Instruct-Turbo',
            'google/gemma-2-9b-it',
        ],
    },
    {
        id: 'lmstudio-openai',
        label: 'LM Studio — OpenAI compat',
        emoji: '🏠',
        defaultEndpoint: 'http://localhost:1234/v1',
        defaultModel: null, // filled by getDefaultModelForHardware()
        apiFormat: 'openai',
        requiresKey: false,
        localOnly: true,
        keyHeader: 'Authorization',
        models: [],
    },
    {
        id: 'lmstudio-v1',
        label: 'LM Studio — Native v1 ✨',
        emoji: '🏠',
        defaultEndpoint: 'http://localhost:1234',
        defaultModel: null,
        apiFormat: 'lmstudio-v1',
        requiresKey: false,
        localOnly: true,
        keyHeader: 'Authorization',
        models: [],
    },
    {
        id: 'custom',
        label: 'Custom endpoint',
        emoji: '⚙️',
        defaultEndpoint: '',
        defaultModel: '',
        apiFormat: 'openai',
        requiresKey: false,
        localOnly: false,
        keyHeader: 'Authorization',
        models: [],
    },
];

/** Fast O(1) provider lookup by id. */
export const PROVIDER_MAP = new Map<string, ProviderConfig>(PROVIDERS.map(p => [p.id, p]));

/** Returns the descriptor for the configured provider (or "custom" as fallback). */
export function getProviderConfig(settings: WikiVaultSettings): ProviderConfig {
    return PROVIDER_MAP.get(settings.provider) ?? PROVIDER_MAP.get('custom')!;
}

/**
 * 🛡️ SENTINEL: Returns true if an API key is REQUIRED for the given provider
 * and none has been configured.
 */
export function providerNeedsKey(settings: WikiVaultSettings): boolean {
    const p = getProviderConfig(settings);
    if (!p.requiresKey) return false;
    if (settings.provider === 'anthropic') return !settings.anthropicApiKey;
    return !settings.openaiApiKey;
}

// Irregular plurals
export const IRREGULAR_PLURALS: Record<string, string> = {
    child: 'children', person: 'people', man: 'men', woman: 'women',
    tooth: 'teeth', foot: 'feet', mouse: 'mice', goose: 'geese',
    analysis: 'analyses', thesis: 'theses', criterion: 'criteria',
    phenomenon: 'phenomena',
};

// ============================================================================
// PROMPT PRESETS
// ============================================================================

export const PROMPT_PRESETS: Record<string, PromptPreset> = {
    small: {
        label: '🟢 Small (1–3B)',
        desc: 'Maximally specific prompts for 1–3B models. Front-loaded task, explicit format rules, no ambiguity.',
        system: [
            'Output a wiki summary in markdown.',
            'Rules:',
            '- Start writing immediately. No preamble like "Here is a summary" or "Sure!".',
            '- Bold every key term, concept, and proper noun using **double asterisks**.',
            '- Use short paragraphs. Do not use bullet lists unless listing distinct items.',
            '- Only use information from the provided context. Do not invent facts.',
            '- End when the summary is complete. Do not add closing remarks.',
        ].join('\n'),
        user: 'Write a wiki summary of **{{term}}**.\n\nContext from notes:\n{{context}}\n\nSummary:',
        subcatSystem: [
            'Output exactly one subject category name. Nothing else.',
            'Format: 2 to 4 words, Title Case, no punctuation, no explanation.',
            'Examples: Cellular Biology, Quantum Mechanics, Roman History',
            'Do not write a sentence. Do not say "Category:" or "The category is".',
            'Just output the name.',
        ].join('\n'),
    },
    balanced: {
        label: '🟡 Balanced (7B)',
        desc: 'Specific prompts for 7B models — enough detail for good output without over-constraining.',
        system: [
            'Write accurate, well-structured wiki summaries in markdown.',
            'Bold all key terms, concepts, and proper nouns with **double asterisks**.',
            'Write in prose paragraphs. Begin immediately without any preamble.',
            'Base your answer only on the provided context.',
        ].join('\n'),
        user: 'Summarize **{{term}}** based on the context below. Be thorough but concise. Bold every key term.\n\nContext:\n{{context}}\n\nSummary:',
        subcatSystem: [
            'Return ONLY a subject subcategory name (2–4 words, Title Case).',
            'No punctuation. No explanation. No sentence. Just the name.',
        ].join('\n'),
    },
    detailed: {
        label: '🔵 Detailed (13B+)',
        desc: 'Full instructions for large local models or cloud APIs.',
        system: 'You are a precise academic wiki writer. Synthesize the provided notes into a structured, thorough summary in markdown. Use **bold** for all key terms, concepts, and proper nouns. Write in clear prose paragraphs. Begin immediately without preamble. Base your answer only on the provided context.',
        user: 'Write a comprehensive wiki entry for **{{term}}** using only the provided context. Cover key concepts, definitions, mechanisms, and relationships. Bold every key term and concept.\n\nContext:\n{{context}}\n\nWiki Entry:',
        subcatSystem: 'Return ONLY the most accurate subject subcategory name for this term (2–4 words, Title Case, no punctuation, no explanation). Just the name — nothing else.',
    },
};
