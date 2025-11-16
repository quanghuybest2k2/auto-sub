# auto-sub

Lightweight browser extension that shows live speech-to-text translations as on-screen subtitles.

Features
- Real-time speech recognition with interim and final results
- Live translation between configurable input/output languages
- Draggable, scrollable subtitle overlay for easy review

Prerequisites
- Google Chrome or Chromium-based browser
- Node.js (>=22) and npm for building the extension

Quick start
1. Install dependencies:

```bash
npm install
```

2. Build the extension:

```bash
npm run build
```

3. Load into Chrome (Developer mode):
- Open `chrome://extensions` → Enable Developer mode → Load unpacked → Select the project folder (or `dist`/`build` output if configured).

Usage
- Open the extension popup and start recognition. The subtitle overlay will appear at the bottom of the page and display translated text in real time.

Development
- Source files are in `src/`. Build output is produced by the `build` step defined in `package.json`.
- To test changes while developing, build and reload the extension in Chrome.

Contributing
- Feel free to open issues or pull requests. Keep changes small and focused; include build steps and a short description.

License
- This project is licensed under the MIT License — see `LICENSE` for details.
