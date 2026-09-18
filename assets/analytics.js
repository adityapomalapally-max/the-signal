/**
 * The counting stub.
 *
 * WHY THIS IS A FILE AND NOT TWO LINES IN THE MARKUP. Vercel's own HTML snippet
 * puts the queue in an inline <script>, and this site's CSP is `script-src
 * 'self'` with no 'unsafe-inline' — deliberately, and at a cost: the August
 * audit found a live XSS that was exploitable PRECISELY BECAUSE the policy
 * allowed inline script, and 108 inline handlers had to be rewritten as
 * data-click actions to get rid of it. Pasting a vendor snippet back in would
 * hand that back for a page-view count. Same behaviour, served from our own
 * origin, and the policy does not move. (The JSON-LD block in the head is not
 * an exception: CSP does not govern non-executable script types.)
 *
 * WHAT IT DOES. `window.va` is the call surface — anything wanting to record an
 * event calls it. The real script is deferred, so calls made before it arrives
 * would otherwise be thrown away; they queue on `window.vaq` and the script
 * drains them when it loads. Nothing here sends anything anywhere.
 *
 * WHAT IS NOT COLLECTED. Vercel Web Analytics is cookieless and stores no
 * personal data — no identifiers on the reader's machine, and nothing this file
 * passes it. Custom events are a Pro feature and this site sends none, so what
 * is recorded is the page that was viewed and nothing about who viewed it.
 */
window.va = window.va || function () {
  (window.vaq = window.vaq || []).push(arguments);
};
