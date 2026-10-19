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
| **Signatures & seals library** | Save any number of signatures and initials (named, with a default), design company seals (round or rectangular rubber-stamp style with curved company name, center text, automatic date and ink texture), add a seal from a photo or scan of your real stamp, save custom text stamps, place any of them with one click, and export/import the library to move it between computers or share it with colleagues |
| **Privacy & PIN lock** | The library is always encrypted on disk, and an optional 6 to 12 digit PIN locks it with AES-256. Auto-lock when idle, when the screen locks or the computer sleeps, rate-limited PIN attempts, optional erase after 10 wrong PINs, and password-protected backups (see below) |
| **Digital IDs** | Certificate-based signatures (PKCS#7, the same kind Adobe uses). Create your own digital ID or import a `.pfx`/`.p12` from your organization; optional visible signature box |
| **Organize** | Drag-and-drop page reordering, rotate, delete, duplicate, insert blank pages, insert/merge other PDFs, images to PDF, extract pages, split by page count or ranges |
| **Protect** | AES-256 password encryption with permissions (printing, copying, editing…), open password-protected PDFs, **true redaction** (marked content is removed from the file, not just covered), remove hidden information (metadata, scripts, attachments) |
| **Convert** | Export pages as PNG/JPEG at up to 300 dpi, export text to `.txt`, create PDFs from images, blank PDFs |

Undo/redo covers every change. Your edits stay editable until you close the document.

## Install

### Download an installer
Installers are built automatically by GitHub Actions for every change (see the **Actions** tab → *Sahifa PDF* → *Artifacts*). Pushing a tag such as `sahifa-v1.0.0` publishes them as a GitHub Release.

- **Windows:** `Sahifa-PDF-Setup-x.y.z.exe` is a standard installation wizard (license page, choice of folder, Start Menu folder *MV Digital Tools*, desktop shortcut, uninstaller in *Apps & features*). `Sahifa-PDF-Portable-x.y.z.exe` runs without installing. The files are not code-signed yet, so Windows SmartScreen may show *More info → Run anyway* until you sign them with a code-signing certificate.
- **macOS 11 Big Sur or newer:** `Sahifa-PDF-x.y.z-arm64` for Apple Silicon (M1, M2, M3, M4…) or `-x64` for Intel Macs, as `.dmg` or `.zip` (Apple menu → *About This Mac* shows which chip you have).
  1. Open the `.dmg` and drag **Sahifa PDF** into **Applications** (or double-click the `.zip` and drag the app into **Applications**).
  2. Open it from Applications. The app is signed (ad-hoc) but not notarized with Apple, so the first time macOS says it cannot verify the developer. Click **Done**, then go to **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. On macOS 14 and older you can instead right-click the app → **Open** → **Open**. This is needed only once.
  3. The first time you save a signature, macOS may ask to let Sahifa PDF use its key in your Keychain. Choose **Always Allow**.

  Advanced alternative to step 2: `xattr -dr com.apple.quarantine "/Applications/Sahifa PDF.app"` in Terminal.
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

macOS builds are ad-hoc signed by `build/afterPack.js` (Apple Silicon Macs refuse unsigned apps). On a Mac this happens automatically; to build the Mac `.zip` from Linux, download [rcodesign](https://github.com/indygreg/apple-platform-rs/releases) and run `RCODESIGN=/path/to/rcodesign npx electron-builder --mac zip --x64 --arm64`. A `.dmg` needs a Mac. With a paid Apple Developer ID, set `CSC_LINK`/`CSC_KEY_PASSWORD` (and notarization credentials) to sign and notarize instead, which removes the first-launch warning.

## Privacy and security of your signatures and seals

Your saved signatures, initials, seals and stamps never leave your computer.

- **Always encrypted on disk.** The library file is encrypted with your operating system's own protection (Windows DPAPI, macOS Keychain, Linux Secret Service/KWallet). A copy of the file is unreadable on another computer or another user account.
- **PIN lock (recommended).** In *Sign → My library → Privacy & PIN* (or *Tools → Signatures & Seals Privacy*), set a 6 to 12 digit PIN. The library is then encrypted with AES-256-GCM using a random key, and that key is protected by your PIN through scrypt, a deliberately slow, memory-hard function (about one second per guess). The PIN itself is never stored anywhere.
- **Brute-force protection.** After 5 wrong PINs the app makes you wait 30 seconds, then the wait doubles with every further wrong PIN (up to one hour). You can also choose to **erase the library after 10 wrong PINs**.
- **Auto-lock.** The library locks after a period of inactivity you choose (1 minute to 1 hour, or only when you close the app; default 5 minutes), when you lock the screen, when the computer sleeps, when the window closes, and on *Lock now* (Ctrl/Cmd+Shift+L). While locked, no signature or key is kept in memory.
- **Private backups.** *Export* creates a backup protected by a password you choose (required when a PIN is set), so the file can be moved safely between computers.
- **Forgotten PIN.** There is no back door and no recovery, not even for MV Digital Tools. You can erase the library and start again, or restore a password-protected backup.

Signatures that you already placed in a PDF and saved are part of that PDF and are not affected by the PIN.

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
├── lib/secure-library.js Encrypted signatures & seals library, PIN lock
├── build/afterPack.js   Ad-hoc code signing for macOS builds
├── build/installer.nsh  Windows installer registration (Default apps, Open with)
├── preload.js           Safe bridge between the window and the main process
├── lib/digital-sign.js  Digital ID creation and PKCS#7 signing (node-forge, @signpdf)
├── renderer/            The app UI (plain HTML/CSS/JS)
│   ├── js/core.js       Document model, saving, page operations, redaction
│   ├── js/viewer.js     Page rendering (pdf.js), text layer, forms, search
│   ├── js/annots.js     Annotation tools and editing
│   ├── js/dialogs.js    Signature pad, stamps, watermark, password, digital ID dialogs
│   ├── js/library.js    Signatures & seals library, seal designer, quick picker
│   ├── js/organize.js   Page organizer
│   └── js/app.js        Ribbon, tabs, sidebar, commands, shortcuts
├── test/secure-library.test.js  Security tests for the encrypted library
└── test/e2e.js          End-to-end test that drives the real app
```

`npm test` runs the security tests, then launches the real app, clicks through every major feature and checks the saved PDFs with pdf.js, pdf-lib and OpenSSL. On Linux without a display, run `xvfb-run -a npm test`.

Built on free, open-source software: [Electron](https://www.electronjs.org), [pdf.js](https://mozilla.github.io/pdf.js/) (Mozilla), [pdf-lib](https://github.com/cantoo-scribe/pdf-lib), [node-forge](https://github.com/digitalbazaar/forge), [@signpdf](https://github.com/vbuch/node-signpdf) and signature fonts from the Google Fonts library (OFL).

## Branding

Company name, copyright and publisher are set in `package.json` (`author`, `build.copyright`, `build.win.legalTrademarks`) and shown in the app's Home footer, About window, splash screen, installer and PDF metadata. To use your official logo, replace `renderer/assets/mv-digital-tools.svg`; the app icon is `build/icon.svg` (export it to `build/icon.png` and `build/installer.ico`).

## License

MIT © 2026 MV Digital Tools
