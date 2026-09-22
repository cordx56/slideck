# Refactoring plan

Design-level decisions for the slideck refactoring. This file is the contract
between the overall design pass (already applied where marked DONE) and the
per-component implementation passes. Each component section lists the target
module layout, the public names, and the constraints an implementer must keep.

Global rules for every pass:

- Behaviour must not change except where a section explicitly says so.
- `pnpm check`, `pnpm test`, and `pnpm fmt` must be green at the end of a pass.
- Do not add new `as` casts. Remove a cast when a type guard or a typed API
  makes it unnecessary; leave casts that sit at a library boundary
  (zod internals, fontkit, pdf-lib, DOM APIs).
- Do not use explicit `any` / `unknown` in new code unless the value really is
  unknown (raw YAML, JSON bodies).
- Keep comments in English, ASCII only. Document public APIs only where the
  signature does not already say it.
- Do not commit. Leave changes in the working tree.

## 1. IR and shared contracts (DONE by the design pass)

- `RichStyle` moved from `ir/hir.ts` to `ir/mir.ts`: it is a resolved style.
- `MirText.rich` is required. normalize always produces it.
- `MirFont.path` is required. The schema requires it, so `prepare` no longer
  needs a dead `if (!decl.path)` branch.
- HIR `BaseElement` renamed to `ElementCommon` ("Base" was overloaded with
  `BaseHir` / `BaseRef`, which denote theme bases).
- New `ir/walk.ts`: `childElements(el)` and `walkElements(els, visit)`,
  overloaded for HIR and MIR. Every tree traversal must use these instead of
  re-implementing the group/list recursion (`resolve-refs`, `prepare`,
  `store.svelte.ts` `anyMissingImage`).
- `LowerCtx.roles: FontRoles` (`lower/context.ts`) carries the faces that
  `prepare` auto-detects for mono / bold / italic / boldItalic. `prepare` no
  longer mutates the MIR deck; lower merges `el.rich` with `ctx.roles` through
  `resolveRichStyle` in `lower/text-style.ts`. This also fixes the live
  recompile path, which reused a cached ctx with a freshly normalized deck and
  therefore lost the auto-detected faces until the next full compile.
  `EMPTY_FONT_ROLES` is the value to use in tests and when no fonts load.
- `lib/error.ts` `joinPath` renamed to `formatIssuePath` (it formats a zod
  issue path; `joinPath` is reserved for the path module below).

## 2. Paths and loading (core: `path.ts`, `load/*`, `pipeline.ts`)

Problem: two path conventions coexist. `path.ts` handles absolute VFS paths
("/deck.yaml"); `load/assets.ts` has its own `normalizePath` / `resolveFrom`
for root-relative paths ("deck.yaml"). Web bridges them in `VfsResolver`.

Target:

- One convention: every path the pipeline handles is absolute and
  root-relative, "/"-separated ("/deck.yaml", "/img/x.png"). `AssetResolver`
  receives such paths. Implementations map "/" to their root.
- `path.ts` is the only path module. Public names (all exported from the core
  barrel): `normalizePath`, `joinPath`, `dirname`, `basename`, `extname`,
  `resolvePath(reference, containingFile)`, `isDescendant`, `isValidName`.
  The old generic names `normalize` / `join` are removed from the barrel.
- Delete `normalizePath` / `resolveFrom` from `load/assets.ts`; that file keeps
  only the `AssetResolver` / `WritableResolver` interfaces and the resolver
  implementations (`FetchAssetResolver`, `CachingResolver`,
  `OverrideResolver`, `MemoryAssetResolver`). Keys are normalized with
  `path.ts`.
- `loadDeck(resolver, entry = "/deck.yaml")`. `LoadedDeck` drops the unused
  `resolver` field.
- `pipeline.ts`: extract `loadAndNormalize(resolver, entry): Promise<NormalizeResult>`;
  `compileDeck` = `loadAndNormalize` + `prepare`. Remove `recompileDeck` and
  `RecompileResult` (callers use `loadAndNormalize`). Add
  `lowerAllSlides(compiled): SlideLir[]` and
  `usedFonts(compiled, lirs): Map<string, LoadedFont>`; both `renderSlideSvg`
  (embedFonts) and `render/pdf/index.ts` use them instead of scanning text runs
  themselves.
- Web `VfsResolver` becomes a trivial pass-through (or is deleted if the VFS
  can be adapted directly). Web store: the override key is `openPath` as-is.
  CLI export: `entry = "/" + basename(deckPath)`. Web tests that import
  `normalizePath` from core keep working with the new module.
- Tests to update: `path-resolution`, `editor`, `pipeline`, `slide-id`,
  `references`, `vfs-path`, web `example` / `pdf`.

## 3. normalize (core: `normalize/*`)

- Split `normalize/index.ts`:
  - `normalize/index.ts`: `normalize()`, `buildFontRegistry`, `pickSlideSize`.
  - `normalize/text-style.ts`: `resolveTextDefaults`, `resolveRichStyle`,
    `resolveColorLiteral`.
  - `normalize/elements.ts`: `convertElement`, `buildFigureLabel`.
- Replace the per-element closures (`exp`, `color`, `num`, `flex`) with methods
  on a `SlideScope` object built once per slide (fields: `vars`,
  `textDefaults`, `rich`, `errors`; methods: `expand(s)`, `color(s)`,
  `number(value, field, opts)`). `ConvertCtx` is renamed to `SlideScope`.
- `schema/position.ts` gains `percent(n)`, `px(n)` factories and a
  `ZERO_LENGTH` constant; normalize uses them instead of repeated
  `{ kind: "percent", value: 0 }` literals. Line/arrow default endpoints become
  named constants (`LINE_FROM_DEFAULT`, `LINE_TO_DEFAULT`).
- `GroupElement.vars` is parsed but never applied. Leave the field in place
  (removing it would reject existing decks) but add a comment marking it as
  unimplemented, and note it in the pass report.

## 4. lower (core: `lower/*`)

- Text API: introduce `TextStyle` (`font`, `size`, `align`, `lineHeight`,
  `letterSpacing`; `MirText` structurally satisfies it) in
  `lower/text-shaping.ts`. Signatures become
  `shapeText(text, style, maxWidth, metrics)` and
  `shapeRich(text, style, maxWidth, metrics, rich, color)`.
- `lower/text-style.ts` (created by the design pass) grows into the single
  place that lays out a `MirText`: `resolveRichStyle`,
  `measureTextHeight(el, width, ctx)`, `layoutText(el, box, ctx): Primitive[]`.
  `auto-layout.ts` and `index.ts` call these; the duplicated rich/plain
  dispatch and the 8-argument call sites disappear.
- Split `lower/index.ts` (600 lines) by element family:
  - `lower/index.ts`: `lower()`, `lowerElement`, `placeElement` dispatch,
    `placeAtBox` / `applyCrossPosition`.
  - `lower/figures.ts`: rect / circle / line / arrow / path emission,
    `lineEndpoints(el, box)` shared by line and arrow, `emitFigureLabel`,
    `makeStroke`.
  - `lower/lists.ts`: `placeList` together with `listGutter`,
    `listMarkerGap`, `listContentBox`, `listHeight` (currently split between
    `index.ts` and `auto-layout.ts` with a "keep in sync" comment).
  - `lower/rich-emit.ts`: `emitRich`, `decoLine`.
  - `lower/images.ts`: `imageBox`, `fitImage`, `axisSize`.
- `stackedHeight` / `childIntrinsic` stay in `auto-layout.ts` but use the list
  and text modules above.

## 5. render (core: `render/*`)

- `render/pdf/fonts.ts`: `readPostscriptName` re-opens the font with fontkit.
  Expose `postscriptName` on `FkFont` (`lower/fontkit-metrics.ts`) and reuse
  `createFkFont`.
- `render/pdf/index.ts` and `renderSlideSvg` use `lowerAllSlides` /
  `usedFonts` from section 2.
- `render/svg/primitives.ts` and `render/pdf/primitives.ts` both define
  `ITALIC_SKEW`; move it to `render/italic.ts` (or `ir/lir.ts` as a documented
  constant) and import it from both.

## 6. web state (web: `app/store.svelte.ts`)

The 770-line store mixes six concerns. Split into `app/state/` modules with a
strict dependency order (no cycles):

1. `project.svelte.ts`: `booting`, `ready`, `serverMode`, `currentProject`,
   the VFS instance (`vfs()` accessor), `boot`, `openProject`, `createProject`,
   `createFromTemplate`, `deleteProject`, project registry wrappers.
2. `files.svelte.ts`: `files`, `expanded`, `showHidden`, tree state setters,
   file operations (create / rename / move / delete / duplicate / download /
   upload / zip). Depends on project.
3. `document.svelte.ts`: `openPath`, `yamlText`, `dirty`, `slideRanges`,
   `currentSlide`, `editorCursorTarget`, `openFile`, `save`, `setYaml`,
   `goSlide`, `next`, `prev`, `cursorMoved`. Exposes
   `onYamlChanged(listener)` so that compile can react without document
   importing compile. Depends on project and files.
4. `compile.svelte.ts`: `compiled`, `errors`, cached ctx / fonts,
   `fullCompile`, `liveRecompile`, `renderSvg`, `slideCount`, `slideAspect`,
   `brokenRefs`. Subscribes to document changes and VFS events. Depends on
   document.
5. `github.svelte.ts`: login / remote / sync status / warning and the
   connect / link / pull / push operations. Depends on document (save before
   sync) and compile (reload after pull).

`app/store.svelte.ts` remains as a thin facade that re-exports the same
`store` surface the components use today, so `.svelte` files need no change in
this pass. `anyMissingImage` uses `walkElements` from core. `vfs/events.ts`
(a pure re-export of core's `EventBus`) is deleted; import from core directly.

## 7. cli and web VFS (cli: `server.ts`, `disk-vfs.ts`, `watch.ts`; web: `vfs/*`)

- `server.ts`: replace the `if` chain in `handleApi` with a route table keyed
  by `method + path`; factor `readJsonBody(req)` out of the three JSON handlers.
- `disk-vfs.ts` / `watch.ts`: both convert disk paths to VFS paths; share a
  `toVfsPath(root, abs)` helper and a `fileEntryOf(path, stat)` builder so
  `list` and `stat` build `FileEntry` the same way.
- `web/vfs/http.ts` and `indexeddb.ts`: share the ZIP import/export loop
  (`exportEntries(vfs)` / `importEntries(vfs, entries, targetDir)`) in
  `vfs/zip.ts` instead of two copies.
