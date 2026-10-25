# Sahifa PDF website kit

Everything needed to add a Sahifa PDF product page to mvdigital.tools.

## What is here

| File | What it is |
| --- | --- |
| `content.md` | Page text: hero, features, downloads table with sizes and SHA-256 checksums, install steps, FAQ, page title and meta description |
| `screenshots/*.webp` | Screenshots of the real app at 2880×1800 (2x), ready for the web |
| `screenshots/*-1440.webp` | The same at 1440×900, for smaller screens and faster loading |
| `screenshots/*.png` | Lossless originals |
| `sahifa-pdf-icon.png` / `.svg` | App icon (1024×1024) |
| `mv-digital-tools-logo.svg` | MV Digital Tools monogram used inside the app |

Screenshots, in suggested order of use:

1. `02-signed-document`: hero image, a signed agreement with a company seal
2. `03-signature-pad`: typed signature in four handwriting styles
3. `04-seal-designer`: designing a company seal
4. `05-quick-picker`: saved seals one click away
5. `06-pin-lock`: PIN unlock screen
6. `07-organize-pages`: page organizer
7. `01-home`: the app's Home screen
8. `08-dark-mode`: dark mode

They are regenerated from the real app with `npm run screenshots` (see `scripts/screenshots.js`), so they stay accurate for future versions.

## Getting the files

The repository is public, so no login is needed:

```bash
git clone --depth 1 --branch claude/great-pasteur-ogvf6f https://github.com/ucyde93/test.git sahifa-src
# kit: sahifa-src/sahifa-pdf/website-kit
```

Or download single files from
`https://raw.githubusercontent.com/ucyde93/test/claude/great-pasteur-ogvf6f/sahifa-pdf/website-kit/<file>`.

## The installers

The installers are published as a GitHub Release on the public repository
[ucyde93/sahifa-pdf](https://github.com/ucyde93/sahifa-pdf). Permanent download links for version 1.3.0:

```
https://github.com/ucyde93/sahifa-pdf/releases/download/v1.3.0/Sahifa-PDF-Setup-1.3.0.exe
https://github.com/ucyde93/sahifa-pdf/releases/download/v1.3.0/Sahifa-PDF-Portable-1.3.0.exe
https://github.com/ucyde93/sahifa-pdf/releases/download/v1.3.0/Sahifa-PDF-1.3.0-arm64.zip
https://github.com/ucyde93/sahifa-pdf/releases/download/v1.3.0/Sahifa-PDF-1.3.0-x64.zip
https://github.com/ucyde93/sahifa-pdf/releases/download/v1.3.0/SHA256SUMS.txt
```

The releases page is https://github.com/ucyde93/sahifa-pdf/releases/latest.

Before publishing anything live, show the owner a preview and get their go-ahead.

## Style notes

- The app's accent is a cobalt-to-violet gradient (`#3d6dff` → `#7d5cff`) on soft, frosted "liquid glass" panels. Use it for Sahifa accents only if it sits well with the site's own design; the site's design comes first.
- Please avoid em dashes in the copy (the owner's preference).
- Product name: **Sahifa PDF** (capital S, "PDF" in capitals). Company line: "A product of MV Digital Tools".
