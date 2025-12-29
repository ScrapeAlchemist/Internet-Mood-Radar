'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  TensionChart,
  EmotionPanel,
  BreakdownPanel,
  ItemsFeed,
  MoodRankingPanel,
  HeadlinesPanel,
} from '@/components/history';
import { TensionTrend, HistoricalItemWithDetails, CountryMoodEntry, HeadlineHighlight } from '@/lib/history';
import { getTensionColor } from '@/lib/utils';
import './history.css';

interface HistoryStats {
  totalPulses: number;
  totalItems: number;
  oldestPulse: string | null;
  newestPulse: string | null;
  avgTension: number;
}

interface SourceBreakdown {
  source: string;
  count: number;
  percentage: number;
}

interface CountryMoodRanking {
  happiest: CountryMoodEntry[];
  tensest: CountryMoodEntry[];
}

interface HeadlineHighlights {
  mostPositive: HeadlineHighlight[];
  mostNegative: HeadlineHighlight[];
}

interface DashboardData {
  trend: TensionTrend[];
  stats: HistoryStats;
  emotions: Record<string, number>;
  sources: SourceBreakdown[];
  countryMoods: CountryMoodRanking;
  headlines: HeadlineHighlights;
  items: HistoricalItemWithDetails[];
}

const TIME_RANGES = [
  { label: '6h', hours: 6 },
  { label: '24h', hours: 24 },
  { label: '7d', hours: 168 },
  { label: '30d', hours: 720 },
];

export default function HistoryPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/history?action=dashboard&hours=${hours}&limit=50`);
      const dashboardData = await res.json();

      setData({
        trend: dashboardData.trend || [],
        stats: dashboardData.stats || {
          totalPulses: 0,
          totalItems: 0,
          oldestPulse: null,
          newestPulse: null,
          avgTension: 0,
        },
        emotions: dashboardData.emotions || {},
        sources: dashboardData.sources || [],
        countryMoods: dashboardData.countryMoods || { happiest: [], tensest: [] },
        headlines: dashboardData.headlines || { mostPositive: [], mostNegative: [] },
        items: dashboardData.items || [],
      });
    } catch (error) {
      console.error('Failed to fetch history:', error);
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div className="history-container">
      <header className="history-header">
        <div className="header-content">
          <h1>Historical Analytics</h1>
          <div className="time-range-selector">
            {TIME_RANGES.map((range) => (
              <button
                key={range.hours}
                className={`time-btn ${hours === range.hours ? 'active' : ''}`}
                onClick={() => setHours(range.hours)}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
        <nav className="history-nav">
          <Link href="/">Home</Link>
          <Link href="/history" className="active">History</Link>
          <Link href="/debug">Debug</Link>
        </nav>
      </header>

      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading analytics...</p>
        </div>
      ) : !data ? (
        <div className="empty-state">
          <p>No historical data available yet.</p>
          <p>Data will be collected as you use the app.</p>
        </div>
      ) : (
        <div className="dashboard-grid">
          {/* Tension Timeline - Full Width */}
          <section className="dashboard-panel tension-panel">
            <h2>Tension Timeline</h2>
            <TensionChart data={data.trend} height={220} hours={hours} />
          </section>

          {/* Emotions Panel */}
          <section className="dashboard-panel emotions-panel">
            <h2>Emotion Distribution</h2>
            <EmotionPanel emotions={data.emotions} />
          </section>

          {/* Headlines Panel */}
          <section className="dashboard-panel topics-panel">
            <h2>Headline Highlights</h2>
            <HeadlinesPanel
              mostPositive={data.headlines.mostPositive}
              mostNegative={data.headlines.mostNegative}
            />
          </section>

          {/* Category Breakdown */}
          <section className="dashboard-panel sources-panel">
            <BreakdownPanel
              title="Categories"
              items={data.sources.map((s) => ({
                label: s.source,
                count: s.count,
                percentage: s.percentage,
              }))}
              colorScheme="blue"
              maxItems={5}
            />
          </section>

          {/* Country Mood Ranking */}
          <section className="dashboard-panel countries-panel">
            <h2>Country Mood</h2>
            <MoodRankingPanel
              happiest={data.countryMoods.happiest}
              tensest={data.countryMoods.tensest}
            />
          </section>

          {/* Items Feed - Full Width */}
          <section className="dashboard-panel items-panel">
            <h2>Recent Items ({data.items.length})</h2>
            <ItemsFeed items={data.items} maxHeight={400} />
          </section>

          {/* Stats Bar */}
          <footer className="stats-bar">
            <div className="stat">
              <span className="stat-value">{data.stats.totalItems.toLocaleString()}</span>
              <span className="stat-label">items</span>
            </div>
            <div className="stat">
              <span className="stat-value">{data.stats.totalPulses}</span>
              <span className="stat-label">scans</span>
            </div>
            <div className="stat">
              <span
                className="stat-value"
                style={{ color: getTensionColor(data.stats.avgTension) }}
              >
                {data.stats.avgTension.toFixed(1)}
              </span>
              <span className="stat-label">avg tension</span>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}
