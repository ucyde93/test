# Sahifa PDF

**A product of MV Digital Tools.**

A free desktop PDF reader and editor for Windows, macOS and Linux. Everything runs on your own computer: no account, no subscription, no internet connection, no tracking and no AI.

*Sahifa* (صحيفة) means "page" or "written sheet".

The interface uses a light "liquid glass" design: frosted translucent panels over a soft aurora backdrop, with a matching dark mode.

## What it can do

| Area | Features |
| --- | --- |
| **Read** | Continuous scrolling, zoom (Ctrl+wheel, fit width, fit page), page thumbnails, bookmarks/outline, clickable links, find with match case and whole words, night reading mode, read aloud, presentation mode, tabs for several documents, recent files, document properties |
| **Comment** | Highlight, underline and strike out selected text (or any area), sticky notes (saved as real PDF comments that Adobe Reader shows), text boxes, pen, rectangle, ellipse, line, arrow, stamps (Approved, Draft, Confidential, custom…), comments panel |
| **Edit** | Edit existing text (click a line, type the new text; font, size and color are matched), add text in any language including Arabic, add images, white-out, watermarks, page numbers / header & footer, crop pages, document title/author/keywords, attach files |
| **Fill & Sign** | Fill PDF forms (text, checkboxes, radio buttons, dropdowns, lists), create new form fields, signatures and initials you can **type** (4 handwriting styles), **draw** or **upload** (paper background removed automatically), saved for reuse, check/cross/dot marks, date stamp, flatten |
| **Digital IDs** | Certificate-based signatures (PKCS#7, the same kind Adobe uses). Create your own digital ID or import a `.pfx`/`.p12` from your organization; optional visible signature box |
| **Organize** | Drag-and-drop page reordering, rotate, delete, duplicate, insert blank pages, insert/merge other PDFs, images to PDF, extract pages, split by page count or ranges |
| **Protect** | AES-256 password encryption with permissions (printing, copying, editing…), open password-protected PDFs, **true redaction** (marked content is removed from the file, not just covered), remove hidden information (metadata, scripts, attachments) |
| **Convert** | Export pages as PNG/JPEG at up to 300 dpi, export text to `.txt`, create PDFs from images, blank PDFs |

Undo/redo covers every change. Your edits stay editable until you close the document.

## Install

### Download an installer
Installers are built automatically by GitHub Actions for every change (see the **Actions** tab → *Sahifa PDF* → *Artifacts*). Pushing a tag such as `sahifa-v1.0.0` publishes them as a GitHub Release.

- **Windows:** `Sahifa-PDF-Setup-x.y.z.exe` is a standard installation wizard (license page, choice of folder, Start Menu folder *MV Digital Tools*, desktop shortcut, uninstaller in *Apps & features*). `Sahifa-PDF-Portable-x.y.z.exe` runs without installing. The files are not code-signed yet, so Windows SmartScreen may show *More info → Run anyway* until you sign them with a code-signing certificate.
- **macOS:** `Sahifa-PDF-x.y.z-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel). The app is not notarized with Apple, so the first time right-click the app → **Open**.
- **Linux:** `Sahifa-PDF-x.y.z.AppImage`. Make it executable (`chmod +x`) and run it.

### Default PDF app
On first launch Sahifa PDF offers to become your default PDF app, and the Home screen keeps a **Set as default** button until it is.

- **Windows 10/11** require you to confirm the change yourself (programs are not allowed to take over file types silently). Sahifa opens the *Open with* window: pick **Sahifa PDF** and choose **Always**. You can use the Windows Settings page instead from the same dialog.
- **macOS** switches directly where the system allows it, otherwise it shows the Finder steps (*Get Info → Open with → Change All*).
- **Linux** registers a desktop entry and sets it with `xdg-mime`.

### Run from source
Requires [Node.js](https://nodejs.org) 18 or newer.

```bash
cd sahifa-pdf
npm install
npm start                 # run the app
npm run dist              # build an installer for the current system into dist/
```

## Keyboard shortcuts

| Action | Keys |
| --- | --- |
| Open / Save / Save As / Print | Ctrl+O / Ctrl+S / Ctrl+Shift+S / Ctrl+P |
| Find | Ctrl+F, then Enter / Shift+Enter |
| Undo / Redo | Ctrl+Z / Ctrl+Y |
| Zoom in / out / fit page / fit width | Ctrl+= / Ctrl+− / Ctrl+1 / Ctrl+2 |
| Tools | V select, H hand, T text, E edit text, U highlight, P pen, N note, R rectangle, S sign |
| Selected item | Delete, Ctrl+D duplicate, Ctrl+C / Ctrl+V copy/paste, arrows to nudge |
| Sidebar / Presentation / Help | F4 / Ctrl+L / F1 |

On macOS use Cmd instead of Ctrl.

## Good to know

- **How edits are saved.** Comments become real PDF comments. Text, drawings, signatures and stamps are written into the page content, so they look the same in every PDF reader.
- **Editing existing text** covers the original line and writes your new text in its place with a matching font. The original words stay in the file underneath. To remove words for privacy, use **Protect → Redact**.
- **Redaction** turns each redacted page into an image so nothing under the black boxes can be recovered. Text on those pages is no longer selectable.
- **Digital IDs you create here are self-signed.** Readers show who signed and that the document has not changed since, but mark the identity as not verified by a certificate authority. Import a `.pfx` from a trusted provider if you need a verified identity.
- **Non-Latin text** (Arabic, Urdu, Chinese…) in text boxes is saved as a high-resolution image of the text, because the built-in PDF fonts cover Latin script only.
- Not included: OCR of scanned pages, comparing two documents, editing whole paragraphs with reflow, and Adobe's online cloud features.

## Development

```
sahifa-pdf/
├── main.js              Electron main process: windows, menus, files, digital IDs
├── lib/default-app.js   "Make default PDF app" for Windows, macOS and Linux
├── build/installer.nsh  Windows installer registration (Default apps, Open with)
├── preload.js           Safe bridge between the window and the main process
├── lib/digital-sign.js  Digital ID creation and PKCS#7 signing (node-forge, @signpdf)
├── renderer/            The app UI (plain HTML/CSS/JS)
│   ├── js/core.js       Document model, saving, page operations, redaction
│   ├── js/viewer.js     Page rendering (pdf.js), text layer, forms, search
│   ├── js/annots.js     Annotation tools and editing
│   ├── js/dialogs.js    Signature pad, stamps, watermark, password, digital ID dialogs
│   ├── js/organize.js   Page organizer
│   └── js/app.js        Ribbon, tabs, sidebar, commands, shortcuts
└── test/e2e.js          End-to-end test that drives the real app
```

`npm test` launches the real app, clicks through every major feature and checks the saved PDFs with pdf.js, pdf-lib and OpenSSL. On Linux without a display, run `xvfb-run -a npm test`.

Built on free, open-source software: [Electron](https://www.electronjs.org), [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla), [pdf-lib](https://github.com/cantoo-scribe/pdf-lib), [node-forge](https://github.com/digitalbazaar/forge), [@signpdf](https://github.com/vbuch/node-signpdf) and signature fonts from the Google Fonts library (OFL).

## Branding

Company name, copyright and publisher are set in `package.json` (`author`, `build.copyright`, `build.win.legalTrademarks`) and shown in the app's Home footer, About window, splash screen, installer and PDF metadata. To use your official logo, replace `renderer/assets/mv-digital-tools.svg`; the app icon is `build/icon.svg` (export it to `build/icon.png` and `build/installer.ico`).

## License

MIT © 2026 MV Digital Tools
