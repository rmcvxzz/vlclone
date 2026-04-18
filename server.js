const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = 3000;
const VER = 1.1;
const MEDIA_DIR = path.join(__dirname, 'media');

// 1. SECURITY & SPEED MIDDLEWARE
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// 2. RATE LIMITING (Prevents spamming the API)
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 100,
    message: "403: Unexpected error, please refresh or restart server"
});
app.use('/api/', limiter);

// Ensure media folder exists
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR);
}

app.use(express.static('public'));

/**
 * API: Get list of media
 */
app.get('/api/files', (req, res) => {
    fs.readdir(MEDIA_DIR, (err, files) => {
        if (err) return res.status(403).send('403: Unexpected error, please refresh or restart server');
        
        const mediaFiles = files.filter(file => 
            ['.mp4', '.mkv', '.mp3', '.mov', '.png', '.jpg', '.jpeg', '.gif', '.webp']
            .includes(path.extname(file).toLowerCase())
        );
        res.json(mediaFiles);
    });
});

/**
 * STREAMING & SERVING ROUTE
 */
app.get('/stream/:filename', (req, res) => {
    // SECURITY: Prevent Directory Traversal
    const safeName = path.basename(req.params.filename);
    const filePath = path.join(MEDIA_DIR, safeName);

    // CUSTOM ERROR 404: File missing/upload failed
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('404: File didn\'t upload successfully, restart server');
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
        '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'
    };

    // CUSTOM ERROR 500: Unsupported file type
    if (!mimeTypes[ext]) {
        return res.status(500).send('500: File type is not supported');
    }

    const contentType = mimeTypes[ext];

    // SPEED: Cache static images for 1 day
    if (contentType.startsWith('image/')) {
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.sendFile(filePath);
    }

    // STREAMING LOGIC
    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            
            const file = fs.createReadStream(filePath, { start, end });
            
            file.on('error', err => {
                console.error("Stream Error:", err);
                if (!res.headersSent) res.status(403).send('403: Unexpected error, please refresh or restart server');
            });

            const head = {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
            };

            res.writeHead(206, head);
            file.pipe(res);
        } else {
            const file = fs.createReadStream(filePath);
            
            file.on('error', err => {
                console.error("Stream Error:", err);
                if (!res.headersSent) res.status(403).send('403: Unexpected error, please refresh or restart server');
            });

            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType,
            });
            file.pipe(res);
        }
    } catch (e) {
        // CATCH-ALL ERROR 403
        res.status(403).send('403: Unexpected error, please refresh or restart server');
    }
});

app.listen(PORT, () => {
    console.log(`\x1b[32m%s\x1b[0m`, `--- vlclone ${VER} ---`); 
    console.log(`running on: http://localhost:${PORT}`);
});