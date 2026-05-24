// ============================================================
//  script.js — Fiber Customer Maps v3.0
//  Vercel-ready | Google Maps tiles | KML Coverage auto-load
//  Real-time auto-refresh | Zoom-adaptive markers (no cluster)
//  ✅ Customer search dari Notion | ✅ Pencarian nama pelanggan
// ============================================================

// ── State ──────────────────────────────────────────────────────
let map, roadLayer, satelliteLayer, hybridLayer, activeLayer;
let markersLayer;
let coverageLayer = null;
let coverageVisible = true;   // tampil by default
let allData = [];             // semua customer (termasuk yg tidak ada koordinat)
let allDataFull = [];         // seluruh data termasuk yg tanpa koordinat, untuk pencarian
let activeMarkerEl = null;
let autoRefreshTimer = null;
let currentLat = null, currentLng = null;
let coordsCache = {};   // cache koordinat dari coords_cache.json

// ── Config ─────────────────────────────────────────────────────
const CENTER  = [-8.068665816544112, 111.91253692952158];
const ZOOM    = 14;
const REFRESH_MS = 5 * 60 * 1000;  // 5 menit
const API_BASE = (window.location.protocol === 'file:') ? 'http://localhost:3000' : '';

// ── DOM refs ───────────────────────────────────────────────────
const loaderOverlay = document.getElementById('loader-overlay');
const loaderTitle   = document.getElementById('loader-title');
const loaderSub     = document.getElementById('loader-sub');
const progressFill  = document.getElementById('progress-fill');
const statusPill    = document.getElementById('status-pill');
const statusText    = document.getElementById('status-text');
const infoPanel     = document.getElementById('info-panel');
const statCount     = document.getElementById('stat-count');
const coverageBadge = document.getElementById('coverage-badge');
const fabRefresh    = document.getElementById('fab-refresh');
const toggleCovBtn  = document.getElementById('toggle-coverage');

// ── Utilities ──────────────────────────────────────────────────
function setStatus(type, text, icon = 'sync') {
    statusPill.className = type;
    statusText.textContent = text;
    statusPill.querySelector('.status-icon').textContent = icon;
}
function showLoader(title, sub) {
    loaderTitle.textContent = title;
    loaderSub.textContent   = sub;
    loaderOverlay.classList.remove('hidden');
}
function hideLoader() {
    loaderOverlay.classList.add('hidden');
}

// ── Map Init ───────────────────────────────────────────────────
function initMap() {
    map = L.map('map', { center: CENTER, zoom: ZOOM, zoomControl: false, attributionControl: true });
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Google Maps tiles
    const googleTile = (lyrs) => L.tileLayer(
        `https://mt{s}.google.com/vt/lyrs=${lyrs}&x={x}&y={y}&z={z}`,
        { subdomains: ['0','1','2','3'],
          attribution: '© <a href="https://maps.google.com" target="_blank">Google Maps</a>',
          maxZoom: 21, maxNativeZoom: 20 }
    );

    roadLayer      = googleTile('m');
    satelliteLayer = googleTile('s');
    hybridLayer    = googleTile('y');

    roadLayer.addTo(map);
    activeLayer = roadLayer;

    markersLayer = L.layerGroup().addTo(map);

    map.on('zoomend', updateMarkerSizes);
    map.on('click', () => closePanel());
}

// ── Marker sizing (zoom-adaptive) ──────────────────────────────
function getMarkerSize(zoom) {
    if (zoom <= 10) return 9;
    if (zoom >= 18) return 30;
    return Math.round(9 + (zoom - 10) * 2.6);
}

function createMarkerIcon(coverage, active = false) {
    const size  = getMarkerSize(map.getZoom());
    const color = coverage === 'Cover'    ? '#34A853'
                : coverage === 'No Cover' ? '#EA4335'
                : '#1a73e8';
    const shadow = active
        ? `0 0 0 3px rgba(255,255,255,0.9), 0 4px 14px ${color}99`
        : '0 2px 6px rgba(0,0,0,0.35)';
    const scale = active ? 1.25 : 1;
    const s = Math.round(size * scale);
    return L.divIcon({
        html: `<div style="
            width:${s}px;height:${s}px;
            background:${color};
            border-radius:50% 50% 50% 0;
            transform:rotate(-45deg);
            border:${active?3:2}px solid #fff;
            box-shadow:${shadow};
            transition:all 0.2s;
        "></div>`,
        className: '',
        iconSize:   [s, s],
        iconAnchor: [s/2, s],
        popupAnchor:[0, -(s+4)],
    });
}

function updateMarkerSizes() {
    markersLayer.eachLayer(marker => {
        if (!marker._notionData) return;
        const isActive = (activeMarkerEl === marker);
        marker.setIcon(createMarkerIcon(marker._notionData.coverage, isActive));
    });
}

// ── Render Markers ─────────────────────────────────────────────
function renderMarkers(data, stats = null) {
    markersLayer.clearLayers();
    allData = data;
    // allDataFull mencakup semua customer (termasuk tanpa koordinat) untuk pencarian
    if (stats && stats._fullList) {
        allDataFull = stats._fullList;
    } else {
        allDataFull = data;
    }
    activeMarkerEl = null;

    data.forEach(item => {
        if (!item.lat || !item.lng) return;
        const marker = L.marker([item.lat, item.lng], {
            icon: createMarkerIcon(item.coverage || ''),
        });
        marker._notionData = item;
        marker.on('click', e => {
            L.DomEvent.stopPropagation(e);
            if (activeMarkerEl && activeMarkerEl !== marker) {
                activeMarkerEl.setIcon(createMarkerIcon(activeMarkerEl._notionData?.coverage || '', false));
            }
            activeMarkerEl = marker;
            marker.setIcon(createMarkerIcon(item.coverage || '', true));
            openPanel(item);
        });
        markersLayer.addLayer(marker);
    });

    // Update stat: tampilkan jumlah yg ada di peta
    const withCoords = data.filter(d => d.lat && d.lng).length;
    statCount.textContent = allDataFull.length > withCoords
        ? `${withCoords} / ${allDataFull.length}`
        : withCoords;

    const covCount = data.filter(d => d.coverage === 'Cover').length;
    if (covCount > 0) {
        coverageBadge.textContent = covCount + ' Cover';
        coverageBadge.classList.remove('hidden');
    } else {
        coverageBadge.classList.add('hidden');
    }

    const blankBadge = document.getElementById('blank-badge');
    if (stats && stats.blankCustomers > 0) {
        blankBadge.textContent = `${stats.blankCustomers} Tanpa Maps`;
        blankBadge.classList.remove('hidden');
    } else {
        blankBadge.classList.add('hidden');
    }
}

// ── Info Panel ─────────────────────────────────────────────────
function openPanel(item) {
    currentLat = item.lat;
    currentLng = item.lng;

    let nameHtml = item.nama || '(Tanpa Nama)';
    if (item.panggilan) {
        nameHtml += ` <span style="font-size:14px;color:#5f6368;font-weight:normal;display:block;margin-top:2px;">(Panggilan: ${item.panggilan})</span>`;
    }
    document.getElementById('panel-name').innerHTML = nameHtml;

    // Status pelanggan
    const statusEl = document.getElementById('panel-status');
    if (item.status) {
        statusEl.textContent  = item.status;
        statusEl.style.display = 'inline-block';
    } else {
        statusEl.style.display = 'none';
    }

    // Coverage badge
    const covEl = document.getElementById('panel-coverage');
    if (item.coverage === 'Cover') {
        covEl.className = 'panel-coverage covered';
        covEl.innerHTML = '<span class="material-icons-round" style="font-size:14px">wifi</span> Coverage';
    } else if (item.coverage && item.coverage !== '') {
        covEl.className = 'panel-coverage uncovered';
        covEl.innerHTML = '<span class="material-icons-round" style="font-size:14px">wifi_off</span> No Coverage';
    } else {
        covEl.className = 'panel-coverage unknown';
        covEl.innerHTML = '<span class="material-icons-round" style="font-size:14px">help_outline</span> Unknown';
    }

    // Paket
    const paketEl = document.getElementById('panel-paket');
    paketEl.innerHTML = item.paket
        ? `<div class="panel-row"><span class="material-icons-round">inventory_2</span><span>${item.paket}</span></div>`
        : '';

    // Alamat
    document.getElementById('panel-address').innerHTML = item.alamat
        ? `<div class="panel-row"><span class="material-icons-round">location_on</span><span>${item.alamat}</span></div>`
        : `<div class="panel-row"><span class="material-icons-round">location_on</span><span style="color:#9aa0a6">Alamat belum diisi</span></div>`;

    // Telepon
    document.getElementById('panel-phone').innerHTML = item.telepon
        ? `<div class="panel-row"><span class="material-icons-round">phone</span>
           <a href="tel:${item.telepon}" style="color:#1a73e8;text-decoration:none">${item.telepon}</a></div>`
        : '';

    // Koordinat
    document.getElementById('panel-coords').innerHTML = `
        <div class="panel-row">
          <span class="material-icons-round">my_location</span>
          <span style="font-size:12px;color:#5f6368">${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}</span>
        </div>`;

    // Load map embed
    loadMapEmbed('roadmap');
    document.querySelectorAll('.map-tab').forEach(tab => {
        tab.classList.remove('active');
        tab.onclick = () => {
            document.querySelectorAll('.map-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            loadMapEmbed(tab.dataset.mode);
        };
    });
    document.querySelector('.map-tab[data-mode="roadmap"]').classList.add('active');

    // Tombol aksi
    document.getElementById('btn-gmaps').href = `https://www.google.com/maps?q=${item.lat},${item.lng}`;
    document.getElementById('btn-directions').href = `https://www.google.com/maps/dir/?api=1&destination=${item.lat},${item.lng}`;

    infoPanel.classList.remove('hidden');
    map.panTo([item.lat, item.lng], { animate: true, duration: 0.4 });
}

function loadMapEmbed(mode) {
    const el = document.getElementById('panel-mini-map');
    if (!currentLat) return;
    if (mode === 'streetview') {
        el.innerHTML = `<iframe
            src="https://maps.google.com/maps?q=${currentLat},${currentLng}&layer=c&cbll=${currentLat},${currentLng}&cbp=12,0,0,0,0&ie=UTF8&source=embed&output=svembed&hl=id"
            allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"
            style="width:100%;height:100%;border:none;"></iframe>`;
    } else {
        el.innerHTML = `<iframe
            src="https://maps.google.com/maps?q=${currentLat},${currentLng}&z=17&output=embed&hl=id"
            allowfullscreen loading="lazy" referrerpolicy="no-referrer-when-downgrade"
            style="width:100%;height:100%;border:none;"></iframe>`;
    }
}

function closePanel() {
    infoPanel.classList.add('hidden');
    document.getElementById('panel-mini-map').innerHTML = '';
    if (activeMarkerEl) {
        activeMarkerEl.setIcon(createMarkerIcon(activeMarkerEl._notionData?.coverage || '', false));
        activeMarkerEl = null;
    }
    currentLat = null; currentLng = null;
}

// ── KML Coverage Parser ────────────────────────────────────────
// Warna KML Google My Maps: format AABBGGRR (ARGB terbalik)
function kmlColorToHex(kmlColor) {
    if (!kmlColor || kmlColor.length < 8) return '#4285F4';
    // kml: AABBGGRR → CSS: #RRGGBB
    const rr = kmlColor.substring(6, 8);
    const gg = kmlColor.substring(4, 6);
    const bb = kmlColor.substring(2, 4);
    return `#${rr}${gg}${bb}`;
}

function parseKMLToLayer(kmlText) {
    const parser = new DOMParser();
    const kml = parser.parseFromString(kmlText, 'application/xml');
    const group = L.layerGroup();

    // Kumpulkan style definitions
    const styles = {};
    kml.querySelectorAll('Style[id]').forEach(styleEl => {
        const id = styleEl.getAttribute('id');
        const lineColor = styleEl.querySelector('LineStyle > color')?.textContent?.trim();
        const iconColor = styleEl.querySelector('IconStyle > color')?.textContent?.trim();
        styles[id] = {
            lineColor: lineColor ? kmlColorToHex(lineColor) : null,
            iconColor: iconColor ? kmlColorToHex(iconColor) : null,
        };
    });

    // StyleMap → ambil normal style
    const styleMaps = {};
    kml.querySelectorAll('StyleMap[id]').forEach(smEl => {
        const id = smEl.getAttribute('id');
        smEl.querySelectorAll('Pair').forEach(pair => {
            if (pair.querySelector('key')?.textContent === 'normal') {
                const url = pair.querySelector('styleUrl')?.textContent?.trim().replace('#', '');
                styleMaps[id] = url;
            }
        });
    });

    function getStyle(styleUrl) {
        if (!styleUrl) return {};
        const key = styleUrl.replace('#', '');
        // Cek StyleMap dulu
        const resolved = styleMaps[key] || key;
        return styles[resolved] || {};
    }

    // Proses per Folder
    kml.querySelectorAll('Folder').forEach(folder => {
        const folderName = folder.querySelector(':scope > name')?.textContent || '';

        folder.querySelectorAll('Placemark').forEach(pm => {
            const pmName   = pm.querySelector('name')?.textContent || '';
            const pmDesc   = pm.querySelector('description')?.textContent?.trim() || '';
            const styleUrl = pm.querySelector('styleUrl')?.textContent || '';
            const style    = getStyle(styleUrl);

            // ── LineString ──
            const ls = pm.querySelector('LineString');
            if (ls) {
                const coordText = ls.querySelector('coordinates')?.textContent?.trim() || '';
                const coords = coordText.split(/\s+/)
                    .map(c => { const p = c.split(','); return [parseFloat(p[1]), parseFloat(p[0])]; })
                    .filter(c => !isNaN(c[0]) && !isNaN(c[1]));
                if (coords.length >= 2) {
                    const color = style.lineColor || '#4285F4';
                    const line = L.polyline(coords, {
                        color, weight: 2.5, opacity: 0.85,
                    });
                    if (pmName) {
                        line.bindPopup(`<div class="kml-popup">
                            <span class="kml-dot" style="background:${color}"></span>
                            <b>${pmName}</b>
                            ${pmDesc ? `<br><small>${pmDesc}</small>` : ''}
                            ${folderName ? `<br><small class="kml-folder">${folderName}</small>` : ''}
                        </div>`);
                    }
                    group.addLayer(line);
                }
                return;
            }

            // ── Point ──
            const pt = pm.querySelector('Point');
            if (pt) {
                const coordText = pt.querySelector('coordinates')?.textContent?.trim() || '';
                const parts = coordText.split(',');
                const lat = parseFloat(parts[1]);
                const lng = parseFloat(parts[0]);
                if (isNaN(lat) || isNaN(lng)) return;

                const color = style.iconColor || '#EA4335';
                const isRK  = pmName.startsWith('RK') || pmDesc.toLowerCase().includes('rk');
                const sz    = isRK ? 12 : 8;

                const icon = L.divIcon({
                    html: `<div style="
                        width:${sz}px;height:${sz}px;
                        background:${color};
                        border:2px solid white;
                        border-radius:${isRK?'3px':'50%'};
                        box-shadow:0 1px 4px rgba(0,0,0,0.4);
                    "></div>`,
                    className: '',
                    iconSize:   [sz, sz],
                    iconAnchor: [sz/2, sz/2],
                });

                const marker = L.marker([lat, lng], { icon });
                if (pmName || pmDesc) {
                    marker.bindPopup(`<div class="kml-popup">
                        <span class="kml-dot" style="background:${color};border-radius:${isRK?'2px':'50%'}"></span>
                        <b>${pmName}</b>
                        ${pmDesc ? `<br><small>${pmDesc}</small>` : ''}
                        ${folderName ? `<br><small class="kml-folder">${folderName}</small>` : ''}
                    </div>`);
                }
                group.addLayer(marker);
            }
        });
    });

    return group;
}

// ── Load & Toggle Coverage KML ─────────────────────────────────
async function loadCoverageKML(silent = false) {
    if (!silent) setStatus('loading', 'Memuat coverage...', 'cell_tower');
    try {
        const resp = await fetch(`${API_BASE}/api/coverage`, { signal: AbortSignal.timeout(15000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const kmlText = await resp.text();
        if (coverageLayer) map.removeLayer(coverageLayer);
        coverageLayer = parseKMLToLayer(kmlText);
        if (coverageLayer) {
            map.addLayer(coverageLayer);
            coverageVisible = true;
            toggleCovBtn.classList.add('active');
        }
        if (!silent) setStatus('success', `${allData.length} Pelanggan`, 'person_pin_circle');
    } catch (err) {
        console.warn('Coverage KML API gagal, coba coverage.kml lokal:', err.message);
        try {
            const local = await fetch(`${API_BASE}/coverage.kml`, { signal: AbortSignal.timeout(10000) });
            if (local.ok) {
                const kmlText = await local.text();
                if (coverageLayer) map.removeLayer(coverageLayer);
                coverageLayer = parseKMLToLayer(kmlText);
                if (coverageLayer) {
                    map.addLayer(coverageLayer);
                    coverageVisible = true;
                    toggleCovBtn.classList.add('active');
                }
                if (!silent) setStatus('success', `${allData.length} Pelanggan`, 'person_pin_circle');
                return;
            }
        } catch (_) { /* ignore */ }
        if (!silent) setStatus('error', 'Coverage gagal', 'error');
    }
}

function toggleCoverage() {
    if (!coverageLayer) {
        loadCoverageKML(false);
        return;
    }
    if (coverageVisible) {
        map.removeLayer(coverageLayer);
        coverageVisible = false;
        toggleCovBtn.classList.remove('active');
    } else {
        map.addLayer(coverageLayer);
        coverageVisible = true;
        toggleCovBtn.classList.add('active');
    }
}

// ── Proses halaman dari Notion dump format ───────────────────────
function processNotionPage(page) {
    const props = page.properties || {};
    const data  = { id: page.id, nama: '(Tanpa Nama)', panggilan: '', status: '', alamat: '', telepon: '', coverage: '', paket: '', lat: null, lng: null, mapsUrl: null };

    function getVal(prop) {
        if (!prop) return null;
        switch (prop.type) {
            case 'title':        return prop.title?.map(t => t.plain_text).join('') || null;
            case 'rich_text':    return prop.rich_text?.map(t => t.plain_text).join('') || null;
            case 'number':       return prop.number ?? null;
            case 'select':       return prop.select?.name || null;
            case 'status':       return prop.status?.name || null;
            case 'multi_select': return prop.multi_select?.map(s => s.name).join(', ') || null;
            case 'url':          return prop.url || null;
            case 'phone_number': return prop.phone_number || null;
            case 'formula': {
                const f = prop.formula;
                return f?.string || String(f?.number ?? '') || null;
            }
            default: return null;
        }
    }

    for (const [key, prop] of Object.entries(props)) {
        const val    = getVal(prop);
        if (val === null || val === '') continue;
        const lowKey = key.toLowerCase().trim();
        const strVal = String(val).trim();

        // ── Nama Pelanggan (nama lengkap) — prioritas utama
        if (lowKey === 'nama pelanggan') {
            if (strVal) data.nama = strVal;
        }
        // ── Nama Costumer (panggilan) — simpan sebagai field terpisah
        if (lowKey === 'nama costumer') {
            if (strVal) data.panggilan = strVal;
        }
        // ── Fallback: title field jika nama pelanggan kosong
        if (prop.type === 'title' && data.nama === '(Tanpa Nama)' && strVal) {
            data.nama = strVal;
        }

        if (lowKey === 'status') data.status = strVal;
        if (lowKey.includes('alamat') || lowKey.includes('address')) data.alamat = strVal;
        if (lowKey.includes('telp') || lowKey.includes('phone') || lowKey.includes('telepon') || lowKey.includes('nomor')) data.telepon = strVal;
        if (lowKey.includes('coverage')) data.coverage = strVal.trim();
        if (lowKey === 'paket') data.paket = strVal;

        // Maps URL — tangkap kolom 'Maps' (type: url) secara eksplisit
        if (prop.type === 'url' && prop.url && data.mapsUrl === null) {
            if (lowKey === 'maps' || lowKey.includes('map') || lowKey.includes('lokasi')) {
                // Bersihkan spasi dan format markdown
                let cleanUrl = prop.url.trim();
                const mdMatch = cleanUrl.match(/\[([^\]]+)\]\(([^)]+)\)/);
                if (mdMatch) cleanUrl = mdMatch[2];
                if (cleanUrl.startsWith('http')) data.mapsUrl = cleanUrl;
            }
        }
        // Maps URL dari rich_text atau teks biasa
        if (!data.mapsUrl && strVal.includes('http')) {
            if (lowKey.includes('map') || lowKey.includes('lokasi') || lowKey.includes('link')) {
                const urlMatch = strVal.match(/https?:\/\/[^\s)"\]]+/);
                if (urlMatch) data.mapsUrl = urlMatch[0];
            }
        }

        // Koordinat langsung dari teks/URL
        if (data.lat === null || data.lng === null) {
            const decoded = decodeURIComponent(strVal);
            // Pattern @lat,lng
            let m = decoded.match(/@(-?\d{1,2}\.\d{4,}),(-?\d{2,3}\.\d{4,})/);
            if (m) { data.lat = parseFloat(m[1]); data.lng = parseFloat(m[2]); }
            if (!m) {
                // Pattern q=lat,lng
                m = decoded.match(/(?:q=|ll=)(-?\d{1,2}\.\d{4,})[,\s%]+(-?\d{2,3}\.\d{4,})/);
                if (m) { data.lat = parseFloat(m[1]); data.lng = parseFloat(m[2]); }
            }
            if (!m) {
                // Pattern !3d!4d
                m = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
                if (m) { data.lat = parseFloat(m[1]); data.lng = parseFloat(m[2]); }
            }
            if (!m && strVal.includes('.')) {
                m = decoded.match(/(-?\d{1,2}\.\d{4,})[,\s]+(-?\d{2,3}\.\d{4,})/);
                if (m) { data.lat = parseFloat(m[1]); data.lng = parseFloat(m[2]); }
            }
        }
    }

    // ── Gunakan cache koordinat jika lat/lng belum ditemukan
    if ((data.lat === null || data.lng === null) && data.mapsUrl) {
        const cached = coordsCache[data.mapsUrl] || coordsCache[data.mapsUrl.replace(/\?.*$/, '')];
        if (cached) { data.lat = cached.lat; data.lng = cached.lng; }
    }

    return data;
}

async function loadCoordsCache() {
    try {
        const resp = await fetch(`${API_BASE}/coords_cache.json`, { signal: AbortSignal.timeout(10000) });
        if (resp.ok) {
            coordsCache = await resp.json();
            console.log(`✅ Cache koordinat dimuat: ${Object.keys(coordsCache).length} entri`);
        }
    } catch (e) {
        console.warn('⚠️ coords_cache.json tidak tersedia:', e.message);
    }
}

// ── Load fallback: baca notion_dump.json langsung di browser ──
async function loadFromDump() {
    const resp = await fetch(`${API_BASE}/notion_dump.json`, { signal: AbortSignal.timeout(30000) });
    if (!resp.ok) throw new Error('notion_dump.json tidak ditemukan');
    const json = await resp.json();
    const pages = json.results || json;

    const locations   = [];
    const needResolve = [];
    let totalCustomers = 0, blankCustomers = 0;

    for (const page of pages) {
        const data = processNotionPage(page);
        const s = (data.status || '').toLowerCase().trim();
        const isCustomer = s.includes('costumer') || s.includes('customer') ||
                           s === 'aktif' || s === 'active';
        if (!isCustomer) continue;
        totalCustomers++;

        if (data.lat !== null && data.lng !== null) {
            locations.push(data);
        } else if (data.mapsUrl) {
            // Cek cache dulu sebelum masuk needResolve
            const cleanUrl = data.mapsUrl.trim().replace(/\?.*$/, '');
            const cached = coordsCache[data.mapsUrl] || coordsCache[cleanUrl];
            if (cached) {
                data.lat = cached.lat;
                data.lng = cached.lng;
                locations.push(data);
            } else {
                needResolve.push(data);
            }
        } else {
            blankCustomers++;
        }
    }

    return { locations, needResolve, stats: { totalCustomers, mappedCustomers: locations.length + needResolve.length, blankCustomers } };
}

// ── Load Notion Data ───────────────────────────────────────────
async function loadData(silent = false) {
    if (!silent) {
        setStatus('loading', 'Memuat data Notion...', 'sync');
        showLoader('Mengambil data pelanggan...', 'Menghubungkan ke Notion API...');
        progressFill.style.animation = 'progress-pulse 2s ease-in-out infinite';
        closePanel();
    }
    fabRefresh.classList.add('spinning');

    let data;
    try {
        // Coba API serverless (langsung ke Notion API)
        const resp = await fetch(`${API_BASE}/api/notion`, {
            signal: AbortSignal.timeout(25000)
        });
        if (!resp.ok) throw new Error(`API HTTP ${resp.status}`);
        data = await resp.json();
        if (data.error) throw new Error(data.error);
        console.log('✅ Data dari Notion API (via serverless)');
    } catch (apiErr) {
        // Fallback: baca langsung dari notion_dump.json
        console.warn('⚠️ API gagal, fallback ke notion_dump.json:', apiErr.message);
        if (!silent) showLoader('Memuat dari cache lokal...', 'API tidak tersedia — membaca data offline...');
        try {
            data = await loadFromDump();
            console.log('✅ Data dari notion_dump.json (offline)');
        } catch (dumpErr) {
            setStatus('error', 'Gagal memuat data', 'error');
            if (!silent) {
                loaderTitle.textContent = 'Gagal memuat data';
                loaderSub.textContent   = 'Pastikan server berjalan dan Notion API Key valid';
                progressFill.style.animation = 'none';
                progressFill.style.width = '0%';
            }
            fabRefresh.classList.remove('spinning');
            return;
        }
    }

    try {
        let locations   = Array.isArray(data) ? data : (data.locations || []);
        let needResolve = data.needResolve || [];
        let stats       = data.stats || null;

        // Simpan daftar lengkap untuk pencarian (termasuk yg belum punya koordinat)
        const fullList = [
            ...locations,
            ...needResolve,
        ];
        if (stats) stats._fullList = fullList;

        progressFill.style.animation = 'none';
        progressFill.style.width = needResolve.length === 0 ? '100%' : '40%';

        allData     = [...locations];
        allDataFull = [...fullList];
        renderMarkers(allData, stats);

        const totalDisplay = stats?.totalCustomers || allData.length;
        if (!silent && needResolve.length === 0) hideLoader();
        setStatus('success', `${totalDisplay} Pelanggan`, 'person_pin_circle');

        // ── Resolve URL pendek Maps (batch) ──
        if (needResolve.length > 0) {
            if (!silent) {
                showLoader('Menelusuri Lokasi Peta...', `0 dari ${needResolve.length} link diproses`);
                progressFill.style.width = '0%';
            }
            const BATCH_SIZE  = 8;
            let resolvedCount = 0;
            for (let i = 0; i < needResolve.length; i += BATCH_SIZE) {
                const batch = needResolve.slice(i, i + BATCH_SIZE);
                try {
                    const res = await fetch(`${API_BASE}/api/notion`, {
                        method:  'POST',
                        body:    JSON.stringify(batch),
                        headers: { 'Content-Type': 'application/json' },
                        signal:  AbortSignal.timeout(15000)
                    });
                    if (res.ok) {
                        const resolved = await res.json();
                        if (Array.isArray(resolved) && resolved.length > 0) {
                            allData = allData.concat(resolved);
                            // Update allDataFull juga
                            resolved.forEach(r => {
                                const idx = allDataFull.findIndex(d => d.id === r.id);
                                if (idx >= 0) allDataFull[idx] = r;
                            });
                            if (stats) stats._fullList = allDataFull;
                            renderMarkers(allData, stats);
                            setStatus('success', `${totalDisplay} Pelanggan`, 'person_pin_circle');
                        }
                    }
                } catch (e) { console.warn('Batch resolve gagal:', e.message); }

                resolvedCount += batch.length;
                if (!silent) {
                    progressFill.style.width = `${Math.round((resolvedCount / needResolve.length) * 100)}%`;
                    loaderSub.textContent    = `${Math.min(resolvedCount, needResolve.length)} dari ${needResolve.length} link diproses`;
                }
            }
            if (!silent) setTimeout(hideLoader, 600);
        }

        fabRefresh.classList.remove('spinning');

    } catch (err) {
        console.error('loadData error:', err);
        setStatus('error', 'Gagal memuat', 'error');
        if (!silent) {
            loaderTitle.textContent = 'Gagal memuat data';
            loaderSub.textContent   = err.message;
            progressFill.style.animation = 'none';
            progressFill.style.width = '0%';
        }
        fabRefresh.classList.remove('spinning');
    }
}

// ── Auto Refresh ───────────────────────────────────────────────
function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
        console.log('[Auto-refresh] Memuat ulang data...');
        loadData(true);
    }, REFRESH_MS);
}

// ── Layer Switcher ─────────────────────────────────────────────
function switchLayer(layer, btnId) {
    map.removeLayer(activeLayer);
    layer.addTo(map);
    activeLayer = layer;
    document.querySelectorAll('.layer-btn:not(#toggle-coverage)').forEach(b => b.classList.remove('active'));
    document.getElementById(btnId).classList.add('active');
}

// ── Events ─────────────────────────────────────────────────────
document.getElementById('panel-close').addEventListener('click', closePanel);
document.getElementById('fab-refresh').addEventListener('click', () => loadData(false));
document.getElementById('layer-road').addEventListener('click',      () => switchLayer(roadLayer,      'layer-road'));
document.getElementById('layer-satellite').addEventListener('click', () => switchLayer(satelliteLayer, 'layer-satellite'));
document.getElementById('layer-hybrid').addEventListener('click',    () => switchLayer(hybridLayer,    'layer-hybrid'));
toggleCovBtn.addEventListener('click', toggleCoverage);

// ── Customer Search ─────────────────────────────────────────────
(function initCustomerSearch() {
    const searchInput   = document.getElementById('customer-search-input');
    const searchResults = document.getElementById('customer-search-results');
    const clearBtn      = document.getElementById('customer-search-clear');
    let   activeIdx     = -1;
    let   filteredItems = [];

    // Escape regex special chars
    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // Highlight matching substring
    function highlight(text, query) {
        if (!query) return text;
        const re = new RegExp(`(${escapeRegex(query)})`, 'gi');
        return text.replace(re, '<mark>$1</mark>');
    }

    // Coverage helpers
    function coverageColor(cov) {
        if (cov === 'Cover')    return '#34A853';
        if (cov === 'No Cover') return '#EA4335';
        return '#1a73e8';
    }
    function coverageClass(cov) {
        if (cov === 'Cover')    return 'covered';
        if (cov === 'No Cover') return 'uncovered';
        return 'unknown';
    }
    function coverageLabel(cov) {
        if (cov === 'Cover')    return 'Cover';
        if (cov === 'No Cover') return 'No Cover';
        return 'Unknown';
    }

    function renderResults(query) {
        activeIdx = -1;
        query = query.trim();

        if (!query) {
            searchResults.classList.add('hidden');
            clearBtn.classList.add('hidden');
            return;
        }

        clearBtn.classList.remove('hidden');

        // Cari dari allDataFull (termasuk pelanggan tanpa koordinat)
        const searchPool = allDataFull.length > 0 ? allDataFull : allData;
        filteredItems = searchPool.filter(d =>
            (d.nama && d.nama.toLowerCase().includes(query.toLowerCase())) ||
            (d.panggilan && d.panggilan.toLowerCase().includes(query.toLowerCase()))
        ).slice(0, 40); // max 40 hasil

        if (filteredItems.length === 0) {
            searchResults.innerHTML = `
                <div class="csr-empty">
                    <span class="material-icons-round">search_off</span>
                    <span>Pelanggan "<strong>${query}</strong>" tidak ditemukan</span>
                    <span style="font-size:11px;color:#bdc1c6">Coba kata kunci lain</span>
                </div>`;
            searchResults.classList.remove('hidden');
            return;
        }

        searchResults.innerHTML = filteredItems.map((item, i) => {
            const color    = coverageColor(item.coverage);
            const cls      = coverageClass(item.coverage);
            const label    = coverageLabel(item.coverage);
            
            let displayName = item.nama || '(Tanpa Nama)';
            if (item.panggilan) {
                displayName += ` (${item.panggilan})`;
            }
            const name     = highlight(displayName, query);
            const hasCoord = item.lat && item.lng;
            const subParts = [];
            if (item.paket)  subParts.push(item.paket);
            if (item.alamat) subParts.push(item.alamat);
            const sub = subParts.join(' · ') || (hasCoord ? 'Klik untuk ke lokasi' : 'Tidak ada info alamat');
            const noLocBadge = !hasCoord
                ? '<span class="csr-noloc" title="Koordinat belum tersedia">📍 Belum ada lokasi</span>'
                : '';
            return `
            <div class="csr-item${!hasCoord ? ' csr-noloc-item' : ''}" data-idx="${i}" role="option" title="${item.nama || ''}">
                <div class="csr-dot" style="background:${color};${!hasCoord ? 'opacity:0.4' : ''}"></div>
                <div class="csr-info">
                    <div class="csr-name">${name}</div>
                    <div class="csr-sub">${sub}${noLocBadge}</div>
                </div>
                <span class="csr-badge ${cls}">${label}</span>
            </div>`;
        }).join('');

        // Click handler per item
        searchResults.querySelectorAll('.csr-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx  = parseInt(el.dataset.idx, 10);
                const item = filteredItems[idx];
                selectCustomer(item);
            });
        });

        searchResults.classList.remove('hidden');
    }

    function selectCustomer(item) {
        if (!item) return;

        if (item.lat && item.lng) {
            // Fly to & buka panel
            map.setView([item.lat, item.lng], Math.max(map.getZoom(), 17), { animate: true });

            // Cari marker yang sesuai di layer
            let found = false;
            markersLayer.eachLayer(marker => {
                if (found) return;
                const d = marker._notionData;
                if (d && (d.id === item.id || (d.lat === item.lat && d.lng === item.lng && d.nama === item.nama))) {
                    found = true;
                    if (activeMarkerEl && activeMarkerEl !== marker) {
                        activeMarkerEl.setIcon(createMarkerIcon(activeMarkerEl._notionData?.coverage || '', false));
                    }
                    activeMarkerEl = marker;
                    marker.setIcon(createMarkerIcon(item.coverage || '', true));
                    openPanel(item);
                }
            });
            // Jika tidak ada marker yang match (data baru), buka panel langsung
            if (!found) openPanel(item);
        } else {
            // Tidak ada koordinat — buka panel tapi tanpa fly
            openPanelNoCoords(item);
        }

        clearSearch();
    }

    function clearSearch() {
        searchInput.value = '';
        searchResults.classList.add('hidden');
        clearBtn.classList.add('hidden');
        filteredItems = [];
        activeIdx     = -1;
    }

    function setActiveItem(idx) {
        const items = searchResults.querySelectorAll('.csr-item');
        items.forEach(el => el.classList.remove('csr-active'));
        if (idx >= 0 && idx < items.length) {
            items[idx].classList.add('csr-active');
            items[idx].scrollIntoView({ block: 'nearest' });
        }
        activeIdx = idx;
    }

    // Input: live search
    searchInput.addEventListener('input', e => renderResults(e.target.value));

    // Keyboard navigation
    searchInput.addEventListener('keydown', e => {
        const count = filteredItems.length;
        if (!count) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActiveItem((activeIdx + 1) % count);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActiveItem((activeIdx - 1 + count) % count);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (activeIdx >= 0) selectCustomer(filteredItems[activeIdx]);
            else if (filteredItems.length === 1) selectCustomer(filteredItems[0]);
        } else if (e.key === 'Escape') {
            clearSearch();
            searchInput.blur();
        }
    });

    // Clear button
    clearBtn.addEventListener('click', () => {
        clearSearch();
        searchInput.focus();
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', e => {
        const wrap = document.getElementById('customer-search-wrap');
        if (!wrap.contains(e.target)) {
            searchResults.classList.add('hidden');
        }
    });
})();

// ── Panel untuk pelanggan tanpa koordinat ──────────────────────
function openPanelNoCoords(item) {
    currentLat = null;
    currentLng = null;

    document.getElementById('panel-name').textContent = item.nama || '(Tanpa Nama)';

    const statusEl = document.getElementById('panel-status');
    if (item.status) {
        statusEl.textContent   = item.status;
        statusEl.style.display = 'inline-block';
    } else {
        statusEl.style.display = 'none';
    }

    const covEl = document.getElementById('panel-coverage');
    if (item.coverage === 'Cover') {
        covEl.className = 'panel-coverage covered';
        covEl.innerHTML = '<span class="material-icons-round" style="font-size:14px">wifi</span> Coverage';
    } else if (item.coverage && item.coverage !== '') {
        covEl.className = 'panel-coverage uncovered';
        covEl.innerHTML = '<span class="material-icons-round" style="font-size:14px">wifi_off</span> No Coverage';
    } else {
        covEl.className = 'panel-coverage unknown';
        covEl.innerHTML = '<span class="material-icons-round" style="font-size:14px">help_outline</span> Unknown';
    }

    const paketEl = document.getElementById('panel-paket');
    paketEl.innerHTML = item.paket
        ? `<div class="panel-row"><span class="material-icons-round">inventory_2</span><span>${item.paket}</span></div>`
        : '';

    document.getElementById('panel-address').innerHTML = item.alamat
        ? `<div class="panel-row"><span class="material-icons-round">location_on</span><span>${item.alamat}</span></div>`
        : `<div class="panel-row"><span class="material-icons-round">location_on</span><span style="color:#9aa0a6">Alamat belum diisi</span></div>`;

    document.getElementById('panel-phone').innerHTML = item.telepon
        ? `<div class="panel-row"><span class="material-icons-round">phone</span>
           <a href="tel:${item.telepon}" style="color:#1a73e8;text-decoration:none">${item.telepon}</a></div>`
        : '';

    document.getElementById('panel-coords').innerHTML = `
        <div class="panel-row">
          <span class="material-icons-round" style="color:#EA4335">location_off</span>
          <span style="font-size:12px;color:#9aa0a6">Koordinat Maps belum tersedia di Notion</span>
        </div>`;

    // Kosongkan mini map & tombol
    document.getElementById('panel-mini-map').innerHTML =
        `<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9aa0a6;font-size:13px;flex-direction:column;gap:6px;">
            <span class="material-icons-round" style="font-size:36px;color:#dadce0">map</span>
            Lokasi belum diisi di Notion
        </div>`;
    document.getElementById('btn-gmaps').removeAttribute('href');
    document.getElementById('btn-directions').removeAttribute('href');

    infoPanel.classList.remove('hidden');
}

// ── Init ───────────────────────────────────────────────────────
(async () => {
    initMap();
    // Load cache koordinat DULU sebelum data
    await loadCoordsCache();
    // Load Notion data dan Coverage KML secara bersamaan
    await Promise.all([
        loadData(false),
        loadCoverageKML(true),
    ]);
    startAutoRefresh();
})();
