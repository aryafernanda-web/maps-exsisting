# Deploy ke Vercel (tanpa install Node.js di PC)

Aplikasi ini dirancang untuk **Vercel**. Di PC Anda cukup mengunggah kode ke GitHub; build dan server API dijalankan oleh Vercel.

---

## Langkah 1 — Upload kode ke GitHub

Pilih salah satu cara:

### A) GitHub di browser
1. Buka [github.com](https://github.com) → buat repository baru (misalnya `fiber-customer-maps`).
2. Klik **Add file** → **Upload files**.
3. Seret semua file project ini (kecuali folder `node_modules` dan file `.env`).
4. Commit.

### B) GitHub Desktop
1. Install [GitHub Desktop](https://desktop.github.com/) (bukan Node.js).
2. **File** → **Add local repository** → pilih folder project ini.
3. **Publish repository** → push ke GitHub.

---

## Langkah 2 — Import ke Vercel

1. Buka [vercel.com](https://vercel.com) → login (bisa pakai akun GitHub).
2. **Add New…** → **Project**.
3. **Import** repository `fiber-customer-maps` Anda.
4. Pengaturan build (biarkan seperti ini):

| Setting | Nilai |
|--------|--------|
| Framework Preset | **Other** |
| Build Command | *(kosongkan)* |
| Output Directory | `.` |
| Install Command | `npm install` *(default, dijalankan di server Vercel)* |

5. Jangan klik Deploy dulu — lanjut ke langkah 3 untuk environment variables.

---

## Langkah 3 — Environment variables (wajib)

Di halaman import project, buka **Environment Variables** dan tambahkan:

| Name | Value |
|------|--------|
| `NOTION_API_KEY` | API key integration Notion Anda (`secret_...` atau `ntn_...`) |
| `NOTION_DATABASE_ID` | ID database Notion (default project: `29edcd14e2c880ddb393dc9f54758a18`) |

Centang **Production**, **Preview**, dan **Development**.

Klik **Deploy**.

---

## Langkah 4 — Cek setelah deploy

1. Buka URL yang diberikan Vercel, misalnya `https://nama-project.vercel.app`.
2. Buka `https://nama-project.vercel.app/api/notion` di browser.
   - **Benar:** JSON dengan `locations`, `needResolve`, `stats`.
   - **Salah:** `{"error":"NOTION_API_KEY belum diset..."}` → ulangi Langkah 3 lalu **Redeploy**.

3. Di dashboard Vercel: **Settings** → **Environment Variables** → setelah mengubah key, klik **Deployments** → **⋯** pada deploy terakhir → **Redeploy**.

---

## Notion — pastikan integration terhubung

1. [notion.so/my-integrations](https://www.notion.so/my-integrations) → buat / pilih integration.
2. Di database pelanggan Notion: **⋯** → **Connections** → hubungkan integration tersebut.
3. Integration harus punya akses **Read** ke database.

---

## File yang tidak perlu di-upload

Jangan commit / upload:

- `.env` dan `.env.local` (rahasia API key)
- `node_modules/`
- `notion_dump.json` (cache lokal, opsional)

`coverage.kml` **boleh** di-upload sebagai cadangan jika API Google My Maps lambat.

---

## Pembaruan data

Setiap buka website atau klik tombol refresh, data diambil dari Notion API (cache server 5 menit). Tidak perlu menjalankan script di PC.

---

## Masalah umum

| Gejala | Solusi |
|--------|--------|
| Peta kosong, error di `/api/notion` | Cek `NOTION_API_KEY` dan koneksi integration ke database |
| Beberapa pin tidak muncul | Link Maps pendek — tunggu proses resolve, atau isi lat/lng di Notion |
| Coverage tidak tampil | Layer coverage memakai `/api/coverage`; pastikan deploy sukses |

Untuk deploy ulang: push commit baru ke GitHub → Vercel deploy otomatis.
