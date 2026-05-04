/**
 * terrain.js — Heightmap generation & terrain type lookup
 *
 * The heightmap is a Float32Array of size W*H, values 0–1.
 * (0 = deepest ocean, 1 = highest peak)
 *
 * Exports:
 *   TERRAIN        — ordered map of height thresholds → terrain metadata
 *   TERRAIN_HEIGHT — canonical height value for each paintable terrain id
 *   heightToColor()       — map a height value to an RGB triple
 *   heightToTerrainId()   — map a height value to a terrain id string
 *   Terrain               — class that owns and generates the heightmap
 */

// Height thresholds → terrain type (ordered low → high)
export const TERRAIN = {
  DEEP_OCEAN:    { id: 'ocean',         max: 0.35, color: [0.10, 0.23, 0.36] },
  COAST:         { id: 'coast',         max: 0.45, color: [0.18, 0.42, 0.62] },
  BEACH:         { id: 'beach',         max: 0.48, color: [0.78, 0.72, 0.48] },
  DESERT_YELLOW: { id: 'desert_yellow', max: 0.51, color: [0.85, 0.72, 0.30] },
  DESERT_WHITE:  { id: 'desert_white',  max: 0.54, color: [0.93, 0.91, 0.85] },
  PLAINS:        { id: 'plains',        max: 0.62, color: [0.29, 0.49, 0.25] },
  HILLS:         { id: 'hills',         max: 0.72, color: [0.24, 0.36, 0.17] },
  MOUNTAINS:     { id: 'mountains',     max: 0.85, color: [0.48, 0.36, 0.23] },
  PEAKS:         { id: 'peaks',         max: 1.00, color: [0.91, 0.91, 0.91] },
};

// Target height value for each paintable terrain id
export const TERRAIN_HEIGHT = {
  ocean:         0.25,
  coast:         0.40,
  beach:         0.47,
  desert_yellow: 0.495,
  desert_white:  0.525,
  plains:        0.57,
  hills:         0.67,
  mountains:     0.78,
  peaks:         0.92,
};

/**
 * Map a normalised height value (0–1) to an RGB colour triple.
 * @param {number} h - Height value in [0, 1]
 * @returns {number[]} [r, g, b] each in [0, 1]
 */
export function heightToColor(h) {
  for (const t of Object.values(TERRAIN)) {
    if (h <= t.max) return t.color;
  }
  return TERRAIN.PEAKS.color;
}

/**
 * Map a normalised height value (0–1) to a terrain id string.
 * @param {number} h - Height value in [0, 1]
 * @returns {string} Terrain id (e.g. 'ocean', 'plains', 'peaks')
 */
export function heightToTerrainId(h) {
  for (const t of Object.values(TERRAIN)) {
    if (h <= t.max) return t.id;
  }
  return 'peaks';
}

/**
 * Owns the planet heightmap and all operations that modify it.
 *
 * The heightmap is a row-major Float32Array of `size × size` values in [0, 1].
 * Index formula: `heightmap[y * size + x]`
 * All brush methods wrap horizontally (x) so painting near the east edge
 * seamlessly continues on the west side.
 */
export class Terrain {
  /**
   * @param {number} [size=512] - Heightmap edge length in pixels (square)
   */
  constructor(size = 512) {
    this.size = size;
    this.heightmap = new Float32Array(size * size);
  }

  /** Change resolution and reset heightmap (caller must regenerate) */
  setSize(size) {
    this.size      = size;
    this.heightmap = new Float32Array(size * size);
  }

  /**
   * Upscale (or downscale) the existing heightmap to newSize using bilinear
   * interpolation — terrain detail is preserved, no data is discarded.
   */
  resizeTo(newSize) {
    const oldSize = this.size;
    const oldHm   = this.heightmap;
    const newHm   = new Float32Array(newSize * newSize);
    const scale   = (oldSize - 1) / (newSize - 1);

    for (let ny = 0; ny < newSize; ny++) {
      for (let nx = 0; nx < newSize; nx++) {
        const ox = nx * scale;
        const oy = ny * scale;
        const x0 = Math.floor(ox);
        const y0 = Math.floor(oy);
        const x1 = Math.min(x0 + 1, oldSize - 1);
        const y1 = Math.min(y0 + 1, oldSize - 1);
        const fx = ox - x0;
        const fy = oy - y0;

        newHm[ny * newSize + nx] =
          oldHm[y0 * oldSize + x0] * (1 - fx) * (1 - fy) +
          oldHm[y0 * oldSize + x1] * fx        * (1 - fy) +
          oldHm[y1 * oldSize + x0] * (1 - fx) * fy        +
          oldHm[y1 * oldSize + x1] * fx        * fy;
      }
    }

    this.size      = newSize;
    this.heightmap = newHm;
  }

  /**
   * Generate a new heightmap using multi-octave 3D simplex noise projected
   * onto a sphere so the map tiles seamlessly in the equirectangular projection.
   *
   * @param {object} [settings={}]
   * @param {number} [settings.seaLevel=0.42]        - Fraction of the map that becomes ocean (0–1)
   * @param {number} [settings.continentSize=0.50]   - Noise frequency scale; higher = larger features
   * @param {number} [settings.mountainHeight=0.60]  - Vertical exaggeration of land above sea level
   * @param {number} [settings.roughness=0.40]       - Fractal persistence; higher = more detail noise
   * @param {number} [settings.landShape=0.50]       - 0 = scattered islands, 1 = large continents
   */
  generate(settings = {}) {
    const {
      seaLevel       = 0.42,
      continentSize  = 0.50,
      mountainHeight = 0.60,
      roughness      = 0.40,
      landShape      = 0.50,  // 0 = scattered islands, 1 = large continents
    } = settings;

    const noise  = this._makeNoise();
    const noise2 = this._makeNoise(); // independent seed for tectonic layer

    const S           = this.size;
    const scale       = 1.5 / continentSize;
    const octaves     = 6;
    const persistence = 0.5 + roughness * 0.3;

    // landShape drives two effects:
    //   tectonicWeight — how much a very-low-freq "plate" layer pulls land into big blobs
    //   power          — redistribution curve (>1 shrinks land→islands, <1 expands→continents)
    const tectonicWeight = landShape * 0.65;           // 0 → 0.65
    const power          = 1.6 - landShape * 1.2;     // islands=1.6, continents=0.4

    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        // Sphere-wrapped coordinates so the map tiles seamlessly
        const u = x / S;
        const v = y / S;
        const theta = u * Math.PI * 2;
        const phi   = v * Math.PI;

        const nx = Math.sin(phi) * Math.cos(theta);
        const ny = Math.sin(phi) * Math.sin(theta);
        const nz = Math.cos(phi);

        // Multi-octave detail noise
        let val = 0, amp = 1, freq = scale, max = 0;
        for (let o = 0; o < octaves; o++) {
          val += noise(nx * freq, ny * freq, nz * freq) * amp;
          max  += amp;
          amp  *= persistence;
          freq *= 2;
        }
        val = (val / max + 1) / 2; // 0–1

        // Tectonic plate layer — very low frequency, creates broad continent blobs
        // Blended in based on landShape; islands mode ignores it entirely
        if (tectonicWeight > 0) {
          const tecFreq    = 0.35 / continentSize;
          const tectonic   = (noise2(nx * tecFreq, ny * tecFreq, nz * tecFreq) + 1) / 2;
          val = val * (1 - tectonicWeight) + tectonic * tectonicWeight;
        }

        // Power redistribution:
        //   power > 1 → compresses high values → smaller land, more ocean → islands
        //   power < 1 → expands high values → larger land, less ocean → continents
        val = Math.pow(val, power);

        // Apply sea level: compress ocean depths, scale land heights
        val = val < seaLevel
          ? val * (seaLevel / 0.45)
          : seaLevel + (val - seaLevel) * mountainHeight;

        this.heightmap[y * S + x] = Math.max(0, Math.min(1, val));
      }
    }
  }

  /**
   * Paint a circular region of the heightmap toward a target height.
   * Each pixel blends linearly from its current value toward `targetHeight`,
   * with a radial falloff so the brush edge is soft.
   *
   * @param {number} cx           - Centre X in heightmap pixels
   * @param {number} cy           - Centre Y in heightmap pixels
   * @param {number} radius       - Brush radius in pixels
   * @param {number} targetHeight - Desired height in [0, 1] at the brush centre
   * @param {number} strength     - Blend factor per stroke in [0, 1]; 1 = instant snap
   */
  paint(cx, cy, radius, targetHeight, strength) {
    const S = this.size;
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = ((cx + dx) % S + S) % S;
        const py = ((cy + dy) % S + S) % S;
        const i  = py * S + px;
        const t  = strength * (1 - Math.sqrt(dx*dx + dy*dy) / radius);
        this.heightmap[i] += (targetHeight - this.heightmap[i]) * t;
        this.heightmap[i]  = Math.max(0, Math.min(1, this.heightmap[i]));
      }
    }
  }

  /**
   * Raise or lower terrain by adding a fixed delta each stroke.
   * Use a positive `delta` to raise (raise tool) or negative to lower.
   *
   * @param {number} cx       - Centre X in heightmap pixels
   * @param {number} cy       - Centre Y in heightmap pixels
   * @param {number} radius   - Brush radius in pixels
   * @param {number} delta    - Height change per stroke (e.g. +0.01 or -0.01)
   * @param {number} strength - Radial weight multiplier in [0, 1]
   */
  sculpt(cx, cy, radius, delta, strength) {
    const S = this.size;
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = ((cx + dx) % S + S) % S;
        const py = ((cy + dy) % S + S) % S;
        const i  = py * S + px;
        const t  = strength * (1 - Math.sqrt(dx*dx + dy*dy) / radius);
        this.heightmap[i] = Math.max(0, Math.min(1, this.heightmap[i] + delta * t));
      }
    }
  }

  /**
   * Smooth terrain by blending each pixel toward the average of its 3×3 neighbourhood.
   * Applied within a circular brush region with radial falloff.
   *
   * @param {number} cx       - Centre X in heightmap pixels
   * @param {number} cy       - Centre Y in heightmap pixels
   * @param {number} radius   - Brush radius in pixels
   * @param {number} strength - Smoothing weight per stroke in [0, 1]
   */
  smooth(cx, cy, radius, strength) {
    const S = this.size;
    const r2 = radius * radius;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const px = ((cx + dx) % S + S) % S;
        const py = ((cy + dy) % S + S) % S;

        // Average with neighbours
        let sum = 0, count = 0;
        for (let ny = -1; ny <= 1; ny++) {
          for (let nx2 = -1; nx2 <= 1; nx2++) {
            const qx = ((px + nx2) % S + S) % S;
            const qy = ((py + ny)  % S + S) % S;
            sum += this.heightmap[qy * S + qx];
            count++;
          }
        }
        const avg = sum / count;
        const i   = py * S + px;
        const t   = strength * (1 - Math.sqrt(dx*dx + dy*dy) / radius);
        this.heightmap[i] += (avg - this.heightmap[i]) * t;
      }
    }
  }

  /**
   * Rotate the heightmap so that the given longitude becomes the new prime meridian (0°).
   * Each row is cyclically shifted; no data is lost.
   *
   * @param {number} degrees - Longitude to move to 0° (positive = shift east)
   */
  shiftLon(degrees) {
    const S     = this.size;
    const shift = (Math.round((degrees / 360) * S) % S + S) % S;
    if (shift === 0) return;
    const hm  = this.heightmap;
    const tmp = new Float32Array(S);
    for (let y = 0; y < S; y++) {
      const row = y * S;
      tmp.set(hm.subarray(row, row + S));
      for (let x = 0; x < S; x++) {
        hm[row + x] = tmp[(x + shift) % S];
      }
    }
  }

  /** Mirror the heightmap left↔right (east↔west) */
  flipEW() {
    const S  = this.size;
    const hm = this.heightmap;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S >> 1; x++) {
        const a = y * S + x;
        const b = y * S + (S - 1 - x);
        const tmp = hm[a]; hm[a] = hm[b]; hm[b] = tmp;
      }
    }
  }

  /** Minimal 3D simplex noise factory (no external dep needed) */
  _makeNoise() {
    // Permutation table
    const p = new Uint8Array(512);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < 256; i++) p[256 + i] = p[i];

    const G3 = 1 / 6;
    const grad3 = [
      [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
      [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
      [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
    ];

    function dot(g, x, y, z) { return g[0]*x + g[1]*y + g[2]*z; }

    return function noise3(xin, yin, zin) {
      const s  = (xin + yin + zin) / 3;
      const i  = Math.floor(xin + s);
      const j  = Math.floor(yin + s);
      const k  = Math.floor(zin + s);
      const t  = (i + j + k) * G3;
      const x0 = xin - (i - t);
      const y0 = yin - (j - t);
      const z0 = zin - (k - t);

      let i1, j1, k1, i2, j2, k2;
      if (x0 >= y0) {
        if (y0 >= z0)      { i1=1;j1=0;k1=0;i2=1;j2=1;k2=0; }
        else if (x0 >= z0) { i1=1;j1=0;k1=0;i2=1;j2=0;k2=1; }
        else               { i1=0;j1=0;k1=1;i2=1;j2=0;k2=1; }
      } else {
        if (y0 < z0)       { i1=0;j1=0;k1=1;i2=0;j2=1;k2=1; }
        else if (x0 < z0)  { i1=0;j1=1;k1=0;i2=0;j2=1;k2=1; }
        else               { i1=0;j1=1;k1=0;i2=1;j2=1;k2=0; }
      }

      const x1=x0-i1+G3, y1=y0-j1+G3, z1=z0-k1+G3;
      const x2=x0-i2+2*G3, y2=y0-j2+2*G3, z2=z0-k2+2*G3;
      const x3=x0-1+3*G3, y3=y0-1+3*G3, z3=z0-1+3*G3;

      const ii=i&255, jj=j&255, kk=k&255;
      const gi0=p[ii+p[jj+p[kk]]]%12;
      const gi1=p[ii+i1+p[jj+j1+p[kk+k1]]]%12;
      const gi2=p[ii+i2+p[jj+j2+p[kk+k2]]]%12;
      const gi3=p[ii+1+p[jj+1+p[kk+1]]]%12;

      let n0=0, t0=0.6-x0*x0-y0*y0-z0*z0;
      if (t0 >= 0) { t0*=t0; n0=t0*t0*dot(grad3[gi0],x0,y0,z0); }
      let n1=0, t1=0.6-x1*x1-y1*y1-z1*z1;
      if (t1 >= 0) { t1*=t1; n1=t1*t1*dot(grad3[gi1],x1,y1,z1); }
      let n2=0, t2=0.6-x2*x2-y2*y2-z2*z2;
      if (t2 >= 0) { t2*=t2; n2=t2*t2*dot(grad3[gi2],x2,y2,z2); }
      let n3=0, t3=0.6-x3*x3-y3*y3-z3*z3;
      if (t3 >= 0) { t3*=t3; n3=t3*t3*dot(grad3[gi3],x3,y3,z3); }

      return 32 * (n0 + n1 + n2 + n3);
    };
  }
}
