const videoPlayer = document.getElementById('videoPlayer');
const imageViewer = document.getElementById('imageViewer');
const library = document.getElementById('library');
const nowPlaying = document.getElementById('nowPlaying');
const searchInput = document.getElementById('searchInput');
const activityLog = document.getElementById('activityLog');

let allFiles = []; // Now holds objects, not strings

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

// 2. FETCH & SYNC (Upgraded to handle Objects)
async function fetchFiles() {
    try {
        const res = await fetch('/api/files');
        const newFiles = await res.json(); // Array of objects
        
        // Extract stream URLs to use as unique IDs for comparison
        const oldPaths = allFiles.map(f => f.stream);
        const newPaths = newFiles.map(f => f.stream);

        // Find added and deleted files
        const added = newFiles.filter(x => !oldPaths.includes(x.stream));
        const deleted = allFiles.filter(x => !newPaths.includes(x.stream));

        if (allFiles.length > 0) {
            added.forEach(f => addLog(`New file found: ${f.name}`, 'log-new'));
            deleted.forEach(f => addLog(`A file was deleted: ${f.name}`, 'log-deleted'));
        }

        // UX WIN: Detect if a file finished converting in the background
        let readyChanged = false;
        newFiles.forEach(newF => {
            const oldF = allFiles.find(o => o.stream === newF.stream);
            if (oldF && oldF.ready !== newF.ready) {
                readyChanged = true;
                if (newF.ready) addLog(`Finished processing: ${newF.name}`, 'log-new');
            }
        });

        // Re-render if anything changed
        if (added.length > 0 || deleted.length > 0 || readyChanged || allFiles.length === 0) {
            allFiles = newFiles;
            if (searchInput.value.trim() === "") {
                renderLibrary(allFiles);
            }
        }
    } catch (err) {
        console.error("Sync error:", err);
    }
}

// 3. RENDER (Upgraded to read object properties)
function renderLibrary(files) {
    library.innerHTML = "";
    if (files.length === 0) {
        library.innerHTML = "<p>No media found.</p>";
        return;
    }

    files.forEach(file => {
        // Extract extension from the stream path
        const ext = file.stream.split('.').pop().toLowerCase();
        const isVideo = ['mp4', 'mkv', 'mov'].includes(ext);
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
        
        const card = document.createElement('div');
        card.className = 'file-card';
        // Add a visual cue if still processing
        if (!file.ready) card.style.opacity = '0.6';
        
        let previewHtml = '';
        if (isVideo) {
            // Use the backend-provided thumbnail path
            previewHtml = `<img src="${file.thumbnail}" onerror="this.src='https://placehold.co/320x180/1e1e1e/00d1ff?text=Generating...'" alt="thumb">`;
            
            // Show a "Processing" badge if it's not ready yet
            if (!file.ready) {
                previewHtml += `<div style="position: absolute; top: 5px; right: 5px; background: #ff4757; color: white; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: bold;">Processing</div>`;
            }
        } else if (isImage) {
            previewHtml = `<img src="${file.stream}" alt="thumb">`;
        } else {
            previewHtml = `<div class="no-thumb">🎵</div>`; // Music icon
        }

        card.innerHTML = `
            <div style="position: relative;">${previewHtml}</div>
            <div class="file-info">
                <span class="file-name">${file.name}</span>
            </div>
        `;
        
        // Pass the entire object to playMedia
        card.onclick = () => playMedia(file);
        library.appendChild(card);
    });
}

// 4. SEARCH & PLAY
function filterFiles() {
    const query = searchInput.value.toLowerCase();
    // Search based on file.name instead of the raw string
    const filtered = allFiles.filter(file => file.name.toLowerCase().includes(query));
    renderLibrary(filtered);
}

function playMedia(file) {
    const ext = file.stream.split('?')[0].split('.').pop().toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);

    // Stop browser from breaking if video isn't ready
    if (!file.ready && !isImage) {
        alert(`"${file.name}" is currently being optimized for playback. Please wait a moment!`);
        return;
    }

    videoPlayer.classList.remove('active-media');
    videoPlayer.pause();
    imageViewer.classList.remove('active-media');

    if (isImage) {
        imageViewer.src = file.stream;
        imageViewer.classList.add('active-media');
    } else {
        videoPlayer.src = file.stream;
        videoPlayer.classList.add('active-media');
        videoPlayer.play();
    }
    
    nowPlaying.innerText = file.name;
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Event Listeners
searchInput.addEventListener('input', filterFiles);

// Start
fetchFiles();
setInterval(fetchFiles, 8000);
