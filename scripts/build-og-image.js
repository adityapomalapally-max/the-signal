#!/usr/bin/env node

/**
 * The Signal — Open Graph card generator
 *
 * Produces og-image.png (1200x630) — the card that renders when a link to
 * the site is posted to Twitter, Discord, iMessage or Slack. The PNG is
 * committed because it has to be served as a static asset, but it is
 * GENERATED here so it is reproducible and the wordmark never drifts from
 * the site's own type.
 *
 * The card is authored in HTML/CSS against the site's own tokens and
 * screenshotted with headless Chrome, rather than drawn with an image
 * library: same fonts, same colours, same wordmark treatment as the header,
 * and it stays editable by anyone who can read CSS.
 *
 * Deliberately typographic, with no chart marks — a marketing card carrying
 * bar shapes reads as a chart making a claim, and the house rule is that a
 * chart shows real data or nothing.
 *
 * Run after a brand change (not in the daily Action, nothing here moves
 * day to day):   node scripts/build-og-image.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'og-image.png');
const W = 1200, H = 630;
const SITE_HOST = 'the-signal-gamma.vercel.app';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium'
];

const card = `<!doctype html>
<html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,700&family=DM+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  :root {
    --bg:#0c0f14; --gold:#c9a84c; --cream:#e8dcc8;
    --text:#e2e0dc; --muted:#8a8780;
    --serif:'Playfair Display',Georgia,serif;
    --sans:'DM Sans',-apple-system,sans-serif;
    --mono:'IBM Plex Mono',Menlo,monospace;
  }
  body { width:${W}px; height:${H}px; background:var(--bg); overflow:hidden; }
  .card { position:relative; width:100%; height:100%; padding:74px 82px 62px;
          display:flex; flex-direction:column; justify-content:space-between; }
  /* Mirrors .hero-bg-pattern on the site — same angle, same low alpha. */
  .pattern { position:absolute; inset:0 0 0 38%; opacity:0.10;
    background:repeating-linear-gradient(-45deg,var(--gold) 0px,var(--gold) 1px,transparent 1px,transparent 22px);
    -webkit-mask-image:linear-gradient(to right,transparent,#000 65%); }
  .rule-top { position:absolute; top:0; left:0; right:0; height:3px; background:var(--gold); opacity:0.6; }
  .eyebrow { font-family:var(--mono); font-size:19px; letter-spacing:6px;
             text-transform:uppercase; color:var(--gold); }
  .mark { display:flex; align-items:baseline; gap:16px; margin-top:26px; }
  .mark .the { font-family:var(--sans); font-size:26px; letter-spacing:9px; color:var(--muted); }
  .mark .name { font-family:var(--serif); font-weight:700; font-size:118px; color:var(--cream); line-height:1; }
  .mark .name em { font-style:italic; color:var(--gold); }
  .tagline { font-family:var(--serif); font-weight:700; font-size:50px; color:var(--text); margin-top:22px; }
  .blurb { font-family:var(--sans); font-size:27px; line-height:1.5; color:var(--muted);
           margin-top:16px; max-width:760px; }
  .foot { position:relative; display:flex; justify-content:space-between; align-items:flex-end;
          border-top:1px solid rgba(255,255,255,0.10); padding-top:22px; }
  .foot .host { font-family:var(--mono); font-size:22px; color:var(--gold); }
  .foot .by { font-family:var(--mono); font-size:20px; color:var(--muted); }
</style></head>
<body><div class="card">
  <div class="pattern"></div><div class="rule-top"></div>
  <div style="position:relative;">
    <div class="eyebrow">NFL Intelligence</div>
    <div class="mark"><span class="the">THE</span><span class="name">Sign<em>al</em></span></div>
    <div class="tagline">Signal over noise.</div>
    <div class="blurb">Injury intelligence, Next Gen tracking data, and projections you can see the working for.</div>
  </div>
  <div class="foot"><span class="host">${SITE_HOST}</span><span class="by">by Adi</span></div>
</div></body></html>`;

function findChrome() {
  return CHROME_CANDIDATES.find(p => fs.existsSync(p)) || null;
}

function main() {
  const chrome = findChrome();
  if (!chrome) {
    console.error('[og] No Chrome/Chromium found — og-image.png left as is.');
    process.exit(1);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-og-'));
  const html = path.join(tmp, 'card.html');
  fs.writeFileSync(html, card);

  try {
    execFileSync(chrome, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--force-device-scale-factor=1',
      `--window-size=${W},${H}`,
      // Webfonts come off the network; give them a beat to arrive so the
      // card never ships in the Georgia fallback by accident.
      '--virtual-time-budget=4000',
      `--screenshot=${OUT}`,
      `file://${html}`
    ], { stdio: 'pipe' });
  } catch (e) {
    console.error(`[og] Chrome failed: ${e.message}`);
    process.exit(1);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  if (!fs.existsSync(OUT)) {
    console.error('[og] Chrome reported success but wrote no file.');
    process.exit(1);
  }
  // A card that is not exactly 1200x630 gets cropped or rejected by the
  // scrapers, so verify rather than assume.
  const buf = fs.readFileSync(OUT);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  if (w !== W || h !== H) {
    console.error(`[og] ABORT: expected ${W}x${H}, got ${w}x${h}.`);
    process.exit(1);
  }
  console.log(`[og] wrote og-image.png (${w}x${h}, ${(buf.length / 1024).toFixed(0)}KB)`);
}

main();
