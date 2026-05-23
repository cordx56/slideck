# slideck

Write slides declaratively in YAML and author, edit, present, and export them to
PDF — entirely in the browser, or headlessly from the command line.

slideck compiles a YAML project through a compiler-style intermediate
representation so that the **SVG renderer** (used for live preview and
presentation) and the **PDF renderer** (with embedded, subsetted fonts) consume
exactly the same layout. What you see in the editor is what you get in the PDF.

## Features

- **Frontend-complete**: the web app needs no server and can be hosted as static
  files (GitHub Pages, etc.).
- **Three-layer IR** (HIR -> MIR -> LIR): the SVG and PDF renderers share the
  same lowered primitives, so layout, line wrapping, and font metrics (via
  fontkit) match across outputs.
- **Declarative YAML**: bases (composable layers), variables, absolute
  positioning, groups, and auto-layout. Themes and overlays are unified into
  **Bases** (`always: true` applies to every slide, `use:` selects per slide).
  System variables such as `${slideNumber}` are available.
- **Bases inheritance**: a base file can `extends:` another.
- **Colors as variables**: `colors:` are injected into the variable scope and
  referenced as `${name}`; color fields accept a `${var}` or a literal.
- **Lists**: `ul` / `ol` with `items` (same shape as a group's children).
- **Inline Markdown**: bold, italic, inline `code`, ~~strikethrough~~, and links.
  Links are rendered as real clickable annotations in PDF and `<a>` in SVG.
- **Inline math**: `$...$` is rendered with MathJax into native vector paths, so
  formulas render identically in the SVG preview, the exported SVG, and the PDF
  (no browser or external CSS required at view time).
- **Fonts**: TrueType embedding with subsetting and ToUnicode (selectable /
  extractable text in the PDF). TTC collections are supported (`index:`).
- **Images**: intrinsic size is parsed from the file header (PNG/JPEG/GIF/WebP/
  BMP), so aspect ratio is correct in every environment, including headless.

## Monorepo layout (pnpm workspace)

```
packages/
  core/   @slideck/core — browser-independent pipeline (library)
  web/    @slideck/web  — Svelte editor / presenter (browser)
  cli/    @slideck/cli  — Node CLI (scaffold / edit server / YAML -> PDF/SVG)
```

- **core**: schema (zod) / ir (HIR, MIR, LIR) / load (parse, base resolution,
  prepare) / normalize / lower / render (svg, pdf) / edit (YAML AST) / pipeline.
  It depends only on the `AssetResolver` and `VFS` abstractions, never on a
  concrete implementation (IndexedDB, disk, ...). The heavy PDF renderer is split
  out under `@slideck/core/pdf`.
- **web**: an IndexedDB-backed VFS, a file-tree UI, CodeMirror, live SVG preview,
  presentation mode, ZIP import/export, and client-side PDF export. When launched
  by the CLI edit server it uses an HTTP-backed VFS instead of IndexedDB.
- **cli**: a `DiskVfs` that treats a project directory as the source of truth. It
  serves the bundled web editor and bridges the browser to disk over an HTTP VFS
  API + SSE (`serve`), and renders PDF/SVG headlessly with `core` (`export`).

## Development

```bash
pnpm install
pnpm dev          # web dev server (= pnpm --filter @slideck/web dev)
pnpm test         # all packages (vitest)
pnpm check        # type-check all packages
pnpm build        # build web + cli (the cli bundles the web build)
pnpm build:web    # web only (for static hosting)
```

The sample project lives in `packages/web/public/examples/basic/`; pick it from
the web app's start screen.

## CLI (`@slideck/cli`)

Install globally:

```bash
npm install -g @slideck/cli
```

```bash
# Scaffold a new sample project into ./my-deck (defaults to ./my-deck)
slideck new my-deck

# Open a project on disk in the edit server (a browser opens automatically)
slideck serve ./my-deck          # defaults to the current directory
slideck serve ./my-deck --port 4321 --no-open

# Render a YAML project to PDF (and optionally per-slide SVG)
slideck export ./my-deck/deck.yaml -o out.pdf --svg ./svg-out
```

`serve` hosts the bundled web editor and saves edits straight to disk over an
HTTP VFS API + SSE; edits made outside the editor are reflected in the browser as
well. Internal state such as the file-tree expansion is kept under `.slideck/`.

Inside the repository you can use `pnpm cli` (= `pnpm --filter @slideck/cli
start`). Note that pnpm runs the script from `packages/cli`, so relative paths are
resolved from there (pass an absolute path, or `cd` into the target first):

```bash
pnpm cli serve "$PWD/packages/web/public/examples/basic"
```

### Publishing (npm)

`@slideck/cli` ships a single bundled file (cli + core via esbuild) plus the
bundled web build under `dist/`. It is built by `prepublishOnly`, so publishing is
just `npm publish` from `packages/cli` (`publishConfig.access: public`).

## Project structure

A slideck project is a directory:

```
my-deck/
  deck.yaml            # entry: slides
  theme.yaml           # a base (theme/overlay), one or more
  overlays/footer.yaml
  fonts/...            # .ttf / .ttc
  img/...              # images
```

Relative paths are resolved from the file that references them. See
[PLAN.md](./PLAN.md) for the full design.

## Deploy (web)

`packages/web/dist/` is fully static. For sub-path hosting, set `VITE_BASE`:

```bash
VITE_BASE=/slideck/ pnpm --filter @slideck/web build
```
