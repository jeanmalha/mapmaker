/**
 * app.js — Bootstrap & global state
 *
 * Entry point for the mapmaker application. Instantiates all subsystems,
 * wires them together, then either restores the most recent browser save
 * or generates a fresh planet if no save exists.
 */

import { Planet }  from './planet.js';
import { Terrain } from './terrain.js';
import { Brush }   from './brush.js';
import { Markers } from './markers.js';
import { MapView } from './mapview.js';
import { Orbit }       from './orbit.js';
import { OrbitalView } from './orbitalview.js';
import { UI }          from './ui.js';
import { Storage }     from './storage.js';

/**
 * Shared application state. Mutated in place by UI and subsystems.
 *
 * @property {string}  tool         - Active editing tool: 'orbit' | 'paint' | 'raise' | 'lower' | 'smooth' | 'marker' | 'setlon'
 * @property {string}  terrainType  - Terrain id used by the paint brush (e.g. 'ocean', 'plains')
 * @property {number}  brushSize    - Brush radius in heightmap pixels
 * @property {number}  brushStrength - Brush opacity/strength 0–100
 * @property {object}  planet       - Per-planet metadata and generation settings
 */
export const state = {
  tool: 'orbit',        // orbit | paint | raise | lower | smooth | marker
  terrainType: 'ocean', // which terrain type the paint brush uses
  brushSize: 10,
  brushStrength: 50,
  planet: {
    name: '',
    description: '',
    radius: 6400,
    markers: [],
    settings: {
      seaLevel:      0.42,
      landShape:     0.50,
      continentSize: 0.50,
      mountainHeight: 0.60,
      roughness:     0.40,
    },
    heightmap: null,
  },
};

// ── Init ─────────────────────────────────────────────
async function main() {
  const globeCanvas = document.getElementById('planet-canvas');
  const mapCanvas   = document.getElementById('map-canvas');

  const orbitalCanvas = document.getElementById('orbital-canvas');

  const terrain     = new Terrain(512);
  const planet      = new Planet(globeCanvas, terrain);
  const mapView     = new MapView(mapCanvas, terrain);
  const orbit       = new Orbit(planet);
  const orbitalView = new OrbitalView(orbitalCanvas, orbit);
  const brush       = new Brush(planet, terrain, state);
  const markers     = new Markers(planet);
  mapView.setMarkers(markers);
  const storage     = new Storage(state, terrain, planet, markers, orbit);
  const ui          = new UI(state, planet, terrain, brush, markers, storage, mapView, orbit, orbitalView);

  // Restore the most recent browser save, or generate a fresh planet
  const restored = ui.loadMostRecent();
  if (!restored) {
    terrain.generate(state.planet.settings);
    planet.updateGeometry(terrain.heightmap);
    mapView.renderBuffer();
    state.planet.heightmap = terrain.heightmap;
  }

  planet.animate();
}

main();
