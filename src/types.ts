// Type definitions for the captions export worker

export interface Word {
    word: string;
    start: number;
    end: number;
}

export interface Size {
    width: number;
    height: number;
}

export interface CaptionExportPosition {
    xPct: number;
    yPct: number;
    xPx: number;
    yPx: number;
}

export interface CaptionExportStyle {
    fontFamily?: string;
    fontSize: number;
    fontWeight?: number | string;
    color: string;
    backgroundColor: string;
    backgroundOpacity: number;
    backgroundEnabled: boolean;
    strokeColor: string;
    strokeWidth: number;
    strokeEnabled: boolean;
}

export interface CaptionWordState {
    appear: number;
    activeStart: number;
    activeEnd: number;
    fade: number;
}

export interface CaptionExportWord extends Word {
    states: CaptionWordState;
}

export interface CaptionExportSubtitle {
    id: string;
    text: string;
    start: number;
    end: number;
    position: CaptionExportPosition;
    words?: CaptionExportWord[] | null;
}

export interface CaptionExportMetadata {
    exportId: string;
    source: "dashboard" | "api";
    requestedAt: string;
    duration?: number;
    canvas: Size;
    exportMode?: "canvas" | "ass";
}

export interface CaptionExportPayload {
    version: string;
    subtitles: CaptionExportSubtitle[];
    style: CaptionExportStyle;
    metadata: CaptionExportMetadata;
}

export interface TranscriptionSegment {
    text: string;
    start: number;
    end: number;
    words: Word[] | null;
}

export interface TranscriptionResponse {
    segments: TranscriptionSegment[];
    duration: number;
    rawGroqResponse?: any;
}
