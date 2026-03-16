/* ============================================================
   Smart Nearby Recommender — script.js v2
   - More mood/category options (bar, park, library, gym, pharmacy, hotel)
   - OSM ratings + star display
   - Photo support via OSM image tag + Wikimedia commons fallback
   - Sort by rating
   - Richer card UI
   ============================================================ */

/* ---------- Mood → Amenity/Leisure mapping ---------- */
const MOOD_MAP = {
  cafe:      { tag: 'amenity', val: 'cafe',      icon: '☕', label: 'Café' },
  restaurant:{ tag: 'amenity', val: 'restaurant', icon: '🍽️', label: 'Restaurant' },
  fast_food: { tag: 'amenity', val: 'fast_food',  icon: '🍔', label: 'Fast Food' },
  cheap:     { tag: 'amenity', val: 'restaurant', icon: '💰', label: 'Restaurant' },
  bar:       { tag: 'amenity', val: 'bar',         icon: '🍺', label: 'Bar' },
  park:      { tag: 'leisure', val: 'park',        icon: '🌿', label: 'Park' },
  library:   { tag: 'amenity', val: 'library',     icon: '📚', label: 'Library' },
  gym:       { tag: 'leisure', val: 'fitness_centre', icon: '💪', label: 'Gym' },
  pharmacy:  { tag: 'amenity', val: 'pharmacy',    icon: '💊', label: 'Pharmacy' },
  hotel:     { tag: 'tourism', val: 'hotel',       icon: '🏨', label: 'Hotel' },
};

/* ---------- Helpers ---------- */
function haversineDistance(lat1, lon1, lat2, lon2){
  const R = 6371000;
  const toR = x => x * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1))*Math.cos(toR(lat2))*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getLatLon(el){
  if(el.lat && el.lon) return {lat: el.lat, lon: el.lon};
  if(el.center) return {lat: el.center.lat, lon: el.center.lon};
  return null;
}

function escapeHtml(s){
  if(!s) return '';
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
}

function fmtDist(m){
  return m >= 1000 ? (m/1000).toFixed(1)+' km' : Math.round(m)+' m';
}

/* Rating helpers — OSM uses 'stars', 'rating', sometimes 'reviews:rating' */
function getOsmRating(tags){
  const raw = tags.stars || tags.rating || tags['reviews:rating'] || tags['star_rating'];
  if(!raw) return null;
  const n = parseFloat(raw);
  return isNaN(n) ? null : Math.min(5, Math.max(0, n));
}

function renderStars(rating){
  if(rating === null) return '';
  const full = Math.floor(rating);
  const half = rating - full >= 0.5 ? 1 : 0;
  const empty = 5 - full - half;
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty);
}

/* Photo: prefer OSM image tag, else Wikimedia thumb if 'wikimedia_commons' tag */
function getPhotoUrl(tags){
  if(tags.image && tags.image.startsWith('http')) return tags.image;
  return null; // Wikimedia requires API call — skip for simplicity, use emoji fallback
}

/* Emoji fallback per category */
const EMOJI_FALLBACK = {
  cafe:'☕', restaurant:'🍽️', fast_food:'🍔', bar:'🍺',
  park:'🌿', library:'📚', fitness_centre:'💪', pharmacy:'💊', hotel:'🏨',
  default:'📍'
};
function getEmoji(amenity){
  return EMOJI_FALLBACK[amenity] || EMOJI_FALLBACK.default;
}

/* ---------- App state ---------- */
let map, userMarker;
let userLat = 22.5726, userLon = 88.3639; // Kolkata fallback
let markersLayer;
let favorites = new Set(JSON.parse(localStorage.getItem('sn_favs') || '[]'));

/* ---------- Init map ---------- */
function initMap(){
  map = L.map('map', { zoomControl: true }).setView([userLat, userLon], 14);

  // Use CartoDB light/dark tiles for a cleaner look
  const lightTile = 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png';
  const darkTile  = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';

  const tileAttrib = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>';

  // expose so dark mode toggle can swap
  window._lightLayer = L.tileLayer(lightTile, { attribution: tileAttrib, subdomains: 'abcd', maxZoom: 19 });
  window._darkLayer  = L.tileLayer(darkTile,  { attribution: tileAttrib, subdomains: 'abcd', maxZoom: 19 });
  window._lightLayer.addTo(map);

  markersLayer = L.layerGroup().addTo(map);

  const youIcon = L.divIcon({
    html: '<div style="width:16px;height:16px;border-radius:50%;background:var(--accent,#4f46e5);border:3px solid white;box-shadow:0 0 10px rgba(79,70,229,.6)"></div>',
    iconSize: [16,16], iconAnchor: [8,8], className:''
  });
  userMarker = L.marker([userLat, userLon], { icon: youIcon }).addTo(map).bindPopup('<strong>You are here</strong>');
}

/* ---------- Geolocation ---------- */
function useMyLocation(){
  if(!navigator.geolocation){ alert('Geolocation not supported'); return; }
  const btn = document.getElementById('locateBtn');
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Locating…';
  btn.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude; userLon = pos.coords.longitude;
      map.setView([userLat, userLon], 15);
      userMarker.setLatLng([userLat, userLon]).openPopup();
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> My Location';
      btn.disabled = false;
    },
    err => {
      btn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> My Location';
      btn.disabled = false;
      console.warn('geoloc error', err);
      alert("Couldn't get location. Using default.");
    },
    { enableHighAccuracy: true, timeout: 8000 }
  );
}

/* ---------- Overpass query ---------- */
function buildOverpassQuery(moodKey, radius, lat, lon, nameQuery){
  const mood = MOOD_MAP[moodKey] || MOOD_MAP.cafe;
  const tag = mood.tag, val = mood.val;

  let nameFilter = '';
  if(nameQuery && nameQuery.trim()){
    const q = nameQuery.replace(/"/g,'');
    nameFilter = `["name"~"${q}",i]`;
  }

  return encodeURIComponent(`
    [out:json][timeout:25];
    (
      node["${tag}"="${val}"]${nameFilter}(around:${radius},${lat},${lon});
      way["${tag}"="${val}"]${nameFilter}(around:${radius},${lat},${lon});
      relation["${tag}"="${val}"]${nameFilter}(around:${radius},${lat},${lon});
    );
    out center qt;
  `);
}

/* ---------- Main search ---------- */
async function findPlaces(){
  const moodBtn  = document.querySelector('.mood-btn.active');
  const moodKey  = moodBtn ? moodBtn.dataset.type : 'cafe';
  const radius   = parseInt(document.getElementById('radius').value, 10) || 1500;
  const search   = document.getElementById('searchInput').value.trim();
  const sortBy   = document.getElementById('sortBy').value;

  const findBtn = document.getElementById('findBtn');
  findBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Searching…';
  findBtn.classList.add('loading');

  const query = buildOverpassQuery(moodKey, radius, userLat, userLon, search);
  const url = `https://overpass-api.de/api/interpreter?data=${query}`;

  try {
    const resp = await fetch(url);
    if(!resp.ok) throw new Error('Overpass API error ' + resp.status);
    const json  = await resp.json();
    const elems = json.elements || [];

    const mood = MOOD_MAP[moodKey] || MOOD_MAP.cafe;

    const places = elems.map(el => {
      const ll = getLatLon(el);
      if(!ll) return null;
      const tags = el.tags || {};
      return {
        id:       `${el.type}/${el.id}`,
        osmType:  el.type,
        osmId:    el.id,
        name:     tags.name || 'Unnamed',
        lat:      ll.lat, lon: ll.lon,
        tags,
        distance: haversineDistance(userLat, userLon, ll.lat, ll.lon),
        rating:   getOsmRating(tags),
        photoUrl: getPhotoUrl(tags),
        moodIcon: mood.icon,
        amenityLabel: tags.amenity || tags.leisure || tags.tourism || mood.val,
      };
    }).filter(Boolean);

    // Sort
    if(sortBy === 'distance') places.sort((a,b) => a.distance - b.distance);
    else if(sortBy === 'rating') places.sort((a,b) => (b.rating ?? -1) - (a.rating ?? -1));
    else if(sortBy === 'name') places.sort((a,b) => a.name.localeCompare(b.name));

    renderResults(places);
  } catch(err) {
    console.error(err);
    document.getElementById('results').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <p>Failed to fetch places. Check connection and try again.</p>
      </div>`;
  } finally {
    findBtn.innerHTML = '<i class="fa-solid fa-magnifying-glass"></i> Find Places';
    findBtn.classList.remove('loading');
  }
}

/* ---------- Render ---------- */
function clearMarkers(){ markersLayer.clearLayers(); }

function renderResults(places){
  const resultsEl = document.getElementById('results');
  const header    = document.getElementById('resultsHeader');
  const countEl   = document.getElementById('resultsCount');
  resultsEl.innerHTML = '';
  clearMarkers();

  if(!places.length){
    header.classList.add('hidden');
    resultsEl.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔍</div>
        <p>No places found. Try a larger radius or different category.</p>
      </div>`;
    return;
  }

  header.classList.remove('hidden');
  countEl.textContent = `${places.length} place${places.length !== 1 ? 's' : ''} found`;

  places.forEach((p, i) => {
    // ---- Map marker ----
    const markerIcon = L.divIcon({
      html: `<div style="
        background:var(--accent,#4f46e5);
        color:white;font-size:14px;
        width:30px;height:30px;border-radius:50% 50% 50% 0;
        transform:rotate(-45deg);
        display:flex;align-items:center;justify-content:center;
        border:2px solid white;
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
      "><span style="transform:rotate(45deg)">${p.moodIcon}</span></div>`,
      iconSize: [30,30], iconAnchor: [15,30], popupAnchor: [0,-30], className:''
    });
    const marker = L.marker([p.lat, p.lon], { icon: markerIcon });
    marker.addTo(markersLayer);

    const ratingHtml = p.rating !== null
      ? `<span style="color:#f59e0b">${renderStars(p.rating)}</span> <span style="color:#888;font-size:11px">${p.rating.toFixed(1)}</span>`
      : '';
    marker.bindPopup(`
      <strong style="font-size:14px">${escapeHtml(p.name)}</strong>
      ${ratingHtml ? `<div>${ratingHtml}</div>` : ''}
      <div style="color:#888;font-size:12px;margin-top:4px">${p.amenityLabel}${p.tags.cuisine ? ' · '+escapeHtml(p.tags.cuisine) : ''}</div>
      <div style="color:#888;font-size:12px">📍 ${fmtDist(p.distance)}</div>
    `);

    // ---- Card ----
    const card = document.createElement('div');
    card.className = 'place-card';
    card.style.animationDelay = Math.min(i * 0.04, 0.4) + 's';

    const isFav = favorites.has(p.id);
    const photoUrl = p.photoUrl;

    // Photo / placeholder
    const photoHtml = photoUrl
      ? `<div class="card-photo"><img src="${escapeHtml(photoUrl)}" alt="${escapeHtml(p.name)}" loading="lazy" onerror="this.parentElement.innerHTML='<div style=\\'font-size:38px\\'>${p.moodIcon}</div>'"></div>`
      : `<div class="card-photo-placeholder">${p.moodIcon}</div>`;

    // Badges
    const badges = [];
    if(p.amenityLabel) badges.push(`<span class="badge badge-amenity">${escapeHtml(p.amenityLabel)}</span>`);
    if(p.tags.cuisine) badges.push(`<span class="badge">${escapeHtml(p.tags.cuisine)}</span>`);
    if(p.tags.outdoor_seating === 'yes') badges.push(`<span class="badge">🌤 outdoor</span>`);
    if(p.tags.wifi === 'yes' || p.tags.internet_access === 'wlan') badges.push(`<span class="badge">📶 wifi</span>`);
    if(p.tags.wheelchair === 'yes') badges.push(`<span class="badge">♿</span>`);

    // Rating display
    const ratingSection = p.rating !== null
      ? `<div class="card-rating"><span class="stars">${renderStars(p.rating)}</span><span class="rating-text">${p.rating.toFixed(1)}/5</span></div>`
      : '';

    card.innerHTML = `
      ${photoHtml}
      <div class="card-body">
        <div class="card-top">
          <div class="place-name">${escapeHtml(p.name)}</div>
          <button class="fav-btn" data-id="${p.id}" title="Toggle favourite">${isFav ? '⭐' : '☆'}</button>
        </div>
        ${badges.length ? `<div class="card-badges">${badges.join('')}</div>` : ''}
        ${ratingSection}
        <div class="card-meta">
          <span class="dist-pill"><i class="fa-solid fa-location-dot"></i> ${fmtDist(p.distance)}</span>
          ${p.tags.opening_hours ? `<span class="hours-text">🕐 ${escapeHtml(p.tags.opening_hours)}</span>` : ''}
        </div>
      </div>
      <div class="card-actions">
        <button class="card-btn primary-btn js-map-btn" data-lat="${p.lat}" data-lon="${p.lon}">
          <i class="fa-solid fa-location-dot"></i> Map
        </button>
        <a class="card-btn" href="https://www.openstreetmap.org/${p.osmType}/${p.osmId}" target="_blank" rel="noopener">
          <i class="fa-solid fa-arrow-up-right-from-square"></i> OSM
        </a>
        <a class="card-btn" href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lon}" target="_blank" rel="noopener">
          <i class="fa-brands fa-google"></i> Maps
        </a>
      </div>
    `;

    // Events
    card.querySelector('.fav-btn').addEventListener('click', ev => {
      toggleFav(p.id, ev.currentTarget);
    });
    card.querySelector('.js-map-btn').addEventListener('click', ev => {
      const lat = parseFloat(ev.currentTarget.dataset.lat);
      const lon = parseFloat(ev.currentTarget.dataset.lon);
      map.setView([lat, lon], 17, { animate: true });
      marker.openPopup();
    });

    resultsEl.appendChild(card);
  });
}

/* ---------- Favourites ---------- */
function toggleFav(id, btnEl){
  if(favorites.has(id)){
    favorites.delete(id);
    btnEl.textContent = '☆';
  } else {
    favorites.add(id);
    btnEl.textContent = '⭐';
  }
  localStorage.setItem('sn_favs', JSON.stringify([...favorites]));
}

/* ---------- Slider fill ---------- */
function updateSliderFill(){
  const el = document.getElementById('radius');
  const pct = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty('--pct', pct + '%');
}

/* ---------- Dark mode tile swap ---------- */
function applyDarkTiles(isDark){
  if(!map) return;
  if(isDark){
    if(map.hasLayer(window._lightLayer)) map.removeLayer(window._lightLayer);
    window._darkLayer.addTo(map);
  } else {
    if(map.hasLayer(window._darkLayer)) map.removeLayer(window._darkLayer);
    window._lightLayer.addTo(map);
  }
}

/* ---------- Boot ---------- */
document.addEventListener('DOMContentLoaded', () => {
  initMap();

  // Buttons
  document.getElementById('locateBtn').addEventListener('click', useMyLocation);
  document.getElementById('findBtn').addEventListener('click', findPlaces);

  // Radius slider
  const radiusEl = document.getElementById('radius');
  radiusEl.addEventListener('input', () => {
    document.getElementById('radiusValue').textContent = radiusEl.value;
    updateSliderFill();
  });
  updateSliderFill();

  // Mood buttons
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Dark mode
  const darkToggle = document.getElementById('darkToggle');
  // Apply system preference on load
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  if(prefersDark){ darkToggle.checked = true; document.body.classList.add('dark'); applyDarkTiles(true); }

  darkToggle.addEventListener('change', e => {
    document.body.classList.toggle('dark', e.target.checked);
    applyDarkTiles(e.target.checked);
  });

  // Clear favs
  document.getElementById('clearFavsBtn')?.addEventListener('click', () => {
    favorites.clear();
    localStorage.removeItem('sn_favs');
    document.querySelectorAll('.fav-btn').forEach(btn => btn.textContent = '☆');
  });

  // Auto-locate
  if(navigator.geolocation){
    navigator.geolocation.getCurrentPosition(pos => {
      userLat = pos.coords.latitude; userLon = pos.coords.longitude;
      map.setView([userLat, userLon], 15);
      userMarker.setLatLng([userLat, userLon]);
    }, () => {});
  }
});