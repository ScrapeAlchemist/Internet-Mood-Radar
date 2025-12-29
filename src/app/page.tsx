'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { PulseResponse, EmotionDistribution } from '@/types';
import { MapControls, ALL_CATEGORIES, ContentCategory, CategoryCounts } from '@/components/map';
import { ErrorBoundary } from '@/components';
import { SettingsModal } from '@/components/SettingsModal';
import { NewsFeed } from '@/components/NewsFeed';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { AppLanguage } from '@/lib/translations';
import { ScanStatusIndicator } from '@/components/ScanStatusIndicator';

// Dynamic import for Leaflet (SSR incompatible)
const WorldMap = dynamic(
  () => import('@/components/map/WorldMap').then((mod) => mod.WorldMap),
  {
    ssr: false,
    loading: () => (
      <div className="map-loading">
        <div className="map-spinner" />
        <p>Loading map...</p>
      </div>
    ),
  }
);

type TimeWindow = '1d' | '1w' | '1m';

// Time frame durations in milliseconds
const TIME_FRAME_MS: Record<TimeWindow, number> = {
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
  '1m': 30 * 24 * 60 * 60 * 1000,
};

// Session storage keys for persisting state across navigation
const STORAGE_KEY_DATA = 'pulse_data';
const STORAGE_KEY_SCANNED = 'has_scanned';

function MapPageContent() {
  const { t, setLanguage } = useLanguage();
  const [timeFrame, setTimeFrame] = useState<TimeWindow>('1d');
  const [data, setData] = useState<PulseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [showEvents, setShowEvents] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewsFeed, setShowNewsFeed] = useState(false);
  const [hasScanned, setHasScanned] = useState(false); // Track if user has triggered a scan
  const [fetchKey, setFetchKey] = useState(0); // Used to trigger re-fetch
  const [initialized, setInitialized] = useState(false);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<Set<ContentCategory>>(
    new Set(ALL_CATEGORIES)
  );

  // Restore state from sessionStorage on mount
  useEffect(() => {
    try {
      const savedScanned = sessionStorage.getItem(STORAGE_KEY_SCANNED);
      const savedData = sessionStorage.getItem(STORAGE_KEY_DATA);

      if (savedScanned === 'true') {
        setHasScanned(true);
        if (savedData) {
          try {
            const parsed = JSON.parse(savedData);
            console.log('[PAGE] Restoring from sessionStorage:', parsed.allReceipts?.length, 'receipts');
            // Restore dates
            if (parsed.fetchedAt) parsed.fetchedAt = new Date(parsed.fetchedAt);
            if (parsed.allReceipts) {
              parsed.allReceipts.forEach((r: { createdAt?: string | Date }) => {
                if (r.createdAt) r.createdAt = new Date(r.createdAt);
              });
            }
            if (parsed.receiptsFeed) {
              parsed.receiptsFeed.forEach((r: { createdAt?: string | Date }) => {
                if (r.createdAt) r.createdAt = new Date(r.createdAt);
              });
            }
            setData(parsed);
          } catch {
            // Invalid cached data, will re-fetch
          }
        }
      }
    } catch {
      // sessionStorage not available
    }
    setInitialized(true);
  }, []);

  // Save state to sessionStorage when it changes
  useEffect(() => {
    if (!initialized) return;
    try {
      sessionStorage.setItem(STORAGE_KEY_SCANNED, hasScanned ? 'true' : 'false');
      if (data) {
        console.log('[PAGE] Saving to sessionStorage:', data.allReceipts?.length, 'receipts');
        sessionStorage.setItem(STORAGE_KEY_DATA, JSON.stringify(data));
      }
    } catch {
      // sessionStorage not available or quota exceeded
    }
  }, [hasScanned, data, initialized]);

  // Load initial language from settings
  useEffect(() => {
    async function loadInitialLanguage() {
      try {
        const response = await fetch('/api/settings');
        if (response.ok) {
          const settings = await response.json();
          if (settings.language) {
            setLanguage(settings.language as AppLanguage);
          }
        }
      } catch {
        // Use default language on error
      }
    }
    loadInitialLanguage();
  }, [setLanguage]);

  // Try to load cached data on startup (even if user hasn't scanned in this session)
  useEffect(() => {
    if (!initialized) return;
    if (data) return; // Already have data from sessionStorage

    async function loadCachedData() {
      try {
        console.log('[PAGE] Checking for cached data on startup...');
        const response = await fetch('/api/pulse?_t=' + Date.now(), {
          cache: 'no-store',
        });

        if (response.ok) {
          const cacheHeader = response.headers.get('X-Cache');
          // Only use if it's cached data (HIT or STALE), don't trigger new pipeline
          if (cacheHeader === 'HIT' || cacheHeader === 'STALE') {
            const pulse = await response.json();
            if (pulse.allReceipts?.length > 0) {
              console.log('[PAGE] Found cached data:', pulse.allReceipts.length, 'receipts');
              setData(pulse);
              setHasScanned(true); // Mark as having data
            }
          }
        }
      } catch (err) {
        console.log('[PAGE] No cached data available:', err);
      }
    }

    loadCachedData();
  }, [initialized, data]);

  // Filter receipts by time frame (client-side)
  const timeFilteredReceipts = useMemo(() => {
    if (!data) return [];
    const receipts = data.allReceipts || data.receiptsFeed || [];
    const cutoff = new Date(Date.now() - TIME_FRAME_MS[timeFrame]);

    const filtered = receipts.filter((r) => {
      if (!r.createdAt) return true; // Include items without createdAt
      const createdAt = new Date(r.createdAt);
      return createdAt >= cutoff;
    });

    console.log(`[PAGE] Time filter: ${timeFrame}, cutoff: ${cutoff.toISOString()}, ${filtered.length}/${receipts.length} items`);
    return filtered;
  }, [data, timeFrame]);

  // Helper to categorize a receipt based on lens field
  const getReceiptCategory = useCallback((receipt: { lens?: string; sourceType?: string; source?: string }): ContentCategory => {
    // Use lens field if available (new data)
    if (receipt.lens) {
      switch (receipt.lens) {
        case 'Events': return 'events';
        case 'Tech': return 'tech';
        case 'Weather': return 'weather';
        case 'Conversation': return 'social';
        case 'Headlines':
        default: return 'news';
      }
    }
    // Fallback to sourceType for older data
    const sourceType = receipt.sourceType || receipt.source;
    if (sourceType === 'events') return 'events';
    if (sourceType === 'hn') return 'tech';
    if (sourceType === 'reddit' || sourceType === 'telegram') return 'social';
    return 'news'; // rss, search, and others default to news
  }, []);

  // Calculate category counts
  const categoryCounts: CategoryCounts = useMemo(() => {
    const counts: CategoryCounts = { news: 0, events: 0, tech: 0, social: 0, weather: 0 };
    if (timeFilteredReceipts.length === 0) return counts;

    for (const r of timeFilteredReceipts) {
      const cat = getReceiptCategory(r);
      counts[cat]++;
    }

    console.log('[PAGE] Category counts:', counts);
    return counts;
  }, [timeFilteredReceipts, getReceiptCategory]);

  // Filter receipts by selected categories (multi-select) - only affects display, not mood calculations
  const categoryFilteredReceipts = useMemo(() => {
    // If all categories selected, return all
    if (selectedCategories.size === ALL_CATEGORIES.length) return timeFilteredReceipts;
    // If none selected, also return all (to avoid empty state)
    if (selectedCategories.size === 0) return timeFilteredReceipts;
    return timeFilteredReceipts.filter((r) => selectedCategories.has(getReceiptCategory(r)));
  }, [timeFilteredReceipts, selectedCategories, getReceiptCategory]);

  // Toggle a category on/off (at least one must remain selected)
  const handleCategoryToggle = useCallback((category: ContentCategory) => {
    setSelectedCategories(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        // Don't allow deselecting the last category
        if (next.size <= 1) return prev;
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  // Separate news receipts from events - use category filtered receipts for map display
  const { newsReceipts, eventReceipts, distinctSourceCount } = useMemo(() => {
    if (categoryFilteredReceipts.length === 0) return { newsReceipts: [], eventReceipts: [], distinctSourceCount: 0 };

    const news = categoryFilteredReceipts.filter((r) => r.source !== 'events');
    const events = categoryFilteredReceipts.filter((r) => r.source === 'events');
    console.log('[PAGE] News receipts:', news.length, 'Event receipts:', events.length);
    // Count distinct sources (unique source types like 'search', 'reddit', etc.)
    const uniqueSources = new Set(news.map((r) => r.source));
    return {
      newsReceipts: news,
      eventReceipts: events,
      distinctSourceCount: uniqueSources.size,
    };
  }, [categoryFilteredReceipts]);

  // Recalculate country moods based on filtered receipts
  const filteredCountryMoods = useMemo(() => {
    if (timeFilteredReceipts.length === 0) return [];

    // Group receipts by country
    const byCountry = new Map<string, typeof timeFilteredReceipts>();
    for (const r of timeFilteredReceipts) {
      if (r.location?.country) {
        const existing = byCountry.get(r.location.country) || [];
        existing.push(r);
        byCountry.set(r.location.country, existing);
      }
    }

    // Calculate mood for each country
    return Array.from(byCountry.entries()).map(([country, receipts]) => {
      // Calculate average mood score from items
      const moodScores = receipts.filter(r => r.moodScore !== undefined).map(r => r.moodScore as number);
      const avgMood = moodScores.length > 0
        ? Math.round(moodScores.reduce((a, b) => a + b, 0) / moodScores.length)
        : 50;

      // Tension is inverse of mood (high mood = low tension)
      const tensionIndex = 100 - avgMood;

      // Default neutral emotion distribution for client-side calculated moods
      const defaultEmotions: EmotionDistribution = {
        anger: 0,
        anxiety: 0,
        sadness: 0,
        resilience: 0,
        hope: 0,
        excitement: 0,
        cynicism: 0,
        neutral: 1,
      };

      // Try to get LLM-generated summary from original data
      const originalMood = data?.countryMoods?.find(m => m.country === country);
      const llmSummary = originalMood?.summary;

      // Use LLM summary if available, otherwise generate a fallback
      const fallbackSummary = `${country}: ${receipts.length} items in the ${timeFrame === '1d' ? 'last 24 hours' : timeFrame === '1w' ? 'last week' : 'last month'}`;

      return {
        country,
        tensionIndex,
        itemCount: receipts.length,
        emotions: defaultEmotions,
        summary: llmSummary || fallbackSummary,
      };
    }).sort((a, b) => b.itemCount - a.itemCount);
  }, [timeFilteredReceipts, timeFrame, data?.countryMoods]);

  // Get selected country's mood data (or overall if none selected)
  const selectedMood = useMemo(() => {
    if (!data) return null;

    if (!selectedCountry) {
      // Calculate overall tension from filtered receipts
      const moodScores = timeFilteredReceipts.filter(r => r.moodScore !== undefined).map(r => r.moodScore as number);
      const avgMood = moodScores.length > 0
        ? Math.round(moodScores.reduce((a, b) => a + b, 0) / moodScores.length)
        : 50;
      const overallTension = 100 - avgMood;

      return {
        tensionIndex: overallTension,
        summary: data.overallSummary,
        itemCount: timeFilteredReceipts.length,
      };
    }

    console.log('[PAGE] Looking for country:', selectedCountry);

    // Find the selected country's mood from filtered data
    const countryMood = filteredCountryMoods.find(
      (m) => m.country === selectedCountry
    );

    if (!countryMood) {
      console.log('[PAGE] Country not found in filtered moods');
      return null;
    }

    return {
      tensionIndex: countryMood.tensionIndex,
      summary: countryMood.summary,
      itemCount: countryMood.itemCount,
    };
  }, [data, selectedCountry, timeFilteredReceipts, filteredCountryMoods]);

  // Only fetch when user explicitly triggers a scan (via fetchKey change)
  // fetchKey > 0 means user clicked rescan, so always fetch
  // fetchKey === 0 means initial load, only fetch if no cached data
  useEffect(() => {
    if (!initialized) return; // Wait for initialization
    if (!hasScanned) return; // Don't auto-scan on page load

    async function fetchPulse() {
      console.log('[PAGE] fetchPulse called');
      setLoading(true);
      setError(null);

      try {
        // Fetch all data - time filtering is done client-side
        const fetchUrl = `/api/pulse?_t=${Date.now()}`;
        console.log('[PAGE] Fetching from:', fetchUrl);
        const response = await fetch(fetchUrl, {
          cache: 'no-store',
        });
        console.log('[PAGE] Response status:', response.status, 'X-Cache:', response.headers.get('X-Cache'));
        if (!response.ok) {
          throw new Error(`Failed to fetch: ${response.statusText}`);
        }
        const pulse = await response.json();
        console.log('[PAGE] Got pulse data with', pulse.allReceipts?.length, 'receipts, fetchedAt:', pulse.fetchedAt);
        setData(pulse);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }

    // Always fetch fresh data from API (the API has its own cache)
    // This ensures we get the latest data after scans complete
    console.log('[PAGE] useEffect triggered, fetchKey:', fetchKey, 'hasData:', !!data);
    fetchPulse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey, hasScanned, initialized]);

  const handleTimeFrameChange = useCallback((newTimeFrame: TimeWindow) => {
    setTimeFrame(newTimeFrame);
  }, []);

  // Handle rescan - now triggers background scan
  const handleRescan = useCallback(() => {
    setHasScanned(true); // Mark that user triggered a scan
    // Don't clear data - let user browse existing data while scan runs in background
    // The ScanStatusIndicator will show progress and trigger refresh on completion

    // Start watching for scan status updates
    const startWatch = (window as unknown as { startScanStatusWatch?: () => void }).startScanStatusWatch;
    if (startWatch) {
      startWatch();
    }
  }, []);

  // Handle scan complete - refresh data
  const handleScanComplete = useCallback(() => {
    console.log('[PAGE] Scan complete callback triggered, incrementing fetchKey');
    // Refresh the pulse data after background scan completes
    setFetchKey((k) => {
      console.log('[PAGE] fetchKey changing from', k, 'to', k + 1);
      return k + 1;
    });
  }, []);

  // Handle history cleared - reset to initial welcome state
  const handleHistoryCleared = useCallback(() => {
    setHasScanned(false);
    setData(null);
    setSelectedCountry(null);
    setError(null);
    // Clear sessionStorage
    try {
      sessionStorage.removeItem(STORAGE_KEY_DATA);
      sessionStorage.removeItem(STORAGE_KEY_SCANNED);
    } catch {
      // sessionStorage not available
    }
  }, []);

  // Handle collect data from a specific country
  const handleCollectCountryData = useCallback(async (country: string) => {
    try {
      setLoading(true);
      // Get current settings
      const settingsRes = await fetch('/api/settings');
      if (!settingsRes.ok) throw new Error('Failed to load settings');
      const settings = await settingsRes.json();

      // Add country to regions if not already present
      const currentRegions = settings.regions || [];
      if (!currentRegions.includes(country)) {
        const newRegions = [...currentRegions, country];
        // Update settings with new region
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ regions: newRegions }),
        });
      }

      // Trigger a rescan to collect data
      handleRescan();
    } catch (err) {
      console.error('Failed to collect country data:', err);
      setError(err instanceof Error ? err.message : 'Failed to collect data');
      setLoading(false);
    }
  }, [handleRescan]);

  return (
    <div className="map-page">
      {/* Error banner */}
      {error && (
        <div className="map-error-banner">
          <strong>Error:</strong> {error}
        </div>
      )}

      {/* Map container */}
      <div className="map-container">
        {!initialized ? (
          // Show loading while restoring state from sessionStorage
          <div className="map-loading">
            <div className="map-spinner" />
            <p>Loading...</p>
          </div>
        ) : data ? (
          <WorldMap
            receipts={newsReceipts}
            events={eventReceipts}
            showEvents={showEvents}
            tensionIndex={selectedMood?.tensionIndex ?? data.tensionIndex}
            countryMoods={filteredCountryMoods}
            selectedCountry={selectedCountry}
            onCountrySelect={setSelectedCountry}
            onCollectCountryData={handleCollectCountryData}
          />
        ) : !hasScanned ? (
          <div className="map-welcome">
            <h1>{t.appTitle}</h1>
            <p>Configure your regions in Settings, then start scanning.</p>
            <div className="map-welcome-actions">
              <button
                className="btn-start-scan"
                onClick={() => setShowSettings(true)}
              >
                ⚙️ {t.settings}
              </button>
              <button
                className="btn-start-scan btn-primary"
                onClick={handleRescan}
              >
                🔍 Start Scan
              </button>
            </div>
          </div>
        ) : loading ? (
          <div className="map-loading">
            <div className="map-spinner" />
            <p>Scanning regions...</p>
          </div>
        ) : null}
      </div>

      {/* Map controls overlay */}
      <MapControls
        timeFrame={timeFrame}
        onTimeFrameChange={handleTimeFrameChange}
        tensionIndex={selectedMood?.tensionIndex ?? data?.tensionIndex ?? 0}
        topicCount={data?.topics.length ?? 0}
        sourceCount={distinctSourceCount}
        totalCount={timeFilteredReceipts.length}
        eventCount={eventReceipts.length}
        showEvents={showEvents}
        onToggleEvents={setShowEvents}
        onOpenSettings={() => setShowSettings(true)}
        onOpenNewsFeed={() => setShowNewsFeed(true)}
        loading={loading}
        selectedCountry={selectedCountry}
        onClearSelection={() => setSelectedCountry(null)}
        selectedCategories={selectedCategories}
        onCategoryToggle={handleCategoryToggle}
        categoryCounts={categoryCounts}
      />

      {/* Settings modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onRescan={handleRescan}
        onHistoryCleared={handleHistoryCleared}
        onScanComplete={handleScanComplete}
      />

      {/* News feed panel */}
      <NewsFeed
        receipts={timeFilteredReceipts}
        isOpen={showNewsFeed}
        onClose={() => setShowNewsFeed(false)}
        initialCategories={selectedCategories}
        onCategoriesChange={setSelectedCategories}
      />

      {/* Summary panel (toggleable) - only show when a country is selected */}
      {data && selectedCountry && selectedMood?.summary && (
        <div className={`summary-panel ${showSummary ? 'expanded' : ''}`}>
          <button
            className="summary-toggle"
            onClick={() => setShowSummary(!showSummary)}
          >
            {showSummary ? `▼ ${t.hideSummary}` : `▲ ${t.showSummary}`}
          </button>
          {showSummary && (
            <div className="summary-content">
              <p>{selectedMood.summary}</p>
              <div className="summary-meta">
                <span className="summary-country-badge">{selectedCountry}</span>
                {new Date(data.fetchedAt).toLocaleTimeString()}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scan status indicator (shows during background scans) */}
      <ScanStatusIndicator onScanComplete={handleScanComplete} />

    </div>
  );
}

export default function MapPage() {
  return (
    <ErrorBoundary>
      <LanguageProvider>
        <MapPageContent />
      </LanguageProvider>
    </ErrorBoundary>
  );
}
