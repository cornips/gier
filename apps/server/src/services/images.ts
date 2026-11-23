import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { extractOffer } from '@gier/core';
import type { Ctx } from '../context';
import type { SearchHit } from './search';

const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2);

/**
 * A reference picture for "is this the product?": a search thumbnail of a hit that resembles the name,
 * else the product image of the best hit's page. Never uses Browser Run, it only costs one page fetch.
 */
export async function referenceImage(
  ctx: Ctx,
  name: string,
  hits: SearchHit[],
): Promise<{ imageUrl: string; source: string } | null> {
  const wanted = words(name);
  const score = (h: SearchHit) => {
    const title = new Set(words(h.title));
    return wanted.filter((w) => title.has(w)).length / Math.max(1, wanted.length);
  };
  const ranked = [...hits].sort((a, b) => score(b) - score(a)).slice(0, 5);
  const withThumb = ranked.find((h) => h.image && score(h) >= 0.5);
  if (withThumb?.image) return { imageUrl: withThumb.image, source: withThumb.url };
  for (const h of ranked.slice(0, 2)) {
    const res = await Promise.race([
      ctx.fetcher.get(h.url),
      new Promise<null>((r) => setTimeout(() => r(null), 6000)),
    ]).catch(() => null);
    if (!res?.ok || !res.html) continue;
    const image = extractOffer(res.html, res.url).image;
    if (image) return { imageUrl: new URL(image, res.url).toString(), source: h.url };
  }
  return null;
}

const PRIVATE = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/,
  /^f[cd]/i,
  /^fe80/i,
  /^::ffff:(127|10|192\.168)\./i,
];

/** Images come from shop pages, so the proxy refuses anything that points into the local network. */
export async function isPublicUrl(raw: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (url.port && !['80', '443'].includes(url.port))
  )
    return false;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
  const addresses = isIP(host)
    ? [host]
    : await lookup(host, { all: true })
        .then((r) => r.map((a) => a.address))
        .catch(() => []);
  return addresses.length > 0 && addresses.every((a) => !PRIVATE.some((re) => re.test(a)));
}

const MAX_BYTES = 3 * 1024 * 1024;

/**
 * Fetches an image for the web app, so the browser never contacts shops directly (privacy, and no
 * hotlink blocks). Only images, max 3 MB.
 */
export async function proxyImage(ctx: Ctx, raw: string): Promise<Response> {
  let url = raw;
  let res: Response | null = null;
  // Follow at most three redirects by hand, checking every hop.
  for (let hop = 0; hop < 4; hop += 1) {
    if (!(await isPublicUrl(url))) return new Response('forbidden', { status: 403 });
    res = await ctx
      .http(url, {
        headers: { accept: 'image/avif,image/webp,image/*', 'user-agent': ctx.env.USER_AGENT },
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      })
      .catch(() => null);
    const next = res && res.status >= 300 && res.status < 400 && res.headers.get('location');
    if (!next) break;
    url = new URL(next, url).toString();
    res = null;
  }
  const type = res?.headers.get('content-type') ?? '';
  if (!res?.ok || !type.startsWith('image/') || type.includes('svg'))
    return new Response('not_found', { status: 404 });
  const body = await res.arrayBuffer();
  if (body.byteLength > MAX_BYTES) return new Response('too_large', { status: 413 });
  return new Response(body, {
    headers: {
      'content-type': type,
      'cache-control': 'private, max-age=604800, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}
