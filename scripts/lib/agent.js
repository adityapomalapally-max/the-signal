/**
 * The User-Agent every script sends. One definition, because a bare token is
 * not merely impolite — it gets the request refused.
 *
 * ESPN sits behind Akamai, and Akamai 403s a short opaque UA. "TheSignal/1.0"
 * was blocked; the identical request with a contact URL appended returns 200.
 * The news feed had been failing that way for long enough that nobody could
 * remember it working, and because the failure was caught and logged rather
 * than raised, every run reported success with newsArticleCount: 0.
 *
 * Counterintuitively, a browser UA is worse than an honest one: Akamai checks
 * the UA against the TLS fingerprint, so claiming to be Chrome from Node's
 * stack is a stronger bot signal than saying what you are and where to
 * complain. If a source starts refusing us, say who we are more clearly —
 * never pretend to be a browser.
 */
const USER_AGENT = 'TheSignal/1.0 (+https://github.com/adityapomalapally-max/the-signal)';

module.exports = { USER_AGENT };
