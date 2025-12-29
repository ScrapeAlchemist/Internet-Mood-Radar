'use client';

interface CountryMoodEntry {
  country: string;
  avgMood: number;
  count: number;
}

interface MoodRankingPanelProps {
  happiest: CountryMoodEntry[];
  tensest: CountryMoodEntry[];
}

function getMoodColor(mood: number): string {
  // 0 = red (tense), 50 = yellow (neutral), 100 = green (happy)
  if (mood >= 70) return '#22c55e'; // green
  if (mood >= 55) return '#84cc16'; // lime
  if (mood >= 45) return '#eab308'; // yellow
  if (mood >= 30) return '#f97316'; // orange
  return '#ef4444'; // red
}

function getMoodEmoji(mood: number): string {
  if (mood >= 70) return '😊';
  if (mood >= 55) return '🙂';
  if (mood >= 45) return '😐';
  if (mood >= 30) return '😟';
  return '😠';
}

export function MoodRankingPanel({ happiest, tensest }: MoodRankingPanelProps) {
  const hasData = happiest.length > 0 || tensest.length > 0;

  if (!hasData) {
    return (
      <div className="mood-ranking-panel">
        <h3 className="mood-ranking-title">Country Mood</h3>
        <p className="mood-ranking-empty">Not enough data yet (need 3+ items per country)</p>
      </div>
    );
  }

  return (
    <div className="mood-ranking-panel">
      <div className="mood-ranking-columns">
        {/* Happiest Countries */}
        <div className="mood-column happiest">
          <h4 className="mood-column-title">
            <span className="mood-emoji">😊</span> Happiest
          </h4>
          {happiest.length > 0 ? (
            <div className="mood-list">
              {happiest.map((entry, index) => (
                <div key={entry.country} className="mood-entry">
                  <span className="mood-rank">{index + 1}</span>
                  <span className="mood-country">{entry.country}</span>
                  <span
                    className="mood-score"
                    style={{ color: getMoodColor(entry.avgMood) }}
                  >
                    {entry.avgMood}
                  </span>
                  <span className="mood-count">({entry.count})</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mood-no-data">No data</p>
          )}
        </div>

        {/* Most Tense Countries */}
        <div className="mood-column tensest">
          <h4 className="mood-column-title">
            <span className="mood-emoji">😠</span> Most Tense
          </h4>
          {tensest.length > 0 ? (
            <div className="mood-list">
              {tensest.map((entry, index) => (
                <div key={entry.country} className="mood-entry">
                  <span className="mood-rank">{index + 1}</span>
                  <span className="mood-country">{entry.country}</span>
                  <span
                    className="mood-score"
                    style={{ color: getMoodColor(entry.avgMood) }}
                  >
                    {entry.avgMood}
                  </span>
                  <span className="mood-count">({entry.count})</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mood-no-data">No data</p>
          )}
        </div>
      </div>
    </div>
  );
}
