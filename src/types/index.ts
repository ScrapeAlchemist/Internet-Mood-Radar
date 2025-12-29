// Geographic location
export interface Location {
  name: string; // Place name (e.g., "New York", "Tokyo")
  lat: number; // Latitude
  lng: number; // Longitude
  country?: string; // Country name (e.g., "USA", "Japan")
  region?: string; // Region name (e.g., "Middle East", "Europe")
}

// Event types for cultural events
export type EventType =
  | 'concert'
  | 'theater'
  | 'sports'
  | 'festival'
  | 'protest'
  | 'exhibition'
  | 'nightlife'
  | 'community'
  | 'other';

// Normalized item from any source
export interface NormalizedItem {
  id: string; // Stable hash
  source: 'rss' | 'reddit' | 'hn' | 'telegram' | 'events' | 'search';
  lens: 'Headlines' | 'Conversation' | 'Weather' | 'Tech' | 'Events';
  language: 'he' | 'en' | 'ru' | 'other';
  title: string;
  text: string | null;
  createdAt: Date;
  url: string;
  engagement: number; // score/comments if available
  context: string; // feed name / subreddit / thread / channel
  relevanceScore?: number;
  duplicateOf?: string | null;
  location?: Location; // Geographic location extracted from content
  faviconUrl?: string; // Website favicon URL
  // Event-specific fields (only present for events source)
  imageUrl?: string; // Main image from the article
  eventType?: EventType; // Category of event
  eventDate?: Date; // When the event occurs
  eventEndDate?: Date; // For multi-day events
  venue?: string; // Event venue/location name
  moodScore?: number; // 0-100 event mood score (excitement level)
}

// Emotion taxonomy
export type Emotion =
  | 'anger'
  | 'anxiety'
  | 'sadness'
  | 'resilience'
  | 'hope'
  | 'excitement'
  | 'cynicism'
  | 'neutral';

// Emotion distribution (sums to 1.0)
export type EmotionDistribution = Record<Emotion, number>;

// Emotion with delta from yesterday
export interface EmotionWithDelta {
  emotion: Emotion;
  value: number;
  delta: number; // positive = increased, negative = decreased
}

// Topic cluster
export interface Topic {
  id: string;
  title: string; // English, ≤6 words (LLM generated or keyword-based)
  keywords: string[];
  whyTrending: string; // English, 1-2 sentences (LLM generated)
  emotionMix: EmotionDistribution;
  weight: number;
  delta: number; // change vs yesterday
  receipts: Receipt[];
  locations?: Location[]; // Aggregated locations from receipts
}

// Receipt (evidence item)
export interface Receipt {
  id: string;
  title: string;
  snippet: string;
  url: string;
  source: string;
  sourceType?: 'rss' | 'reddit' | 'hn' | 'telegram' | 'events' | 'search'; // Original source type
  lens?: 'Headlines' | 'Conversation' | 'Weather' | 'Tech' | 'Events'; // Content category
  language: string;
  engagement: number;
  createdAt: Date;
  location?: Location; // Geographic location
  faviconUrl?: string; // Website favicon URL
  // Event-specific fields
  imageUrl?: string;
  eventType?: EventType;
  eventDate?: Date;
  venue?: string;
  moodScore?: number; // 0-100 event mood score
}

// Country-level mood data for map visualization
export interface CountryMood {
  country: string; // Country name (e.g., "USA", "Germany")
  tensionIndex: number; // 0-100 tension for this country
  itemCount: number; // Number of items from this country
  emotions: EmotionDistribution; // Emotion breakdown for this country
  summary?: string; // LLM-generated summary of news from this country
}

// Pulse response
export interface PulseResponse {
  tensionIndex: number; // 0-100
  tensionDelta: number;
  emotions: EmotionWithDelta[];
  overallSummary: string; // English, 1-3 sentences
  topics: Topic[];
  receiptsFeed: Receipt[]; // Top 20 for map markers
  allReceipts: Receipt[]; // All receipts for scrollable list
  errors: NonFatalError[];
  fetchedAt: Date;
  window: '1h' | '6h' | '24h';
  regions: string[]; // Active regions for multi-country support
  countryMoods: CountryMood[]; // Mood data per country (for map coloring)
}

// Non-fatal error
export interface NonFatalError {
  source: string;
  message: string;
  timestamp: Date;
}

// Source adapter config (legacy - kept for compatibility)
export interface SourceConfig {
  name: string;
  type: 'rss' | 'reddit' | 'hn' | 'telegram' | 'events' | 'search';
  url: string;
  lens: NormalizedItem['lens'];
  trustScore: number; // 0-1, higher = more trusted
}

// Country configuration for search-based collection
export interface CountryConfig {
  name: string; // Country name (e.g., "USA", "Germany")
  code: string; // ISO country code (e.g., "us", "de")
  languages: ('he' | 'en' | 'ru' | 'other')[]; // Content languages
  searchLanguages: string[]; // Google language codes (e.g., ["en"], ["de", "en"])
  cities: string[]; // Major cities for geo-grouping
  categories: ContentCategory[]; // What types of content to search
  keywords: string[]; // Country-specific relevance keywords
}

// Content categories for search
export type ContentCategory = 'news' | 'events' | 'tech' | 'social' | 'weather';

// Search query with metadata
export interface SearchQuery {
  query: string;
  category: ContentCategory;
  language: string; // Google language code
}

// Selected URL from LLM
export interface SelectedUrl {
  url: string;
  title: string;
  snippet: string;
  category: ContentCategory;
}

// Extracted content from scraped page
export interface ExtractedContent {
  title: string;
  summary: string; // 1-2 sentences
  category: ContentCategory;
  location?: string; // City/region if mentioned
  eventDate?: Date; // For events
  sentiment: 'positive' | 'negative' | 'neutral';
  moodScore: number; // 0-100: 0=very negative, 50=neutral, 100=very positive
  engagement: number; // Extracted engagement metrics (upvotes, likes, comments count)
  imageUrl?: string;
  sourceUrl: string;
  isRelevant: boolean; // LLM determines if content is relevant to the region
  articleUrl?: string; // LLM-extracted specific article/post URL
  publishedAt?: Date; // LLM-extracted publication date
}

// Events configuration (legacy - kept for compatibility)
export interface EventsConfig {
  region: string; // e.g., "New York", "California"
  country: string; // e.g., "USA"
  categories: EventType[]; // Which categories to search
  language: 'he' | 'en'; // Primary search language
}

// Scraped event from LLM extraction
export interface ScrapedEvent {
  title: string;
  description: string;
  imageUrl?: string;
  eventType: EventType;
  eventDate?: Date;
  eventEndDate?: Date;
  venue?: string;
  moodScore: number; // 0-100
  sourceUrl: string;
}

// Snapshot for daily storage
export interface DailySnapshot {
  date: string; // YYYY-MM-DD
  tensionIndex: number;
  emotions: EmotionDistribution;
  topTopics: {
    keywords: string[];
    receiptIds: string[];
  }[];
  llmOutputs: Record<string, string>;
}

// LLM grounding context
export interface GroundingContext {
  topicKeywords: string[];
  aggregates: {
    itemCount: number;
    avgEngagement: number;
    emotionMix: EmotionDistribution;
  };
  receipts: {
    title: string;
    snippet: string;
    translatedSnippet?: string; // For Hebrew/Russian
    url: string;
  }[];
}

// Fetch result from adapter
export interface FetchResult {
  items: NormalizedItem[];
  errors: NonFatalError[];
  sourceName: string;
}
