/**
 * ============================================================
 *  INVENTORY MANAGEMENT — Google Apps Script
 *  Production-ready | v3.3
 * ============================================================
 *
 *  SETUP:
 *  1. Extensions → Apps Script → Project Settings → Script Properties
 *     Tambahkan: ROLLOVER_SECRET = <secret sama dengan env Vercel>
 *
 *  Sheet yang dibutuhkan (nama harus persis):
 *    Barang ATK / Barang RT / Barang Obat
 *    Keluar ATK / Keluar RT / Keluar Obat
 *    Masuk ATK  / Masuk RT  / Masuk Obat
 *    Snapshot Saldo   ← buat manual, header di baris 1
 *
 *  Kolom Sheet Barang  : A=id  B=kode_barang  C=nama_barang  D=merk  E=satuan  F=saldo_awal  G=sisa_saldo
 *  Kolom Sheet Keluar  : A=id  B=id_barang    C=kode_barang  D=nama  E=merk    F=satuan      G=tanggal  H=qty  I=sisa_saldo  J=keterangan
 *  Kolom Sheet Masuk   : (sama dengan Keluar)
 *  Kolom Snapshot Saldo: A=tahun  B=bulan  C=type  D=id_barang  E=saldo_awal
 *
 *  CHANGELOG v3.0:
 *  - Fix saldo_awal fallback: forward-derive dari snapshot terdekat sebelumnya
 *    jika snapshot bulan diminta dan bulan berikutnya sama-sama kosong
 *  - aggregateTransaksiBetween(): aggregate masuk/keluar antar rentang bulan
 *  - findNearestPriorSnapshot(): cari snapshot terdekat ke belakang (max 24 bln)
 *  - _fwdDeriveMap dihitung sekali di luar loop barang (O(n) bukan O(n²))
 *  - Prioritas saldo_awal: snapshot → derived_next → derived_forward_prior → master_fallback
 * 
 *  CHANGELOG v3.1 (dari v3.0):
 *  Fix HIGH — Forward-derive melewatkan transaksi bulan snapshot acuan:
 *    aggregateTransaksiBetween sekarang inklusif dari bulan prior snapshot
 *    (bukan snapMonth+1). Range: [snapMonth, targetMonth) bukan [snapMonth+1, targetMonth).
 *    Sebelumnya: saldo_awal Juni = snapshot_Mei (tanpa transaksi Mei) → salah.
 *    Sekarang:   saldo_awal Juni = snapshot_Mei + masuk_Mei - keluar_Mei → benar.
 *
 *  Fix MEDIUM — Key agregasi transaksi dan _fwdDeriveMap memakai id_barang saja,
 *    bisa bentrok jika ada ID yang sama di berbagai type (ATK/RT/Obat):
 *    aggregateTransaksiBetween kini memakai key "type|id_barang".
 *    _fwdDeriveMap juga memakai key "type|id_barang".
 *    Lookup di handleGetStok disesuaikan memakai key gabungan yang sama.
 *
 *  Fix fillSnapshotDerived (utility manual):
 *    Range aggregate diubah inklusif prior snapshot (sama dengan fix HIGH di atas).
 *
 *  CHANGELOG v3.2 (PERFORMA — tidak mengubah hasil perhitungan):
 *  Masalah: satu request action=stok butuh 10–38 detik karena sheet yang sama
 *  dibaca berulang kali. Hitungan getRange().getValues() di v3.1:
 *    3 (barang) + 2 (snapshot) + s/d 24 (findNearestPriorSnapshot!) +
 *    6 (aggregateTransaksiBetween) + 3 (keluar) + 3 (masuk) = s/d 41 kali.
 *
 *  - Memo per-eksekusi (_memo): tiap sheet dibaca maksimal SEKALI per request.
 *    Objek global Apps Script dibuat ulang tiap eksekusi, jadi tidak ada
 *    kebocoran data antar request.
 *  - getSnapshotIndex(): sheet Snapshot Saldo dibaca sekali lalu diindeks
 *    per "tahun*100+bulan". buildSnapshotMap() dan findNearestPriorSnapshot()
 *    jadi murni operasi memori — dari s/d 26 pembacaan sheet menjadi 1.
 *  - aggregateTransaksiBetween() dan handleGetStok() berbagi baris masuk/keluar
 *    yang sama lewat memo — dari 12 pembacaan menjadi 6.
 *  - handleGetStok() memakai getBarangRows() (CacheService) — 3 pembacaan hilang
 *    saat cache hangat.
 *  Total: s/d 41 pembacaan sheet → 7 saat dingin, 4 saat cache barang hangat.
 *
 *  - Cache hasil laporan stok (chunked, TTL 6 jam). Payload ~255 KB melewati
 *    batas 100 KB per key CacheService, jadi dipecah per 50.000 karakter.
 *    Invalidasi memakai penghitung generasi STOK_GEN di Script Properties yang
 *    dinaikkan setiap ada POST — jadi data tidak pernah basi setelah input.
 *  - resetMemo() dipanggil setelah saveSnapshot()/fillSnapshotDerived() menulis,
 *    supaya verifikasi setelahnya membaca data yang baru, bukan memo lama.
 *
 *  CHANGELOG v3.3 (PERFORMA — tidak mengubah hasil perhitungan):
 *  Berdasarkan pengukuran terhadap deployment yang berjalan. Yang terukur:
 *    stok cache HIT  : min 2.0s   (payload 255 KB)
 *    stok cache MISS : min 10.1s, median 17.7s
 *    ping 43 byte    : min 2.2s   ← lantai transport, sama dengan HIT
 *    hop /exec → 302 : 1.5–2.1s   ← bagian terbesar dari lantai itu
 *  Kesimpulannya cache memang bekerja; sisa waktunya ada di transport, bukan
 *  di perhitungan. Perubahan di bawah menyasar dua hal: memperbanyak HIT, dan
 *  membuang pekerjaan yang memang tidak perlu.
 *
 *  - Generasi cache jadi PER BULAN. STOK_GEN kini JSON { "_all": n, "202608": n }
 *    dan generasi efektif sebuah bulan = max(_all, gen bulan itu). Input bulan
 *    Agustus tidak lagi membatalkan cache laporan Juli yang sudah final.
 *    Untuk action "add*", bulan terdampak diambil dari tanggal di payload lalu
 *    dibatalkan sampai bulan berjalan (forward-derive mempengaruhi bulan
 *    sesudahnya). Untuk update/delete/barang/rollover, tanggal lama tidak ada di
 *    payload sehingga cakupannya tetap seluruh bulan — sengaja konservatif.
 *  - onSheetChanged tidak lagi ikut membatalkan cache saat script sendiri yang
 *    menulis. Installable trigger memang menyala untuk tulisan dari script
 *    (beda dari simple onEdit), sehingga tiap input lewat aplikasi sebelumnya
 *    membatalkan cache dua kali. Dijaga dengan penanda LAST_SCRIPT_WRITE.
 *  - _stokGen() dimemo lewat _genMap(). Sebelumnya PropertiesService terbaca
 *    2x tiap MISS (sekali di getStokCached, sekali di setStokCache).
 *  - readRows() membatasi lebar baca ke 10 kolom (Math.min dengan lebar asli),
 *    supaya format nyasar di kolom jauh tidak membuat tiap request menarik
 *    puluhan kolom kosong.
 *  - Prefix cache dinaikkan ke stok_v33_ agar entri v3.2 tidak terbaca.
 * ============================================================
 */

// ── Sheet References ──────────────────────────────────────────────────────────

const SS = SpreadsheetApp.getActiveSpreadsheet()

const SHEETS = {
  barang: {
    atk:  SS.getSheetByName("Barang ATK"),
    rt:   SS.getSheetByName("Barang RT"),
    obat: SS.getSheetByName("Barang Obat"),
  },
  keluar: {
    atk:  SS.getSheetByName("Keluar ATK"),
    rt:   SS.getSheetByName("Keluar RT"),
    obat: SS.getSheetByName("Keluar Obat"),
  },
  masuk: {
    atk:  SS.getSheetByName("Masuk ATK"),
    rt:   SS.getSheetByName("Masuk RT"),
    obat: SS.getSheetByName("Masuk Obat"),
  },
  snapshot: SS.getSheetByName("Snapshot Saldo"),
}

const TYPE_LABEL    = { atk: "ATK", rt: "RT", obat: "OBT" }
const VALID_TYPES   = ["atk", "rt", "obat"]
const VALID_ACTIONS_POST = [
  "add", "addBatch",
  "addMasuk", "addMasukBatch",
  "update", "delete",
  "updateMasuk", "deleteMasuk",
  "addBarang", "updateBarang", "deleteBarang",
  "rollover",
]

// ── Validation ────────────────────────────────────────────────────────────────

function isValidType(type) {
  return VALID_TYPES.indexOf(type) !== -1
}

/**
 * Validate required fields exist and are non-empty on a data object.
 * Returns null if ok, or an error message string.
 */
function validateFields(data, fields) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i]
    if (data[f] === undefined || data[f] === null || String(data[f]).trim() === "") {
      return "missing required field: " + f
    }
  }
  return null
}

// ── Data Access ───────────────────────────────────────────────────────────────

function getBarangSheet(type) { return SHEETS.barang[type] || null }
function getKeluarSheet(type) { return SHEETS.keluar[type] || null }
function getMasukSheet(type)  { return SHEETS.masuk[type]  || null }

/**
 * Read all data rows, skipping the header row.
 * Returns empty array if sheet has only header or is empty.
 */
// Sheet terlebar yang dipakai (Keluar/Masuk) punya 10 kolom. Membatasi lebar
// baca mencegah format nyasar di kolom jauh membuat setiap request menarik
// puluhan kolom kosong. Math.min menjaga agar tidak pernah melebihi lebar asli.
const MAX_COLS = 10

function readRows(sheet) {
  if (!sheet) return []
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  const lastCol = Math.min(sheet.getLastColumn(), MAX_COLS)
  if (lastCol < 1) return []
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
}

// ── Memo per-eksekusi (v3.2) ─────────────────────────────────────────────────
//
// Setiap eksekusi Apps Script memakai konteks global yang baru, jadi objek ini
// otomatis kosong lagi di request berikutnya — tidak ada risiko data basi antar
// request. Tujuannya cuma satu: satu sheet dibaca maksimal sekali per request.

const _memo = {}

function resetMemo() {
  Object.keys(_memo).forEach(function(k) { delete _memo[k] })
}

function readRowsMemo(key, sheet) {
  if (_memo[key] === undefined) _memo[key] = readRows(sheet)
  return _memo[key]
}

function masukRowsOf(type)  { return readRowsMemo("masuk|"  + type, getMasukSheet(type))  }
function keluarRowsOf(type) { return readRowsMemo("keluar|" + type, getKeluarSheet(type)) }
function snapshotRowsAll()  { return readRowsMemo("snapshot", SHEETS.snapshot)            }

/**
 * Index seluruh sheet Snapshot Saldo sekali per request.
 * Key luar: tahun*100 + bulan   Key dalam: "type|id_barang"   Value: saldo_awal
 *
 * Ini yang membuat findNearestPriorSnapshot() — yang di v3.1 bisa membaca sheet
 * snapshot 24 kali berturut-turut — jadi murni lookup memori.
 */
function getSnapshotIndex() {
  if (_memo.snapshotIndex) return _memo.snapshotIndex

  const idx = {}
  snapshotRowsAll().forEach(function(r) {
    const ym = Number(r[0]) * 100 + Number(r[1])
    if (!idx[ym]) idx[ym] = {}
    idx[ym][String(r[2]) + "|" + String(r[3])] = Number(r[4]) || 0
  })

  _memo.snapshotIndex = idx
  return idx
}

/**
 * Build O(1) lookup map from barang rows.
 * Key: id_barang (string)
 * Value: { rowIndex, saldo_awal, sisa_saldo }
 */
function buildBarangMap(rows) {
  const map = {}
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0]).trim()
    if (!id) continue
    map[id] = {
      rowIndex:   i + 2,
      saldo_awal: Number(rows[i][5]) || 0,
      sisa_saldo: Number(rows[i][6]) || 0,
    }
  }
  return map
}

/**
 * Build O(1) lookup map from keluar/masuk rows.
 * Key: id (string)
 * Value: { rowIndex, id_barang, qty }
 */
function buildTransaksiMap(rows) {
  const map = {}
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0]).trim()
    if (!id) continue
    map[id] = {
      rowIndex:  i + 2,
      id_barang: String(rows[i][1]).trim(),
      qty:       Number(rows[i][7]) || 0,
    }
  }
  return map
}

// ── CacheService (TTL 300s) ───────────────────────────────────────────────────

const CACHE_TTL = 300

function _cacheKey(type) { return "barang_v3_" + type }

function getBarangCached(type) {
  try {
    const raw = CacheService.getScriptCache().get(_cacheKey(type))
    return raw ? JSON.parse(raw) : null
  } catch (e) { return null }
}

function setBarangCache(type, rows) {
  try {
    CacheService.getScriptCache().put(_cacheKey(type), JSON.stringify(rows), CACHE_TTL)
  } catch (e) { /* cache is optional, fail silently */ }
}

function clearBarangCache(type) {
  try {
    CacheService.getScriptCache().remove(_cacheKey(type))
  } catch (e) { /* fail silently */ }
}

function getBarangRows(type) {
  const cached = getBarangCached(type)
  if (cached) return cached
  const rows = readRows(getBarangSheet(type))
  setBarangCache(type, rows)
  return rows
}

// ── Cache hasil laporan stok (v3.2) ──────────────────────────────────────────
//
// action=stok menghasilkan ~255 KB JSON, di atas batas 100 KB per key
// CacheService — jadi JSON dipecah jadi beberapa chunk.
//
// Invalidasi memakai penghitung generasi di Script Properties, bukan penghapusan
// key satu per satu: setiap POST menaikkan STOK_GEN sehingga semua key generasi
// lama tidak akan pernah terbaca lagi (dan hilang sendiri saat TTL habis).
// Konsekuensinya laporan stok tidak pernah menampilkan data basi setelah input.

const STOK_CACHE_TTL  = 21600   // 6 jam
const STOK_CHUNK_SIZE = 50000   // karakter; aman terhadap batas 100 KB per key
const STOK_MAX_CHUNKS = 20      // di atas ini, lewati caching daripada boros kuota

// Script Property "STOK_GEN" berisi JSON { "_all": n, "202608": n, ... }.
// Generasi efektif sebuah bulan = max(_all, generasi bulan itu). Dengan begitu
// input bulan Agustus tidak lagi membatalkan cache laporan Juli yang sudah final.
function _genMap() {
  if (_memo.genMap) return _memo.genMap
  let m = {}
  try {
    const raw = PropertiesService.getScriptProperties().getProperty("STOK_GEN")
    if (raw) m = JSON.parse(raw)
  } catch (e) { m = {} }
  if (!m || typeof m !== "object") m = {}
  _memo.genMap = m
  return m
}

function _saveGenMap(m) {
  try {
    PropertiesService.getScriptProperties().setProperty("STOK_GEN", JSON.stringify(m))
    _memo.genMap = m
  } catch (e) { /* cache is optional, fail silently */ }
}

/** Dimemo lewat _genMap() — dulu PropertiesService terbaca 2x tiap MISS. */
function _stokGen(year, month) {
  const m = _genMap()
  const all = Number(m._all) || 0
  const own = Number(m[String(year * 100 + month)]) || 0
  return String(Math.max(all, own))
}

/** Batalkan cache SEMUA bulan. Untuk perubahan yang bulannya tidak diketahui
 *  atau berdampak menyeluruh: master barang, hapus/ubah transaksi, rollover. */
function bumpStokGenAll() {
  const m = _genMap()

  // _all HARUS melampaui setiap generasi per-bulan yang ada, karena generasi
  // efektif = max(_all, gen bulan). Sekadar _all+1 tidak membatalkan bulan yang
  // generasinya sudah lebih tinggi — itu akan menyajikan data basi.
  // Peta juga direset supaya JSON-nya tidak tumbuh tanpa batas.
  let top = 0
  Object.keys(m).forEach(function(k) { top = Math.max(top, Number(m[k]) || 0) })
  _saveGenMap({ _all: top + 1 })
}

/** Batalkan cache bulan (year, month) sampai bulan berjalan.
 *
 *  Bukan hanya bulan itu sendiri: transaksi bulan M ikut mengubah saldo_awal
 *  bulan-bulan sesudahnya lewat forward-derive dari snapshot terdekat. Rentang
 *  ke depan dibatasi bulan berjalan, jadi umumnya cuma 1-2 bulan.
 */
function bumpStokGenFrom(year, month) {
  const m   = _genMap()
  const now = new Date()
  const nowNum = now.getFullYear() * 100 + (now.getMonth() + 1)

  const all = Number(m._all) || 0

  let y = year
  let mo = month
  for (let guard = 0; guard < 36; guard++) {
    const key = String(y * 100 + mo)
    // Harus melampaui _all juga, sebab generasi efektif = max(_all, gen bulan).
    m[key] = Math.max(Number(m[key]) || 0, all) + 1
    if (y * 100 + mo >= nowNum) break
    mo++
    if (mo > 12) { mo = 1; y++ }
  }
  _saveGenMap(m)
}

/**
 * Bulan paling awal yang tersentuh oleh payload POST, dari field tanggal.
 * @returns {{year:number, month:number}|null} null jika tidak ada tanggal valid
 */
function earliestMonthInPayload(data) {
  const dates = []
  if (data && data.tanggal) dates.push(data.tanggal)
  if (data && Array.isArray(data.items)) {
    data.items.forEach(function(it) { if (it && it.tanggal) dates.push(it.tanggal) })
  }

  let best = null
  dates.forEach(function(val) {
    const d = new Date(val)
    if (isNaN(d.getTime())) return
    const cur = { year: d.getFullYear(), month: d.getMonth() + 1 }
    if (!best || cur.year * 100 + cur.month < best.year * 100 + best.month) best = cur
  })
  return best
}

function _stokCacheKey(year, month) {
  return "stok_v33_" + _stokGen(year, month) + "_" + year + "_" + month
}

/**
 * Trigger: buang semua cache saat sheet diedit langsung dari Google Sheets.
 *
 * Tanpa ini, edit manual di kolom F/G tidak melewati doPost sehingga cache
 * laporan stok tetap menyajikan angka lama sampai TTL habis (6 jam).
 *
 * PASANG SEBAGAI INSTALLABLE TRIGGER (wajib — simple trigger tidak boleh
 * mengakses PropertiesService):
 *   Apps Script → Triggers → Add Trigger
 *   Function: onSheetChanged | Event source: From spreadsheet | Type: On change
 */
const SCRIPT_WRITE_WINDOW_MS = 30000

/** Tandai bahwa script sendiri baru saja menulis ke sheet. */
function markScriptWrite() {
  try {
    PropertiesService.getScriptProperties().setProperty("LAST_SCRIPT_WRITE", String(Date.now()))
  } catch (e) { /* fail silently */ }
}

function recentlyWrittenByScript() {
  try {
    const last = Number(PropertiesService.getScriptProperties().getProperty("LAST_SCRIPT_WRITE")) || 0
    return Date.now() - last < SCRIPT_WRITE_WINDOW_MS
  } catch (e) { return false }
}

function onSheetChanged(e) {
  // Installable trigger ikut menyala untuk tulisan dari script ini sendiri
  // (berbeda dari simple onEdit). Tanpa guard ini, tiap input lewat aplikasi
  // membatalkan cache dua kali: sekali dari doPost, sekali dari trigger.
  // doPost sudah membatalkan dengan cakupan bulan yang tepat, jadi di sini cukup
  // dilewati — yang tersisa untuk trigger hanyalah edit manual di spreadsheet.
  if (recentlyWrittenByScript()) {
    Logger.log("[CACHE] onSheetChanged dilewati — perubahan berasal dari script")
    return
  }
  VALID_TYPES.forEach(function(type) { clearBarangCache(type) })
  bumpStokGenAll()
  Logger.log("[CACHE] Invalidated via onSheetChanged (edit manual)")
}

/** @returns {string|null} JSON utuh, atau null jika belum/tidak lengkap di cache. */
function getStokCached(year, month) {
  try {
    const cache = CacheService.getScriptCache()
    const base  = _stokCacheKey(year, month)
    const n     = Number(cache.get(base + "_n"))
    if (!n) return null

    const keys = []
    for (let i = 0; i < n; i++) keys.push(base + "_" + i)
    const parts = cache.getAll(keys)

    let out = ""
    for (let i = 0; i < n; i++) {
      const p = parts[base + "_" + i]
      // Satu chunk kedaluwarsa duluan = hasil tidak utuh → hitung ulang.
      if (p === undefined || p === null) return null
      out += p
    }
    return out
  } catch (e) { return null }
}

function setStokCache(year, month, json) {
  try {
    const cache  = CacheService.getScriptCache()
    const base   = _stokCacheKey(year, month)
    const chunks = {}
    let   n      = 0

    for (let i = 0; i < json.length; i += STOK_CHUNK_SIZE) {
      chunks[base + "_" + n] = json.substring(i, i + STOK_CHUNK_SIZE)
      n++
    }
    if (n === 0 || n > STOK_MAX_CHUNKS) return

    chunks[base + "_n"] = String(n)
    cache.putAll(chunks, STOK_CACHE_TTL)
  } catch (e) { /* cache is optional, fail silently */ }
}

// ── Snapshot Saldo ────────────────────────────────────────────────────────────

/**
 * Save saldo_awal snapshot for all barang before rollover overwrites col F.
 * Idempotent: skips rows where (year, month, type, id_barang) already exists.
 *
 * Sheet "Snapshot Saldo" columns:
 *   A=tahun  B=bulan  C=type  D=id_barang  E=saldo_awal
 */
function saveSnapshot(year, month) {
  const snapshotSheet = SHEETS.snapshot
  if (!snapshotSheet) {
    Logger.log("[WARN] Sheet 'Snapshot Saldo' tidak ditemukan, snapshot dilewati.")
    return
  }

  const existingRows = readRows(snapshotSheet)
  const existingKeys = {}
  existingRows.forEach(function(r) {
    existingKeys[[r[0], r[1], r[2], r[3]].join("|")] = true
  })

  const newRows = []
  VALID_TYPES.forEach(function(type) {
    const bRows = readRows(getBarangSheet(type))
    bRows.forEach(function(r) {
      const id_barang  = String(r[0]).trim()
      const saldo_awal = Number(r[5]) || 0
      const key        = [year, month, type, id_barang].join("|")
      if (id_barang && !existingKeys[key]) {
        newRows.push([year, month, type, id_barang, saldo_awal])
      }
    })
  })

  if (newRows.length > 0) {
    batchInsertRows(snapshotSheet, newRows)
    // Memo dan index snapshot sudah basi setelah tulis — buang supaya verifikasi
    // di rolloverSaldo() membaca data yang baru.
    resetMemo()
    Logger.log("[SNAPSHOT] Saved " + newRows.length + " rows for " + year + "-" + month)
  } else {
    Logger.log("[SNAPSHOT] No new rows for " + year + "-" + month + " (already exists or empty)")
  }
}

/**
 * Build snapshot map for a given (year, month).
 * Key: "type|id_barang"  Value: saldo_awal
 *
 * v3.2: dilayani dari getSnapshotIndex() — tidak lagi membaca sheet tiap panggil.
 * Map yang dikembalikan milik index bersama, jadi HANYA UNTUK DIBACA.
 */
function buildSnapshotMap(year, month) {
  if (!SHEETS.snapshot) return {}
  return getSnapshotIndex()[year * 100 + month] || {}
}

/**
 * Lookup saldo_awal for a specific (type, id_barang) from a pre-built snapshot map.
 * Returns null if not found.
 */
function lookupSnapshot(snapshotMap, type, id_barang) {
  const key = type + "|" + id_barang
  return (snapshotMap && snapshotMap[key] !== undefined) ? snapshotMap[key] : null
}

/**
 * Find the nearest snapshot before (year, month), searching up to maxLookback months back.
 * Returns { map, snapYear, snapMonth } or null if none found.
 */
function findNearestPriorSnapshot(year, month, maxLookback) {
  maxLookback = maxLookback || 24
  for (let i = 1; i <= maxLookback; i++) {
    let m = month - i
    let y = year
    while (m < 1) { m += 12; y-- }
    const map = buildSnapshotMap(y, m)
    if (Object.keys(map).length > 0) {
      return { map: map, snapYear: y, snapMonth: m }
    }
  }
  return null
}

/**
 * Aggregate total masuk dan keluar per "type|id_barang"
 * untuk semua bulan dalam range [fromYear/fromMonth, toYear/toMonth) — EXCLUSIVE toMonth.
 *
 * FIX v3.1 (Medium): key sekarang "type|id_barang" bukan "id_barang" saja,
 * mencegah bentrok jika ID yang sama muncul di ATK, RT, dan Obat sekaligus.
 *
 * Contoh: aggregateTransaksiBetween(2026, 4, 2026, 6)
 *   → akumulasi April 2026 + Mei 2026 (tidak termasuk Juni)
 *
 * @returns {Object} { "type|id_barang": { masuk: number, keluar: number } }
 */
function aggregateTransaksiBetween(fromYear, fromMonth, toYear, toMonth) {
  const result = {}

  function addEntry(type, idB, field, qty) {
    const key = type + "|" + idB
    if (!result[key]) result[key] = { masuk: 0, keluar: 0 }
    result[key][field] += qty
  }

  function inRange(dateVal) {
    const d = new Date(dateVal)
    if (isNaN(d.getTime())) return false
    const curNum  = d.getFullYear() * 100 + (d.getMonth() + 1)
    const fromNum = fromYear * 100 + fromMonth
    const toNum   = toYear  * 100 + toMonth
    return curNum >= fromNum && curNum < toNum
  }

  // v3.2: baris masuk/keluar diambil lewat memo — sheet yang sama juga dipakai
  // handleGetStok, jadi cukup dibaca sekali per request.
  VALID_TYPES.forEach(function(type) {
    masukRowsOf(type).forEach(function(r) {
      if (!inRange(r[6])) return
      addEntry(type, String(r[1]).trim(), "masuk", Number(r[7]) || 0)
    })
    keluarRowsOf(type).forEach(function(r) {
      if (!inRange(r[6])) return
      addEntry(type, String(r[1]).trim(), "keluar", Number(r[7]) || 0)
    })
  })

  return result
}

// ── Write Helpers ─────────────────────────────────────────────────────────────

function batchInsertRows(sheet, rows) {
  if (!rows || rows.length === 0) return
  const startRow = sheet.getLastRow() + 1
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows)
}

/**
 * Generate next ID for a sheet.
 * Format: PREFIX-TYPELABEL-NNNN  (e.g. DB-ATK-0012)
 */
function generateId(sheet, prefix, type) {
  const lastRow = sheet.getLastRow()
  return prefix + "-" + TYPE_LABEL[type] + "-" + String(lastRow).padStart(4, "0")
}

// ── Lightweight Performance Logger ───────────────────────────────────────────

function _t(label)  { return { label: label, start: Date.now() } }
function _te(timer) { Logger.log("[PERF] " + timer.label + ": " + (Date.now() - timer.start) + "ms") }

// ── Response Helpers ──────────────────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}

function errorResponse(message, code) {
  return jsonResponse({ status: "error", message: message, code: code || 400 })
}

// ── doGet ─────────────────────────────────────────────────────────────────────

function doGet(e) {
  try {
    const action = e.parameter.action
    const type   = e.parameter.type
    const month  = e.parameter.month
    const year   = e.parameter.year

    if (action === "ping")   return jsonResponse({ ok: true, ts: new Date().toISOString() })
    if (action === "barang") return handleGetBarang(type)
    // Tanpa parameter type, keduanya mengembalikan ATK+RT+Obat sekaligus supaya
    // halaman cukup satu request, bukan tiga.
    if (action === "keluar") return handleGetTransaksi("keluar", type, month, year)
    if (action === "masuk")  return handleGetTransaksi("masuk",  type, month, year)
    // refresh=1 melewati cache dan menghitung ulang dari sheet — dipakai tombol
    // Refresh di halaman laporan stok.
    if (action === "stok")   return handleGetStok(month, year, e.parameter.refresh === "1")

    return errorResponse("unknown action: " + action)

  } catch (err) {
    Logger.log("[ERROR] doGet: " + err.message + "\n" + err.stack)
    return errorResponse("internal server error", 500)
  }
}

function handleGetBarang(type) {
  if (!type || !SHEETS.barang[type]) {
    const grouped = {}
    VALID_TYPES.forEach(function(t) { grouped[t] = getBarangRows(t) })
    return jsonResponse(grouped)
  }
  if (!isValidType(type)) return errorResponse("invalid type: " + type)
  return jsonResponse(getBarangRows(type))
}

function filterByPeriod(rows, m, y) {
  if (!m || !y) return rows
  return rows.filter(function(r) {
    const d = new Date(r[6])
    return d.getMonth() + 1 === m && d.getFullYear() === y
  })
}

/**
 * Handler bersama untuk action=masuk dan action=keluar (dulu dua fungsi kembar).
 *
 * Dengan parameter type  → array baris untuk type itu saja (bentuk lama, tetap
 *                          dipakai halaman lain, tidak berubah).
 * Tanpa parameter type   → { atk: [...], rt: [...], obat: [...] } sekaligus,
 *                          mengikuti pola action=barang. Ini memangkas halaman
 *                          Masuk/Keluar dari 4 request menjadi 2.
 *
 * @param {string} kind "masuk" | "keluar"
 */
function handleGetTransaksi(kind, type, month, year) {
  const rowsOf = kind === "masuk" ? masukRowsOf : keluarRowsOf

  let m = null
  let y = null
  if (month && year) {
    m = Number(month)
    y = Number(year)
    if (isNaN(m) || isNaN(y) || m < 1 || m > 12) return errorResponse("invalid month/year")
  }

  if (!type) {
    const grouped = {}
    VALID_TYPES.forEach(function(t) { grouped[t] = filterByPeriod(rowsOf(t), m, y) })
    return jsonResponse(grouped)
  }

  if (!isValidType(type)) return errorResponse("invalid type: " + type)
  return jsonResponse(filterByPeriod(rowsOf(type), m, y))
}

// ── doPost ────────────────────────────────────────────────────────────────────

function doPost(e) {
  let data
  try {
    data = JSON.parse(e.postData.contents)
  } catch (err) {
    return errorResponse("invalid JSON body", 400)
  }

  try {
    const action = data.action
    const type   = data.type

    if (action === "rollover") {
      const ok = rolloverSaldo(data.cronSecret)
      if (ok) bumpStokGenAll()
      return jsonResponse({ status: ok ? "success" : "unauthorized" })
    }

    if (!action || VALID_ACTIONS_POST.indexOf(action) === -1) {
      return errorResponse("unknown action: " + action)
    }

    if (!isValidType(type)) return errorResponse("invalid type: " + type)

    const isBarangAction = action === "addBarang" || action === "updateBarang" || action === "deleteBarang"
    const isMasukAction  = action === "addMasuk"  || action === "addMasukBatch" ||
                           action === "updateMasuk" || action === "deleteMasuk"

    const sheet = isBarangAction
      ? null
      : isMasukAction
        ? getMasukSheet(type)
        : getKeluarSheet(type)

    if (!isBarangAction && !sheet) return errorResponse("sheet not found for type: " + type)

    const lock = LockService.getScriptLock()
    try {
      lock.waitLock(15000)
    } catch (err) {
      return errorResponse("server busy, please retry", 503)
    }

    try {
      markScriptWrite()
      const res = dispatch(action, type, sheet, data)

      // Cakupan invalidasi sengaja dibedakan.
      //
      // Untuk action "add*", tanggalnya ada di payload sehingga bulan yang
      // terdampak bisa dipastikan — cache bulan lain dibiarkan hidup.
      //
      // Untuk update/delete, tanggal LAMA baris itu tidak ada di payload (delete
      // hanya mengirim id), jadi bulan terdampak tidak bisa dipastikan dan cache
      // seluruh bulan dibatalkan. Begitu pula perubahan master barang, yang
      // berdampak ke semua periode.
      //
      // Tetap dijalankan tanpa memeriksa sukses/gagal: invalidasi berlebih cuma
      // memicu hitung ulang, sedangkan yang terlewat menyajikan data basi.
      const isAdd = action.indexOf("add") === 0 && !isBarangAction
      const from  = isAdd ? earliestMonthInPayload(data) : null
      if (from) bumpStokGenFrom(from.year, from.month)
      else bumpStokGenAll()

      return res
    } finally {
      lock.releaseLock()
    }

  } catch (err) {
    Logger.log("[ERROR] doPost: " + err.message + "\n" + err.stack)
    return errorResponse("internal server error", 500)
  }
}

function dispatch(action, type, sheet, data) {
  switch (action) {
    case "add":           return handleAdd(type, sheet, data)
    case "addBatch":      return handleAddBatch(type, sheet, data)
    case "update":        return handleUpdate(type, sheet, data)
    case "delete":        return handleDelete(type, sheet, data)
    case "addMasuk":      return handleAddMasuk(type, sheet, data)
    case "addMasukBatch": return handleAddMasukBatch(type, sheet, data)
    case "updateMasuk":   return handleUpdateMasuk(type, sheet, data)
    case "deleteMasuk":   return handleDeleteMasuk(type, sheet, data)
    case "addBarang":     return handleAddBarang(type, data)
    case "updateBarang":  return handleUpdateBarang(type, data)
    case "deleteBarang":  return handleDeleteBarang(type, data)
    default:              return errorResponse("unhandled action: " + action)
  }
}

// ── Keluar Handlers ───────────────────────────────────────────────────────────

function handleAdd(type, sheet, data) {
  const t = _t("add")

  const err = validateFields(data, ["id_barang", "kode_barang", "nama_barang", "merk", "satuan", "tanggal", "qty"])
  if (err) return errorResponse(err)

  const barangRows = readRows(getBarangSheet(type))
  const barangMap  = buildBarangMap(barangRows)
  const entry      = barangMap[String(data.id_barang)]
  if (!entry) return errorResponse("id_barang tidak ditemukan: " + data.id_barang)

  const qty       = Number(data.qty)
  const sisaSaldo = entry.sisa_saldo - qty
  const id        = generateId(sheet, "DB", type)

  sheet.appendRow([
    id, data.id_barang, data.kode_barang, data.nama_barang,
    data.merk, data.satuan, data.tanggal, qty,
    sisaSaldo, data.keterangan || "",
  ])

  getBarangSheet(type).getRange(entry.rowIndex, 7).setValue(sisaSaldo)
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success", id: id })
}

function handleAddBatch(type, sheet, data) {
  const t = _t("addBatch(" + (data.items ? data.items.length : 0) + ")")

  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    return errorResponse("items harus berupa array non-kosong")
  }

  const barangRows = readRows(getBarangSheet(type))
  const barangMap  = buildBarangMap(barangRows)
  const runSaldo   = {}
  const newRows    = []
  let   nextRowNum = sheet.getLastRow() + 1

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    const err  = validateFields(item, ["id_barang", "kode_barang", "nama_barang", "merk", "satuan", "tanggal", "qty"])
    if (err) return errorResponse("item[" + i + "]: " + err)

    const id  = "DB-" + TYPE_LABEL[type] + "-" + String(nextRowNum - 1).padStart(4, "0")
    const idB = String(item.id_barang)
    const qty = Number(item.qty)

    if (!(idB in runSaldo)) {
      const entry = barangMap[idB]
      if (!entry) return errorResponse("item[" + i + "]: id_barang tidak ditemukan: " + idB)
      runSaldo[idB] = entry.sisa_saldo
    }
    runSaldo[idB] -= qty

    newRows.push([
      id, item.id_barang, item.kode_barang, item.nama_barang,
      item.merk, item.satuan, item.tanggal, qty,
      runSaldo[idB], item.keterangan || "",
    ])
    nextRowNum++
  }

  batchInsertRows(sheet, newRows)

  const barangSheet = getBarangSheet(type)
  Object.keys(runSaldo).forEach(function(idB) {
    const entry = barangMap[idB]
    if (entry) barangSheet.getRange(entry.rowIndex, 7).setValue(runSaldo[idB])
  })
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success", inserted: newRows.length })
}

function handleUpdate(type, sheet, data) {
  const t = _t("update")

  const err = validateFields(data, ["id", "id_barang", "kode_barang", "nama_barang", "merk", "satuan", "tanggal", "qty"])
  if (err) return errorResponse(err)

  const keluarRows = readRows(sheet)
  const keluarMap  = buildTransaksiMap(keluarRows)
  const kEntry     = keluarMap[String(data.id)]
  if (!kEntry) return errorResponse("id keluar tidak ditemukan: " + data.id)

  const oldIdBarang = kEntry.id_barang
  const oldQty      = kEntry.qty
  const newQty      = Number(data.qty)
  const newIdBarang = String(data.id_barang)
  const sameBarang  = oldIdBarang === newIdBarang

  const barangRows  = readRows(getBarangSheet(type))
  const barangMap   = buildBarangMap(barangRows)
  const barangSheet = getBarangSheet(type)
  const newEntry    = barangMap[newIdBarang]
  if (!newEntry) return errorResponse("id_barang baru tidak ditemukan: " + newIdBarang)

  const newSaldo = sameBarang
    ? newEntry.sisa_saldo - (newQty - oldQty)
    : newEntry.sisa_saldo - newQty

  sheet.getRange(kEntry.rowIndex, 1, 1, 10).setValues([[
    data.id, data.id_barang, data.kode_barang, data.nama_barang,
    data.merk, data.satuan, data.tanggal, newQty, newSaldo, data.keterangan || "",
  ]])

  barangSheet.getRange(newEntry.rowIndex, 7).setValue(newSaldo)

  if (!sameBarang) {
    const oldEntry = barangMap[oldIdBarang]
    if (oldEntry) barangSheet.getRange(oldEntry.rowIndex, 7).setValue(oldEntry.sisa_saldo + oldQty)
  }

  clearBarangCache(type)
  _te(t)
  return jsonResponse({ status: "success" })
}

function handleDelete(type, sheet, data) {
  const t = _t("delete")

  if (!data.id) return errorResponse("missing required field: id")

  const keluarRows = readRows(sheet)
  const keluarMap  = buildTransaksiMap(keluarRows)
  const kEntry     = keluarMap[String(data.id)]
  if (!kEntry) return errorResponse("id keluar tidak ditemukan: " + data.id)

  sheet.deleteRow(kEntry.rowIndex)

  const barangRows = readRows(getBarangSheet(type))
  const barangMap  = buildBarangMap(barangRows)
  const bEntry     = barangMap[kEntry.id_barang]
  if (bEntry) {
    getBarangSheet(type).getRange(bEntry.rowIndex, 7).setValue(bEntry.sisa_saldo + kEntry.qty)
    clearBarangCache(type)
  }

  _te(t)
  return jsonResponse({ status: "success" })
}

// ── Masuk Handlers ────────────────────────────────────────────────────────────

function handleAddMasuk(type, sheet, data) {
  const t = _t("addMasuk")

  const err = validateFields(data, ["id_barang", "kode_barang", "nama_barang", "merk", "satuan", "tanggal", "qty"])
  if (err) return errorResponse(err)

  const barangRows = readRows(getBarangSheet(type))
  const barangMap  = buildBarangMap(barangRows)
  const entry      = barangMap[String(data.id_barang)]
  if (!entry) return errorResponse("id_barang tidak ditemukan: " + data.id_barang)

  const qty       = Number(data.qty)
  const sisaSaldo = entry.sisa_saldo + qty
  const id        = generateId(sheet, "CR", type)

  sheet.appendRow([
    id, data.id_barang, data.kode_barang, data.nama_barang,
    data.merk, data.satuan, data.tanggal, qty,
    sisaSaldo, data.keterangan || "",
  ])

  getBarangSheet(type).getRange(entry.rowIndex, 7).setValue(sisaSaldo)
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success", id: id })
}

function handleAddMasukBatch(type, sheet, data) {
  const t = _t("addMasukBatch(" + (data.items ? data.items.length : 0) + ")")

  if (!data.items || !Array.isArray(data.items) || data.items.length === 0) {
    return errorResponse("items harus berupa array non-kosong")
  }

  const barangRows = readRows(getBarangSheet(type))
  const barangMap  = buildBarangMap(barangRows)
  const runSaldo   = {}
  const newRows    = []
  let   nextRowNum = sheet.getLastRow() + 1

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    const err  = validateFields(item, ["id_barang", "kode_barang", "nama_barang", "merk", "satuan", "tanggal", "qty"])
    if (err) return errorResponse("item[" + i + "]: " + err)

    const id  = "CR-" + TYPE_LABEL[type] + "-" + String(nextRowNum - 1).padStart(4, "0")
    const idB = String(item.id_barang)
    const qty = Number(item.qty)

    if (!(idB in runSaldo)) {
      const entry = barangMap[idB]
      if (!entry) return errorResponse("item[" + i + "]: id_barang tidak ditemukan: " + idB)
      runSaldo[idB] = entry.sisa_saldo
    }
    runSaldo[idB] += qty

    newRows.push([
      id, item.id_barang, item.kode_barang, item.nama_barang,
      item.merk, item.satuan, item.tanggal, qty,
      runSaldo[idB], item.keterangan || "",
    ])
    nextRowNum++
  }

  batchInsertRows(sheet, newRows)

  const barangSheet = getBarangSheet(type)
  Object.keys(runSaldo).forEach(function(idB) {
    const entry = barangMap[idB]
    if (entry) barangSheet.getRange(entry.rowIndex, 7).setValue(runSaldo[idB])
  })
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success", inserted: newRows.length })
}

function handleUpdateMasuk(type, sheet, data) {
  const t = _t("updateMasuk")

  const err = validateFields(data, ["id", "id_barang", "kode_barang", "nama_barang", "merk", "satuan", "tanggal", "qty"])
  if (err) return errorResponse(err)

  const masukRows  = readRows(sheet)
  const masukMap   = buildTransaksiMap(masukRows)
  const kEntry     = masukMap[String(data.id)]
  if (!kEntry) return errorResponse("id masuk tidak ditemukan: " + data.id)

  const oldIdBarang = kEntry.id_barang
  const oldQty      = kEntry.qty
  const newQty      = Number(data.qty)
  const newIdBarang = String(data.id_barang)
  const sameBarang  = oldIdBarang === newIdBarang

  const barangRows  = readRows(getBarangSheet(type))
  const barangMap   = buildBarangMap(barangRows)
  const barangSheet = getBarangSheet(type)
  const newEntry    = barangMap[newIdBarang]
  if (!newEntry) return errorResponse("id_barang baru tidak ditemukan: " + newIdBarang)

  const newSaldo = sameBarang
    ? newEntry.sisa_saldo + (newQty - oldQty)
    : newEntry.sisa_saldo + newQty

  sheet.getRange(kEntry.rowIndex, 1, 1, 10).setValues([[
    data.id, data.id_barang, data.kode_barang, data.nama_barang,
    data.merk, data.satuan, data.tanggal, newQty, newSaldo, data.keterangan || "",
  ]])

  barangSheet.getRange(newEntry.rowIndex, 7).setValue(newSaldo)

  if (!sameBarang) {
    const oldEntry = barangMap[oldIdBarang]
    if (oldEntry) barangSheet.getRange(oldEntry.rowIndex, 7).setValue(oldEntry.sisa_saldo - oldQty)
  }

  clearBarangCache(type)
  _te(t)
  return jsonResponse({ status: "success" })
}

function handleDeleteMasuk(type, sheet, data) {
  const t = _t("deleteMasuk")

  if (!data.id) return errorResponse("missing required field: id")

  const masukRows = readRows(sheet)
  const masukMap  = buildTransaksiMap(masukRows)
  const kEntry    = masukMap[String(data.id)]
  if (!kEntry) return errorResponse("id masuk tidak ditemukan: " + data.id)

  sheet.deleteRow(kEntry.rowIndex)

  const barangRows = readRows(getBarangSheet(type))
  const barangMap  = buildBarangMap(barangRows)
  const bEntry     = barangMap[kEntry.id_barang]
  if (bEntry) {
    getBarangSheet(type).getRange(bEntry.rowIndex, 7).setValue(bEntry.sisa_saldo - kEntry.qty)
    clearBarangCache(type)
  }

  _te(t)
  return jsonResponse({ status: "success" })
}

// ── Barang Handlers ───────────────────────────────────────────────────────────

function handleAddBarang(type, data) {
  const t = _t("addBarang")

  const err = validateFields(data, ["kode_barang", "nama_barang", "merk", "satuan", "saldo_awal"])
  if (err) return errorResponse(err)

  const bSheet    = getBarangSheet(type)
  const saldoAwal = Number(data.saldo_awal) || 0
  const id        = generateId(bSheet, "BR", type)

  bSheet.appendRow([
    id,
    data.kode_barang,
    data.nama_barang,
    data.merk,
    data.satuan,
    saldoAwal,
    saldoAwal,
  ])
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success", id: id })
}

function handleUpdateBarang(type, data) {
  const t = _t("updateBarang")

  const err = validateFields(data, ["id", "kode_barang", "nama_barang", "merk", "satuan", "saldo_awal"])
  if (err) return errorResponse(err)

  const bSheet    = getBarangSheet(type)
  const bRows     = readRows(bSheet)
  const barangMap = buildBarangMap(bRows)
  const entry     = barangMap[String(data.id)]
  if (!entry) return errorResponse("id barang tidak ditemukan: " + data.id)

  const oldSaldoAwal = entry.saldo_awal
  const newSaldoAwal = Number(data.saldo_awal) || 0
  const delta        = newSaldoAwal - oldSaldoAwal
  const newSisaSaldo = entry.sisa_saldo + delta

  bSheet.getRange(entry.rowIndex, 1, 1, 7).setValues([[
    data.id,
    data.kode_barang,
    data.nama_barang,
    data.merk,
    data.satuan,
    newSaldoAwal,
    newSisaSaldo,
  ]])
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success" })
}

function handleDeleteBarang(type, data) {
  const t = _t("deleteBarang")

  if (!data.id) return errorResponse("missing required field: id")

  const bSheet    = getBarangSheet(type)
  const bRows     = readRows(bSheet)
  const barangMap = buildBarangMap(bRows)
  const entry     = barangMap[String(data.id)]
  if (!entry) return errorResponse("id barang tidak ditemukan: " + data.id)

  bSheet.deleteRow(entry.rowIndex)
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success" })
}

// ── Rollover Saldo Awal ───────────────────────────────────────────────────────

/**
 * Rollover: save snapshot THEN copy sisa_saldo → saldo_awal for the new month.
 * Called by Vercel Cron on the 1st of each month via POST { action: "rollover", cronSecret: "..." }
 *
 * Flow:
 *   1. Save snapshot of saldo_awal for the month that just ended (idempotent)
 *   2. Verify snapshot saved per type; log CRITICAL if empty
 *   3. Copy sisa_saldo (col G) → saldo_awal (col F) to open new month
 */
function rolloverSaldo(secret) {
  const ROLLOVER_SECRET = PropertiesService.getScriptProperties().getProperty("ROLLOVER_SECRET")
  if (!ROLLOVER_SECRET || secret !== ROLLOVER_SECRET) {
    Logger.log("[WARN] rolloverSaldo: unauthorized attempt")
    return false
  }

  const t = _t("rollover")

  const now       = new Date()
  const prevDate  = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const snapYear  = prevDate.getFullYear()
  const snapMonth = prevDate.getMonth() + 1

  // 1. Save snapshot of month that just ended (idempotent)
  saveSnapshot(snapYear, snapMonth)

  // 2. Verify snapshot was saved; log critical warning if not
  VALID_TYPES.forEach(function(type) {
    const check = buildSnapshotMap(snapYear, snapMonth)
    const found = Object.keys(check).some(function(k) { return k.startsWith(type + "|") })
    if (!found) {
      Logger.log("[CRITICAL] Snapshot " + snapYear + "-" + String(snapMonth).padStart(2, "0") +
        " kosong untuk type=" + type + ". Rollover tetap dijalankan.")
    }
  })

  // 3. Copy sisa_saldo → saldo_awal (open new month)
  VALID_TYPES.forEach(function(type) {
    const sheet = SHEETS.barang[type]
    if (!sheet) return
    const rows = readRows(sheet)
    if (rows.length === 0) return

    const updates = rows.map(function(r) { return [Number(r[6]) || 0] })
    sheet.getRange(2, 6, updates.length, 1).setValues(updates)
    clearBarangCache(type)
  })

  _te(t)
  Logger.log("[ROLLOVER] Done. Snapshot saved for " + snapYear + "-" + snapMonth)
  return true
}

// ── getStok ───────────────────────────────────────────────────────────────────

/**
 * Generate stock report for a given month/year.
 *
 * saldo_awal priority (v3.1):
 *   1. Snapshot for (year, month)                                → "snapshot"
 *   2. Snapshot for (year, month+1), backward-derive             → "derived_from_next_snapshot"
 *   3. Nearest prior snapshot + forward-accumulate txns          → "derived_forward_from_prior_snapshot"
 *      FIX v3.1: range inklusif dari bulan prior snapshot itu sendiri
 *   4. Col F master sheet                                        → "master_fallback" (last resort)
 *
 * sisa_saldo:
 *   - Current month : live col G
 *   - Past months   : saldo_awal + total_masuk - total_keluar
 */
function handleGetStok(month, year, forceRefresh) {
  const t = _t("getStok")

  if (!month || !year) return errorResponse("month dan year wajib diisi")

  month = Number(month)
  year  = Number(year)

  if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
    return errorResponse("invalid month/year")
  }

  // v3.2: hasil yang sudah dihitung dilayani langsung tanpa menyentuh sheet.
  // Cache dibuang otomatis begitu ada POST (lihat invalidasi generasi di doPost).
  // forceRefresh juga membuang cache barang, supaya kolom F/G yang diedit manual
  // di spreadsheet benar-benar terbaca ulang — bukan cuma melewati cache stok.
  if (forceRefresh) {
    VALID_TYPES.forEach(function(type) { clearBarangCache(type) })
  }

  const cachedJson = forceRefresh ? null : getStokCached(year, month)
  if (cachedJson) {
    Logger.log("[CACHE] getStok " + year + "-" + month + " HIT")
    _te(t)
    return ContentService.createTextOutput(cachedJson).setMimeType(ContentService.MimeType.JSON)
  }

  const now            = new Date()
  const isCurrentMonth = month === (now.getMonth() + 1) && year === now.getFullYear()
  const nextMonth      = month === 12 ? 1 : month + 1
  const nextYear       = month === 12 ? year + 1 : year
  const daysInMonth    = new Date(year, month, 0).getDate()

  // ── 1. Read all barang ──────────────────────────────────────────────────────
  // v3.2: getBarangRows() melewati CacheService, dan cache itu selalu dibersihkan
  // oleh clearBarangCache() setiap ada tulis — jadi kolom G tetap akurat.
  const barangData = []
  VALID_TYPES.forEach(function(type) {
    getBarangRows(type).forEach(function(r) {
      barangData.push({ type: type, row: r })
    })
  })

  // ── 2. Build snapshot maps ──────────────────────────────────────────────────
  const snapshotMap     = buildSnapshotMap(year, month)
  const nextSnapshotMap = isCurrentMonth ? {} : buildSnapshotMap(nextYear, nextMonth)

  // ── 3. Build _fwdDeriveMap — computed once, O(n) total ─────────────────────
  //
  // FIX v3.1 HIGH: range sekarang inklusif dari bulan prior snapshot.
  //   Sebelumnya: aggregateTransaksiBetween(snapMonth+1, ..., targetMonth)
  //   Sekarang:   aggregateTransaksiBetween(snapMonth,   ..., targetMonth)
  //
  // FIX v3.1 MEDIUM: key pakai "type|id_barang" (bukan "id_barang" saja)
  //   agar tidak bentrok jika ID yang sama muncul di ATK/RT/Obat.
  //
  const _fwdDeriveMap = {}   // key: "type|id_barang"
  if (!isCurrentMonth) {
    const priorSnapshot = findNearestPriorSnapshot(year, month)
    if (priorSnapshot) {
      // FIX: inklusif dari snapMonth (bukan snapMonth+1)
      const fromNum = priorSnapshot.snapYear  * 100 + priorSnapshot.snapMonth
      const toNum   = year                    * 100 + month

      const between = fromNum < toNum
        ? aggregateTransaksiBetween(priorSnapshot.snapYear, priorSnapshot.snapMonth, year, month)
        : {}

      Object.keys(priorSnapshot.map).forEach(function(key) {
        // key format: "type|id_barang" — sama persis dengan key di between
        const priorVal = priorSnapshot.map[key]
        const tx       = between[key] || { masuk: 0, keluar: 0 }
        _fwdDeriveMap[key] = priorVal + tx.masuk - tx.keluar
      })
    }
  }

  // ── 4. Aggregate keluar per barang per day ──────────────────────────────────
  // key: "type|id_barang" (FIX v3.1 MEDIUM)
  const keluarByBarang = {}
  VALID_TYPES.forEach(function(type) {
    keluarRowsOf(type).forEach(function(r) {
      const d = new Date(r[6])
      if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
      const key = type + "|" + String(r[1]).trim()
      const day = d.getDate()
      if (!keluarByBarang[key]) keluarByBarang[key] = {}
      keluarByBarang[key][day] = (keluarByBarang[key][day] || 0) + (Number(r[7]) || 0)
    })
  })

  // ── 5. Aggregate masuk per barang per day ───────────────────────────────────
  // key: "type|id_barang" (FIX v3.1 MEDIUM)
  const masukByBarang = {}
  VALID_TYPES.forEach(function(type) {
    masukRowsOf(type).forEach(function(r) {
      const d = new Date(r[6])
      if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
      const key = type + "|" + String(r[1]).trim()
      const day = d.getDate()
      if (!masukByBarang[key]) masukByBarang[key] = {}
      masukByBarang[key][day] = (masukByBarang[key][day] || 0) + (Number(r[7]) || 0)
    })
  })

  // ── 6. Build result per barang ──────────────────────────────────────────────
  const result = barangData.map(function(item) {
    const type          = item.type
    const r             = item.row
    const id_barang     = String(r[0]).trim()
    const txKey         = type + "|" + id_barang   // unified key for all maps

    const keluarDayMap       = keluarByBarang[txKey] || {}
    const masukDayMap        = masukByBarang[txKey]  || {}
    const keluar_per_tanggal = []
    const masuk_per_tanggal  = []
    let total_keluar = 0
    let total_masuk  = 0

    for (let d = 1; d <= daysInMonth; d++) {
      const k = keluarDayMap[d] || 0
      const m = masukDayMap[d]  || 0
      keluar_per_tanggal.push(k)
      masuk_per_tanggal.push(m)
      total_keluar += k
      total_masuk  += m
    }

    // ── saldo_awal: priority cascade ─────────────────────────────────────────
    const snapshotVal     = lookupSnapshot(snapshotMap, type, id_barang)
    const nextSnapshotVal = isCurrentMonth ? null : lookupSnapshot(nextSnapshotMap, type, id_barang)

    let saldo_awal        = 0
    let saldo_awal_source = "master_fallback"

    if (snapshotVal !== null) {
      saldo_awal        = snapshotVal
      saldo_awal_source = "snapshot"

    } else if (nextSnapshotVal !== null) {
      saldo_awal        = (Number(nextSnapshotVal) || 0) - total_masuk + total_keluar
      saldo_awal_source = "derived_from_next_snapshot"

    } else if (_fwdDeriveMap[txKey] !== undefined) {
      // FIX v3.1: lookup pakai txKey = "type|id_barang"
      saldo_awal        = _fwdDeriveMap[txKey]
      saldo_awal_source = "derived_forward_from_prior_snapshot"

    } else {
      saldo_awal        = Number(r[5]) || 0
      saldo_awal_source = "master_fallback"
    }

    // ── sisa_saldo ────────────────────────────────────────────────────────────
    const computed_sisa_saldo = saldo_awal + total_masuk - total_keluar
    const live_sisa_saldo     = Number(r[6]) || 0
    const sisa_saldo          = isCurrentMonth ? live_sisa_saldo : computed_sisa_saldo

    return {
      id_barang,
      type,
      kode_barang:          r[1],
      nama_barang:          r[2],
      merk:                 r[3],
      satuan:               r[4],
      saldo_awal,
      sisa_saldo,
      total_masuk,
      total_keluar,
      days_in_month:        daysInMonth,
      keluar_per_tanggal,
      masuk_per_tanggal,
      saldo_awal_source,
      sisa_saldo_source:    isCurrentMonth ? "live_master" : "computed_period",
    }
  })

  const json = JSON.stringify(result)
  setStokCache(year, month, json)

  _te(t)
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON)
}

// ── Utility: isi snapshot yang terlewat (jalankan manual dari editor) ─────────

/**
 * Derive dan isi snapshot untuk bulan-bulan yang terlewat rollover.
 * Gunakan jika rollover pernah gagal sehingga snapshot kosong.
 *
 * FIX v3.1: range aggregate inklusif dari bulan prior snapshot
 * dan key memakai "type|id_barang".
 *
 * Cara pakai:
 *   1. Set FILL_MONTHS sesuai bulan yang ingin diisi
 *   2. Hapus dulu baris yang sudah ada di sheet Snapshot Saldo untuk bulan tersebut
 *   3. Run → fillSnapshotDerived
 */
function fillSnapshotDerived() {
  const FILL_MONTHS = [
    { year: 2026, month: 5 },   // ← sesuaikan
    { year: 2026, month: 6 },
  ]

  const snapshotSheet = SHEETS.snapshot
  if (!snapshotSheet) {
    Logger.log("[ERROR] Sheet 'Snapshot Saldo' tidak ditemukan.")
    return
  }

  const existingRows = readRows(snapshotSheet)
  const existingKeys = {}
  existingRows.forEach(function(r) {
    existingKeys[[r[0], r[1], r[2], r[3]].join("|")] = true
  })

  FILL_MONTHS.forEach(function(target) {
    const year  = target.year
    const month = target.month

    Logger.log("[FILL] Derive snapshot " + year + "-" + month + "...")

    const prior = findNearestPriorSnapshot(year, month)
    if (!prior) {
      Logger.log("[WARN] Tidak ada prior snapshot untuk " + year + "-" + month + ", skip.")
      return
    }

    Logger.log("[FILL] Base: " + prior.snapYear + "-" + prior.snapMonth)

    // FIX v3.1: inklusif dari bulan prior snapshot itu sendiri
    const fromNum = prior.snapYear * 100 + prior.snapMonth
    const toNum   = year           * 100 + month

    const between = fromNum < toNum
      ? aggregateTransaksiBetween(prior.snapYear, prior.snapMonth, year, month)
      : {}

    Logger.log("[FILL] Transaksi antar bulan: " + Object.keys(between).length + " keys")

    const newRows = []
    Object.keys(prior.map).forEach(function(key) {
      // key: "type|id_barang"
      const parts     = key.split("|")
      const type      = parts[0]
      const id_barang = parts[1]
      const priorVal  = prior.map[key]
      const tx        = between[key] || { masuk: 0, keluar: 0 }   // FIX: pakai key gabungan
      const saldo_awal_derived = priorVal + tx.masuk - tx.keluar

      const dupKey = [year, month, type, id_barang].join("|")
      if (!existingKeys[dupKey]) {
        newRows.push([year, month, type, id_barang, saldo_awal_derived])
        existingKeys[dupKey] = true
      }
    })

    if (newRows.length > 0) {
      batchInsertRows(snapshotSheet, newRows)
      // Bulan berikutnya di FILL_MONTHS harus melihat snapshot yang baru ditulis.
      resetMemo()
      bumpStokGenAll()
      Logger.log("[FILL] Saved " + newRows.length + " rows untuk " + year + "-" + month)
    } else {
      Logger.log("[FILL] Snapshot " + year + "-" + month + " sudah ada semua, dilewati.")
    }
  })

  Logger.log("[FILL] Selesai semua.")
}

/**
 * Debug helper: cek snapshot apa saja yang tersedia.
 * Run → cekSnapshotAda
 */
function cekSnapshotAda() {
  const rows = readRows(SHEETS.snapshot)
  if (rows.length === 0) {
    Logger.log("[CEK] Sheet Snapshot Saldo KOSONG.")
    return
  }
  const found = {}
  rows.forEach(function(r) {
    const key = r[0] + "-" + String(r[1]).padStart(2, "0")
    found[key] = (found[key] || 0) + 1
  })
  Object.keys(found).sort().forEach(function(k) {
    Logger.log("[CEK] Snapshot ada: " + k + " (" + found[k] + " rows)")
  })
}