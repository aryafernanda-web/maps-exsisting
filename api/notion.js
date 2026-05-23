// ============================================================
//  api/notion.js  —  Fiber Customer Maps v3.2 (Fast + Vercel-ready)
//  ✅ Optimized untuk 500+ baris — tidak timeout di Vercel Free
//  ✅ Skip resolve URL saat GET (dilakukan client-side terpisah)
//  ✅ Safe fs handling
// ============================================================

const path = require('path');
const fs   = require('fs');

const NOTION_API_KEY     = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID || '29edcd14e2c880ddb393dc9f54758a18';
const NOTION_BASE_URL    = 'https://api.notion.com/v1';
const NOTION_VERSION     = '2022-06-28';

// ── Safe JSON reader ──────────────────────────────────────────
function readJsonFileSafe(filePath) {
    try {
        if (!fs.existsSync(filePath)) return null;
        const buffer = fs.readFileSync(filePath);
        let text = buffer[0] === 0xFF && buffer[1] === 0xFE
            ? buffer.toString('utf16le').replace(/^\uFEFF/, '')
            : buffer.toString('utf8').replace(/^\uFEFF/, '');
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

// ── Load coords cache ─────────────────────────────────────────
let coordsCache = {};
for (const cp of [
    path.join(process.cwd(), 'coords_cache.json'),
    path.join(__dirname, '..', 'coords_cache.json'),
]) {
    const data = readJsonFileSafe(cp);
    if (data && typeof data === 'object') {
        coordsCache = data;
        console.log(`📌 Cache: ${Object.keys(coordsCache).length} entri`);
        break;
    }
}

// ── Helper prop value ─────────────────────────────────────────
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
            if (prop.rollup?.array)
                return prop.rollup.array.map(v => getPropValue(v)).filter(Boolean).join(', ');
            const r = prop.rollup;
            return r?.number ?? r?.string ?? r?.date?.start ?? null;
        }
        case 'files':
            return prop.files?.map(f => f.file?.url || f.external?.url).filter(Boolean).join(', ') || null;
        default: return null;
    }
}

// ── Ekstrak koordinat ─────────────────────────────────────────
function extractCoords(text) {
    if (!text || typeof text !== 'string') return null;
    let decoded = text;
    try { decoded = decodeURIComponent(text); } catch(e) {}

    let m = decoded.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

    m = decoded.match(/@(-?\d{1,2}\.\d{4,}),(-?\d{2,3}\.\d{4,})/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

    m = decoded.match(/[?&]q=(-?\d{1,2}\.\d{4,})[,\s%2C]+(-?\d{2,3}\.\d{4,})/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

    m = decoded.match(/ll=(-?\d{1,2}\.\d{4,}),(-?\d{2,3}\.\d{4,})/);
    if (m) return { lat: parseFloat(m[1]), lng: parseFloat(m[2]) };

    m = decoded.match(/(-?\d{1,2}\.\d{4,})[,\s]+(-?\d{2,3}\.\d{4,})/);
    if (m) {
        const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
        if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
    }
    return null;
}

// ── Resolve short URL (hanya untuk POST batch) ────────────────
async function resolveShortUrl(url, timeoutMs = 4000) {
    const cacheKey = url.trim();
    const cleanKey = cacheKey.replace(/\?.*$/, '');
    if (coordsCache[cacheKey]) return coordsCache[cacheKey];
    if (coordsCache[cleanKey]) return coordsCache[cleanKey];

    const direct = extractCoords(url);
    if (direct) return direct;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        let currentUrl = url;
        for (let hop = 0; hop < 5; hop++) {
            const res = await fetch(currentUrl, {
                method: 'HEAD',
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' },
                redirect: 'manual',
                signal: controller.signal
            });
            if (res.status >= 300 && res.status < 400) {
                const location = res.headers.get('location');
                if (!location) break;
                const coords = extractCoords(location);
                if (coords) return coords;
                const cont = location.match(/[?&]continue=([^&]+)/);
                if (cont) {
                    const c = extractCoords(decodeURIComponent(cont[1]));
                    if (c) return c;
                }
                currentUrl = location.startsWith('http') ? location : `https://www.google.com${location}`;
            } else {
                const coords = extractCoords(res.url || currentUrl);
                if (coords) return coords;
                break;
            }
        }
    } catch (e) {
        // timeout atau network error — skip
    } finally {
        clearTimeout(timer);
    }
    return null;
}

// ── Proses satu page Notion ───────────────────────────────────
function processPage(page) {
    const props = page.properties || {};
    const data = {
        id: page.id,
        nama: '(Tanpa Nama)',
        panggilan: '',
        status: '',
        alamat: '',
        telepon: '',
        coverage: '',
        paket: '',
        lat: null,
        lng: null,
        mapsUrl: null
    };

    for (const [key, prop] of Object.entries(props)) {
        const val = getPropValue(prop);
        if (val === null || val === '') continue;
        const lowKey = key.toLowerCase().trim();
        const strVal = String(val).trim();

        if (lowKey === 'nama pelanggan' && strVal) data.nama = strVal;
        if (lowKey === 'nama costumer' && strVal) data.panggilan = strVal;
        if (prop.type === 'title' && data.nama === '(Tanpa Nama)' && strVal) data.nama = strVal;

        if (lowKey.includes('lat') && !isNaN(parseFloat(val)) && data.lat === null)
            data.lat = parseFloat(val);
        if ((lowKey.includes('lng') || lowKey.includes('long')) && !isNaN(parseFloat(val)) && data.lng === null)
            data.lng = parseFloat(val);

        if (prop.type === 'url' && prop.url && data.mapsUrl === null) {
            if (lowKey === 'maps' || lowKey.includes('map') || lowKey.includes('lokasi')) {
                let cleanUrl = prop.url.trim();
                const mdMatch = cleanUrl.match(/\[([^\]]+)\]\(([^)]+)\)/);
                if (mdMatch) cleanUrl = mdMatch[2];
                if (cleanUrl.startsWith('http')) data.mapsUrl = cleanUrl;
            }
        }
        if (!data.mapsUrl && strVal.includes('http')) {
            if (lowKey.includes('map') || lowKey.includes('lokasi') || lowKey.includes('link')) {
                const urlMatch = strVal.match(/https?:\/\/[^\s)"]+/);
                if (urlMatch) data.mapsUrl = urlMatch[0];
            }
        }

        if (lowKey === 'status') data.status = strVal;
        if (lowKey.includes('alamat') || lowKey.includes('address')) data.alamat = strVal;
        if (lowKey.includes('telp') || lowKey.includes('phone') || lowKey.includes('telepon') || lowKey.includes('nomor')) data.telepon = strVal;
        if (lowKey.includes('coverage')) data.coverage = strVal;
        if (lowKey === 'paket') data.paket = strVal;

        if (data.lat === null || data.lng === null) {
            const coords = extractCoords(strVal);
            if (coords) { data.lat = coords.lat; data.lng = coords.lng; }
        }
    }

    // Cek cache koordinat
    if ((data.lat === null || data.lng === null) && data.mapsUrl) {
        const ck = data.mapsUrl.trim();
        const cached = coordsCache[ck] || coordsCache[ck.replace(/\?.*$/, '')];
        if (cached) { data.lat = cached.lat; data.lng = cached.lng; }
    }

    return data;
}

function isCustomer(data) {
    const s = (data.status || '').toLowerCase().trim();
    return s.includes('costumer') || s.includes('customer') || s === 'aktif' || s === 'active';
}

// ── Fetch Notion dengan pagination PARALEL ────────────────────
async function fetchAllNotionPages() {
    // Fetch halaman pertama dulu untuk tahu total
    const firstRes = await fetchNotionPage(undefined);
    const allPages = [...(firstRes.results || [])];

    if (!firstRes.has_more) return allPages;

    // Fetch sisa halaman secara sequential (Notion tidak support parallel cursor)
    let cursor = firstRes.next_cursor;
    while (cursor) {
        const res = await fetchNotionPage(cursor);
        allPages.push(...(res.results || []));
        cursor = res.has_more ? res.next_cursor : null;
    }

    return allPages;
}

async function fetchNotionPage(cursor) {
    const body = { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);

    try {
        const res = await fetch(`${NOTION_BASE_URL}/databases/${NOTION_DATABASE_ID}/query`, {
            method: 'POST',
            headers: {
                'Authorization':  `Bearer ${NOTION_API_KEY}`,
                'Notion-Version': NOTION_VERSION,
                'Content-Type':   'application/json',
            },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        if (!res.ok) {
            const errText = await res.text();
            throw new Error(`Notion API ${res.status}: ${errText}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

// ── Main Handler ──────────────────────────────────────────────
module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.status(204).end();

    if (!NOTION_API_KEY) {
        return res.status(500).json({
            error: '❌ NOTION_API_KEY belum diset! Buka Vercel Dashboard → Settings → Environment Variables → tambahkan NOTION_API_KEY, lalu Redeploy.'
        });
    }

    // ── POST: Resolve URL batch (dari client) ─────────────────
    if (req.method === 'POST') {
        try {
            const batch = req.body;
            if (!Array.isArray(batch)) throw new Error('Payload harus array');
            const startTime = Date.now();
            const results = await Promise.allSettled(
                batch.slice(0, 20).map(async (item) => { // max 20 per batch
                    if (Date.now() - startTime > 20000) return null;
                    const coords = await resolveShortUrl(item.mapsUrl, 3000);
                    return coords ? { ...item, lat: coords.lat, lng: coords.lng } : null;
                })
            );
            return res.status(200).json(
                results.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value)
            );
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ── GET: Ambil data Notion ────────────────────────────────
    try {
        // Cek apakah ada parameter page untuk pagination client-side
        const pageParam = parseInt(req.query?.page || '0');
        const PAGE_SIZE = 100; // berapa baris per request

        console.log('🌐 Fetching Notion...');
        let pages = null;

        try {
            pages = await fetchAllNotionPages();
            console.log(`✅ Total: ${pages.length} pages dari Notion`);
        } catch (apiErr) {
            console.warn('⚠️ Notion API gagal:', apiErr.message);

            // Fallback ke dump
            for (const dp of [
                path.join(process.cwd(), 'notion_dump.json'),
                path.join(__dirname, '..', 'notion_dump.json'),
            ]) {
                const data = readJsonFileSafe(dp);
                if (data) { pages = data.results || data; break; }
            }
        }

        if (!pages || pages.length === 0) {
            return res.status(503).json({ error: 'Tidak ada data. Cek NOTION_API_KEY dan pastikan integration sudah di-share ke database.' });
        }

        const locations   = [];
        const needResolve = [];
        let totalCustomers = 0;
        let blankCustomers = 0;

        for (const page of pages) {
            const data = processPage(page);
            if (!isCustomer(data)) continue;
            totalCustomers++;

            if (data.lat !== null && data.lng !== null) {
                locations.push(data);
            } else if (data.mapsUrl) {
                const ck = data.mapsUrl.trim();
                const cached = coordsCache[ck] || coordsCache[ck.replace(/\?.*$/, '')];
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

        console.log(`📍 Customer: ${totalCustomers} | Mapped: ${locations.length} | NeedResolve: ${needResolve.length} | Blank: ${blankCustomers}`);

        return res.status(200).json({
            locations,
            needResolve,
            stats: { totalCustomers, mappedCustomers: locations.length + needResolve.length, blankCustomers }
        });

    } catch (err) {
        console.error('❌ Error:', err.message);
        return res.status(500).json({ error: err.message });
    }
};
