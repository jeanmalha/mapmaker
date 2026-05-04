/**
 * mapview.js — 2D equirectangular flat map view
 *
 * The heightmap[y * S + x] maps directly to:
 *   longitude = (x / S) * 360 - 180   (-180 … 180)
 *   latitude  = 90 - (y / S) * 180    (90 … -90)
 */

import { heightToColor } from './terrain.js';

const GRATICULE_STEP = 30; // degrees between grid lines

export class MapView {
  constructor(canvas, terrain) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.terrain = terrain;

    // Device pixel ratio — updated whenever the canvas is resized
    this._dpr = 1;

    // Viewport transform (pan + zoom) — always in CSS pixels
    this._scale  = 1;
    this._offsetX = 0;
    this._offsetY = 0;
    this._dragging = false;
    this._dragStart = null;
    this._painting  = false;

    // Marker overlay options
    this.showMarkers = true;
    this.showLabels  = true;
    this._markers    = [];   // set externally via setMarkers()

    // Off-screen buffer (rendered at heightmap resolution)
    this._buffer = document.createElement('canvas');
    this._buffer.width  = terrain.size;
    this._buffer.height = terrain.size;
    this._imageData = null;

    this._bindEvents();
  }

  /** Pass the markers list from markers.js so the flat map can render them */
  setMarkers(markersInstance) {
    this._markersRef = markersInstance;
  }

  /** Resize the offscreen buffer to match terrain.size after a resolution change */
  resizeBuffer() {
    this._buffer.width  = this.terrain.size;
    this._buffer.height = this.terrain.size;
    this._imageData = null;
  }

  // ── Render heightmap → offscreen buffer ──────────
  renderBuffer() {
    const S   = this.terrain.size;
    const ctx = this._buffer.getContext('2d');
    const img = ctx.createImageData(S, S);
    const hm  = this.terrain.heightmap;

    for (let i = 0; i < S * S; i++) {
      const [r, g, b] = heightToColor(hm[i]);
      img.data[i * 4]     = Math.round(r * 255);
      img.data[i * 4 + 1] = Math.round(g * 255);
      img.data[i * 4 + 2] = Math.round(b * 255);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  // CSS-pixel dimensions (independent of device pixel ratio)
  get _cssWidth()  { return this.canvas.width  / this._dpr; }
  get _cssHeight() { return this.canvas.height / this._dpr; }

  // ── Draw to screen canvas ─────────────────────────
  render() {
    const W   = this._cssWidth;
    const H   = this._cssHeight;
    const ctx = this.ctx;

    // Scale once for HiDPI — all draw calls below use CSS pixels
    ctx.save();
    ctx.scale(this._dpr, this._dpr);

    // Background
    ctx.fillStyle = '#0a0a0f';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(this._offsetX, this._offsetY);
    ctx.scale(this._scale, this._scale);
    ctx.drawImage(this._buffer, 0, 0, W, H);
    this._drawGraticule(ctx, W, H);
    ctx.restore();

    // Markers drawn in SCREEN space (after restore) so transform never interferes
    if (this.showMarkers && this._markersRef) {
      this._drawMarkers(W, H);
    }

    ctx.restore(); // remove DPR scale
  }

  // Convert a lat/lon to screen pixel, accounting for pan + zoom
  _latLonToScreen(lat, lon, W, H) {
    const mapX = ((lon + 180) / 360) * W;   // position in map-space
    const mapY = ((90 - lat)  / 180) * H;
    return {
      x: this._offsetX + mapX * this._scale,
      y: this._offsetY + mapY * this._scale,
    };
  }

  _drawMarkers(W, H) {
    const ctx   = this.ctx;
    const items = this._markersRef.getAll();
    const R     = 7;  // fixed screen-pixel pin radius

    for (const m of items) {
      const { x, y } = this._latLonToScreen(m.lat, m.lon, W, H);

      // Skip pins fully outside the visible canvas
      if (x < -R || x > W + R || y < -R || y > H + R) continue;

      // Outer circle
      ctx.beginPath();
      ctx.arc(x, y, R, 0, Math.PI * 2);
      ctx.fillStyle   = '#f59e0b';
      ctx.fill();
      ctx.strokeStyle = '#1a0800';
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Inner dot
      ctx.beginPath();
      ctx.arc(x, y, R * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();

      // Label
      if (this.showLabels) {
        ctx.font        = 'bold 11px "Courier New", monospace';
        ctx.lineWidth   = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.fillStyle   = '#f59e0b';
        const lx = x + R + 4;
        const ly = y + 4;
        ctx.strokeText(m.name, lx, ly);
        ctx.fillText(m.name, lx, ly);
      }
    }
  }

  _drawGraticule(ctx, W, H) {
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth   = 0.5 / this._scale;
    ctx.font        = `${10 / this._scale}px 'Courier New', monospace`;
    ctx.fillStyle   = 'rgba(255,255,255,0.35)';

    // Vertical lines (meridians)
    for (let lon = -180; lon <= 180; lon += GRATICULE_STEP) {
      const x = ((lon + 180) / 360) * W;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
      if (lon > -180) ctx.fillText(`${lon}°`, x + 2 / this._scale, 12 / this._scale);
    }

    // Horizontal lines (parallels)
    for (let lat = -90; lat <= 90; lat += GRATICULE_STEP) {
      const y = ((90 - lat) / 180) * H;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      if (lat !== -90 && lat !== 90) ctx.fillText(`${lat}°`, 2 / this._scale, y - 2 / this._scale);
    }

    // Equator & prime meridian — brighter
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 1 / this._scale;

    const eqY = H / 2;
    ctx.beginPath(); ctx.moveTo(0, eqY); ctx.lineTo(W, eqY); ctx.stroke();

    const pmX = W / 2;
    ctx.beginPath(); ctx.moveTo(pmX, 0); ctx.lineTo(pmX, H); ctx.stroke();
  }

  // ── Fit view to canvas ────────────────────────────
  fitToCanvas(dpr) {
    if (dpr !== undefined) this._dpr = dpr;
    this._scale   = 1;
    this._offsetX = 0;
    this._offsetY = 0;
    this.render();
  }

  // ── Mouse → heightmap pixel coords ───────────────
  canvasToHeightmap(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx   = (clientX - rect.left  - this._offsetX) / this._scale;
    const sy   = (clientY - rect.top   - this._offsetY) / this._scale;
    const S    = this.terrain.size;
    const W    = this._cssWidth;
    const H    = this._cssHeight;
    const px   = Math.floor((sx / W) * S);
    const py   = Math.floor((sy / H) * S);
    return { px: Math.max(0, Math.min(S-1, px)), py: Math.max(0, Math.min(S-1, py)) };
  }

  // ── Lat/lon from canvas coords ────────────────────
  canvasToLatLon(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx   = (clientX - rect.left  - this._offsetX) / this._scale;
    const sy   = (clientY - rect.top   - this._offsetY) / this._scale;
    const W    = this._cssWidth;
    const H    = this._cssHeight;
    const lon  = (sx / W) * 360 - 180;
    const lat  = 90 - (sy / H) * 180;
    return { lat, lon };
  }

  // ── Events: pan & zoom ────────────────────────────
  _bindEvents() {
    const c = this.canvas;

    c.addEventListener('wheel', e => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const rect   = c.getBoundingClientRect();
      const mx     = e.clientX - rect.left;
      const my     = e.clientY - rect.top;
      this._offsetX = mx - (mx - this._offsetX) * factor;
      this._offsetY = my - (my - this._offsetY) * factor;
      this._scale  *= factor;
      this._scale   = Math.max(0.5, Math.min(20, this._scale));
      this.render();
    }, { passive: false });

    c.addEventListener('mousedown', e => {
      if (e.button === 2) {
        // Right-click = pan
        this._dragging  = true;
        this._dragStart = { x: e.clientX - this._offsetX, y: e.clientY - this._offsetY };
      } else {
        this._painting = true;
        this.onPaint?.(e);
      }
    });

    c.addEventListener('mousemove', e => {
      if (this._dragging) {
        this._offsetX = e.clientX - this._dragStart.x;
        this._offsetY = e.clientY - this._dragStart.y;
        this.render();
      } else if (this._painting) {
        this.onPaint?.(e);
      }
      this.onHover?.(e);
    });

    c.addEventListener('mouseup',    () => { this._dragging = false; this._painting = false; });
    c.addEventListener('mouseleave', () => { this._dragging = false; this._painting = false; });
    c.addEventListener('contextmenu', e => e.preventDefault());
  }

  // ── Full-res PNG export ───────────────────────────
  exportPNG(planetName) {
    // Render at 4× resolution for a crisp export
    const S      = this.terrain.size;
    const scale  = 4;
    const out    = document.createElement('canvas');
    out.width    = S * scale;
    out.height   = S * scale;
    const octx   = out.getContext('2d');

    // Draw the terrain buffer scaled up
    octx.imageSmoothingEnabled = false;
    octx.drawImage(this._buffer, 0, 0, out.width, out.height);

    // Draw graticule at export resolution
    octx.save();
    octx.scale(scale, scale);
    this._drawGraticule(octx, S, S);
    octx.restore();

    out.toBlob(blob => {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href     = url;
      a.download = `${planetName || 'planet'}-flat.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, 'image/png');
  }
}
