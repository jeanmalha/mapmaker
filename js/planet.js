/**
 * planet.js — Three.js globe, lighting, atmosphere, animation loop
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightToColor } from './terrain.js';

const SPHERE_SEGMENTS    = 256;   // base resolution
const DISPLACE_SCALE_MAX = 0.15;  // max vertex displacement at full relief

export class Planet {
  constructor(canvas, terrain) {
    this.canvas  = canvas;
    this.terrain = terrain;
    this.reliefScale = 1.0; // 0 = flat sphere, 1 = full displacement
    this._setupScene();
    this._setupGlobe();
    this._setupAtmosphere();
    this._setupStars();
    this._setupLights();
    this._buildGraticule();
    this._buildPoleMarkers();
    this._setupControls();
    this._setupResize();
  }

  // ── Scene ─────────────────────────────────────────
  _setupScene() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true, // needed for PNG export
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);

    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, this._aspect(), 0.01, 1000);
    this.camera.position.set(0, 0, 3);
  }

  // ── Globe mesh ────────────────────────────────────
  _setupGlobe() {
    const geo = new THREE.SphereGeometry(1, SPHERE_SEGMENTS, SPHERE_SEGMENTS);
    // Store original positions for displacement
    this._basePositions = geo.attributes.position.array.slice();

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
    });

    // Add color attribute
    const colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    this.globe = new THREE.Mesh(geo, this.material);
    this.scene.add(this.globe);
  }

  // ── Atmosphere shell ──────────────────────────────
  _setupAtmosphere() {
    const geo = new THREE.SphereGeometry(1.025, 64, 64);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x4488ff,
      transparent: true,
      opacity: 0.07,
      side: THREE.FrontSide,
      depthWrite: false,
    });
    this.atmosphere = new THREE.Mesh(geo, mat);
    this.scene.add(this.atmosphere);
  }

  // ── Star field ────────────────────────────────────
  _setupStars() {
    const count  = 8000;
    const pos    = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      pos[i] = (Math.random() - 0.5) * 800;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.4 });
    this.scene.add(new THREE.Points(geo, mat));
  }

  // ── Lighting ──────────────────────────────────────
  _setupLights() {
    this.sun = new THREE.DirectionalLight(0xfff8e7, 2.2);
    this.scene.add(this.sun);

    this.ambient = new THREE.AmbientLight(0x112244, 0.6);
    this.scene.add(this.ambient);

    // Night-side fill — dim blue, always opposite the sun
    this.nightFill = new THREE.DirectionalLight(0x1a3060, 0.25);
    this.scene.add(this.nightFill);

    // Initial position
    this.sunAngle     = 45;   // degrees, longitude of the sun
    this.sunElevation = 25;   // degrees above equator (axial tilt proxy)
    this._applySunPosition();
  }

  /**
   * Set the sun's longitude angle (0–360°) and elevation (-90–90°).
   * 0° = sun over the prime meridian, 180° = opposite side.
   */
  setSunAngle(angleDeg, elevationDeg) {
    this.sunAngle     = angleDeg     ?? this.sunAngle;
    this.sunElevation = elevationDeg ?? this.sunElevation;
    this._applySunPosition();
  }

  _applySunPosition() {
    const az  = this.sunAngle     * Math.PI / 180;
    const el  = this.sunElevation * Math.PI / 180;
    const r   = 6;
    this.sun.position.set(
      Math.cos(el) * Math.cos(az) * r,
      Math.sin(el) * r,
      Math.cos(el) * Math.sin(az) * r,
    );
    // Night fill is always opposite the sun
    this.nightFill.position.set(
      -this.sun.position.x,
      -this.sun.position.y,
      -this.sun.position.z,
    );
  }

  // ── Graticule (lat/lon lines on the globe) ────────
  _buildGraticule() {
    const group = new THREE.Group();
    const mat   = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.18 });
    const step  = 30; // degrees
    const R     = 1.003; // just above surface

    // Parallels (latitude lines)
    for (let lat = -60; lat <= 60; lat += step) {
      const phi   = (90 - lat) * Math.PI / 180;
      const pts   = [];
      for (let i = 0; i <= 64; i++) {
        const theta = (i / 64) * Math.PI * 2;
        pts.push(new THREE.Vector3(
          R * Math.sin(phi) * Math.cos(theta),
          R * Math.cos(phi),
          R * Math.sin(phi) * Math.sin(theta),
        ));
      }
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
    }

    // Equator — brighter
    const eqMat = new THREE.LineBasicMaterial({ color: 0x88bbff, transparent: true, opacity: 0.4 });
    const eqPts = [];
    for (let i = 0; i <= 64; i++) {
      const theta = (i / 64) * Math.PI * 2;
      eqPts.push(new THREE.Vector3(R * Math.cos(theta), 0, R * Math.sin(theta)));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(eqPts), eqMat));

    // Meridians (longitude lines)
    for (let lon = 0; lon < 360; lon += step) {
      const theta = lon * Math.PI / 180;
      const pts   = [];
      for (let i = 0; i <= 64; i++) {
        const phi = (i / 64) * Math.PI;
        pts.push(new THREE.Vector3(
          R * Math.sin(phi) * Math.cos(theta),
          R * Math.cos(phi),
          R * Math.sin(phi) * Math.sin(theta),
        ));
      }
      // Prime meridian brighter
      const m = lon === 0
        ? new THREE.LineBasicMaterial({ color: 0x88bbff, transparent: true, opacity: 0.4 })
        : mat;
      group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), m));
    }

    group.visible = false;
    this.scene.add(group);
    this.graticule = group;
  }

  // ── Pole markers ──────────────────────────────────
  _buildPoleMarkers() {
    const group = new THREE.Group();

    const mkPole = (y, label) => {
      // Spike
      const geo = new THREE.CylinderGeometry(0, 0.012, 0.08, 6);
      const mat = new THREE.MeshStandardMaterial({
        color: y > 0 ? 0xff4444 : 0x4488ff,
        emissive: y > 0 ? 0xff2222 : 0x2266ff,
        emissiveIntensity: 0.6,
      });
      const spike = new THREE.Mesh(geo, mat);
      spike.position.set(0, y * 1.04, 0);
      spike.rotation.z = y > 0 ? 0 : Math.PI;
      group.add(spike);
    };

    mkPole( 1, 'N');
    mkPole(-1, 'S');

    group.visible = false;
    this.scene.add(group);
    this.poleMarkers = group;
  }

  setGraticuleVisible(v)    { this.graticule?.traverse(o => { if (o.isLine) o.visible = v; }); this.graticule.visible = v; }
  setPoleMarkersVisible(v)  { this.poleMarkers.visible = v; }

  // ── Controls ──────────────────────────────────────
  _setupControls() {
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.minDistance   = 1.15;
    this.controls.maxDistance   = 8;
    this.controls.rotateSpeed   = 0.5;
    this.controls.zoomSpeed     = 0.8;
  }

  // ── Resize ────────────────────────────────────────
  _setupResize() {
    const ro = new ResizeObserver(() => {
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
    ro.observe(this.canvas.parentElement);
  }

  _aspect() {
    return this.canvas.clientWidth / this.canvas.clientHeight || 1;
  }

  // ── Update geometry from heightmap ────────────────
  updateGeometry(heightmap) {
    const geo  = this.globe.geometry;
    const pos  = geo.attributes.position;
    const col  = geo.attributes.color;
    const base = this._basePositions;
    const S    = this.terrain.size;

    // Displacement exaggeration scales with camera zoom
    const dist    = this.camera.position.length();
    const zoomT   = Math.max(0, Math.min(1, (dist - 1.15) / 3));
    const dispMag  = DISPLACE_SCALE_MAX * this.reliefScale * (0.3 + 0.7 * (1 - zoomT));

    for (let i = 0; i < pos.count; i++) {
      const bx = base[i * 3];
      const by = base[i * 3 + 1];
      const bz = base[i * 3 + 2];

      // Sphere normal = normalised base position (unit sphere)
      const len  = Math.sqrt(bx*bx + by*by + bz*bz);
      const nx   = bx / len;
      const ny   = by / len;
      const nz   = bz / len;

      // UV from sphere normal
      const u  = (Math.atan2(nz, nx) / (Math.PI * 2) + 0.5);
      const v  = (Math.asin(Math.max(-1, Math.min(1, ny))) / Math.PI + 0.5);
      const px = Math.floor(u * S) % S;
      const py = Math.floor(v * S) % S;
      const h  = heightmap[py * S + px];

      const disp = (h - 0.5) * dispMag;
      pos.setXYZ(i, nx * (1 + disp), ny * (1 + disp), nz * (1 + disp));

      const [r, g, b] = heightToColor(h);
      col.setXYZ(i, r, g, b);
    }

    pos.needsUpdate = true;
    col.needsUpdate = true;
    geo.computeVertexNormals();
  }

  // ── Raycasting: canvas point → sphere UV ─────────
  raycast(clientX, clientY) {
    const rect   = this.canvas.getBoundingClientRect();
    const ndcX   = ((clientX - rect.left) / rect.width)  *  2 - 1;
    const ndcY   = -((clientY - rect.top) / rect.height) *  2 + 1;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, this.camera);
    const hits = raycaster.intersectObject(this.globe);
    if (!hits.length) return null;

    const pt = hits[0].point.normalize();
    const lat = Math.asin(pt.y) * (180 / Math.PI);
    const lon = Math.atan2(pt.z, pt.x) * (180 / Math.PI);
    const u   = (Math.atan2(pt.z, pt.x) / (Math.PI * 2) + 0.5);
    const v   = (Math.asin(Math.max(-1, Math.min(1, pt.y))) / Math.PI + 0.5);
    const px  = Math.floor(u * this.terrain.size) % this.terrain.size;
    const py  = Math.floor(v * this.terrain.size) % this.terrain.size;

    return { lat, lon, u, v, px, py, point: hits[0].point.clone() };
  }

  // ── Animation loop ────────────────────────────────
  animate() {
    let lastDist = this.camera.position.length();

    const tick = () => {
      requestAnimationFrame(tick);
      this.controls.update();

      // Re-displace when zoom changes significantly
      const dist = this.camera.position.length();
      if (Math.abs(dist - lastDist) > 0.05) {
        this.updateGeometry(this.terrain.heightmap);
        lastDist = dist;
      }

      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  /** Build a minimal THREE.Vector3-compatible object for flat-view marker hits */
  _fakeVector3(x, y, z) {
    return new THREE.Vector3(x, y, z);
  }

  /** Return camera zoom level (1 = closest, 0 = far) */
  get zoomLevel() {
    const dist = this.camera.position.length();
    return Math.max(0, Math.min(1, (8 - dist) / (8 - 1.15)));
  }
}
