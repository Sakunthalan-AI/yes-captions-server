// In-memory progress store with SSE subscription support
// In production, use Redis or similar for distributed systems

export interface ProgressState {
  progress: number;
  stage: string;
  message?: string;
}

type ProgressCallback = (state: ProgressState) => void;

const progressStore = new Map<string, ProgressState>();
const subscribers = new Map<string, Set<ProgressCallback>>();
const cleanupTimers = new Map<string, NodeJS.Timeout>();

/**
 * Set progress state for an exportId
 */
export function setProgress(
  exportId: string,
  progress: number,
  stage: string,
  message?: string
): void {
  const state: ProgressState = { progress, stage, message };

  // Update store
  progressStore.set(exportId, state);

  // Notify all subscribers
  const callbacks = subscribers.get(exportId);
  if (callbacks) {
    callbacks.forEach((callback) => {
      try {
        callback(state);
      } catch (error) {
        console.error(`Error in progress callback for ${exportId}:`, error);
      }
    });
  }

  // Reset cleanup timer
  const existingTimer = cleanupTimers.get(exportId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Auto-cleanup after 10 minutes
  const timer = setTimeout(() => {
    progressStore.delete(exportId);
    subscribers.delete(exportId);
    cleanupTimers.delete(exportId);
  }, 10 * 60 * 1000);

  cleanupTimers.set(exportId, timer);
}

/**
 * Get current progress state for an exportId
 */
export function getProgress(exportId: string): ProgressState | null {
  return progressStore.get(exportId) || null;
}

/**
 * Subscribe to progress updates for an exportId
 */
export function subscribe(exportId: string, callback: ProgressCallback): () => void {
  if (!subscribers.has(exportId)) {
    subscribers.set(exportId, new Set());
  }

  const callbacks = subscribers.get(exportId)!;
  callbacks.add(callback);

  // Immediately send current state if available
  const currentState = progressStore.get(exportId);
  if (currentState) {
    try {
      callback(currentState);
    } catch (error) {
      console.error(`Error in initial progress callback for ${exportId}:`, error);
    }
  }

  // Return unsubscribe function
  return () => {
    unsubscribe(exportId, callback);
  };
}

/**
 * Unsubscribe from progress updates for an exportId
 */
export function unsubscribe(exportId: string, callback: ProgressCallback): void {
  const callbacks = subscribers.get(exportId);
  if (callbacks) {
    callbacks.delete(callback);
    if (callbacks.size === 0) {
      subscribers.delete(exportId);
    }
  }
}

