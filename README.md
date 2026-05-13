# TerrainScope v1.0 — Global Topographic Inspector

A global topographic map app.

## What it does

- Global interactive topographic map
- Search places worldwide
- Click anywhere to inspect:
  - elevation
  - current air quality
  - PM2.5 / NO₂ / ozone
  - wind and temperature
  - quiet/noise proxy
  - nearby infrastructure signals
- Map layers:
  - Topographic
  - Streets
  - Humanitarian
- Mobile-friendly PWA-style static app

## Data sources

- Leaflet for map UI
- OpenStreetMap/OpenTopoMap tiles
- Open-Meteo Forecast API
- Open-Meteo Air Quality API
- Open-Meteo Elevation API
- Overpass API for nearby infrastructure proxy

## Important note

Noise pollution is not measured decibel data in v1.

The app estimates likely quietness from nearby infrastructure such as major roads, railways, airports, nightlife and commercial/industrial land use.

## Upload

Upload these files to your repo root:

- index.html
- app-v1-0.js
- style-v1-0.css
- app.js
- style.css
- icon.svg
- manifest.json
- service-worker.js
- README.md
