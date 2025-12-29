'use client';

import Link from 'next/link';
import { useLanguage } from '@/contexts/LanguageContext';
import { getTensionColor, getTensionCategory } from '@/lib/utils';

type TimeFrame = '1d' | '1w' | '1m';
export type ContentCategory = 'news' | 'events' | 'tech' | 'social' | 'weather';

export interface CategoryCounts {
  news: number;
  events: number;
  tech: number;
  social: number;
  weather: number;
}

interface MapControlsProps {
  timeFrame: TimeFrame;
  onTimeFrameChange: (timeFrame: TimeFrame) => void;
  tensionIndex: number;
  topicCount: number;
  sourceCount: number;
  totalCount?: number;
  eventCount?: number;
  showEvents?: boolean;
  onToggleEvents?: (show: boolean) => void;
  onOpenSettings?: () => void;
  onOpenNewsFeed?: () => void;
  loading?: boolean;
  selectedCountry?: string | null;
  onClearSelection?: () => void;
  // Category filtering (multi-select)
  selectedCategories?: Set<ContentCategory>;
  onCategoryToggle?: (category: ContentCategory) => void;
  categoryCounts?: CategoryCounts;
}

// Category definitions with icons
const CATEGORY_CONFIG: Record<ContentCategory, { icon: string; label: string }> = {
  news: { icon: '📰', label: 'News' },
  events: { icon: '🎭', label: 'Events' },
  tech: { icon: '💻', label: 'Tech' },
  social: { icon: '💬', label: 'Social' },
  weather: { icon: '🌤️', label: 'Weather' },
};

// All categories for iteration
const ALL_CATEGORIES: ContentCategory[] = ['news', 'events', 'tech', 'social', 'weather'];

// Export for use in page.tsx
export { ALL_CATEGORIES };

export function MapControls({
  timeFrame,
  onTimeFrameChange,
  tensionIndex,
  topicCount,
  sourceCount,
  totalCount = 0,
  eventCount = 0,
  showEvents = true,
  onToggleEvents,
  onOpenSettings,
  onOpenNewsFeed,
  loading,
  selectedCountry,
  onClearSelection,
  selectedCategories = new Set(ALL_CATEGORIES),
  onCategoryToggle,
  categoryCounts = { news: 0, events: 0, tech: 0, social: 0, weather: 0 },
}: MapControlsProps) {
  const { t } = useLanguage();

  return (
    <>
      {/* Top left - Logo and title */}
      <div className="map-control map-control-top-left">
        <div className="map-logo">
          <h1>{t.appTitle}</h1>
          <span className="version-badge">V1: World</span>
        </div>
      </div>

      {/* Top right - Navigation */}
      <div className="map-control map-control-top-right">
        <nav className="map-nav">
          <Link href="/" className="map-nav-link active">Map</Link>
          <Link href="/history" className="map-nav-link">History</Link>
          <Link href="/debug" className="map-nav-link">Debug</Link>
          {onOpenSettings && (
            <button
              className="map-nav-link settings-btn-icon"
              onClick={onOpenSettings}
              title="Settings"
              aria-label="Open settings"
            >
              ⚙️
            </button>
          )}
        </nav>
      </div>

      {/* Bottom left - Mood legend only */}
      <div className="map-control map-control-bottom-left">
        <div className="mood-legend">
          <div className="mood-legend-title">Mood Level</div>
          <div className="mood-legend-scale">
            <div className="mood-level" style={{ background: '#22c55e' }}>
              Calm
            </div>
            <div className="mood-level" style={{ background: '#eab308' }}>
              Moderate
            </div>
            <div className="mood-level" style={{ background: '#ef4444' }}>
              Tense
            </div>
          </div>
        </div>
      </div>

      {/* Bottom category bar - spans full width */}
      {onCategoryToggle && (
        <div className="category-bar">
          <div className="category-bar-content">
            {ALL_CATEGORIES.map((cat) => {
              const config = CATEGORY_CONFIG[cat];
              const count = categoryCounts[cat];
              const isActive = selectedCategories.has(cat);

              return (
                <button
                  key={cat}
                  className={`category-btn ${isActive ? 'active' : ''}`}
                  onClick={() => onCategoryToggle(cat)}
                  title={`${config.label} (${count}) - Click to ${isActive ? 'hide' : 'show'}`}
                  data-category={cat}
                >
                  <span className="category-icon">{config.icon}</span>
                  <span className="category-label">{config.label}</span>
                  {count > 0 && (
                    <span className="category-count">{count}</span>
                  )}
                </button>
              );
            })}

            {/* View List button integrated into the bar */}
            {onOpenNewsFeed && totalCount > 0 && (
              <button className="category-view-btn" onClick={onOpenNewsFeed}>
                <span>📋</span>
                <span>View List</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom center - Time window and stats */}
      <div className="map-control map-control-bottom-center">
        <div className="map-stats-panel">
          {/* Time frame selector */}
          <div className="time-selector">
            {(['1d', '1w', '1m'] as const).map((tf) => (
              <button
                key={tf}
                className={`time-btn ${timeFrame === tf ? 'active' : ''}`}
                onClick={() => onTimeFrameChange(tf)}
                disabled={loading}
              >
                {tf === '1d' ? '1 Day' : tf === '1w' ? '1 Week' : '1 Month'}
              </button>
            ))}
          </div>

          {/* Tension indicator */}
          <div className="tension-indicator">
            <div
              className="tension-circle"
              style={{ background: getTensionColor(tensionIndex) }}
            >
              {tensionIndex}
            </div>
            <div className="tension-label">
              {selectedCountry ? (
                <span className="selected-country-label">
                  {selectedCountry}
                  {onClearSelection && (
                    <button
                      className="clear-selection-btn"
                      onClick={onClearSelection}
                      title="Clear selection"
                    >
                      ×
                    </button>
                  )}
                </span>
              ) : (
                getTensionCategory(tensionIndex).label
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="map-stats">
            <span>{topicCount} {t.topics}</span>
            <span className="stat-divider">|</span>
            <span>{sourceCount} {t.sources}</span>
          </div>
        </div>
      </div>

      {/* Loading overlay */}
      {loading && (
        <div className="map-loading-overlay">
          <div className="map-spinner" />
        </div>
      )}
    </>
  );
}
