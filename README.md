# Mapmaker

A fictional planet map creator for world-building and novel writing.
Runs entirely in the browser — no build step, no backend.

Live at **[planetbuilder.malha.land](https://planetbuilder.malha.land)**

---

## Features

### Globe & Terrain
- Google Earth-style 3D globe with full vertex displacement (mountains rise, oceans sink)
- Procedural terrain generation using multi-octave 3D simplex noise
- Nine terrain types: Deep Ocean, Coast, Beach, Desert (Yellow), Desert (White), Plains, Hills, Mountains, Peaks
- Real-time painting tools: brush by terrain type, raise/lower height, smooth
- Flat map view (equirectangular projection) with pan and zoom
- Globe and flat map share the same coordinate system — a marker placed on either view appears correctly on both

### Generation Controls
- **Resolution** — 256×256 (Draft) · 512×512 (Standard) · 1024×1024 (High) · 2048×2048 (Ultra)
- **Upscale** — bilinearly interpolate the existing heightmap to the selected resolution; markers are preserved
- **Sea Level** — how much of the planet is covered by water
- **Islands ↔ Continents** — controls tectonic plate simulation (island chains vs. large landmasses)
- **Continent Size** — noise scale for landmass feature size
- **Mountain Height** — maximum elevation of peaks
- **Roughness** — terrain noise detail

### Lighting & Overlays
- Directional sun light with adjustable time of day and axial tilt
- Animated day/night cycle
- Toggleable latitude/longitude graticule and N/S pole markers
- Marker pins with labels on both 3D globe and flat map

### Map Tools
- **Marker** — click to place a named location; appears on both globe and flat map
- **Set Prime Meridian (0°)** — click any point to rotate the entire world so that location becomes longitude 0°; terrain and markers shift together
- **Flip E↔W** — mirror the whole map east-to-west; useful to correct orientation after generation

### Markers
- Click with the Marker tool to place named locations on the globe or flat map
- Each marker stores name, description, and lat/lon coordinates
- Markers survive upscaling, flipping, and prime meridian shifts
- Marker list in the sidebar shows coordinates; click to focus

### Orbit Designer
- **Planet mode** — define orbit around a star (distance, period, eccentricity, axial tilt)
- **Moon mode** — define a gas giant + moon system (the planet is the moon)
- Star spectral types: O, B, A, F, G, K, M — each with distinct color temperature, luminosity, and sun light color
- Gas giant types: Hot Jupiter, Cold Giant, Ice Giant, Brown Dwarf
- Derived stats: estimated surface temperature, habitability zone info
- Orbital view canvas: accurate Keplerian ellipse with star at focus, periapsis/apoapsis labels

### Save / Load
- **Browser saves** — save named slots to localStorage (survives page refresh)
- **Export JSON** — full planet data (heightmap + markers + orbit + planet info)
- **Import JSON** — restore any previously exported planet
- **Screenshot PNG** — current 3D globe view
- **Export Flat Map PNG** — high-resolution (4×) equirectangular map with graticule

---

## Project Structure

```
mapmaker/
├── index.html          # App shell, HTML layout, importmap for Three.js
├── style.css           # CSS grid layout, dark theme, all component styles
├── js/
│   ├── app.js          # Bootstrap — instantiates all modules, wires them together
│   ├── terrain.js      # Heightmap, simplex noise generator, terrain type constants
│   ├── planet.js       # Three.js scene, globe mesh, lighting, graticule, pole markers
│   ├── brush.js        # Painting logic — terrain paint, raise/lower, smooth
│   ├── markers.js      # Marker data model, 3D sphere placement, JSON persistence
│   ├── mapview.js      # 2D flat map canvas, pan/zoom, marker overlay, PNG export
│   ├── orbit.js        # Orbital mechanics data model, star/giant presets
│   ├── orbitalview.js  # 2D orbital diagram canvas (Keplerian ellipse rendering)
│   ├── storage.js      # Save/load — localStorage and JSON file import/export
│   └── ui.js           # DOM event binding — all controls wired to modules
└── infra/
    ├── stack.yaml          # CloudFormation: S3 + CloudFront + ACM + Route53
    ├── monitoring.yaml     # CloudFormation: CloudWatch alarms + AWS Budget
    ├── deploy.sh           # Sync to S3 + CloudFront invalidation
    └── deploy-monitoring.sh
```

---

## Technical Notes

### Terrain & Heightmap
- Configurable resolution: `Float32Array` of `size × size` values, default 512×512
- Values 0–1 map to terrain types via ordered thresholds in the `TERRAIN` constant
- Equirectangular projection: `heightmap[y * S + x]` → `lon = (x/S)*360−180`, `lat = 90 − (y/S)*180`
- Vertex displacement on `SphereGeometry(1, 256, 256)`, max scale `DISPLACE_SCALE_MAX = 0.15`, modulated by the Terrain Relief slider (default 10%)
- Upscaling uses bilinear interpolation; the same algorithm handles downscaling

### Coordinate System
Three.js Y-up. The UV mapping that keeps the globe and flat map consistent:

```
u = 0.5 − atan2(nz, nx) / (2π)   → px = u * S  (west=0, east=S)
v = 0.5 − asin(ny) / π            → py = v * S  (north=0, south=S)
```

Lat/lon from a raycasted 3D point:
```
lat =  asin(ny) × (180/π)
lon = −atan2(nz, nx) × (180/π)
```

Longitude is negated relative to the raw `atan2` result so that rotating the globe rightward corresponds to increasing longitude — consistent with the flat map's left-to-right west→east axis.

### Orbital Mechanics
Keplerian ellipse: semi-major axis `a`, eccentricity `e`, semi-minor `b = a * sqrt(1-e²)`.
Star sits at the right focus: `c = a*e`, ellipse center offset so star is at focus, not center.

### Dependencies (CDN, no install)
- [Three.js r0.168](https://cdn.jsdelivr.net/npm/three@0.168.0) via importmap
- No other external dependencies — simplex noise is self-contained in `terrain.js`

---

## Running Locally

```bash
# Any static file server works
npx serve .
# or
python3 -m http.server 8080
```

Open `http://localhost:8080` (or whatever port). Must be served over HTTP — `file://` won't work with ES modules.

---

## Deployment (AWS)

Infrastructure is managed via CloudFormation in `infra/`.

### First deploy

```bash
# 1. Deploy main stack (S3 + CloudFront + ACM + Route53)
#    Must run in us-east-1 for ACM + CloudFront metrics
aws cloudformation deploy \
  --stack-name planet-builder \
  --template-file infra/stack.yaml \
  --parameter-overrides DomainName=planetbuilder.malha.land HostedZoneId=<YOUR_ZONE_ID> \
  --region us-east-1 \
  --profile perso

# 2. Deploy monitoring (budget + CloudWatch alarms)
aws cloudformation deploy \
  --stack-name planet-builder-monitoring \
  --template-file infra/monitoring.yaml \
  --parameter-overrides \
      AlertEmail=you@example.com \
      MonthlyBudgetUSD=10 \
      DistributionId=<DIST_ID_FROM_STEP_1> \
  --region us-east-1 \
  --profile perso
```

### Subsequent deploys

```bash
./infra/deploy.sh sync
```

This syncs static files to S3 (with correct cache headers) and creates a CloudFront invalidation.

### Cache headers
- `index.html` — `max-age=3600` (1 hour); CloudFront invalidation on every deploy ensures the CDN always serves the latest version immediately after release
- All other assets — `max-age=31536000, immutable`; a Unix timestamp is injected into every JS import URL at deploy time (`?v=<ts>`), so browsers always fetch fresh files after a deploy and then cache them for a year
