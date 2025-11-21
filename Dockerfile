# Use Node.js LTS version
FROM node:18-slim

# Install FFmpeg and dependencies required for canvas
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libcairo2-dev \
    libpango1.0-dev \
    libjpeg-dev \
    libgif-dev \
    librsvg2-dev \
    build-essential \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# --- CHANGE 1: Install ALL dependencies (including dev dependencies like TypeScript) ---
# We changed 'npm ci --only=production' to 'npm install' so we have access to 'tsc'
RUN npm install

# Copy server files
COPY . .

# --- CHANGE 2: Build the TypeScript code ---
# This creates the JavaScript files (usually in a 'dist' or 'build' folder)
RUN npm run build

# Create temp directory for video processing
RUN mkdir -p /tmp

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# --- CHANGE 3: Start the COMPILED JavaScript file ---
# Node runs the JS file created by step 2.
# IMPORTANT: Check your tsconfig.json to see if output is "dist" or "build".
# I am assuming "dist" here:
CMD ["npm", "start"]