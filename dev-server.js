// ============================================================
//  dev-server.js — Local dev (static files + /api/* routes)
//  Jalankan: npm run local  →  http://localhost:3000
// ============================================================

const http = require('http');
const fs   = require('fs');
const path = require('path');

try {
    require('dotenv').config({ path: path.join(__dirname, '.env.local') });
    require('dotenv').config({ path: path.join(__dirname, '.env') });
} catch (_) { /* dotenv optional until npm install */ }

// Fallback: config.json (jangan commit API key asli)
try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        const key = config.NOTION_API_KEY;
        if (!process.env.NOTION_API_KEY && key && !String(key).includes('GANTI')) {
            process.env.NOTION_API_KEY = key;
        }
        if (!process.env.NOTION_DATABASE_ID && config.NOTION_DATABASE_ID) {
            process.env.NOTION_DATABASE_ID = config.NOTION_DATABASE_ID;
        }
    }
} catch (e) {
    console.warn('⚠️ config.json tidak bisa dibaca:', e.message);
}

const notionHandler   = require('./api/notion');
const coverageHandler = require('./api/coverage');

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.kml':  'application/vnd.google-earth.kml+xml',
    '.ico':  'image/x-icon',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
};

function enhanceRes(res) {
    res.status = (code) => ({
        end(body) {
            res.statusCode = code;
            if (body !== undefined) res.end(body);
            else res.end();
        },
        json(obj) {
            res.statusCode = code;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify(obj));
        },
        send(data) {
            res.statusCode = code;
            res.end(data);
        },
    });
    return res;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (!raw) return resolve(undefined);
            try {
                resolve(JSON.parse(raw));
            } catch {
                resolve(raw);
            }
        });
        req.on('error', reject);
    });
}

function serveStatic(urlPath, res) {
    let rel = decodeURIComponent(urlPath.split('?')[0]);
    if (rel === '/') rel = '/index.html';
    const filePath = path.normalize(path.join(ROOT, rel));
    if (!filePath.startsWith(ROOT)) {
        res.statusCode = 403;
        res.end('Forbidden');
        return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.statusCode = 404;
        res.end('Not Found');
        return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.statusCode = 200;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', ext === '.html' ? 'no-cache' : 'public, max-age=60');
    fs.createReadStream(filePath).pipe(res);
}

const server = http.createServer(async (incoming, outgoing) => {
    const url = new URL(incoming.url, `http://localhost:${PORT}`);
    const pathname = url.pathname;

    const req = incoming;
    req.query = Object.fromEntries(url.searchParams);
    enhanceRes(outgoing);

    if (incoming.method === 'POST' || incoming.method === 'PUT' || incoming.method === 'PATCH') {
        req.body = await readBody(req);
    }

    try {
        if (pathname === '/api/notion') {
            return await notionHandler(req, outgoing);
        }
        if (pathname === '/api/coverage') {
            return await coverageHandler(req, outgoing);
        }
        if (incoming.method === 'GET' || incoming.method === 'HEAD') {
            if (incoming.method === 'HEAD') {
                outgoing.statusCode = 200;
                return outgoing.end();
            }
            return serveStatic(pathname, outgoing);
        }
        outgoing.statusCode = 405;
        outgoing.end('Method Not Allowed');
    } catch (err) {
        console.error('❌ Server error:', err);
        if (!outgoing.headersSent) {
            outgoing.statusCode = 500;
            outgoing.setHeader('Content-Type', 'application/json');
            outgoing.end(JSON.stringify({ error: err.message }));
        }
    }
});

server.listen(PORT, () => {
    console.log('');
    console.log('  Fiber Customer Maps — local dev');
    console.log(`  → http://localhost:${PORT}`);
    if (!process.env.NOTION_API_KEY) {
        console.log('');
        console.log('  ⚠️  NOTION_API_KEY belum diset.');
        console.log('      Buat file .env dengan NOTION_API_KEY=secret_...');
        console.log('      atau isi config.json (lihat .env.example)');
    } else {
        console.log('  ✅ NOTION_API_KEY terdeteksi');
    }
    console.log('');
});
