/**
 * Scan Status Management
 * Tracks background scan progress for UI feedback
 * Supports multi-region progress tracking (displays slowest region)
 */

export type ScanPhase =
  | 'idle'
  | 'fetching'      // Fetching from sources
  | 'processing'    // Deduplicating, scoring mood
  | 'clustering'    // Topic clustering
  | 'summarizing'   // LLM summaries
  | 'saving'        // Saving to history
  | 'complete'
  | 'error';

export interface ScanStatus {
  phase: ScanPhase;
  message: string;
  progress?: number; // 0-100
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
  itemCount?: number;
}

// In-memory scan status (single instance for this process)
let currentStatus: ScanStatus = {
  phase: 'idle',
  message: 'Ready',
};

let scanPromise: Promise<void> | null = null;

// Per-region progress tracking (region name -> progress 0-100)
const regionProgress: Map<string, { progress: number; message: string }> = new Map();
let totalRegions = 0;

export function getScanStatus(): ScanStatus {
  return { ...currentStatus };
}

/**
 * Initialize region tracking for the fetching phase
 * Call this before starting parallel region fetches
 */
export function initRegionTracking(regions: string[]): void {
  regionProgress.clear();
  totalRegions = regions.length;
  for (const region of regions) {
    regionProgress.set(region, { progress: 0, message: 'Starting...' });
  }
}

/**
 * Update progress for a specific region
 * The overall progress will be the minimum (slowest) across all regions
 */
export function updateRegionProgress(region: string, progress: number, message: string): void {
  regionProgress.set(region, { progress, message });

  // Calculate overall progress as minimum of all regions
  if (regionProgress.size > 0) {
    let minProgress = 100;
    let slowestRegion = '';
    for (const [r, p] of regionProgress) {
      if (p.progress < minProgress) {
        minProgress = p.progress;
        slowestRegion = r;
      }
    }

    // Update status with slowest region's info
    const slowestInfo = regionProgress.get(slowestRegion);
    const regionLabel = totalRegions > 1 ? ` (${slowestRegion})` : '';
    updateScanStatus({
      phase: 'fetching',
      message: `${slowestInfo?.message || message}${regionLabel}`,
      progress: minProgress,
    });
  }
}

/**
 * Clear region tracking (call after fetching phase completes)
 */
export function clearRegionTracking(): void {
  regionProgress.clear();
  totalRegions = 0;
}

export function updateScanStatus(update: Partial<ScanStatus>): void {
  currentStatus = { ...currentStatus, ...update };
  console.log(`[SCAN] ${update.phase || currentStatus.phase}: ${update.message || currentStatus.message} (${currentStatus.progress || 0}%)`);
}

/**
 * Progress ranges for each phase (for consistent progress calculation)
 * Fetching: 0-50% (most time spent here - searching, scraping, extracting)
 * Processing: 50-60%
 * Clustering: 60-70%
 * Summarizing: 70-90%
 * Saving: 90-100%
 */
export const PHASE_PROGRESS = {
  fetching: { start: 0, end: 50 },
  processing: { start: 50, end: 60 },
  clustering: { start: 60, end: 70 },
  summarizing: { start: 70, end: 90 },
  saving: { start: 90, end: 100 },
} as const;

/**
 * Calculate progress within a phase
 * @param phase - Current phase
 * @param stepProgress - Progress within this phase (0-100)
 */
export function calculatePhaseProgress(phase: keyof typeof PHASE_PROGRESS, stepProgress: number): number {
  const range = PHASE_PROGRESS[phase];
  return Math.round(range.start + (stepProgress / 100) * (range.end - range.start));
}

export function isScanInProgress(): boolean {
  return currentStatus.phase !== 'idle' &&
         currentStatus.phase !== 'complete' &&
         currentStatus.phase !== 'error';
}

export function setScanPromise(promise: Promise<void> | null): void {
  scanPromise = promise;
}

export function getScanPromise(): Promise<void> | null {
  return scanPromise;
}

export function resetScanStatus(): void {
  currentStatus = {
    phase: 'idle',
    message: 'Ready',
  };
  scanPromise = null;
}
