const videoPlayer = document.getElementById('videoPlayer');
const imageViewer = document.getElementById('imageViewer');
const library = document.getElementById('library');
const nowPlaying = document.getElementById('nowPlaying');
const searchInput = document.getElementById('searchInput');
const activityLog = document.getElementById('activityLog');
const jobsContainer = document.getElementById('jobs-container');
const demoStats = document.getElementById('demo-stats');

let allFiles = []; 
let hls = null;

function getTimestamp() {
    const now = new Date();
    return `[${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}]`;
}

function addLog(message, type) {
    const entry = document.createElement('div');
    entry.className = `log-entry ${type}`;
    entry.innerHTML = `<span class="log-time">${getTimestamp()}</span> ${message}`;
    activityLog.prepend(entry);
}

async function handleUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    addLog(`Uploading: ${file.name}...`, 'log-info');

    try {
        const res = await fetch('/api/upload', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.message) {
            addLog(`Upload Complete!`, 'log-success');
            fetchFiles();
        }
    } catch (err) {
        addLog(`Upload Failed: ${err.message}`, 'log-deleted');
    }
}

function renderJobs(files) {
    const activeJobs = files.filter(f => f.job);
    jobsContainer.innerHTML = "";
    if (activeJobs.length > 0) {
        activeJobs.forEach(file => {
            const jobCard = document.createElement('div');
            jobCard.className = 'job-card';
            jobCard.innerHTML = `
                <div class="job-info">
                    <span>⚙️ ${file.job.status}: <strong>${file.name}</strong></span>
                    <span>${file.job.progress}%</span>
                </div>
                <div class="progress-bar-bg">
                    <div class="progress-bar-fill" style="width: ${file.job.progress}%"></div>
                </div>
            `;
            jobsContainer.appendChild(jobCard);
        });
    }
}

async function fetchFiles() {
    try {
        const res = await fetch('/api/files');
        const newFiles = await res.json();
        
        const oldNames = allFiles.map(f => f.name);
        newFiles.forEach(f => {
            if (!oldNames.includes(f.name)) addLog(`New discovery: ${f.name}`, 'log-new');
        });

        allFiles = newFiles;
        renderJobs(allFiles);
        
        if (searchInput.value.trim() === "") {
            renderLibrary(allFiles);
        }
    } catch (err) {
        console.error("Sync error:", err);
    }
}

function renderLibrary(files) {
    library.innerHTML = "";
    if (files.length === 0) {
        library.innerHTML = "<p>Your media folder is empty.</p>";
        return;
    }

    files.forEach(file => {
        const card = document.createElement('div');
        card.className = `file-card ${file.job ? 'processing' : ''}`;
        
        let thumb = file.thumbnail || 'https://placehold.co/320x180/1e1e1e/00d1ff?text=🎵+Audio';

        card.innerHTML = `
            <div class="thumb-wrapper">
                <img src="${thumb}" alt="thumb">
                ${file.isHLS ? '<div class="hls-badge">HLS</div>' : ''}
                ${file.job ? `<div class="job-badge">${file.job.progress}%</div>` : ''}
            </div>
            <div class="file-info">
                <span class="file-name">${file.name}</span>
            </div>
        `;
        
        card.onclick = () => playMedia(file);
        library.appendChild(card);
    });
}

function playMedia(file) {
    if (file.job) return;

    imageViewer.style.display = 'none';
    videoPlayer.style.display = 'block';
    demoStats.innerHTML = ''; 
    
    if (hls) {
        hls.destroy();
        hls = null;
    }

    if (file.type === 'image') {
        videoPlayer.pause();
        videoPlayer.style.display = 'none';
        imageViewer.src = file.stream;
        imageViewer.style.display = 'block';
    } 
    else if (file.isHLS) {
        if (Hls.isSupported()) {
            hls = new Hls();
            hls.loadSource(file.stream);
            hls.attachMedia(videoPlayer);
            hls.on(Hls.Events.MANIFEST_PARSED, () => videoPlayer.play());
        } else if (videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            videoPlayer.src = file.stream;
            videoPlayer.play();
        }
    } 
    else {
        videoPlayer.src = file.stream;
        videoPlayer.play();
    }

    if (file.meta) {
        let statsHTML = `
            <div class="stats-badge">Map: ${file.meta.map}</div>
            <div class="stats-badge">Players: ${file.meta.players}</div>
            <div class="stats-badge">${Math.floor(file.meta.duration / 60)}m ${Math.floor(file.meta.duration % 60)}s</div>
        `;

        if (file.type === 'demo') {
            statsHTML += `<div class="demo-deep-logs" style="margin-top: 15px; display: flex; gap: 20px; text-align: left; max-height: 300px;">`;
            
            if (file.meta.chat && file.meta.chat.length > 0) {
                statsHTML += `<div class="chat-log" style="flex: 1; background: #111; padding: 10px; border-radius: 8px; overflow-y: auto;">`;
                statsHTML += `<h4 style="color: #00d1ff; margin-top: 0;">Match Chat</h4>`;
                file.meta.chat.forEach(msg => {
                    statsHTML += `<p style="margin: 2px 0; font-size: 0.85em;"><strong>${msg.from}:</strong> ${msg.text}</p>`;
                });
                statsHTML += `</div>`;
            }

            if (file.meta.bookmarks && file.meta.bookmarks.length > 0) {
                statsHTML += `<div class="bookmark-log" style="flex: 1; background: #111; padding: 10px; border-radius: 8px; overflow-y: auto;">`;
                statsHTML += `<h4 style="color: #ffaa00; margin-top: 0;">Bookmarks</h4>`;
                file.meta.bookmarks.forEach(bm => {
                    statsHTML += `<p style="margin: 2px 0; font-size: 0.85em;">Tick <strong>${bm.tick}</strong>: ${bm.value}</p>`;
                });
                statsHTML += `</div>`;
            }

            statsHTML += `</div>`; 
        }

        demoStats.innerHTML = statsHTML;
    }

    nowPlaying.innerText = `Now Playing: ${file.name}`;
}

function filterFiles() {
    const query = searchInput.value.toLowerCase();
    const filtered = allFiles.filter(f => f.name.toLowerCase().includes(query));
    renderLibrary(filtered);
}

function playMedia(file) {
    const ext = file.stream.split('?')[0].split('.').pop().toLowerCase();
    const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext);

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

searchInput.addEventListener('input', filterFiles);

fetchFiles();
setInterval(fetchFiles, 8000);
fetchFiles();
setInterval(fetchFiles, 3000); 
searchInput.addEventListener('input', filterFiles);
