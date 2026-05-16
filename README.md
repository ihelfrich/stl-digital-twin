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

## Photorealistic 3D Tiles

Paste a Google Photorealistic 3D Tiles API key into the app, or open:

```text
http://127.0.0.1:5173?googleKey=YOUR_API_KEY
```

The app uses the Google root tileset URL:

```text
https://tile.googleapis.com/v1/3dtiles/root.json?key=YOUR_API_KEY
```
