# Stream Overlay Deck

A browser-source-ready overlay deck for YouTube and OBS livestreams.

Live demo:

https://furkanbayoglu-arch.github.io/stream-overlay-deck/

## Features

- Deck mode and clean overlay mode with `?mode=overlay`
- BroadcastChannel communication between control panel and overlay
- Cards for slides, images, videos, ticker, break screen, and countdown
- Asset groups and quick filtering
- Layer support: `background`, `main`, `lower-third`
- Rundown queue with previous/next controls
- Basic OBS WebSocket scene switching panel
- PWA-ready manifest and service worker

## Local run

```bash
cd stream-overlay-deck
python3 -m http.server 8139
```

Open:

```text
Deck:    http://127.0.0.1:8139
Overlay: http://127.0.0.1:8139/index.html?mode=overlay
```

## OBS usage

1. Open the deck locally in your browser.
2. Add the overlay URL as an OBS Browser Source:
   `http://127.0.0.1:8139/index.html?mode=overlay`
3. Use the deck window to trigger cards with buttons or hotkeys `1-9`.
4. Press `Space` to clear the live overlay.
