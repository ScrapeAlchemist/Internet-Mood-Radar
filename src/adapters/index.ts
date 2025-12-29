import { FetchResult, NormalizedItem, NonFatalError, CountryConfig } from '@/types';
import { SOURCES, getActiveCountryConfigs } from '@/lib/config';
import { getSettings } from '@/lib/settings';
import { SearchAdapter } from './search';
import { initRegionTracking, clearRegionTracking } from '@/lib/scan-status';

/**
 * Fetch all items using search-based collection
 * Loads settings from database to determine categories and limits
 * Runs in parallel for each selected region
 */
export async function fetchAllSources(since: Date): Promise<{
  items: NormalizedItem[];
  errors: NonFatalError[];
}> {
  // Load settings and configs from database
  const settings = await getSettings();
  const countryConfigs = await getActiveCountryConfigs();

  console.log('\n[FETCH] ═══════════════════════════════════════════════════════');
  console.log(`[FETCH] Starting search-based fetch for ${countryConfigs.length} region(s)`);
  console.log(`[FETCH] Regions: ${countryConfigs.map(c => c.name).join(', ')}`);
  console.log(`[FETCH] Categories: ${settings.categoriesEnabled.join(', ')}`);
  console.log(`[FETCH] Per region: ${settings.maxSearchQueries} queries, ${settings.maxUrlsToScrape} URLs`);
  console.log(`[FETCH] Time window: since ${since.toISOString()}`);
  console.log('[FETCH] ───────────────────────────────────────────────────────\n');

  const startTime = Date.now();
  const searchConfig = SOURCES.find((s) => s.type === 'search') || SOURCES[0];

  // Initialize region tracking for progress display (slowest region wins)
  initRegionTracking(countryConfigs.map(c => c.name));

  // Fetch from each region in parallel
  const regionResults = await Promise.all(
    countryConfigs.map(async (countryConfig) => {
      const config: CountryConfig = {
        ...countryConfig,
        categories: settings.categoriesEnabled,
      };

      console.log(`[FETCH] → Starting fetch for ${config.name}...`);

      const adapter = new SearchAdapter(searchConfig, config, {
        maxQueries: settings.maxSearchQueries,
        maxUrlsToScrape: settings.maxUrlsToScrape,
        uiLanguage: settings.language,
      });

      try {
        const result = await adapter.fetch(since);
        console.log(`[FETCH] ✓ ${config.name}: ${result.items.length} items`);
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[FETCH] ✗ ${config.name} failed: ${message}`);
        return {
          items: [],
          errors: [{ source: `Search (${config.name})`, message, timestamp: new Date() }],
          sourceName: `Search (${config.name})`,
        } as FetchResult;
      }
    })
  );

  // Merge results from all regions
  const allItems: NormalizedItem[] = [];
  const allErrors: NonFatalError[] = [];

  for (const result of regionResults) {
    allItems.push(...result.items);
    allErrors.push(...result.errors);
  }

  // Clear region tracking after fetching phase completes
  clearRegionTracking();

  const totalElapsed = Date.now() - startTime;
  console.log('\n[FETCH] ───────────────────────────────────────────────────────');
  console.log(`[FETCH] Completed in ${totalElapsed}ms`);
  console.log(`[FETCH] Total items: ${allItems.length} from ${countryConfigs.length} region(s)`);
  console.log(`[FETCH] Errors: ${allErrors.length}`);
  if (allErrors.length > 0) {
    allErrors.forEach((e) => console.log(`[FETCH]   - ${e.source}: ${e.message}`));
  }
  console.log('[FETCH] ═══════════════════════════════════════════════════════\n');

  return { items: allItems, errors: allErrors };
}

export { SearchAdapter } from './search';
export { BaseAdapter } from './base';
