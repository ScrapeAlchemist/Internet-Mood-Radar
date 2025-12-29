'use client';

import { useState, useMemo, useEffect } from 'react';
import { Receipt, ContentCategory } from '@/types';
import { useLanguage } from '@/contexts/LanguageContext';
import { Translations } from '@/lib/translations';

const ITEMS_PER_PAGE = 50;

interface NewsFeedProps {
  receipts: Receipt[];
  isOpen: boolean;
  onClose: () => void;
}

// Source colors for visual distinction
const SOURCE_COLORS: Record<string, string> = {
  'Search: news': '#3b82f6',
  'Search: social': '#f97316',
  'Search: tech': '#22c55e',
  'Search: events': '#a855f7',
  'Search: weather': '#06b6d4',
};

// Get favicon URL - prefer pre-extracted, fallback to Google's service
function getFaviconUrl(receipt: Receipt): string {
  if (receipt.faviconUrl) {
    return receipt.faviconUrl;
  }
  try {
    const domain = new URL(receipt.url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  } catch {
    return '';
  }
}

// Format relative time
function getRelativeTime(date: Date, t: Translations): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 60) return `${diffMins}${t.minutesAgo}`;
  if (diffHours < 24) return `${diffHours}${t.hoursAgo}`;
  return `${Math.floor(diffHours / 24)}${t.daysAgo}`;
}

// Get category from source string
function getCategoryFromSource(source: string): ContentCategory | null {
  if (source.includes('news')) return 'news';
  if (source.includes('social')) return 'social';
  if (source.includes('tech')) return 'tech';
  if (source.includes('events')) return 'events';
  if (source.includes('weather')) return 'weather';
  return null;
}

export function NewsFeed({ receipts, isOpen, onClose }: NewsFeedProps) {
  const { t } = useLanguage();
  const [filter, setFilter] = useState<ContentCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Reset page when filter or search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, searchQuery]);

  // Filter receipts based on category and search
  const filteredReceipts = useMemo(() => {
    return receipts.filter((r) => {
      // Category filter
      if (filter !== 'all') {
        const category = getCategoryFromSource(r.source);
        if (category !== filter) return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          r.title.toLowerCase().includes(query) ||
          r.snippet.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [receipts, filter, searchQuery]);

  // Count by category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: receipts.length,
      news: 0,
      social: 0,
      tech: 0,
      events: 0,
      weather: 0,
    };

    for (const r of receipts) {
      const cat = getCategoryFromSource(r.source);
      if (cat) counts[cat]++;
    }

    return counts;
  }, [receipts]);

  // Pagination
  const totalPages = Math.ceil(filteredReceipts.length / ITEMS_PER_PAGE);
  const paginatedReceipts = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredReceipts.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredReceipts, currentPage]);

  if (!isOpen) return null;

  return (
    <div className="news-feed-overlay" onClick={onClose}>
      <div className="news-feed-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="news-feed-header">
          <h2>{t.newsFeedTitle} ({receipts.length})</h2>
          <button className="news-feed-close" onClick={onClose} aria-label={t.close}>
            &times;
          </button>
        </div>

        {/* Search and filters */}
        <div className="news-feed-controls">
          <input
            type="text"
            placeholder={t.searchPlaceholder}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="news-feed-search"
          />
          <div className="news-feed-filters">
            <button
              className={`news-feed-filter ${filter === 'all' ? 'active' : ''}`}
              onClick={() => setFilter('all')}
            >
              {t.all} ({categoryCounts.all})
            </button>
            <button
              className={`news-feed-filter ${filter === 'news' ? 'active' : ''}`}
              onClick={() => setFilter('news')}
            >
              {t.categoryNews} ({categoryCounts.news})
            </button>
            <button
              className={`news-feed-filter ${filter === 'social' ? 'active' : ''}`}
              onClick={() => setFilter('social')}
            >
              {t.categorySocial} ({categoryCounts.social})
            </button>
            <button
              className={`news-feed-filter ${filter === 'tech' ? 'active' : ''}`}
              onClick={() => setFilter('tech')}
            >
              {t.categoryTech} ({categoryCounts.tech})
            </button>
            <button
              className={`news-feed-filter ${filter === 'events' ? 'active' : ''}`}
              onClick={() => setFilter('events')}
            >
              {t.categoryEvents} ({categoryCounts.events})
            </button>
            <button
              className={`news-feed-filter ${filter === 'weather' ? 'active' : ''}`}
              onClick={() => setFilter('weather')}
            >
              {t.categoryWeather} ({categoryCounts.weather})
            </button>
          </div>
        </div>

        {/* Scrollable news list */}
        <div className="news-feed-list">
          {paginatedReceipts.length === 0 ? (
            <div className="news-feed-empty">
              {searchQuery ? t.noResults : t.noItems}
            </div>
          ) : (
            paginatedReceipts.map((receipt) => {
              const faviconUrl = getFaviconUrl(receipt);
              const color = SOURCE_COLORS[receipt.source] || '#6b7280';

              return (
                <a
                  key={receipt.id}
                  href={receipt.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="news-feed-item"
                  style={{ borderLeftColor: color }}
                >
                  {/* Image if available */}
                  {receipt.imageUrl && (
                    <div className="news-feed-item-image">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={receipt.imageUrl}
                        alt=""
                        onError={(e) => {
                          // Hide the image container if image fails to load
                          const container = e.currentTarget.parentElement;
                          if (container) container.style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  <div className="news-feed-item-content">
                    {/* Header row */}
                    <div className="news-feed-item-header">
                      <div className="news-feed-item-source">
                        {faviconUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={faviconUrl}
                            alt=""
                            className="news-feed-favicon"
                            onError={(e) => (e.currentTarget.style.display = 'none')}
                          />
                        )}
                        <span style={{ color }}>{receipt.source.replace('Search: ', '')}</span>
                      </div>
                      <span className="news-feed-item-time">
                        {getRelativeTime(receipt.createdAt, t)}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="news-feed-item-title">{receipt.title}</h3>

                    {/* Snippet */}
                    {receipt.snippet && (
                      <p className="news-feed-item-snippet">
                        {receipt.snippet.length > 200
                          ? receipt.snippet.slice(0, 200) + '...'
                          : receipt.snippet}
                      </p>
                    )}

                    {/* Location if available */}
                    {receipt.location && (
                      <div className="news-feed-item-location">
                        📍 {receipt.location.name}
                      </div>
                    )}
                  </div>
                </a>
              );
            })
          )}
        </div>

        {/* Pagination controls */}
        {totalPages > 1 && (
          <div className="news-feed-pagination">
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
            >
              ««
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              «
            </button>
            <span className="pagination-info">
              {currentPage} / {totalPages}
            </span>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              »
            </button>
            <button
              className="pagination-btn"
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage === totalPages}
            >
              »»
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
