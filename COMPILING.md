# Compiling vlclone
First of all, You need Node.js (24.15.0) and NPM (11.12.1).

## Dependencies:
- express
- helmet
- compression
- ini
- ws
- fluent-ffmpeg
- chokidar
- express-rate-limit
- ffprobe-static
- ffmpeg-static
- nodemon
- @profullstack/transcoder

## Configuring config.ini

Config.ini currently looks like this:
```ini
[server]
; enter your desired port
port = 3000

[paths]
; enter your desired paths for those 3
media_dir = media
thumbs_dir = thumbnails
convert_dir = converted

[hls]
; cut segment time, below 1.0 is not recommended
segment_time = 5.0
resolution = 854x480
```

Now, there are 3 sections, [server], [paths], and [hls]. the [server] section is to configure your ports, the [paths] section
 is to configure your media paths, and the [hls] section is hls settings, `segment_time` is the segment cutting time and 
 `resolution` is hls' video resolution

 Once you have those set up, time to move on to:

## Running the software
Simply type `npm start`. the terminal should look like this:

```
-- vlclone 1.5 ---
serving media at: http://localhost:3000
media:     /your/media/path
thumbs:    /your/thumbnail/path
converted: /your/converted/path`
```

To terminate, simply press `Ctrl + C` at the same time.

## REMEMBER, YOUR DEVICES MUST CONNECT INTO THE SAME WI-FI TO ACCESS THE FILES!!!
If you're running ***__vlclone__*** on your PC and want to access your files on mobile or other hardwares, type `ipconfig` to your CMD (Windows) and SPECIFICALLY find your Wi-Fi's/LAN's IPV4 address, then copy and paste that to your other hardware's url tab.

However, if you're on Linux (like me as of writing this), type `hostname -I` on the Terminal.

BUT, HOWEVER, if you're on MacOS, type `ipconfig getifaddr en0` (if using Wi-Fi) or `ipconfig getifaddr en0` (if using LAN) on the Terminal.


enjoy hosting!