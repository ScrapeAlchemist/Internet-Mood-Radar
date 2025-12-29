import { NextRequest, NextResponse } from 'next/server';
import {
  getHistoricalPulses,
  getTensionTrend,
  getHistoryStats,
  cleanupOldHistory,
  clearAllHistory,
  getEmotionAverages,
  getSourceBreakdown,
  getCountryMoodRanking,
  getTopTopics,
  getHistoricalItemsWithDetails,
  getHeadlineHighlights,
} from '@/lib/history';

// Valid actions for the history endpoint
const VALID_ACTIONS = ['pulses', 'trend', 'stats', 'cleanup', 'emotions', 'sources', 'countries', 'topics', 'items', 'dashboard'] as const;
type ValidAction = typeof VALID_ACTIONS[number];

// Valid windows for trend action
const VALID_WINDOWS = ['1h', '6h', '24h'] as const;

// Parameter constraints
const MAX_HOURS = 720; // 30 days max
const MAX_LIMIT = 500;
const MAX_DAYS = 365;

/**
 * Safely parse an integer with bounds checking
 */
function safeParseInt(value: string | null, defaultValue: number, min: number, max: number): number {
  if (value === null) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Validate and sanitize query parameters
 */
function validateQueryParams(searchParams: URLSearchParams): {
  action: ValidAction;
  hours: number;
  limit: number;
  days: number;
  window: string | undefined;
  errors: string[];
} {
  const errors: string[] = [];

  // Validate action
  const actionParam = searchParams.get('action');
  let action: ValidAction = 'pulses';
  if (actionParam !== null) {
    if (VALID_ACTIONS.includes(actionParam as ValidAction)) {
      action = actionParam as ValidAction;
    } else {
      errors.push(`Invalid action: "${actionParam}". Must be one of: ${VALID_ACTIONS.join(', ')}`);
    }
  }

  // Validate hours (1-720)
  const hoursParam = searchParams.get('hours');
  const hours = safeParseInt(hoursParam, 24, 1, MAX_HOURS);
  if (hoursParam !== null && (isNaN(parseInt(hoursParam, 10)) || parseInt(hoursParam, 10) < 1)) {
    errors.push(`Invalid hours: "${hoursParam}". Must be a positive integer (max: ${MAX_HOURS})`);
  }

  // Validate limit (1-500)
  const limitParam = searchParams.get('limit');
  const limit = safeParseInt(limitParam, 50, 1, MAX_LIMIT);
  if (limitParam !== null && (isNaN(parseInt(limitParam, 10)) || parseInt(limitParam, 10) < 1)) {
    errors.push(`Invalid limit: "${limitParam}". Must be a positive integer (max: ${MAX_LIMIT})`);
  }

  // Validate days (1-365)
  const daysParam = searchParams.get('days');
  const days = safeParseInt(daysParam, 30, 1, MAX_DAYS);
  if (daysParam !== null && (isNaN(parseInt(daysParam, 10)) || parseInt(daysParam, 10) < 1)) {
    errors.push(`Invalid days: "${daysParam}". Must be a positive integer (max: ${MAX_DAYS})`);
  }

  // Validate window for trend action
  const windowParam = searchParams.get('window');
  let window: string | undefined;
  if (windowParam !== null) {
    if (VALID_WINDOWS.includes(windowParam as typeof VALID_WINDOWS[number])) {
      window = windowParam;
    } else {
      errors.push(`Invalid window: "${windowParam}". Must be one of: ${VALID_WINDOWS.join(', ')}`);
    }
  }

  return { action, hours, limit, days, window, errors };
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Validate query parameters
    const { action, hours, limit, days, window, errors: validationErrors } = validateQueryParams(searchParams);

    if (validationErrors.length > 0) {
      return NextResponse.json(
        {
          error: 'Invalid request parameters',
          details: validationErrors,
        },
        { status: 400 }
      );
    }

    switch (action) {
      case 'trend': {
        const trend = await getTensionTrend(hours, window);
        return NextResponse.json({ trend });
      }

      case 'stats': {
        const stats = await getHistoryStats();
        return NextResponse.json({ stats });
      }

      case 'cleanup': {
        const result = await cleanupOldHistory(days);
        return NextResponse.json({ cleaned: result });
      }

      case 'emotions': {
        const emotions = await getEmotionAverages(hours);
        return NextResponse.json({ emotions });
      }

      case 'sources': {
        const sources = await getSourceBreakdown(hours);
        return NextResponse.json({ sources });
      }

      case 'countries': {
        const countryMoods = await getCountryMoodRanking(hours);
        return NextResponse.json({ countryMoods });
      }

      case 'topics': {
        const topics = await getTopTopics(hours, limit);
        return NextResponse.json({ topics });
      }

      case 'items': {
        const items = await getHistoricalItemsWithDetails(hours, limit);
        return NextResponse.json({ items });
      }

      case 'dashboard': {
        // Return all dashboard data in one call for efficiency
        const [trend, stats, emotions, sources, countryMoods, topics, items, headlines] = await Promise.all([
          getTensionTrend(hours, window),
          getHistoryStats(),
          getEmotionAverages(hours),
          getSourceBreakdown(hours),
          getCountryMoodRanking(hours),
          getTopTopics(hours, 10),
          getHistoricalItemsWithDetails(hours, limit),
          getHeadlineHighlights(hours, 5),
        ]);
        return NextResponse.json({
          trend,
          stats,
          emotions,
          sources,
          countryMoods,
          topics,
          items,
          headlines,
        });
      }

      case 'pulses':
      default: {
        const pulses = await getHistoricalPulses(hours, limit);
        return NextResponse.json({ pulses });
      }
    }
  } catch (error) {
    console.error('[API /history] Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/history
 * Clear all historical data (pulses, items, and cache)
 */
export async function DELETE() {
  try {
    const result = await clearAllHistory();
    return NextResponse.json({
      success: true,
      deleted: result,
    });
  } catch (error) {
    console.error('[API /history] DELETE Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
