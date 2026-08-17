#!/usr/bin/env node

/**
 * Generates sitemap.xml and robots.txt from the data that is actually on the
 * site, so the map can never claim a page the site does not have.
 *
 * Runs in the daily Action, after the data steps: the pool changes, and a
 * sitemap listing yesterday's players is a list of soft 404s.
 *
 * DRAFT ARTICLES ARE EXCLUDED. Submitting an unfinished page for indexing gets
 * the unfinished version cached and shown; the article enters the sitemap when
 * its status says published, and not before.
 */

const fs = require('fs');
const path = require('path');

// Must match the canonical in index.html and SITE_ORIGIN in assets/app-feeds.js.
const ORIGIN = 'https://the-signal-gamma.vercel.app';

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');

function readJSON(name) {
  const p = path.join(DATA_DIR, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// priority is a hint about relative importance within this site, nothing more.
// changefreq likewise. Both are advisory; the URL list is the part that matters.
function url(loc, { priority = 0.5, changefreq = 'weekly', lastmod } = {}) {
  return { loc, priority, changefreq, lastmod };
}

function build() {
  const players = readJSON('players.json') || [];
  const medicals = readJSON('medicals.json') || {};
  const injuries = readJSON('injuries.json') || {};
  const articles = (readJSON('articles.json') || {}).articles || [];
  const teams = readJSON('teams.json');
  const meta = readJSON('meta.json') || {};

  const today = new Date().toISOString().slice(0, 10);
  // The data pages are only as fresh as the last successful update.
  const dataDate = (meta.lastUpdate || new Date().toISOString()).slice(0, 10);

  const urls = [];

  urls.push(url(`${ORIGIN}/`, { priority: 1.0, changefreq: 'daily', lastmod: dataDate }));

  const sections = {
    players: 0.9, rankings: 0.9, medicals: 0.8, lab: 0.7,
    teams: 0.7, fantasy: 0.8, draft: 0.6, compare: 0.5,
  };
  for (const [slug, priority] of Object.entries(sections)) {
    urls.push(url(`${ORIGIN}/${slug}`, { priority, changefreq: 'daily', lastmod: dataDate }));
  }
  // /film is deliberately absent: it says "coming soon" and there is nothing to
  // index. Put it back the day it has content.

  for (const tab of ['overall', 'qb', 'rb', 'wr', 'te']) {
    urls.push(url(`${ORIGIN}/rankings/${tab}`, { priority: 0.8, changefreq: 'daily', lastmod: dataDate }));
  }

  // One page per player — the deepest content on the site.
  const seen = new Set();
  for (const p of players) {
    if (!p || !p.id || seen.has(p.id)) continue;
    seen.add(p.id);
    urls.push(url(`${ORIGIN}/player/${encodeURIComponent(p.id)}`, {
      priority: 0.7, changefreq: 'weekly', lastmod: dataDate,
    }));
  }

  // A medical page is worth listing when there is something on it: a written
  // profile, or a real injury-report history.
  const poolIds = new Set(players.map(p => p.id));
  const medicalIds = new Set([...Object.keys(medicals), ...Object.keys(injuries)].filter(id => poolIds.has(id)));
  for (const id of medicalIds) {
    urls.push(url(`${ORIGIN}/medicals/${encodeURIComponent(id)}`, {
      priority: 0.6, changefreq: 'weekly', lastmod: dataDate,
    }));
  }

  // teams.teams is keyed by abbreviation, not an array.
  for (const abbr of Object.keys((teams && teams.teams) || {})) {
    urls.push(url(`${ORIGIN}/teams/${abbr.toLowerCase()}`, {
      priority: 0.6, changefreq: 'weekly', lastmod: dataDate,
    }));
  }

  let drafts = 0;
  for (const a of articles) {
    if (!a || !a.slug) continue;
    if (a.status !== 'published') { drafts++; continue; }
    urls.push(url(`${ORIGIN}/article/${a.slug}`, {
      priority: 0.9, changefreq: 'monthly', lastmod: (a.date || today).slice(0, 10),
    }));
  }

  const body = urls.map(u =>
    '  <url>\n'
    + `    <loc>${u.loc}</loc>\n`
    + (u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>\n` : '')
    + `    <changefreq>${u.changefreq}</changefreq>\n`
    + `    <priority>${u.priority.toFixed(1)}</priority>\n`
    + '  </url>'
  ).join('\n');

  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + body + '\n</urlset>\n';

  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), xml);

  const robots = [
    '# The Signal',
    'User-agent: *',
    'Allow: /',
    '',
    '# The JSON behind the site is public, but it is not the site. Keeping it out',
    '# of the index stops raw data files ranking instead of the pages that read them.',
    'Disallow: /data/',
    '',
    `Sitemap: ${ORIGIN}/sitemap.xml`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(ROOT, 'robots.txt'), robots);

  console.log(`[sitemap] wrote sitemap.xml: ${urls.length} URLs`);
  console.log(`[sitemap]   ${seen.size} players, ${medicalIds.size} medical, ${urls.filter(u => u.loc.includes('/article/')).length} articles published (${drafts} drafts held back)`);
  console.log('[sitemap] wrote robots.txt');
}

build();
