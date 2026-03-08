// ============================================================================
// TYPES & INTERFACES
// ============================================================================

export interface CategoryConfig {
    name: string;
    path: string;
    sourceFolder: string;
    tags: string[];
    keywords: string[];
    enabled: boolean;
}

export interface PromptPreset {
    label: string;
    desc: string;
    system: string;
    user: string;
    subcatSystem: string;
}

export interface ProviderConfig {
    id: string;
    label: string;
    emoji: string;
    defaultEndpoint: string | null;
    defaultModel: string | null;
    apiFormat: 'openai' | 'anthropic' | 'lmstudio-v1' | 'gemini';
    requiresKey: boolean;
    localOnly: boolean;
    keyHeader: string;
    models: string[];
}

export interface WikiVaultSettings {
    // AI Provider
    provider: string;
    openaiEndpoint: string;
    openaiApiKey: string;
    modelName: string;
    apiType: string;

    // Anthropic
    anthropicApiKey: string;
    anthropicVersion: string;

    // LM Studio native v1
    lmstudioV1Endpoint: string;
    lmstudioV1ApiToken: string;
    lmstudioV1Stateful: boolean;
    lmstudioV1LastResponseId: string | null;
    lmstudioV1StreamingEnabled: boolean;

    // Hardware
    hardwareMode: 'auto' | 'cpu' | 'gpu' | 'android' | 'ios';

    // UI complexity mode
    settingsMode: 'auto' | 'manual' | 'advanced';
    showHardwareModeInStatus: boolean;

    // Core settings
    similarityThreshold: number;
    runOnStartup: boolean;
    runOnFileSwitch: boolean;
    useCustomDirectory: boolean;
    customDirectoryName: string;
    showProgressNotification: boolean;
    batchSize: number;
    contextDepth: 'full' | 'partial' | 'performance';

    // Knowledge sources
    useDictionaryAPI: boolean;
    dictionaryAPIEndpoint: string;
    useWikipedia: boolean;
    useWikipediaInContext: boolean;
    useDictionaryInContext: boolean;
    glossaryBasePath: string;

    // AI prompts
    systemPrompt: string;
    userPromptTemplate: string;
    aiContextMaxChars: number;

    // Context extraction
    includeHeadingContext: boolean;
    includeFullParagraphs: boolean;
    contextLinesAround: number;

    // Generation features
    generateTags: boolean;
    maxTags: number;
    tagsIncludeHashPrefix: boolean;
    generateRelatedConcepts: boolean;
    maxRelatedConcepts: number;
    trackModel: boolean;
    usePriorityQueue: boolean;

    // Output format
    aiSummaryDisclaimer: string;
    extractKeyConceptsFromSummary: boolean;
    wikipediaLinkText: string;
    preserveMentionFormatting: boolean;

    // Virtual links
    virtualLinksEnabled: boolean;
    virtualLinkSuffix: string;
    applyDefaultLinkStyling: boolean;
    matchWholeWordsOnly: boolean;
    matchBeginningOfWords: boolean;
    matchEndOfWords: boolean;
    matchAnyPartsOfWords: boolean;
    caseSensitiveMatching: boolean;
    onlyLinkOnce: boolean;
    excludeLinksToOwnNote: boolean;
    excludeLinksToRealLinkedFiles: boolean;
    includeAliases: boolean;
    alwaysShowMultipleReferences: boolean;

    // Smart matching
    minWordLengthForAutoDetect: number;
    maxWordsToMatch: number;
    preferLongerMatches: boolean;
    showAllPossibleMatches: boolean;

    // File filtering
    excludedFileTypes: string[];

    // Categories
    useCategories: boolean;
    categories: CategoryConfig[];
    defaultCategory: string;
    autoAssignCategory: boolean;

    // Synonyms & abbreviations
    synonyms: Record<string, string>;

    // Logging
    enableLogging: boolean;
    logLevel: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    logDirectory: string;
    maxLogAgeDays: number;

    // Auto-update
    autoUpdateExistingNotes: boolean;

    // AI Subcategories
    aiSubcategoriesEnabled: boolean;
    aiSubcategorySystemPrompt: string;
    aiSubcategoryContextChars: number;

    // Internal per-pass caches (set at runtime, not persisted)
    _cachedLMSEndpoint?: string;
    _cachedOAIEndpoint?: string;
}

export interface LogEntry {
    ts: string;
    level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
    context: string;
    message: string;
    extra: unknown | null;
}

export interface LogStats {
    generated: number;
    skipped: number;
    failed: number;
    apiCalls: number;
    apiErrors: number;
    cacheHits: number;
    totalMs: number;
}

export interface MatchResult {
    text: string;
    startWord: number;
    endWord: number;
    wordCount: number;
    files: import('obsidian').TFile[];
}

export interface MentionEntry {
    file: import('obsidian').TFile;
    heading: string | null;
    contentLines: string[];
    type: 'wikilinked' | 'virtual';
    matchText?: string;
    alternatives?: string[];
}

export interface ContextData {
    mentions: MentionEntry[];
    sourceFiles: import('obsidian').TFile[];
    rawContext: string;
}

export interface FileContentCacheEntry {
    content: string;
    lines: string[];
    headingByLine: (string | null)[];
    file: import('obsidian').TFile;
}

export interface AISummaryResult {
    text: string;
    truncated: boolean;
}

export interface AIConnectionResult {
    success: boolean;
    message: string;
    model?: string;
    latencyMs?: number;
}

export interface AutoConfig {
    batchSize: number;
    aiContextMaxChars: number;
    contextDepth: 'full' | 'partial' | 'performance';
    promptPreset: string;
}

export interface FileCategoryEntry {
    category: CategoryConfig;
    fileTags: string[];
}

export interface DictionaryData {
    formatted: string;
    plain: string;
}

export interface WikipediaData {
    title: string;
    url: string;
    extract: string;
}
