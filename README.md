# 🎵 Hidaka Music

Hidaka Music adalah aplikasi streaming musik berbasis web (PWA) yang menggunakan YouTube sebagai sumber audio. Dibangun dalam satu file HTML dengan tampilan modern ala Spotify — dark theme, full-featured player, dan bisa diinstall langsung ke homescreen.

---

## 🚀 Demo & Deployment

Aplikasi ini didesain untuk di-deploy ke platform seperti **Vercel** atau **Netlify**, dengan backend serverless minimal untuk endpoint pencarian (`/api/search`).

---

## 📋 Fitur Lengkap

### 🏠 Halaman Home
- **Featured Card** — banner besar dengan thumbnail, judul, dan tombol play langsung
- **Quick Pick** — daftar lagu rekomendasi dengan thumbnail, judul, dan artis
- **Filter Chip** — filter konten berdasarkan kategori (Semua, Pop, Rock, dsb.)
- **Horizontal Scroll Sections** — grid card yang bisa di-scroll horizontal untuk album/artis
- **Infinite Scroll** — konten home otomatis dimuat lebih saat scroll ke bawah
- **Skeleton Loader** — animasi shimmer saat konten sedang dimuat

### 🔍 Halaman Search
- **Search Bar** dengan ikon kaca pembesar dan auto-focus saat halaman dibuka
- **Pencarian Real-time** ke YouTube via endpoint `/api/search` (max 20 hasil)
- **Filter Hasil** — filter hasil pencarian berdasarkan tipe (Semua, Lagu, Video, dsb.)
- **Riwayat Pencarian** — menyimpan query terakhir di localStorage, bisa diklik ulang atau dihapus satu-satu / semuanya
- **Enter to Search** — tekan Enter langsung memulai pencarian

### 📚 Halaman Library
Terdiri dari beberapa tab/kategori:

| Tab | Deskripsi |
|-----|-----------|
| **Semua** | Tampilan overview semua koleksi |
| **Disukai** | Lagu yang di-like, bisa diputar dan didownload |
| **Diunduh** | Lagu yang sudah didownload (placeholder, coming soon) |
| **Teratas Saya 50** | 50 lagu yang paling sering diputar, diurutkan berdasarkan frekuensi |
| **Riwayat** | Semua lagu yang pernah diputar (disimpan di cache lokal) |
| **Playlist** | Playlist buatan sendiri |
| **Diunggah** | Upload musik sendiri (placeholder, coming soon) |

### 🎧 Mini Player
Bar kecil yang muncul di atas bottom navigation saat ada lagu yang diputar:
- Thumbnail lagu (bulat, dengan animasi loading opacity)
- Judul & nama artis (auto truncate)
- Tombol **Like** (toggle, warna merah jika disukai)
- Tombol **Play/Pause**
- Tombol **Skip Next**
- **Progress bar** tipis di bawah mini player (real-time)
- **Loading spinner** saat buffering
- Tap mini player → membuka Full Player

### 🎼 Full Player
Layar penuh yang muncul dari bawah saat mini player di-tap:

**Panel Utama:**
- Album art besar dengan animasi buffering (scale + opacity)
- Judul lagu & nama artis (klik artis → Artist Page)
- Tombol **Like/Unlike** dengan animasi warna
- **Progress bar** interaktif — bisa di-tap untuk seek ke posisi tertentu
- Tampilan waktu (current / durasi total)
- **Kontrol Playback:** Shuffle → Prev → Play/Pause → Next → Repeat
- **Volume slider**
- Tombol download lagu

**Sub Panel (3 tab di bawah full player):**

1. **Up Next** — daftar antrian lagu berikutnya, klik untuk loncat langsung
2. **Lyrics** — lirik sinkron real-time dari [lrclib.net](https://lrclib.net), highlight baris aktif dengan animasi besar + fade, bisa di-tap untuk seek ke timestamp lirik
3. **Artist** — shortcut ke Artist Page artis yang sedang diputar

### 👤 Artist Page
Halaman artis yang muncul dari sisi kanan:
- **Hero Image** — foto artis besar dengan overlay gradient
- Nama artis di atas hero
- Tombol **Subscribe**, **Radio**, dan **Play** (langsung putar top song)
- **Top Songs** — daftar lagu terpopuler artis
- **Singles & EPs** — horizontal scroll kartu single/EP
- **Videos** — horizontal scroll video artis
- **Featured On** — playlist/kompilasi yang menampilkan artis ini
- Section "Tentang" dengan deskripsi singkat artis

### 🎵 Sistem Playback
- Audio via **YouTube IFrame API** (tersembunyi, off-screen)
- Otomatis pindah ke lagu berikutnya saat lagu selesai
- Skip otomatis jika video error (kode error 150/101 = restricted)
- **Shuffle** — acak urutan queue
- **Repeat** — ulangi lagu yang sedang diputar
- Lagu otomatis masuk ke riwayat & cache saat diputar

### 🎤 Lirik Sinkron (Synced Lyrics)
- Fetch dari **lrclib.net** dengan 3 strategi fallback query
- Parsing format LRC timestamp `[mm:ss.xx]`
- Auto-scroll ke baris aktif saat lagu berjalan
- Highlight baris aktif: font lebih besar, opacity penuh, warna putih
- Baris tidak aktif: muted, sedikit mengecil
- Klik baris lirik → seek lagu ke timestamp tersebut
- Pre-fetch lirik saat lagu mulai diputar (bukan saat panel dibuka)
- Cache lirik di memory selama sesi berlangsung

### 📋 Playlist Management
- **Buat Playlist** baru via modal bottom sheet
- **Tambahkan lagu** ke playlist mana saja dari konteks lagu manapun
- **Detail Playlist** — lihat isi playlist dan putar semua lagu
- **Rename / Hapus Playlist**
- Disimpan di `localStorage` secara permanen

### ❤️ Like / Unlike
- Tombol hati di mini player dan full player
- Status like disimpan di `localStorage` (`nada_liked`)
- Tampilan ikon berubah warna (merah = liked, abu = tidak)
- Lagu yang di-like otomatis masuk ke tab "Disukai" di Library

### ⬇️ Download
- Tombol download di tiap lagu di tab Liked
- Menggunakan link audio dari YouTube (endpoint `/api/audio?id=...`)
- Trigger download lewat `<a download>` programatik

### 📱 PWA (Progressive Web App)
- Bisa diinstall ke homescreen Android/iOS
- Tombol **Install App** muncul di topbar jika browser support `beforeinstallprompt`
- Fallback instruksi manual untuk browser yang tidak support
- Service Worker (`/sw.js`) terdaftar untuk enable install prompt
- `manifest.json` untuk metadata PWA (nama, warna, icon)
- Meta tag Apple Web App untuk dukungan iOS

### 🔗 URL Routing
- Navigasi menggunakan **History API** (pushState / popState)
- URL berubah sesuai halaman:
  - `/` → Home
  - `/search` → Search
  - `/library` → Library
  - `/developer` → Developer Info
- Tombol back browser berfungsi normal

### 🔔 Toast Notification
- Notifikasi kecil muncul di bawah layar untuk berbagai aksi (like, playlist, install, dll.)
- Auto-dismiss setelah 2.2 detik

### 💾 Local Storage Keys

| Key | Isi |
|-----|-----|
| `nada_liked` | Array lagu yang di-like |
| `nada_history` | Riwayat 50 lagu terakhir |
| `nada_playlists` | Array playlist beserta track-nya |
| `nada_downloaded` | Array lagu yang didownload |
| `nada_cached` | 30 lagu terakhir untuk cache |
| `nada_search_history` | Riwayat query pencarian |

---

## 🛠️ Tech Stack

| Teknologi | Penggunaan |
|-----------|------------|
| HTML/CSS/JS (Vanilla) | Frontend, semua dalam 1 file |
| YouTube IFrame API | Engine audio playback |
| lrclib.net API | Sumber lirik sinkron |
| localStorage | Persistensi data lokal |
| History API | Client-side routing |
| PWA (Service Worker + Manifest) | Installable web app |
| Inter (Google Fonts) | Font utama |

---

## 📡 Backend / API Endpoints

Aplikasi ini membutuhkan backend minimal dengan endpoint berikut:

| Endpoint | Method | Deskripsi |
|----------|--------|-----------|
| `/api/search?q=...&max=...` | GET | Cari lagu di YouTube, return array track |
| `/api/audio?id=...` | GET | Ambil link audio stream YouTube |

Format response `/api/search`:
```json
[
  {
    "id": "youtube_video_id",
    "title": "Judul Lagu",
    "channel": "Nama Artis / Channel",
    "thumb": "https://url-thumbnail.jpg",
    "duration": "3:45"
  }
]
```

---

## 📁 Struktur File

```
project/
├── index.html       # Seluruh aplikasi (UI + logic)
├── manifest.json    # PWA manifest
└── sw.js            # Service Worker
```

---

## 🎨 Design System

- **Background:** `#121212`
- **Surface:** `#1a1a1a`
- **Card:** `#242424`
- **Accent (Green):** `#1db954` (Spotify-inspired)
- **Text:** `#ffffff`
- **Text Muted:** `#a0a0a0`
- **Font:** Inter (300–800 weight)

---

## ⚠️ Catatan

- Aplikasi ini bergantung pada **YouTube IFrame API**, jadi memerlukan koneksi internet
- Lirik tidak selalu tersedia untuk semua lagu — tergantung ketersediaan di lrclib.net
- Fitur Download dan Upload masih dalam tahap pengembangan (coming soon)
- Untuk deployment production, pastikan endpoint `/api/search` dan `/api/audio` sudah dikonfigurasi dengan benar