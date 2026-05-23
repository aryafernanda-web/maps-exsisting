# 🚀 Panduan Deploy ke Netlify

## Cara Deploy Fiber Customer Maps ke Netlify

Aplikasi ini sudah siap untuk di-deploy ke Netlify.  
Setelah di-deploy, **tidak perlu menjalankan MULAI_CEK_MAPS.bat lagi** —  
semua berjalan otomatis di cloud 24/7.

---

## Langkah 1: Install Node.js (jika belum)

Download dari: **https://nodejs.org** → pilih versi LTS

Setelah install, buka PowerShell dan jalankan:
```
node --version
npm --version
```

---

## Langkah 2: Install dependencies

Buka PowerShell di folder ini, lalu jalankan:
```
npm install
```

---

## Langkah 3: Push ke GitHub

1. Buat akun di https://github.com (jika belum punya)
2. Buat repository baru (misal: `fiber-customer-maps`)
3. Jalankan perintah berikut di folder ini:

```powershell
git init
git add .
git commit -m "Initial commit - Fiber Customer Maps"
git branch -M main
git remote add origin https://github.com/USERNAMU/fiber-customer-maps.git
git push -u origin main
```

---

## Langkah 4: Deploy di Netlify

1. Buka https://app.netlify.com
2. Klik **"Add new site"** → **"Import an existing project"**
3. Pilih **GitHub** → authorize → pilih repo `fiber-customer-maps`
4. Build settings (biarkan default, sudah ada netlify.toml):
   - **Build command**: *(kosongkan)*
   - **Publish directory**: `.`
5. Klik **Deploy site**

---

## Langkah 5: Set Environment Variables di Netlify ⚠️ WAJIB

1. Di Netlify dashboard → **Site Settings** → **Environment Variables**
2. Tambahkan 2 variabel:

| Key | Value |
|-----|-------|
| `NOTION_API_KEY` | `(isi dengan API key Notion kamu)` |
| `NOTION_DATABASE_ID` | `(isi dengan Database ID Notion kamu)` |

3. Klik **Save** → Klik **Trigger deploy** → **Deploy site**

---

## Langkah 6: Selesai! 🎉

Website kamu sekarang live di:  
`https://NAMA-SITE.netlify.app`

- Data Notion di-fetch **otomatis** setiap kali ada request
- Auto-refresh di frontend **setiap 5 menit**
- Coverage area FTTH **tampil otomatis**
- Tidak perlu server lokal sama sekali!

---

## Testing Lokal (Opsional)

Jika ingin test di lokal sebelum deploy:

**Cara 1 — Dengan PowerShell Server (seperti sebelumnya):**
```
MULAI_CEK_MAPS.bat
```
Buka: http://localhost:8080

**Cara 2 — Dengan Netlify CLI (exact same seperti production):**
```powershell
npm install -g netlify-cli
netlify dev
```
Buka: http://localhost:8888

---

## Troubleshooting

**Data tidak muncul?**
- Pastikan Environment Variables sudah diset di Netlify
- Pastikan Notion Integration sudah diberi akses ke database
- Buka URL: `https://SITE.netlify.app/api/notion` untuk debug

**Coverage area tidak tampil?**
- Klik tombol 📡 (antena) di kanan peta untuk toggle
- Pastikan koneksi internet aktif (KML diambil dari Google My Maps)

**Marker sedikit?**
- Semua pelanggan yang punya koordinat (lat/lng atau Maps URL) ditampilkan
- Pelanggan tanpa koordinat sama sekali tidak bisa ditampilkan di peta
