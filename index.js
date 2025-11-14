import express from "express";
import cors from "cors";
import { exportRoute, uploadMiddleware } from "./routes/export.js";
import { progressRoute } from "./routes/progress.js";

const app = express();
const PORT = process.env.EXPORT_SERVER_PORT || 3001;

// Middleware
// CORS configuration - allow client URL from environment or default to localhost
const allowedOrigins = [
  process.env.CLIENT_URL || 'http://localhost:3000',
  'http://localhost:3000', // Always allow localhost for development
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Routes
app.post("/export", uploadMiddleware, exportRoute);
app.get("/export/progress", progressRoute);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "video-export-server" });
});

// Start server
app.listen(PORT, () => {
  console.log(`Video export server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

