# CMSIT Inner Tracker 3D

An interactive Grafana panel that displays the complete CMS Inner Tracker as a
single WebGL scene:

- four TBPX barrel layers;
- eight TFPX disks on each detector side;
- four TEPX disks on each detector side;
- 2,324 independently identifiable module positions.

The full detector uses Three.js GPU instancing. The sidebar can hide or show
each subdetector and each individual layer or numbered disk. A disk checkbox
controls both its `+Z` and `-Z` copies.

## Features

- Rotate, zoom and pan the full detector.
- Enable or disable TBPX, TFPX and TEPX as parent groups.
- Enable or disable every layer or disk independently.
- Select true spatial right/left TBPX halves, subdivided by detector Z side.
- Select the left/right half on each TFPX or TEPX detector side.
- Enable all, disable all and reset-camera controls.
- Parent checkboxes display an indeterminate state when only some children are
  visible.
- Populate the register selector dynamically from Prometheus.
- Set optional low and high limits directly from dashboard variables.
- Colour individual chips with live Prometheus values.
- Display two chips for double modules and four chips for quad modules.
- Aggregate multiple chip values by mean, maximum, minimum or latest value.
- Hover for detector position, monitoring value, unit and hardware identifiers.
- Click a module to open the existing module/chip details dashboard.
- Double-click a module to focus the camera; double-click empty space to reset.
- Override display coordinates with JSON when official coordinates are ready.
- Optionally retain visibility choices across Grafana refreshes.
- Display continuous barrel shells and solid half-disk plates so modules are
  not suspended without detector context.
- Place inner-surface disk rings toward the interaction point and outer-surface
  rings away from it on both detector sides.

## Build

Requirements:

- Node.js 22 or newer;
- npm 10 or newer.

```bash
npm install
npm run typecheck
npm run test:ci
npm run build
```

The built unsigned plugin is written to `dist/`.

## Run the included development dashboard

Prometheus should be available on the host at port `9090`.

```bash
npm run build
docker compose up
```

Then open:

```text
http://localhost:3301/d/cmsit-inner-tracker-3d
```

The development Grafana login is `admin` / `admin`. Anonymous Admin access is
also enabled only for this local development container.

## Prometheus data

The provisioned dashboard queries:

```promql
cmsit_monitor_value{register=~"$register"}
```

The panel reads the last finite value in every returned numeric field.

### Preferred detector-aware labels

If the exporter or a Prometheus recording rule supplies detector-position
labels, the panel uses them directly.

TBPX:

```text
subdetector="TBPX"
layer="3"
signed_ladder="1"
z_side="z+"
module_index="1"
```

TFPX or TEPX:

```text
subdetector="TFPX"
detector_side="+z"
disk="1"
ring="2"
half="upper"
module_index="0"
```

### Hardware mapping JSON

When the series only contains `board`, `optical_group`, `hybrid` and `chip`,
configure the panel's **Hardware mapping (JSON)** option:

```json
{
  "0/0/0": {
    "subdetector": "TBPX",
    "layer": 3,
    "signed_ladder": 1,
    "z_side": "z+",
    "module_index": 1
  },
  "1/0/2": {
    "subdetector": "TFPX",
    "detector_side": "+z",
    "disk": 1,
    "ring": 2,
    "half": "upper",
    "module_index": 0
  }
}
```

The key is `board/optical_group/hybrid`. Values carrying a `chip` label colour
the corresponding chip cell. Module-level aggregation remains available when
only combined module data are returned.

## Geometry model

The bundled topology is taken from the existing 2D Inner Tracker dashboard:

| Region | Configuration | Modules |
|---|---:|---:|
| TBPX | 4 layers | 756 |
| TFPX | 8 disks per side, 4 rings | 864 |
| TEPX | 4 disks per side, 5 rings | 704 |
| Total | 16 numbered elements | 2,324 |

The initial radii and disk positions are display coordinates, not engineering
survey coordinates. They are kept in `src/geometry/config.ts`.

The panel option **3D placement overrides (JSON)** can replace the bundled
placement configuration. This keeps the renderer and monitoring mapping
unchanged when official physical coordinates are supplied.

## Navigation

The default module-details dashboard UID is:

```text
cmsit-parts-chip-details
```

On module click, the panel passes hardware variables when available and always
passes the detector-position variables. The current dashboard URL is also
included as `var-return_url`.

## Production installation

This is currently an unsigned private panel. For local or controlled Grafana
installations, allow the plugin ID:

```ini
allow_loading_unsigned_plugins = atharphy-cmsitinnertracker3d-panel
```

For wider distribution, sign the plugin before deployment.
