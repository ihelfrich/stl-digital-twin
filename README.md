# St. Louis 3D World

Local 3D map surface centered on St. Louis, Missouri.

## Run

```sh
cd /Volumes/HELFRICH-GD/StLouis3DWorld
node scripts/fetch-stl-data.mjs
python3 -m http.server 5173 --bind 127.0.0.1
```

Open `http://127.0.0.1:5173`.

Useful render controls:

```text
http://127.0.0.1:5173?maxBuildings=12000&heightScale=3
```

The default view renders 2,500 prioritized buildings from the 38,570-building
source file. Increase `maxBuildings` when you want density over startup speed.

## Larger Building Pull

The default fetch pulls a performant core St. Louis bounding box. For a broader city pull:

```sh
node scripts/fetch-stl-data.mjs --city
```

## External Live Feed

The app polls `public/data/live-feed.json` every 2.5 seconds. Any process can update that file:

```json
{
  "updatedAt": "2026-05-16T00:00:00.000Z",
  "objects": [
    {
      "id": "asset-1",
      "label": "Asset 1",
      "lon": -90.1994,
      "lat": 38.627,
      "alt": 12,
      "status": "active",
      "color": "#7bd88f"
    }
  ]
}
```

For a local live-feed demo:

```sh
node scripts/simulate-live-feed.mjs
```

## Grounded Quantities

Machinery for stating a quantitative relationship between measured things and
checking whether it survives: dimensional analysis, provenance and imputation
coverage, out-of-sample skill, a permutation null, bootstrap intervals, and a
negative control that has to fail.

```sh
npm run relations   # writes public/data/relations-feed.json
npm test            # both test suites
```

Findings so far: building height rises at 3.85 m/storey (95% CI [3.51, 4.28]),
which puts the 3.2 hard-coded in this repo outside the interval; the textbook
exponential density gradient largely disappears once each ring is corrected for
the data bounding box; and treating neighbouring buildings as independent draws
turns a nominal 95% interval into one that covers the truth 33% of the time. See
[`docs/GROUNDED-QUANTITIES.md`](docs/GROUNDED-QUANTITIES.md).

## Economic Layer

An economics layer built on algebraic geometry, sheaf cohomology and
compositional game theory, derived from the building stock and live feeds:

```sh
npm run econ        # writes public/data/economy-feed.json
npm run test:econ   # checks closed forms, theorems and category laws
```

It computes *every* competitive equilibrium of a district-level exchange
economy (not just one), measures how much observed cross-boundary data no
district-level price system can explain, and builds a development game whose
equilibria compose from its parts. See
[`docs/ALGEBRAIC-ECONOMICS.md`](docs/ALGEBRAIC-ECONOMICS.md) for what is
computed, what the numbers came out as, and where the approach stops working.

## Photorealistic 3D Tiles

Paste a Google Photorealistic 3D Tiles API key into the app, or open:

```text
http://127.0.0.1:5173?googleKey=YOUR_API_KEY
```

The app uses the Google root tileset URL:

```text
https://tile.googleapis.com/v1/3dtiles/root.json?key=YOUR_API_KEY
```
