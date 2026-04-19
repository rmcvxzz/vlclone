const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const ffmpeg = require('fluent-ffmpeg');

const app = express();
const PORT = 3000;
const VER = "1.4";
const MEDIA_DIR = path.join(__dirname, 'media');
const THUMBS_DIR = path.join(__dirname, 'thumbnails');
const CONVERT_DIR = path.join(__dirname, 'converted');

// Concurrency Guard: Prevents multiple CPU-heavy tasks for the same file
const processing = new Set();

// Ensure filesystem is ready
[MEDIA_DIR, THUMBS_DIR, CONVERT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());

// Semantic Rate Limiting (429)
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 150,
    message: "429: Too many requests, slow down"
});
app.use('/api/', limiter);

app.use(express.static('public'));
app.use('/thumbs', express.static(THUMBS_DIR));

/**
 * CORE PIPELINE: Thumbnails & Transcoding
 */
function processVideo(file) {
    const ext = path.extname(file).toLowerCase();
    const fileNameNoExt = path.parse(file).name;
    const thumbName = `${file}.jpg`;
    const thumbPath = path.join(THUMBS_DIR, thumbName);
    const outputMp4 = path.join(CONVERT_DIR, `${fileNameNoExt}.mp4`);

    // 1. Thumbnail Generation
    if (!fs.existsSync(thumbPath)) {
        ffmpeg(path.join(MEDIA_DIR, file))
            .screenshots({
                timestamps: ['00:00:01'],
                filename: thumbName,
                folder: THUMBS_DIR,
                size: '320x180'
            })
            .on('error', (err) => console.log(`[FFmpeg] Thumb Error: ${err.message}`));
    }

    // 2. Transcoder with Concurrency Guard
    if ((ext === '.mov' || ext === '.mkv') && !fs.existsSync(outputMp4) && !processing.has(file)) {
        console.log(`[Transcoder] Starting: ${file}`);
        processing.add(file);

        ffmpeg(path.join(MEDIA_DIR, file))
            .videoCodec('libx264')
            .audioCodec('aac')
            .outputOptions('-movflags +faststart')
            .on('end', () => {
                console.log(`[Transcoder] Finished: ${fileNameNoExt}.mp4`);
                processing.delete(file);
            })
            .on('error', (err) => {
                console.log(`[Transcoder] Failed: ${err.message}`);
                processing.delete(file);
            })
            .save(outputMp4);
    }
}

/**
 * API: Structured JSON Response
 */
app.get('/api/files', (req, res) => {
    fs.readdir(MEDIA_DIR, (err, files) => {
        // 500: Directory read error
        if (err) return res.status(500).send('500: Failed to read media directory');
        
        const mediaFiles = files.filter(file => 
            ['.mp4', '.mkv', '.mp3', '.mov', '.png', '.jpg', '.jpeg', '.gif', '.webp']
            .includes(path.extname(file).toLowerCase())
        );

        const structuredData = mediaFiles.map(file => {
            const ext = path.extname(file).toLowerCase();
            const fileNameNoExt = path.parse(file).name;
            const isVideo = ['.mp4', '.mkv', '.mov'].includes(ext);
            const optimizedPath = path.join(CONVERT_DIR, `${fileNameNoExt}.mp4`);
            
            if (isVideo) processVideo(file);

            return {
                name: fileNameNoExt,
                stream: `/stream/${file}`,
                thumbnail: isVideo ? `/thumbs/${file}.jpg` : null,
                ready: (ext === '.mp4' || fs.existsSync(optimizedPath))
            };
        });

        res.json(structuredData);
    });
});

/**
 * STREAMING ENGINE: Safety Checks & Semantic Errors
 */
app.get('/stream/:filename', (req, res) => {
    const originalName = path.basename(req.params.filename);
    const fileNameNoExt = path.parse(originalName).name;
    const ext = path.extname(originalName).toLowerCase();
    
    const optimizedPath = path.join(CONVERT_DIR, `${fileNameNoExt}.mp4`);
    const sourcePath = path.join(MEDIA_DIR, originalName);

    // 202: Processing Check
    if ((ext === '.mov' || ext === '.mkv') && !fs.existsSync(optimizedPath)) {
        return res.status(202).send('202: Video is still processing');
    }
    
    // Choose optimized file if available
    const filePath = (fs.existsSync(optimizedPath) && ext !== '.mp4') ? optimizedPath : sourcePath;

    // 404: File Missing
    if (!fs.existsSync(filePath)) return res.status(404).send('404: File not found');

    const mimeTypes = {
        '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.png': 'image/png', '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'
    };

    // Safety Net: Use path.extname on the ACTUAL file being served
    const servedExt = path.extname(filePath).toLowerCase();
    if (!mimeTypes[servedExt]) return res.status(415).send('415: Unsupported media type');

    try {
        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const range = req.headers.range;

        if (range) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

            // 416: Bad Range
            if (start >= fileSize || end >= fileSize) {
                return res.status(416).send('416: Requested range not satisfiable');
            }
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': (end - start) + 1,
                'Content-Type': mimeTypes[servedExt],
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, { 
                'Accept-Ranges': 'bytes',
                'Content-Length': fileSize, 
                'Content-Type': mimeTypes[servedExt] 
            });
            fs.createReadStream(filePath).pipe(res);
        }
    } catch (e) {
        // 500: Internal server error
        if (!res.headersSent) res.status(500).send('500: Internal server error');
    }
});

// Final colorful console readout
app.listen(PORT, () => {
    console.log(`\x1b[32m%s\x1b[0m`, `--- vlclone v${VER} ---`);
    console.log(`serving media at: http://localhost:${PORT}`);
    console.log(`media path: ${MEDIA_DIR};`);
    console.log(`thumbnails path: ${THUMBS_DIR}`);
    console.log(`converted path: ${CONVERT_DIR}`);
    
});
