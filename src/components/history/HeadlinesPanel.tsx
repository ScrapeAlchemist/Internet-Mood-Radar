'use client';

interface HeadlineHighlight {
  id: string;
  title: string;
  country: string | null;
  moodScore: number;
  url: string;
  lens: string | null;
}

interface HeadlinesPanelProps {
  mostPositive: HeadlineHighlight[];
  mostNegative: HeadlineHighlight[];
}

function getMoodColor(mood: number): string {
  if (mood >= 70) return '#22c55e';
  if (mood >= 55) return '#84cc16';
  if (mood >= 45) return '#eab308';
  if (mood >= 30) return '#f97316';
  return '#ef4444';
}

function truncateTitle(title: string, maxLength: number = 60): string {
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength - 3) + '...';
}

export function HeadlinesPanel({ mostPositive, mostNegative }: HeadlinesPanelProps) {
  const hasData = mostPositive.length > 0 || mostNegative.length > 0;

  if (!hasData) {
    return (
      <div className="headlines-panel">
        <p className="headlines-empty">No headline data available</p>
      </div>
    );
  }

  return (
    <div className="headlines-panel">
      <div className="headlines-columns">
        {/* Most Positive */}
        <div className="headlines-column positive">
          <h4 className="headlines-column-title">
            <span className="headlines-emoji">+</span> Most Positive
          </h4>
          {mostPositive.length > 0 ? (
            <div className="headlines-list">
              {mostPositive.map((headline) => (
                <a
                  key={headline.id}
                  href={headline.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="headline-item"
                >
                  <span
                    className="headline-score"
                    style={{ backgroundColor: getMoodColor(headline.moodScore) }}
                  >
                    {headline.moodScore}
                  </span>
                  <span className="headline-title">{truncateTitle(headline.title)}</span>
                  {headline.country && (
                    <span className="headline-country">{headline.country}</span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <p className="headlines-no-data">No data</p>
          )}
        </div>

        {/* Most Negative */}
        <div className="headlines-column negative">
          <h4 className="headlines-column-title">
            <span className="headlines-emoji">-</span> Most Tense
          </h4>
          {mostNegative.length > 0 ? (
            <div className="headlines-list">
              {mostNegative.map((headline) => (
                <a
                  key={headline.id}
                  href={headline.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="headline-item"
                >
                  <span
                    className="headline-score"
                    style={{ backgroundColor: getMoodColor(headline.moodScore) }}
                  >
                    {headline.moodScore}
                  </span>
                  <span className="headline-title">{truncateTitle(headline.title)}</span>
                  {headline.country && (
                    <span className="headline-country">{headline.country}</span>
                  )}
                </a>
              ))}
            </div>
          ) : (
            <p className="headlines-no-data">No data</p>
          )}
        </div>
      </div>
    </div>
  );
}
