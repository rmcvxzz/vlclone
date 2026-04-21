const express = require('express');
const fs = require('fs');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const multer = require('multer');
const chokidar = require('chokidar');
const ffmpeg = require('fluent-ffmpeg');
const ini = require('ini');
const { execFile } = require('child_process');

// --- CONFIGURATION LOADING ---
const configPath = path.join(__dirname, 'config.ini');
if (!fs.existsSync(configPath)) {
    console.error("❌ config.ini missing! Create one based on your settings.");
    process.exit(1);
}
const config = ini.parse(fs.readFileSync(configPath, 'utf-8'));

const app = express();
const PORT = config.server.port || 3000;
const VER = "1.5";

// Directories from Config
const MEDIA_DIR = path.join(__dirname, config.paths.media_dir || 'media');
const THUMBS_DIR = path.join(__dirname, config.paths.thumbs_dir || 'thumbnails');
const CONVERT_DIR = path.join(__dirname, config.paths.convert_dir || 'converted');

// Ensure directories exist
[MEDIA_DIR, THUMBS_DIR, CONVERT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// State Tracking
const jobs = new Map(); 

const MIME_TYPES = {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
    '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.dem': 'application/octet-stream'
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.static('public'));
app.use('/thumbs', express.static(THUMBS_DIR));
app.use('/converted', express.static(CONVERT_DIR));

// UPLOAD ENGINE
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, MEDIA_DIR),
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ message: 'Upload successful', file: req.file.filename });
});

/**
 * PIPELINES
 */

function parseDemo(file) {
    const fileNameNoExt = path.parse(file).name;
    const jsonPath = path.join(CONVERT_DIR, `${fileNameNoExt}.json`);

    if (fs.existsSync(jsonPath) || jobs.has(file)) return;

    console.log(`[Parser] Starting Deep Parse: ${file}`);
    jobs.set(file, { status: 'Parsing Deep Data', progress: 0 });
    
    // Using 50MB buffer because your JSON output is huge!
    execFile('./bin/parse_demo', [path.join(MEDIA_DIR, file)], { maxBuffer: 1024 * 1024 * 50 }, (err, stdout) => {
        if (err) {
            console.error(`[Parser] Error: ${err.message}`);
            jobs.delete(file);
            return;
        }

        try {
            const data = JSON.parse(stdout);
            
            // Map the data from the JSON you provided
            const metaData = {
                map: data.header?.map || "Unknown",
                duration: data.header?.duration ? Math.round(data.header.duration) : 0,
                players: data.users ? Object.keys(data.users).length : 0,
                // Only keep chat that actually has a sender or important text
                chat: (data.chat || [])
                    .filter(msg => msg.from || msg.text.includes('[STV Stats]'))
                    .map(msg => ({
                        from: msg.from || "SERVER",
                        text: msg.text,
                        tick: msg.tick
                    })),
                deaths: data.deaths || []
            };

            fs.writeFileSync(jsonPath, JSON.stringify(metaData));
            console.log(`[Parser] SUCCESS: Metadata saved for ${file}`);
        } catch (e) { 
            console.error("[Parser] JSON Parse Failed. Check if stdout was truncated."); 
        }
        jobs.delete(file);
    });
}

async function processVideo(file) {
    const fileNameNoExt = path.parse(file).name;
    const hlsFolder = path.join(CONVERT_DIR, fileNameNoExt);
    const playlistPath = path.join(hlsFolder, 'playlist.m3u8');

    if (fs.existsSync(playlistPath) || jobs.has(file)) return;
    if (!fs.existsSync(hlsFolder)) fs.mkdirSync(hlsFolder);
    
    jobs.set(file, { status: 'Transcoding', progress: 0 });

    ffmpeg(path.join(MEDIA_DIR, file))
        .addOptions([
            '-profile:v baseline', '-level 3.0',
            `-s ${config.hls.resolution || '854x480'}`, 
            '-start_number 0',
            `-hls_time ${config.hls.segment_time || 0.4}`,
            '-hls_list_size 0',
            '-f hls'
        ])
        .on('progress', p => {
            if (p.percent) jobs.get(file).progress = Math.round(p.percent);
        })
        .on('end', () => {
            console.log(`[HLS] Finished: ${fileNameNoExt}`);
            jobs.delete(file);
        })
        .on('error', (err) => {
            console.error(`[HLS] Error: ${err.message}`);
            jobs.delete(file);
        })
        .save(playlistPath);

    ffmpeg(path.join(MEDIA_DIR, file)).screenshots({
        timestamps: ['2%'],
        filename: `${file}.jpg`,
        folder: THUMBS_DIR,
        size: '320x180'
    });
}

// WATCHDOG
const watcher = chokidar.watch(MEDIA_DIR, {
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
});

watcher.on('add', filePath => {
    const file = path.basename(filePath);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.dem') parseDemo(file);
    if (['.mp4', '.mkv', '.mov', '.webm'].includes(ext)) processVideo(file);
});

watcher.on('unlink', filePath => {
    const file = path.basename(filePath);
    const nameNoExt = path.parse(file).name;
    const ext = path.extname(file).toLowerCase();

    const jsonPath = path.join(CONVERT_DIR, `${nameNoExt}.json`);
    if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath);

    const thumbPath = path.join(THUMBS_DIR, `${file}.jpg`);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    const hlsFolder = path.join(CONVERT_DIR, nameNoExt);
    if (fs.existsSync(hlsFolder)) fs.rmSync(hlsFolder, { recursive: true, force: true });

    console.log(`\x1b[31m%s\x1b[0m`, `[Watcher] Cleaned up: ${file}`);
});

/**
 * API ROUTES
 */
app.get('/api/files', (req, res) => {
    fs.readdir(MEDIA_DIR, (err, files) => {
        if (err) return res.status(500).json({ error: 'Read error' });

        const data = files.map(file => {
            const ext = path.extname(file).toLowerCase();
            const nameNoExt = path.parse(file).name;
            const isVideo = ['.mp4', '.mkv', '.mov', '.webm'].includes(ext);
            const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
            const isDemo = ext === '.dem';

            const hlsPath = path.join(CONVERT_DIR, nameNoExt, 'playlist.m3u8');
            const hasHLS = fs.existsSync(hlsPath);

            const jsonPath = path.join(CONVERT_DIR, `${nameNoExt}.json`);
            const meta = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath)) : null;

            // Thumbnail logic: images use themselves, videos use screenshots
            let thumb = null;
            if (isVideo) {
                thumb = `/thumbs/${file}.jpg`;
            } else if (isImage) {
                thumb = `/stream/${file}`;
            }

            return {
                name: file,
                type: isVideo ? 'video' : isDemo ? 'demo' : (isImage ? 'image' : 'audio'),
                stream: hasHLS ? `/converted/${nameNoExt}/playlist.m3u8` : `/stream/${file}`,
                thumbnail: thumb,
                isHLS: hasHLS,
                meta: meta,
                job: jobs.get(file) || null
            };
        });
        res.json(data);
    });
});

app.get('/stream/:filename', (req, res) => {
    const filePath = path.join(MEDIA_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const stat = fs.statSync(filePath);
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': (end - start) + 1,
            'Content-Type': contentType,
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
        res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': contentType });
        fs.createReadStream(filePath).pipe(res);
    }
});

app.listen(PORT, () => {
    console.log(`\x1b[32m%s\x1b[0m`, `--- vlclone ${VER} ---`);
    console.log(`serving media at: http://localhost:${PORT}`);
    console.log(`media:     ${MEDIA_DIR}`);
    console.log(`thumbs:    ${THUMBS_DIR}`);
    console.log(`converted: ${CONVERT_DIR}`);
});
