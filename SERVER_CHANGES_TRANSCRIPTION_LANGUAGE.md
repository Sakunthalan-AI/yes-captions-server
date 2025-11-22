# Server-Side Changes for Transcription Language Support

## Overview

This document outlines the changes required on the server-side (export worker) to support language-specific transcription. The client-side implementation has been updated to send a `language` parameter in the FormData, and the server needs to handle this parameter.

## Current Implementation

### Client-Side Changes (Already Implemented)

1. **API Route** (`src/app/api/transcribe/route.ts`):
   - Accepts `language` parameter from FormData
   - Forwards it to the worker URL: `${workerUrl}/transcribe`
   - Includes language in the worker FormData

2. **Request Format**:
   ```typescript
   const formData = new FormData();
   formData.append("video", videoFile);
   formData.append("language", languageCode); // ISO 639-1 code (e.g., "en", "es", "zh")
   ```

## Required Server-Side Changes

### 1. Update Worker Endpoint to Accept Language Parameter

The worker's `/transcribe` endpoint needs to:

1. **Extract the language parameter** from the incoming FormData
2. **Pass the language code** to the transcription service/API
3. **Handle default language** (fallback to "en" if not provided)

### 2. Implementation Example

#### For Node.js/Express Worker

```javascript
// Example: server/export-worker/transcribe.js or similar

export async function handleTranscribe(req, res) {
  try {
    // Parse multipart form data
    const formData = await parseFormData(req);
    const videoFile = formData.get('video');
    const language = formData.get('language') || 'en'; // Default to English

    if (!videoFile) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    // Validate language code (optional but recommended)
    const validLanguageCodes = [
      'en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id', 'ru', 'ur',
      'de', 'ja', 'mr', 'vi', 'te', 'ha', 'tr', 'sw', 'tl', 'ta', 'fa',
      'ko', 'th', 'jv', 'it', 'gu', 'am', 'kn', 'bho', 'pa', 'pcm', 'pl',
      'uk', 'ro'
    ];
    
    const languageCode = validLanguageCodes.includes(language) 
      ? language 
      : 'en'; // Fallback to English if invalid

    // Call your transcription service with language parameter
    const transcriptionResult = await transcribeVideo(videoFile, {
      language: languageCode,
      // ... other options
    });

    return res.json(transcriptionResult);
  } catch (error) {
    console.error('Transcription error:', error);
    return res.status(500).json({ 
      error: error.message || 'Transcription failed' 
    });
  }
}
```

#### For Python/FastAPI Worker

```python
# Example: server/export-worker/transcribe.py

from fastapi import FastAPI, File, Form, UploadFile
from typing import Optional

app = FastAPI()

@app.post("/transcribe")
async def transcribe_video(
    video: UploadFile = File(...),
    language: Optional[str] = Form("en")  # Default to English
):
    # Validate language code
    valid_language_codes = [
        'en', 'zh', 'hi', 'es', 'ar', 'fr', 'bn', 'pt', 'id', 'ru', 'ur',
        'de', 'ja', 'mr', 'vi', 'te', 'ha', 'tr', 'sw', 'tl', 'ta', 'fa',
        'ko', 'th', 'jv', 'it', 'gu', 'am', 'kn', 'bho', 'pa', 'pcm', 'pl',
        'uk', 'ro'
    ]
    
    language_code = language if language in valid_language_codes else 'en'
    
    # Call your transcription service
    result = await transcribe_video_service(
        video_file=video,
        language=language_code
    )
    
    return result
```

### 3. Integration with Transcription Service

The language code needs to be passed to your transcription service. Here are examples for common services:

#### OpenAI Whisper API

```javascript
// OpenAI Whisper expects language code
const transcription = await openai.audio.transcriptions.create({
  file: videoFile,
  model: "whisper-1",
  language: languageCode, // ISO 639-1 code
  response_format: "verbose_json" // For word-level timestamps
});
```

#### Google Cloud Speech-to-Text

```javascript
const request = {
  audio: {
    content: audioBuffer.toString('base64'),
  },
  config: {
    encoding: 'LINEAR16',
    sampleRateHertz: 16000,
    languageCode: languageCode, // e.g., 'en-US', 'es-ES', 'zh-CN'
    enableWordTimeOffsets: true,
  },
};

const [response] = await speechClient.recognize(request);
```

#### AssemblyAI

```javascript
const transcript = await assemblyai.transcripts.transcribe({
  audio: audioUrl,
  language_code: languageCode, // ISO 639-1 code
  word_timestamps: true,
});
```

#### Deepgram

```javascript
const transcription = await deepgram.transcription.preRecorded.transcribeFile(
  audioBuffer,
  {
    model: 'nova-2',
    language: languageCode, // ISO 639-1 code
    punctuate: true,
    diarize: false,
    smart_format: true,
  }
);
```

### 4. Language Code Mapping

Some services may require specific language code formats:

- **ISO 639-1** (2-letter): `en`, `es`, `fr`, `zh`, etc.
- **BCP-47** (with region): `en-US`, `es-ES`, `zh-CN`, etc.
- **Service-specific**: Some services use their own codes

You may need to map ISO 639-1 codes to the format your service expects:

```javascript
const languageCodeMap = {
  'en': 'en-US',
  'es': 'es-ES',
  'fr': 'fr-FR',
  'zh': 'zh-CN',
  'ar': 'ar-SA',
  // ... add more mappings as needed
};

const serviceLanguageCode = languageCodeMap[languageCode] || languageCode;
```

### 5. Error Handling

Handle cases where:
- Language parameter is missing (default to 'en')
- Invalid language code provided (default to 'en' or return error)
- Transcription service doesn't support the language (return appropriate error)

```javascript
try {
  const result = await transcribeWithLanguage(videoFile, languageCode);
  return result;
} catch (error) {
  if (error.message.includes('unsupported language')) {
    return res.status(400).json({ 
      error: `Language '${languageCode}' is not supported` 
    });
  }
  throw error;
}
```

## Testing Checklist

- [ ] Worker accepts `language` parameter from FormData
- [ ] Default language is 'en' when parameter is missing
- [ ] Invalid language codes are handled gracefully
- [ ] Language code is correctly passed to transcription service
- [ ] Transcription works correctly for multiple languages
- [ ] Error messages are clear when language is unsupported

## Supported Languages

The following ISO 639-1 language codes are supported by the client:

1. `en` - English
2. `zh` - Mandarin Chinese / Yue Chinese / Wu Chinese
3. `hi` - Hindi
4. `es` - Spanish
5. `ar` - Modern Standard Arabic / Sudanese Arabic / Egyptian Arabic / Levantine Arabic
6. `fr` - French
7. `bn` - Bengali
8. `pt` - Portuguese
9. `id` - Indonesian
10. `ru` - Russian
11. `ur` - Urdu
12. `de` - Standard German
13. `ja` - Japanese
14. `mr` - Marathi
15. `vi` - Vietnamese
16. `te` - Telugu
17. `ha` - Hausa
18. `tr` - Turkish
19. `sw` - Swahili
20. `tl` - Tagalog
21. `ta` - Tamil
22. `fa` - Iranian Persian
23. `ko` - Korean
24. `th` - Thai
25. `jv` - Javanese
26. `it` - Italian
27. `gu` - Gujarati
28. `am` - Amharic
29. `kn` - Kannada
30. `bho` - Bhojpuri
31. `pa` - Western Punjabi
32. `pcm` - Nigerian Pidgin
33. `pl` - Polish
34. `uk` - Ukrainian
35. `ro` - Romanian

## Notes

- The client sends ISO 639-1 codes (2-letter language codes)
- Some languages share the same code (e.g., multiple Chinese variants use `zh`)
- The server should handle these appropriately based on the transcription service's capabilities
- If your transcription service doesn't support a particular language, return a clear error message

## Example Request Flow

```
Client → Next.js API Route → Worker
  ↓           ↓                ↓
FormData   Extract          Extract
+ video    language         language
+ language Forward to       Pass to
          worker            transcription
                            service
```

## Additional Resources

- [ISO 639-1 Language Codes](https://en.wikipedia.org/wiki/List_of_ISO_639-1_codes)
- [BCP-47 Language Tags](https://tools.ietf.org/html/bcp47)
- Your transcription service's language support documentation

