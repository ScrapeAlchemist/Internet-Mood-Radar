import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { PulseResponse, Receipt } from '@/types';

export const dynamic = 'force-dynamic';

const CACHE_KEY_PREFIX = 'pulse:';

/**
 * Migrate cached pulse data to include lens field from database
 * This allows proper category filtering without running a new scan
 */
export async function POST() {
  try {
    // Get all pulse caches
    const caches = await prisma.lLMCache.findMany({
      where: {
        cacheKey: {
          startsWith: CACHE_KEY_PREFIX,
        },
      },
    });

    if (caches.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No cached pulse data found',
        updated: 0,
      });
    }

    console.log(`[Migrate] Found ${caches.length} cached pulses to update`);

    // Get all historical items with their lens values
    const historicalItems = await prisma.historicalItem.findMany({
      select: {
        id: true,
        lens: true,
        source: true,
      },
    });

    // Create lookup map by ID
    const lensLookup = new Map<string, { lens: string; source: string }>();
    for (const item of historicalItems) {
      lensLookup.set(item.id, { lens: item.lens, source: item.source });
    }

    console.log(`[Migrate] Built lookup map with ${lensLookup.size} items`);

    let totalUpdated = 0;
    let receiptsUpdated = 0;

    for (const cache of caches) {
      try {
        const data = JSON.parse(cache.output) as PulseResponse;
        let modified = false;

        // Update allReceipts
        if (data.allReceipts) {
          for (const receipt of data.allReceipts) {
            const lookup = lensLookup.get(receipt.id);
            if (lookup && !receipt.lens) {
              receipt.lens = lookup.lens as Receipt['lens'];
              receipt.sourceType = lookup.source as Receipt['sourceType'];
              modified = true;
              receiptsUpdated++;
            }
          }
        }

        // Update receiptsFeed
        if (data.receiptsFeed) {
          for (const receipt of data.receiptsFeed) {
            const lookup = lensLookup.get(receipt.id);
            if (lookup && !receipt.lens) {
              receipt.lens = lookup.lens as Receipt['lens'];
              receipt.sourceType = lookup.source as Receipt['sourceType'];
              modified = true;
            }
          }
        }

        // Update receipts in topics
        if (data.topics) {
          for (const topic of data.topics) {
            if (topic.receipts) {
              for (const receipt of topic.receipts) {
                const lookup = lensLookup.get(receipt.id);
                if (lookup && !receipt.lens) {
                  receipt.lens = lookup.lens as Receipt['lens'];
                  receipt.sourceType = lookup.source as Receipt['sourceType'];
                  modified = true;
                }
              }
            }
          }
        }

        // Save updated cache if modified
        if (modified) {
          await prisma.lLMCache.update({
            where: { cacheKey: cache.cacheKey },
            data: {
              output: JSON.stringify(data),
            },
          });
          totalUpdated++;
          console.log(`[Migrate] Updated cache: ${cache.cacheKey}`);
        }
      } catch (error) {
        console.error(`[Migrate] Error processing cache ${cache.cacheKey}:`, error);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Migration complete`,
      cachesProcessed: caches.length,
      cachesUpdated: totalUpdated,
      receiptsUpdated,
      lookupSize: lensLookup.size,
    });
  } catch (error) {
    console.error('[Migrate] Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to check migration status
 */
export async function GET() {
  try {
    // Check current cache state
    const caches = await prisma.lLMCache.findMany({
      where: {
        cacheKey: {
          startsWith: CACHE_KEY_PREFIX,
        },
      },
    });

    const results = [];

    for (const cache of caches) {
      try {
        const data = JSON.parse(cache.output) as PulseResponse;
        const totalReceipts = data.allReceipts?.length || 0;
        const withLens = data.allReceipts?.filter(r => r.lens).length || 0;
        const withoutLens = totalReceipts - withLens;

        results.push({
          window: cache.cacheKey.replace(CACHE_KEY_PREFIX, ''),
          totalReceipts,
          withLens,
          withoutLens,
          needsMigration: withoutLens > 0,
        });
      } catch {
        results.push({
          window: cache.cacheKey.replace(CACHE_KEY_PREFIX, ''),
          error: 'Failed to parse cache',
        });
      }
    }

    // Count historical items with lens
    const historicalCount = await prisma.historicalItem.count();
    const withLensCount = await prisma.historicalItem.count({
      where: {
        lens: {
          not: '',
        },
      },
    });

    return NextResponse.json({
      caches: results,
      historicalItems: {
        total: historicalCount,
        withLens: withLensCount,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
