# NextKey — the mark

A keyhole held inside a hexagon. A secret, inside a protocol.

The hexagon is deliberately generic geometry, not a reference to anyone. See
**Sponsor logos** at the bottom for why that distinction matters.

## Files

| File | Use |
|---|---|
| `logo.svg` | The mark, drawn in `currentColor`. **Use this on the site** — it turns light on a dark page with no second file |
| `logo-color.svg` · `logo-light.svg` | Fixed colour, for contexts that cannot inherit: a slide, an email signature, someone else's CMS |
| `logo-small.svg` | Redrawn heavier for sizes under about 24px. Small is not the same drawing scaled down |
| `logo-lockup.svg` | Mark plus wordmark, 240×64 |
| `icon-tile.svg` · `icon-maskable.svg` | Sources for the app icons |
| `favicon.svg` · `favicon.ico` | Browser tab. The `.ico` carries 16, 32 and 48px |
| `apple-touch-icon.png` | 180×180, iOS home screen |
| `icon-192.png` · `icon-512.png` | PWA / Android |
| `icon-maskable-512.png` | Android crops icons to whatever shape the launcher prefers; the mark sits inside the 80% safe circle and the colour runs full bleed |
| `logo-512.png` · `logo-128.png` | Transparent raster, for anywhere SVG is not accepted |
| `og-image.png` | 1200×630 social card |
| `site.webmanifest` | Installable-app metadata |

## Rules that actually matter

**Clear space** — at least the height of the hexagon's flat side on every edge.

**Minimum size** — 16px for `favicon.svg`, 24px for `logo.svg`. Below 24 the
keyhole closes up in the light weight, which is why `logo-small.svg` exists.

**Colour** — `#9a5218` on light, `#e2954a` on dark, or plain `currentColor`.
One accent, reserved for the mark and the primary action. Never a gradient:
the mark has to survive one colour, one ink, and a laser printer.

**Do not** stretch it, rotate it, add a shadow, outline the outline, or set the
wordmark in another face. If it needs an effect to work, the drawing is wrong.

## Regenerating

The SVGs are generated, not hand-edited — geometry lives in one place so the
tile, the favicon and the bare mark cannot drift apart. Raster files are
rendered from those SVGs with a headless browser, so what ships is exactly what
a browser draws.

## Sponsor logos

**The NextKey mark does not incorporate anything from Chainlink, ENS or World,
and it must not.** All three publish brand guidelines forbidding their marks
from being altered, combined, or built into someone else's logo, and a mark
assembled from three other marks would say "downstream of three companies"
rather than "NextKey" in any case.

The correct way to show the relationship is a **"Built with" row using each
sponsor's own official logo, unmodified, at their stated minimum size and clear
space, downloaded from their own brand pages** — kept visually separate from the
NextKey mark so it reads as attribution and never as endorsement.
