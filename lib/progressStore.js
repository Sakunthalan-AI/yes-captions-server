// In-memory progress store (in production, use Redis or similar)
const progressStore = new Map();

export function setProgress(exportId, progress) {
  progressStore.set(exportId, progress);
  // Clean up old entries after 5 minutes
  setTimeout(() => {
    progressStore.delete(exportId);
  }, 5 * 60 * 1000);
}

export function getProgress(exportId) {
  return progressStore.get(exportId) || 0;
}



