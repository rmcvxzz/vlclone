# vlclone
Somewhat working self-hosted streaming service using Node.js

This is considered as a coding practice.
![ze paige](./something/PAIGE!!!!.png)
![ze paige](./something/PAIGE!!!!2.png)

# What are the features?
vlclone has evolved from a simple file lister into a smart media pipeline:

* **Deep TF2 Match Analysis**
    * Automated parsing of `.dem` files to extract real-time metadata including map names, player counts, and match duration
    * Integrated Match Chat viewer that captures player dialogue and critical STV server stats like Medic drops
    * High-performance binary processing using the `demostf` parser to generate instant JSON summaries for the UI
* **Smart Transcoding Engine**
    * Automatically detects heavy desktop formats (.mov, .mkv) and optimizes them into mobile-friendly H.264 MP4s in the background
    * Uses Fast-Start (moov atom) optimization, allowing you to seek through huge 4K videos instantly without waiting for a full download
* **Automatic Visual Previews**
    * Auto-generates high-quality thumbnails for every video and demo in your library using FFmpeg
    * Smart "Processing" badges in the UI so you know exactly when a file is being optimized
* **Production-Grade Stability**
    * **Concurrency Guard:** A built-in traffic controller that prevents FFmpeg from eating 100% of your CPU by processing only one file at a time
    * **Rate Limiting:** Protects your server from being spammed by too many rapid requests
    * **Helmet.js Integration:** Hardens your streaming headers against common web vulnerabilities
* **Real-Time Sync and Search**
    * **Library Watcher:** The system automatically syncs with your /media folder as soon as changes are detected—no manual refresh needed
    * **Instant Search:** Filter through hundreds of demos, movies, and music in real-time as you type
    * **Activity Log:** A built-in terminal-style logger in the UI to track new discoveries and processing status
* **Performance Optimized**
    * **Gzip Compression:** All metadata and API responses are compressed to save mobile data
    * **Byte-Range Streaming:** Supports "Partial Content" (206) for smooth seeking and resuming on Android/iOS players

## Adding medias
Simply put your medias onto the media folder.
Supported medias (as of 04/21/2026:):
- .mp4
- .webm
- .ogg
- .ogv
- .mp3
- .png
- .jpg
- .jpeg
- .gif
- .webp
- .dem (tf2 demo files)
## Compiling
See [COMPILING.md for the instructions.](./compiling.md)

# FAQS
***Q: Why use nodemon?***
***A: You should already know this. nodemon allows you to restart the server INSTANTLY after a change on the root of vlclone. the new ***

***Q: Why node.js?***
***A: Simple. It's already a great library to make servers.*** 

***Q: Where did the name come from?***
***A: vlclone is VLC + Clone + full lowercase. vlclone was originally made to be a vlc clone using node.js.***
s
# Getting a bug?
Report the issue [here.](https://github.com/rmcvxzz/vlclone/issues)
