/**
 * storage.js — Save/load planet data as JSON, export PNG screenshot,
 *              and persist to browser localStorage.
 *
 * localStorage key: "mapmaker_saves"
 * Structure: { [slotName]: { version, savedAt, planet, heightmap (base64), markers } }
 *
 * The heightmap is stored as a base64-encoded Float32Array (~350 KB for 512²)
 * which fits comfortably within the 5–10 MB localStorage quota.
 */

const LS_KEY = 'mapmaker_saves';

export class Storage {
  constructor(state, terrain, planet, markers, orbit) {
    this.state   = state;
    this.terrain = terrain;
    this.planet  = planet;
    this.markers = markers;
    this.orbit   = orbit;
  }

  // ── localStorage ─────────────────────────────────

  /** Return all save slots: { [name]: { savedAt, planet } } */
  listSaves() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch { return {}; }
  }

  /** Save current planet to a named browser slot */
  saveToBrowser(slotName) {
    const saves = this.listSaves();
    saves[slotName] = {
      version:  1,
      savedAt:  new Date().toISOString(),
      planet:   {
        name:        this.state.planet.name,
        description: this.state.planet.description,
        radius:      this.state.planet.radius,
        settings:    this.state.planet.settings,
      },
      orbit:     this.orbit.toJSON(),
      heightmap: this._heightmapToBase64(),
      markers:   this.markers.toJSON(),
    };
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(saves));
      return true;
    } catch (e) {
      console.error('localStorage save failed:', e);
      return false;
    }
  }

  /** Load a named slot into the app */
  loadFromBrowser(slotName) {
    const saves = this.listSaves();
    const data  = saves[slotName];
    if (!data) throw new Error(`Slot "${slotName}" not found`);
    this._applyData(data);
    return data;
  }

  /**
   * Find the most recently saved slot and load it.
   * Returns the loaded data object, or null if no saves exist.
   */
  autoLoad() {
    const saves = this.listSaves();
    const slots = Object.keys(saves);
    if (!slots.length) return null;
    // Pick the slot with the newest savedAt timestamp
    const latest = slots.reduce((best, slot) =>
      saves[slot].savedAt > saves[best].savedAt ? slot : best
    );
    this._applyData(saves[latest]);
    return { slotName: latest, ...saves[latest] };
  }

  /** Delete a named browser slot */
  deleteSave(slotName) {
    const saves = this.listSaves();
    delete saves[slotName];
    localStorage.setItem(LS_KEY, JSON.stringify(saves));
  }

  // ── File export / import ─────────────────────────

  exportJSON() {
    const data = {
      version:  1,
      planet:   {
        name:        this.state.planet.name,
        description: this.state.planet.description,
        radius:      this.state.planet.radius,
        settings:    this.state.planet.settings,
      },
      orbit:     this.orbit.toJSON(),
      heightmap: Array.from(this.terrain.heightmap),
      markers:   this.markers.toJSON(),
    };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    this._download(blob, `${this.state.planet.name || 'planet'}.json`);
  }

  importJSON(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = JSON.parse(e.target.result);
          if (data.version !== 1) throw new Error('Unknown format version');
          this._applyData(data);
          resolve(data);
        } catch (err) { reject(err); }
      };
      reader.readAsText(file);
    });
  }

  exportPNG() {
    this.planet.renderer.render(this.planet.scene, this.planet.camera);
    this.planet.canvas.toBlob(blob => {
      this._download(blob, `${this.state.planet.name || 'planet'}.png`);
    }, 'image/png');
  }

  // ── Internal helpers ──────────────────────────────

  _applyData(data) {
    Object.assign(this.state.planet, data.planet);

    // heightmap may be base64 (browser save) or plain array (JSON export)
    if (typeof data.heightmap === 'string') {
      this.terrain.heightmap = this._base64ToHeightmap(data.heightmap);
    } else {
      this.terrain.heightmap = new Float32Array(data.heightmap);
    }

    this.planet.updateGeometry(this.terrain.heightmap);
    this.markers.fromJSON(data.markers || []);

    // Restore orbit data if present (graceful fallback for older saves)
    if (data.orbit) this.orbit.fromJSON(data.orbit);
  }

  _heightmapToBase64() {
    const bytes  = new Uint8Array(this.terrain.heightmap.buffer);
    let binary   = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  _base64ToHeightmap(b64) {
    const binary = atob(b64);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    if (bytes.byteLength % 4 !== 0) {
      throw new Error(`Heightmap data is corrupt (byte length ${bytes.byteLength} is not a multiple of 4)`);
    }
    const expected = this.terrain.size * this.terrain.size * 4; // Float32 = 4 bytes
    if (bytes.byteLength !== expected) {
      throw new Error(`Heightmap size mismatch: expected ${expected} bytes for ${this.terrain.size}² map, got ${bytes.byteLength}`);
    }
    return new Float32Array(bytes.buffer);
  }

  _download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }
}
