/**
 * Regenerates every launcher asset from the one source drawing.
 *
 *   node scripts/build-icons.mjs
 *
 * Run manually, review the images, commit the output — the same rule as
 * build-breeds.ts, and for the same reason: a build step that silently
 * regenerates the app icon is a build step that will one day silently ship a
 * different one.
 *
 * WHY THERE IS A SCRIPT AT ALL, RATHER THAN SIX EXPORTED FILES
 * The source is a rounded tile floating on a white page, and every platform
 * wants something different from it: iOS wants it square, opaque and bled to
 * the edges because it draws its own corners; Android wants the gradient and
 * the mark on two separate layers, plus a third flat one for themed icons,
 * each sized against a crop that throws away the outer quarter. Deriving all
 * of that from one file means the six can never drift apart, and it records
 * the geometry — which is the part that is easy to get wrong by eye.
 *
 * Requires jimp-compact, which Expo already brings in.
 */
import Jimp from 'jimp-compact';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'assets', 'source', 'pawtrack-logo.jpg');
const OUT = path.join(HERE, '..', 'assets');

// The supplied artwork is a rounded-corner tile floating on a white page.
// Every platform draws its own mask, so the tile has to be un-rounded and
// bled to the edges or the icon ends up with a rounded square inside a
// rounded square.
const R = { x: 177, y: 177, s: 670 };

(async () => {
  const src = await Jimp.read(SRC);
  const W = src.bitmap.width, H = src.bitmap.height, b = src.bitmap.data;
  const at = (x, y) => (y * W + x) * 4;
  const nearWhite = (x, y) => { const i = at(x, y); return b[i] >= 215 && b[i+1] >= 215 && b[i+2] >= 215; };

  /* 1. Flood the page white in from the border. What survives is the tile. */
  const outside = new Uint8Array(W * H);
  {
    const st = [];
    for (let x = 0; x < W; x++) st.push(x, 0, x, H - 1);
    for (let y = 0; y < H; y++) st.push(0, y, W - 1, y);
    while (st.length) {
      const y = st.pop(), x = st.pop();
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const k = y * W + x;
      if (outside[k] || !nearWhite(x, y)) continue;
      outside[k] = 1;
      st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }

  /* 2. The paw: white pixels the flood could not reach. */
  const paw = new Uint8Array(W * H);
  for (let y = R.y; y < R.y + R.s; y++)
    for (let x = R.x; x < R.x + R.s; x++) {
      const k = y * W + x;
      if (!outside[k] && nearWhite(x, y)) paw[k] = 1;
    }

  /* 3. The mark = the paw plus the trace drawn across its pad.

        The trace is blue, so it is not in `paw`. Two obvious recoveries both
        fail. It is NOT an enclosed hole — the line runs out through the pad's
        outline at both ends, so a flood of the tile background pours straight
        into it. And a morphological CLOSE of the paw does not work either: a
        kernel wide enough to bridge the stroke is also wide enough to bridge
        the gaps between the toes, and the paw comes back webbed.

        What does work is an OPENING of the BACKGROUND. The trace is a thin
        tendril hanging off a large region; erode the background and the
        tendril disappears while the region survives, then dilate the region
        back to its old outline. Whatever the background lost is the trace.

        The radius was measured, not guessed. Sweeping it and counting the
        connected components of the result: below 9 the trace comes back in
        pieces, from 9 to 12 it is whole and the paw still has its five parts,
        and at 14 the toe gaps go too and the five collapse into one. 10 sits
        in the middle of that window. */
  const dilate = (m, r) => {
    const t = new Uint8Array(W * H), o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) { const nx = x + d; if (nx >= 0 && nx < W && m[y * W + nx]) v = 1; }
      t[y * W + x] = v;
    }
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = 0;
      for (let d = -r; d <= r && !v; d++) { const ny = y + d; if (ny >= 0 && ny < H && t[ny * W + x]) v = 1; }
      o[y * W + x] = v;
    }
    return o;
  };
  const erode = (m, r) => {
    const inv = new Uint8Array(W * H);
    for (let i = 0; i < inv.length; i++) inv[i] = m[i] ? 0 : 1;
    const d = dilate(inv, r), o = new Uint8Array(W * H);
    for (let i = 0; i < o.length; i++) o[i] = d[i] ? 0 : 1;
    return o;
  };

  const tileBg = new Uint8Array(W * H);
  {
    const st = [];
    for (let x = R.x; x < R.x + R.s; x++) st.push(x, R.y, x, R.y + R.s - 1);
    for (let y = R.y; y < R.y + R.s; y++) st.push(R.x, y, R.x + R.s - 1, y);
    while (st.length) {
      const y = st.pop(), x = st.pop();
      if (x < R.x || y < R.y || x >= R.x + R.s || y >= R.y + R.s) continue;
      const k = y * W + x;
      if (tileBg[k] || paw[k]) continue;
      tileBg[k] = 1;
      st.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
    }
  }
  const OR = 10;
  const bgOpened = dilate(erode(tileBg, OR), OR);
  const solid = new Uint8Array(W * H);
  for (let y = R.y; y < R.y + R.s; y++)
    for (let x = R.x; x < R.x + R.s; x++) {
      const k = y * W + x;
      if (outside[k]) continue;
      if (paw[k] || !tileBg[k] || !bgOpened[k]) solid[k] = 1;
    }

  /* The guard rail, kept in the build rather than in a comment: if a future
     source drawing changes the proportions, this is what catches it. */
  const components = (m) => {
    const seen = new Uint8Array(W * H);
    let n = 0;
    for (let y = R.y; y < R.y + R.s; y++) for (let x = R.x; x < R.x + R.s; x++) {
      const k0 = y * W + x;
      if (!m[k0] || seen[k0]) continue;
      n++;
      const st = [x, y];
      while (st.length) {
        const yy = st.pop(), xx = st.pop();
        if (xx < R.x || yy < R.y || xx >= R.x + R.s || yy >= R.y + R.s) continue;
        const k = yy * W + xx;
        if (seen[k] || !m[k]) continue;
        seen[k] = 1;
        st.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1);
      }
    }
    return n;
  };
  const parts = components(solid);
  let pawPx = 0, markPx = 0;
  for (let i = 0; i < solid.length; i++) { if (paw[i]) pawPx++; if (solid[i]) markPx++; }
  console.log(`paw ${pawPx}px · mark ${markPx}px · trace ${markPx - pawPx}px · ${parts} parts`);
  if (parts !== 5) throw new Error(`expected 5 parts (four toes + pad), got ${parts} — the toes have webbed together, lower OR`);
  if (markPx - pawPx < 9000) throw new Error(`trace only ${markPx - pawPx}px — it has come back in pieces, raise OR`);

  const bbox = (m) => {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    return { x0, y0, x1, y1, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  };
  const solidBox = bbox(solid);
  console.log('mark bbox', solidBox);

  /* ---------- A. The gradient ground ---------------------------------- */
  // Read one flat colour per source row, then paint every output from those.
  //
  // The first version cropped the tile and resized it, and that was wrong
  // twice over. The source is a JPEG, so its "flat" gradient is not flat —
  // every row carries compression noise. And bicubic UPscaling adds its own:
  // resampling a horizontally-uniform row does not give a uniform row back,
  // it gives one with a few hundred values in it. Both show as faint banding,
  // and together they left the PNG nothing to compress: 1.5MB for one icon.
  const rowColors = [];
  {
    let last = null;
    for (let ty = 0; ty < R.s; ty++) {
      const sy = R.y + ty;
      // Walk in from the left past the page white, then a further 14px past
      // the anti-aliased fringe. Sampling any closer to the rounded edge picks
      // up a pixel still half-blended with the page, and the filled corner
      // comes out visibly muddier than the edge it is meant to continue.
      let sx = R.x;
      while (sx < R.x + R.s && (outside[sy * W + sx] || b[at(sx, sy)] > 200)) sx++;
      sx += 14;
      if (sx < R.x + R.s - 2 && !paw[sy * W + sx]) {
        const i = at(sx, sy);
        last = { r: b[i], g: b[i + 1], b: b[i + 2] };
      }
      rowColors.push(last ?? { r: 90, g: 150, b: 204 });
    }
    // The first rows sit above the tile's flat top edge and have no colour of
    // their own; back-fill them from the first row that did.
    for (let ty = 0; ty < R.s && rowColors[ty] === null; ty++) rowColors[ty] = rowColors.find(Boolean);
  }
  const gradient = (n) => {
    const img = new Jimp(n, n, 0xffffffff);
    for (let y = 0; y < n; y++) {
      const t = (y * (R.s - 1)) / (n - 1);
      const i0 = Math.floor(t), i1 = Math.min(R.s - 1, i0 + 1), f = t - i0;
      const a0 = rowColors[i0], a1 = rowColors[i1];
      const col = Jimp.rgbaToInt(
        Math.round(a0.r + (a1.r - a0.r) * f),
        Math.round(a0.g + (a1.g - a0.g) * f),
        Math.round(a0.b + (a1.b - a0.b) * f),
        255,
      );
      for (let x = 0; x < n; x++) img.setPixelColor(col, x, y);
    }
    return img;
  };

  /* ---------- C. The mark on transparency ---------------------------- */
  // Source colour, silhouette alpha: the white paw and the blue trace keep
  // the anti-aliasing they were drawn with.
  const markW = solidBox.w, markH = solidBox.h;
  //
  // The transparent pixels keep the SOURCE colour rather than being left at
  // zero. Resizing treats colour and alpha as separate channels, so a cutout
  // whose transparent pixels are black bleeds black into the edge on the way
  // down and the mark lands with a dark halo around it. Carrying the tile's
  // own gradient in the invisible pixels makes that bleed a no-op.
  const mark = new Jimp(markW, markH, 0x00000000);
  for (let y = 0; y < markH; y++) for (let x = 0; x < markW; x++) {
    const sx = solidBox.x0 + x, sy = solidBox.y0 + y;
    const i = at(sx, sy);
    mark.setPixelColor(
      Jimp.rgbaToInt(b[i], b[i + 1], b[i + 2], solid[sy * W + sx] ? 255 : 0),
      x, y,
    );
  }
  /* The launcher tile: gradient ground, mark composited at the size and place
     it occupies in the original drawing. */
  const tileAt = (n) => {
    const k = n / R.s;
    const g = gradient(n);
    const m = mark.clone().resize(Math.round(markW * k), Math.round(markH * k), Jimp.RESIZE_BICUBIC);
    return g.composite(m, Math.round((solidBox.x0 - R.x) * k), Math.round((solidBox.y0 - R.y) * k));
  };
  // These are written RGBA, fully opaque, NOT as 24-bit PNGs.
  //
  // App Store Connect does reject an app icon carrying an alpha channel — but
  // the icon it inspects is the one Expo generates into the asset catalogue at
  // prebuild, and Expo flattens transparency out on the way. This file is the
  // source, not the submission. jimp-compact's own rgba(false) was tried and
  // writes a corrupt PNG: the header says three channels, the data is still
  // four, and the image decodes as diagonal stripes. Fully opaque RGBA is both
  // correct here and the only thing this encoder gets right.
  await tileAt(1024).writeAsync(path.join(OUT, 'icon.png'));
  await tileAt(1024).resize(48, 48, Jimp.RESIZE_BICUBIC)
    .writeAsync(path.join(OUT, 'favicon.png'));
  await gradient(512).writeAsync(path.join(OUT, 'android-icon-background.png'));

  /* Adaptive foreground. Android throws away the outer quarter of this canvas
     and then masks what is left to whatever shape the launcher uses, so only
     the middle 66.7% is reliably visible. Sizing the mark against the CANVAS
     is the mistake to avoid — it has to be sized against that visible window.
     In the iOS tile the paw takes 71% of the artwork, and 0.667 x 0.71 = 0.47
     of the canvas reproduces exactly that proportion inside the crop. */
  const FG = 512, FG_MARK = Math.round(FG * 0.47);
  const fgMark = mark.clone().resize(FG_MARK, Jimp.AUTO, Jimp.RESIZE_BICUBIC);
  const fg = new Jimp(FG, FG, 0x00000000);
  fg.composite(fgMark, Math.round((FG - fgMark.bitmap.width) / 2),
                       Math.round((FG - fgMark.bitmap.height) / 2));
  await fg.writeAsync(path.join(OUT, 'android-icon-foreground.png'));

  /* ---------- D. Themed (monochrome) layer --------------------------- */
  // Deliberately a SOLID paw: Android tints this one flat colour, so the
  // waveform can only survive as a knock-out, and a knock-out one pixel wide
  // at 48dp reads as a smudge across the pad rather than as a trace.
  const MONO = 432, MONO_MARK = Math.round(MONO * 0.47); // same crop, same maths
  // A 3px close first. Where the trace leaves the pad the two masks meet along
  // a one-pixel seam, which is invisible in colour but shows as a hairline
  // scratch once everything is flattened to a single tone. Far below the 14px
  // radius that would start webbing the toes.
  const monoMask = erode(dilate(solid, 3), 3);
  const monoSrc = new Jimp(markW, markH, 0x00000000);
  for (let y = 0; y < markH; y++) for (let x = 0; x < markW; x++) {
    const sx = solidBox.x0 + x, sy = solidBox.y0 + y;
    if (monoMask[sy * W + sx] || solid[sy * W + sx]) monoSrc.setPixelColor(Jimp.rgbaToInt(0, 0, 0, 255), x, y);
  }
  const monoMark = monoSrc.resize(MONO_MARK, Jimp.AUTO, Jimp.RESIZE_BICUBIC);
  const mono = new Jimp(MONO, MONO, 0x00000000);
  mono.composite(monoMark, Math.round((MONO - monoMark.bitmap.width) / 2),
                           Math.round((MONO - monoMark.bitmap.height) / 2));
  await mono.writeAsync(path.join(OUT, 'android-icon-monochrome.png'));

  /* ---------- E. Splash ---------------------------------------------- */
  const SP = 1024, SP_MARK = Math.round(SP * 0.55);
  const spMark = mark.clone().resize(SP_MARK, Jimp.AUTO, Jimp.RESIZE_BICUBIC);
  const splash = new Jimp(SP, SP, 0x00000000);
  splash.composite(spMark, Math.round((SP - spMark.bitmap.width) / 2),
                           Math.round((SP - spMark.bitmap.height) / 2));
  await splash.writeAsync(path.join(OUT, 'splash-icon.png'));

  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
