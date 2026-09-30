# Folio Fill - Gloster Document Studio

A local-first document studio for placing typed or handwritten-style text on PDF and Word forms, with handwriting fonts including Shadows Into Light, Pacifico, Dancing Script, Handlee, Permanent Marker, Indie Flower, Marcel, Bad Script, Just Another Hand, and Patrick Hand. Kristen ITC uses the local font when installed.

## Run locally

```sh
npm install
npm run dev
```

Open the local address printed by Vite. Use **Open document** to import a PDF or DOCX file, type a value in the details panel, then drag the placement chip onto a page. Select a placed field to change its size, color, typed font, or handwriting font without recreating it. Drafts are saved in this browser's IndexedDB. Export creates a downloadable PDF.

The redesigned demo document is available at `public/sample-form.pdf`.

PDF pages retain their original appearance. Word files are imported as readable text and reflowed into pages; complex Word formatting is not preserved by the browser conversion.