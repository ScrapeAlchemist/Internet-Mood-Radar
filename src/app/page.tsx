'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { PulseResponse } from '@/types';
import { MapControls } from '@/components/map';
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

type TimeWindow = '1h' | '6h' | '24h';

// Session storage keys for persisting state across navigation
const STORAGE_KEY_DATA = 'pulse_data';
const STORAGE_KEY_SCANNED = 'has_scanned';

function MapPageContent() {
  const { t, setLanguage } = useLanguage();
  const [window, setWindow] = useState<TimeWindow>('6h');
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

  // Separate news receipts from events - use allReceipts for full coverage on map
  const { newsReceipts, eventReceipts, distinctSourceCount } = useMemo(() => {
    if (!data) return { newsReceipts: [], eventReceipts: [], distinctSourceCount: 0 };
    // Use allReceipts instead of receiptsFeed to show all items on map
    const receipts = data.allReceipts || data.receiptsFeed || [];
    console.log('[PAGE] Total receipts for map:', receipts.length);
    const news = receipts.filter((r) => r.source !== 'events');
    const events = receipts.filter((r) => r.source === 'events');
    console.log('[PAGE] News receipts:', news.length, 'Event receipts:', events.length);
    // Count distinct sources (unique source types like 'search', 'reddit', etc.)
    const uniqueSources = new Set(news.map((r) => r.source));
    return {
      newsReceipts: news,
      eventReceipts: events,
      distinctSourceCount: uniqueSources.size,
    };
  }, [data]);

  // Get selected country's mood data (or overall if none selected)
  const selectedMood = useMemo(() => {
    if (!data) return null;

    // Debug: log available country moods
    if (data.countryMoods) {
      console.log('[PAGE] Available countryMoods:', data.countryMoods.map(m => `${m.country}(${m.itemCount})`).join(', '));
    }

    if (!selectedCountry) {
      // Return overall data
      return {
        tensionIndex: data.tensionIndex,
        summary: data.overallSummary,
        itemCount: data.allReceipts?.length ?? 0,
      };
    }

    console.log('[PAGE] Looking for country:', selectedCountry);

    // Find the selected country's mood
    const countryMood = data.countryMoods?.find(
      (m) => m.country === selectedCountry
    );

    if (!countryMood) {
      console.log('[PAGE] Country not found in countryMoods, no data for this country');
      return null; // No data for this country - don't show any summary
    }

    console.log('[PAGE] Found countryMood:', countryMood);

    // Use LLM-generated summary if available, otherwise fallback
    const summary = countryMood.summary ||
      `${selectedCountry}: ${countryMood.itemCount} news items, tension ${countryMood.tensionIndex}/100`;

    return {
      tensionIndex: countryMood.tensionIndex,
      summary,
      itemCount: countryMood.itemCount,
    };
  }, [data, selectedCountry]);

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
        const fetchUrl = `/api/pulse?window=${window}&_t=${Date.now()}`;
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

    // Only fetch if explicitly rescanning (fetchKey > 0) or no data yet
    console.log('[PAGE] useEffect triggered, fetchKey:', fetchKey, 'hasData:', !!data);
    if (fetchKey > 0 || !data) {
      fetchPulse();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [window, fetchKey, hasScanned, initialized]);

  const handleWindowChange = useCallback((newWindow: TimeWindow) => {
    setWindow(newWindow);
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
            tensionIndex={data.tensionIndex}
            countryMoods={data.countryMoods}
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
        window={window}
        onWindowChange={handleWindowChange}
        tensionIndex={selectedMood?.tensionIndex ?? data?.tensionIndex ?? 0}
        topicCount={data?.topics.length ?? 0}
        sourceCount={distinctSourceCount}
        totalCount={data?.allReceipts?.length ?? 0}
        eventCount={eventReceipts.length}
        showEvents={showEvents}
        onToggleEvents={setShowEvents}
        onOpenSettings={() => setShowSettings(true)}
        onOpenNewsFeed={() => setShowNewsFeed(true)}
        loading={loading}
        selectedCountry={selectedCountry}
        onClearSelection={() => setSelectedCountry(null)}
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
        receipts={data?.allReceipts ?? []}
        isOpen={showNewsFeed}
        onClose={() => setShowNewsFeed(false)}
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
