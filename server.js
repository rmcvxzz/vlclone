const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();
const PORT = 3000;

const MEDIA_DIR = path.join(__dirname, 'media');

// Create media folder if it doesn't exist
if (!fs.existsSync(MEDIA_DIR)) {
    fs.mkdirSync(MEDIA_DIR);
}

app.use(express.static('public'));

// 1. Get list of all media and image files
app.get('/api/files', (req, res) => {
    fs.readdir(MEDIA_DIR, (err, files) => {
        if (err) return res.status(500).send('Unable to scan directory');
        
        const mediaFiles = files.filter(file => 
            ['.mp4', '.mkv', '.mp3', '.mov', '.png', '.jpg', '.jpeg', '.gif', '.webp']
            .includes(path.extname(file).toLowerCase())
        );
        res.json(mediaFiles);
    });
});

// 2. The Smart Streaming/Serving Route
app.get('/stream/:filename', (req, res) => {
    const filePath = path.join(MEDIA_DIR, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');

    const ext = path.extname(filePath).toLowerCase();

    // Map extensions to their correct MIME types
    const mimeTypes = {
        '.mp4': 'video/mp4',
        '.mkv': 'video/x-matroska',
        '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.gif': 'image/gif',
        '.webp': 'image/webp'
    };

    // Use the map or fallback to a generic binary stream
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    // Handle Images
    if (contentType.startsWith('image/')) {
        return res.sendFile(filePath);
    }

    // Video/Audio Streaming Logic (with Range support)
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
        };

        res.writeHead(206, head);
        file.pipe(res);
    } else {
        res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
        });
        fs.createReadStream(filePath).pipe(res);
    }
});

app.listen(PORT, () => {
    console.log(`vlclone is live at http://localhost:${PORT}`);
    console.log(`scan the media folder : ${MEDIA_DIR}`);
});
