import { NormalizedItem, Emotion, EmotionDistribution, EmotionWithDelta, CountryMood } from '@/types';
import { EMOTION_KEYWORDS, EMOTION_WEIGHTS } from '@/lib/config';
import { recencyWeight, capEngagement } from '@/lib/utils';

/**
 * All emotion types
 */
export const EMOTIONS: Emotion[] = [
  'anger',
  'anxiety',
  'sadness',
  'resilience',
  'hope',
  'excitement',
  'cynicism',
  'neutral',
];

/**
 * Create an empty emotion distribution
 */
export function createEmptyDistribution(): EmotionDistribution {
  const dist: EmotionDistribution = {} as EmotionDistribution;
  for (const emotion of EMOTIONS) {
    dist[emotion] = 0;
  }
  return dist;
}

/**
 * Score emotions for a single item (deterministic)
 * Returns scores for each emotion based on keyword matching
 */
export function scoreItemEmotions(item: NormalizedItem): EmotionDistribution {
  const dist = createEmptyDistribution();
  const text = `${item.title} ${item.text || ''}`.toLowerCase();

  let totalMatches = 0;

  // Count keyword matches for each emotion
  for (const emotion of EMOTIONS) {
    if (emotion === 'neutral') continue;

    const keywords = EMOTION_KEYWORDS[emotion] || [];
    let matches = 0;

    for (const keyword of keywords) {
      if (text.includes(keyword.toLowerCase())) {
        matches++;
      }
    }

    dist[emotion] = matches;
    totalMatches += matches;
  }

  // If no emotional keywords found, mark as neutral
  if (totalMatches === 0) {
    dist.neutral = 1;
    return normalizeDistribution(dist);
  }

  return normalizeDistribution(dist);
}

/**
 * Normalize distribution so it sums to 1.0
 */
export function normalizeDistribution(dist: EmotionDistribution): EmotionDistribution {
  const sum = Object.values(dist).reduce((a, b) => a + b, 0);
  if (sum === 0) {
    const result = createEmptyDistribution();
    result.neutral = 1;
    return result;
  }

  const normalized = createEmptyDistribution();
  for (const emotion of EMOTIONS) {
    normalized[emotion] = dist[emotion] / sum;
  }
  return normalized;
}

/**
 * Calculate weighted average of emotion distributions
 */
export function aggregateEmotions(
  items: NormalizedItem[]
): EmotionDistribution {
  if (items.length === 0) {
    return normalizeDistribution(createEmptyDistribution());
  }

  const weighted = createEmptyDistribution();
  let totalWeight = 0;

  for (const item of items) {
    // Skip duplicates
    if (item.duplicateOf) continue;

    const itemEmotions = scoreItemEmotions(item);
    const recency = recencyWeight(item.createdAt);
    const engagement = capEngagement(item.engagement);
    const relevance = item.relevanceScore ?? 0.5;

    // Weight = recency * log(engagement + 1) * relevance
    const weight = recency * Math.log10(engagement + 2) * relevance;

    for (const emotion of EMOTIONS) {
      weighted[emotion] += itemEmotions[emotion] * weight;
    }
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return normalizeDistribution(createEmptyDistribution());
  }

  // Normalize
  for (const emotion of EMOTIONS) {
    weighted[emotion] /= totalWeight;
  }

  return normalizeDistribution(weighted);
}

/**
 * Calculate the Tension Index (0-100)
 * Higher tension = more negative/anxious content
 * Uses EMOTION_WEIGHTS from config for easy tuning
 */
export function calculateTensionIndex(emotions: EmotionDistribution): number {
  const { negative, positive, positiveReductionFactor } = EMOTION_WEIGHTS;

  // Negative emotions increase tension
  const negativeScore =
    emotions.anger * negative.anger +
    emotions.anxiety * negative.anxiety +
    emotions.sadness * negative.sadness +
    emotions.cynicism * negative.cynicism;

  // Positive emotions decrease tension
  const positiveScore =
    emotions.resilience * positive.resilience +
    emotions.hope * positive.hope +
    emotions.excitement * positive.excitement;

  // Base tension from negative emotions, reduced by positive
  const tension = Math.max(0, negativeScore - positiveScore * positiveReductionFactor);

  // Scale to 0-100
  return Math.min(100, Math.round(tension * 100));
}

/**
 * Calculate mood score for a single item (0-100)
 * 0 = very negative/tense, 100 = very positive/calm
 * This is the inverse of tension - higher = happier
 */
export function calculateItemMoodScore(item: NormalizedItem): number {
  const emotions = scoreItemEmotions(item);
  const tension = calculateTensionIndex(emotions);
  // Invert: 0 tension = 100 mood, 100 tension = 0 mood
  return 100 - tension;
}

/**
 * Calculate emotion deltas compared to yesterday
 */
export function calculateEmotionDeltas(
  current: EmotionDistribution,
  yesterday: EmotionDistribution | null
): EmotionWithDelta[] {
  return EMOTIONS.map((emotion) => ({
    emotion,
    value: current[emotion],
    delta: yesterday ? current[emotion] - yesterday[emotion] : 0,
  }));
}

/**
 * Get the dominant emotion
 */
export function getDominantEmotion(dist: EmotionDistribution): Emotion {
  let max: Emotion = 'neutral';
  let maxValue = 0;

  for (const emotion of EMOTIONS) {
    if (dist[emotion] > maxValue) {
      maxValue = dist[emotion];
      max = emotion;
    }
  }

  return max;
}

/**
 * Format emotion for display
 */
export function formatEmotion(emotion: Emotion): string {
  const labels: Record<Emotion, string> = {
    anger: 'Anger',
    anxiety: 'Anxiety / Tension',
    sadness: 'Sadness / Grief',
    resilience: 'Resilience / Determination',
    hope: 'Hope',
    excitement: 'Excitement',
    cynicism: 'Cynicism / Sarcasm',
    neutral: 'Neutral / Informational',
  };
  return labels[emotion];
}

/**
 * Country mood with items for summary generation
 */
export interface CountryMoodWithItems extends CountryMood {
  items: NormalizedItem[];
}

/**
 * Aggregate mood data per country from items with locations
 * Groups items by country, calculates emotions and tension for each
 * Returns items along with mood data for summary generation
 */
export function aggregateMoodByCountry(items: NormalizedItem[]): CountryMoodWithItems[] {
  // Group items by country
  const byCountry = new Map<string, NormalizedItem[]>();

  let withCountry = 0;
  let withoutCountry = 0;

  for (const item of items) {
    // Skip duplicates and items without country
    if (item.duplicateOf) continue;
    const country = item.location?.country;
    if (!country) {
      withoutCountry++;
      continue;
    }

    withCountry++;
    const existing = byCountry.get(country) || [];
    existing.push(item);
    byCountry.set(country, existing);
  }

  console.log(`[MOOD] Country aggregation: ${withCountry} items with country, ${withoutCountry} without country`);
  console.log(`[MOOD] Countries found: ${Array.from(byCountry.keys()).join(', ')}`);

  // Calculate mood for each country
  const countryMoods: CountryMoodWithItems[] = [];

  for (const [country, countryItems] of byCountry) {
    // Prefer LLM-provided moodScore, fall back to keyword-based scoring
    const itemsWithMood = countryItems.filter(item => item.moodScore !== undefined && item.moodScore !== null);

    let tensionIndex: number;
    if (itemsWithMood.length > 0) {
      // Use average of LLM moodScores (moodScore is 0-100 where 100=positive, so tension = 100 - moodScore)
      const avgMoodScore = itemsWithMood.reduce((sum, item) => sum + (item.moodScore || 50), 0) / itemsWithMood.length;
      tensionIndex = Math.round(100 - avgMoodScore);
    } else {
      // Fall back to keyword-based scoring
      const emotions = aggregateEmotions(countryItems);
      tensionIndex = calculateTensionIndex(emotions);
    }

    // Still calculate emotions for display purposes (using keywords as approximation)
    const emotions = aggregateEmotions(countryItems);

    countryMoods.push({
      country,
      tensionIndex,
      itemCount: countryItems.length,
      emotions,
      items: countryItems,
    });
  }

  // Sort by item count (most items first)
  countryMoods.sort((a, b) => b.itemCount - a.itemCount);

  console.log(`[MOOD] Country moods: ${countryMoods.map(m => `${m.country}(${m.itemCount})`).join(', ')}`);

  return countryMoods;
}
