/**
 * Get visible subtitles at a given time
 * Returns only the best/most relevant subtitle to avoid overlapping
 * This matches the UI logic from page.js
 */
export function getVisibleSubtitles(subtitles, currentTime) {
  const TIMING_BUFFER = 0.05; // 50ms buffer to show captions early
  const adjustedTime = currentTime + TIMING_BUFFER;

  const candidates = subtitles
    .map((sub) => {
      let score = 0;
      let hasActiveWord = false;
      let activeWordCount = 0;
      let earliestStart = Infinity;
      let latestEnd = -Infinity;

      // If subtitle has word-by-word timestamps, check each word
      if (sub.words && Array.isArray(sub.words) && sub.words.length > 0) {
        sub.words.forEach((word) => {
          const isActive = adjustedTime >= word.start && adjustedTime <= word.end;
          const hasAppeared = adjustedTime >= word.start;
          const isAboutToAppear = adjustedTime >= (word.start - TIMING_BUFFER) && adjustedTime < word.start;

          if (isActive) {
            hasActiveWord = true;
            activeWordCount++;
            score += 10; // High score for active words
          } else if (isAboutToAppear) {
            score += 5;
          } else if (hasAppeared) {
            // Only give score if we're still within a reasonable time after the word ended
            // Don't show words that ended too long ago
            const timeSinceEnd = adjustedTime - word.end;
            if (timeSinceEnd <= 0.1) { // Only show if ended less than 100ms ago
              score += 2; // Medium score for recently appeared words
            }
          }

          earliestStart = Math.min(earliestStart, word.start);
          latestEnd = Math.max(latestEnd, word.end);
        });

        // Only show caption if we're within the subtitle's overall time range (with buffer)
        const isWithinSubtitleRange = adjustedTime >= (earliestStart - TIMING_BUFFER) && adjustedTime <= (latestEnd + 0.1);
        
        if (!isWithinSubtitleRange) {
          // Caption is completely outside its time range, don't show it
          score = 0;
        } else {
          // Prefer captions that are currently active
          if (hasActiveWord) {
            score += 100;
          }

          // Prefer captions that started more recently
          const timeSinceStart = adjustedTime - earliestStart;
          if (timeSinceStart >= -TIMING_BUFFER && timeSinceStart < 0.5) {
            score += 20; // Bonus for recently started captions
          }
        }
      } else {
        // Fallback: use subtitle's overall range
        const isInRange = adjustedTime >= sub.start && adjustedTime <= sub.end;
        if (isInRange) {
          score = 50;
          hasActiveWord = true;
          earliestStart = sub.start;
          latestEnd = sub.end;
        } else {
          // Check if subtitle is about to start (within buffer)
          const isAboutToStart = adjustedTime >= (sub.start - TIMING_BUFFER) && adjustedTime < sub.start;
          if (isAboutToStart) {
            score = 10; // Lower score for about-to-start captions
            earliestStart = sub.start;
            latestEnd = sub.end;
          }
        }
      }

      return {
        subtitle: sub,
        score,
        hasActiveWord,
        activeWordCount,
        earliestStart,
        latestEnd,
      };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => {
      // Sort by: active words first, then by score, then by start time
      if (a.hasActiveWord !== b.hasActiveWord) {
        return b.hasActiveWord - a.hasActiveWord;
      }
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      return b.earliestStart - a.earliestStart; // Most recent first
    });

  // Return only the top candidate - show one caption at a time to avoid overlap
  if (candidates.length === 0) return [];

  return [candidates[0].subtitle];
}



