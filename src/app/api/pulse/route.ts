import { NextRequest, NextResponse } from 'next/server';
import { runPipeline, TimeWindow } from '@/lib/pipeline';
import {
  checkRateLimit,
  getClientIdentifier,
  PULSE_RATE_LIMIT,
} from '@/lib/ratelimit';
import { getCachedPulse, cachePulse } from '@/lib/pulse-cache';
import { getSettings } from '@/lib/settings';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Valid time windows for the pulse endpoint
const VALID_WINDOWS: readonly TimeWindow[] = ['1h', '6h', '24h'] as const;

/**
 * Validate and sanitize query parameters
 */
function validateQueryParams(searchParams: URLSearchParams): {
  window: TimeWindow;
  errors: string[];
} {
  const errors: string[] = [];
  const windowParam = searchParams.get('window');

  // Validate window parameter
  let window: TimeWindow = '6h'; // default
  if (windowParam !== null) {
    if (VALID_WINDOWS.includes(windowParam as TimeWindow)) {
      window = windowParam as TimeWindow;
    } else {
      errors.push(`Invalid window parameter: "${windowParam}". Must be one of: ${VALID_WINDOWS.join(', ')}`);
    }
  }

  // Check for unexpected parameters (security: reject unknown params)
  // Allow _t for cache-busting timestamps
  const knownParams = new Set(['window', '_t']);
  for (const [key] of searchParams.entries()) {
    if (!knownParams.has(key)) {
      errors.push(`Unknown parameter: "${key}"`);
    }
  }

  return { window, errors };
}

export async function GET(request: NextRequest) {
  // Rate limiting
  const clientId = getClientIdentifier(request.headers);
  const rateLimit = checkRateLimit(clientId, PULSE_RATE_LIMIT);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: 'Too many requests',
        message: 'Please wait before making another request',
        retryAfter: Math.ceil((rateLimit.resetAt - Date.now()) / 1000),
      },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
          'X-RateLimit-Limit': String(PULSE_RATE_LIMIT.maxRequests),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
        },
      }
    );
  }

  // Validate query parameters
  const { window, errors: validationErrors } = validateQueryParams(request.nextUrl.searchParams);

  // Return 400 for invalid parameters
  if (validationErrors.length > 0) {
    return NextResponse.json(
      {
        error: 'Invalid request parameters',
        details: validationErrors,
      },
      { status: 400 }
    );
  }

  try {
    // Check cache first (24-hour TTL)
    const cached = await getCachedPulse(window);
    if (cached) {
      console.log(`[Pulse API] Cache HIT for window=${window}, returning ${cached.allReceipts?.length || 0} items`);
      return NextResponse.json(cached, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Cache': 'HIT',
          'X-RateLimit-Limit': String(PULSE_RATE_LIMIT.maxRequests),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
        },
      });
    }
    console.log(`[Pulse API] Cache MISS for window=${window}, running pipeline`);

    // Cache miss - run full pipeline
    // Get language from settings
    const settings = await getSettings();
    const pulse = await runPipeline({ window, language: settings.language });

    // Cache the result for 24 hours
    await cachePulse(window, pulse);

    return NextResponse.json(pulse, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        'X-Cache': 'MISS',
        'X-RateLimit-Limit': String(PULSE_RATE_LIMIT.maxRequests),
        'X-RateLimit-Remaining': String(rateLimit.remaining),
        'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
      },
    });
  } catch (error) {
    console.error('Pipeline error:', error);

    // On error, try to return stale cache if available
    const staleCache = await getCachedPulse(window);
    if (staleCache) {
      console.log('[Pulse API] Returning stale cache due to pipeline error');
      return NextResponse.json(staleCache, {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
          'X-Cache': 'STALE',
          'X-RateLimit-Limit': String(PULSE_RATE_LIMIT.maxRequests),
          'X-RateLimit-Remaining': String(rateLimit.remaining),
          'X-RateLimit-Reset': String(Math.ceil(rateLimit.resetAt / 1000)),
        },
      });
    }

    return NextResponse.json(
      {
        error: 'Failed to fetch pulse data',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
