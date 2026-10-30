# ProPresenter 7 Song Editor (Web)

A browser-based (PWA) version of the ProPresenter 7 Song Editor. Runs entirely
in your browser via [Pyodide](https://pyodide.org) + `protobuf`, generating
`.pro` files identical to the desktop app.

**Live app:** https://memepyo.github.io/songeditor-web/

## Features

- **Translate View** — one column per language text block, shared line numbers, sync scroll
- **Single View** — focused editor mirroring the Romanian block
- **Download as Single** — exports a `.pro` with only the Romanian text block
- **Group Names editor** — edit `GroupNames.txt` in-browser
- **Custom Template.pro / GroupNames.txt** — pick your own files; they are remembered in this browser and used for every export
- **Open / Save** — load `.json` backups, download `.pro` + `.json`
- **Offline** — works without internet after first visit (service worker)
- **Resilient loading** — Pyodide comes from jsdelivr, falling back to unpkg if it fails; the protobuf wheel ships with the app so it never depends on a CDN
- **Installable** — add to home screen

## How it works

The browser loads the Python files (`SongEditorPro7Generic.py`, `single_export.py`)
as text, executes them in Pyodide (CPython compiled to WebAssembly), installs
`protobuf` via `micropip`, fetches `Template.pro` (binary) and `GroupNames.txt`,
and calls the same functions the desktop app uses. The generated `.pro` is
base64-encoded and downloaded as a file.

## Privacy

No server, no account, no analytics. Everything runs locally in your browser.

## Local dev

```bash
python -m http.server 8000
# open http://localhost:8000
```

## Credits

Originally created as **MultiLanguage ProPresenter** by
[JacobBaartse](https://github.com/JacobBaartse/MultiLanuageProPresenter).
Extended fork with desktop GUI, single-language export, theming, PDF import.
Web port uses the same Python backend.
