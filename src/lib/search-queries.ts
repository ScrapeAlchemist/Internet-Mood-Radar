/**
 * Search Query Generation via LLM
 *
 * Generates dynamic search queries for a country based on:
 * - Content categories (news, events, tech, social, weather)
 * - Dynamic language detection (top 3 languages for the country)
 * - Current date/time context
 */

import {
  CountryConfig,
  SearchQuery,
  SelectedUrl,
  ExtractedContent,
  ContentCategory,
} from '@/types';
import { SerpResult } from '@/lib/brightdata';
import { SEARCH_SETTINGS } from '@/lib/config';
import { getCountryLanguages, CountryLanguages } from '@/lib/country-languages';
import { getCategorySources, generateQueriesFromSources } from '@/lib/platform-sources';
import { getSettings } from '@/lib/settings';
import { rateLimitedChatCompletion, isOpenAIConfigured } from '@/lib/openai-client';

/**
 * Result from generateSearchQueries - includes both direct URLs and search queries
 */
export interface SearchQueriesResult {
  queries: SearchQuery[];
  directUrls: { url: string; name: string; category: ContentCategory }[];
}

/**
 * Internal result from category generators
 */
interface CategoryResult {
  queries: SearchQuery[];
  directUrls: { url: string; name: string; category: ContentCategory }[];
}

// ============================================================================
// STEP 1: Generate Search Queries
// ============================================================================

/**
 * Generate search queries and direct URLs, distributed across categories.
 * Uses dynamic language detection for the country.
 * Uses LLM-discovered platform sources for each category.
 *
 * Returns:
 * - queries: Search queries for SERP discovery
 * - directUrls: Direct URLs from targets for immediate scraping
 */
export async function generateSearchQueries(
  config: CountryConfig,
  maxQueries?: number
): Promise<SearchQueriesResult> {
  const targetCount = maxQueries ?? SEARCH_SETTINGS.maxQueries;
  const activeCategories = config.categories.filter(cat =>
    ['news', 'events', 'tech', 'social', 'weather'].includes(cat)
  );

  if (activeCategories.length === 0) {
    return { queries: [], directUrls: [] };
  }

  // Get dynamic languages for the country via LLM
  const languages = await getCountryLanguages(config.name);

  // Get sources per category from settings
  const settings = await getSettings();
  const sourcesPerCategory = settings.sourcesPerCategory;

  // Calculate queries per category (distribute evenly, with remainder going to news)
  const basePerCategory = Math.floor(targetCount / activeCategories.length);
  const remainder = targetCount % activeCategories.length;

  const categoryQueryCounts: Record<string, number> = {};
  activeCategories.forEach((cat, i) => {
    // Give extra queries to news first, then events
    const extra = i < remainder ? 1 : 0;
    categoryQueryCounts[cat] = basePerCategory + extra;
  });

  // Generate queries for all categories in parallel
  const categoryPromises: Promise<CategoryResult>[] = [];

  if (categoryQueryCounts.news > 0) {
    categoryPromises.push(generateNewsQueries(config, categoryQueryCounts.news, languages, sourcesPerCategory));
  }
  if (categoryQueryCounts.events > 0) {
    categoryPromises.push(generateEventQueries(config, categoryQueryCounts.events, languages, sourcesPerCategory));
  }
  if (categoryQueryCounts.tech > 0) {
    categoryPromises.push(generateTechQueries(config, categoryQueryCounts.tech, languages, sourcesPerCategory));
  }
  if (categoryQueryCounts.social > 0) {
    categoryPromises.push(generateSocialQueries(config, categoryQueryCounts.social, languages, sourcesPerCategory));
  }
  if (categoryQueryCounts.weather > 0) {
    categoryPromises.push(generateWeatherQueries(config, categoryQueryCounts.weather, languages, sourcesPerCategory));
  }

  // Wait for all category queries in parallel
  const categoryResults = await Promise.all(categoryPromises);

  // Merge results from all categories
  const allQueries: SearchQuery[] = [];
  const allDirectUrls: { url: string; name: string; category: ContentCategory }[] = [];

  for (const result of categoryResults) {
    allQueries.push(...result.queries);
    allDirectUrls.push(...result.directUrls);
  }

  return {
    queries: allQueries.slice(0, targetCount),
    directUrls: allDirectUrls,
  };
}

/**
 * Generate news search queries and direct URLs using dynamic languages and discovered sources
 */
async function generateNewsQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages,
  maxSources: number = 4
): Promise<CategoryResult> {
  // Run source discovery and general query generation in parallel
  const [categorySources, generalQueries] = await Promise.all([
    getCategorySources('news', config.name, maxSources),
    generateGeneralNewsQueries(config, Math.ceil(count / 2), languages),
  ]);

  // Generate queries and direct URLs from discovered sources
  const sourceResult = generateQueriesFromSources(
    categorySources,
    languages.googleCodes,
    config.name,
    Math.ceil(count / 2)
  );

  // Convert source queries to SearchQuery format
  const sourceQueries = sourceResult.queries.map(q => ({
    query: q.query,
    category: 'news' as ContentCategory,
    language: q.language,
  }));

  // Add category to direct URLs
  const directUrls = sourceResult.directUrls.map(u => ({
    ...u,
    category: 'news' as ContentCategory,
  }));

  const queries = [...sourceQueries, ...generalQueries].slice(0, count);

  return { queries, directUrls };
}

/**
 * Generate general news queries via LLM (without specific source targeting)
 */
async function generateGeneralNewsQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages
): Promise<SearchQuery[]> {
  if (count <= 0) return [];

  if (!isOpenAIConfigured()) {
    // No LLM available - return generic country queries
    return Array(count).fill(null).map((_, i) => ({
      query: `${config.name} news today ${i > 0 ? languages.googleCodes[i % languages.googleCodes.length] : ''}`.trim(),
      category: 'news' as ContentCategory,
      language: languages.googleCodes[i % languages.googleCodes.length] || 'en',
    }));
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const prompt = `Generate exactly ${count} Google search queries to find the latest news from ${config.name}.

Today is ${today}.

Requirements:
- Generate queries in these languages: ${languages.primary}, ${languages.secondary}, ${languages.tertiary}
- Mix languages proportionally (more in primary language: ${languages.primary})
- Focus on: breaking news, politics, security, economy
- Use time-sensitive terms appropriate to each language (e.g., "today", "breaking", "latest")
- Make queries specific enough to get relevant results
- IMPORTANT: Return EXACTLY ${count} queries

Return ONLY a JSON array with language codes:
[{"query": "...", "lang": "${languages.googleCodes[0]}"}, {"query": "...", "lang": "${languages.googleCodes[1]}"}, ...]`;

  try {
    const response = await rateLimitedChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500 + (count * 50),
    });

    const content = response.choices[0]?.message?.content || '[]';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));

    const queries: SearchQuery[] = parsed.slice(0, count).map((item: string | { query: string; lang?: string }) => {
      if (typeof item === 'string') {
        return {
          query: item,
          category: 'news' as ContentCategory,
          language: detectLanguageCode(item, languages),
        };
      }
      return {
        query: item.query,
        category: 'news' as ContentCategory,
        language: item.lang || detectLanguageCode(item.query, languages),
      };
    });

    return queries;
  } catch (error) {
    console.error('[SEARCH-QUERIES] Failed to generate news queries:', error);
    return [];
  }
}

/**
 * Generate event search queries and direct URLs using dynamic languages and discovered sources
 */
async function generateEventQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages,
  maxSources: number = 4
): Promise<CategoryResult> {
  // Run source discovery and general query generation in parallel
  const [categorySources, generalQueries] = await Promise.all([
    getCategorySources('events', config.name, maxSources),
    generateGeneralEventQueries(config, Math.ceil(count / 2), languages),
  ]);

  // Generate queries and direct URLs from discovered sources
  const sourceResult = generateQueriesFromSources(
    categorySources,
    languages.googleCodes,
    config.name,
    Math.ceil(count / 2)
  );

  // Convert source queries to SearchQuery format
  const sourceQueries = sourceResult.queries.map(q => ({
    query: q.query,
    category: 'events' as ContentCategory,
    language: q.language,
  }));

  // Add category to direct URLs
  const directUrls = sourceResult.directUrls.map(u => ({
    ...u,
    category: 'events' as ContentCategory,
  }));

  const queries = [...sourceQueries, ...generalQueries].slice(0, count);

  return { queries, directUrls };
}

/**
 * Generate general event queries via LLM (without specific source targeting)
 */
async function generateGeneralEventQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages
): Promise<SearchQuery[]> {
  if (count <= 0) return [];

  if (!isOpenAIConfigured()) {
    // No LLM available - return generic country queries
    const mainCity = config.cities[0] || config.name;
    return Array(count).fill(null).map((_, i) => ({
      query: `${mainCity} events this week ${i > 0 ? languages.googleCodes[i % languages.googleCodes.length] : ''}`.trim(),
      category: 'events' as ContentCategory,
      language: languages.googleCodes[i % languages.googleCodes.length] || 'en',
    }));
  }

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const prompt = `Generate exactly ${count} Google search queries to find upcoming events in ${config.name}.

Today is ${today}.
Major cities: ${config.cities.slice(0, 4).join(', ')}

Requirements:
- Generate queries in these languages: ${languages.primary}, ${languages.secondary}, ${languages.tertiary}
- Mix languages proportionally (more in primary language: ${languages.primary})
- Cover: concerts, festivals, protests, sports, theater, exhibitions
- Use time-sensitive terms in each language (e.g., "this week", "tonight", "today")
- IMPORTANT: Return EXACTLY ${count} queries

Return ONLY a JSON array with language codes:
[{"query": "...", "lang": "${languages.googleCodes[0]}"}, {"query": "...", "lang": "${languages.googleCodes[1]}"}, ...]`;

  try {
    const response = await rateLimitedChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 400 + (count * 50),
    });

    const content = response.choices[0]?.message?.content || '[]';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));

    const queries: SearchQuery[] = parsed.slice(0, count).map((item: string | { query: string; lang?: string }) => {
      if (typeof item === 'string') {
        return {
          query: item,
          category: 'events' as ContentCategory,
          language: detectLanguageCode(item, languages),
        };
      }
      return {
        query: item.query,
        category: 'events' as ContentCategory,
        language: item.lang || detectLanguageCode(item.query, languages),
      };
    });

    return queries;
  } catch (error) {
    console.error('[SEARCH-QUERIES] Failed to generate event queries:', error);
    return [];
  }
}

/**
 * Generate tech search queries and direct URLs using dynamic languages and discovered sources
 */
async function generateTechQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages,
  maxSources: number = 4
): Promise<CategoryResult> {
  // Run source discovery and general query generation in parallel
  const [categorySources, generalQueries] = await Promise.all([
    getCategorySources('tech', config.name, maxSources),
    generateGeneralTechQueries(config, Math.ceil(count / 2), languages),
  ]);

  // Generate queries and direct URLs from discovered sources
  const sourceResult = generateQueriesFromSources(
    categorySources,
    languages.googleCodes,
    config.name,
    Math.ceil(count / 2)
  );

  // Convert source queries to SearchQuery format
  const sourceQueries = sourceResult.queries.map(q => ({
    query: q.query,
    category: 'tech' as ContentCategory,
    language: q.language,
  }));

  // Add category to direct URLs
  const directUrls = sourceResult.directUrls.map(u => ({
    ...u,
    category: 'tech' as ContentCategory,
  }));

  const queries = [...sourceQueries, ...generalQueries].slice(0, count);

  return { queries, directUrls };
}

/**
 * Generate general tech queries via LLM (without specific source targeting)
 */
async function generateGeneralTechQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages
): Promise<SearchQuery[]> {
  if (count <= 0) return [];

  if (!isOpenAIConfigured()) {
    // No LLM available - return generic country queries
    return Array(count).fill(null).map((_, i) => ({
      query: `${config.name} tech startups news ${i > 0 ? 'funding' : ''}`.trim(),
      category: 'tech' as ContentCategory,
      language: 'en',
    }));
  }

  const prompt = `Generate exactly ${count} Google search queries to find tech/startup news from ${config.name}.

Requirements:
- Mix languages: primarily English (tech is global), some in ${languages.primary}
- Cover: startups, funding, tech industry, AI, cybersecurity, fintech
- Focus on recent news and announcements
- IMPORTANT: Return EXACTLY ${count} queries

Return ONLY a JSON array with language codes:
[{"query": "...", "lang": "en"}, {"query": "...", "lang": "${languages.googleCodes[0]}"}, ...]`;

  try {
    const response = await rateLimitedChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300 + (count * 40),
    });

    const content = response.choices[0]?.message?.content || '[]';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));

    const queries: SearchQuery[] = parsed.slice(0, count).map((item: string | { query: string; lang?: string }) => {
      if (typeof item === 'string') {
        return {
          query: item,
          category: 'tech' as ContentCategory,
          language: detectLanguageCode(item, languages),
        };
      }
      return {
        query: item.query,
        category: 'tech' as ContentCategory,
        language: item.lang || 'en',
      };
    });

    return queries;
  } catch (error) {
    console.error('[SEARCH-QUERIES] Failed to generate tech queries:', error);
    return [];
  }
}

/**
 * Generate social search queries and direct URLs using dynamic languages and discovered sources
 */
async function generateSocialQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages,
  maxSources: number = 4
): Promise<CategoryResult> {
  // Run source discovery and general query generation in parallel
  const [categorySources, generalQueries] = await Promise.all([
    getCategorySources('social', config.name, maxSources),
    generateGeneralSocialQueries(config, Math.ceil(count / 2), languages),
  ]);

  // Generate queries and direct URLs from discovered sources
  const sourceResult = generateQueriesFromSources(
    categorySources,
    languages.googleCodes,
    config.name,
    Math.ceil(count / 2)
  );

  // Convert source queries to SearchQuery format
  const sourceQueries = sourceResult.queries.map(q => ({
    query: q.query,
    category: 'social' as ContentCategory,
    language: q.language,
  }));

  // Add category to direct URLs
  const directUrls = sourceResult.directUrls.map(u => ({
    ...u,
    category: 'social' as ContentCategory,
  }));

  const queries = [...sourceQueries, ...generalQueries].slice(0, count);

  return { queries, directUrls };
}

/**
 * Generate general social queries via LLM (without specific source targeting)
 */
async function generateGeneralSocialQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages
): Promise<SearchQuery[]> {
  if (count <= 0) return [];

  if (!isOpenAIConfigured()) {
    // No LLM available - return generic country queries
    return Array(count).fill(null).map((_, i) => ({
      query: `${config.name} discussion forum ${languages.googleCodes[i % languages.googleCodes.length] || 'en'}`,
      category: 'social' as ContentCategory,
      language: languages.googleCodes[i % languages.googleCodes.length] || 'en',
    }));
  }

  const prompt = `Generate exactly ${count} Google search queries to find social media discussions and public opinion about ${config.name}.

Requirements:
- Generate queries in these languages: ${languages.primary}, ${languages.secondary}, ${languages.tertiary}
- Cover: forums, discussion boards, public reactions, community posts
- Focus on recent discussions and trending topics
- IMPORTANT: Return EXACTLY ${count} queries

Return ONLY a JSON array with language codes:
[{"query": "...", "lang": "${languages.googleCodes[0]}"}, {"query": "...", "lang": "${languages.googleCodes[1]}"}, ...]`;

  try {
    const response = await rateLimitedChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300 + (count * 40),
    });

    const content = response.choices[0]?.message?.content || '[]';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));

    const queries: SearchQuery[] = parsed.slice(0, count).map((item: string | { query: string; lang?: string }) => {
      if (typeof item === 'string') {
        return {
          query: item,
          category: 'social' as ContentCategory,
          language: detectLanguageCode(item, languages),
        };
      }
      return {
        query: item.query,
        category: 'social' as ContentCategory,
        language: item.lang || detectLanguageCode(item.query, languages),
      };
    });

    return queries;
  } catch (error) {
    console.error('[SEARCH-QUERIES] Failed to generate social queries:', error);
    return [];
  }
}

/**
 * Generate weather search queries and direct URLs using dynamic languages and discovered sources
 */
async function generateWeatherQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages,
  maxSources: number = 4
): Promise<CategoryResult> {
  // Run source discovery and general query generation in parallel
  const [categorySources, generalQueries] = await Promise.all([
    getCategorySources('weather', config.name, maxSources),
    generateGeneralWeatherQueries(config, Math.ceil(count / 2), languages),
  ]);

  // Generate queries and direct URLs from discovered sources
  const sourceResult = generateQueriesFromSources(
    categorySources,
    languages.googleCodes,
    config.name,
    Math.ceil(count / 2)
  );

  // Convert source queries to SearchQuery format
  const sourceQueries = sourceResult.queries.map(q => ({
    query: q.query,
    category: 'weather' as ContentCategory,
    language: q.language,
  }));

  // Add category to direct URLs
  const directUrls = sourceResult.directUrls.map(u => ({
    ...u,
    category: 'weather' as ContentCategory,
  }));

  const queries = [...sourceQueries, ...generalQueries].slice(0, count);

  return { queries, directUrls };
}

/**
 * Generate general weather queries via LLM (without specific source targeting)
 */
async function generateGeneralWeatherQueries(
  config: CountryConfig,
  count: number,
  languages: CountryLanguages
): Promise<SearchQuery[]> {
  if (count <= 0) return [];

  const mainCity = config.cities[0] || config.name;

  if (!isOpenAIConfigured()) {
    // No LLM available - return generic country queries
    return Array(count).fill(null).map((_, i) => ({
      query: `${i % 2 === 0 ? config.name : mainCity} weather ${i > 1 ? languages.primary : 'today'}`,
      category: 'weather' as ContentCategory,
      language: languages.googleCodes[i % languages.googleCodes.length] || 'en',
    }));
  }

  const prompt = `Generate exactly ${count} Google search queries to find weather information for ${config.name}.

Major cities: ${config.cities.slice(0, 4).join(', ')}

Requirements:
- Generate queries in these languages: ${languages.primary}, ${languages.secondary}
- Cover: weather alerts, forecasts, current conditions
- Include city-specific weather queries
- IMPORTANT: Return EXACTLY ${count} queries

Return ONLY a JSON array with language codes:
[{"query": "...", "lang": "${languages.googleCodes[0]}"}, {"query": "...", "lang": "en"}, ...]`;

  try {
    const response = await rateLimitedChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300 + (count * 40),
    });

    const content = response.choices[0]?.message?.content || '[]';
    const parsed = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));

    const queries: SearchQuery[] = parsed.slice(0, count).map((item: string | { query: string; lang?: string }) => {
      if (typeof item === 'string') {
        return {
          query: item,
          category: 'weather' as ContentCategory,
          language: detectLanguageCode(item, languages),
        };
      }
      return {
        query: item.query,
        category: 'weather' as ContentCategory,
        language: item.lang || detectLanguageCode(item.query, languages),
      };
    });

    return queries;
  } catch (error) {
    console.error('[SEARCH-QUERIES] Failed to generate weather queries:', error);
    return [];
  }
}

// ============================================================================
// STEP 5: LLM Selects Best URLs
// ============================================================================

/**
 * Have LLM select and categorize the best URLs from search results.
 * Processes ALL URLs in parallel batches of 50 for efficiency.
 */
export async function selectBestUrls(
  results: SerpResult[],
  config: CountryConfig,
  maxUrls: number = SEARCH_SETTINGS.maxUrlsToScrape
): Promise<SelectedUrl[]> {
  if (!isOpenAIConfigured()) {
    // Fallback: just take top results
    return results.slice(0, maxUrls).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      category: 'news' as ContentCategory,
    }));
  }

  // Process ALL URLs in parallel batches of 50
  const BATCH_SIZE = 50;
  const totalBatches = Math.ceil(results.length / BATCH_SIZE);

  console.log(`[SEARCH-QUERIES] Processing ${results.length} URLs in ${totalBatches} parallel batch(es) of ${BATCH_SIZE}...`);

  // Create batch promises
  const batchPromises: Promise<SelectedUrl[]>[] = [];

  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batchResults = results.slice(batchStart, batchStart + BATCH_SIZE);

    // Calculate proportional target for this batch
    const toSelectFromBatch = Math.ceil(maxUrls * (batchResults.length / results.length));

    // Create promise for this batch
    const batchPromise = processBatch(
      batchResults,
      config,
      batchIndex,
      totalBatches,
      toSelectFromBatch
    );

    batchPromises.push(batchPromise);
  }

  // Wait for all batches to complete in parallel
  const batchResults = await Promise.all(batchPromises);

  // Merge results from all batches
  const allSelected = batchResults.flat();

  console.log(`[SEARCH-QUERIES] Total selected: ${allSelected.length} URLs from ${results.length} candidates`);
  return allSelected.slice(0, maxUrls);
}

/**
 * Process a single batch of URLs with LLM
 */
async function processBatch(
  batchResults: SerpResult[],
  config: CountryConfig,
  batchIndex: number,
  totalBatches: number,
  toSelectFromBatch: number
): Promise<SelectedUrl[]> {
  // Prepare condensed list for LLM
  const urlList = batchResults.map((r, i) => ({
    i,
    url: r.url,
    title: r.title,
    snippet: r.snippet.slice(0, 150),
  }));

  const prompt = `Select the best ${toSelectFromBatch} URLs about ${config.name} to scrape.

Results (batch ${batchIndex + 1}/${totalBatches}):
${JSON.stringify(urlList, null, 2)}

ACCEPT: URLs pointing to a single article/post (has unique path, ID, slug, or date)
REJECT: Homepages, category listings, user profiles, Wikipedia, search result pages

Categorize as: news | events | tech | social | weather

Return JSON array: [{"i": 0, "category": "news"}, ...]`;

  try {
    const response = await rateLimitedChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2000,
    });

    const content = response.choices[0]?.message?.content || '[]';

    // Robust JSON extraction - LLM sometimes returns text before/after the array
    let selections: { i: number; category: ContentCategory }[] = [];
    const cleanedContent = content.replace(/```json\n?|\n?```/g, '').trim();

    try {
      selections = JSON.parse(cleanedContent);
    } catch {
      // Try to extract JSON array from the response
      const arrayMatch = cleanedContent.match(/\[[\s\S]*\]/);
      if (arrayMatch) {
        try {
          selections = JSON.parse(arrayMatch[0]);
        } catch {
          console.warn(`[SEARCH-QUERIES] Batch ${batchIndex + 1}: Could not parse JSON array`);
        }
      }
    }

    const batchSelected = selections.map((s: { i: number; category: ContentCategory }) => {
      const result = urlList[s.i];
      if (!result) return null;
      return {
        url: result.url,
        title: result.title,
        snippet: result.snippet,
        category: s.category,
      };
    }).filter(Boolean) as SelectedUrl[];

    console.log(`[SEARCH-QUERIES]   Batch ${batchIndex + 1}: selected ${batchSelected.length}/${batchResults.length} URLs`);
    return batchSelected;

  } catch (error) {
    console.error(`[SEARCH-QUERIES] Batch ${batchIndex + 1} failed:`, error);
    // On error, include all from this batch as fallback
    return batchResults.slice(0, toSelectFromBatch).map((r) => ({
      url: r.url,
      title: r.title,
      snippet: r.snippet,
      category: 'news' as ContentCategory,
    }));
  }
}

// ============================================================================
// STEP 7: Extract & Summarize Content
// ============================================================================

// Language code to full name mapping for prompts
const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English',
  he: 'Hebrew',
  ru: 'Russian',
};

/**
 * Extract structured content from scraped markdown
 * @param targetLanguage - The UI language to output content in (en, he, ru)
 */
export async function extractContent(
  markdown: string,
  sourceUrl: string,
  imageUrl: string | undefined,
  config: CountryConfig,
  targetLanguage: string = 'en',
  hintCategory: ContentCategory = 'news'
): Promise<ExtractedContent | null> {
  if (!isOpenAIConfigured()) return null;

  // Truncate content to token limit
  const truncated = markdown.slice(0, SEARCH_SETTINGS.contentTokenLimit * 4); // ~4 chars per token

  const langName = LANGUAGE_NAMES[targetLanguage] || 'English';

  // Category-specific descriptions for better extraction
  const categoryDescriptions: Record<ContentCategory, string> = {
    news: 'news article or story',
    events: 'event, concert, festival, or scheduled happening',
    tech: 'technology, startup, or innovation story',
    social: 'social discussion, forum post, or community content',
    weather: 'weather report, forecast, or climate information',
  };

  const prompt = `Extract the MAIN CONTENT from this page about ${config.name}.
Expected content type: ${categoryDescriptions[hintCategory]}

IMPORTANT: Extract the PRIMARY content - NOT a description of the website itself.
If this is a homepage/index page with multiple items, extract the MOST PROMINENT/RECENT item.

CRITICAL: ALL OUTPUT MUST BE IN ${langName.toUpperCase()}. If the source content is in a different language, TRANSLATE the title and summary to ${langName}.

URL: ${sourceUrl}
Content:
${truncated}

Extract:
1. title: The article headline IN ${langName.toUpperCase()} (translate if needed)
2. summary: 1-2 sentence summary IN ${langName.toUpperCase()} (translate if needed)
3. category: news | events | tech | social | weather
4. location: City/region if mentioned (from: ${config.cities.join(', ')})
5. eventDate: Date if this is an event (YYYY-MM-DD format)
6. sentiment: positive | negative | neutral
7. moodScore: 0-100 number based on content tone and implications for the region:
   - 0-20: Very negative (deaths, attacks, disasters, crises)
   - 21-40: Negative (conflicts, problems, failures, concerns)
   - 41-60: Neutral (factual reporting, routine announcements)
   - 61-80: Positive (progress, growth, innovation, success, improvements)
   - 81-100: Very positive (celebrations, major achievements, breakthroughs)
8. engagement: Number representing total engagement metrics found in the content:
   - Look for: upvotes, points, likes, comments count, shares, retweets, reactions
   - Reddit: "X upvotes", "X points", "X comments"
   - Hacker News: "X points", "X comments"
   - Social media: likes, shares, retweets
   - If no metrics visible, return 0
9. imageUrl: The main article/hero image URL from the markdown content (not logos, icons, ads, or social buttons). Return null if no good image found.
10. isRelevant: true/false - Is this content actually about ${config.name} or related to this region?
11. articleUrl: The URL of the specific article/post being discussed. Look for:
   - On Twitter/X: the specific tweet/post URL (like x.com/user/status/123456)
   - On Reddit: the specific post URL
   - On news sites: the article URL
   - Return the most specific URL to the content, NOT profile pages or homepages. Return null if not found.
12. publishedAt: The publication date/time of the article in ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ). Look for:
   - Date stamps like "December 29, 2025", "2 hours ago", "Posted on Dec 29"
   - Twitter timestamps, Reddit post times
   - News article publication dates
   - Return null if no date found.

Return ONLY JSON:
{"title": "...", "summary": "...", "category": "${hintCategory}", "location": null, "eventDate": null, "sentiment": "neutral", "moodScore": 50, "engagement": 0, "imageUrl": null, "isRelevant": true, "articleUrl": null, "publishedAt": null}`;

  try {
    const response = await rateLimitedChatCompletion({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 300,
    });

    const content = response.choices[0]?.message?.content || '{}';

    // Robust JSON parsing with multiple fallback strategies
    let extracted: Record<string, unknown> = {};
    const cleanedContent = content.replace(/```json\n?|\n?```/g, '').trim();

    try {
      extracted = JSON.parse(cleanedContent);
    } catch (parseError) {
      // Strategy 1: Try to extract JSON object using regex
      const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          extracted = JSON.parse(jsonMatch[0]);
        } catch {
          // Strategy 2: Extract individual fields using regex
          console.warn('[SEARCH-QUERIES] JSON malformed, extracting fields manually');
          const titleMatch = cleanedContent.match(/"title"\s*:\s*"([^"]+)"/);
          const summaryMatch = cleanedContent.match(/"summary"\s*:\s*"([^"]+)"/);
          const categoryMatch = cleanedContent.match(/"category"\s*:\s*"([^"]+)"/);
          const locationMatch = cleanedContent.match(/"location"\s*:\s*"([^"]+)"/);
          const sentimentMatch = cleanedContent.match(/"sentiment"\s*:\s*"([^"]+)"/);
          const moodScoreMatch = cleanedContent.match(/"moodScore"\s*:\s*(\d+)/);
          const engagementMatch = cleanedContent.match(/"engagement"\s*:\s*(\d+)/);

          extracted = {
            title: titleMatch?.[1],
            summary: summaryMatch?.[1],
            category: categoryMatch?.[1],
            location: locationMatch?.[1],
            sentiment: sentimentMatch?.[1],
            moodScore: moodScoreMatch ? parseInt(moodScoreMatch[1], 10) : 50,
            engagement: engagementMatch ? parseInt(engagementMatch[1], 10) : 0,
          };
        }
      }
    }

    // Validate category - use hintCategory as fallback instead of hardcoded 'news'
    const validCategories = ['news', 'social', 'tech', 'events', 'weather'] as const;
    const rawCategory = (extracted.category as string) || hintCategory;
    const category = validCategories.includes(rawCategory as typeof validCategories[number])
      ? (rawCategory as typeof validCategories[number])
      : hintCategory;

    // Validate sentiment
    const validSentiments = ['positive', 'negative', 'neutral'] as const;
    const rawSentiment = (extracted.sentiment as string) || 'neutral';
    const sentiment = validSentiments.includes(rawSentiment as typeof validSentiments[number])
      ? (rawSentiment as typeof validSentiments[number])
      : 'neutral';

    const title = (extracted.title as string) || '';
    const summary = (extracted.summary as string) || '';

    // Filter out empty/error pages and template text from LLM prompts
    const invalidTitlePatterns = [
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
      // Template text patterns - LLM echoing prompts instead of extracting content
      /IN ENGLISH/i,
      /IN HEBREW/i,
      /IN RUSSIAN/i,
      /translate if needed/i,
      /The article headline/i,
      /1-2 sentence summary/i,
    ];

    const isInvalidTitle = !title || invalidTitlePatterns.some(p => p.test(title.trim()));
    const isInvalidSummary = summary.toLowerCase().includes('could not be found') ||
      summary.toLowerCase().includes('not found') ||
      summary.toLowerCase().includes('no posts available') ||
      summary.toLowerCase().includes('no articles') ||
      summary.toLowerCase().includes('page does not exist') ||
      summary.toLowerCase().includes('error occurred');

    if (isInvalidTitle || isInvalidSummary) {
      console.log(`[SEARCH-QUERIES] Filtered invalid content: "${title.slice(0, 50)}..."`);
      return null;
    }

    // Parse and validate moodScore (0-100, default 50 for neutral)
    const rawMoodScore = typeof extracted.moodScore === 'number'
      ? extracted.moodScore
      : parseInt(String(extracted.moodScore), 10);
    const moodScore = isNaN(rawMoodScore) ? 50 : Math.min(100, Math.max(0, rawMoodScore));

    // Parse and validate engagement (default 0)
    const rawEngagement = typeof extracted.engagement === 'number'
      ? extracted.engagement
      : parseInt(String(extracted.engagement), 10);
    const engagement = isNaN(rawEngagement) ? 0 : Math.max(0, rawEngagement);

    // Parse imageUrl from LLM, fall back to regex-extracted image
    let llmImageUrl: string | undefined;
    if (typeof extracted.imageUrl === 'string' && extracted.imageUrl.startsWith('http')) {
      try {
        new URL(extracted.imageUrl); // Validate it's a proper URL
        llmImageUrl = extracted.imageUrl;
      } catch {
        llmImageUrl = undefined;
      }
    }
    const finalImageUrl = llmImageUrl || imageUrl;

    // Parse isRelevant from LLM (default to true if not specified)
    const isRelevant = extracted.isRelevant !== false;

    // Filter out irrelevant content
    if (!isRelevant) {
      console.log(`[SEARCH-QUERIES] Filtered irrelevant content: "${title.slice(0, 50)}..."`);
      return null;
    }

    // Parse articleUrl from LLM (specific article/post URL)
    let articleUrl: string | undefined;
    if (typeof extracted.articleUrl === 'string' && extracted.articleUrl.startsWith('http')) {
      try {
        new URL(extracted.articleUrl); // Validate it's a proper URL
        articleUrl = extracted.articleUrl;
      } catch {
        articleUrl = undefined;
      }
    }

    // Parse publishedAt from LLM (article publication date)
    let publishedAt: Date | undefined;
    if (extracted.publishedAt) {
      try {
        const parsed = new Date(extracted.publishedAt as string);
        // Only use if valid and not in the future
        if (!isNaN(parsed.getTime()) && parsed <= new Date()) {
          publishedAt = parsed;
        }
      } catch {
        publishedAt = undefined;
      }
    }

    return {
      title,
      summary,
      category,
      location: (extracted.location as string) || undefined,
      eventDate: extracted.eventDate ? new Date(extracted.eventDate as string) : undefined,
      sentiment,
      moodScore,
      engagement,
      imageUrl: finalImageUrl,
      sourceUrl,
      isRelevant,
      articleUrl,
      publishedAt,
    };
  } catch (error) {
    console.error('[SEARCH-QUERIES] Failed to extract content:', error);
    return null;
  }
}

// ============================================================================
// LANGUAGE DETECTION HELPER
// ============================================================================

/**
 * Detect language code from query text based on script patterns
 */
function detectLanguageCode(query: string, languages: CountryLanguages): string {
  // Hebrew script
  if (/[\u0590-\u05FF]/.test(query)) {
    return 'iw';
  }
  // Arabic script
  if (/[\u0600-\u06FF\u0750-\u077F]/.test(query)) {
    return 'ar';
  }
  // Russian/Cyrillic script
  if (/[\u0400-\u04FF]/.test(query)) {
    return 'ru';
  }
  // Chinese
  if (/[\u4E00-\u9FFF]/.test(query)) {
    return 'zh';
  }
  // Japanese
  if (/[\u3040-\u30FF]/.test(query)) {
    return 'ja';
  }
  // Korean
  if (/[\uAC00-\uD7AF]/.test(query)) {
    return 'ko';
  }
  // Default to first language code or English
  return languages.googleCodes[0] || 'en';
}
