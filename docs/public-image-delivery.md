# Public catalog image delivery

`GET /api/public/image?path=menu_images/example.png&edge=384&mode=photo`

The image endpoint accepts only the configured Supabase project's public `menu_images/` and `stories/` object paths. It does not accept arbitrary source URLs, private buckets, path traversal or redirects. Supported maximum edges are 256, 384, 512, 768, 1024 and 1536 pixels. Aspect ratio is preserved and small originals are never enlarged.

## Encoding and compatibility

- No `mode`, or `mode=lossless`: the existing lossless WebP behavior, disk keys and ETags remain unchanged.
- `mode=photo`: WebP quality 95, alpha quality 100, effort 4. This is a high-quality **lossy** photographic rendition; it is not pixel-identical to the source. Resized alpha values remain lossless.
- Other mode values, including duplicate or structured query values, return HTTP 400 before fetching an original.
- Lossless mode can retain a smaller original WebP only when it already fits within the requested dimensions. Photo mode retains an already-sized, metadata-free lossy WebP byte-for-byte after complete pixel decoding; this avoids an unnecessary second lossy encode of an uploaded master. Lossless WebP sources still receive photo compression. Source objects are never modified.

## Automatic photo uploads

Photographic delivery is an explicit Flutter opt-in for product/category photos and their catalog prefetches, cart, purchase and staff thumbnails. Shared image rendering stays lossless by default, including product stickers, tier artwork, avatars and story/promotional artwork. Storage bucket membership alone never selects lossy delivery.

Product and category photos submitted to `/admin/api/menu/upload-photo`, and photos from older/native clients submitted to `/admin/api/menu/upload-image`, are optimized automatically on the server. JPEG, PNG and WebP uploads are decoded, auto-oriented and bounded to a 1600-pixel longest edge without upscaling. The server creates a WebP quality-95 master with lossless alpha directly from the upload, with no intermediate quality-82 encoding. A clean lossy WebP that already fits is fully decoded for validation and retained without another lossy generation. EXIF, orientation, ICC, XMP and other metadata/unknown chunks prevent this retention path and are stripped by re-encoding.

Filename extension and Storage content type are both WebP. Objects remain immutable (`upsert:false`, one-year Storage cache), with metadata recording purpose, encoding, pixel dimensions and source/stored byte counts. This preserves the existing single sanitized-object contract: the server did not previously archive the untouched camera original and does not add another stored copy. Existing image objects remain unchanged and receive lightweight `mode=photo` delivery automatically when requested by the catalog client.

The menu's server-side product/category binding and success/event ordering remain unchanged. A failed encode or Storage write cannot update the photo binding. Uploads are still limited to one file, 5 MiB and 32 million input pixels; animation, corrupt payloads and MIME confusion are rejected. Oversized multipart files return HTTP 413.

`/admin/api/menu/upload-image` also serves the sticker editor, which sends the explicitly validated `purpose=sticker` field to retain its existing image policy (including lossless PNG). An omitted purpose or `purpose=photo` selects automatic photo optimization. Loyalty-tier images, avatars, support attachments, reference images, QR codes and documents retain their existing processing. The photographic master is high-quality lossy WebP; it does not claim pixel-exact preservation of source color values.

Photo disk keys contain a `photo-v1` version and its ETags include that mode identity. The two modes cannot share a disk entry or satisfy each other's conditional GET, even if both retain identical original WebP bytes. Encoding-policy changes must version the photo key. An unchanged client URL can keep its browser-cached rendition for its advertised lifetime.

Disk cache lifetime remains seven days, with a 512 MiB cleanup budget shared by both modes. HTTP caching remains `public, max-age=86400, stale-while-revalidate=604800`, with ETag/304 support. Errors have no successful-image caching policy. Existing clients can use lossless mode throughout a rolling deployment; clients opting into photo retain their original-image fallback if an older server rejects the new parameter.

## Request and conversion limits

Image GET/HEAD requests have an independent per-IP limit of **300 per minute**. The public catalog measured on 2026-10-04 contained 125 product images: two renditions per image consume 250 requests, leaving 50 for banners, revalidation and other photo views. This is a finite browsing allowance, not a promise that every cold rendition completes concurrently.

Only the exact read route, including Express's case/trailing-slash aliases, bypasses the public 120/minute and global API 300/minute buckets. Writes and similar paths still consume the API quota. The existing site-wide 900/minute flood limit remains in place. Login, OTP, customer and other business limits are unchanged. Image traffic cannot exhaust the business API buckets, but the site-wide flood limit still applies across traffic types.

Cold conversions from both modes share the existing three-worker limit and maximum 32 pending identities. Identical requests share a job. Downloads retain the 15-second timeout, 12 MiB input bound, redirect rejection, 32-million-pixel decode limit and single-frame check. The per-IP image limit does not replace those generation controls.

## Measured evidence, 2026-10-04

Five public photos were sampled without a load test. Three newly uploaded PNGs were 1254×1254; two existing JPEGs were 900×1600. Times below are observations from one client connection, not latency guarantees.

| Sample                         | Original bytes | Lossless 384 px bytes | Photo 384 px bytes | Lossless 512 px bytes | Photo 512 px bytes |
| ------------------------------ | -------------: | --------------------: | -----------------: | --------------------: | -----------------: |
| `menu_1789923730795_0u8ak.png` |      2,147,642 |               183,318 |             48,460 |               320,844 |             83,162 |
| `menu_1789923783002_05rv1.png` |      2,504,027 |               216,238 |             66,660 |               376,762 |            112,894 |
| `menu_1789923765962_31vt6.png` |      2,314,141 |               183,978 |             53,388 |               330,820 |             91,618 |

The PNG originals took 3.27–4.82 seconds to download. Existing lossless 384 px responses took 0.91–1.16 seconds initially and 0.166–0.193 seconds on repeat; a conditional request returned 304 with no body. Local Sharp encoding at 384 px took 160–188 ms for lossless and 36–43 ms for photo mode. The new mode reduces these three 384 px payloads by 69–74% and their 512 px payloads by 70–74%. Photo-mode transfer timing must be verified after deployment; the values here measure encoding and byte size locally.

The two JPEG controls were already small: 60,220/88,529 original bytes and 26,578/36,762 bytes in lossless 384 px renditions. This evidence identifies the new PNG photos as the heavier case; it does not imply that every catalog image is several megabytes.

The automatic upload path was also measured locally against those same three PNG originals. Its stored 1254×1254 masters were 418,572 / 527,922 / 465,218 bytes (136–149 ms encoding); their 384 px photographic thumbnails were 46,966 / 64,150 / 51,168 bytes. Uploading those generated masters again retained identical bytes. Raw measurements are in `upload-master-after.json`.

Quality-preserving format conversion does not guarantee a smaller master for every input. The two already strongly compressed JPEG controls became 93,526 / 138,822-byte WebP95 masters. The policy keeps the explicit high-quality setting instead of progressively lowering quality to hit a byte target; clients still receive the appropriately sized photo rendition. Existing stored JPEG originals are not rewritten by this change.

Regression tests cover both modes' cache identities and ETags, alpha/dimension preservation, malformed mode rejection, unchanged default pixels, coalescing, cold queue bounds, 304 responses and independent image/business/auth rate limits. Raw network and encoding measurements are kept in the task's `outputs/catalog-image-performance-2026-10-04/` artifacts.
