# Desktop build branding

English | [中文](README.zh.md)

## Build

Copy [example.json](example.json), replace its names and images, then set `DSH_BRAND_CONFIG` to its path relative to the repository root. GitHub's desktop and Kylin workflows expose the same path as `brand_config`. An empty path selects [default.json](default.json).

```powershell
$env:DSH_BRAND_CONFIG = 'products/wanwei-desktop/branding/example.json'
pnpm --dir products/wanwei-desktop run build:runner
```

Release bundling still requires its existing GitHub runner, signing and version configuration. Local `dev` and `build:local` use the same manifest. Run one complete product build at a time per checkout; generated compiler outputs are shared. Do not reuse another brand's staged runtime. The Web build restores generated source templates even on failure, removes staged public assets, and leaves the selected compiled artifacts ready for runtime packaging. Rebuild without the variable to return compiled outputs to Wanwei.

## Configuration

Custom brands explicitly set all names, copyright strings and the session-log filename prefix shown in the example. `text` maps exact product-owned source sentences to replacements, including legal/support prose and loading/error copy; it never rewrites user messages, third-party authors or backend content. Chinese and English copyright have separate fields. Protocol names, application identifiers, user-data directories, executable names and update product/signing identities remain stable; this is rebranding an existing installation, not creating a parallel application.

Image paths are relative to the manifest. `assets.mark` and `assets.wordmark` supply the default icon and an optional complete logo. Without a complete logo, the build combines the icon with `logoText`, which defaults to the product name. Optional `sidebar`, `home`, `login`, `loading`, `avatar`, `credits`, `version`, `update`, `knowledge` and `favicon` override individual positions. Web images accept SVG, PNG or WebP. Use transparent, tightly cropped images; wordmarks should be horizontal. `native.icon` requires a square PNG and generates ICO, ICNS and PNG bundle icons. `native.windowIcon` and `native.trayIcon` optionally supply independent PNGs. A custom brand requires a default icon. A square PNG also supplies the native icon unless overridden; missing files and unknown fields fail the build.

The generated `.brand-build/receipt.json` records asset hashes. Packaging verifies compiled brand snapshots and staged asset bytes against the selected manifest. Test with `pnpm --dir products/wanwei-desktop run check:branding`. Windows/macOS/Kylin installed-package acceptance remains necessary. Certificate publisher identities require the corresponding certificate. Independent expert websites and backend-managed content are outside this desktop manifest. CI artifact labels and GitHub release metadata retain their existing pipeline naming.

Set `logoTextColor` to a six-digit hex color such as `"#146B63"` to color the composed lettering. The default is `"#0865F2"`. The supplied icon determines its own colors.

Set logoTextImage to an SVG, PNG or WebP containing only lettering. The build places it beside ssets.mark and preserves its proportions and colors. Use a tightly cropped transparent image. The build prefers a complete ssets.wordmark, then the lettering image, then generated lettering.
