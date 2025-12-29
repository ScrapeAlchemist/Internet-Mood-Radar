import { CountryConfig, SourceConfig } from '@/types';
import { getCountryConfig, getMultipleCountryConfigs, DynamicCountryConfig, mergeKeywords, mergeCities } from './country-config';
import { getSettings } from './settings';

// ============================================================================
// DYNAMIC COUNTRY CONFIGURATION
// ============================================================================

// Re-export types and functions from country-config
export type { DynamicCountryConfig };
export { getCountryConfig, getMultipleCountryConfigs };

/**
 * Get active country configs based on settings
 * Returns configs for all selected regions
 */
export async function getActiveCountryConfigs(): Promise<DynamicCountryConfig[]> {
  const settings = await getSettings();
  return getMultipleCountryConfigs(settings.regions);
}

/**
 * Get merged keywords from all active regions
 * Used for relevance scoring across all regions
 */
export async function getActiveKeywords(): Promise<string[]> {
  const configs = await getActiveCountryConfigs();
  return mergeKeywords(configs);
}

/**
 * Get merged cities from all active regions
 * Used for geocoding and location matching
 */
export async function getActiveCities(): Promise<string[]> {
  const configs = await getActiveCountryConfigs();
  return mergeCities(configs);
}

// ============================================================================
// LEGACY: Static fallback config for synchronous contexts
// ============================================================================

// Default fallback configuration (use getActiveCountryConfigs() instead)
export const DEFAULT_COUNTRY_CONFIG: CountryConfig = {
  name: 'Middle East',
  code: 'me',
  languages: ['en', 'he'],
  searchLanguages: ['en', 'he'],
  cities: [
    'Tel Aviv',
    'Jerusalem',
    'Beirut',
    'Cairo',
    'Dubai',
    'Riyadh',
    'Tehran',
    'Baghdad',
  ],
  categories: ['news', 'events', 'tech', 'social', 'weather'],
  keywords: [
    'middle east', 'israel', 'lebanon', 'egypt', 'saudi arabia', 'iran',
    'gaza', 'west bank', 'syria', 'jordan', 'uae', 'dubai',
  ],
};

// Legacy alias (use getActiveCountryConfigs() instead)
export const COUNTRY_CONFIG = DEFAULT_COUNTRY_CONFIG;

// ============================================================================
// SEARCH SETTINGS (configurable via env vars)
// ============================================================================

const parseIntEnv = (key: string, defaultValue: number): number => {
  const value = parseInt(process.env[key] || String(defaultValue), 10);
  return isNaN(value) || value <= 0 ? defaultValue : value;
};

export const SEARCH_SETTINGS = {
  maxQueries: parseIntEnv('MAX_SEARCH_QUERIES', 20),
  maxUrlsToScrape: parseIntEnv('MAX_URLS_TO_SCRAPE', 100),
  maxConcurrentSearches: parseIntEnv('MAX_CONCURRENT_SEARCHES', 5),
  maxConcurrentScrapes: parseIntEnv('MAX_CONCURRENT_SCRAPES', 3),
  scrapeDelayMs: parseIntEnv('SCRAPE_DELAY_MS', 500),
  contentTokenLimit: parseIntEnv('CONTENT_TOKEN_LIMIT', 2000),
};

// ============================================================================
// LEGACY: Source config (kept for compatibility during transition)
// ============================================================================

export const SOURCES: SourceConfig[] = [
  {
    name: 'Search',
    type: 'search',
    url: '', // Not needed - search is dynamic
    lens: 'Headlines',
    trustScore: 0.8,
  },
];

// Time windows
export const TIME_WINDOWS = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
} as const;

// ============================================================================
// MOOD & TENSION CALCULATION WEIGHTS
// ============================================================================

/**
 * Weights for calculating Tension Index from emotion distribution
 * Negative emotions increase tension, positive emotions decrease it
 */
export const EMOTION_WEIGHTS = {
  // Negative emotions (increase tension)
  negative: {
    anger: 1.0,
    anxiety: 1.0,
    sadness: 0.7,
    cynicism: 0.4,
  },
  // Positive emotions (decrease tension)
  positive: {
    resilience: 0.5,
    hope: 0.7,
    excitement: 0.3,
  },
  // How much positive emotions reduce the negative contribution
  positiveReductionFactor: 0.5,
} as const;

// ============================================================================
// CLUSTERING CONFIGURATION
// ============================================================================

/**
 * Settings for topic clustering algorithm
 */
export const CLUSTERING_CONFIG = {
  /** Minimum cosine similarity to group items together (0-1) */
  similarityThreshold: 0.25,
  /** Maximum number of topics to return */
  maxTopics: 12,
  /** Minimum items required to form a cluster */
  minClusterSize: 2,
  /** Number of keywords to extract per topic */
  keywordsPerTopic: 5,
  /** Maximum receipts (evidence items) per topic */
  receiptsPerTopic: 5,
} as const;

// Emotion keywords for deterministic scoring (universal, not region-specific)
// Works across all regions: USA, Germany, Israel, etc.
export const EMOTION_KEYWORDS: Record<string, string[]> = {
  anger: [
    'angry', 'furious', 'outrage', 'rage', 'hate', 'disgusting', 'unacceptable',
    'infuriating', 'livid', 'enraged', 'hostile', 'bitter', 'protest', 'riot',
    'condemn', 'denounce', 'fury', 'wrath', 'outraged',
  ],
  anxiety: [
    'worried', 'anxious', 'fear', 'scared', 'threat', 'danger', 'warning', 'alert',
    'crisis', 'emergency', 'concern', 'uncertain', 'risk', 'tension', 'volatile',
    'unstable', 'alarming', 'concerning', 'troubling', 'nervous',
  ],
  sadness: [
    'sad', 'tragic', 'death', 'killed', 'victim', 'mourn', 'grief', 'loss', 'devastated',
    'heartbreaking', 'mourning', 'sorrow', 'painful', 'funeral', 'tragedy',
    'disaster', 'casualties', 'suffering',
  ],
  resilience: [
    'strong', 'resilient', 'united', 'together', 'fight', 'defend', 'brave', 'hero',
    'courage', 'solidarity', 'endure', 'persevere', 'overcome', 'survive',
    'determined', 'steadfast', 'unwavering',
  ],
  hope: [
    'hope', 'peace', 'progress', 'improve', 'better', 'optimistic', 'breakthrough',
    'promising', 'recovery', 'rebuild', 'healing', 'resolution', 'agreement',
    'deal', 'success', 'positive', 'growth',
  ],
  excitement: [
    'exciting', 'amazing', 'great', 'success', 'win', 'celebrate', 'achievement',
    'victory', 'triumph', 'historic', 'milestone', 'breakthrough', 'incredible',
    'remarkable', 'stunning', 'impressive',
  ],
  cynicism: [
    'lol', 'lmao', 'yeah right', 'sure', 'typical', 'surprise', 'expected', 'joke',
    'as usual', 'nothing new', 'of course', 'predictable', 'unsurprising',
    'ironic', 'sarcastic',
  ],
  neutral: [],
};

// Fetch settings
export const FETCH_TIMEOUT_MS = (() => {
  const value = parseInt(process.env.FETCH_TIMEOUT_MS || '10000', 10);
  return isNaN(value) || value <= 0 ? 10000 : value;
})();

export const LLM_CACHE_TTL_HOURS = (() => {
  const value = parseInt(process.env.LLM_CACHE_TTL_HOURS || '4', 10);
  return isNaN(value) || value <= 0 ? 4 : value;
})();
