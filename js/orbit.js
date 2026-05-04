/**
 * orbit.js — Orbital & stellar context for the planet/moon
 *
 * Handles:
 *  - Star spectral class presets (drives sun light color + intensity)
 *  - Mode: planet orbiting a star vs. moon orbiting a gas giant
 *  - Gas giant visual in the Three.js scene (banded sphere in the sky)
 *  - Secondary "giant reflected light" fill
 */

import * as THREE from 'three';

// ── Star spectral presets ─────────────────────────────
export const STAR_PRESETS = {
  O: { label: 'O — Blue supergiant',  temp: 40000, luminosity: 100000, sunColor: 0x9bb0ff, ambientColor: 0x1a2060 },
  B: { label: 'B — Blue-white giant', temp: 20000, luminosity: 1000,   sunColor: 0xaabfff, ambientColor: 0x101830 },
  A: { label: 'A — White',            temp: 8500,  luminosity: 20,     sunColor: 0xcad7ff, ambientColor: 0x111828 },
  F: { label: 'F — Yellow-white',     temp: 6750,  luminosity: 3,      sunColor: 0xf8f7ff, ambientColor: 0x12182a },
  G: { label: 'G — Yellow (Sun-like)',temp: 5778,  luminosity: 1,      sunColor: 0xfff4ea, ambientColor: 0x112244 },
  K: { label: 'K — Orange dwarf',     temp: 4500,  luminosity: 0.4,    sunColor: 0xffd2a1, ambientColor: 0x1a1020 },
  M: { label: 'M — Red dwarf',        temp: 3000,  luminosity: 0.04,   sunColor: 0xff8855, ambientColor: 0x1a0e0e },
};

// ── Gas giant type presets ────────────────────────────
export const GIANT_PRESETS = {
  hot_jupiter:  { label: 'Hot Jupiter',  colors: ['#c8874a','#e8b870','#a05828','#d4944c'], scale: 1.4 },
  cold_giant:   { label: 'Cold Gas Giant', colors: ['#c8a060','#e0c090','#b08848','#d4b468'], scale: 1.0 },
  ice_giant:    { label: 'Ice Giant',    colors: ['#5090c0','#80b8e0','#3870a0','#60a0d0'], scale: 0.7 },
  brown_dwarf:  { label: 'Brown Dwarf',  colors: ['#703820','#a05030','#502818','#804028'], scale: 1.8 },
};

export const DEFAULT_ORBIT = {
  mode: 'planet',          // 'planet' | 'moon'
  star: {
    name:        'The Star',
    type:        'G',
    age:         4.6,      // billion years
    customColor: false,
  },
  planetOrbit: {
    semiMajorAxis: 1.0,    // AU
    period:        365,    // days
    eccentricity:  0.017,
    axialTilt:     23.5,   // degrees
  },
  gasGiant: {
    name:            'The Giant',
    type:            'cold_giant',
    mass:            1.0,  // Jupiter masses
    radius:          1.0,  // Jupiter radii
    distanceFromStar: 5.2, // AU
    starPeriod:      4333, // days
    showInScene:     true,
  },
  moonOrbit: {
    semiMajorAxis:  400000, // km
    period:         15.0,   // days
    eccentricity:   0.01,
    inclination:    0,      // degrees
    tidallyLocked:  true,
  },
};

export class Orbit {
  constructor(planet) {
    this.planet = planet;
    this.scene  = planet.scene;
    this.data   = structuredClone(DEFAULT_ORBIT);

    this._giantMesh  = null;
    this._giantLight = null;

    this.applyStarLighting();
  }

  // ── Apply star colour/intensity to scene lights ───
  applyStarLighting() {
    const preset = STAR_PRESETS[this.data.star.type] || STAR_PRESETS.G;

    // Clamp luminosity to reasonable scene intensity
    const intensity = Math.max(0.6, Math.min(4.0, 1.0 + Math.log10(preset.luminosity + 1) * 0.9));

    this.planet.sun.color.setHex(preset.sunColor);
    this.planet.sun.intensity = intensity;
    this.planet.ambient.color.setHex(preset.ambientColor);

    // Night-fill takes a tint of the star colour (scattered light)
    this.planet.nightFill.color.setHex(preset.ambientColor);
  }

  // ── Build / rebuild gas giant mesh ───────────────
  buildGasGiant() {
    // Remove old
    if (this._giantMesh)  { this.scene.remove(this._giantMesh);  this._giantMesh = null; }
    if (this._giantLight) { this.scene.remove(this._giantLight); this._giantLight = null; }

    if (this.data.mode !== 'moon' || !this.data.gasGiant.showInScene) return;

    const preset  = GIANT_PRESETS[this.data.gasGiant.type] || GIANT_PRESETS.cold_giant;
    const gRadius = 4.5 * preset.scale; // scene units — big enough to dominate the sky
    const geo     = new THREE.SphereGeometry(gRadius, 64, 64);

    // Banded texture on a canvas
    const tex = this._makeBandTexture(preset.colors, 512);
    const mat = new THREE.MeshStandardMaterial({
      map:       tex,
      roughness: 0.9,
      metalness: 0.0,
    });

    this._giantMesh = new THREE.Mesh(geo, mat);
    // Position: off to one side, far enough to look like a sky object
    this._giantMesh.position.set(18, 4, -8);
    this.scene.add(this._giantMesh);

    // Reflected light from the gas giant (warm tint, low intensity)
    const baseColor = parseInt(preset.colors[0].replace('#',''), 16);
    this._giantLight = new THREE.PointLight(baseColor, 0.35, 60);
    this._giantLight.position.copy(this._giantMesh.position);
    this.scene.add(this._giantLight);
  }

  _makeBandTexture(colors, size) {
    const canvas = document.createElement('canvas');
    canvas.width  = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Horizontal bands with slight waviness
    const bandCount = 18 + Math.floor(Math.random() * 8);
    for (let b = 0; b < bandCount; b++) {
      const y0 = (b / bandCount) * size;
      const h  = (size / bandCount) * (0.7 + Math.random() * 0.6);
      ctx.fillStyle = colors[b % colors.length];
      ctx.fillRect(0, y0, size, h);
    }

    // Subtle gradient overlay for depth
    const grad = ctx.createLinearGradient(0, 0, size, 0);
    grad.addColorStop(0,   'rgba(0,0,0,0.35)');
    grad.addColorStop(0.4, 'rgba(0,0,0,0)');
    grad.addColorStop(0.6, 'rgba(0,0,0,0)');
    grad.addColorStop(1,   'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    return tex;
  }

  removeGasGiant() {
    if (this._giantMesh)  { this.scene.remove(this._giantMesh);  this._giantMesh = null; }
    if (this._giantLight) { this.scene.remove(this._giantLight); this._giantLight = null; }
  }

  // ── Derived display values ────────────────────────

  /** Estimated surface temperature in °C (very rough) */
  get estimatedSurfaceTemp() {
    const preset = STAR_PRESETS[this.data.star.type];
    const L  = preset.luminosity;
    const d  = this.data.mode === 'moon'
      ? this.data.gasGiant.distanceFromStar
      : this.data.planetOrbit.semiMajorAxis;
    // Simplified: T ∝ L^0.25 / d^0.5, calibrated to Earth ~15°C
    const T_kelvin = 278 * Math.pow(L, 0.25) / Math.sqrt(d);
    return Math.round(T_kelvin - 273);
  }

  /** Orbital period label for the world (around star or giant) */
  get yearLabel() {
    if (this.data.mode === 'moon') {
      const d = this.data.moonOrbit.period;
      return `${d} days (around giant)`;
    }
    const d = this.data.planetOrbit.period;
    return d < 500 ? `${d} days` : `${(d / 365.25).toFixed(2)} years`;
  }

  toJSON() { return structuredClone(this.data); }
  fromJSON(d) { Object.assign(this.data, d); this.applyStarLighting(); this.buildGasGiant(); }
}
