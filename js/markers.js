/**
 * markers.js — Place, render, and manage named markers on the globe
 */

import * as THREE from 'three';

export class Markers {
  constructor(planet) {
    this.planet  = planet;
    this.scene   = planet.scene;
    this._items  = []; // { id, name, description, lat, lon, mesh, sprite }
  }

  /** Add a marker at a 3D hit point */
  add(hit, name, description) {
    const id = crypto.randomUUID();

    // Small sphere pin
    const geo  = new THREE.SphereGeometry(0.012, 8, 8);
    const mat  = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5 });
    const mesh = new THREE.Mesh(geo, mat);

    // Place just above surface
    const pos = hit.point.clone().normalize().multiplyScalar(1.02);
    mesh.position.copy(pos);
    this.scene.add(mesh);

    const marker = { id, name, description, lat: hit.lat, lon: hit.lon, mesh };
    this._items.push(marker);
    return marker;
  }

  remove(id) {
    const idx = this._items.findIndex(m => m.id === id);
    if (idx === -1) return;
    const m = this._items[idx];
    this.scene.remove(m.mesh);
    this._items.splice(idx, 1);
  }

  getAll() { return this._items; }

  /** Serialise for JSON export */
  toJSON() {
    return this._items.map(({ id, name, description, lat, lon }) =>
      ({ id, name, description, lat, lon })
    );
  }

  /** Restore from JSON */
  fromJSON(list) {
    // Clear existing
    for (const m of this._items) this.scene.remove(m.mesh);
    this._items = [];

    for (const item of list) {
      // Y-up spherical coordinates matching planet.js raycast convention:
      //   lat → asin(y),  lon → atan2(z, x)
      const latRad = item.lat * Math.PI / 180;
      const lonRad = item.lon * Math.PI / 180;
      const fakeHit = {
        lat: item.lat, lon: item.lon,
        point: new THREE.Vector3(
          Math.cos(latRad) * Math.cos(lonRad),
          Math.sin(latRad),
          Math.cos(latRad) * Math.sin(lonRad),
        ),
      };
      const m = this.add(fakeHit, item.name, item.description);
      m.id = item.id;
    }
  }
}
