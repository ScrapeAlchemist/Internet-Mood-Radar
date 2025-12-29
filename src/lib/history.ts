import { prisma } from '@/lib/db';
import { PulseResponse, NormalizedItem, EmotionDistribution, Topic } from '@/types';
import { normalizeUrl } from '@/lib/utils/url';
import { DisplayTimeFrame, TIME_FRAME_MS } from '@/lib/settings';

export interface HistoricalPulseData {
  id: string;
  timestamp: Date;
  window: string;
  tensionIndex: number;
  emotions: EmotionDistribution;
  topicCount: number;
  itemCount: number;
  topTopics: { title: string; keywords: string[] }[];
  overallSummary: string;
}

export interface TensionTrend {
  timestamp: Date;
  tensionIndex: number;
  window: string;
}

const URL_DEDUP_DAYS = 7; // Skip URLs scraped in last 7 days

// URL normalization is now handled by @/lib/utils/url

/**
 * Get URLs that were already scraped recently
 * Returns a Set of normalized URLs for fast lookup
 */
export async function getRecentlyScrapedUrls(
  daysBack: number = URL_DEDUP_DAYS
): Promise<Set<string>> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const existing = await prisma.historicalItem.findMany({
    where: {
      fetchedAt: { gte: cutoff },
    },
    select: { url: true },
  });

  return new Set(existing.map(item => normalizeUrl(item.url)));
}

/**
 * Save pulse response to historical database
 */
export async function saveToHistory(
  response: PulseResponse,
  itemCount: number
): Promise<void> {
  try {
    // Save pulse snapshot
    await prisma.historicalPulse.create({
      data: {
        window: response.window,
        tensionIndex: response.tensionIndex,
        emotions: JSON.stringify(
          response.emotions.reduce((acc, e) => {
            acc[e.emotion] = e.value;
            return acc;
          }, {} as Record<string, number>)
        ),
        topicCount: response.topics.length,
        itemCount,
        topTopics: JSON.stringify(
          response.topics.slice(0, 5).map((t) => ({
            title: t.title,
            keywords: t.keywords.slice(0, 5),
          }))
        ),
        overallSummary: response.overallSummary,
      },
    });

    console.log('[HISTORY] Saved pulse snapshot to history');
  } catch (error) {
    console.error('[HISTORY] Failed to save pulse snapshot:', error);
  }
}

/**
 * Save items to historical database (upsert to avoid duplicates)
 */
export async function saveItemsToHistory(items: NormalizedItem[]): Promise<number> {
  let savedCount = 0;

  for (const item of items) {
    try {
      await prisma.historicalItem.upsert({
        where: { id: item.id },
        update: {
          engagement: item.engagement,
          relevanceScore: item.relevanceScore || 0,
          country: item.location?.country || null,
          locationName: item.location?.name || null,
          lat: item.location?.lat ?? null,
          lng: item.location?.lng ?? null,
        },
        create: {
          id: item.id,
          source: item.source,
          lens: item.lens,
          language: item.language,
          title: item.title,
          text: item.text,
          url: item.url,
          engagement: item.engagement,
          context: item.context,
          relevanceScore: item.relevanceScore || 0,
          country: item.location?.country || null,
          locationName: item.location?.name || null,
          lat: item.location?.lat ?? null,
          lng: item.location?.lng ?? null,
          createdAt: item.createdAt,
        },
      });
      savedCount++;
    } catch (error) {
      // Log first few errors to help diagnose issues
      if (savedCount === 0 && items.indexOf(item) < 3) {
        console.error(`[HISTORY] Error saving item ${item.id}:`, error);
      }
    }
  }

  console.log(`[HISTORY] Saved ${savedCount}/${items.length} items to history`);
  return savedCount;
}

/**
 * Get tension trend over time
 */
export async function getTensionTrend(
  hours: number = 24,
  window?: string
): Promise<TensionTrend[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const pulses = await prisma.historicalPulse.findMany({
    where: {
      timestamp: { gte: since },
      ...(window ? { window } : {}),
    },
    orderBy: { timestamp: 'asc' },
    select: {
      timestamp: true,
      tensionIndex: true,
      window: true,
    },
  });

  return pulses;
}

/**
 * Get historical pulses
 */
export async function getHistoricalPulses(
  hours: number = 24,
  limit: number = 50
): Promise<HistoricalPulseData[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const pulses = await prisma.historicalPulse.findMany({
    where: {
      timestamp: { gte: since },
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });

  return pulses.map((p: typeof pulses[number]) => ({
    id: p.id,
    timestamp: p.timestamp,
    window: p.window,
    tensionIndex: p.tensionIndex,
    emotions: JSON.parse(p.emotions) as EmotionDistribution,
    topicCount: p.topicCount,
    itemCount: p.itemCount,
    topTopics: JSON.parse(p.topTopics) as { title: string; keywords: string[] }[],
    overallSummary: p.overallSummary,
  }));
}

/**
 * Get historical items count
 */
export async function getHistoricalItemCount(): Promise<number> {
  return prisma.historicalItem.count();
}

/**
 * Get historical items by date range
 */
export async function getHistoricalItems(
  since: Date,
  until?: Date,
  limit: number = 100
): Promise<{
  id: string;
  source: string;
  title: string;
  url: string;
  createdAt: Date;
  engagement: number;
}[]> {
  return prisma.historicalItem.findMany({
    where: {
      createdAt: {
        gte: since,
        ...(until ? { lte: until } : {}),
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      source: true,
      title: true,
      url: true,
      createdAt: true,
      engagement: true,
    },
  });
}

/**
 * Get statistics about historical data
 */
export async function getHistoryStats(): Promise<{
  totalPulses: number;
  totalItems: number;
  oldestPulse: Date | null;
  newestPulse: Date | null;
  avgTension: number;
}> {
  const [pulseCount, itemCount, oldestPulse, newestPulse, avgResult] = await Promise.all([
    prisma.historicalPulse.count(),
    prisma.historicalItem.count(),
    prisma.historicalPulse.findFirst({
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
    }),
    prisma.historicalPulse.findFirst({
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true },
    }),
    prisma.historicalPulse.aggregate({
      _avg: { tensionIndex: true },
    }),
  ]);

  return {
    totalPulses: pulseCount,
    totalItems: itemCount,
    oldestPulse: oldestPulse?.timestamp || null,
    newestPulse: newestPulse?.timestamp || null,
    avgTension: avgResult._avg.tensionIndex || 0,
  };
}

/**
 * Clean up old historical data (keep last N days)
 */
export async function cleanupOldHistory(daysToKeep: number = 30): Promise<{
  pulsesDeleted: number;
  itemsDeleted: number;
}> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysToKeep);

  const [pulsesResult, itemsResult] = await Promise.all([
    prisma.historicalPulse.deleteMany({
      where: { timestamp: { lt: cutoff } },
    }),
    prisma.historicalItem.deleteMany({
      where: { fetchedAt: { lt: cutoff } },
    }),
  ]);

  return {
    pulsesDeleted: pulsesResult.count,
    itemsDeleted: itemsResult.count,
  };
}

/**
 * Clear ALL historical data (pulses, items, and LLM cache)
 */
export async function clearAllHistory(): Promise<{
  pulsesDeleted: number;
  itemsDeleted: number;
  cacheDeleted: number;
}> {
  const [pulsesResult, itemsResult, cacheResult] = await Promise.all([
    prisma.historicalPulse.deleteMany({}),
    prisma.historicalItem.deleteMany({}),
    prisma.lLMCache.deleteMany({}),
  ]);

  console.log(`[HISTORY] Cleared all data: ${pulsesResult.count} pulses, ${itemsResult.count} items, ${cacheResult.count} cache entries`);

  return {
    pulsesDeleted: pulsesResult.count,
    itemsDeleted: itemsResult.count,
    cacheDeleted: cacheResult.count,
  };
}

// ============================================================================
// NEW: Aggregation functions for history dashboard
// ============================================================================

export interface SourceBreakdown {
  source: string;
  count: number;
  percentage: number;
}

export interface CountryBreakdown {
  country: string;
  count: number;
  percentage: number;
}

export interface TopicAggregate {
  title: string;
  keywords: string[];
  count: number;
}

export interface HistoricalItemWithDetails {
  id: string;
  source: string;
  lens: string;
  language: string;
  title: string;
  text: string | null;
  url: string;
  engagement: number;
  context: string;
  createdAt: Date;
  fetchedAt: Date;
}

/**
 * Get emotion averages from historical pulses
 */
export async function getEmotionAverages(hours: number = 24): Promise<Record<string, number>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const pulses = await prisma.historicalPulse.findMany({
    where: { timestamp: { gte: since } },
    select: { emotions: true },
  });

  if (pulses.length === 0) {
    return {};
  }

  // Aggregate emotions
  const emotionTotals: Record<string, number> = {};
  let count = 0;

  for (const pulse of pulses) {
    const emotions = JSON.parse(pulse.emotions) as Record<string, number>;
    for (const [emotion, value] of Object.entries(emotions)) {
      emotionTotals[emotion] = (emotionTotals[emotion] || 0) + value;
    }
    count++;
  }

  // Calculate averages
  const averages: Record<string, number> = {};
  for (const [emotion, total] of Object.entries(emotionTotals)) {
    averages[emotion] = total / count;
  }

  return averages;
}

/**
 * Get source breakdown from historical items
 */
export async function getSourceBreakdown(hours: number = 24): Promise<SourceBreakdown[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const items = await prisma.historicalItem.groupBy({
    by: ['source'],
    where: { fetchedAt: { gte: since } },
    _count: { source: true },
    orderBy: { _count: { source: 'desc' } },
  });

  const total = items.reduce((sum, item) => sum + item._count.source, 0);

  return items.map(item => ({
    source: item.source,
    count: item._count.source,
    percentage: total > 0 ? (item._count.source / total) * 100 : 0,
  }));
}

/**
 * Get country breakdown from historical items using the country field
 */
export async function getCountryBreakdown(hours: number = 24): Promise<CountryBreakdown[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Use raw SQL for reliable groupBy with nullable field
  const result = await prisma.$queryRaw<{ country: string | null; count: bigint }[]>`
    SELECT country, COUNT(*) as count
    FROM HistoricalItem
    WHERE fetchedAt >= ${since.toISOString()}
    GROUP BY country
    ORDER BY count DESC
  `;

  const total = result.reduce((sum, item) => sum + Number(item.count), 0);

  return result.map(item => ({
    country: item.country || 'Unknown',
    count: Number(item.count),
    percentage: total > 0 ? (Number(item.count) / total) * 100 : 0,
  }));
}

/**
 * Get top topics aggregated from historical pulses
 */
export async function getTopTopics(hours: number = 24, limit: number = 10): Promise<TopicAggregate[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const pulses = await prisma.historicalPulse.findMany({
    where: { timestamp: { gte: since } },
    select: { topTopics: true },
    orderBy: { timestamp: 'desc' },
  });

  // Aggregate topics by title
  const topicMap = new Map<string, { keywords: string[]; count: number }>();

  for (const pulse of pulses) {
    const topics = JSON.parse(pulse.topTopics) as { title: string; keywords: string[] }[];
    for (const topic of topics) {
      const existing = topicMap.get(topic.title);
      if (existing) {
        existing.count++;
        // Merge keywords (keep unique)
        const keywordSet = new Set([...existing.keywords, ...topic.keywords]);
        existing.keywords = Array.from(keywordSet).slice(0, 5);
      } else {
        topicMap.set(topic.title, {
          keywords: topic.keywords.slice(0, 5),
          count: 1,
        });
      }
    }
  }

  // Convert to array and sort by count
  return Array.from(topicMap.entries())
    .map(([title, data]) => ({
      title,
      keywords: data.keywords,
      count: data.count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// Patterns for invalid/error content that should be filtered out
const INVALID_TITLE_PATTERNS = [
  /^untitled$/i,
  /^no\s*(posts?|articles?|content|data)\s*(available|found)?$/i,
  /^(page|event|content)\s*(not\s*found|error|unavailable)$/i,
  /^404/i,
  /^error/i,
  /^whoops/i,
  /^sorry/i,
  /^access\s*denied/i,
  /^forbidden/i,
  /^loading/i,
];

const INVALID_TEXT_PATTERNS = [
  'could not be found',
  'not found',
  'no posts available',
  'no articles',
  'page does not exist',
  'error occurred',
  'currently no news',
  'eventbrite related to',
];

function isValidItem(item: { title: string; text: string | null }): boolean {
  // Check title
  if (!item.title || INVALID_TITLE_PATTERNS.some(p => p.test(item.title.trim()))) {
    return false;
  }
  // Check text/summary
  if (item.text) {
    const lowerText = item.text.toLowerCase();
    if (INVALID_TEXT_PATTERNS.some(p => lowerText.includes(p))) {
      return false;
    }
  }
  return true;
}

/**
 * Get historical items with full details for the feed
 */
export async function getHistoricalItemsWithDetails(
  hours: number = 24,
  limit: number = 50
): Promise<HistoricalItemWithDetails[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  // Fetch more than needed to account for filtering
  const items = await prisma.historicalItem.findMany({
    where: { fetchedAt: { gte: since } },
    orderBy: { fetchedAt: 'desc' },
    take: limit * 2,
  });

  // Filter out invalid items and limit
  return items.filter(isValidItem).slice(0, limit);
}

// ============================================================================
// Time Frame Based Item Retrieval for Merge Feature
// ============================================================================

/**
 * Get historical items as NormalizedItems for merging with fresh data
 * Filters by display time frame setting
 */
export async function getHistoricalItemsByTimeFrame(
  timeFrame: DisplayTimeFrame
): Promise<NormalizedItem[]> {
  // Calculate cutoff date
  const cutoffMs = TIME_FRAME_MS[timeFrame];
  const since = cutoffMs === Infinity
    ? new Date(0) // Beginning of time for 'all'
    : new Date(Date.now() - cutoffMs);

  console.log(`[HISTORY] Loading historical items since ${since.toISOString()} (timeFrame: ${timeFrame})`);

  const items = await prisma.historicalItem.findMany({
    where: {
      createdAt: { gte: since },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`[HISTORY] Found ${items.length} historical items`);

  // Convert to NormalizedItem format
  // Use stored coordinates if available, otherwise exclude from map
  return items
    .filter(isValidItem)
    .map(item => {
      // Only include location if we have valid coordinates (not 0,0)
      const hasValidCoords = item.lat !== null && item.lng !== null &&
                             !(item.lat === 0 && item.lng === 0);
      const location = hasValidCoords && item.country
        ? {
            name: item.locationName || item.country,
            lat: item.lat!,
            lng: item.lng!,
            country: item.country,
          }
        : undefined;

      return {
        id: item.id,
        source: item.source as NormalizedItem['source'],
        lens: item.lens as NormalizedItem['lens'],
        language: item.language as NormalizedItem['language'],
        title: item.title,
        text: item.text,
        createdAt: item.createdAt,
        url: item.url,
        engagement: item.engagement,
        context: item.context,
        relevanceScore: item.relevanceScore,
        location,
      };
    });
}
