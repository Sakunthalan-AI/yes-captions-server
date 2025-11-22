# Progress Reporting API Documentation

## Overview

The export worker now supports real-time progress reporting via Server-Sent Events (SSE). This allows clients to receive live updates during video rendering operations.

## SSE Endpoint

### Endpoint
```
GET /progress/:exportId
```

### Headers
The endpoint automatically sets the following headers:
- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `Connection: keep-alive`
- `X-Accel-Buffering: no` (disables nginx buffering)

### Parameters
- `exportId` (path parameter): The unique export job identifier

## Progress Stages

The render pipeline progresses through the following stages:

1. **initialization** (0-10%)
   - Setup and file parsing
   - Directory creation
   - Video metadata extraction

2. **video processing** (10-30%)
   - Extracting video frames using FFmpeg
   - Progress updates based on frame extraction

3. **caption rendering** (30-70%)
   - Rendering caption overlays using Puppeteer
   - Progress updates every 10 frames or 5% increments

4. **encoding** (70-95%)
   - Compositing final video with FFmpeg
   - Overlaying captions onto video frames

5. **finalizing** (95-100%)
   - Preparing video file for streaming
   - Final cleanup

6. **complete** (100%)
   - Video export complete

7. **error** (100%)
   - Render failed with error message

## Data Format

### SSE Message Format
Each progress update is sent in SSE format:
```
data: {"progress": 25, "stage": "video processing", "message": "Extracting frames from video"}\n\n
```

### Progress Object Structure
```typescript
interface ProgressUpdate {
  progress: number;    // 0-100
  stage: string;      // Stage name (see above)
  message?: string;   // Optional descriptive message
}
```

### Example Messages

**Initialization:**
```json
{"progress": 5, "stage": "initialization", "message": "Extracting video frames"}
```

**Video Processing:**
```json
{"progress": 15, "stage": "video processing", "message": "Extracting frames from video"}
{"progress": 30, "stage": "video processing", "message": "Video frames extracted"}
```

**Caption Rendering:**
```json
{"progress": 35, "stage": "caption rendering", "message": "Rendering caption overlays"}
{"progress": 50, "stage": "caption rendering", "message": "Rendering caption overlays"}
{"progress": 70, "stage": "caption rendering", "message": "Caption overlays rendered"}
```

**Encoding:**
```json
{"progress": 75, "stage": "encoding", "message": "Compositing video frames"}
{"progress": 90, "stage": "encoding", "message": "Compositing video frames"}
```

**Finalizing:**
```json
{"progress": 95, "stage": "finalizing", "message": "Finalizing video"}
```

**Complete:**
```json
{"progress": 100, "stage": "complete", "message": "Video export complete"}
```

**Error:**
```json
{"progress": 100, "stage": "error", "message": "Render failed: <error message>"}
```

## Heartbeat

The server sends heartbeat messages every 30 seconds to keep the connection alive:
```
: heartbeat\n\n
```

## Client-Side Implementation

### Basic Example (JavaScript)

```javascript
async function connectToProgress(exportId) {
  const eventSource = new EventSource(`/progress/${exportId}`);
  
  eventSource.onmessage = (event) => {
    // Skip heartbeat messages
    if (event.data.startsWith(':')) {
      return;
    }
    
    try {
      const progress = JSON.parse(event.data);
      updateProgressUI(progress);
    } catch (error) {
      console.error('Failed to parse progress update:', error);
    }
  };
  
  eventSource.onerror = (error) => {
    console.error('SSE connection error:', error);
    eventSource.close();
  };
  
  return eventSource;
}

function updateProgressUI(progress) {
  console.log(`Progress: ${progress.progress}% - ${progress.stage}`);
  console.log(`Message: ${progress.message || ''}`);
  
  // Update your UI here
  // e.g., update progress bar, show stage message, etc.
}
```

### React Hook Example

```typescript
import { useEffect, useState } from 'react';

interface ProgressState {
  progress: number;
  stage: string;
  message?: string;
}

export function useProgress(exportId: string | null) {
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!exportId) return;

    const eventSource = new EventSource(`/progress/${exportId}`);

    eventSource.onmessage = (event) => {
      // Skip heartbeat messages
      if (event.data.startsWith(':')) {
        return;
      }

      try {
        const data = JSON.parse(event.data);
        setProgress(data);
        
        // Close connection when complete or error
        if (data.progress === 100) {
          eventSource.close();
        }
      } catch (err) {
        setError(err instanceof Error ? err : new Error('Failed to parse progress'));
      }
    };

    eventSource.onerror = (err) => {
      setError(new Error('SSE connection error'));
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [exportId]);

  return { progress, error };
}
```

### React Component Example

```typescript
import React from 'react';
import { useProgress } from './useProgress';

interface ProgressBarProps {
  exportId: string;
}

export function ProgressBar({ exportId }: ProgressBarProps) {
  const { progress, error } = useProgress(exportId);

  if (error) {
    return <div className="error">Error: {error.message}</div>;
  }

  if (!progress) {
    return <div>Connecting to progress stream...</div>;
  }

  const stageLabels: Record<string, string> = {
    initialization: 'Initializing...',
    'video processing': 'Processing video...',
    'caption rendering': 'Rendering captions...',
    encoding: 'Encoding video...',
    finalizing: 'Finalizing...',
    complete: 'Complete!',
    error: 'Error',
  };

  return (
    <div className="progress-container">
      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${progress.progress}%` }}
        />
      </div>
      <div className="progress-info">
        <span className="progress-percentage">{progress.progress}%</span>
        <span className="progress-stage">
          {stageLabels[progress.stage] || progress.stage}
        </span>
      </div>
      {progress.message && (
        <div className="progress-message">{progress.message}</div>
      )}
    </div>
  );
}
```

### Next.js API Route Example (Proxy)

If you need to proxy the SSE connection through Next.js:

```typescript
// pages/api/progress/[exportId].ts or app/api/progress/[exportId]/route.ts
import { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { exportId } = req.query;
  const workerUrl = process.env.EXPORT_WORKER_URL || 'http://localhost:3001';

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    const response = await fetch(`${workerUrl}/progress/${exportId}`, {
      headers: {
        'Accept': 'text/event-stream',
      },
    });

    if (!response.ok) {
      res.status(response.status).json({ error: 'Failed to connect to progress stream' });
      return;
    }

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) {
      res.status(500).json({ error: 'No response body' });
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      const chunk = decoder.decode(value);
      res.write(chunk);
    }

    res.end();
  } catch (error) {
    console.error('Progress stream error:', error);
    res.status(500).json({ error: 'Stream error' });
  }
}
```

## Usage Flow

1. **Start Export Job**
   - Client sends POST request to `/render` with `exportId` in the request
   - Server begins processing and starts emitting progress updates

2. **Connect to Progress Stream**
   - Client opens SSE connection to `/progress/:exportId`
   - Can connect before or after the job starts (will receive current state if available)

3. **Receive Updates**
   - Client receives real-time progress updates as JSON objects
   - Updates UI accordingly (progress bar, stage messages, etc.)

4. **Handle Completion**
   - When `progress === 100` and `stage === "complete"`, the video is ready
   - When `progress === 100` and `stage === "error"`, the job failed

5. **Cleanup**
   - Client closes EventSource connection when done
   - Server automatically cleans up progress state after 10 minutes

## Error Handling

- **Connection Errors**: Handle `onerror` event on EventSource
- **Parse Errors**: Wrap JSON.parse in try-catch
- **Missing exportId**: Server will still accept connection but won't send updates until job starts
- **Job Not Found**: Connection stays open but no updates will be sent (job may not have started yet)

## Notes

- The progress stream can be connected to before the job starts
- If a job is already in progress, the client will receive the current state immediately upon connection
- Heartbeat messages (`: heartbeat\n\n`) should be ignored by the client
- Progress values are approximate and may not be perfectly linear
- The connection will automatically close when the job completes or errors
- Server cleans up progress state after 10 minutes of inactivity

## Environment Variables

The worker server uses these environment variables:
- `EXPORT_WORKER_PORT`: Port for the worker server (default: 3001)
- `EXPORT_WORKER_HOST`: Host for the worker server (default: 0.0.0.0)

Make sure your client-side code points to the correct worker URL.

