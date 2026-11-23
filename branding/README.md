# Gier brand assets

| File                          | Use                                                                         |
| ----------------------------- | --------------------------------------------------------------------------- |
| `logo-mark.svg`               | App icon / avatar: lime square, dashed orbit, circling bird                 |
| `logo-mark-mono.svg`          | Single-colour mark (`currentColor`) for UI and favicons on dark backgrounds |
| `social-preview.svg` / `.png` | GitHub social preview (1280 × 640)                                          |
| `icons/`                      | Generated PWA icons (`pnpm --filter @gier/web icons`)                       |

## Colours

| Token     | Hex                   | Role                                    |
| --------- | --------------------- | --------------------------------------- |
| Paper     | `#F5F2EA`             | Background                              |
| Ink       | `#16161A`             | Text, primary buttons                   |
| Prey lime | `#C8F169`             | Accent, price drops, deals              |
| Rise      | `#FFE3D3` / `#9A3412` | Price increases, fake-discount warnings |
| Sand      | `#ECE7DB`             | Muted surfaces                          |
| Border    | `#DDD5C4`             | Lines                                   |

Drops and rises also differ in lightness and always carry an arrow, never colour alone.

## Type

- **Bricolage Grotesque** (800) for headings and big prices.
- **Inter** for the interface, with `font-variant-numeric: tabular-nums` for every price.

## Name

_Gier_ is Dutch for vulture, and _gierig_ means stingy. A vulture circles patiently and strikes at the right moment.
