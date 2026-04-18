const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = 3000;
const VER = 1.3;
const MEDIA_DIR = path.join(__dirname, 'media');
const THUMBS_DIR = path.join(__dirname, 'thumbnails');

// 1. DIRECTORY CHECK: Ensure system is ready
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR);
if (!fs.existsSync(THUMBS_DIR)) fs.mkdirSync(THUMBS_DIR);

// 2. MIDDLEWARE: Security & Performance
app.use(helmet({ contentSecurityPolicy: false })); // Allow streams
app.use(compression()); // Gzip for faster API responses

// Rate limiter for API routes
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 150, // Slightly higher for thumbnail-heavy galleries
    message: "403: Unexpected error, please refresh or restart server"
});
app.use('/api/', limiter);

// Serve static assets
app.use(express.static('public'));
app.use('/thumbs', express.static(THUMBS_DIR));

/**
 * THUMBNAIL ENGINE
 * Takes a frame at 1s to create a 16:9 preview
 */
function generateThumbnail(videoFile) {
    const thumbName = `${videoFile}.jpg`;
    const thumbPath = path.join(THUMBS_DIR, thumbName);

    // Don't re-process if thumbnail exists
    if (fs.existsSync(thumbPath)) return;

    ffmpeg(path.join(MEDIA_DIR, videoFile))
        .screenshots({
            timestamps: ['00:00:01'],
            filename: thumbName,
            folder: THUMBS_DIR,
            size: '320x180'
        })
        .on('error', (err) => {
            // Silently log skips (e.g., corrupted files)
            console.log(`[FFmpeg] Skipped ${videoFile}: ${err.message}`);
        });
}

/**
 * API: FILE DISCOVERY
 */
app.get('/api/files', (req, res) => {
    fs.readdir(MEDIA_DIR, (err, files) => {
        if (err) return res.status(403).send('403: Unexpected error');
        
        const mediaFiles = files.filter(file => 
            ['.mp4', '.mkv', '.mp3', '.mov', '.png', '.jpg', '.jpeg', '.gif', '.webp']
            .includes(path.extname(file).toLowerCase())
        );

        // Process thumbnails in the background
        mediaFiles.forEach(file => {
            const ext = path.extname(file).toLowerCase();
            if (['.mp4', '.mkv', '.mov'].includes(ext)) {
                generateThumbnail(file);
            }
        });

        res.json(mediaFiles);
    });
});

/**
 * STREAMING ENGINE (Mobile Optimized)
 */
app.get('/stream/:filename', (req, res) => {
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(MEDIA_DIR, safeName);

    if (!fs.existsSync(filePath)) {
        return res.status(404).send('404: File didn\'t upload successfully, restart server');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'
    };

    if (!mimeTypes[ext]) return res.status(500).send('500: File type is not supported');

    const contentType = mimeTypes[ext];

    // Speed up images with local caching
    if (contentType.startsWith('image/')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(filePath);
    }

    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        // Support for seeking (jumping ahead) - Essential for Android/Chrome
        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            
            const file = fs.createReadStream(filePath, { start, end });
            
            file.on('error', err => {
                if (!res.headersSent) res.status(403).send('403: Stream error');
            });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': contentType,
            });
            file.pipe(res);
        } else {
            const file = fs.createReadStream(filePath);
            res.writeHead(200, { 
                'Accept-Ranges': 'bytes', // Hint to browser it can seek
                'Content-Length': fileSize, 
                'Content-Type': contentType 
            });
            file.pipe(res);
        }
    } catch (e) {
        res.status(403).send('403: Unexpected error, please refresh or restart server');
    }
});

app.listen(PORT, () => {
    console.log(`\x1b[32m%s\x1b[0m`, `--- vlclone v${VER} ---`); 
    console.log(`serving media at: http://localhost:${PORT}`);
});