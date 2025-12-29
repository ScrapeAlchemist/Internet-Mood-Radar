'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { ContentCategory } from '@/types';
import { AppLanguage, languageNames } from '@/lib/translations';
import { useLanguage } from '@/contexts/LanguageContext';

// Display time frame options
type DisplayTimeFrame = '1d' | '1w' | '1m' | '1y' | 'all';

const TIME_FRAME_LABELS: Record<DisplayTimeFrame, string> = {
  '1d': 'Last 24 hours',
  '1w': 'Last week',
  '1m': 'Last month',
  '1y': 'Last year',
  'all': 'All time',
};

interface AppSettings {
  regions: string[];
  language: AppLanguage;
  categoriesEnabled: ContentCategory[];
  maxSearchQueries: number;
  maxUrlsToScrape: number;
  sourcesPerCategory: number;
  displayTimeFrame: DisplayTimeFrame;
}

// Available regions for selection
const AVAILABLE_REGIONS = [
  'Middle East',
  'Europe',
  'North America',
  'Asia Pacific',
  'South America',
  'Africa',
];

/** Estimate token usage for a scan
 *
 * LLM calls per scan:
 * - Step 1: Query generation (5 categories × ~1200 tokens each)
 * - Step 1: URL selection (~200 tokens per URL)
 * - Step 1: Content extraction (~800 tokens per URL - includes title, summary, location, mood)
 * - Step 1: Geocoding (~150 tokens per item with location)
 * - Step 7: Country summaries (~200 tokens per country)
 *
 * Cached (30 days): region config, platform sources, country languages, geocoding results
 */
function estimateTokenUsage(settings: {
  maxSearchQueries: number;
  maxUrlsToScrape: number;
  regionsCount: number;
}): {
  tokens: number;
  tokensCached: number;
  costUSD: number;
  costCachedUSD: number;
} {
  const { maxSearchQueries, maxUrlsToScrape, regionsCount } = settings;

  // Per-item costs (content extraction + geocoding)
  const tokensPerItem = 950; // 800 extraction + 150 geocoding
  // Per-query costs (query generation)
  const tokensPerQuery = 1200;
  // URL selection cost
  const urlSelectionPerUrl = 200;
  // Base cost per region (config generation, platform sources, country languages - mostly cached)
  const tokensPerRegionBase = 2000;
  // Country summary cost (estimate ~10 countries per region on average)
  const countrySummaryTokens = 200 * 10 * regionsCount;

  const itemTokens = maxUrlsToScrape * tokensPerItem * regionsCount;
  const queryTokens = maxSearchQueries * tokensPerQuery * regionsCount;
  const urlSelectionTokens = maxUrlsToScrape * urlSelectionPerUrl * regionsCount;
  const baseTokens = tokensPerRegionBase * regionsCount;

  const totalTokens = itemTokens + queryTokens + urlSelectionTokens + baseTokens + countrySummaryTokens;
  const tokensCached = Math.round(totalTokens * 0.4);

  // GPT-4o-mini pricing: $0.15/1M input, $0.60/1M output (estimate 75% input, 25% output)
  const avgCostPerMillion = 0.75 * 0.15 + 0.25 * 0.60;
  const costUSD = (totalTokens / 1_000_000) * avgCostPerMillion;
  const costCachedUSD = (tokensCached / 1_000_000) * avgCostPerMillion;

  return {
    tokens: totalTokens,
    tokensCached,
    costUSD: Math.round(costUSD * 1000) / 1000,
    costCachedUSD: Math.round(costCachedUSD * 1000) / 1000,
  };
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRescan: () => void;
  onHistoryCleared?: () => void;
  onScanComplete?: () => void;
}

const ALL_LANGUAGES: AppLanguage[] = ['en', 'he', 'ru'];

// Category keys for translation lookup
const CATEGORY_KEYS: Record<ContentCategory, { labelKey: keyof import('@/lib/translations').Translations; description: string }> = {
  news: {
    labelKey: 'categoryNews',
    description: 'Breaking news, politics, security, economy',
  },
  social: {
    labelKey: 'categorySocial',
    description: 'Reddit discussions, forums, public opinion',
  },
  events: {
    labelKey: 'categoryEvents',
    description: 'Concerts, festivals, protests, sports',
  },
  weather: {
    labelKey: 'categoryWeather',
    description: 'Weather alerts, forecasts, conditions',
  },
  tech: {
    labelKey: 'categoryTech',
    description: 'Startups, funding, tech industry news',
  },
};

const ALL_CATEGORIES: ContentCategory[] = ['news', 'social', 'events', 'weather', 'tech'];

export function SettingsModal({ isOpen, onClose, onRescan, onHistoryCleared, onScanComplete }: SettingsModalProps) {
  const { t, setLanguage: setAppLanguage } = useLanguage();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rescanning, setRescanning] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  // Compute token/cost estimation
  const tokenEstimate = useMemo(() => {
    if (!settings) return null;
    return estimateTokenUsage({
      maxSearchQueries: settings.maxSearchQueries,
      maxUrlsToScrape: settings.maxUrlsToScrape,
      regionsCount: settings.regions.length,
    });
  }, [settings]);

  // Load settings when modal opens
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/settings');
      if (!response.ok) throw new Error('Failed to load settings');
      const data = await response.json();
      setSettings(data);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    setSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to save settings');
      }

      // Update app language immediately
      setAppLanguage(settings.language);
      setHasChanges(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const handleRescan = async () => {
    setRescanning(true);
    setError(null);
    try {
      // Save settings first if there are changes
      if (hasChanges && settings) {
        await fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings),
        });
        setHasChanges(false);
      }

      // Start background scan (returns immediately)
      const response = await fetch('/api/rescan', { method: 'POST' });
      const result = await response.json();

      if (!response.ok) {
        // Check if it's because a scan is already running
        if (response.status === 409) {
          // Scan already in progress - just close and let user watch progress
          onClose();
          onRescan();
          return;
        }
        throw new Error(result.error || 'Failed to start scan');
      }

      // Close modal immediately - scan runs in background
      onClose();
      onRescan();

      // Poll for scan completion and trigger callback when done
      const pollForCompletion = async () => {
        const maxAttempts = 300; // 5 minutes max (300 * 1000ms)
        let attempts = 0;

        const checkStatus = async () => {
          try {
            const statusRes = await fetch('/api/scan-status');
            if (statusRes.ok) {
              const status = await statusRes.json();
              console.log('[SettingsModal] Polling scan status:', status.phase);

              if (status.phase === 'complete') {
                console.log('[SettingsModal] Scan complete! Triggering onScanComplete');
                onScanComplete?.();
                return;
              } else if (status.phase === 'error') {
                console.error('[SettingsModal] Scan error:', status.error);
                return;
              } else if (status.phase === 'idle') {
                // Scan finished or was never started
                return;
              }
            }
          } catch (err) {
            console.error('[SettingsModal] Error polling status:', err);
          }

          attempts++;
          if (attempts < maxAttempts) {
            setTimeout(checkStatus, 1000);
          }
        };

        // Start polling after a brief delay
        setTimeout(checkStatus, 500);
      };

      pollForCompletion();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start scan');
    } finally {
      setRescanning(false);
    }
  };

  const handleClearHistory = async () => {
    setClearing(true);
    setError(null);
    try {
      const response = await fetch('/api/history', { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to clear history');

      setShowClearConfirm(false);
      // Reset app to initial state
      onClose();
      onHistoryCleared?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear history');
    } finally {
      setClearing(false);
    }
  };

  const toggleCategory = useCallback((category: ContentCategory) => {
    if (!settings) return;

    const current = settings.categoriesEnabled;
    const newCategories = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];

    // Must have at least one category
    if (newCategories.length === 0) return;

    setSettings({ ...settings, categoriesEnabled: newCategories });
    setHasChanges(true);
  }, [settings]);

  const toggleRegion = useCallback((region: string) => {
    if (!settings) return;

    const current = settings.regions;
    const newRegions = current.includes(region)
      ? current.filter((r) => r !== region)
      : [...current, region];

    // Must have at least one region
    if (newRegions.length === 0) return;

    setSettings({ ...settings, regions: newRegions });
    setHasChanges(true);
  }, [settings]);

  const updateSetting = useCallback(<K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setHasChanges(true);
  }, [settings]);

  if (!isOpen) return null;

  return (
    <div className="settings-modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h2>{t.settingsTitle}</h2>
          <button className="settings-close" onClick={onClose} aria-label={t.close}>
            &times;
          </button>
        </div>

        {loading ? (
          <div className="settings-loading">
            <div className="settings-spinner" />
            <p>Loading settings...</p>
          </div>
        ) : error ? (
          <div className="settings-error">
            <p>{error}</p>
            <button onClick={loadSettings}>{t.retry}</button>
          </div>
        ) : settings ? (
          <>
            <div className="settings-content">
              {/* Language */}
              <div className="settings-section">
                <label className="settings-label">{t.language}</label>
                <div className="settings-language-buttons">
                  {ALL_LANGUAGES.map((lang) => (
                    <button
                      key={lang}
                      className={`settings-lang-btn ${settings.language === lang ? 'active' : ''}`}
                      onClick={() => updateSetting('language', lang)}
                    >
                      {languageNames[lang]}
                    </button>
                  ))}
                </div>
              </div>

              {/* Display Time Frame */}
              <div className="settings-section">
                <label className="settings-label">Display Time Frame</label>
                <div className="settings-timeframe-buttons">
                  {(Object.keys(TIME_FRAME_LABELS) as DisplayTimeFrame[]).map((tf) => (
                    <button
                      key={tf}
                      className={`settings-timeframe-btn ${settings.displayTimeFrame === tf ? 'active' : ''}`}
                      onClick={() => updateSetting('displayTimeFrame', tf)}
                    >
                      {TIME_FRAME_LABELS[tf]}
                    </button>
                  ))}
                </div>
                <p className="settings-hint">How far back to display accumulated news items</p>
              </div>

              {/* Regions */}
              <div className="settings-section">
                <label className="settings-label">
                  {t.regions || 'Regions'}
                  <span className="settings-value">{settings.regions.length}</span>
                </label>
                <div className="settings-regions">
                  {AVAILABLE_REGIONS.map((region) => (
                    <label key={region} className="settings-region-chip">
                      <input
                        type="checkbox"
                        checked={settings.regions.includes(region)}
                        onChange={() => toggleRegion(region)}
                        disabled={
                          settings.regions.length === 1 && settings.regions.includes(region)
                        }
                      />
                      <span className="region-chip-label">{region}</span>
                    </label>
                  ))}
                </div>
                <p className="settings-hint">Select regions to scan. Settings below apply per region.</p>
              </div>

              {/* Categories */}
              <div className="settings-section">
                <label className="settings-label">{t.categories}</label>
                <div className="settings-categories">
                  {ALL_CATEGORIES.map((category) => (
                    <label key={category} className="settings-category">
                      <input
                        type="checkbox"
                        checked={settings.categoriesEnabled.includes(category)}
                        onChange={() => toggleCategory(category)}
                        disabled={
                          settings.categoriesEnabled.length === 1 &&
                          settings.categoriesEnabled.includes(category)
                        }
                      />
                      <span className="category-content">
                        <span className="category-label">{t[CATEGORY_KEYS[category].labelKey]}</span>
                        <span className="category-desc">{CATEGORY_KEYS[category].description}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Search Queries */}
              <div className="settings-section">
                <label className="settings-label">
                  {t.searchQueries}
                  <span className="settings-value">{settings.maxSearchQueries}</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={settings.maxSearchQueries}
                  onChange={(e) => updateSetting('maxSearchQueries', parseInt(e.target.value))}
                  className="settings-slider"
                />
                <div className="settings-range-labels">
                  <span>1</span>
                  <span>100</span>
                </div>
                <p className="settings-hint">More queries = more comprehensive but slower</p>
              </div>

              {/* URLs to Scrape */}
              <div className="settings-section">
                <label className="settings-label">
                  {t.urlsToScrape}
                  <span className="settings-value">{settings.maxUrlsToScrape}</span>
                </label>
                <input
                  type="range"
                  min="50"
                  max="500"
                  step="10"
                  value={settings.maxUrlsToScrape}
                  onChange={(e) => updateSetting('maxUrlsToScrape', parseInt(e.target.value))}
                  className="settings-slider"
                />
                <div className="settings-range-labels">
                  <span>50</span>
                  <span>500</span>
                </div>
                <p className="settings-hint">More URLs = more data but higher API costs</p>
              </div>

              {/* Sources per Category */}
              <div className="settings-section">
                <label className="settings-label">
                  {t.sourcesPerCategory}
                  <span className="settings-value">{settings.sourcesPerCategory}</span>
                </label>
                <input
                  type="range"
                  min="2"
                  max="8"
                  value={settings.sourcesPerCategory}
                  onChange={(e) => updateSetting('sourcesPerCategory', parseInt(e.target.value))}
                  className="settings-slider"
                />
                <div className="settings-range-labels">
                  <span>2</span>
                  <span>8</span>
                </div>
                <p className="settings-hint">Number of platforms to discover per category (e.g., Reddit, X, Telegram)</p>
              </div>

              {/* Token/Cost Estimation */}
              {tokenEstimate && (
                <div className="settings-section settings-estimate">
                  <label className="settings-label">{t.estimatedCost || 'Estimated Cost per Scan'}</label>
                  <div className="estimate-grid">
                    <div className="estimate-item">
                      <span className="estimate-label">Full scan</span>
                      <span className="estimate-value">
                        ~{tokenEstimate.tokens.toLocaleString()} tokens
                        <span className="estimate-cost">(${tokenEstimate.costUSD.toFixed(3)})</span>
                      </span>
                    </div>
                    <div className="estimate-item">
                      <span className="estimate-label">With caching</span>
                      <span className="estimate-value estimate-cached">
                        ~{tokenEstimate.tokensCached.toLocaleString()} tokens
                        <span className="estimate-cost">(${tokenEstimate.costCachedUSD.toFixed(3)})</span>
                      </span>
                    </div>
                  </div>
                  <p className="settings-hint">
                    Based on {settings.regions.length} region{settings.regions.length !== 1 ? 's' : ''} x {settings.maxSearchQueries} queries x {settings.maxUrlsToScrape} URLs
                  </p>
                </div>
              )}

              {/* Danger Zone */}
              <div className="settings-section settings-danger">
                <label className="settings-label">Danger Zone</label>
                {!showClearConfirm ? (
                  <button
                    className="settings-btn settings-btn-danger"
                    onClick={() => setShowClearConfirm(true)}
                  >
                    <span className="btn-icon">🗑</span>
                    Clear All History
                  </button>
                ) : (
                  <div className="clear-confirm">
                    <p className="clear-warning">
                      ⚠️ Are you sure? This will permanently delete all historical data including pulses, items, and cached responses. This action cannot be undone.
                    </p>
                    <div className="clear-confirm-buttons">
                      <button
                        className="settings-btn settings-btn-secondary"
                        onClick={() => setShowClearConfirm(false)}
                        disabled={clearing}
                      >
                        Cancel
                      </button>
                      <button
                        className="settings-btn settings-btn-danger-confirm"
                        onClick={handleClearHistory}
                        disabled={clearing}
                      >
                        {clearing ? (
                          <>
                            <span className="btn-spinner" />
                            Clearing...
                          </>
                        ) : (
                          'Yes, Delete Everything'
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="settings-footer">
              <button
                className="settings-btn settings-btn-scan"
                onClick={handleRescan}
                disabled={rescanning}
              >
                {rescanning ? (
                  <>
                    <span className="btn-spinner" />
                    {t.scanning}
                  </>
                ) : (
                  <>
                    <span className="btn-icon">↻</span>
                    {t.scan}
                  </>
                )}
              </button>

              <div className="settings-footer-right">
                <button
                  className="settings-btn settings-btn-secondary"
                  onClick={onClose}
                >
                  {t.cancel}
                </button>
                <button
                  className="settings-btn settings-btn-primary"
                  onClick={handleSave}
                  disabled={saving || !hasChanges}
                >
                  {t.save}
                </button>
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
