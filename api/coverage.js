// ============================================================
//  api/coverage.js
//  Vercel Serverless Function — Proxy KML dari Google My Maps
//  Cache 1 jam via Vercel Edge Network
// ============================================================

const KML_URL = 'https://www.google.com/maps/d/u/0/kml?mid=1EcJ7dHbkaN5IJ6AzGDLTL-RPs6niewc&forcekml=1';

module.exports = async (req, res) => {
    // CORS & Caching Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate');

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    try {
        console.log('📡 Mengambil KML dari Google My Maps...');
        
        // Menggunakan native fetch bawaan Node 18+ (Vercel standard)
        const resp = await fetch(KML_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/xml,text/xml,*/*',
            },
            signal: AbortSignal.timeout(12000)
        });

        if (!resp.ok) {
            throw new Error(`HTTP ${resp.status}`);
        }

        const kmlText = await resp.text();
        console.log(`✅ KML berhasil (${kmlText.length} bytes)`);

        res.setHeader('Content-Type', 'application/vnd.google-earth.kml+xml; charset=utf-8');
        return res.status(200).send(kmlText);
    } catch (err) {
        console.error('❌ KML fetch error:', err.message);
        return res.status(502).json({ error: 'Gagal mengambil data coverage: ' + err.message });
    }
};
