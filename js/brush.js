/**
 * brush.js — Mouse/touch painting on the globe via raycasting
 */

import { TERRAIN_HEIGHT } from './terrain.js';

export class Brush {
  constructor(planet, terrain, state) {
    this.planet  = planet;
    this.terrain = terrain;
    this.state   = state;
    this._painting = false;
    this._bindEvents();
  }

  _bindEvents() {
    const canvas = this.planet.canvas;

    canvas.addEventListener('mousedown', e => {
      if (this.state.tool === 'orbit' || this.state.tool === 'marker') return;
      this._painting = true;
      this._apply(e);
    });

    canvas.addEventListener('mousemove', e => {
      if (!this._painting) return;
      this._apply(e);
    });

    canvas.addEventListener('mouseup',   () => { this._painting = false; });
    canvas.addEventListener('mouseleave',() => { this._painting = false; });
  }

  _apply(e) {
    const hit = this.planet.raycast(e.clientX, e.clientY);
    if (!hit) return;

    const { px, py } = hit;
    const radius   = Math.max(1, Math.floor(this.state.brushSize));
    const strength = this.state.brushStrength / 100;

    switch (this.state.tool) {
      case 'paint':
        this.terrain.paint(px, py, radius, TERRAIN_HEIGHT[this.state.terrainType], strength);
        break;
      case 'raise':
        this.terrain.sculpt(px, py, radius, +0.01, strength);
        break;
      case 'lower':
        this.terrain.sculpt(px, py, radius, -0.01, strength);
        break;
      case 'smooth':
        this.terrain.smooth(px, py, radius, strength);
        break;
    }

    this.planet.updateGeometry(this.terrain.heightmap);
  }
}
