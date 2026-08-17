/*
 * The Signal — chart export to PNG
 *
 * LOAD ORDER MATTERS. These files are plain classic scripts, concatenated by
 * the browser in the order index.html lists them, and they share one global
 * scope on purpose: the markup carries ~108 inline onclick handlers, and an
 * inline handler can only see globals. Converting these to type="module"
 * would scope every function and silently break every one of those handlers.
 *
 * Split out of index.html without reordering a single statement.
 */

// ===== CHART EXPORT =====
// Charts are redrawn onto a canvas from their own data rather than scraped
// out of the DOM. A screenshot library would drag in a CDN dependency, copy
// the page's UI chrome into the image, and still get fonts wrong — drawing
// from the data gives a properly framed, branded card instead, which is the
// point of exporting at all.
const EXPORT_W = 1200;
const EXPORT_PAD = 64;
const EXPORT_SCALE = 2;              // retina; the file is what gets posted
const EX_BG = '#0c0f14';
const EX_CARD = '#161a23';
const EX_GOLD = '#a8893a';
const EX_GOLD_BRIGHT = '#c9a84c';
const EX_TEAL = '#1ba89b';
const EX_BLUE = '#2a78d6';
const EX_TEXT = '#e2e0dc';
const EX_MUTED = '#8a8780';
const EX_DIM = '#5c5955';
const EX_LINE = 'rgba(255,255,255,0.07)';

const exFont = (spec) => spec
  .replace('$serif', `'Playfair Display', Georgia, serif`)
  .replace('$sans', `'DM Sans', -apple-system, sans-serif`)
  .replace('$mono', `'IBM Plex Mono', Menlo, monospace`);

function exTruncate(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}

// Subtitles are prose, and a scatter's runs long. Cutting it mid-sentence
// with an ellipsis reads as a bug, so wrap to at most two lines.
let exMeasureCtx = null;
function exSubtitleLines(o) {
  if (!o.subtitle) return [];
  if (!exMeasureCtx) exMeasureCtx = document.createElement('canvas').getContext('2d');
  const ctx = exMeasureCtx;
  ctx.font = exFont('400 17px $sans');
  const maxW = EXPORT_W - EXPORT_PAD * 2;
  const words = String(o.subtitle).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    const next = line ? line + ' ' + w : w;
    if (ctx.measureText(next).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length === 2) break;
    } else {
      line = next;
    }
  }
  if (lines.length < 2 && line) lines.push(line);
  if (lines.length === 2) lines[1] = exTruncate(ctx, lines[1], maxW);
  return lines;
}

// Where the plot area starts, derived from the same numbers exDrawFrame
// uses. Kept as one function so the height calculation and the drawing can
// never disagree — they did, and the last row sat on top of the footer.
function exContentTop(o) {
  return EXPORT_PAD + 14 + 46 + exSubtitleLines(o).length * 27 + 34;
}
const EX_FOOTER_SPACE = 118;   // rule + source line + breathing room

// Header + footer chrome, shared by every export so they read as a set.
function exDrawFrame(ctx, o, height) {
  ctx.fillStyle = EX_BG;
  ctx.fillRect(0, 0, EXPORT_W, height);
  ctx.fillStyle = EX_GOLD_BRIGHT;
  ctx.fillRect(0, 0, EXPORT_W, 3);

  let y = EXPORT_PAD + 14;
  ctx.textBaseline = 'alphabetic';
  ctx.font = exFont('500 15px $mono');
  ctx.fillStyle = EX_GOLD_BRIGHT;
  ctx.letterSpacing = '4px';
  ctx.fillText('THE SIGNAL', EXPORT_PAD, y);
  ctx.letterSpacing = '0px';

  y += 46;
  ctx.font = exFont('700 34px $serif');
  ctx.fillStyle = EX_TEXT;
  ctx.fillText(exTruncate(ctx, o.title, EXPORT_W - EXPORT_PAD * 2), EXPORT_PAD, y);

  ctx.font = exFont('400 17px $sans');
  ctx.fillStyle = EX_MUTED;
  exSubtitleLines(o).forEach(line => {
    y += 27;
    ctx.fillText(line, EXPORT_PAD, y);
  });

  const fy = height - EXPORT_PAD;
  ctx.strokeStyle = EX_LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(EXPORT_PAD, fy - 30);
  ctx.lineTo(EXPORT_W - EXPORT_PAD, fy - 30);
  ctx.stroke();
  ctx.font = exFont('400 14px $mono');
  ctx.fillStyle = EX_DIM;
  ctx.fillText(exTruncate(ctx, o.source || '', EXPORT_W - EXPORT_PAD * 2 - 300), EXPORT_PAD, fy);
  ctx.fillStyle = EX_GOLD;
  ctx.textAlign = 'right';
  ctx.fillText('the-signal-gamma.vercel.app', EXPORT_W - EXPORT_PAD, fy);
  ctx.textAlign = 'left';
  return y + 34;
}

// Canvas has no repeating-linear-gradient, so the missed-time hatch is drawn:
// a wash for body, diagonals clipped to the bar for texture. It has to read as
// a different mark from the solid band, not a lighter one.
function exHatchBar(ctx, x, y, w, h, color) {
  if (w <= 0) return;
  ctx.save();
  ctx.beginPath();
  const rr = Math.min(3, h / 2, w / 2);
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = 'rgba(42,120,214,0.18)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  for (let i = -h; i < w + h; i += 6) {
    ctx.beginPath();
    ctx.moveTo(x + i, y + h);
    ctx.lineTo(x + i + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

function exRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, h / 2, Math.max(w, 0) / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
  ctx.fill();
}

// rows: [{ rank, name, team, value, label }]
// mode 'bars' draws from a zero rule; 'dots' places a marker on the field's range.
function exportRowChart(o) {
  const rows = o.rows;
  const ROW_H = 34, NAME_W = 250, VAL_W = 86;
  const LEGEND_H = o.showAvail ? 34 : 0;
  const height = exContentTop(o) + rows.length * ROW_H + LEGEND_H + EX_FOOTER_SPACE;

  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_W * EXPORT_SCALE;
  canvas.height = height * EXPORT_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

  let y = exDrawFrame(ctx, o, height);
  const trackX = EXPORT_PAD + NAME_W;
  const trackW = EXPORT_W - EXPORT_PAD * 2 - NAME_W - VAL_W;

  // In band mode the scale has to span the drawn extremes, not just the
  // medians, or the hatched extension runs off the left edge.
  const vals = o.band
    ? rows.flatMap(r => [typeof r.availFloor === 'number' ? r.availFloor : r.floor, r.ceiling])
    : rows.map(r => r.value);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const useDots = o.mode === 'dots';
  let zeroX = trackX, span = 1, aLo = lo, aHi = hi;
  if (useDots) {
    const pad = (hi - lo) * 0.12 || 0.5;
    aLo = lo - pad; aHi = hi + pad;
  } else {
    const maxV = Math.max(hi, 0), minV = Math.min(lo, 0);
    span = (maxV - minV) || 1;
    zeroX = trackX + ((0 - minV) / span) * trackW;
  }

  if (useDots) {
    ctx.font = exFont('400 12px $mono');
    ctx.fillStyle = EX_DIM;
    ctx.fillText(`${Math.round(aLo * 100) / 100}${o.unit || ''}`, trackX, y - 8);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(aHi * 100) / 100}${o.unit || ''}`, trackX + trackW, y - 8);
    ctx.textAlign = 'left';
  }

  rows.forEach((r, i) => {
    const ry = y + i * ROW_H;
    const mid = ry + ROW_H / 2;

    ctx.font = exFont('400 13px $mono');
    ctx.fillStyle = EX_DIM;
    ctx.textAlign = 'right';
    ctx.fillText(String(r.rank != null ? r.rank : i + 1), EXPORT_PAD + 24, mid + 4);
    ctx.textAlign = 'left';

    ctx.font = exFont('500 16px $sans');
    ctx.fillStyle = EX_TEXT;
    const nameMax = NAME_W - 46 - (r.team ? 52 : 0);
    ctx.fillText(exTruncate(ctx, r.name, nameMax), EXPORT_PAD + 36, mid + 5);
    if (r.team) {
      // Right-aligned in its own column. Trailing the measured name width
      // left the codes at a different x on every row, which read as broken.
      ctx.font = exFont('400 12px $mono');
      ctx.fillStyle = EX_DIM;
      ctx.textAlign = 'right';
      ctx.fillText(r.team, EXPORT_PAD + NAME_W - 14, mid + 4);
      ctx.textAlign = 'left';
    }

    if (useDots) {
      ctx.strokeStyle = EX_LINE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(trackX, mid);
      ctx.lineTo(trackX + trackW, mid);
      ctx.stroke();
      const cx = trackX + ((r.value - aLo) / ((aHi - aLo) || 1)) * trackW;
      ctx.fillStyle = EX_CARD;
      ctx.beginPath(); ctx.arc(cx, mid, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = EX_GOLD;
      ctx.beginPath(); ctx.arc(cx, mid, 6, 0, Math.PI * 2); ctx.fill();
    } else if (o.band) {
      // floor→ceiling band with a median dot (the rankings tier board)
      const X = v => trackX + ((v - lo) / ((hi - lo) || 1)) * trackW;
      if (typeof r.availFloor === 'number' && r.availFloor < r.floor) {
        exHatchBar(ctx, X(r.availFloor), mid - 4, X(r.floor) - X(r.availFloor), 8, 'rgba(42,120,214,0.62)');
      }
      ctx.fillStyle = 'rgba(168,137,58,0.30)';
      exRoundRect(ctx, X(r.floor), mid - 5, Math.max(X(r.ceiling) - X(r.floor), 2), 10, 5);
      if (r.flagged) {
        const fx = X(typeof r.availFloor === 'number' ? r.availFloor : r.floor) - 9;
        ctx.fillStyle = '#e74c3c';
        ctx.beginPath(); ctx.arc(fx, mid, 3.5, 0, Math.PI * 2); ctx.fill();
      }
      const cx = X(r.value);
      ctx.fillStyle = EX_CARD;
      ctx.beginPath(); ctx.arc(cx, mid, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = EX_GOLD;
      ctx.beginPath(); ctx.arc(cx, mid, 6, 0, Math.PI * 2); ctx.fill();
    } else {
      const pos = r.value >= 0;
      const w = (Math.abs(r.value) / span) * trackW;
      ctx.fillStyle = pos ? EX_GOLD : EX_BLUE;
      exRoundRect(ctx, pos ? zeroX : zeroX - w, mid - 7, Math.max(w, 2), 14, 4);
    }

    ctx.font = exFont('400 14px $mono');
    ctx.fillStyle = EX_MUTED;
    ctx.textAlign = 'right';
    ctx.fillText(`${r.value}${o.unit || ''}`, EXPORT_W - EXPORT_PAD, mid + 5);
    ctx.textAlign = 'left';
  });

  if (!useDots && !o.band && lo < 0) {
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(zeroX, y - 6);
    ctx.lineTo(zeroX, y + rows.length * ROW_H);
    ctx.stroke();
  }

  // Three different marks now share the plot, so identity cannot rest on
  // colour memory — the exported card carries its own key.
  if (o.showAvail) {
    const ly = y + rows.length * ROW_H + 22;
    let lx = EXPORT_PAD + 36;
    ctx.font = exFont('400 13px $sans');
    ctx.textBaseline = 'middle';
    const key = (draw, label) => {
      draw(lx, ly);
      ctx.fillStyle = EX_MUTED;
      ctx.textAlign = 'left';
      ctx.fillText(label, lx + 26, ly);
      lx += 26 + ctx.measureText(label).width + 30;
    };
    key((x, cy) => { ctx.fillStyle = 'rgba(168,137,58,0.30)'; exRoundRect(ctx, x, cy - 5, 18, 10, 5); },
      'Floor → ceiling, health assumed');
    key((x, cy) => { ctx.fillStyle = EX_CARD; ctx.beginPath(); ctx.arc(x + 9, cy, 8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = EX_GOLD; ctx.beginPath(); ctx.arc(x + 9, cy, 6, 0, Math.PI * 2); ctx.fill(); }, 'Median');
    key((x, cy) => exHatchBar(ctx, x, cy - 4, 18, 8, 'rgba(42,120,214,0.62)'), 'Missed-time case');
    key((x, cy) => { ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.arc(x + 6, cy, 3.5, 0, Math.PI * 2); ctx.fill(); },
      'Not currently healthy');
    ctx.textBaseline = 'alphabetic';
  }
  return canvas;
}

// pts: [{ name, team, x, y }]
function exportScatterChart(o) {
  const height = exContentTop(o) + 520 + EX_FOOTER_SPACE;
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_W * EXPORT_SCALE;
  canvas.height = height * EXPORT_SCALE;
  const ctx = canvas.getContext('2d');
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

  const top = exDrawFrame(ctx, o, height) + 14;
  const L = EXPORT_PAD + 62, R = EXPORT_W - EXPORT_PAD, B = height - EX_FOOTER_SPACE - 44, T = top;
  const xs = o.points.map(p => p.x), ys = o.points.map(p => p.y);
  const pad = a => { const lo = Math.min(...a), hi = Math.max(...a), m = (hi - lo) * 0.08 || 1; return [lo - m, hi + m]; };
  const [x0, x1] = pad(xs), [y0, y1] = pad(ys);
  const X = v => L + ((v - x0) / (x1 - x0)) * (R - L);
  const Y = v => B - ((v - y0) / (y1 - y0)) * (B - T);
  const med = a => { const s = [...a].sort((p, q) => p - q), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const mx = med(xs), my = med(ys);

  const ticks = (lo, hi) => { const st = Math.pow(10, Math.floor(Math.log10((hi - lo) / 3))); const s = ((hi - lo) / 3) / st > 5 ? st * 5 : ((hi - lo) / 3) / st > 2 ? st * 2 : st; const out = []; for (let v = Math.ceil(lo / s) * s; v <= hi; v += s) out.push(Math.round(v * 100) / 100); return out; };

  ctx.strokeStyle = EX_LINE; ctx.lineWidth = 1;
  ctx.font = exFont('400 12px $mono'); ctx.fillStyle = EX_DIM;
  ticks(x0, x1).forEach(v => {
    ctx.beginPath(); ctx.moveTo(X(v), T); ctx.lineTo(X(v), B); ctx.stroke();
    ctx.textAlign = 'center'; ctx.fillText(String(v), X(v), B + 20);
  });
  ticks(y0, y1).forEach(v => {
    ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(R, Y(v)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(String(v), L - 10, Y(v) + 4);
  });
  ctx.textAlign = 'left';

  ctx.setLineDash([5, 5]);
  ctx.strokeStyle = 'rgba(27,168,155,0.55)';
  ctx.beginPath(); ctx.moveTo(X(mx), T); ctx.lineTo(X(mx), B); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(L, Y(my)); ctx.lineTo(R, Y(my)); ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = exFont('400 11px $mono'); ctx.fillStyle = EX_TEAL;
  ctx.fillText(`MEDIAN ${Math.round(mx * 100) / 100}`, X(mx) + 6, T + 12);
  ctx.textAlign = 'right';
  ctx.fillText(`MEDIAN ${Math.round(my * 100) / 100}`, R, Y(my) - 6);
  ctx.textAlign = 'left';

  ctx.font = exFont('400 13px $mono'); ctx.fillStyle = EX_MUTED;
  ctx.textAlign = 'center';
  ctx.fillText(o.xLabel.toUpperCase(), (L + R) / 2, B + 48);
  ctx.save();
  ctx.translate(EXPORT_PAD - 4, (T + B) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(o.yLabel.toUpperCase(), 0, 0);
  ctx.restore();
  ctx.textAlign = 'left';

  const dist = p => Math.hypot((p.x - mx) / ((x1 - x0) || 1), (p.y - my) / ((y1 - y0) || 1));
  const labelled = new Set([...o.points].sort((a, b) => dist(b) - dist(a)).slice(0, 5).map(p => p.name));
  o.points.forEach(p => {
    const cx = X(p.x), cy = Y(p.y);
    ctx.fillStyle = EX_CARD;
    ctx.beginPath(); ctx.arc(cx, cy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = EX_GOLD;
    ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
    if (labelled.has(p.name)) {
      ctx.font = exFont('500 13px $sans');
      ctx.fillStyle = EX_TEXT;
      const flip = cx > R - 130;
      ctx.textAlign = flip ? 'right' : 'left';
      ctx.fillText(p.name, cx + (flip ? -11 : 11), cy + 4);
      ctx.textAlign = 'left';
    }
  });
  return canvas;
}

function exportFilename(title) {
  return 'the-signal-' + String(title).toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.png';
}

// Webfonts must be resolved before the first fillText or the card silently
// renders in the fallback face.
async function runExport(builder, title, btn) {
  const label = btn && btn.textContent;
  try {
    if (btn) { btn.textContent = 'Rendering…'; btn.disabled = true; }
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const canvas = builder();
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = exportFilename(title);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    console.warn('Chart export failed:', e);
    if (btn) btn.textContent = 'Export failed';
    setTimeout(() => { if (btn) { btn.textContent = label; btn.disabled = false; } }, 1800);
    return;
  }
  if (btn) { btn.textContent = 'Saved ✓'; setTimeout(() => { btn.textContent = label; btn.disabled = false; }, 1600); }
}

