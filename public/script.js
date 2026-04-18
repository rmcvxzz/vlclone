const videoPlayer = document.getElementById('videoPlayer');
const imageViewer = document.getElementById('imageViewer');
const library = document.getElementById('library');
const nowPlaying = document.getElementById('nowPlaying');
const searchInput = document.getElementById('searchInput');
const activityLog = document.getElementById('activityLog');

let allFiles = []; 

// 1. UTILITY: Timestamp for logs
function getTimestamp() {
    const now = new Date();
    return `[${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;
}

function addLog(message, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${getTimestamp()}</span> ${message}`;
    activityLog.prepend(entry);
}

// 2. FETCH & SYNC
async function fetchFiles() {
    try {
        const res = await fetch('/api/files');
        const newFiles = await res.json();
        
        const added = newFiles.filter(x => !allFiles.includes(x));
        const deleted = allFiles.filter(x => !newFiles.includes(x));

        if (allFiles.length > 0) {
            added.forEach(f => addLog(`New file found: ${f}`, 'log-new'));
            deleted.forEach(f => addLog(`A file was deleted: ${f}`, 'log-deleted'));
        }

        if (added.length > 0 || deleted.length > 0 || allFiles.length === 0) {
            allFiles = newFiles;
            if (searchInput.value.trim() === "") {
                renderLibrary(allFiles);
            }
        }
    } catch (err) {
        console.error("Sync error:", err);
    }
}

// 3. RENDER (The Visual Update)
function renderLibrary(files) {
    library.innerHTML = "";
    if (files.length === 0) {
        library.innerHTML = "<p>No media found.</p>";
        return;
    }

    files.forEach(file => {
        const ext = file.split('.').pop().toLowerCase();
        const isVideo = ['mp4', 'mkv', 'mov'].includes(ext);
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
        
        const card = document.createElement('div');
        card.className = 'file-card';
        
        // Thumbnail logic: Use /thumbs/ for videos, /stream/ for images
        let previewHtml = '';
        if (isVideo) {
            previewHtml = `<img src="/thumbs/${file}.jpg" onerror="this.src='https://placehold.co/320x180/1e1e1e/00d1ff?text=Processing...'" alt="thumb">`;
        } else if (isImage) {
            previewHtml = `<img src="/stream/${file}" alt="thumb">`;
        } else {
            previewHtml = `<div class="no-thumb">🎵</div>`; // Music icon for mp3
        }

        card.innerHTML = `
            ${previewHtml}
            <div class="file-info">
                <span class="file-name">${file}</span>
            </div>
        `;
        
        card.onclick = () => playMedia(file);
        library.appendChild(card);
    });
}

// 4. SEARCH & PLAY
function filterFiles() {
    const query = searchInput.value.toLowerCase();
    const filtered = allFiles.filter(file => file.toLowerCase().includes(query));
    renderLibrary(filtered);
}

function playMedia(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
    const streamUrl = `/stream/${encodeURIComponent(filename)}`;

    videoPlayer.classList.remove('active-media');
    videoPlayer.pause();
    imageViewer.classList.remove('active-media');

    if (isImage) {
        imageViewer.src = streamUrl;
        imageViewer.classList.add('active-media');
    } else {
        videoPlayer.src = streamUrl;
        videoPlayer.classList.add('active-media');
        videoPlayer.play();
    }
    
    nowPlaying.innerText = filename;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

fetchFiles();
setInterval(fetchFiles, 8000);