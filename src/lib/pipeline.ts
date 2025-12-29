import { fetchAllSources } from '@/adapters';
import { deduplicateItems } from '@/lib/relevance';
import { aggregateEmotions, calculateTensionIndex, calculateEmotionDeltas, aggregateMoodByCountry, calculateItemMoodScore } from '@/lib/mood';
import { clusterIntoTopics, findUnclusteredItems } from '@/lib/clustering';
import { generateCountrySummary, getLLMStatus } from '@/lib/llm';
import { getDominantEmotion, formatEmotion, CountryMoodWithItems } from '@/lib/mood';
import {
  loadYesterdaySnapshot,
  calculateTensionDelta,
  applyTopicDeltas,
} from '@/lib/snapshot';
import { updateSourceHealth } from '@/lib/health';
import { saveToHistory, saveItemsToHistory, getHistoricalItemsByTimeFrame } from '@/lib/history';
import { startDebugRun, saveDebugStep, saveDebugSummary } from '@/lib/debug';
import { PulseResponse, NormalizedItem, Receipt, NonFatalError, Topic, Location } from '@/types';
import { TIME_WINDOWS } from '@/lib/config';
import { AppLanguage } from '@/lib/translations';
import { getSettings } from '@/lib/settings';
import { updateScanStatus } from '@/lib/scan-status';

export type TimeWindow = '1h' | '6h' | '24h';

export interface PipelineOptions {
  window?: TimeWindow;
  language?: AppLanguage;
}

/**
 * Main pipeline - runs on every page load
 */
export async function runPipeline(options: PipelineOptions = {}): Promise<PulseResponse> {
  const { window = '6h', language = 'en' } = options;
  const pipelineStart = Date.now();
  console.log('\n[PIPELINE] ══════════════════════════════════════════════════════');
  console.log(`[PIPELINE] Starting pipeline with window: ${window}`);
  console.log('[PIPELINE] ──────────────────────────────────────────────────────');

  // Initialize debug folder (only if DEBUG_PIPELINE=true)
  startDebugRun();

  const errors: NonFatalError[] = [];
  const fetchedAt = new Date();

  // Load settings
  const settings = await getSettings();
  const regions = settings.regions;
  const since = new Date(Date.now() - TIME_WINDOWS[window]);

  // Step 1: Fetch items (BrightData search + scrape, OpenAI extraction)
  // Progress is tracked per-region by SearchAdapter (0-50% range)
  console.log(`[PIPELINE] Step 1: Fetching items (since ${since.toISOString()})...`);
  const { items: rawItems, errors: fetchErrors } = await fetchAllSources(since);
  errors.push(...fetchErrors);
  await updateSourceHealth(fetchErrors);
  console.log(`[PIPELINE] Step 1 complete: ${rawItems.length} fresh items`);
  saveDebugStep('01-raw-items', rawItems);

  // Step 1b: Load historical items and merge with fresh items
  // Always load 1 month of historical data - client-side filtering handles display
  console.log(`[PIPELINE] Step 1b: Loading historical items (1 month)...`);
  updateScanStatus({ phase: 'processing', message: 'Loading historical data...', progress: 30 });
  const historicalItems = await getHistoricalItemsByTimeFrame('1m');
  console.log(`[PIPELINE] Step 1b: Loaded ${historicalItems.length} historical items`);

  // Merge fresh items with historical items (fresh items take priority in dedup)
  const mergedItems = [...rawItems, ...historicalItems];
  console.log(`[PIPELINE] Step 1b complete: ${mergedItems.length} total items (${rawItems.length} fresh + ${historicalItems.length} historical)`);
  updateScanStatus({ phase: 'processing', message: `Merging ${mergedItems.length} items...`, progress: 35 });

  // Step 2: Deduplicate (removes duplicates between fresh and historical)
  console.log('[PIPELINE] Step 2: Deduplicating...');
  const dedupedItems = deduplicateItems(mergedItems);
  console.log(`[PIPELINE] Step 2 complete: ${dedupedItems.length} unique items (removed ${mergedItems.length - dedupedItems.length} duplicates)`);
  updateScanStatus({ phase: 'processing', message: `${dedupedItems.length} unique items`, progress: 40 });

  // Step 3: Score mood (use LLM score if available, else keyword-based)
  console.log('[PIPELINE] Step 3: Scoring mood...');
  updateScanStatus({ phase: 'processing', message: 'Analyzing mood...', progress: 45 });
  const itemsWithMood = dedupedItems.map((item) => ({
    ...item,
    moodScore: item.moodScore ?? calculateItemMoodScore(item),
  }));
  const avgMood = itemsWithMood.length > 0
    ? (itemsWithMood.reduce((sum, i) => sum + (i.moodScore || 50), 0) / itemsWithMood.length).toFixed(0)
    : 50;
  console.log(`[PIPELINE] Step 3 complete: avg mood ${avgMood}/100`);
  const locatedCount = itemsWithMood.filter((i) => i.location).length;
  console.log(`[PIPELINE] Locations: ${locatedCount}/${itemsWithMood.length} items geocoded in Step 1`);
  saveDebugStep('02-items-with-locations', itemsWithMood);

  // Step 4: Cluster into topics
  console.log('[PIPELINE] Step 4: Clustering into topics...');
  updateScanStatus({ phase: 'clustering', message: 'Clustering into topics...', progress: 50 });
  const topics = clusterIntoTopics(itemsWithMood);
  const topicsWithLocations = addLocationsToTopics(topics);
  console.log(`[PIPELINE] Step 4 complete: ${topics.length} topics`);
  updateScanStatus({ phase: 'clustering', message: `Found ${topics.length} topics`, progress: 55 });
  saveDebugStep('03-topics', topicsWithLocations);

  // Step 5: Aggregate emotions and tension
  console.log('[PIPELINE] Step 5: Aggregating emotions...');
  updateScanStatus({ phase: 'processing', message: 'Aggregating emotions...', progress: 60 });
  const emotions = aggregateEmotions(itemsWithMood);
  const tensionIndex = calculateTensionIndex(emotions);
  const countryMoods = aggregateMoodByCountry(itemsWithMood);
  console.log(`[PIPELINE] Step 5 complete: tension ${tensionIndex}, ${countryMoods.length} countries`);

  // Step 6: Load snapshot and compute deltas
  console.log('[PIPELINE] Step 6: Computing deltas...');
  updateScanStatus({ phase: 'processing', message: 'Computing changes...', progress: 65 });
  const yesterdaySnapshot = await loadYesterdaySnapshot();
  const tensionDelta = calculateTensionDelta(tensionIndex, yesterdaySnapshot);
  const emotionsWithDeltas = calculateEmotionDeltas(emotions, yesterdaySnapshot?.emotions || null);
  const topicsWithDeltas = applyTopicDeltas(topicsWithLocations, yesterdaySnapshot);
  console.log(`[PIPELINE] Step 6 complete: delta ${tensionDelta > 0 ? '+' : ''}${tensionDelta}`);

  // Step 7: Generate country summaries (OpenAI)
  console.log('[PIPELINE] Step 7: Generating country summaries...');
  updateScanStatus({ phase: 'summarizing', message: `Generating ${countryMoods.length} summaries...`, progress: 70 });
  const llmStatus = getLLMStatus();
  if (llmStatus.available) {
    try {
      let summaryCount = 0;
      await Promise.all(
        countryMoods.map(async (mood) => {
          const headlines = mood.items.slice(0, 5).map(item => item.title);
          const dominantEmotion = formatEmotion(getDominantEmotion(mood.emotions));
          mood.summary = await generateCountrySummary(
            mood.country, headlines, mood.tensionIndex, dominantEmotion, mood.itemCount
          );
          summaryCount++;
          // Update progress for each summary
          const summaryProgress = 70 + Math.round((summaryCount / countryMoods.length) * 15);
          updateScanStatus({ phase: 'summarizing', message: `Summary ${summaryCount}/${countryMoods.length}...`, progress: summaryProgress });
        })
      );
      console.log(`[PIPELINE] Step 7 complete: ${countryMoods.length} summaries`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'LLM error';
      console.error(`[PIPELINE] Step 7 failed: ${message}`);
      errors.push({ source: 'LLM', message, timestamp: new Date() });
    }
  } else {
    console.log('[PIPELINE] Step 7 skipped: LLM unavailable');
    updateScanStatus({ phase: 'summarizing', message: 'Skipping summaries (LLM unavailable)', progress: 85 });
  }

  // Step 8: Build receipts feed
  console.log('[PIPELINE] Step 8: Building receipts...');
  updateScanStatus({ phase: 'processing', message: 'Building feed...', progress: 88 });
  const allReceipts = itemsToReceipts(itemsWithMood);
  const topReceiptsFromTopics = getTopReceiptsFromTopics(topicsWithDeltas, 10);
  const unclusteredItems = findUnclusteredItems(itemsWithMood, topicsWithDeltas, 20);
  const unclusteredReceipts = itemsToReceipts(unclusteredItems);
  const receiptsFeed = [...topReceiptsFromTopics, ...unclusteredReceipts].slice(0, 20);
  console.log(`[PIPELINE] Step 8 complete: ${receiptsFeed.length} map markers, ${allReceipts.length} total`);
  saveDebugStep('04-receipts-feed', allReceipts);

  // Strip items from countryMoods for the response (not needed on client)
  const countryMoodsForResponse = countryMoods.map(({ items, ...mood }) => mood);

  // Build response
  const response: PulseResponse = {
    tensionIndex,
    tensionDelta,
    emotions: emotionsWithDeltas,
    overallSummary: topics.length > 0
      ? `Tracking ${topics.length} topics with tension at ${tensionIndex}/100.`
      : 'No significant activity detected in the selected time window.',
    topics: topicsWithDeltas,
    receiptsFeed,
    allReceipts,
    errors,
    fetchedAt,
    window,
    regions,
    countryMoods: countryMoodsForResponse,
  };

  // Step 9: Save to history (synchronous to ensure items are saved before cache)
  console.log('[PIPELINE] Step 9: Saving to history...');
  updateScanStatus({ phase: 'saving', message: 'Saving to history...', progress: 92 });
  try {
    const [pulseResult, itemsResult] = await Promise.allSettled([
      saveToHistory(response, itemsWithMood.length),
      saveItemsToHistory(rawItems), // Only save fresh items, not historical duplicates
    ]);

    // Log individual failures for debugging
    if (pulseResult.status === 'rejected') {
      console.error('[PIPELINE] Failed to save pulse history:', pulseResult.reason);
      errors.push({
        source: 'History',
        message: `Failed to save pulse: ${pulseResult.reason instanceof Error ? pulseResult.reason.message : 'Unknown error'}`,
        timestamp: new Date(),
      });
    }

    if (itemsResult.status === 'rejected') {
      console.error('[PIPELINE] Failed to save items history:', itemsResult.reason);
      errors.push({
        source: 'History',
        message: `Failed to save items: ${itemsResult.reason instanceof Error ? itemsResult.reason.message : 'Unknown error'}`,
        timestamp: new Date(),
      });
    }

    if (pulseResult.status === 'fulfilled' && itemsResult.status === 'fulfilled') {
      console.log('[PIPELINE] Step 9 complete');
    }
  } catch (err) {
    console.error('[PIPELINE] History save failed unexpectedly:', err);
  }

  const totalElapsed = Date.now() - pipelineStart;
  console.log('[PIPELINE] ──────────────────────────────────────────────────────');
  console.log(`[PIPELINE] Pipeline completed in ${totalElapsed}ms`);
  console.log(`[PIPELINE] Summary: ${dedupedItems.length} items → ${topics.length} topics → Tension: ${tensionIndex}`);
  console.log('[PIPELINE] ══════════════════════════════════════════════════════\n');

  // Save final response and summary for debugging
  saveDebugStep('05-final-response', response);
  saveDebugSummary({
    totalItems: dedupedItems.length,
    topics: topics.length,
    tensionIndex,
    errors: errors.length,
    durationMs: totalElapsed,
  });

  return response;
}

/**
 * Get top receipts from topics (returns receipts directly, no conversion needed)
 */
function getTopReceiptsFromTopics(topics: { receipts: Receipt[] }[], max: number): Receipt[] {
  const receipts: Receipt[] = [];

  for (const topic of topics) {
    for (const receipt of topic.receipts) {
      if (receipts.length >= max) break;
      receipts.push(receipt);
    }
    if (receipts.length >= max) break;
  }

  return receipts;
}

/**
 * Convert items to receipts
 */
function itemsToReceipts(items: NormalizedItem[]): Receipt[] {
  return items.map((item) => ({
    id: item.id,
    title: item.title,
    snippet: item.text || '',
    url: item.url,
    source: item.context,
    sourceType: item.source, // Original source type (rss, reddit, hn, etc.)
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
 * Add aggregated locations to topics from their receipts
 */
function addLocationsToTopics(topics: Topic[]): Topic[] {
  return topics.map((topic) => {
    const locations: Location[] = [];
    const seen = new Set<string>();

    for (const receipt of topic.receipts) {
      if (receipt.location) {
        const key = `${receipt.location.lat},${receipt.location.lng}`;
        if (!seen.has(key)) {
          seen.add(key);
          locations.push(receipt.location);
        }
      }
    }

    return {
      ...topic,
      locations: locations.length > 0 ? locations : undefined,
    };
  });
}
