/**
 * ui.js — Wires DOM controls to app state and modules
 */

import { heightToTerrainId, TERRAIN_HEIGHT } from './terrain.js';
import { STAR_PRESETS, GIANT_PRESETS } from './orbit.js';

export class UI {
  constructor(state, planet, terrain, brush, markers, storage, mapView, orbit, orbitalView) {
    this.state   = state;
    this.planet  = planet;
    this.terrain = terrain;
    this.brush   = brush;
    this.markers = markers;
    this.storage = storage;
    this.mapView     = mapView;
    this.orbit       = orbit;
    this.orbitalView = orbitalView;

    this._pendingMarkerHit = null;
    this._currentView = 'globe'; // 'globe' | 'flat'

    this._bindViewToggle();
    this._bindTools();
    this._bindTerrainTypes();
    this._bindBrushControls();
    this._bindGenerateControls();
    this._bindPlanetInfo();
    this._bindFileIO();
    this._bindMarkerDialog();
    this._bindStatusBar();
    this._bindMarkerClick();
    this._bindMapViewPainting();
    this._bindSunControls();
    this._bindOverlayToggles();
    this._bindBrowserSaves();
    this._bindOrbitDesigner();
  }

  // ── View toggle (Globe ↔ Flat) ───────────────────
  _bindViewToggle() {
    document.querySelectorAll('.view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this._currentView = btn.dataset.view;
        this._switchView(this._currentView);
      });
    });
  }

  _switchView(view) {
    const globeCanvas   = document.getElementById('planet-canvas');
    const mapCanvas     = document.getElementById('map-canvas');
    const orbitalCanvas = document.getElementById('orbital-canvas');

    // Stop orbital animation when leaving that view
    if (this._currentView === 'orbital') this.orbitalView.stop();

    globeCanvas.style.display   = view === 'globe'   ? 'block' : 'none';
    mapCanvas.style.display     = view === 'flat'    ? 'block' : 'none';
    orbitalCanvas.style.display = view === 'orbital' ? 'block' : 'none';

    if (view === 'flat') {
      const dpr = window.devicePixelRatio || 1;
      mapCanvas.width  = mapCanvas.clientWidth  * dpr;
      mapCanvas.height = mapCanvas.clientHeight * dpr;
      this.mapView.fitToCanvas(dpr);
      this.mapView.renderBuffer();
      this.mapView.render();
    }

    if (view === 'orbital') {
      // Defer start by one frame so the browser has laid out the canvas
      requestAnimationFrame(() => this.orbitalView.start());
    }
  }

  // ── Tool selection ───────────────────────────────
  _bindTools() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.tool = btn.dataset.tool;

        // Toggle OrbitControls: disable when painting on globe
        const orbiting = this.state.tool === 'orbit';
        this.planet.controls.enabled = orbiting;

        document.getElementById('status-mode').textContent =
          'Mode: ' + btn.dataset.tool.charAt(0).toUpperCase() + btn.dataset.tool.slice(1);
      });
    });
  }

  // ── Terrain type ─────────────────────────────────
  _bindTerrainTypes() {
    document.querySelectorAll('.terrain-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.terrain-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.state.terrainType = btn.dataset.terrain;
      });
    });
  }

  // ── Brush sliders ─────────────────────────────────
  _bindBrushControls() {
    this._slider('brush-size',     v => { this.state.brushSize     = +v; });
    this._slider('brush-strength', v => { this.state.brushStrength = +v; });
  }

  // ── Generate ──────────────────────────────────────
  _bindGenerateControls() {
    this._slider('gen-sea-level',  v => { this.state.planet.settings.seaLevel       = v / 100; });
    this._slider('gen-land-shape', v => { this.state.planet.settings.landShape      = v / 100; });
    this._slider('gen-continent',  v => { this.state.planet.settings.continentSize  = v / 100; });
    this._slider('gen-mountains',  v => { this.state.planet.settings.mountainHeight = v / 100; });
    this._slider('gen-roughness',  v => { this.state.planet.settings.roughness      = v / 100; });

    document.getElementById('btn-generate').addEventListener('click', () => {
      if (!confirm('Generate a new planet? This will replace all current terrain.')) return;
      this.terrain.generate(this.state.planet.settings);
      this.planet.updateGeometry(this.terrain.heightmap);
      // Re-render flat map buffer if it's visible
      if (this._currentView === 'flat') {
        this.mapView.renderBuffer();
        this.mapView.render();
      }
    });
  }

  // ── Planet info ───────────────────────────────────
  _bindPlanetInfo() {
    document.getElementById('planet-name').addEventListener('input', e => {
      this.state.planet.name = e.target.value;
    });
    document.getElementById('planet-radius').addEventListener('input', e => {
      this.state.planet.radius = +e.target.value;
    });
    document.getElementById('planet-notes').addEventListener('input', e => {
      this.state.planet.description = e.target.value;
    });
  }

  // ── File IO ───────────────────────────────────────
  _bindFileIO() {
    document.getElementById('btn-save').addEventListener('click', () => {
      this.storage.exportJSON();
    });

    document.getElementById('btn-screenshot').addEventListener('click', () => {
      this.storage.exportPNG();
    });

    document.getElementById('btn-export-flat').addEventListener('click', () => {
      this.mapView.renderBuffer(); // make sure buffer is current
      this.mapView.exportPNG(this.state.planet.name);
    });

    document.getElementById('btn-load').addEventListener('click', () => {
      document.getElementById('file-input').click();
    });

    document.getElementById('file-input').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = await this.storage.importJSON(file);
        document.getElementById('planet-name').value   = data.planet.name || '';
        document.getElementById('planet-radius').value = data.planet.radius || 6400;
        document.getElementById('planet-notes').value  = data.planet.description || '';
        this._refreshMarkerList();
        if (data.orbit) this._syncOrbitUI();
        if (this._currentView === 'flat') {
          this.mapView.renderBuffer();
          this.mapView.render();
        }
      } catch (err) {
        alert('Failed to load file: ' + err.message);
      }
      e.target.value = '';
    });
  }

  // ── Marker dialog ─────────────────────────────────
  _bindMarkerDialog() {
    const dialog = document.getElementById('marker-dialog');
    const form   = document.getElementById('marker-form');

    form.addEventListener('submit', e => {
      e.preventDefault();
      if (!this._pendingMarkerHit) return;
      const name = document.getElementById('marker-name-input').value.trim();
      const desc = document.getElementById('marker-desc-input').value.trim();
      this.markers.add(this._pendingMarkerHit, name, desc);
      this._pendingMarkerHit = null;
      dialog.close();
      this._refreshMarkerList();
    });

    document.getElementById('marker-cancel').addEventListener('click', () => {
      this._pendingMarkerHit = null;
      dialog.close();
    });
  }

  // ── Marker click — globe ──────────────────────────
  _bindMarkerClick() {
    this.planet.canvas.addEventListener('click', e => {
      if (this.state.tool !== 'marker') return;
      const hit = this.planet.raycast(e.clientX, e.clientY);
      if (!hit) return;
      this._pendingMarkerHit = hit;
      document.getElementById('marker-name-input').value = '';
      document.getElementById('marker-desc-input').value = '';
      document.getElementById('marker-dialog').showModal();
    });
  }

  // ── Painting in 2D flat view ──────────────────────
  _bindMapViewPainting() {
    this.mapView.onPaint = (e) => {
      if (this.state.tool === 'orbit' || this.state.tool === 'marker') return;

      const { px, py } = this.mapView.canvasToHeightmap(e.clientX, e.clientY);
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

      // Update both views
      this.mapView.renderBuffer();
      this.mapView.render();
      // Defer 3D update (expensive) until mouse is released
    };

    // On mouse-up in flat view, sync 3D geometry
    document.getElementById('map-canvas').addEventListener('mouseup', () => {
      this.planet.updateGeometry(this.terrain.heightmap);
    });

    // Marker placement in flat view
    document.getElementById('map-canvas').addEventListener('click', e => {
      if (this.state.tool !== 'marker') return;
      const { lat, lon } = this.mapView.canvasToLatLon(e.clientX, e.clientY);
      const phi   = (90 - lat) * Math.PI / 180;
      const theta = (lon + 180) * Math.PI / 180;
      // Build a minimal hit object compatible with markers.add()
      const x = Math.sin(phi) * Math.cos(theta);
      const y = Math.cos(phi);
      const z = Math.sin(phi) * Math.sin(theta);
      this._pendingMarkerHit = {
        lat, lon,
        point: this.planet._fakeVector3(x, y, z),
      };
      document.getElementById('marker-name-input').value = '';
      document.getElementById('marker-desc-input').value = '';
      document.getElementById('marker-dialog').showModal();
    });

    // Status bar updates from flat map hover
    this.mapView.onHover = (e) => {
      const { lat, lon } = this.mapView.canvasToLatLon(e.clientX, e.clientY);
      const { px, py }   = this.mapView.canvasToHeightmap(e.clientX, e.clientY);
      const S   = this.terrain.size;
      if (px >= 0 && px < S && py >= 0 && py < S) {
        const h = this.terrain.heightmap[py * S + px];
        document.getElementById('status-coords').textContent =
          `Lat: ${lat.toFixed(2)}°  Lon: ${lon.toFixed(2)}°`;
        document.getElementById('status-terrain').textContent =
          heightToTerrainId(h).charAt(0).toUpperCase() + heightToTerrainId(h).slice(1);
      }
    };
  }

  _refreshMarkerList() {
    // Keep flat map in sync
    if (this._currentView === 'flat') {
      this.mapView.renderBuffer();
      this.mapView.render();
    }

    const list = document.getElementById('marker-list');
    const all  = this.markers.getAll();
    if (!all.length) {
      list.innerHTML = '<li class="marker-empty">No markers placed yet.</li>';
      return;
    }
    list.innerHTML = all.map(m => `
      <li class="marker-item" data-id="${m.id}">
        <span>${m.name}</span>
        <span class="marker-remove" data-id="${m.id}" title="Remove">✕</span>
      </li>
    `).join('');

    list.querySelectorAll('.marker-remove').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        this.markers.remove(btn.dataset.id);
        this._refreshMarkerList();
      });
    });
  }

  // ── Status bar (globe) ────────────────────────────
  _bindStatusBar() {
    this.planet.canvas.addEventListener('mousemove', e => {
      const hit = this.planet.raycast(e.clientX, e.clientY);
      if (hit) {
        document.getElementById('status-coords').textContent =
          `Lat: ${hit.lat.toFixed(2)}°  Lon: ${hit.lon.toFixed(2)}°`;
        const h = this.terrain.heightmap[hit.py * this.terrain.size + hit.px];
        document.getElementById('status-terrain').textContent =
          heightToTerrainId(h).charAt(0).toUpperCase() + heightToTerrainId(h).slice(1);
      } else {
        document.getElementById('status-coords').textContent = 'Lat: —  Lon: —';
        document.getElementById('status-terrain').textContent = '—';
      }
      const zoom = (this.planet.zoomLevel * 10).toFixed(1);
      document.getElementById('status-zoom').textContent = `Zoom: ${zoom}×`;
    });
  }

  // ── Sun / time of day ─────────────────────────────
  _bindSunControls() {
    const angleEl = document.getElementById('sun-angle');
    const timeEl  = document.getElementById('sun-angle-val');
    const elevEl  = document.getElementById('sun-elevation');
    const elevVal = document.getElementById('sun-elevation-val');
    const animBtn = document.getElementById('btn-sun-animate');

    const updateSun = () => {
      const angle = +angleEl.value;
      const elev  = +elevEl.value;
      this.planet.setSunAngle(angle, elev);
      // Display as HH:MM — 0° = midnight, 180° = noon
      const hours  = ((angle + 180) % 360) / 15;
      const h      = Math.floor(hours) % 24;
      const m      = Math.floor((hours % 1) * 60);
      timeEl.textContent = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
      elevVal.textContent = `${elev > 0 ? '+' : ''}${elev}°`;
    };

    angleEl.addEventListener('input', updateSun);
    elevEl.addEventListener('input',  updateSun);
    updateSun(); // apply defaults

    // Animate toggle
    let animFrame = null;
    animBtn.addEventListener('click', () => {
      if (animFrame) {
        cancelAnimationFrame(animFrame);
        animFrame = null;
        animBtn.textContent = '▶ Animate Day';
      } else {
        animBtn.textContent = '⏹ Stop';
        const tick = () => {
          angleEl.value = (+angleEl.value + 0.3) % 360;
          updateSun();
          animFrame = requestAnimationFrame(tick);
        };
        animFrame = requestAnimationFrame(tick);
      }
    });
  }

  // ── Browser saves ─────────────────────────────────
  _bindBrowserSaves() {
    const nameInput = document.getElementById('save-slot-name');
    const saveBtn   = document.getElementById('btn-browser-save');

    // Default slot name to planet name
    document.getElementById('planet-name').addEventListener('input', e => {
      if (!nameInput.value || nameInput.value === nameInput.dataset.last) {
        nameInput.value = e.target.value;
        nameInput.dataset.last = e.target.value;
      }
    });

    saveBtn.addEventListener('click', () => {
      const name = nameInput.value.trim() || this.state.planet.name || 'Unnamed';
      const ok   = this.storage.saveToBrowser(name);
      if (ok) {
        this._flashBtn(saveBtn, 'Saved!');
        this._refreshBrowserSaves();
      } else {
        this._flashBtn(saveBtn, 'Error', true);
      }
    });

    this._refreshBrowserSaves();
  }

  _refreshBrowserSaves() {
    const list  = document.getElementById('browser-save-list');
    const saves = this.storage.listSaves();
    const names = Object.keys(saves);

    if (!names.length) {
      list.innerHTML = '<li class="marker-empty">No saves yet.</li>';
      return;
    }

    list.innerHTML = names.map(name => {
      const s    = saves[name];
      const date = new Date(s.savedAt);
      const fmt  = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`;
      return `
        <li class="save-item" data-slot="${this._esc(name)}">
          <div class="save-item-header">
            <span class="save-item-name">${this._esc(name)}</span>
            <span class="save-item-date">${fmt}</span>
          </div>
          <div class="save-item-actions">
            <button class="save-action-btn load-btn">Load</button>
            <button class="save-action-btn delete-btn delete">Delete</button>
          </div>
        </li>`;
    }).join('');

    list.querySelectorAll('.load-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const slot = btn.closest('[data-slot]').dataset.slot;
        try {
          const data = this.storage.loadFromBrowser(slot);
          // Sync UI fields
          document.getElementById('planet-name').value   = data.planet.name || '';
          document.getElementById('planet-radius').value = data.planet.radius || 6400;
          document.getElementById('planet-notes').value  = data.planet.description || '';
          document.getElementById('save-slot-name').value = slot;
          this._refreshMarkerList();
          if (data.orbit) this._syncOrbitUI();
          if (this._currentView === 'flat') {
            this.mapView.renderBuffer();
            this.mapView.render();
          }
          this._flashBtn(btn, 'Loaded!');
        } catch (err) {
          alert('Load failed: ' + err.message);
        }
      });
    });

    list.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const slot = btn.closest('[data-slot]').dataset.slot;
        if (confirm(`Delete save "${slot}"?`)) {
          this.storage.deleteSave(slot);
          this._refreshBrowserSaves();
        }
      });
    });
  }

  /**
   * Called from app.js on startup: find the most-recently-saved browser slot
   * and restore it, syncing all UI fields. Returns true if a save was loaded.
   */
  loadMostRecent() {
    const data = this.storage.autoLoad();
    if (!data) return false;

    document.getElementById('planet-name').value   = data.planet?.name        || '';
    document.getElementById('planet-radius').value = data.planet?.radius      || 6400;
    document.getElementById('planet-notes').value  = data.planet?.description || '';
    document.getElementById('save-slot-name').value = data.slotName || '';

    this._refreshMarkerList();
    if (data.orbit) this._syncOrbitUI();
    this.mapView.renderBuffer();

    return true;
  }

  _flashBtn(btn, msg, error = false) {
    const orig = btn.textContent;
    btn.textContent = msg;
    btn.style.color = error ? 'var(--danger)' : 'var(--accent)';
    setTimeout(() => { btn.textContent = orig; btn.style.color = ''; }, 1500);
  }

  // ── Orbit designer ────────────────────────────────
  _bindOrbitDesigner() {
    // Collapsible panel
    document.querySelector('[data-target="orbit-body"]').addEventListener('click', () => {
      const body = document.getElementById('orbit-body');
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : 'flex';
    });

    // Populate star type <select>
    const starSel = document.getElementById('orbit-star-type');
    for (const [key, preset] of Object.entries(STAR_PRESETS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = preset.label;
      if (key === 'G') opt.selected = true;
      starSel.appendChild(opt);
    }

    // Populate gas giant type <select>
    const giantSel = document.getElementById('orbit-giant-type');
    for (const [key, preset] of Object.entries(GIANT_PRESETS)) {
      const opt = document.createElement('option');
      opt.value = key;
      opt.textContent = preset.label;
      if (key === 'cold_giant') opt.selected = true;
      giantSel.appendChild(opt);
    }

    // Mode toggle
    document.querySelectorAll('.orbit-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.orbit-mode-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.orbit.data.mode = btn.dataset.mode;
        const isMoon = btn.dataset.mode === 'moon';
        document.getElementById('orbit-planet-group').style.display = isMoon ? 'none' : 'flex';
        document.getElementById('orbit-giant-group').style.display  = isMoon ? 'flex' : 'none';
        this.orbit.buildGasGiant();
        this._updateOrbitDerived();
      });
    });

    // Star fields
    document.getElementById('orbit-star-name').addEventListener('input', e => {
      this.orbit.data.star.name = e.target.value;
    });

    starSel.addEventListener('change', e => {
      this.orbit.data.star.type = e.target.value;
      this.orbit.applyStarLighting();
      this._updateStarStats();
      this._updateOrbitDerived();
    });

    document.getElementById('orbit-star-age').addEventListener('input', e => {
      this.orbit.data.star.age = +e.target.value;
      this._updateOrbitDerived();
    });

    // Planet orbit fields
    const bindNum = (id, path) => {
      document.getElementById(id).addEventListener('input', e => {
        const keys = path.split('.');
        let obj = this.orbit.data;
        for (let i = 0; i < keys.length - 1; i++) obj = obj[keys[i]];
        obj[keys[keys.length - 1]] = +e.target.value;
        this._updateOrbitDerived();
      });
    };

    bindNum('orbit-au',           'planetOrbit.semiMajorAxis');
    bindNum('orbit-period',       'planetOrbit.period');
    bindNum('orbit-eccentricity', 'planetOrbit.eccentricity');
    bindNum('orbit-axial-tilt',   'planetOrbit.axialTilt');

    // Gas giant fields
    document.getElementById('orbit-giant-name').addEventListener('input', e => {
      this.orbit.data.gasGiant.name = e.target.value;
    });

    giantSel.addEventListener('change', e => {
      this.orbit.data.gasGiant.type = e.target.value;
      this.orbit.buildGasGiant();
    });

    bindNum('orbit-giant-mass',   'gasGiant.mass');
    bindNum('orbit-giant-radius', 'gasGiant.radius');
    bindNum('orbit-giant-au',     'gasGiant.distanceFromStar');
    bindNum('orbit-giant-period', 'gasGiant.starPeriod');
    bindNum('orbit-moon-sma',     'moonOrbit.semiMajorAxis');
    bindNum('orbit-moon-period',  'moonOrbit.period');
    bindNum('orbit-moon-ecc',     'moonOrbit.eccentricity');
    bindNum('orbit-moon-inc',     'moonOrbit.inclination');

    document.getElementById('orbit-giant-show').addEventListener('change', e => {
      this.orbit.data.gasGiant.showInScene = e.target.checked;
      e.target.checked ? this.orbit.buildGasGiant() : this.orbit.removeGasGiant();
    });

    document.getElementById('orbit-tidal-lock').addEventListener('change', e => {
      this.orbit.data.moonOrbit.tidallyLocked = e.target.checked;
      this._updateOrbitDerived();
    });

    this._updateStarStats();
    this._updateOrbitDerived();
  }

  /** Push orbit.data back into all DOM fields after a load */
  _syncOrbitUI() {
    const d = this.orbit.data;

    // Mode
    document.querySelectorAll('.orbit-mode-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === d.mode);
    });
    document.getElementById('orbit-planet-group').style.display = d.mode === 'moon' ? 'none' : 'flex';
    document.getElementById('orbit-giant-group').style.display  = d.mode === 'moon' ? 'flex' : 'none';

    // Star
    document.getElementById('orbit-star-name').value = d.star.name || '';
    document.getElementById('orbit-star-type').value = d.star.type || 'G';
    document.getElementById('orbit-star-age').value  = d.star.age  || 4.6;

    // Planet orbit
    document.getElementById('orbit-au').value          = d.planetOrbit.semiMajorAxis;
    document.getElementById('orbit-period').value      = d.planetOrbit.period;
    document.getElementById('orbit-eccentricity').value= d.planetOrbit.eccentricity;
    document.getElementById('orbit-axial-tilt').value  = d.planetOrbit.axialTilt;

    // Gas giant
    document.getElementById('orbit-giant-name').value  = d.gasGiant.name   || '';
    document.getElementById('orbit-giant-type').value  = d.gasGiant.type   || 'cold_giant';
    document.getElementById('orbit-giant-mass').value  = d.gasGiant.mass;
    document.getElementById('orbit-giant-radius').value= d.gasGiant.radius;
    document.getElementById('orbit-giant-au').value    = d.gasGiant.distanceFromStar;
    document.getElementById('orbit-giant-period').value= d.gasGiant.starPeriod;
    document.getElementById('orbit-giant-show').checked= !!d.gasGiant.showInScene;

    // Moon orbit
    document.getElementById('orbit-moon-sma').value    = d.moonOrbit.semiMajorAxis;
    document.getElementById('orbit-moon-period').value = d.moonOrbit.period;
    document.getElementById('orbit-moon-ecc').value    = d.moonOrbit.eccentricity;
    document.getElementById('orbit-moon-inc').value    = d.moonOrbit.inclination;
    document.getElementById('orbit-tidal-lock').checked= !!d.moonOrbit.tidallyLocked;

    this._updateStarStats();
    this._updateOrbitDerived();
  }

  _updateStarStats() {
    const preset = STAR_PRESETS[this.orbit.data.star.type];
    const swatch = `#${preset.sunColor.toString(16).padStart(6,'0')}`;
    document.getElementById('star-stats').innerHTML = `
      <div class="orbit-stat-row"><span>Temperature</span><span class="orbit-stat-val">${preset.temp.toLocaleString()} K</span></div>
      <div class="orbit-stat-row"><span>Luminosity</span><span class="orbit-stat-val">${preset.luminosity}× Sol</span></div>
      <div class="orbit-stat-row"><span>Light colour</span><span class="orbit-stat-val"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${swatch};margin-right:4px;vertical-align:middle"></span>${swatch}</span></div>
    `;
  }

  _updateOrbitDerived() {
    // Refresh orbital view if it's currently visible
    if (this._currentView === 'orbital' && !this.orbitalView._animating) {
      this.orbitalView.render();
    }
    const el   = document.getElementById('orbit-derived');
    const temp = this.orbit.estimatedSurfaceTemp;
    const year = this.orbit.yearLabel;
    const mode = this.orbit.data.mode;
    const tl   = mode === 'moon' && this.orbit.data.moonOrbit.tidallyLocked;

    el.innerHTML = `
      <div class="orbit-stat-row"><span>Est. surface temp</span><span class="orbit-stat-val">${temp}°C</span></div>
      <div class="orbit-stat-row"><span>Year length</span><span class="orbit-stat-val">${year}</span></div>
      ${mode === 'moon' ? `<div class="orbit-stat-row"><span>Tidally locked</span><span class="orbit-stat-val">${tl ? 'Yes' : 'No'}</span></div>` : ''}
      ${mode === 'moon' ? `<div class="orbit-stat-row"><span>Giant dist. from star</span><span class="orbit-stat-val">${this.orbit.data.gasGiant.distanceFromStar} AU</span></div>` : `<div class="orbit-stat-row"><span>Planet dist. from star</span><span class="orbit-stat-val">${this.orbit.data.planetOrbit.semiMajorAxis} AU</span></div>`}
    `;
  }

  _esc(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Overlay toggles (graticule, poles, markers) ───
  _bindOverlayToggles() {
    document.getElementById('toggle-graticule').addEventListener('change', e => {
      this.planet.setGraticuleVisible(e.target.checked);
    });
    document.getElementById('toggle-poles').addEventListener('change', e => {
      this.planet.setPoleMarkersVisible(e.target.checked);
    });

    const rerenderFlat = () => {
      if (this._currentView === 'flat') {
        this.mapView.renderBuffer();
        this.mapView.render();
      }
    };

    document.getElementById('toggle-markers').addEventListener('change', e => {
      this.mapView.showMarkers = e.target.checked;
      rerenderFlat();
    });
    document.getElementById('toggle-marker-labels').addEventListener('change', e => {
      this.mapView.showLabels = e.target.checked;
      rerenderFlat();
    });
  }

  // ── Helper: wire a range slider + live value display ──
  _slider(id, onChange) {
    const el  = document.getElementById(id);
    const val = document.getElementById(id + '-val');
    el.addEventListener('input', () => {
      if (val) val.textContent = el.value;
      onChange(el.value);
    });
  }
}
