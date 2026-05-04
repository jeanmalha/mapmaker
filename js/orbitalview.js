/**
 * orbitalview.js — 2D animated orbital system diagram
 *
 * Planet mode:  star at centre, planet on elliptical orbit, habitable zone
 * Moon mode:    main view = gas giant + moon orbit
 *               inset     = star + gas giant orbit (scaled down)
 *
 * The "time" parameter (0–1, full orbit fraction) drives planet/moon position.
 */

import { STAR_PRESETS, GIANT_PRESETS } from './orbit.js';

const TAU = Math.PI * 2;

export class OrbitalView {
  constructor(canvas, orbit) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.orbit  = orbit;

    this._time      = 0;       // 0–1 orbit fraction
    this._animating = false;
    this._raf       = null;

    this._bindEvents();
  }

  // ── Public ────────────────────────────────────────

  start() {
    this._resize();
    this._animating = true;
    this._loop();
  }

  stop() {
    this._animating = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
  }

  render() {
    this._resize();
    this._draw();
  }

  // ── Main draw ─────────────────────────────────────

  _draw() {
    const dpr = this._dpr || 1;
    const W   = this._cssW || this.canvas.width;
    const H   = this._cssH || this.canvas.height;
    const ctx = this.ctx;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, W, H);

    // Deep space background
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, W, H);

    if (this.orbit.data.mode === 'planet') {
      this._drawPlanetSystem(ctx, W / 2, H / 2, Math.min(W, H) * 0.42);
    } else {
      // Main: giant ↔ moon
      const mainR = Math.min(W, H) * 0.35;
      this._drawMoonSystem(ctx, W / 2, H / 2, mainR);

      // Inset top-right: star ↔ giant
      const insetW = Math.min(W * 0.28, 200);
      const insetH = insetW;
      const insetX = W - insetW - 14;
      const insetY = 14;
      this._drawInsetStarSystem(ctx, insetX, insetY, insetW, insetH);
    }

    this._drawHUD(ctx, W, H);

    ctx.restore(); // remove DPR scale
  }

  // ── Planet-around-star view ───────────────────────
  //
  // Keplerian geometry:
  //   a  = semi-major axis
  //   b  = semi-minor axis  = a * sqrt(1 - e²)
  //   c  = focus offset     = a * e
  //   Star sits at ONE FOCUS of the ellipse.
  //   Ellipse centre is offset from the star by c along the major axis.
  //   Perihelion (closest approach) = a(1-e)  at θ=0
  //   Aphelion  (farthest point)    = a(1+e)  at θ=π

  _drawPlanetSystem(ctx, cx, cy, maxR) {
    const o       = this.orbit.data;
    const preset  = STAR_PRESETS[o.star.type];
    const L       = preset.luminosity;
    const orbitAU = o.planetOrbit.semiMajorAxis;
    const ecc     = Math.max(0, Math.min(0.95, o.planetOrbit.eccentricity));

    // Scale so the full aphelion fits inside maxR with a small margin
    const aphelionAU = orbitAU * (1 + ecc);
    const hzOut      = 1.37 * Math.sqrt(L);
    const scale      = maxR / Math.max(aphelionAU * 1.25, hzOut * 1.1, 0.5);

    // ── Habitable zone (rings centred on star) ───────
    const hzInR  = 0.95 * Math.sqrt(L) * scale;
    const hzOutR = hzOut * scale;

    const hzGrad = ctx.createRadialGradient(cx, cy, hzInR, cx, cy, hzOutR);
    hzGrad.addColorStop(0,   'rgba(60,180,80,0)');
    hzGrad.addColorStop(0.15,'rgba(60,180,80,0.13)');
    hzGrad.addColorStop(0.85,'rgba(60,180,80,0.13)');
    hzGrad.addColorStop(1,   'rgba(60,180,80,0)');
    ctx.fillStyle = hzGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, hzOutR, 0, TAU);
    ctx.arc(cx, cy, hzInR,  0, TAU, true);
    ctx.fill();

    ctx.strokeStyle = 'rgba(60,180,80,0.3)';
    ctx.lineWidth   = 0.5;
    this._circle(ctx, cx, cy, hzInR);
    this._circle(ctx, cx, cy, hzOutR);
    ctx.fillStyle = 'rgba(60,180,80,0.45)';
    ctx.font      = '10px Courier New';
    ctx.fillText('HZ', cx + hzInR + 4, cy - 4);

    // ── Orbit ellipse ────────────────────────────────
    const a  = orbitAU * scale;          // semi-major axis (px)
    const b  = a * Math.sqrt(1 - ecc * ecc); // semi-minor axis (px)
    const c  = a * ecc;                  // focus offset (px)

    // Star is at the right focus → ellipse centre is LEFT of star by c
    const ex = cx - c;   // ellipse centre x; star stays at cx, cy

    ctx.strokeStyle = 'rgba(180,200,255,0.35)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.ellipse(ex, cy, a, b, 0, 0, TAU);
    ctx.stroke();

    // Mark perihelion & aphelion with small ticks
    const tickLen = 5;
    [[ex + a, cy], [ex - a, cy]].forEach(([tx, ty]) => {
      ctx.strokeStyle = 'rgba(180,200,255,0.2)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(tx, ty - tickLen);
      ctx.lineTo(tx, ty + tickLen);
      ctx.stroke();
    });
    ctx.fillStyle = 'rgba(180,200,255,0.3)';
    ctx.font      = '9px Courier New';
    ctx.fillText('P', ex + a + 4, cy + 3);   // perihelion label
    ctx.fillText('A', ex - a - 14, cy + 3);  // aphelion label

    // Minor-axis line (dashed) showing the ellipse shape
    ctx.strokeStyle = 'rgba(180,200,255,0.08)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(ex, cy - b);
    ctx.lineTo(ex, cy + b);
    ctx.moveTo(ex - a, cy);
    ctx.lineTo(ex + a, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // Focus cross (second empty focus, for reference)
    const fx2 = ex - c;  // left (empty) focus
    ctx.strokeStyle = 'rgba(180,200,255,0.15)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(fx2 - 4, cy); ctx.lineTo(fx2 + 4, cy);
    ctx.moveTo(fx2, cy - 4); ctx.lineTo(fx2, cy + 4);
    ctx.stroke();

    // ── Star at (cx, cy) — the right focus ──────────
    const starR = Math.max(10, 18 + Math.log10(L + 1) * 7);
    this._drawStar(ctx, cx, cy, preset, starR);

    // ── Planet: parametric position on ellipse ───────
    // θ=0 → perihelion (right side, closest to star)
    const angle = this._time * TAU;
    const px    = ex + a * Math.cos(angle);
    const py    = cy + b * Math.sin(angle);
    this._drawPlanet(ctx, px, py, 7, '#4a8ccc');

    // Dashed line from star to planet (current distance)
    const dist_au = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) / scale;
    ctx.strokeStyle = 'rgba(180,200,255,0.12)';
    ctx.setLineDash([3, 5]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(px, py); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(180,200,255,0.45)';
    ctx.font      = '10px Courier New';
    ctx.fillText(`${dist_au.toFixed(2)} AU`, (cx + px) / 2 + 5, (cy + py) / 2 - 4);
  }

  // ── Moon-around-giant view ────────────────────────
  //
  // Same Keplerian focus geometry: gas giant at one focus.

  _drawMoonSystem(ctx, cx, cy, maxR) {
    const o       = this.orbit.data;
    const gPreset = GIANT_PRESETS[o.gasGiant.type] || GIANT_PRESETS.cold_giant;
    const gRadius = o.gasGiant.radius;

    const ecc     = Math.max(0, Math.min(0.95, o.moonOrbit.eccentricity));
    const orbitKm = o.moonOrbit.semiMajorAxis;
    const giantRkm = 71492 * gRadius;

    // Scale: aphelion + giant radius fits within maxR
    const aphelionKm = orbitKm * (1 + ecc);
    const scale      = maxR / (aphelionKm * 1.2 + giantRkm);

    const a    = orbitKm * scale;
    const b    = a * Math.sqrt(1 - ecc * ecc);
    const c    = a * ecc;
    const ex   = cx - c;   // ellipse centre; giant stays at (cx, cy)

    // ── Orbit ellipse ──
    ctx.strokeStyle = 'rgba(180,200,255,0.3)';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.ellipse(ex, cy, a, b, 0, 0, TAU);
    ctx.stroke();

    // Major axis dashed line
    ctx.strokeStyle = 'rgba(180,200,255,0.08)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(ex - a, cy); ctx.lineTo(ex + a, cy);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Gas giant at (cx, cy) — the focus ──
    const gR = Math.max(14, giantRkm * scale);
    this._drawGasGiant(ctx, cx, cy, gR, gPreset);

    // ── Moon: parametric position ──
    const incl   = o.moonOrbit.inclination * Math.PI / 180;
    const bInc   = b * Math.cos(incl);   // inclination compresses the minor axis visually
    const angle  = this._time * TAU;
    const mx     = ex + a * Math.cos(angle);
    const my     = cy + bInc * Math.sin(angle);
    this._drawPlanet(ctx, mx, my, 6, '#5a9ccc');

    // ── Tidal lock indicator ──
    if (o.moonOrbit.tidallyLocked) {
      // Arrow pointing toward giant
      const dx = cx - mx, dy = cy - my;
      const d  = Math.sqrt(dx*dx + dy*dy);
      ctx.strokeStyle = 'rgba(255,200,80,0.4)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.lineTo(mx + dx/d * 10, my + dy/d * 10);
      ctx.stroke();
    }

    // ── Distance label ──
    ctx.strokeStyle = 'rgba(180,200,255,0.12)';
    ctx.setLineDash([3,4]);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(mx, my); ctx.stroke();
    ctx.setLineDash([]);

    const currentDist = Math.sqrt((mx - cx) ** 2 + ((my - cy) / Math.cos(incl)) ** 2) / scale;
    ctx.fillStyle = 'rgba(180,200,255,0.5)';
    ctx.font      = '10px Courier New';
    ctx.fillText(`${Math.round(currentDist).toLocaleString()} km`, (cx + mx) / 2 + 4, (cy + my) / 2 - 4);
  }

  // ── Inset: star + giant orbit ─────────────────────

  _drawInsetStarSystem(ctx, x, y, w, h) {
    const o      = this.orbit.data;
    const preset = STAR_PRESETS[o.star.type];

    // Inset background
    ctx.fillStyle = 'rgba(5,5,10,0.85)';
    ctx.strokeStyle = 'rgba(80,100,140,0.4)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill(); ctx.stroke();

    const cx  = x + w / 2;
    const cy  = y + h / 2;
    const maxR = Math.min(w, h) * 0.38;

    const starAU = o.gasGiant.distanceFromStar;
    const scale  = maxR / (starAU * 1.5);

    // Star
    this._drawStar(ctx, cx, cy, preset, 8 + Math.log10(preset.luminosity + 1) * 3);

    // Giant orbit
    const sma = starAU * scale;
    ctx.strokeStyle = 'rgba(180,200,255,0.18)';
    ctx.lineWidth   = 0.8;
    ctx.beginPath();
    ctx.arc(cx, cy, sma, 0, TAU);
    ctx.stroke();

    // Giant position — offset by half phase to avoid moon/planet aliasing
    const gAngle = (this._time * 0.15) * TAU;
    const gx = cx + sma * Math.cos(gAngle);
    const gy = cy + sma * Math.sin(gAngle);
    const gPreset = GIANT_PRESETS[o.gasGiant.type] || GIANT_PRESETS.cold_giant;
    this._drawGasGiant(ctx, gx, gy, 5, gPreset);

    // Label
    ctx.fillStyle = 'rgba(120,140,180,0.7)';
    ctx.font      = '9px Courier New';
    ctx.fillText('System overview', x + 5, y + h - 5);
  }

  // ── HUD overlay ───────────────────────────────────

  _drawHUD(ctx, W, H) {
    const o      = this.orbit.data;
    const preset = STAR_PRESETS[o.star.type];
    const temp   = this.orbit.estimatedSurfaceTemp;
    const year   = this.orbit.yearLabel;
    const mode   = o.mode === 'moon' ? 'Moon / Satellite' : 'Planet';

    const lines = [
      `${o.star.name}  [${o.star.type}]  ${preset.temp.toLocaleString()} K`,
      o.mode === 'moon'
        ? `${o.gasGiant.name}  ·  ${o.gasGiant.mass} M♃  ·  ${o.gasGiant.distanceFromStar} AU from star`
        : `Distance: ${o.planetOrbit.semiMajorAxis} AU  ·  Ecc: ${o.planetOrbit.eccentricity}`,
      `Year: ${year}  ·  Est. surface: ${temp}°C`,
      `Mode: ${mode}${o.mode==='moon' && o.moonOrbit.tidallyLocked ? '  ·  Tidally locked' : ''}`,
    ];

    ctx.font      = '11px Courier New';
    ctx.fillStyle = 'rgba(160,180,220,0.7)';
    lines.forEach((l, i) => ctx.fillText(l, 14, H - 14 - (lines.length - 1 - i) * 16));

    // Play / Pause hint
    ctx.fillStyle = 'rgba(100,120,160,0.45)';
    ctx.font      = '10px Courier New';
    ctx.fillText(this._animating ? '⏸ click to pause' : '▶ click to animate', 14, 18);
  }

  // ── Primitives ────────────────────────────────────

  _drawStar(ctx, cx, cy, preset, r) {
    const col = `#${preset.sunColor.toString(16).padStart(6,'0')}`;
    // Glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 4);
    glow.addColorStop(0,   col + 'aa');
    glow.addColorStop(0.3, col + '33');
    glow.addColorStop(1,   'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r * 4, 0, TAU); ctx.fill();

    // Core
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    core.addColorStop(0, '#ffffff');
    core.addColorStop(0.5, col);
    core.addColorStop(1, col + 'cc');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  }

  _drawGasGiant(ctx, cx, cy, r, preset) {
    // Base colour from first band
    ctx.fillStyle = preset.colors[0];
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();

    // Band stripes (clipped)
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip();
    const bands = 6;
    for (let b = 0; b < bands; b++) {
      const y0 = cy - r + (b / bands) * r * 2;
      ctx.fillStyle = preset.colors[b % preset.colors.length] + 'cc';
      ctx.fillRect(cx - r, y0, r * 2, r * 2 / bands * 0.6);
    }
    ctx.restore();

    // Limb darkening
    const limb = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    limb.addColorStop(0.6, 'rgba(0,0,0,0)');
    limb.addColorStop(1,   'rgba(0,0,0,0.55)');
    ctx.fillStyle = limb;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  }

  _drawPlanet(ctx, cx, cy, r, col) {
    // Glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 3);
    glow.addColorStop(0,   col + '66');
    glow.addColorStop(1,   'transparent');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(cx, cy, r * 3, 0, TAU); ctx.fill();

    // Body
    const body = ctx.createRadialGradient(cx - r*0.3, cy - r*0.3, 0, cx, cy, r);
    body.addColorStop(0, '#cde');
    body.addColorStop(0.5, col);
    body.addColorStop(1, '#1a2a3a');
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
  }

  _circle(ctx, cx, cy, r) {
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
  }

  // ── Animation loop ────────────────────────────────

  _loop() {
    if (!this._animating) return;
    this._time = (this._time + 0.0008) % 1;
    this._draw();
    this._raf = requestAnimationFrame(() => this._loop());
  }

  // ── Events ────────────────────────────────────────

  _bindEvents() {
    this.canvas.addEventListener('click', () => {
      if (this._animating) {
        this.stop();
        this._draw(); // redraw HUD to show ▶ hint
      } else {
        this.start();
      }
    });
  }

  _resize() {
    const el   = this.canvas;
    const dpr  = window.devicePixelRatio || 1;
    const rect = el.getBoundingClientRect();
    const cssW = Math.floor(rect.width)  || el.parentElement?.clientWidth  || 800;
    const cssH = Math.floor(rect.height) || el.parentElement?.clientHeight || 600;
    const physW = Math.round(cssW * dpr);
    const physH = Math.round(cssH * dpr);
    if (el.width !== physW || el.height !== physH) {
      el.width  = physW;
      el.height = physH;
    }
    // Store CSS dimensions and DPR for draw calls
    this._cssW = cssW;
    this._cssH = cssH;
    this._dpr  = dpr;
  }
}
