// Renders every PNG icon from branding/logo-mark.svg, so the icons never drift from the mark.
// Usage: pnpm --filter @gier/web icons
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const path = (p) => root + p;

const mark = await readFile(path('branding/logo-mark.svg'), 'utf8');
// Full-bleed variant for platforms that apply their own mask (Android maskable, iOS touch icon).
const square = mark.replace(/<rect([^>]*?) rx="\d+"/, '<rect$1');

const render = (svg, size) =>
  sharp(Buffer.from(svg), { density: (72 * size) / 512 })
    .resize(size, size)
    .png();

const outputs = [
  [mark, 1024, 'branding/logo-mark-1024.png'],
  [mark, 512, 'branding/icons/icon-512.png'],
  [mark, 192, 'branding/icons/icon-192.png'],
  [mark, 180, 'branding/icons/icon-180.png'],
  [mark, 64, 'branding/icons/icon-64.png'],
  [mark, 32, 'branding/icons/icon-32.png'],
  [mark, 512, 'apps/web/public/icon-512.png'],
  [mark, 192, 'apps/web/public/icon-192.png'],
  [mark, 64, 'apps/web/public/icon-64.png'],
];
for (const [svg, size, file] of outputs) await render(svg, size).toFile(path(file));

// Opaque: iOS and maskable icons must not have transparent pixels.
await render(square, 512)
  .flatten()
  .removeAlpha()
  .toFile(path('apps/web/public/icon-512-maskable.png'));
await render(square, 180)
  .flatten()
  .removeAlpha()
  .toFile(path('apps/web/public/apple-touch-icon.png'));

// The social preview's text needs its web fonts, so only its mark (the first group: 168 px at 96,64)
// is re-rendered onto the existing PNG.
const social = await readFile(path('branding/social-preview.svg'), 'utf8');
const group = social.match(/<g transform="translate\(96 64\)">([\s\S]*?)<\/g>/)[1];
const socialMark = `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="168"><rect width="168" height="168" fill="#F5F2EA"/>${group}</svg>`;
const preview = path('branding/social-preview.png');
const patched = await sharp(preview)
  .composite([{ input: await sharp(Buffer.from(socialMark)).png().toBuffer(), left: 96, top: 64 }])
  .toBuffer();
await sharp(patched).toFile(preview);

console.log(`Rendered ${outputs.length + 3} icons`);
