
const APP_VERSION = "1.0";

const state = {
  map: null,
  marker: null,
  activeLayer: "topo",
  selected: { lat: 41.3874, lon: 2.1686, label: "Barcelona" },
  lastInspect: null,
  isLoading: false
};

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;" }[c]));
const round = (n, d=0) => Number.isFinite(Number(n)) ? Number(n).toFixed(d).replace(/\.0$/,"") : "—";

const layers = {
  topo: {
    name: "Topo",
    url: "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 17,
      attribution: 'Map data © OpenStreetMap contributors, SRTM | Tiles © OpenTopoMap'
    }
  },
  streets: {
    name: "Streets",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors'
    }
  },
  human: {
    name: "Humanitarian",
    url: "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    options: {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors, Tiles style by HOT'
    }
  }
};

let tileLayers = {};

function boot(){
  renderShell();
  initMap();
  registerSW();
}

function renderShell(){
  $("#app").innerHTML = `
    <div class="app-shell">
      <aside class="panel">
        <header class="brand">
          <div class="logo">▵</div>
          <div>
            <strong>TerrainScope</strong>
            <span>Global terrain + air + quiet inspector · v${APP_VERSION}</span>
          </div>
        </header>

        <section class="search-card">
          <label>
            <span>Search place</span>
            <div class="search-row">
              <input id="searchInput" placeholder="Barcelona, Tokyo, Mont Blanc..." autocomplete="off">
              <button class="icon-btn" data-action="search">Search</button>
            </div>
          </label>
          <div class="quick-row">
            <button data-place="41.3874,2.1686,Barcelona">Barcelona</button>
            <button data-place="46.8523,-121.7603,Mount Rainier">Rainier</button>
            <button data-place="35.3606,138.7274,Mount Fuji">Fuji</button>
            <button data-place="-22.9519,-43.2105,Rio">Rio</button>
          </div>
        </section>

        <section class="layer-card">
          <div class="section-title">Map layer</div>
          <div class="segmented">
            <button class="active" data-layer="topo">Topo</button>
            <button data-layer="streets">Streets</button>
            <button data-layer="human">Human</button>
          </div>
        </section>

        <section id="inspector" class="inspector">
          ${emptyInspector()}
        </section>

        <section class="note-card">
          <strong>Noise data note</strong>
          <p>Noise is a proxy, not a measured decibel reading. It estimates likely quietness from nearby roads, rail, airports and urban features.</p>
        </section>
      </aside>

      <main class="map-wrap">
        <div id="map"></div>
        <div class="map-hint">Click anywhere to inspect terrain, air quality and quietness.</div>
      </main>
    </div>
  `;
  document.addEventListener("click", handleClick);
  document.addEventListener("keydown", e => {
    if(e.key === "Enter" && e.target?.id === "searchInput") searchPlace();
  });
}

function emptyInspector(){
  return `
    <div class="empty">
      <div class="big">Click the map</div>
      <p>Choose any point in the world. TerrainScope will inspect elevation, air quality, weather and likely quietness.</p>
    </div>
  `;
}

function initMap(){
  state.map = L.map("map", { zoomControl: false, worldCopyJump: true }).setView([state.selected.lat, state.selected.lon], 11);
  L.control.zoom({ position: "bottomright" }).addTo(state.map);

  Object.entries(layers).forEach(([key, cfg]) => {
    tileLayers[key] = L.tileLayer(cfg.url, cfg.options);
  });
  tileLayers.topo.addTo(state.map);

  state.marker = L.marker([state.selected.lat, state.selected.lon], { riseOnHover: true }).addTo(state.map);
  state.map.on("click", e => inspectLocation(e.latlng.lat, e.latlng.lng, "Selected point"));
  inspectLocation(state.selected.lat, state.selected.lon, state.selected.label);
}

function switchLayer(key){
  if(!layers[key] || key === state.activeLayer) return;
  state.map.removeLayer(tileLayers[state.activeLayer]);
  tileLayers[key].addTo(state.map);
  state.activeLayer = key;
  document.querySelectorAll("[data-layer]").forEach(b => b.classList.toggle("active", b.dataset.layer === key));
}

async function inspectLocation(lat, lon, label="Selected point"){
  state.selected = { lat, lon, label };
  state.marker.setLatLng([lat, lon]);
  state.map.panTo([lat, lon], { animate: true, duration: .45 });
  state.isLoading = true;
  renderLoading(lat, lon, label);

  try {
    const [air, weather, elevation, noise] = await Promise.allSettled([
      getAirQuality(lat, lon),
      getWeather(lat, lon),
      getElevation(lat, lon),
      getNoiseProxy(lat, lon)
    ]);

    const data = {
      lat, lon, label,
      air: air.status === "fulfilled" ? air.value : null,
      weather: weather.status === "fulfilled" ? weather.value : null,
      elevation: elevation.status === "fulfilled" ? elevation.value : null,
      noise: noise.status === "fulfilled" ? noise.value : null
    };
    state.lastInspect = data;
    renderInspector(data);
  } catch(err){
    $("#inspector").innerHTML = `<div class="error"><strong>Could not inspect this point.</strong><p>${esc(err.message || err)}</p></div>`;
  } finally {
    state.isLoading = false;
  }
}

function renderLoading(lat, lon, label){
  $("#inspector").innerHTML = `
    <div class="loading">
      <div class="loader"></div>
      <h2>${esc(label)}</h2>
      <p>${round(lat,4)}, ${round(lon,4)}</p>
      <span>Inspecting terrain, air and nearby infrastructure…</span>
    </div>
  `;
}

async function getAirQuality(lat, lon){
  const url = new URL("https://air-quality-api.open-meteo.com/v1/air-quality");
  url.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "european_aqi,pm10,pm2_5,nitrogen_dioxide,ozone",
    timezone: "auto"
  });
  const r = await fetch(url);
  if(!r.ok) throw new Error("Air quality unavailable");
  const j = await r.json();
  return j.current || {};
}

async function getWeather(lat, lon){
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: lat,
    longitude: lon,
    current: "temperature_2m,apparent_temperature,wind_speed_10m,wind_gusts_10m,weather_code",
    timezone: "auto"
  });
  const r = await fetch(url);
  if(!r.ok) throw new Error("Weather unavailable");
  const j = await r.json();
  return j.current || {};
}

async function getElevation(lat, lon){
  const url = new URL("https://api.open-meteo.com/v1/elevation");
  url.search = new URLSearchParams({ latitude: lat, longitude: lon });
  const r = await fetch(url);
  if(!r.ok) throw new Error("Elevation unavailable");
  const j = await r.json();
  return Array.isArray(j.elevation) ? j.elevation[0] : null;
}

async function getNoiseProxy(lat, lon){
  const radius = 850;
  const query = `
    [out:json][timeout:8];
    (
      way(around:${radius},${lat},${lon})["highway"];
      way(around:${radius},${lat},${lon})["railway"];
      node(around:${radius},${lat},${lon})["aeroway"];
      way(around:${radius},${lat},${lon})["aeroway"];
      node(around:${radius},${lat},${lon})["amenity"~"bar|pub|nightclub|restaurant"];
      way(around:${radius},${lat},${lon})["landuse"~"industrial|commercial|retail"];
    );
    out tags center 80;
  `.trim();
  const r = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query,
    headers: { "Content-Type": "text/plain;charset=UTF-8" }
  });
  if(!r.ok) throw new Error("Noise proxy unavailable");
  const j = await r.json();
  return scoreNoise(j.elements || []);
}

function scoreNoise(elements){
  const counts = { motorway:0, trunk:0, primary:0, secondary:0, rail:0, aeroway:0, nightlife:0, commercial:0, total: elements.length };
  let penalty = 0;

  for(const el of elements){
    const t = el.tags || {};
    if(t.highway){
      if(["motorway","trunk"].includes(t.highway)){ counts.motorway++; penalty += 16; }
      else if(["primary"].includes(t.highway)){ counts.primary++; penalty += 10; }
      else if(["secondary","tertiary"].includes(t.highway)){ counts.secondary++; penalty += 6; }
      else penalty += 2;
    }
    if(t.railway){ counts.rail++; penalty += 12; }
    if(t.aeroway){ counts.aeroway++; penalty += 18; }
    if(t.amenity && /bar|pub|nightclub|restaurant/.test(t.amenity)){ counts.nightlife++; penalty += t.amenity === "nightclub" ? 12 : 4; }
    if(t.landuse && /industrial|commercial|retail/.test(t.landuse)){ counts.commercial++; penalty += 7; }
  }

  const quiet = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  let label = "Likely quiet";
  let tone = "good";
  let explanation = "Few noisy infrastructure signals found nearby.";

  if(quiet < 35){
    label = "Likely noisy";
    tone = "bad";
    explanation = "Nearby major roads, rail, airport or dense urban features suggest higher noise.";
  } else if(quiet < 68){
    label = "Mixed quietness";
    tone = "medium";
    explanation = "Some nearby infrastructure may affect quietness depending on exact street, wind and time.";
  }

  return { quiet, label, tone, explanation, counts };
}

function renderInspector(data){
  const air = airSummary(data.air);
  const weather = weatherSummary(data.weather);
  const terrain = terrainSummary(data.elevation);
  const noise = data.noise || { quiet: null, label: "Noise proxy unavailable", tone: "medium", explanation: "Could not query nearby infrastructure.", counts: {} };

  $("#inspector").innerHTML = `
    <div class="place-head">
      <div class="eyebrow">Selected location</div>
      <h1>${esc(data.label)}</h1>
      <p>${round(data.lat,4)}, ${round(data.lon,4)}</p>
    </div>

    <div class="score-card ${noise.tone}">
      <span>Quiet score</span>
      <strong>${noise.quiet ?? "—"}</strong>
      <em>${esc(noise.label)}</em>
      <p>${esc(noise.explanation)}</p>
    </div>

    <div class="metric-grid">
      ${metric("Elevation", terrain.value, terrain.label, terrain.tone)}
      ${metric("Air", air.value, air.label, air.tone)}
      ${metric("PM2.5", air.pm25, "µg/m³", air.tone)}
      ${metric("Wind", weather.wind, "km/h", weather.tone)}
    </div>

    <div class="detail-list">
      <div><span>Temperature</span><strong>${weather.temp}</strong></div>
      <div><span>Gusts</span><strong>${weather.gust}</strong></div>
      <div><span>NO₂</span><strong>${air.no2}</strong></div>
      <div><span>Ozone</span><strong>${air.ozone}</strong></div>
    </div>

    <div class="nearby-card">
      <div class="section-title">Nearby noise signals</div>
      <div class="chips">
        ${chip("Major roads", (noise.counts?.motorway || 0) + (noise.counts?.primary || 0))}
        ${chip("Secondary roads", noise.counts?.secondary || 0)}
        ${chip("Rail", noise.counts?.rail || 0)}
        ${chip("Airport signals", noise.counts?.aeroway || 0)}
        ${chip("Nightlife/food", noise.counts?.nightlife || 0)}
        ${chip("Commercial/industrial", noise.counts?.commercial || 0)}
      </div>
    </div>
  `;
}

function metric(title, value, label, tone="medium"){
  return `<article class="metric ${tone}">
    <span>${esc(title)}</span>
    <strong>${esc(value)}</strong>
    <em>${esc(label)}</em>
  </article>`;
}

function chip(label, value){
  return `<div class="chip"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;
}

function airSummary(a){
  if(!a) return { value:"—", label:"Unavailable", tone:"medium", pm25:"—", no2:"—", ozone:"—" };
  const aq = Number(a.european_aqi);
  let tone = "good", label = "Good";
  if(aq >= 75){ tone="bad"; label="Poor"; }
  else if(aq >= 50){ tone="medium"; label="Moderate"; }
  return {
    value: Number.isFinite(aq) ? String(Math.round(aq)) : "—",
    label: `EU AQI · ${label}`,
    tone,
    pm25: `${round(a.pm2_5,1)}`,
    no2: `${round(a.nitrogen_dioxide,1)} µg/m³`,
    ozone: `${round(a.ozone,1)} µg/m³`
  };
}

function weatherSummary(w){
  if(!w) return { temp:"—", wind:"—", gust:"—", tone:"medium" };
  const wind = Number(w.wind_speed_10m);
  let tone = "good";
  if(wind >= 30) tone = "bad";
  else if(wind >= 18) tone = "medium";
  return {
    temp: `${round(w.temperature_2m)}°C / feels ${round(w.apparent_temperature)}°C`,
    wind: `${round(wind)}`,
    gust: `${round(w.wind_gusts_10m)} km/h`,
    tone
  };
}

function terrainSummary(e){
  if(e === null || e === undefined || !Number.isFinite(Number(e))) return { value:"—", label:"Unavailable", tone:"medium" };
  const n = Number(e);
  let label = "Lowland", tone = "good";
  if(n > 2500){ label = "High mountain"; tone = "bad"; }
  else if(n > 1200){ label = "Mountain"; tone = "medium"; }
  else if(n > 400){ label = "Hills / upland"; tone = "medium"; }
  return { value: `${round(n)} m`, label, tone };
}

async function searchPlace(){
  const input = $("#searchInput");
  const q = input.value.trim();
  if(!q) return;
  input.disabled = true;
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.search = new URLSearchParams({ q, format: "json", limit: "1" });
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    const j = await r.json();
    if(!j.length) throw new Error("Place not found");
    const p = j[0];
    state.map.setView([Number(p.lat), Number(p.lon)], 12);
    inspectLocation(Number(p.lat), Number(p.lon), p.display_name.split(",").slice(0,2).join(", "));
  } catch(err){
    $("#inspector").innerHTML = `<div class="error"><strong>Search failed.</strong><p>${esc(err.message || err)}</p></div>`;
  } finally {
    input.disabled = false;
  }
}

function handleClick(e){
  const layerBtn = e.target.closest("[data-layer]");
  if(layerBtn){ switchLayer(layerBtn.dataset.layer); return; }

  const placeBtn = e.target.closest("[data-place]");
  if(placeBtn){
    const [lat, lon, label] = placeBtn.dataset.place.split(",");
    state.map.setView([Number(lat), Number(lon)], 11);
    inspectLocation(Number(lat), Number(lon), label);
    return;
  }

  const action = e.target.closest("[data-action]");
  if(!action) return;
  if(action.dataset.action === "search") searchPlace();
}

function registerSW(){
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("./service-worker.js").catch(()=>{});
  }
}

document.addEventListener("DOMContentLoaded", boot);
