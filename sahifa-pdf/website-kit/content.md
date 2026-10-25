# Sahifa PDF: website content

Ready-to-use text for the Sahifa PDF product page on mvdigital.tools. Adapt the wording to the site's voice; the facts below are accurate for version 1.3.0.

---

## Hero

**Eyebrow:** New from MV Digital Tools

**Headline:** Sign, edit and protect your PDFs. Free, and fully offline.

**Subheadline:** Sahifa PDF is a desktop PDF reader and editor for Windows and Mac. Fill and sign forms, stamp your company seal, edit text and organize pages, all on your own computer. No account, no subscription, no internet connection, no AI.

**Buttons:** Download for Windows · Download for Mac (detect the visitor's system and highlight the matching one; link "Other downloads" to the full list)

**Small print under the buttons:** Version 1.3.0 · Free forever · Windows 10/11 and macOS 11+

**Hero image:** `screenshots/02-signed-document.webp` (a signed agreement with a company seal)

*Sahifa* (صحيفة) means "page" or "written sheet".

---

## Four promises (short strip under the hero)

- **Free.** Every feature, no trials, no watermarks, no "Pro" version.
- **Offline.** Your documents never leave your computer.
- **Private.** No account, no tracking, no ads.
- **No AI.** Nothing is sent anywhere or analysed.

---

## Feature sections

### Sign like it's paper, only faster
Type your signature in one of four handwriting styles, draw it with your mouse or pen, or upload a photo of your real signature (the paper background is removed automatically). Add initials, dates, check marks, and certificate-based digital signatures (the same PKCS#7 kind Adobe uses).
*Image:* `screenshots/03-signature-pad.webp`

### Your company seal, designed in seconds
Design a round or rectangular rubber-stamp seal with your company name curving around the edge, a center word such as APPROVED and today's date that updates by itself. It even has a realistic ink texture. Or add a photo or scan of the seal you already use.
*Image:* `screenshots/04-seal-designer.webp`

### Saved and one click away
Keep any number of signatures, initials, seals and stamps in your personal library, and place them on any document with a single click. Move the library between computers with an encrypted backup.
*Image:* `screenshots/05-quick-picker.webp`

### Locked with a PIN
Your saved signatures and seals are always encrypted on your computer. Add a 6 to 12 digit PIN and they are locked with AES-256 encryption. Sahifa locks itself when you step away, lock your screen or close the laptop, and slows down anyone guessing the PIN. You can even choose to erase the library after 10 wrong attempts.
*Image:* `screenshots/06-pin-lock.webp`

### Shrink big PDFs in seconds
Scanned documents and photos make PDFs huge. Compress makes them small enough for email and upload forms, often 70 to 90% smaller, with three levels to choose from. Text stays sharp and selectable, and your original file is never changed: you save a compressed copy and see exactly how much smaller it is.

### Everything else you need from a PDF app
- **Read:** fast scrolling, zoom, thumbnails, bookmarks, search, night mode, read aloud, presentation mode, tabs.
- **Comment:** highlight, underline, strike out, sticky notes, drawings, shapes, arrows and stamps that other PDF readers can see.
- **Edit:** change existing text, add new text (including Arabic) and images, watermarks, page numbers, headers and footers, crop pages.
- **Fill forms:** text fields, checkboxes, radio buttons, dropdowns. Create new form fields too.
- **Organize:** drag to reorder, rotate, delete, duplicate, insert blank pages, merge PDFs, split and extract pages, turn images into a PDF.
- **Protect:** AES-256 passwords with permissions, true redaction that really removes content, and cleaning of hidden information.
- **Convert:** save pages as PNG or JPEG, export text.
*Images:* `screenshots/07-organize-pages.webp`, `screenshots/01-home.webp`

### Light and dark
A calm "liquid glass" design with a matching dark mode.
*Image:* `screenshots/08-dark-mode.webp`

---

## Downloads (version 1.3.0)

| System | File | Size |
| --- | --- | --- |
| Windows 10 / 11, installer (recommended) | `Sahifa-PDF-Setup-1.3.0.exe` | 85.4 MB |
| Windows 10 / 11, portable (no install) | `Sahifa-PDF-Portable-1.3.0.exe` | 85.0 MB |
| Mac with Apple Silicon (M1, M2, M3, M4) | `Sahifa-PDF-1.3.0-arm64.zip` | 100.4 MB |
| Mac with Intel processor | `Sahifa-PDF-1.3.0-x64.zip` | 106.5 MB |

Mac tip for visitors: open the Apple menu and choose About This Mac. It shows "Chip: Apple M…" (choose Apple Silicon) or "Processor: Intel" (choose Intel). Requires macOS 11 Big Sur or newer.

**SHA-256 checksums** (optional, for people who want to verify their download):

```
b75e2aaa69cbddd6f4f5bfe7bcb37aa66e3b46657bd2bbf5e853639483dd8dba  Sahifa-PDF-Setup-1.3.0.exe
85cb366f0dcf3c1782e6de9c6617d974fa52744a109ce227b5526167d9344910  Sahifa-PDF-Portable-1.3.0.exe
48238e7c095b7523f7917b577c9120f18265f344426178c5379213cacd908ee7  Sahifa-PDF-1.3.0-arm64.zip
588a77562fb7c738f96993344bb8205db132e18f18c8d07e430e6feb6416f570  Sahifa-PDF-1.3.0-x64.zip
```

---

## Installing (show near the download buttons, or as a small "Help installing" section)

**Windows**
1. Run `Sahifa-PDF-Setup-1.3.0.exe`.
2. If Windows shows "Windows protected your PC", click **More info**, then **Run anyway**. (This appears for new apps that are not yet code-signed. Sahifa PDF is safe and works fully offline.)
3. Follow the installer. Sahifa PDF appears in the Start menu under *MV Digital Tools*.

**Mac**
1. Double-click the `.zip`, then drag **Sahifa PDF** into your **Applications** folder.
2. Open it. The first time, macOS says it cannot verify the developer. Click **Done**, open **System Settings → Privacy & Security**, scroll down and click **Open Anyway**. (On macOS 14 and older you can also right-click the app and choose **Open**.) This is needed only once.
3. When you first save a signature, macOS may ask to use the Keychain. Click **Always Allow**.

**Make it your default PDF app:** Sahifa offers this the first time it opens, and there is a "Set as default" button on its Home screen.

---

## Frequently asked questions

**Is it really free?**
Yes. Every feature is free, with no trial period, no watermarks and no paid version.

**Do my documents get uploaded anywhere?**
No. Sahifa PDF works entirely on your computer and does not need the internet. It has no account and no tracking.

**Does it use AI?**
No. Nothing you open is analysed or sent to any AI service.

**Are the signatures legally valid?**
Sahifa adds your handwritten-style signature and seal to the PDF, like signing on paper. It can also add certificate-based digital signatures that PDF readers can verify. Whether a particular signature type is accepted for a contract depends on the organization and local law.

**What if I forget my PIN?**
For privacy there is no back door, not even for MV Digital Tools. You can erase the saved signatures and start again, or restore an encrypted backup. Documents you already signed are not affected.

**Why does Windows or macOS show a warning the first time?**
Operating systems show this for new apps that have not yet bought a paid code-signing certificate. Follow the steps above once and it will not appear again.

**Can I add Arabic text?**
Yes. Arabic text is added as a sharp, high-resolution image so it looks right in every PDF reader. The app's menus are in English.

---

## Page details

- **Suggested address:** `mvdigital.tools/sahifa-pdf/` (and a card linking to it from the home page's products or work section).
- **Page title:** Sahifa PDF · Free offline PDF editor for Windows and Mac · MV Digital Tools
- **Meta description:** Sign, edit and protect PDFs for free. Sahifa PDF by MV Digital Tools works fully offline on Windows and Mac: signatures, company seals, PIN lock, editing and more. No account, no AI.
- **Social preview image:** `screenshots/02-signed-document.webp`
- **App icon:** `sahifa-pdf-icon.png` (1024×1024) or `sahifa-pdf-icon.svg`
- **Footer line:** Sahifa PDF is a product of MV Digital Tools.
