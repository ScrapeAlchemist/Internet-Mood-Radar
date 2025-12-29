'use client';

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Receipt, CountryMood } from '@/types';
import { getTensionColor, getMoodColor } from '@/lib/utils';
import type { Map as LeafletMapType, LeafletMouseEvent, LeafletEvent, Layer } from 'leaflet';
import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from 'geojson';

// GeoJSON-compatible country boundary type
type CountryBoundary = FeatureCollection<Geometry, { name: string; id: string }>;

interface WorldMapProps {
  receipts: Receipt[];
  events?: Receipt[];
  showEvents?: boolean;
  tensionIndex: number;
  countryMoods?: CountryMood[];
  selectedCountry?: string | null;
  onCountrySelect?: (country: string | null) => void;
  onCollectCountryData?: (country: string) => void;
}

interface MapCluster {
  id: string;
  lat: number;
  lng: number;
  receipts: Receipt[];
  tensionIndex: number;
  avgMoodScore: number; // Average mood score of all receipts in cluster
}

interface SpiderLeg {
  receipt: Receipt;
  angle: number;
  index: number;
}

// Maximum items per cluster - if more, split into sub-clusters
const MAX_CLUSTER_SIZE = 20;

// Normalize country names from different sources (Nominatim, GeoJSON, etc.) to our standard names
// Only maps API-returned names to our data's naming convention
const COUNTRY_NAME_ALIASES: Record<string, string> = {
  // Nominatim returns "Palestinian Territories" but our data uses "Palestine"
  'Palestinian Territories': 'Palestine',
  // Common variations from different APIs
  'United States of America': 'United States',
  'USA': 'United States',
  'Russian Federation': 'Russia',
  'Republic of Korea': 'South Korea',
  "Democratic People's Republic of Korea": 'North Korea',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'Czech Republic': 'Czechia',
};

/**
 * Normalize a country name to our standard format
 */
function normalizeCountryName(name: string): string {
  return COUNTRY_NAME_ALIASES[name] || name;
}

// Cluster nearby receipts based on zoom level
// At low zoom (zoomed out), cluster items that are close together geographically
// At high zoom (zoomed in), show individual markers
// Clusters with more than MAX_CLUSTER_SIZE items are split into smaller clusters
function clusterReceipts(receipts: Receipt[], zoom: number): MapCluster[] {
  // Radius for clustering - smaller at low zoom to keep markers visible
  // At zoom 3 (world view): cluster items within ~3 degrees
  // At zoom 6: ~1.5 degrees, zoom 8: ~0.5, zoom 10: ~0.1
  const radius = zoom < 4 ? 3 : zoom < 6 ? 1.5 : zoom < 8 ? 0.8 : zoom < 10 ? 0.3 : 0.1;
  const initialClusters: MapCluster[] = [];
  const assigned = new Set<string>();

  for (const receipt of receipts) {
    if (!receipt.location || assigned.has(receipt.id)) continue;

    const nearby: Receipt[] = [receipt];
    assigned.add(receipt.id);

    for (const other of receipts) {
      if (!other.location || assigned.has(other.id)) continue;

      const latDiff = Math.abs(receipt.location.lat - other.location.lat);
      const lngDiff = Math.abs(receipt.location.lng - other.location.lng);

      if (latDiff < radius && lngDiff < radius) {
        nearby.push(other);
        assigned.add(other.id);
      }
    }

    const avgLat = nearby.reduce((sum, r) => sum + (r.location?.lat || 0), 0) / nearby.length;
    const avgLng = nearby.reduce((sum, r) => sum + (r.location?.lng || 0), 0) / nearby.length;
    const avgMoodScore = nearby.reduce((sum, r) => sum + (r.moodScore ?? 50), 0) / nearby.length;

    initialClusters.push({
      id: `cluster-${receipt.id}`,
      lat: avgLat,
      lng: avgLng,
      receipts: nearby,
      tensionIndex: 50,
      avgMoodScore,
    });
  }

  // Split clusters that exceed MAX_CLUSTER_SIZE
  const finalClusters: MapCluster[] = [];

  for (const cluster of initialClusters) {
    if (cluster.receipts.length <= MAX_CLUSTER_SIZE) {
      finalClusters.push(cluster);
    } else {
      // Split into sub-clusters of up to MAX_CLUSTER_SIZE items
      const numSubClusters = Math.ceil(cluster.receipts.length / MAX_CLUSTER_SIZE);
      const offsetDistance = radius * 0.3; // Offset for sub-clusters

      for (let i = 0; i < numSubClusters; i++) {
        const startIdx = i * MAX_CLUSTER_SIZE;
        const subReceipts = cluster.receipts.slice(startIdx, startIdx + MAX_CLUSTER_SIZE);
        const subAvgMoodScore = subReceipts.reduce((sum, r) => sum + (r.moodScore ?? 50), 0) / subReceipts.length;

        // Offset each sub-cluster in a circular pattern around the center
        const angle = (2 * Math.PI * i) / numSubClusters;
        const offsetLat = cluster.lat + Math.sin(angle) * offsetDistance;
        const offsetLng = cluster.lng + Math.cos(angle) * offsetDistance;

        finalClusters.push({
          id: `cluster-${cluster.id}-sub${i}`,
          lat: offsetLat,
          lng: offsetLng,
          receipts: subReceipts,
          tensionIndex: 50,
          avgMoodScore: subAvgMoodScore,
        });
      }
    }
  }

  return finalClusters;
}

// Source colors for markers
const SOURCE_COLORS: Record<string, string> = {
  rss: '#3b82f6',
  reddit: '#f97316',
  telegram: '#22c55e',
  hn: '#eab308',
  events: '#a855f7', // Purple for events
};

// Format relative time
function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - new Date(date).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// Calculate spider leg positions around center
function calculateSpiderLegs(receipts: Receipt[]): SpiderLeg[] {
  const count = receipts.length;
  const angleStep = (2 * Math.PI) / count;

  return receipts.map((receipt, index) => ({
    receipt,
    angle: angleStep * index - Math.PI / 2, // Start from top
    index,
  }));
}

// Format event date for display
function formatEventDate(date: Date | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// Country boundary with mood data
interface CountryBoundaryWithMood {
  boundary: CountryBoundary;
  mood: CountryMood;
}

// Country info panel component
function CountryInfoPanel({
  country,
  countryMoods,
  onClose,
  onCollectData,
}: {
  country: string;
  countryMoods: CountryMood[];
  onClose: () => void;
  onCollectData: () => void;
}) {
  // Case-insensitive country matching (Nominatim may return different casing)
  const countryMood = countryMoods.find(
    (m) => m.country.toLowerCase() === country.toLowerCase()
  );

  console.log('[MAP] CountryInfoPanel:', { country, countryMood, countryMoodsCount: countryMoods.length });

  // Get dominant emotion
  const getDominantEmotion = (emotions: CountryMood['emotions']) => {
    const sorted = Object.entries(emotions).sort(([, a], [, b]) => b - a);
    return sorted[0]?.[0] || 'neutral';
  };

  return (
    <div className="country-info-panel">
      <div className="country-info-header">
        <h3>{country}</h3>
        <button onClick={onClose} aria-label="Close">&times;</button>
      </div>

      {countryMood ? (
        <div className="country-info-content">
          {/* Country Summary */}
          {countryMood.summary && (
            <div className="country-summary">
              <p>{countryMood.summary}</p>
            </div>
          )}

          <div className="country-stat">
            <span className="stat-label">Tension Index</span>
            <span
              className="stat-value tension-value"
              style={{
                color: countryMood.tensionIndex < 30 ? '#22c55e' :
                       countryMood.tensionIndex < 60 ? '#eab308' : '#ef4444'
              }}
            >
              {countryMood.tensionIndex}/100
            </span>
          </div>
          <div className="country-stat">
            <span className="stat-label">Dominant Mood</span>
            <span className="stat-value">{getDominantEmotion(countryMood.emotions)}</span>
          </div>
          <div className="country-stat">
            <span className="stat-label">News Items</span>
            <span className="stat-value">{countryMood.itemCount}</span>
          </div>
          <button
            className="country-collect-btn"
            onClick={onCollectData}
          >
            🔄 Refresh Data
          </button>
        </div>
      ) : (
        <div className="country-info-content country-no-data">
          <p>No mood data available for this country.</p>
          <p className="country-hint">Click below to collect news and events from {country}.</p>
          <button
            className="country-collect-btn country-collect-primary"
            onClick={onCollectData}
          >
            🔍 Collect Data from {country}
          </button>
        </div>
      )}
    </div>
  );
}

// The actual map component that uses Leaflet - only rendered on client
function LeafletMap({
  tensionIndex,
  clusters,
  events,
  showEvents,
  expandedCluster,
  spiderLegs,
  zoom,
  setZoom,
  onClusterClick,
  onSpiderLegClick,
  onEventClick,
  onMapClick,
  onCountryClick,
  mapRef,
  countryBoundariesWithMood,
  selectedCountry,
}: {
  tensionIndex: number;
  clusters: MapCluster[];
  events: Receipt[];
  showEvents: boolean;
  expandedCluster: MapCluster | null;
  spiderLegs: SpiderLeg[];
  zoom: number;
  setZoom: (z: number) => void;
  onClusterClick: (cluster: MapCluster) => void;
  onSpiderLegClick: (receipt: Receipt) => void;
  onEventClick: (event: Receipt) => void;
  onMapClick: () => void;
  onCountryClick: (country: string) => void;
  mapRef: React.MutableRefObject<LeafletMapType | null>;
  countryBoundariesWithMood: CountryBoundaryWithMood[];
  selectedCountry: string | null;
}) {
  const [leafletLoaded, setLeafletLoaded] = useState(false);
  const [LeafletComponents, setLeafletComponents] = useState<any>(null);

  useEffect(() => {
    async function loadLeaflet() {
      const L = await import('leaflet');
      const RL = await import('react-leaflet');

      setLeafletComponents({ L: L.default || L, RL });
      setLeafletLoaded(true);
    }

    loadLeaflet();
  }, []);

  if (!leafletLoaded || !LeafletComponents) {
    return (
      <div className="map-loading">
        <div className="map-spinner" />
        <p>Loading map...</p>
      </div>
    );
  }

  const { L, RL } = LeafletComponents;
  const { MapContainer, TileLayer, GeoJSON, Marker, Polyline, Popup, useMapEvents } = RL;

  // Spider leg distance from center - scales with number of items
  // Shorter legs when few items, longer when many to avoid overlap
  const getSpiderLegDistance = (itemCount: number) => {
    // Base distance adjusted by zoom
    const baseDistance = 1.2 / Math.pow(2, zoom - 7);
    // Scale factor: 0.5 for 1 item, 0.7 for 2-3, up to 2.0 for 10+
    let scaleFactor;
    if (itemCount <= 1) {
      scaleFactor = 0.5;
    } else if (itemCount <= 3) {
      scaleFactor = 0.7;
    } else if (itemCount <= 5) {
      scaleFactor = 1.0;
    } else {
      scaleFactor = Math.min(2.0, 0.8 + (itemCount * 0.12));
    }
    return baseDistance * scaleFactor;
  };

  function createMarkerIcon(moodScore: number | undefined, isSpiderLeg: boolean = false) {
    const color = getMoodColor(moodScore ?? 50);
    const size = isSpiderLeg ? 32 : 24;

    return L.divIcon({
      className: 'news-marker-icon',
      html: `
        <div class="spider-marker ${isSpiderLeg ? 'spider-leg-marker' : ''}" style="
          width: ${size}px;
          height: ${size}px;
          background: ${color};
          border: 2px solid #fff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: ${isSpiderLeg ? 14 : 12}px;
          font-weight: bold;
          box-shadow: 0 2px 8px rgba(0,0,0,0.4);
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        ">
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

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

  // Create spider leg marker with summary title and text
  function createSpiderLegIcon(receipt: Receipt) {
    const color = getMoodColor(receipt.moodScore ?? 50);
    const faviconUrl = getFaviconUrl(receipt);

    // Use title for header, snippet for summary text
    const title = receipt.title.length > 40 ? receipt.title.slice(0, 37) + '...' : receipt.title;
    const snippet = receipt.snippet
      ? (receipt.snippet.length > 80 ? receipt.snippet.slice(0, 77) + '...' : receipt.snippet)
      : '';

    // Escape HTML
    const escapeHtml = (str: string) => str.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c] || c));

    const safeTitle = escapeHtml(title);
    const safeSnippet = escapeHtml(snippet);

    return L.divIcon({
      className: 'spider-leg-card',
      html: `
        <div class="spider-card" style="
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: #1f2937;
          border: 2px solid ${color};
          border-radius: 8px;
          padding: 8px 10px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.6);
          cursor: pointer;
          width: 220px;
        ">
          <div style="display: flex; align-items: center; gap: 6px;">
            <img src="${faviconUrl}" alt="" style="
              width: 16px;
              height: 16px;
              border-radius: 2px;
              flex-shrink: 0;
            " onerror="this.style.display='none'" />
            <span style="
              color: #fff;
              font-size: 12px;
              font-weight: 600;
              overflow: hidden;
              text-overflow: ellipsis;
              white-space: nowrap;
              flex: 1;
            ">${safeTitle}</span>
          </div>
          ${safeSnippet ? `
          <p style="
            color: #9ca3af;
            font-size: 11px;
            line-height: 1.3;
            margin: 0;
            overflow: hidden;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
          ">${safeSnippet}</p>
          ` : ''}
        </div>
      `,
      iconSize: [220, snippet ? 70 : 36],
      iconAnchor: [110, snippet ? 35 : 18],
    });
  }

  function createClusterIcon(count: number, moodScore: number, isExpanded: boolean = false) {
    const color = isExpanded ? '#6366f1' : getMoodColor(moodScore);
    const size = Math.min(50, 30 + count * 2);

    return L.divIcon({
      className: 'news-cluster-icon',
      html: `
        <div style="
          width: ${size}px;
          height: ${size}px;
          background: ${color};
          border: 3px solid #fff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
          font-size: ${Math.min(16, 12 + count)}px;
          font-weight: bold;
          box-shadow: 0 3px 10px rgba(0,0,0,0.4);
          cursor: pointer;
          transition: all 0.3s ease;
          ${isExpanded ? 'transform: scale(1.2);' : ''}
        ">
          ${count}
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function createEventIcon(eventType?: string) {
    const color = '#a855f7'; // Purple for all events
    const size = 32;

    // Event type icons/emojis
    const icons: Record<string, string> = {
      concert: '🎵',
      theater: '🎭',
      sports: '⚽',
      festival: '🎉',
      protest: '✊',
      exhibition: '🎨',
      nightlife: '🌙',
      community: '👥',
      other: '📅',
    };
    const icon = icons[eventType || 'other'] || '📅';

    return L.divIcon({
      className: 'event-marker-icon',
      html: `
        <div class="event-marker" style="
          width: ${size}px;
          height: ${size}px;
          background: ${color};
          border: 3px solid #fff;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          box-shadow: 0 3px 10px rgba(168, 85, 247, 0.5);
          cursor: pointer;
          transition: transform 0.2s, box-shadow 0.2s;
        ">
          ${icon}
        </div>
      `,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }

  function MapEvents() {
    useMapEvents({
      zoomend: (e: LeafletEvent) => {
        setZoom(e.target.getZoom());
      },
      click: async (e: LeafletMouseEvent) => {
        // Check if click was on a marker or control (not the map itself)
        const target = e.originalEvent?.target as HTMLElement | null;
        if (target && (
          target.closest?.('.leaflet-marker-icon') ||
          target.closest?.('.leaflet-control') ||
          target.closest?.('.country-info-panel') ||
          target.closest?.('.spider-panel')
        )) {
          return;
        }

        // Reverse geocode to find country at clicked location
        const { lat, lng } = e.latlng;
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=3`
          );
          if (response.ok) {
            const data = await response.json();
            const rawCountry = data.address?.country;
            if (rawCountry) {
              // Normalize country name to match our data
              const country = normalizeCountryName(rawCountry);
              onCountryClick(country);
              return;
            }
          }
        } catch (err) {
          console.log('[MAP] Reverse geocode failed:', err);
        }

        // If no country found (ocean, etc), clear selection
        onMapClick();
      },
    });
    return null;
  }

  function getCountryStyle(countryTension: number, countryName: string) {
    const color = getTensionColor(countryTension);
    const isSelected = selectedCountry === countryName;
    return {
      fillColor: color,
      fillOpacity: isSelected ? 0.5 : 0.35,
      color: isSelected ? '#fbbf24' : '#ffffff',
      weight: isSelected ? 3 : 2,
      opacity: isSelected ? 1 : 0.8,
    };
  }

  // Check if a cluster is the expanded one
  const isClusterExpanded = (cluster: MapCluster) =>
    expandedCluster?.id === cluster.id;

  return (
    <MapContainer
      center={[20, 30]}
      zoom={3}
      style={{ height: '100%', width: '100%' }}
      zoomControl={false}
      ref={mapRef}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
      />

      <MapEvents />

      {countryBoundariesWithMood.map(({ boundary, mood }, index) => (
        <GeoJSON
          key={boundary.features[0]?.properties?.id || `country-${index}`}
          data={boundary}
          style={() => getCountryStyle(mood.tensionIndex, mood.country)}
          onEachFeature={(feature: Feature<Geometry, GeoJsonProperties>, layer: Layer) => {
            layer.bindTooltip(
              `<strong>${mood.country}</strong><br/>Tension: ${mood.tensionIndex}/100<br/>Items: ${mood.itemCount}${selectedCountry === mood.country ? '<br/><em>Click to deselect</em>' : '<br/><em>Click to select</em>'}`,
              { sticky: true, className: 'country-tooltip' }
            );
            layer.on('click', (e: LeafletMouseEvent) => {
              e.originalEvent.stopPropagation();
              onCountryClick(mood.country);
            });
          }}
        />
      ))}

      {/* Render clusters */}
      {clusters.map((cluster) => {
        const isExpanded = isClusterExpanded(cluster);

        // Don't render individual markers if this cluster is expanded
        if (isExpanded) {
          return (
            <Marker
              key={cluster.id}
              position={[cluster.lat, cluster.lng]}
              icon={createClusterIcon(cluster.receipts.length, cluster.avgMoodScore, true)}
              eventHandlers={{
                click: (e: LeafletMouseEvent) => {
                  e.originalEvent.stopPropagation();
                  onClusterClick(cluster);
                }
              }}
            />
          );
        }

        return cluster.receipts.length === 1 ? (
          <Marker
            key={cluster.id}
            position={[cluster.receipts[0].location!.lat, cluster.receipts[0].location!.lng]}
            icon={createMarkerIcon(cluster.receipts[0].moodScore)}
            eventHandlers={{
              click: (e: LeafletMouseEvent) => {
                e.originalEvent.stopPropagation();
                onClusterClick(cluster);
              }
            }}
          />
        ) : (
          <Marker
            key={cluster.id}
            position={[cluster.lat, cluster.lng]}
            icon={createClusterIcon(cluster.receipts.length, cluster.avgMoodScore)}
            eventHandlers={{
              click: (e: LeafletMouseEvent) => {
                e.originalEvent.stopPropagation();
                onClusterClick(cluster);
              }
            }}
          />
        );
      })}

      {/* Render spider legs when a cluster is expanded */}
      {expandedCluster && spiderLegs.map((leg) => {
        const legDistance = getSpiderLegDistance(spiderLegs.length);
        const legLat = expandedCluster.lat + Math.sin(leg.angle) * legDistance;
        const legLng = expandedCluster.lng + Math.cos(leg.angle) * legDistance;
        const color = SOURCE_COLORS[leg.receipt.source] || '#6b7280';

        return (
          <span key={leg.receipt.id}>
            {/* Connecting line */}
            <Polyline
              positions={[
                [expandedCluster.lat, expandedCluster.lng],
                [legLat, legLng],
              ]}
              pathOptions={{
                color: color,
                weight: 2,
                opacity: 0.7,
                dashArray: '5, 5',
              }}
            />
            {/* Spider leg marker - rich card with image/title */}
            <Marker
              position={[legLat, legLng]}
              icon={createSpiderLegIcon(leg.receipt)}
              eventHandlers={{
                click: (e: LeafletMouseEvent) => {
                  e.originalEvent.stopPropagation();
                  onSpiderLegClick(leg.receipt);
                },
              }}
            >
              <Popup className="news-popup" autoPan={false}>
                <div className="news-popup-content">
                  <div className="news-popup-header">
                    <span className="news-source">{leg.receipt.source}</span>
                    <span className="news-time">{getRelativeTime(leg.receipt.createdAt)}</span>
                  </div>
                  <h4 className="news-title">{leg.receipt.title}</h4>
                  {leg.receipt.snippet && (
                    <p className="news-snippet">{leg.receipt.snippet.slice(0, 150)}...</p>
                  )}
                  <div className="news-popup-footer">
                    <span className="news-location">{leg.receipt.location?.name}</span>
                    <a
                      href={leg.receipt.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="news-link"
                    >
                      Read more →
                    </a>
                  </div>
                </div>
              </Popup>
            </Marker>
          </span>
        );
      })}

      {/* Render event markers (purple layer) */}
      {showEvents && events.map((event) => {
        if (!event.location) return null;
        return (
          <Marker
            key={event.id}
            position={[event.location.lat, event.location.lng]}
            icon={createEventIcon(event.eventType)}
            eventHandlers={{
              click: (e: LeafletMouseEvent) => {
                e.originalEvent.stopPropagation();
                onEventClick(event);
              },
            }}
          >
            <Popup className="event-popup" autoPan={false}>
              <div className="event-popup-content">
                {event.imageUrl && (
                  <div className="event-popup-image">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={event.imageUrl} alt={event.title} />
                  </div>
                )}
                <div className="event-popup-header">
                  <span className="event-type">{event.eventType || 'Event'}</span>
                  {event.eventDate && (
                    <span className="event-date">{formatEventDate(event.eventDate)}</span>
                  )}
                </div>
                <h4 className="event-title">{event.title}</h4>
                {event.venue && (
                  <p className="event-venue">📍 {event.venue}</p>
                )}
                {event.snippet && (
                  <p className="event-snippet">{event.snippet.slice(0, 150)}...</p>
                )}
                {event.moodScore !== undefined && (
                  <div className="event-mood">
                    <span className="mood-label">Mood:</span>
                    <div className="mood-bar">
                      <div className="mood-fill" style={{ width: `${event.moodScore}%` }} />
                    </div>
                    <span className="mood-score">{event.moodScore}</span>
                  </div>
                )}
                <div className="event-popup-footer">
                  <span className="event-location">{event.location?.name}</span>
                  <a
                    href={event.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="event-link"
                  >
                    Details →
                  </a>
                </div>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </MapContainer>
  );
}

export function WorldMap({
  receipts,
  events = [],
  showEvents = true,
  tensionIndex,
  countryMoods = [],
  selectedCountry = null,
  onCountrySelect,
  onCollectCountryData,
}: WorldMapProps) {
  const [zoom, setZoom] = useState(3);
  const [expandedCluster, setExpandedCluster] = useState<MapCluster | null>(null);
  const [spiderLegs, setSpiderLegs] = useState<SpiderLeg[]>([]);
  const [selectedReceipt, setSelectedReceipt] = useState<Receipt | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<Receipt | null>(null);
  const [countryBoundariesWithMood, setCountryBoundariesWithMood] = useState<CountryBoundaryWithMood[]>([]);
  const [boundaryLoading, setBoundaryLoading] = useState(true);
  const [selectedCountryBoundary, setSelectedCountryBoundary] = useState<CountryBoundary | null>(null);
  const mapRef = useRef<LeafletMapType | null>(null);

  // Non-country regions that should be skipped (must match geocoding.ts)
  const NON_COUNTRY_REGIONS = useMemo(() => new Set([
    'middle east', 'europe', 'european union', 'eu', 'asia pacific',
    'south america', 'north america', 'africa', 'asia', 'oceania',
    'worldwide', 'global', 'international', 'latin america',
    'southeast asia', 'central asia', 'central america', 'caribbean',
    'balkans', 'scandinavia', 'gulf states', 'levant', 'maghreb',
    'sahel', 'sub-saharan africa', 'east asia', 'south asia',
    'west africa', 'east africa', 'southern africa', 'central europe',
    'eastern europe', 'western europe', 'northern europe', 'southern europe',
    'british isles', 'iberian peninsula', 'arabian peninsula', 'indochina',
    'melanesia', 'micronesia', 'polynesia', 'australasia',
  ]), []);

  // Filter to only valid countries (not regions) - memoized
  const validCountryMoods = useMemo(() =>
    countryMoods.filter(
      m => m.country && !NON_COUNTRY_REGIONS.has(m.country.toLowerCase())
    ),
    [countryMoods, NON_COUNTRY_REGIONS]
  );

  // Memoize the country names for dependency tracking
  const countryNames = useMemo(
    () => validCountryMoods.map(m => m.country).sort().join(','),
    [validCountryMoods]
  );

  console.log('[MAP] countryMoods prop:', countryMoods.length, countryMoods.map(m => m.country));
  console.log('[MAP] validCountryMoods:', validCountryMoods.length, validCountryMoods.map(m => m.country));

  // Fetch boundaries for all countries with mood data (in parallel, non-blocking)
  useEffect(() => {
    // Use a flag to track if effect is still active
    let isActive = true;

    // Async IIFE to handle all state updates after async operations
    (async () => {
      if (validCountryMoods.length === 0) {
        console.log('[MAP] No valid country moods, skipping boundary fetch');
        // Wrap in microtask to avoid synchronous setState in effect
        await Promise.resolve();
        if (isActive) {
          setCountryBoundariesWithMood([]);
          setBoundaryLoading(false);
        }
        return;
      }

      console.log('[MAP] Fetching boundaries for:', validCountryMoods.map(m => m.country).join(', '));
      // Set loading state after microtask
      await Promise.resolve();
      if (!isActive) return;
      setBoundaryLoading(true);

      // Fetch all boundaries in parallel
      const results = await Promise.all(
        validCountryMoods.map(async (mood) => {
          try {
            const response = await fetch(`/api/boundary?country=${encodeURIComponent(mood.country)}`);
            if (response.ok) {
              const boundary = await response.json();
              console.log(`[MAP] Fetched boundary for ${mood.country}`);
              return { boundary, mood };
            } else {
              console.error(`[MAP] Failed to fetch boundary for ${mood.country}: ${response.status}`);
            }
          } catch (error) {
            console.error(`[MAP] Error fetching boundary for ${mood.country}:`, error);
          }
          return null;
        })
      );

      if (isActive) {
        const validBoundaries = results.filter(Boolean) as CountryBoundaryWithMood[];
        console.log('[MAP] Loaded boundaries:', validBoundaries.length, validBoundaries.map(b => b.mood.country));
        setCountryBoundariesWithMood(validBoundaries);
        setBoundaryLoading(false);
      }
    })();

    return () => { isActive = false; };
  }, [countryNames, validCountryMoods]);

  // Filter receipts with valid locations
  const locatedReceipts = receipts.filter((r) => r.location);
  console.log('[MAP] Receipts:', receipts.length, 'with location:', locatedReceipts.length);

  // Filter events with valid locations
  const locatedEvents = events.filter((e) => e.location);
  console.log('[MAP] Events:', events.length, 'with location:', locatedEvents.length);

  // Cluster receipts based on current zoom
  const clusters = clusterReceipts(locatedReceipts, zoom);
  console.log('[MAP] Created', clusters.length, 'clusters from', locatedReceipts.length, 'receipts');

  // Handle cluster click - expand to show spider legs
  const handleClusterClick = useCallback(
    (cluster: MapCluster) => {
      setExpandedCluster((current) => {
        if (current?.id === cluster.id) {
          // Clicking same cluster - collapse it
          setSpiderLegs([]);
          return null;
        } else {
          // Expand this cluster
          setSpiderLegs(calculateSpiderLegs(cluster.receipts));
          setSelectedReceipt(null);

          // Optionally center the map on the cluster
          if (mapRef.current) {
            mapRef.current.flyTo([cluster.lat, cluster.lng], Math.max(zoom, 8), { duration: 0.5 });
          }
          return cluster;
        }
      });
    },
    [zoom]
  );

  // Handle spider leg click - show receipt detail
  const handleSpiderLegClick = useCallback((receipt: Receipt) => {
    setSelectedReceipt(receipt);
  }, []);

  // Handle event click
  const handleEventClick = useCallback((event: Receipt) => {
    setSelectedEvent(event);
  }, []);

  // Handle map click - collapse expanded cluster and deselect country
  const handleMapClick = useCallback(() => {
    setExpandedCluster(null);
    setSpiderLegs([]);
    setSelectedReceipt(null);
    setSelectedEvent(null);
    // Deselect country when clicking on map background
    onCountrySelect?.(null);
  }, [onCountrySelect]);

  // Handle country click - toggle selection and close spider
  const handleCountryClick = useCallback((country: string) => {
    console.log('[MAP] Country clicked:', country);
    // Close any open spider panel
    setExpandedCluster(null);
    setSpiderLegs([]);
    // Toggle: if same country clicked, deselect; otherwise select
    onCountrySelect?.(selectedCountry === country ? null : country);
  }, [onCountrySelect, selectedCountry]);

  return (
    <div className="world-map-container">
      <LeafletMap
        tensionIndex={tensionIndex}
        clusters={clusters}
        events={locatedEvents}
        showEvents={showEvents}
        expandedCluster={expandedCluster}
        spiderLegs={spiderLegs}
        zoom={zoom}
        setZoom={setZoom}
        onClusterClick={handleClusterClick}
        onSpiderLegClick={handleSpiderLegClick}
        onEventClick={handleEventClick}
        onMapClick={handleMapClick}
        onCountryClick={handleCountryClick}
        mapRef={mapRef}
        countryBoundariesWithMood={countryBoundariesWithMood}
        selectedCountry={selectedCountry}
      />

      {/* Country info panel - shows when a country is selected */}
      {selectedCountry && !expandedCluster && (
        <CountryInfoPanel
          country={selectedCountry}
          countryMoods={countryMoods}
          onClose={() => onCountrySelect?.(null)}
          onCollectData={() => onCollectCountryData?.(selectedCountry)}
        />
      )}

      {/* News items panel - shows all items from expanded cluster */}
      {expandedCluster && (
        <div className="spider-panel">
          <div className="spider-panel-header">
            <h3>{expandedCluster.receipts.length} News Items</h3>
            {expandedCluster.receipts[0]?.location && (
              <span className="spider-panel-location">
                {expandedCluster.receipts[0].location.name
                  || expandedCluster.receipts[0].location.country
                  || expandedCluster.receipts[0].location.region}
              </span>
            )}
            <button
              onClick={() => {
                setExpandedCluster(null);
                setSpiderLegs([]);
              }}
              aria-label="Close"
            >
              &times;
            </button>
          </div>
          <div className="spider-panel-list">
            {expandedCluster.receipts.map((receipt, index) => (
              <div
                key={receipt.id}
                className={`spider-panel-item ${selectedReceipt?.id === receipt.id ? 'selected' : ''}`}
                onClick={() => setSelectedReceipt(receipt)}
                style={{
                  animationDelay: `${index * 50}ms`,
                  borderLeftColor: SOURCE_COLORS[receipt.source] || '#6b7280'
                }}
              >
                <div className="item-header">
                  <span className="item-source" style={{ color: SOURCE_COLORS[receipt.source] }}>
                    {receipt.source}
                  </span>
                  <span className="item-time">{getRelativeTime(receipt.createdAt)}</span>
                </div>
                <h4 className="item-title">{receipt.title}</h4>
                {receipt.snippet && (
                  <p className="item-snippet">{receipt.snippet.slice(0, 120)}...</p>
                )}
                <div className="item-footer">
                  <a
                    href={receipt.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="item-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Read article →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
