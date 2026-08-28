/**
 * Where this site lives. One host, one place.
 *
 * IT WAS IN SIX, AND THE COMMENT BESIDE ONE OF THEM SAID THREE. The build
 * scripts each held their own copy, assets/app-feeds.js held SITE_ORIGIN for
 * the runtime canonical, assets/app-export.js painted the host onto every
 * exported chart as a bare string literal, and index.html's head carried it
 * seven times by hand. Nothing compared them, so a domain move was six edits
 * that had to all be remembered, and the failure when one was missed is the
 * quiet kind this repo keeps writing rules about: the site still renders, and
 * some fraction of its canonical tags point at a host that is not the site.
 *
 * THE NODE SIDE READS THIS FILE. The browser side cannot — the assets are
 * classic scripts with no module system — so app-core.js declares SITE_ORIGIN
 * and index.html's head is written by hand, and `tests/site-origin.test.js`
 * asserts all of them agree. A copy that cannot be eliminated can at least be
 * made unable to drift silently.
 *
 * MOVING DOMAIN: change ORIGIN here, change SITE_ORIGIN in assets/app-core.js,
 * change the seven references in index.html's head, then re-run
 * build-page-shells.js, build-sitemap.js and build-og-image.js. The test tells
 * you if you missed one. Point the old host at the new one with a 301 and keep
 * it alive — links to this site are the whole reason it has a sitemap.
 */

const ORIGIN = 'https://the-signal-gamma.vercel.app';

// The bare host, for the places that show it to a reader rather than link it —
// the footer of an exported chart, the social card.
const HOST = ORIGIN.replace(/^https?:\/\//, '');

module.exports = { ORIGIN, HOST };
