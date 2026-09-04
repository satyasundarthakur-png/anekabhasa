# Anekabhasa

Translate Odia manuscripts and documents into Hindi, Marathi, Gujarati, Kannada, Malayalam,
Telugu, or English — whole `.docx` or `.pdf` files, in one go, entirely in your browser.

**Live app**: https://anekabhasa.lovable.app

This project was built with [Lovable](https://lovable.dev).

## What it does

1. **Upload** a `.docx` or `.pdf` (scanned or text-based) containing Odia text.
2. **Parse** it client-side — `mammoth` reads `.docx`, `pdfjs-dist` reads the text layer of a
   `.pdf`. If a PDF turns out to have no usable text layer (a scan, or a flattened image),
   it automatically falls back to in-browser OCR via `tesseract.js` (Odia + English trained
   data). You can also force OCR manually for a text-layer PDF whose Odia comes out with
   scrambled diacritic order — a known limitation of how PDFs store shaped glyphs for
   complex Indic scripts, not something fixable by re-parsing the same text layer.
3. **Translate** via the Gemini API, chunked with marker-based validation so paragraph
   order and count survive translation, plus an auto-generated glossary (extracted from a
   sample of the document) so recurring names and terms stay consistent across a whole book.
4. **Download** a freshly assembled `.docx` with headings preserved.

No backend. No Supabase, no Lovable Cloud, no Hugging Face. The only network calls the app
makes are: (a) directly to Google's Gemini API with your own key, and (b) to Tesseract's
CDN to fetch OCR language data, only if OCR is actually used. Your document never leaves
your browser otherwise.

## Domains

A domain picker tunes translation register and terminology:

- **Spiritual / Devotional** — scripture, Vedantic commentary, devotional and philosophical
  text. Keeps Sanskrit/Odia names, mantras, and philosophical terms transliterated
  consistently rather than loosely translated.
- **Literature** — poetry, prose, narrative manuscripts. Prioritizes natural, idiomatic
  phrasing while preserving tone, voice, and imagery.
- **Medical** — clinical notes, textbooks, formularies, and traditional (Ayurvedic) medicine
  content. Keeps drug names, dosages, and anatomical terms unchanged; unfamiliar Ayurvedic
  terms are kept transliterated with a brief gloss rather than invented.
- **Cinematic / Dialogue** — natural spoken dialogue with the rhythm and punch of film
  dialogue. No literary/Sanskritized phrasing, and no English loanwords or slang.
- **Writer's Tone: Manoj Das** — simple, lucid, gently narrative prose with warmth and
  quiet irony, in the stylistic register associated with the Odia writer Manoj Das.
- **Writer's Tone: Mayadhar Mansingh** — lyrical, romantic, rhythmic language with strong
  natural imagery, in the stylistic register associated with the Odia poet Mayadhar
  Mansingh.
- **Writer's Tone: Swami Akhandananda** — simple, direct, compassionate Vedantic teaching
  voice, in the stylistic register associated with Swami Akhandananda.

These four are stylistic *registers* the model translates into — they do not reproduce
or quote any of these writers'/teachers' actual published text.

## Gemini API key

Bring your own key (free tier available at
[aistudio.google.com/apikey](https://aistudio.google.com/apikey)). It's stored only in your
browser's `localStorage` and sent directly from your browser to Google's API — this app
never sees or stores it anywhere else.

## Project structure

```
src/
  components/
    AnekabhasaApp.tsx        Main app: upload → translate → download
    Dropzone.tsx            File picker/drop target (.docx, .pdf)
    ApiKeyInput.tsx         Gemini API key entry (localStorage-backed)
    LanguagePicker.tsx      Target language selector
    DomainPicker.tsx        Domain/register selector
    ProgressBar.tsx         Chunk/OCR progress bar
    KonarkWheelPanel.tsx    Decorative Odia-architecture side art (Konark chakra)
    TempleSpirePanel.tsx    Decorative Odia-architecture side art (temple spire)
  lib/
    gemini.ts               Direct Gemini API calls: translation + glossary
    docxFile.ts              mammoth-based .docx parsing + docx-based rebuilding
    pdfCore.ts               Shared pdfjs setup, page rendering, file-type detection
    pdfFile.ts                .pdf text-layer extraction, with OCR auto-fallback
    ocr.ts                    Tesseract.js OCR path for scanned/image PDFs
    pipeline.ts                Orchestrates parse → glossary → translate → assemble
    settings.ts                 API key storage (localStorage)
  routes/                  TanStack Start file-based routes
```

`src/lib/error-capture.ts`, `error-page.ts`, and `lovable-error-reporting.ts` are Lovable's
own SSR error-reporting scaffolding (wired into `server.ts` / `start.ts` / `__root.tsx`) —
not part of the translation feature, left as-is.

```
public/
  favicon.svg, favicon.ico, apple-touch-icon.png, icon-192.png, icon-512.png
  social-preview.png        Open Graph / Twitter card image
```

## Development

You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

Other scripts:

```sh
npm run build     # production build
npm run preview   # preview the production build
npm run lint       # eslint
npm run format     # prettier --write
```

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/8ea1f13e-da8a-441c-9d00-1e3658ccb42f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.
