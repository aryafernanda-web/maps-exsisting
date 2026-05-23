// ============================================================
//  api/notion.js  —  Fiber Customer Maps v3.0
//  Serverless Function (Vercel / local vercel dev)
//  ✅ Langsung ambil data dari Notion API (real-time, semua halaman)
//  ✅ Fallback ke notion_dump.json jika API tidak tersedia
//  ✅ coords_cache.json untuk resolusi URL offline
//  ✅ Resolve short URL Maps secara otomatis
// ============================================================

const path = require('path');
const fs   = require('fs');

// ── Konfigurasi ────────────────────────────────────────────────
const NOTION_API_KEY     = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '29edcd14e2c880ddb393dc9f54758a18';
const NOTION_BASE_URL    = 'https://api.notion.com/v1';
const NOTION_VERSION     = '2022-06-28';

// Helper to read and decode JSON files (handles UTF-8 and UTF-16 with BOMs)
function readJsonFileSync(filePath) {
    const buffer = fs.readFileSync(filePath);
    if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
        return buffer.toString('utf16le').replace(/^\uFEFF/, '');
    }
    return buffer.toString('utf8').replace(/^\uFEFF/, '');
}

// ── Load Koordinat Cache ────────────────────────────────────────
let coordsCache = {};
try {
    const cachePaths = [
        path.join(process.cwd(), 'coords_cache.json'),
        path.join(__dirname, '..', 'coords_cache.json'),
    ];
    for (const cp of cachePaths) {
        if (fs.existsSync(cp)) {
            const raw = readJsonFileSync(cp);
            coordsCache = JSON.parse(raw);
            console.log(`📌 Cache koordinat: ${Object.keys(coordsCache).length} entri`);
            break;
        }
    }
} catch (e) {
    console.warn('⚠️ Gagal load coords_cache.json:', e.message);
}

// ── Helper: ambil nilai properti Notion ────────────────────────
function getPropValue(prop) {
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
        case 'email':        return prop.email || null;
        case 'checkbox':     return prop.checkbox;
        case 'date':         return prop.date?.start || null;
        case 'formula': {
            const f = prop.formula;
            return f?.string || f?.number || f?.boolean || f?.date?.start || null;
        }
        case 'rollup': {
            if (prop.rollup?.array) {
                return prop.rollup.array.map(v => getPropValue(v)).filter(x => x !== null).join(', ');
            }
            const r = prop.rollup;
            return r?.number ?? r?.string ?? r?.date?.start ?? null;
        }
        case 'files':
            return prop.files?.map(f => f.file?.url || f.external?.url).filter(Boolean).join(', ') || null;
        default: return null;
    }
}

// ── Ekstrak koordinat dari URL/teks ────────────────────────────
function extractCoords(text) {
    if (!text || typeof text !== 'string') return null;
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch(e) {}

    // !3d{lat}!4d{lng}
    let m = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

    // @lat,lng
    m = decoded.match(/@(-?\d{1,2}\.\d{4,}),(-?\d{2,3}\.\d{4,})/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

    // ?q=lat,lng atau &q=lat,lng
    m = decoded.match(/[?&]q=(-?\d{1,2}\.\d{4,})[,\s%2C]+(-?\d{2,3}\.\d{4,})/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

    // ll=lat,lng
    m = decoded.match(/ll=(-?\d{1,2}\.\d{4,}),(-?\d{2,3}\.\d{4,})/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

    // Koordinat polos lat,lng
    m = decoded.match(/(-?\d{1,2}\.\d{4,})[,\s]+(-?\d{2,3}\.\d{4,})/);
    if (m) {
        const lat = parseFloat(m[1]);
        const lng = parseFloat(m[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }

    return null;
}

// ── Resolve URL pendek Maps (ikuti redirect) ───────────────────
async function resolveShortUrl(url, timeoutMs = 6000) {
    const cacheKey = url.trim();
    const cleanKey = cacheKey.replace(/\?.*$/, '');
    if (coordsCache[cacheKey]) return coordsCache[cacheKey];
    if (coordsCache[cleanKey]) return coordsCache[cleanKey];

    const direct = extractCoords(url);
    if (direct) return direct;

    try {
        let currentUrl = url;
        for (let hop = 0; hop < 5; hop++) {
            const res = await fetch(currentUrl, {
                method: 'HEAD',
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                redirect: 'manual',
                signal: AbortSignal.timeout(timeoutMs)
            });
            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get('location');
                if (!location) break;
                const coords = extractCoords(location);
                if (coords) return coords;
                const continueMatch = location.match(/[?&]continue=([^&]+)/);
                if (continueMatch) {
                    const cont = extractCoords(decodeURIComponent(continueMatch[1]));
                    if (cont) return cont;
                }
                currentUrl = location.startsWith('http') ? location : `https://www.google.com${location}`;
            } else {
                const finalUrl = res.url || currentUrl;
                const coords = extractCoords(finalUrl);
                if (coords) return coords;
                break;
            }
        }
    } catch (e) { /* timeout / network error */ }
    return null;
}

// ── Proses satu halaman Notion → objek marker ──────────────────
function processPage(page) {
    const props = page.properties || {};
    const data  = {
        id:        page.id,
        nama:      '(Tanpa Nama)',   // Nama Pelanggan (nama lengkap)
        panggilan: '',               // Nama Costumer (nama panggilan)
        status:    '',
        alamat:    '',
        telepon:   '',
        coverage:  '',
        paket:     '',
        lat:       null,
        lng:       null,
        mapsUrl:   null
    };

    for (const [key, prop] of Object.entries(props)) {
        const val    = getPropValue(prop);
        if (val === null || val === '') continue;
        const lowKey = key.toLowerCase().trim();
        const strVal = String(val).trim();

        // ── Nama Pelanggan (nama lengkap) — prioritas utama
        if (lowKey === 'nama pelanggan') {
            if (strVal) data.nama = strVal;
        }
        // ── Nama Costumer (panggilan) — simpan sebagai panggilan
        if (lowKey === 'nama costumer') {
            if (strVal) data.panggilan = strVal;
        }
        // ── Fallback: title field atau field nama lain
        if (prop.type === 'title' && data.nama === '(Tanpa Nama)' && strVal) {
            data.nama = strVal;
        }

        // ── Lat / Lng langsung
        if (lowKey.includes('lat') && !isNaN(parseFloat(val)) && data.lat === null)
            data.lat = parseFloat(val);
        if ((lowKey.includes('lng') || lowKey.includes('long')) && !isNaN(parseFloat(val)) && data.lng === null)
            data.lng = parseFloat(val);

        // ── Maps URL (type: url)
        if (prop.type === 'url' && prop.url && data.mapsUrl === null) {
            if (lowKey === 'maps' || lowKey.includes('map') || lowKey.includes('lokasi')) {
                let cleanUrl = prop.url.trim();
                const mdMatch = cleanUrl.match(/\[([^\]]+)\]\(([^)]+)\)/);
                if (mdMatch) cleanUrl = mdMatch[2];
                if (cleanUrl.startsWith('http')) data.mapsUrl = cleanUrl;
            }
        }
        // Maps URL dari rich_text
        if (!data.mapsUrl && strVal.includes('http')) {
            if (lowKey.includes('map') || lowKey.includes('lokasi') || lowKey.includes('link')) {
                const urlMatch = strVal.match(/https?:\/\/[^\s)"]+/);
                if (urlMatch) data.mapsUrl = urlMatch[0];
            }
        }

        // ── Metadata
        if (lowKey === 'status') data.status = strVal;
        if (lowKey.includes('alamat') || lowKey.includes('address')) data.alamat = strVal;
        if (lowKey.includes('telp') || lowKey.includes('phone') || lowKey.includes('telepon') || lowKey.includes('nomor')) data.telepon = strVal;
        if (lowKey.includes('coverage')) data.coverage = strVal.trim();
        if (lowKey === 'paket') data.paket = strVal;

        // ── Deep scan koordinat dari semua field
        if (data.lat === null || data.lng === null) {
            const coords = extractCoords(strVal);
            if (coords) { data.lat = coords.lat; data.lng = coords.lng; }
        }
    }

    // ── Gunakan cache koordinat jika lat/lng belum ditemukan
    if ((data.lat === null || data.lng === null) && data.mapsUrl) {
        const cacheKey = data.mapsUrl.trim();
        const cleanKey = cacheKey.replace(/\?.*$/, '');
        const cached   = coordsCache[cacheKey] || coordsCache[cleanKey];
        if (cached) { data.lat = cached.lat; data.lng = cached.lng; }
    }

    return data;
}

// ── Cek apakah entry adalah customer ──────────────────────────
function isCustomer(data) {
    const s = (data.status || '').toLowerCase().trim();
    return s.includes('costumer') || s.includes('customer') || s === 'aktif' || s === 'active';
}

// ── Ambil SEMUA halaman dari Notion API (dengan pagination) ────
async function fetchAllNotionPages() {
    const pages = [];
    let cursor  = undefined;
    let page    = 1;

    while (true) {
        const body = {
            page_size: 100,
            ...(cursor ? { start_cursor: cursor } : {})
        };

        const res = await fetch(`${NOTION_BASE_URL}/databases/${NOTION_DATABASE_ID}/query`, {
            method:  'POST',
            headers: {
                'Authorization':  `Bearer ${NOTION_API_KEY}`,
                'Notion-Version': NOTION_VERSION,
                'Content-Type':   'application/json',
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(20000)
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Notion API error ${res.status}: ${errText}`);
        }

        const json = await res.json();
        pages.push(...(json.results || []));
        console.log(`📄 Halaman ${page}: ${json.results?.length || 0} entries (total: ${pages.length})`);

        if (!json.has_more || !json.next_cursor) break;
        cursor = json.next_cursor;
        page++;
    }

    return pages;
}

// ── Main Handler ───────────────────────────────────────────────
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();

    // ── MODE POST: Resolve URL batch ──────────────────────────
    if (req.method === 'POST') {
        try {
            const batch = req.body;
            if (!Array.isArray(batch)) throw new Error('Invalid payload');
            const startTime = Date.now();
            const results   = await Promise.allSettled(
                batch.map(async (item) => {
                    if (Date.now() - startTime > 9000) return null;
                    const coords = await resolveShortUrl(item.mapsUrl, 4000);
                    return coords ? { ...item, lat: coords.lat, lng: coords.lng } : null;
                })
            );
            const resolved = results
                .filter(r => r.status === 'fulfilled' && r.value)
                .map(r => r.value);
            return res.status(200).json(resolved);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ── MODE GET: Ambil data dari Notion API (utama) ──────────
    try {
        let pages = null;

        // === SUMBER UTAMA: Notion API langsung ===
        try {
            console.log('🌐 Mengambil data langsung dari Notion API...');
            pages = await fetchAllNotionPages();
            console.log(`✅ Notion API: ${pages.length} halaman`);
        } catch (apiErr) {
            console.warn('⚠️ Notion API gagal:', apiErr.message);
        }

        // === FALLBACK: notion_dump.json (file statis) ===
        if (!pages) {
            const dumpPaths = [
                path.join(process.cwd(), 'notion_dump.json'),
                path.join(__dirname, '..', 'notion_dump.json'),
            ];
            for (const dumpPath of dumpPaths) {
                if (fs.existsSync(dumpPath)) {
                    console.log(`📂 Fallback: membaca notion_dump.json dari ${dumpPath}`);
                    const raw = readJsonFileSync(dumpPath);
                    const json = JSON.parse(raw);
                    pages = json.results || json;
                    console.log(`📂 Dump: ${pages.length} halaman`);
                    break;
                }
            }
        }

        if (!pages || pages.length === 0) {
            return res.status(503).json({ error: 'Tidak ada sumber data yang tersedia' });
        }

        const locations    = [];
        const needResolve  = [];
        let totalCustomers = 0;
        let blankCustomers = 0;

        for (const page of pages) {
            const data = processPage(page);
            if (!isCustomer(data)) continue;
            totalCustomers++;

            if (data.lat !== null && data.lng !== null) {
                locations.push(data);
            } else if (data.mapsUrl) {
                // Cek cache sekali lagi sebelum masuk needResolve
                const cached = coordsCache[data.mapsUrl] || coordsCache[data.mapsUrl.replace(/\?.*$/, '')];
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

        const mappedCustomers = locations.length + needResolve.length;
        console.log(`📍 Total Customer: ${totalCustomers} | Dipetakan: ${mappedCustomers} | Kosong: ${blankCustomers}`);

        return res.status(200).json({
            locations,
            needResolve,
            stats: { totalCustomers, mappedCustomers, blankCustomers }
        });

    } catch (err) {
        console.error('❌ Error:', err);
        return res.status(500).json({ error: err.message });
    }
};
