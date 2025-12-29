import { NormalizedItem, Topic, Receipt, EmotionDistribution } from '@/types';
import { generateId, cosineSimilarity, recencyWeight, capEngagement } from '@/lib/utils';
import { scoreItemEmotions, aggregateEmotions } from '@/lib/mood';
import { CLUSTERING_CONFIG } from '@/lib/config';

// Stop words to exclude from keywords (English + Hebrew common words)
// Hebrew words use actual Unicode characters (U+0590-U+05FF range)
const ENGLISH_STOP_WORDS = [
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of',
  'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
  'it', 'its', 'he', 'she', 'they', 'we', 'you', 'who', 'what', 'where',
  'when', 'why', 'how', 'all', 'each', 'every', 'both', 'few', 'more',
  'most', 'other', 'some', 'such', 'no', 'not', 'only', 'same', 'so',
  'than', 'too', 'very', 'just', 'also', 'now', 'new', 'said', 'says',
  'according', 'report', 'reports', 'reported', 'after', 'before',
];

// Hebrew stop words - common prepositions, pronouns, and particles
// These are actual Hebrew Unicode characters
const HEBREW_STOP_WORDS = [
  'של', 'את', 'על', 'עם', 'אל', 'מן', 'לא', 'הוא', 'היא', 'הם', 'הן',
  'אני', 'אתה', 'זה', 'זו', 'אלה', 'כל', 'גם', 'רק', 'כי',
  'אם', 'או', 'אבל', 'עד', 'כן', 'לו', 'לי', 'לך', 'להם', 'בו',
  'ב', 'ל', 'מ', 'ה', 'ו', 'כ', 'ש', // Single-letter prefixes
];

// Normalize Hebrew text for consistent comparison
// Removes diacritics (niqqud) and normalizes final letters
function normalizeHebrew(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0591-\u05C7]/g, '') // Remove Hebrew diacritics (niqqud, cantillation)
    .normalize('NFC')
    .replace(/ך/g, 'כ') // Final kaf -> regular kaf
    .replace(/ם/g, 'מ') // Final mem -> regular mem
    .replace(/ן/g, 'נ') // Final nun -> regular nun
    .replace(/ף/g, 'פ') // Final pe -> regular pe
    .replace(/ץ/g, 'צ'); // Final tsade -> regular tsade
}

// Create normalized stop words set for efficient lookup
const STOP_WORDS = new Set([
  ...ENGLISH_STOP_WORDS,
  ...HEBREW_STOP_WORDS.map(normalizeHebrew),
]);

/**
 * Check if a term is a stop word (handles Hebrew normalization)
 */
function isStopWord(term: string): boolean {
  // Check English (lowercase)
  if (STOP_WORDS.has(term.toLowerCase())) {
    return true;
  }
  // Check Hebrew (normalized)
  if (/[\u0590-\u05FF]/.test(term)) {
    return STOP_WORDS.has(normalizeHebrew(term));
  }
  return false;
}

interface TermFrequency {
  [term: string]: number;
}

interface DocumentVector {
  item: NormalizedItem;
  vector: number[];
  terms: string[];
}

/**
 * Tokenize and extract terms from text
 * Handles both English and Hebrew text with proper Unicode support
 */
function extractTerms(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // Keep letters, numbers, whitespace
    .split(/\s+/)
    .filter((term) => term.length > 1 && !isStopWord(term)); // Allow 2-char Hebrew words
}

/**
 * Calculate term frequency for a document
 */
function calculateTF(text: string): TermFrequency {
  const terms = extractTerms(text);
  const tf: TermFrequency = {};

  for (const term of terms) {
    tf[term] = (tf[term] || 0) + 1;
  }

  // Normalize by document length
  const maxFreq = Math.max(...Object.values(tf), 1);
  for (const term in tf) {
    tf[term] = tf[term] / maxFreq;
  }

  return tf;
}

/**
 * Calculate IDF scores for all terms across documents
 */
function calculateIDF(documents: TermFrequency[]): TermFrequency {
  const docCount = documents.length;
  const termDocCount: TermFrequency = {};

  // Count documents containing each term
  for (const doc of documents) {
    for (const term of Object.keys(doc)) {
      termDocCount[term] = (termDocCount[term] || 0) + 1;
    }
  }

  // Calculate IDF
  const idf: TermFrequency = {};
  for (const term in termDocCount) {
    idf[term] = Math.log(docCount / (termDocCount[term] + 1)) + 1;
  }

  return idf;
}

/**
 * Create TF-IDF vectors for documents
 */
function createTFIDFVectors(items: NormalizedItem[]): DocumentVector[] {
  const documents = items.map((item) => {
    const text = `${item.title} ${item.text || ''}`;
    return calculateTF(text);
  });

  const idf = calculateIDF(documents);
  const allTerms = Object.keys(idf).sort();

  return items.map((item, i) => {
    const tf = documents[i];
    const vector = allTerms.map((term) => (tf[term] || 0) * (idf[term] || 0));

    return {
      item,
      vector,
      terms: allTerms,
    };
  });
}

/**
 * Get top keywords for a cluster
 */
function getTopKeywords(vectors: DocumentVector[], n: number = 5): string[] {
  const termScores: TermFrequency = {};

  for (const doc of vectors) {
    for (let i = 0; i < doc.terms.length; i++) {
      const term = doc.terms[i];
      const score = doc.vector[i];
      termScores[term] = (termScores[term] || 0) + score;
    }
  }

  // Sort by score and return top N
  return Object.entries(termScores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([term]) => term);
}

/**
 * Cluster items by similarity
 */
function clusterBySimilarity(
  vectors: DocumentVector[],
  similarityThreshold: number = 0.3
): DocumentVector[][] {
  const clusters: DocumentVector[][] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < vectors.length; i++) {
    if (assigned.has(i)) continue;

    const cluster: DocumentVector[] = [vectors[i]];
    assigned.add(i);

    // Find similar items
    for (let j = i + 1; j < vectors.length; j++) {
      if (assigned.has(j)) continue;

      const similarity = cosineSimilarity(vectors[i].vector, vectors[j].vector);
      if (similarity >= similarityThreshold) {
        cluster.push(vectors[j]);
        assigned.add(j);
      }
    }

    clusters.push(cluster);
  }

  return clusters;
}

/**
 * Calculate cluster weight (importance)
 */
function calculateClusterWeight(items: NormalizedItem[]): number {
  let weight = 0;

  for (const item of items) {
    const recency = recencyWeight(item.createdAt);
    const engagement = Math.log10(capEngagement(item.engagement) + 2);
    const relevance = item.relevanceScore ?? 0.5;

    weight += recency * engagement * relevance;
  }

  return weight;
}

/**
 * Convert items to receipts
 */
function itemsToReceipts(items: NormalizedItem[], max: number = 5): Receipt[] {
  // Sort by engagement and take top N
  const sorted = [...items]
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, max);

  return sorted.map((item) => ({
    id: item.id,
    title: item.title,
    snippet: item.text || '',
    url: item.url,
    source: item.context, // Feed name / context
    sourceType: item.source, // Source type (search, events, etc.)
    lens: item.lens, // Content category (Headlines, Weather, Tech, etc.)
    language: item.language,
    engagement: item.engagement,
    createdAt: item.createdAt,
    location: item.location,
    faviconUrl: item.faviconUrl,
    // Event-specific fields
    imageUrl: item.imageUrl,
    eventType: item.eventType,
    eventDate: item.eventDate,
    venue: item.venue,
    moodScore: item.moodScore,
  }));
}

/**
 * Generate a keyword-based title for a topic (fallback when no LLM)
 */
function generateKeywordTitle(keywords: string[]): string {
  // Take top 3 keywords and capitalize
  return keywords
    .slice(0, 3)
    .map((k) => k.charAt(0).toUpperCase() + k.slice(1))
    .join(' / ');
}

/**
 * Cluster items into topics
 * Uses CLUSTERING_CONFIG from config for tunable parameters
 */
export function clusterIntoTopics(
  items: NormalizedItem[],
  maxTopics: number = CLUSTERING_CONFIG.maxTopics,
  minClusterSize: number = CLUSTERING_CONFIG.minClusterSize
): Topic[] {
  const { similarityThreshold, keywordsPerTopic, receiptsPerTopic } = CLUSTERING_CONFIG;

  // Filter out duplicates
  const uniqueItems = items.filter((item) => !item.duplicateOf);

  if (uniqueItems.length === 0) {
    return [];
  }

  // Create TF-IDF vectors
  const vectors = createTFIDFVectors(uniqueItems);

  // Cluster by similarity
  const rawClusters = clusterBySimilarity(vectors, similarityThreshold);

  // Filter out small clusters and calculate weights
  const clusters = rawClusters
    .filter((c) => c.length >= minClusterSize)
    .map((cluster) => {
      const clusterItems = cluster.map((v) => v.item);
      const weight = calculateClusterWeight(clusterItems);
      const keywords = getTopKeywords(cluster, keywordsPerTopic);
      const emotions = aggregateEmotions(clusterItems);

      return {
        items: clusterItems,
        vectors: cluster,
        weight,
        keywords,
        emotions,
      };
    })
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxTopics);

  // Convert to Topic objects
  return clusters.map((cluster, index) => ({
    id: generateId(`topic:${cluster.keywords.join(':')}`),
    title: generateKeywordTitle(cluster.keywords),
    keywords: cluster.keywords,
    whyTrending: 'Analyzing...', // Will be filled by LLM
    emotionMix: cluster.emotions,
    weight: cluster.weight,
    delta: 0, // Will be calculated from snapshot
    receipts: itemsToReceipts(cluster.items, receiptsPerTopic),
  }));
}

/**
 * Find items that don't belong to any cluster (miscellaneous)
 */
export function findUnclusteredItems(
  items: NormalizedItem[],
  topics: Topic[],
  max: number = 10
): NormalizedItem[] {
  const clusteredIds = new Set<string>();

  for (const topic of topics) {
    for (const receipt of topic.receipts) {
      clusteredIds.add(receipt.id);
    }
  }

  return items
    .filter((item) => !item.duplicateOf && !clusteredIds.has(item.id))
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, max);
}
