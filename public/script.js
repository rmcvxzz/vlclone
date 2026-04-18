const videoPlayer = document.getElementById('videoPlayer');
const imageViewer = document.getElementById('imageViewer');
const library = document.getElementById('library');
const nowPlaying = document.getElementById('nowPlaying');
const searchInput = document.getElementById('searchInput');
const activityLog = document.getElementById('activityLog');

let allFiles = []; // Master list from server

/**
 * 1. DATE & LOGGING LOGIC
 */
function getTimestamp() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const mins = String(now.getMinutes()).padStart(2, '0');
    return `[${month}-${day} ${hours}:${mins}]`;
}

function addLog(message, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${getTimestamp()}</span> ${message}`;
    
    // Add to the top of the list
    activityLog.prepend(entry);
}

/**
 * 2. DATA FETCHING & COMPARISON
 */
async function fetchFiles() {
    try {
        const res = await fetch('/api/files');
        const newFiles = await res.json();
        
        // Find differences for the log
        const added = newFiles.filter(x => !allFiles.includes(x));
        const deleted = allFiles.filter(x => !newFiles.includes(x));

        // If this isn't the first load and things changed, log them
        if (allFiles.length > 0) {
            added.forEach(f => addLog(`New file found: ${f}`, 'log-new'));
            deleted.forEach(f => addLog(`A file was deleted: ${f}`, 'log-deleted'));
        }

        // Update the master list if there's any change
        if (added.length > 0 || deleted.length > 0 || allFiles.length === 0) {
            allFiles = newFiles;
            
            // Only re-render the UI if the user isn't currently searching
            if (searchInput.value.trim() === "") {
                renderLibrary(allFiles);
            }
        }
    } catch (err) {
        console.error("Auto-refresh failed:", err);
    }
}

/**
 * 3. UI RENDERING
 */
function renderLibrary(files) {
    library.innerHTML = "";
    if (files.length === 0) {
        library.innerHTML = "<p>No files found in /media folder.</p>";
        return;
    }

    files.forEach(file => {
        const card = document.createElement('div');
        card.className = 'file-card';
        card.innerText = file;
        card.onclick = () => playMedia(file);
        library.appendChild(card);
    });
}

/**
 * 4. SEARCH LOGIC
 */
function filterFiles() {
    const query = searchInput.value.toLowerCase();
    const filtered = allFiles.filter(file => file.toLowerCase().includes(query));
    renderLibrary(filtered);
}

/**
 * 5. MEDIA PLAYER LOGIC
 */
function playMedia(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);
    const streamUrl = `/stream/${encodeURIComponent(filename)}`;

    // Reset views
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
    
    // Smooth scroll back to player
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * 6. INITIALIZE
 */
fetchFiles(); // Run immediately on load

// Set the 8-second interval
setInterval(fetchFiles, 8000);