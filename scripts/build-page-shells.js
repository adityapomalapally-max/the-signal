#!/usr/bin/env node

/**
 * The Signal — static page shells
 *
 * WHY THIS EXISTS. Social scrapers do not run JavaScript. Twitter, Slack,
 * iMessage and Discord read the HTML exactly as the server sends it, so the
 * per-route title, description and og:image that applyRouteMeta() sets at
 * runtime are invisible to every one of them. Google renders JS and sees them;
 * a link pasted into a group chat does not.
 *
 * The fix is a real file per section, identical to index.html except in the
 * head. vercel.json sets cleanUrls, so players.html is served at /players, and
 * the filesystem is checked before rewrites, so it wins over the catch-all.
 * The router then reads the same path it always did and renders the same page —
 * a shared link and a click still land on identical markup.
 *
 * ONLY SECTIONS. A shell per player would be 350 copies of a 43KB document for
 * a card that says little more than the house one. Deep pages keep the site
 * card and their JS-set title, which is what search engines read anyway.
 *
 * Run: node scripts/build-page-shells.js   (after index.html or the meta change)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'index.html');
const ORIGIN = 'https://the-signal-gamma.vercel.app';

// Must match ROUTE_META in assets/app-feeds.js — the shell is what a scraper
// sees and the runtime meta is what a reader sees, so they have to agree.
const PAGES = {
  players: {
    title: 'Player Database — The Signal',
    description: 'Every fantasy-relevant NFL player: athletic profiles, nflverse production, sourced medical history and current status, updated daily.',
  },
  rankings: {
    title: 'Fantasy Rankings — The Signal',
    description: 'Half-PPR redraft rankings with projection ranges derived from year-over-year volatility, and missed-time risk priced in as a second downside.',
  },
  medicals: {
    title: 'Medical Intelligence — The Signal',
    description: 'Sourced injury histories, official NFL injury-report records, and research-backed return-to-play curves for the players who matter.',
  },
  teams: {
    title: 'Teams — The Signal',
    description: 'Who gets the ball, and how each offense lines up: personnel groupings, the box they draw, coverage faced, and year-over-year identity shifts.',
  },
  lab: {
    title: 'Stats & Charts — The Signal',
    description: 'Positional leaderboards from nflverse and Next Gen Stats. Every board states its qualifier and excludes anyone under it.',
  },
  fantasy: {
    title: 'Value Board — The Signal',
    description: 'Our positional ranks against consensus ADP, compared rank-to-rank so the gaps mean something.',
  },
  draft: {
    title: 'Draft Lab — The Signal',
    description: 'Draft-capital hit rates by round and position — the base rate any prospect model has to beat.',
  },
};

function replaceTag(html, pattern, replacement, label) {
  if (!pattern.test(html)) throw new Error(`index.html no longer contains ${label} — the shell would ship the wrong metadata`);
  return html.replace(pattern, replacement);
}

function main() {
  const src = fs.readFileSync(SRC, 'utf8');
  let written = 0;

  for (const [slug, meta] of Object.entries(PAGES)) {
    const url = `${ORIGIN}/${slug}`;
    const image = `${ORIGIN}/assets/og/${slug}.png`;
    const cardPath = path.join(ROOT, 'assets', 'og', `${slug}.png`);
    if (!fs.existsSync(cardPath)) {
      throw new Error(`assets/og/${slug}.png is missing — run build-og-image.js first`);
    }

    let out = src;
    out = replaceTag(out, /<title>[^<]*<\/title>/, `<title>${meta.title}</title>`, '<title>');
    out = replaceTag(out, /<meta name="description" content="[^"]*">/,
      `<meta name="description" content="${meta.description}">`, 'the description meta');
    out = replaceTag(out, /<link rel="canonical" href="[^"]*">/,
      `<link rel="canonical" href="${url}">`, 'the canonical link');
    out = replaceTag(out, /<meta property="og:url" content="[^"]*">/,
      `<meta property="og:url" content="${url}">`, 'og:url');
    out = replaceTag(out, /<meta property="og:title" content="[^"]*">/,
      `<meta property="og:title" content="${meta.title}">`, 'og:title');
    out = replaceTag(out, /<meta property="og:description" content="[^"]*">/,
      `<meta property="og:description" content="${meta.description}">`, 'og:description');
    out = replaceTag(out, /<meta property="og:image" content="[^"]*">/,
      `<meta property="og:image" content="${image}">`, 'og:image');
    out = replaceTag(out, /<meta name="twitter:title" content="[^"]*">/,
      `<meta name="twitter:title" content="${meta.title}">`, 'twitter:title');
    out = replaceTag(out, /<meta name="twitter:description" content="[^"]*">/,
      `<meta name="twitter:description" content="${meta.description}">`, 'twitter:description');
    out = replaceTag(out, /<meta name="twitter:image" content="[^"]*">/,
      `<meta name="twitter:image" content="${image}">`, 'twitter:image');

    // A marker so nobody mistakes a generated shell for a page to hand-edit.
    out = out.replace('<head>', `<head>\n<!-- GENERATED by scripts/build-page-shells.js from index.html. Do not edit: edit index.html and re-run. -->`);

    fs.writeFileSync(path.join(ROOT, `${slug}.html`), out);
    written++;
  }
  console.log(`[shells] wrote ${written} section shells (served extensionless via cleanUrls)`);
}

main();
