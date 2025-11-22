import fs from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { promisify } from "node:util";
import type { TranscriptionResponse, Word } from "./types.js";
import FormData from "form-data";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

// Ensure fluent-ffmpeg uses the cross-platform binaries from npm on all OSes
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

// Helper functions from legacy code
const clamp = (value: number, min: number, max: number) =>
    Math.min(Math.max(value, min), max);

const roundTo = (value: number, precision = 2) => {
    const factor = 10 ** precision;
    return Math.round(value * factor) / factor;
};

const MIN_WORD_DURATION = 0.05; // 50ms
const MIN_SEGMENT_DURATION = 0.2; // 200ms

interface WordGroup {
    words: Word[];
    start: number;
    end: number;
    text: string;
}

function groupWordsByTiming(words: Word[]): WordGroup[] {
    if (!words || words.length === 0) return [];

    const groups: WordGroup[] = [];
    let currentGroup: Word[] = [];

    // Adaptive thresholds based on speech speed
    const FAST_SPEECH_THRESHOLD = 0.06;
    const NORMAL_SPEECH_THRESHOLD = 0.12;
    const SLOW_SPEECH_THRESHOLD = 0.2;

    const MAX_GROUP_DURATION = 0.6;
    const MAX_WORDS_PER_GROUP = 4;
    const MIN_WORDS_PER_GROUP = 1;

    // Calculate average speech speed
    let avgGap = 0;
    let gapCount = 0;
    for (let i = 0; i < Math.min(words.length - 1, 10); i++) {
        const gap = words[i + 1].start - words[i].end;
        if (gap > 0) {
            avgGap += gap;
            gapCount++;
        }
    }
    avgGap = gapCount > 0 ? avgGap / gapCount : 0.1;

    let timingThreshold = NORMAL_SPEECH_THRESHOLD;
    if (avgGap < 0.05) timingThreshold = FAST_SPEECH_THRESHOLD;
    else if (avgGap < 0.1) timingThreshold = FAST_SPEECH_THRESHOLD + 0.02;
    else if (avgGap > 0.25) timingThreshold = SLOW_SPEECH_THRESHOLD;

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const nextWord = words[i + 1];

        let roundedStart = roundTo(word.start ?? 0, 2);
        let roundedEnd = roundTo(word.end ?? roundedStart, 2);
        if (!Number.isFinite(roundedStart)) roundedStart = 0;
        if (!Number.isFinite(roundedEnd)) roundedEnd = roundedStart + MIN_WORD_DURATION;
        if (roundedEnd - roundedStart < MIN_WORD_DURATION) {
            roundedEnd = roundedStart + MIN_WORD_DURATION;
        }
        const roundedWord: Word = {
            word: word.word || "",
            start: roundedStart,
            end: roundedEnd,
        };

        currentGroup.push(roundedWord);

        let shouldEndGroup = false;
        let forceEndGroup = false;

        const hasPunctuation = /[.!?;:]/.test(roundedWord.word);
        const hasComma = /,/.test(roundedWord.word);

        if (hasPunctuation) forceEndGroup = true;
        else if (hasComma && currentGroup.length >= 2) shouldEndGroup = true;

        if (currentGroup.length > 0) {
            const groupStart = currentGroup[0].start;
            const groupEnd = roundedWord.end;
            if (groupEnd - groupStart >= MAX_GROUP_DURATION) shouldEndGroup = true;
        }

        if (currentGroup.length >= MAX_WORDS_PER_GROUP) shouldEndGroup = true;

        if (nextWord) {
            const gap = nextWord.start - word.end;
            if (gap > timingThreshold * 2) forceEndGroup = true;
            else if (gap > timingThreshold && currentGroup.length >= MIN_WORDS_PER_GROUP) shouldEndGroup = true;
        } else {
            forceEndGroup = true;
        }

        if ((forceEndGroup || shouldEndGroup) && currentGroup.length > 0) {
            groups.push({
                words: [...currentGroup],
                start: currentGroup[0].start,
                end: Math.max(
                    currentGroup[currentGroup.length - 1].end,
                    currentGroup[0].start + MIN_SEGMENT_DURATION
                ),
                text: currentGroup.map(w => w.word).join(" "),
            });
            currentGroup = [];
        }
    }

    if (currentGroup.length > 0) {
        groups.push({
            words: [...currentGroup],
            start: currentGroup[0].start,
            end: Math.max(
                currentGroup[currentGroup.length - 1].end,
                currentGroup[0].start + MIN_SEGMENT_DURATION
            ),
            text: currentGroup.map(w => w.word).join(" "),
        });
    }

    return groups;
}

const normalizeSegments = (
    segments: Array<{ text: string; start: number; end: number; words: Word[] | null }>,
    totalDuration?: number
) => {
    const safeDuration = Number.isFinite(totalDuration || NaN)
        ? (totalDuration as number)
        : undefined;

    const sanitized = segments
        .map((segment) => {
            let start = Number.isFinite(segment.start) ? segment.start : 0;
            let end = Number.isFinite(segment.end) ? segment.end : start;
            if (end - start < MIN_SEGMENT_DURATION) {
                end = start + MIN_SEGMENT_DURATION;
            }
            const words = segment.words
                ? segment.words.map((word) => {
                    let wordStart = Number.isFinite(word.start) ? word.start : start;
                    let wordEnd = Number.isFinite(word.end) ? word.end : wordStart;
                    if (wordEnd - wordStart < MIN_WORD_DURATION) {
                        wordEnd = wordStart + MIN_WORD_DURATION;
                    }
                    return {
                        ...word,
                        start: wordStart,
                        end: wordEnd,
                    };
                })
                : null;

            return {
                ...segment,
                start,
                end,
                words,
            };
        })
        .sort((a, b) => a.start - b.start);

    let cursor = 0;
    return sanitized.map((segment, index) => {
        let start = Math.max(segment.start, cursor);
        let end = Math.max(segment.end, start + MIN_SEGMENT_DURATION);
        const nextStart = sanitized[index + 1]?.start;
        if (typeof nextStart === "number" && nextStart > start) {
            end = Math.min(end, nextStart);
        }
        if (safeDuration !== undefined) {
            start = clamp(start, 0, safeDuration);
            end = clamp(end, start + MIN_SEGMENT_DURATION, safeDuration);
        }
        cursor = end;

        const boundedWords = segment.words
            ? segment.words
                .map((word, wordIndex, arr) => {
                    let wordStart = clamp(word.start, start, end);
                    let wordEnd = clamp(word.end, wordStart + MIN_WORD_DURATION, end);
                    if (wordEnd - wordStart < MIN_WORD_DURATION) {
                        wordEnd = Math.min(end, wordStart + MIN_WORD_DURATION);
                    }
                    if (wordIndex === arr.length - 1) {
                        wordEnd = end;
                    }
                    return {
                        ...word,
                        start: roundTo(wordStart, 2),
                        end: roundTo(wordEnd, 2),
                    };
                })
                .filter((word) => word.start < end)
            : null;

        return {
            ...segment,
            start: roundTo(start, 2),
            end: roundTo(end, 2),
            words: boundedWords,
        };
    });
};

export async function transcribeVideo(videoPath: string, tempDir: string): Promise<TranscriptionResponse> {
    let audioPath: string | null = null;

    try {
        // Check video duration
        const duration = await new Promise<number>((resolve, reject) => {
            ffmpeg.ffprobe(videoPath, (err, metadata) => {
                if (err) reject(err);
                else resolve(metadata?.format?.duration || 0);
            });
        });

        if (duration > 60) {
            throw new Error("Video must be less than 60 seconds");
        }

        // Extract audio
        audioPath = path.join(tempDir, `audio_${Date.now()}.wav`);

        await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error("Audio extraction timeout"));
            }, 60000);

            ffmpeg(videoPath)
                .outputOptions([
                    "-vn",
                    "-acodec", "pcm_s16le",
                    "-ar", "16000",
                    "-ac", "1",
                    "-f", "wav",
                    "-y"
                ])
                .output(audioPath!)
                .on("end", () => {
                    clearTimeout(timeout);
                    resolve();
                })
                .on("error", (err) => {
                    clearTimeout(timeout);
                    reject(err);
                })
                .run();
        });

        // Read audio file
        const audioBuffer = await fs.promises.readFile(audioPath);

        // Prepare Groq request
        const groqFormData = new FormData();
        groqFormData.append("file", audioBuffer, {
            filename: "audio.wav",
            contentType: "audio/wav",
        });
        groqFormData.append("model", "whisper-large-v3-turbo");
        groqFormData.append("temperature", "0");
        groqFormData.append("response_format", "verbose_json");
        groqFormData.append("language", "en");
        groqFormData.append("timestamp_granularities[]", "word");

        const groqApiKey = "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";
        if (!groqApiKey) {
            throw new Error("GROQ_API_KEY environment variable is not set");
        }

        // Convert FormData to buffer/headers for fetch
        // Note: In Node environment with form-data package, we need to handle this carefully
        // Using a simpler approach compatible with node-fetch/native fetch if possible, 
        // but form-data package is reliable for multipart.

        // We'll use the form-data submit method or stream it to a buffer
        // Since we're in a modern Node env with global fetch, let's try to use the buffer approach 
        // similar to the legacy code which seemed to work or be intended to work.

        const headers = groqFormData.getHeaders();
        headers["Authorization"] = `Bearer ${groqApiKey}`;

        // Buffer the form data
        const formDataBuffer = await new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            groqFormData.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
            groqFormData.on("end", () => resolve(Buffer.concat(chunks)));
            groqFormData.on("error", reject);
            groqFormData.resume();
        });

        const groqResponse = await fetch(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            {
                method: "POST",
                headers: headers as any,
                body: formDataBuffer as any, // Cast to any to satisfy type checker for Buffer vs BodyInit
            }
        );

        if (!groqResponse.ok) {
            const errorText = await groqResponse.text();
            throw new Error(`Groq API error: ${groqResponse.status} - ${errorText}`);
        }

        const groqData = await groqResponse.json() as any;

        // Process segments
        let segments: Array<{ text: string; start: number; end: number; words: Word[] | null }> = [];

        if (groqData.segments && Array.isArray(groqData.segments)) {
            const allWords: Word[] = [];
            groqData.segments.forEach((seg: any) => {
                if (seg.words && Array.isArray(seg.words) && seg.words.length > 0) {
                    seg.words.forEach((word: any) => {
                        allWords.push({
                            word: word.word || "",
                            start: word.start || seg.start || 0,
                            end: word.end || seg.end || 0,
                        });
                    });
                } else {
                    segments.push({
                        text: seg.text || "",
                        start: Math.round((seg.start || 0) * 100) / 100,
                        end: Math.round((seg.end || 0) * 100) / 100,
                        words: null,
                    });
                }
            });

            if (allWords.length > 0) {
                const wordGroups = groupWordsByTiming(allWords);
                segments = wordGroups.map(group => ({
                    text: group.text,
                    start: group.start,
                    end: group.end,
                    words: group.words,
                }));
            }
        } else if (groqData.words && Array.isArray(groqData.words)) {
            const wordGroups = groupWordsByTiming(groqData.words);
            segments = wordGroups.map(group => ({
                text: group.text,
                start: group.start,
                end: group.end,
                words: group.words,
            }));
        } else if (groqData.text) {
            segments.push({
                text: groqData.text || "",
                start: 0,
                end: Math.round((duration || 0) * 100) / 100,
                words: null,
            });
        }

        segments = normalizeSegments(segments, duration);

        // Cleanup audio file
        if (audioPath && fs.existsSync(audioPath)) {
            await fs.promises.unlink(audioPath).catch(() => { });
        }

        return {
            segments,
            duration,
            rawGroqResponse: groqData,
        };

    } catch (error) {
        // Cleanup on error
        if (audioPath && fs.existsSync(audioPath)) {
            await fs.promises.unlink(audioPath).catch(() => { });
        }
        throw error;
    }
}
