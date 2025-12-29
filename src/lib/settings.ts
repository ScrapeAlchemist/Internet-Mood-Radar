/**
 * Settings management - CRUD operations for app configuration
 *
 * Settings are stored in SQLite and override environment defaults.
 * Priority: Database settings > Environment variables > Hardcoded defaults
 */

import { prisma } from '@/lib/db';
import { ContentCategory } from '@/types';
import { AppLanguage } from '@/lib/translations';
import { PREDEFINED_REGIONS } from '@/lib/country-config';

// Display time frame options
export type DisplayTimeFrame = '1d' | '1w' | '1m' | '1y' | 'all';

// Time frame to milliseconds mapping
export const TIME_FRAME_MS: Record<DisplayTimeFrame, number> = {
  '1d': 24 * 60 * 60 * 1000,      // 1 day
  '1w': 7 * 24 * 60 * 60 * 1000,  // 1 week
  '1m': 30 * 24 * 60 * 60 * 1000, // 1 month
  '1y': 365 * 24 * 60 * 60 * 1000, // 1 year
  'all': Infinity,                 // No limit
};

// Time frame labels for UI
export const TIME_FRAME_LABELS: Record<DisplayTimeFrame, string> = {
  '1d': 'Last 24 hours',
  '1w': 'Last week',
  '1m': 'Last month',
  '1y': 'Last year',
  'all': 'All time',
};

// App settings interface (what the UI works with)
export interface AppSettings {
  regions: string[]; // List of regions/countries to scan
  language: AppLanguage;
  categoriesEnabled: ContentCategory[];
  maxSearchQueries: number; // per region
  maxUrlsToScrape: number; // per region
  sourcesPerCategory: number;
  displayTimeFrame: DisplayTimeFrame; // How far back to display items
}

// Default settings
const DEFAULT_SETTINGS: AppSettings = {
  regions: ['Middle East'],
  language: 'en',
  categoriesEnabled: ['news', 'events', 'tech', 'social', 'weather'],
  maxSearchQueries: 20,
  maxUrlsToScrape: 50,
  sourcesPerCategory: 4,
  displayTimeFrame: '1d',
};

// Category metadata for UI
export const CATEGORY_INFO: Record<ContentCategory, { label: string; description: string }> = {
  news: {
    label: 'News',
    description: 'Breaking news, politics, security, economy',
  },
  social: {
    label: 'Social Media',
    description: 'Reddit discussions, forums, public opinion',
  },
  events: {
    label: 'Events',
    description: 'Concerts, festivals, protests, sports',
  },
  weather: {
    label: 'Weather',
    description: 'Weather alerts, forecasts, conditions',
  },
  tech: {
    label: 'Tech',
    description: 'Startups, funding, tech industry news',
  },
};

/**
 * Get current settings (from DB, falling back to env/defaults)
 */
export async function getSettings(): Promise<AppSettings> {
  try {
    const dbSettings = await prisma.settings.findUnique({
      where: { id: 'default' },
    });

    if (dbSettings) {
      // Parse regions - handle both old 'country' field and new 'regions' field
      let regions: string[];
      const dbRecord = dbSettings as Record<string, unknown>;
      if (dbRecord.regions && typeof dbRecord.regions === 'string') {
        regions = dbRecord.regions.split(',').map((r: string) => r.trim()).filter(Boolean);
      } else if (dbRecord.country && typeof dbRecord.country === 'string') {
        // Migration from old schema
        regions = [dbRecord.country];
      } else {
        regions = ['Middle East'];
      }

      // Filter out any non-region values (like 'USA' which is a country, not a region)
      const validRegions = Object.keys(PREDEFINED_REGIONS);
      const filteredRegions = regions.filter(r => validRegions.includes(r));
      if (filteredRegions.length === 0) {
        // If no valid regions, default to Middle East
        regions = ['Middle East'];
      } else {
        regions = filteredRegions;
      }

      return {
        regions,
        language: (dbSettings.language || 'en') as AppLanguage,
        categoriesEnabled: dbSettings.categoriesEnabled.split(',') as ContentCategory[],
        maxSearchQueries: dbSettings.maxSearchQueries,
        maxUrlsToScrape: dbSettings.maxUrlsToScrape,
        sourcesPerCategory: dbSettings.sourcesPerCategory ?? 4,
        displayTimeFrame: ((dbSettings as Record<string, unknown>).displayTimeFrame as DisplayTimeFrame) || '1d',
      };
    }

    // Return defaults with env overrides
    return {
      ...DEFAULT_SETTINGS,
      maxSearchQueries: parseInt(process.env.MAX_SEARCH_QUERIES || '20', 10),
      maxUrlsToScrape: parseInt(process.env.MAX_URLS_TO_SCRAPE || '50', 10),
    };
  } catch (error) {
    console.error('[SETTINGS] Failed to load settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Update settings (partial update supported)
 */
export async function updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
  try {
    const current = await getSettings();
    const merged = { ...current, ...updates };

    // Use raw query to handle both old and new schema gracefully
    // The 'regions' column was added to replace 'country'
    await prisma.$executeRaw`
      INSERT INTO Settings (id, regions, language, categoriesEnabled, maxSearchQueries, maxUrlsToScrape, sourcesPerCategory, displayTimeFrame, updatedAt)
      VALUES ('default', ${merged.regions.join(',')}, ${merged.language}, ${merged.categoriesEnabled.join(',')}, ${merged.maxSearchQueries}, ${merged.maxUrlsToScrape}, ${merged.sourcesPerCategory}, ${merged.displayTimeFrame}, ${new Date().toISOString()})
      ON CONFLICT(id) DO UPDATE SET
        regions = ${merged.regions.join(',')},
        language = ${merged.language},
        categoriesEnabled = ${merged.categoriesEnabled.join(',')},
        maxSearchQueries = ${merged.maxSearchQueries},
        maxUrlsToScrape = ${merged.maxUrlsToScrape},
        sourcesPerCategory = ${merged.sourcesPerCategory},
        displayTimeFrame = ${merged.displayTimeFrame},
        updatedAt = ${new Date().toISOString()}
    `;

    console.log('[SETTINGS] Updated settings:', merged);
    return merged;
  } catch (error) {
    console.error('[SETTINGS] Failed to update settings:', error);
    throw error;
  }
}

/**
 * Clear all caches (for rescan functionality)
 * Deletes all LLMCache entries to force fresh data on next request
 */
export async function clearAllCaches(): Promise<{ cleared: number }> {
  try {
    const result = await prisma.lLMCache.deleteMany({});
    console.log(`[SETTINGS] Cleared ${result.count} cache entries`);
    return { cleared: result.count };
  } catch (error) {
    console.error('[SETTINGS] Failed to clear caches:', error);
    throw error;
  }
}

/**
 * Validate settings input
 */
export function validateSettings(input: Partial<AppSettings>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (input.regions !== undefined) {
    if (!Array.isArray(input.regions) || input.regions.length === 0) {
      errors.push('At least one region must be selected');
    }
  }

  if (input.language !== undefined) {
    const validLanguages: AppLanguage[] = ['en', 'he', 'ru'];
    if (!validLanguages.includes(input.language)) {
      errors.push(`Invalid language: ${input.language}`);
    }
  }

  if (input.categoriesEnabled !== undefined) {
    if (!Array.isArray(input.categoriesEnabled) || input.categoriesEnabled.length === 0) {
      errors.push('At least one category must be enabled');
    }
    const validCategories: ContentCategory[] = ['news', 'events', 'tech', 'social', 'weather'];
    for (const cat of input.categoriesEnabled) {
      if (!validCategories.includes(cat)) {
        errors.push(`Invalid category: ${cat}`);
      }
    }
  }

  if (input.maxSearchQueries !== undefined) {
    if (input.maxSearchQueries < 1 || input.maxSearchQueries > 100) {
      errors.push('Search queries must be between 1 and 100');
    }
  }

  if (input.maxUrlsToScrape !== undefined) {
    if (input.maxUrlsToScrape < 50 || input.maxUrlsToScrape > 500) {
      errors.push('URLs to scrape must be between 50 and 500');
    }
  }

  if (input.sourcesPerCategory !== undefined) {
    if (input.sourcesPerCategory < 2 || input.sourcesPerCategory > 8) {
      errors.push('Sources per category must be between 2 and 8');
    }
  }

  if (input.displayTimeFrame !== undefined) {
    const validTimeFrames: DisplayTimeFrame[] = ['1d', '1w', '1m', '1y', 'all'];
    if (!validTimeFrames.includes(input.displayTimeFrame)) {
      errors.push(`Invalid time frame: ${input.displayTimeFrame}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
