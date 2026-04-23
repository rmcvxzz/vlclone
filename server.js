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

const configPath = path.join(__dirname, 'config.ini');
if (!fs.existsSync(configPath)) {
    console.error("❌ config.ini missing! Create one based on your settings.");
    process.exit(1);
}
const config = ini.parse(fs.readFileSync(configPath, 'utf-8'));

const app = express();
const PORT = config.server.port || 3000;
const VER = "1.6";


const MEDIA_DIR = path.join(__dirname, config.paths.media_dir || 'media');
const THUMBS_DIR = path.join(__dirname, config.paths.thumbs_dir || 'thumbnails');
const CONVERT_DIR = path.join(__dirname, config.paths.convert_dir || 'converted');

[MEDIA_DIR, THUMBS_DIR, CONVERT_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const jobs = new Map(); 

let fileCache = [];

const MIME_TYPES = {
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska', '.mov': 'video/quicktime',
    '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.png': 'image/png',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.dem': 'application/octet-stream', '.ts': 'video/mp2t',
    '.m3u8': 'application/vnd.apple.mpegurl'
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.static('public'));
app.use('/thumbs', express.static(THUMBS_DIR));
app.use('/converted', express.static(CONVERT_DIR, {
    setHeaders: (res, filePath) => {
        const ext = path.extname(filePath).toLowerCase();
        // This fixes the "Missing HLS MIME types" error
        if (MIME_TYPES[ext]) {
            res.setHeader('Content-Type', MIME_TYPES[ext]);
        }
    }
}));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, MEDIA_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        const name = path.basename(file.originalname, ext).replace(/[^a-z0-9]/gi, '_'); // Sanitize filename
        cb(null, `${name}-${uniqueSuffix}${ext}`);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 500 * 1024 * 1024 }, // 500MB Limit
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (MIME_TYPES[ext]) {
            cb(null, true);
        } else {
            cb(new Error('Unsupported file type')); // Blocks junk
        }
    }
});

const queue = [];
let processingCount = 0;
const MAX_CONCURRENT = 2; 

async function addToQueue(file, type) {
    queue.push({ file, type });
    processNext();
}

async function processNext() {
    if (processingCount >= MAX_CONCURRENT || queue.length === 0) return;

    processingCount++;
    const { file, type } = queue.shift();

    try {
        if (type === 'demo') {
            await parseDemo(file);
        } else {
            await processVideo(file);
        }
    } finally {
        processingCount--;
        processNext(); 
    }
}

app.post('/api/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({ message: 'Upload successful', file: req.file.filename });
});

function parseDemo(file) {
    const fileNameNoExt = path.parse(file).name;
    const jsonPath = path.join(CONVERT_DIR, `${fileNameNoExt}.json`);

    if (fs.existsSync(jsonPath) || jobs.has(file)) return;

    console.log(`[Parser] Starting Deep Parse: ${file}`);
    jobs.set(file, { status: 'Parsing Deep Data', progress: 0, startedAt: Date.now() });
    
    execFile('./bin/parse_demo', [path.join(MEDIA_DIR, file)], { maxBuffer: 1024 * 1024 * 50 }, (err, stdout) => {
        if (err) {
            console.error(`[Parser] Error: ${err.message}`);
            jobs.delete(file);
            return;
        }

        try {
            const data = JSON.parse(stdout);
            
            const metaData = {
                map: data.header?.map || "Unknown",
                duration: data.header?.duration ? Math.round(data.header.duration) : 0,
                players: data.users ? Object.keys(data.users).length : 0,
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
    
    jobs.set(file, { status: 'Transcoding', progress: 0, startedAt: Date.now() });

    const outputDir = path.join(CONVERT_DIR, fileNameNoExt);

    ffmpeg(path.join(MEDIA_DIR, file))
        .addOptions([
            '-c:v libx264',             
            '-c:a aac',                
            '-pix_fmt yuv420p',        
            '-profile:v baseline', 
            '-level 3.0',
            `-s ${config.hls.resolution || '854x480'}`, 
            '-start_number 0',
            `-hls_time ${config.hls.segment_time || 5}`, 
            '-hls_list_size 0',
            '-hls_flags independent_segments',
            '-f hls'
        ])
        .on('progress', p => {
            const currentJob = jobs.get(file);
            if (currentJob && p.percent) {
                currentJob.progress = Math.round(p.percent);
            }
        })
        .on('end', () => {
            console.log(`[HLS] Finished: ${fileNameNoExt}`);
            
            console.log(`[Thumb] Generating for: ${file}`);
            ffmpeg(path.join(MEDIA_DIR, file)).screenshots({
                timestamps: ['2%'],
                filename: `${file}.jpg`,
                folder: THUMBS_DIR,
                size: '320x180'
            });

            jobs.delete(file);
        })
        .on('error', (err) => {
            console.error(`[HLS] Error: ${err.message}`);
            if (fs.existsSync(outputDir)) {
                fs.rmSync(outputDir, { recursive: true, force: true });
                console.log(`[HLS] Cleaned up failed directory: ${outputDir}`);
            }
            jobs.delete(file);
        })
        .save(playlistPath);
}

async function updateFileCache() {
    try {
        const files = fs.readdirSync(MEDIA_DIR);
        fileCache = await Promise.all(files.map(async (file) => {
            const ext = path.extname(file).toLowerCase();
            const nameNoExt = path.parse(file).name;
            const isVideo = ['.mp4', '.mkv', '.mov', '.webm'].includes(ext);
            const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
            
            const jsonPath = path.join(CONVERT_DIR, `${nameNoExt}.json`);
            let meta = null;
            if (fs.existsSync(jsonPath)) {
                meta = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            }

            const hlsPath = path.join(CONVERT_DIR, nameNoExt, 'playlist.m3u8');
            const hasHLS = fs.existsSync(hlsPath);

            return {
                name: file,
                type: isVideo ? 'video' : (ext === '.dem' ? 'demo' : (isImage ? 'image' : 'audio')),
                stream: hasHLS ? `/converted/${nameNoExt}/playlist.m3u8` : `/stream/${file}`,
                thumbnail: isVideo ? `/thumbs/${file}.jpg` : (isImage ? `/stream/${file}` : null),
                isHLS: hasHLS,
                meta: meta
            };
        }));
        console.log(`[Cache] Updated: ${fileCache.length} files`);
    } catch (e) {
        console.error("[Cache] Update failed:", e);
    }
}

const watcher = chokidar.watch(MEDIA_DIR, {
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 100 }
});
watcher.on('add', async filePath => {
    const file = path.basename(filePath);
    const ext = path.extname(file).toLowerCase();
    if (ext === '.dem') parseDemo(file);
    if (['.mp4', '.mkv', '.mov', '.webm'].includes(ext)) processVideo(file);
    
    // Update cache when a new file is added
    await updateFileCache(); 
});

watcher.on('unlink', async filePath => {
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
    
    await updateFileCache();
});

app.get('/api/files', (req, res) => {
    fs.readdir(MEDIA_DIR, async (err, files) => {
        if (err) return res.status(500).json({ error: 'Read error' });

        try {
            const data = await Promise.all(files.map(async (file) => {
                const ext = path.extname(file).toLowerCase();
                const nameNoExt = path.parse(file).name;
                const isVideo = ['.mp4', '.mkv', '.mov', '.webm'].includes(ext);
                const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext);
                const isDemo = ext === '.dem';

                const hlsPath = path.join(CONVERT_DIR, nameNoExt, 'playlist.m3u8');
                const hasHLS = fs.existsSync(hlsPath);

                const jsonPath = path.join(CONVERT_DIR, `${nameNoExt}.json`);
                let meta = null;

                try {
                    if (fs.existsSync(jsonPath)) {
                        const rawData = await fs.promises.readFile(jsonPath, 'utf8');
                        meta = JSON.parse(rawData);
                    }
                } catch (readErr) {
                    console.error(`Error reading meta for ${file}:`, readErr);
                }

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
            }));

            res.json(data);
        } catch (error) {
            res.status(500).json({ error: 'Processing error' });
        }
        res.json(fileCache);
    });
});

app.get('/stream/:filename', (req, res) => {
    // FIX: path.basename() is critical to prevent path traversal attacks
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(MEDIA_DIR, safeFilename);
    
    // Check if file exists before trying to read it
    if (!fs.existsSync(filePath)) return res.status(404).send('Not found');

    const ext = path.extname(filePath).toLowerCase();
    // Ensure the response uses the corrected MIME_TYPES list
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        // FIX: Comprehensive NaN and range logic checks to prevent crashes
        if (isNaN(start) || isNaN(end) || start >= fileSize || end >= fileSize || start > end) {
            res.writeHead(416, {
                "Content-Range": `bytes */${fileSize}`
            });
            return res.end();
        }

        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
        });

        file.pipe(res);
        file.on('error', (err) => {
            console.error(`[Stream] Error for ${safeFilename}:`, err.message);
            if (!res.headersSent) res.status(500).end();
            else res.end();
        });
    } else {
        // Standard non-range request
        res.writeHead(200, { 
            'Content-Length': fileSize, 
            'Content-Type': contentType 
        });
        fs.createReadStream(filePath).pipe(res);
    }
});

setInterval(() => {
    const now = Date.now();
    for (const [file, job] of jobs.entries()) {
        if (job.startedAt && (now - job.startedAt > 30 * 60 * 1000)) {
            console.log(`[Cleaner] Removing stale job for: ${file}`);
            jobs.delete(file);
        }
    }
}, 5 * 60 * 1000); 

app.listen(PORT, () => {
    console.log(`\x1b[32m%s\x1b[0m`, `--- vlclone ${VER} ---`);
    console.log(`serving media at: http://localhost:${PORT}`);
    console.log(`media:     ${MEDIA_DIR}`);
    console.log(`thumbs:    ${THUMBS_DIR}`);
    console.log(`converted: ${CONVERT_DIR}`);
});