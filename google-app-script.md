/**
 * ============================================================
 *  INVENTORY MANAGEMENT — Google Apps Script
 *  Production-ready | v3.7
 * ============================================================
 *
 *  CHANGELOG v3.7 (MENCEGAH LONCATAN STOK):
 *  - updateBarang tidak lagi menyimpan saldo apa adanya. sisa_saldo dari payload
 *    diabaikan; saldo_awal hanya boleh diubah untuk barang yang BELUM punya
 *    transaksi (F, G, dan snapshotnya ikut disamakan). Barang yang sudah
 *    bertransaksi ditolak (409) — koreksi stok lewat menu Gudang → Kartu Stok.
 *    Sebelumnya mengubah G dari master membuat stok berubah tanpa transaksi dan
 *    transaksi berikutnya loncat ke level baru.
 *  - Validasi server untuk add/addBatch/update masuk & keluar: qty harus angka > 0 dan tanggal harus YYYY-MM-DD yang valid. Sebelumnya hanya dicek di form;
 *    qty bukan angka membuat sisa_saldo NaN dan memutus rantai saldo.
 *  - addBarang menolak saldo_awal yang bukan angka atau negatif.
 *
 *  CHANGELOG v3.6 (MODUL GUDANG):
 *  - Action "gudang*" untuk halaman /gudang di aplikasi web. Hanya dilayani jika
 *    payload membawa gudangSecret yang sama dengan Script Property GUDANG_SECRET.
 *    Secret itu hanya ada di server Next.js, tidak pernah di browser.
 *  - gudangKartu / gudangSimpanKartu: lihat dan perbaiki seluruh riwayat satu
 *    barang dalam satu request. Saldo (kolom I, snapshot, F, G) dihitung ulang
 *    dari saldo pembuka + transaksi.
 *  - cekKontinuitas, rebuildSaldo, repairDuplicateIds, fillSnapshotDerived, dan
 *    rollover kini punya versi yang mengembalikan JSON (dipakai menu Gudang).
 *  - Sheet "Log Gudang" dibuat otomatis: catatan setiap perubahan dari menu Gudang.
 *
 *  CHANGELOG v3.5 (KOREKSI — mengubah hasil penulisan):
 *  - ID transaksi/barang tidak lagi dari getLastRow() (kembar setelah baris
 *    dihapus) melainkan reserveIds(): penghitung permanen + nomor terbesar.
 *    SpreadsheetApp.flush() sebelum lock dilepas. Update/delete menolak ID kembar.
 *    Utility: repairDuplicateIds(apply).
 *  - Kaskade saldo: edit/hapus/input mundur transaksi lama kini menggeser kolom I
 *    semua transaksi sesudahnya, Snapshot Saldo bulan-bulan berikutnya, dan
 *    kolom F master (cascadeSaldoMulti). Dulu hanya satu baris yang berubah dan
 *    kolom I-nya malah diisi saldo HARI INI. Urutan satu barang: tanggal →
 *    masuk sebelum keluar → nomor ID.
 *    Utility: rebuildSaldo(apply) menghitung ulang semuanya dari kolom G.
 *
 *  SETUP:
 *  1. Extensions → Apps Script → Project Settings → Script Properties
 *     Tambahkan: ROLLOVER_SECRET = <secret sama dengan env Vercel>
 *                GUDANG_SECRET   = <secret sama dengan env Vercel GUDANG_SECRET>
 *
 *  Sheet yang dibutuhkan (nama harus persis):
 *    Barang ATK / Barang RT / Barang Obat
 *    Keluar ATK / Keluar RT / Keluar Obat
 *    Masuk ATK  / Masuk RT  / Masuk Obat
 *    Snapshot Saldo   ← buat manual, header di baris 1
 *    Batch Log        ← dibuat OTOMATIS saat penyimpanan pertama, jangan dihapus.
 *                       Berisi catatan permanen id penyimpanan agar input yang
 *                       diulang setelah gagal tidak tertulis dua kali.
 *    Log Gudang       ← dibuat OTOMATIS saat perubahan pertama dari menu Gudang.
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

/** Tanggal "YYYY-MM-DD" yang benar-benar ada di kalender (menolak 2026-02-31). */
function isValidTanggal(val) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(val))
  if (!m) return false
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  const dt = new Date(y, mo - 1, d)
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d
}

const TX_FIELDS = ["id_barang", "kode_barang", "nama_barang", "merk", "satuan", "tanggal", "qty"]

/**
 * Validasi isi transaksi masuk/keluar di sisi server (v3.7).
 *
 * Form sudah memeriksa hal yang sama, tetapi URL /exec bisa dipanggil langsung.
 * Qty yang bukan angka membuat sisa_saldo jadi NaN, lalu terbaca 0 di request
 * berikutnya — rantai saldo putus. Tanggal yang tidak terbaca membuat transaksi
 * terurut di posisi yang salah dan hilang dari laporan bulanan.
 */
function validateTransaksi(data) {
  const err = validateFields(data, TX_FIELDS)
  if (err) return err
  const q = Number(data.qty)
  if (!isFinite(q) || q <= 0) return "qty harus angka lebih dari 0 (diterima: " + data.qty + ")"
  if (!isValidTanggal(data.tanggal)) return "tanggal harus berformat YYYY-MM-DD (diterima: " + data.tanggal + ")"
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
const DUP_ID_MSG = "ID transaksi kembar, tidak bisa diubah/dihapus sebelum diperbaiki (jalankan repairDuplicateIds di Apps Script): "

function buildTransaksiMap(rows) {
  const map = {}
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0]).trim()
    if (!id) continue
    // ID kembar: jangan diam-diam menimpa. Update/delete harus menolak, karena
    // baris mana yang dimaksud tidak bisa dipastikan (lihat repairDuplicateIds).
    if (map[id]) { map[id].duplicate = true; continue }
    map[id] = {
      rowIndex:  i + 2,
      id_barang: String(rows[i][1]).trim(),
      tanggal:   rows[i][6],
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

// ── Idempotensi penulisan batch (v3.4) ───────────────────────────────────────
//
// Input biasanya ratusan baris sekaligus. Kegagalan yang berbahaya bukan
// penolakan validasi (itu sudah all-or-nothing, nol baris tertulis), melainkan
// respons yang HILANG DI JALAN setelah server selesai menulis — entah karena 404
// transien dari googleusercontent, atau browser menyerah duluan. Pengguna
// melihat error, menekan simpan lagi, dan ratusan baris masuk dua kali sekaligus
// memotong saldo dua kali.
//
// Karena itu setiap penulisan "add*" membawa batchId. Hasilnya disimpan sebentar,
// dan kiriman dengan batchId yang sama mengembalikan hasil lama tanpa menulis apa
// pun. Menekan simpan ulang jadi aman.
//
// TTL 6 jam: cukup panjang untuk percobaan ulang oleh manusia, dan tidak perlu
// permanen karena input berikutnya selalu memakai batchId baru.

// Penanda disimpan di DUA tempat, dengan peran berbeda:
//
//   CacheService  — jalur cepat, TTL 6 jam. Bisa dikeluarkan Google sewaktu-waktu.
//   Sheet "Batch Log" — catatan permanen. Inilah yang membuat perlindungan tidak
//                       bergantung pada cache yang bisa hilang.
//
// Cache diperiksa lebih dulu; sheet hanya dibaca kalau cache meleset. Dan yang
// dibaca cuma kolom A (daftar id), bukan seluruh lebar baris — jadi pemeriksaan
// tetap murah walau catatannya sudah ribuan baris.

const BATCH_ID_TTL      = 21600
const BATCH_SHEET_NAME  = "Batch Log"
const BATCH_LOG_MAX_ROWS = 5000   // di atas ini, baris tertua dipangkas

function _batchKey(id) { return "batch_v1_" + id }

/**
 * Sheet "Batch Log", dibuat otomatis kalau belum ada.
 * Hanya dipanggil di jalur tulis, jadi tidak membebani pembacaan.
 */
function ensureBatchSheet() {
  if (_memo.batchSheet !== undefined) return _memo.batchSheet

  let sheet = SS.getSheetByName(BATCH_SHEET_NAME)
  if (!sheet) {
    try {
      sheet = SS.insertSheet(BATCH_SHEET_NAME)
      sheet.appendRow(["batch_id", "waktu", "action", "type", "hasil"])
      Logger.log("[BATCH] Sheet '" + BATCH_SHEET_NAME + "' dibuat otomatis.")
    } catch (e) {
      Logger.log("[WARN] Gagal membuat sheet '" + BATCH_SHEET_NAME + "': " + e.message)
      sheet = null
    }
  }

  _memo.batchSheet = sheet
  return sheet
}

/** Cari batchId di catatan permanen. Hanya kolom A yang dibaca. */
function findBatchInSheet(id) {
  const sheet = SS.getSheetByName(BATCH_SHEET_NAME)
  if (!sheet) return null

  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return null

  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues()
  // Dari belakang: percobaan ulang hampir selalu mengejar batch yang baru.
  for (let i = ids.length - 1; i >= 0; i--) {
    if (String(ids[i][0]) === id) {
      return String(sheet.getRange(i + 2, 5).getValue() || "")
    }
  }
  return null
}

function pruneBatchLog(sheet) {
  const total = sheet.getLastRow() - 1
  if (total <= BATCH_LOG_MAX_ROWS) return
  try {
    sheet.deleteRows(2, total - BATCH_LOG_MAX_ROWS)
  } catch (e) { /* pemangkasan bersifat kebersihan, bukan keharusan */ }
}

/** @returns {string|null} JSON hasil sebelumnya untuk batchId ini. */
function getBatchResult(id) {
  if (!id) return null

  try {
    const cepat = CacheService.getScriptCache().get(_batchKey(id))
    if (cepat) return cepat
  } catch (e) { /* lanjut ke catatan permanen */ }

  return findBatchInSheet(id)
}

function rememberBatchResult(id, action, type, json) {
  if (!id) return

  try {
    CacheService.getScriptCache().put(_batchKey(id), json, BATCH_ID_TTL)
  } catch (e) { /* cache is optional, fail silently */ }

  const sheet = ensureBatchSheet()
  if (!sheet) return
  try {
    sheet.appendRow([id, new Date(), action, type, json])
    pruneBatchLog(sheet)
  } catch (e) {
    Logger.log("[WARN] Gagal mencatat batch " + id + ": " + e.message)
  }
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

// ── ID unik ───────────────────────────────────────────────────────────────────
//
// Dulu ID dibuat dari getLastRow(). Itu menghasilkan ID kembar begitu ada baris
// yang dihapus (deleteRow / deleteMasuk / deleteBarang): lastRow turun, sehingga
// ID berikutnya sama dengan ID baris terakhir yang masih ada. Hal yang sama
// terjadi kalau tulisan request sebelumnya belum terflush saat lock dilepas.
//
// Sekarang nomor urut = max(penghitung permanen, nomor terbesar di kolom A) + 1.
// Penghitung disimpan di Script Properties per prefix+type dan hanya naik, jadi
// ID yang pernah dipakai tidak muncul lagi walau barisnya sudah dihapus.
//
// WAJIB dipanggil di dalam script lock (doPost sudah menjamin ini).

const ID_SEQ_PREFIX = "ID_SEQ_"

function parseIdSeq(id) {
  const m = /-(\d+)$/.exec(String(id).trim())
  return m ? Number(m[1]) : 0
}

/**
 * Cadangkan `count` ID berurutan. Format: PREFIX-TYPELABEL-NNNN (DB-ATK-0012).
 * @returns {string[]}
 */
function reserveIds(sheet, prefix, type, count) {
  const props = PropertiesService.getScriptProperties()
  const key   = ID_SEQ_PREFIX + prefix + "_" + type
  let   top   = Number(props.getProperty(key)) || 0

  const lastRow = sheet.getLastRow()
  if (lastRow >= 2) {
    sheet.getRange(2, 1, lastRow - 1, 1).getValues().forEach(function(r) {
      top = Math.max(top, parseIdSeq(r[0]))
    })
  }

  props.setProperty(key, String(top + count))

  const ids = []
  for (let i = 1; i <= count; i++) {
    ids.push(prefix + "-" + TYPE_LABEL[type] + "-" + String(top + i).padStart(4, "0"))
  }
  return ids
}

function generateId(sheet, prefix, type) {
  return reserveIds(sheet, prefix, type, 1)[0]
}

/**
 * Utility manual (jalankan dari editor Apps Script) untuk memperbaiki ID kembar
 * yang sudah terlanjur ada di sheet Keluar/Masuk. Baris PERTAMA tetap memakai ID
 * lamanya; baris kembar berikutnya diberi ID baru.
 *
 *   repairDuplicateIds()        → hanya melaporkan di log (dry run)
 *   repairDuplicateIds(true)    → benar-benar menulis perbaikan
 *
 * Master barang sengaja tidak disentuh: id_barang dirujuk dari sheet transaksi,
 * jadi ID barang kembar harus dibereskan manual. Kembarannya hanya dilaporkan.
 */
function repairDuplicateIds(apply) {
  const lock = LockService.getScriptLock()
  lock.waitLock(30000)
  try {
    markScriptWrite()
    repairDuplicateIdsCore(apply)
  } finally {
    lock.releaseLock()
  }
}

/**
 * Isi repairDuplicateIds tanpa lock — pemanggil WAJIB sudah memegang script lock.
 * @returns {{ barang: Object[], transaksi: Object[] }} laporan untuk menu Gudang
 */
function repairDuplicateIdsCore(apply) {
  const report = { barang: [], transaksi: [] }

  VALID_TYPES.forEach(function(type) {
    const bIds = readRows(getBarangSheet(type)).map(function(r) { return String(r[0]).trim() })
    const bSeen = {}
    bIds.forEach(function(id) {
      if (!id) return
      if (bSeen[id]) {
        Logger.log("[DUP-BARANG] " + type + " id=" + id + " kembar — perbaiki manual")
        report.barang.push({ type: type, id: id })
      }
      bSeen[id] = true
    })
  })

  const jobs = []
  VALID_TYPES.forEach(function(type) {
    jobs.push({ sheet: getKeluarSheet(type), prefix: "DB", type: type })
    jobs.push({ sheet: getMasukSheet(type),  prefix: "CR", type: type })
  })

  jobs.forEach(function(job) {
    const last = job.sheet.getLastRow()
    if (last < 2) return

    const range = job.sheet.getRange(2, 1, last - 1, 1)
    const ids   = range.getValues()
    const seen  = {}
    const dups  = []

    ids.forEach(function(r, i) {
      const id = String(r[0]).trim()
      if (!id) return
      if (seen[id]) dups.push(i)
      else seen[id] = true
    })
    if (dups.length === 0) return

    Logger.log("[DUP] " + job.sheet.getName() + ": " + dups.length + " baris kembar" +
      (apply ? " — diperbaiki" : " (dry run)"))
    const entry = {
      sheet: job.sheet.getName(),
      baris: dups.map(function(i) { return { row: i + 2, id: String(ids[i][0]).trim() } }),
    }
    report.transaksi.push(entry)
    if (!apply) return

    const fresh = reserveIds(job.sheet, job.prefix, job.type, dups.length)
    dups.forEach(function(rowIdx, n) {
      entry.baris[n].idBaru = fresh[n]
      ids[rowIdx][0] = fresh[n]
    })
    range.setValues(ids)
  })

  if (apply) {
    SpreadsheetApp.flush()
    resetMemo()
    bumpStokGenAll()
  }
  return report
}

// ── Kaskade saldo (v3.5) ──────────────────────────────────────────────────────
//
// Saldo disimpan di tiga tempat yang semuanya turunan dari transaksi:
//   kolom I tiap baris Keluar/Masuk  → saldo SETELAH transaksi itu
//   Snapshot Saldo                   → saldo_awal tiap bulan
//   kolom F master barang            → saldo_awal bulan berjalan (= snapshot bulan ini)
// Kolom G master (sisa_saldo) dijaga lewat delta oleh tiap handler.
//
// Mengubah/menghapus/menyisipkan transaksi lama harus menggeser SEMUA saldo
// sesudahnya sebesar efek transaksi itu — kalau tidak, pengguna harus mengedit
// satu per satu. Fungsi di bawah melakukannya dalam satu request, di dalam lock.
//
// Urutan transaksi satu barang: tanggal, lalu masuk sebelum keluar, lalu nomor
// di ID. Efek: masuk = +qty, keluar = -qty.

const KIND_RANK = { masuk: 0, keluar: 1 }

/** Tanggal → YYYYMMDD. Sama untuk Date dari sheet maupun string "YYYY-MM-DD". */
function dayKeyOf(val) {
  if (val instanceof Date) {
    return val.getFullYear() * 10000 + (val.getMonth() + 1) * 100 + val.getDate()
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(val))
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])
  const d = new Date(val)
  return isNaN(d.getTime()) ? 0 : dayKeyOf(d)
}

function currentYm() {
  const n = new Date()
  return n.getFullYear() * 100 + (n.getMonth() + 1)
}

function makePos(kind, tanggal, id) {
  return [dayKeyOf(tanggal), KIND_RANK[kind], parseIdSeq(id)]
}

/** true jika posisi a berada SESUDAH posisi b. */
function posAfter(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

function cmpEntry(a, b) {
  return posAfter(a.pos, b.pos) ? 1 : (posAfter(b.pos, a.pos) ? -1 : 0)
}

function effectOf(kind, qty) {
  return kind === "masuk" ? Number(qty) : -Number(qty)
}

/** Kumpulkan baris Keluar/Masuk sebuah type menjadi ledger per id_barang. */
function buildLedgers(rowsBy, onlyIds) {
  const ledger = {}
  ;["masuk", "keluar"].forEach(function(kind) {
    rowsBy[kind].forEach(function(r, i) {
      const idB = String(r[1]).trim()
      if (onlyIds && !onlyIds[idB]) return
      if (!ledger[idB]) ledger[idB] = []
      ledger[idB].push({
        kind:     kind,
        rowIndex: i + 2,
        pos:      makePos(kind, r[6], r[0]),
        eff:      effectOf(kind, Number(r[7]) || 0),
        saldo:    Number(r[8]) || 0,
      })
    })
  })
  Object.keys(ledger).forEach(function(k) { ledger[k].sort(cmpEntry) })
  return ledger
}

/** suffix[i] = jumlah efek entri ke-i dst. suffix[n] = 0. */
function suffixEffects(led) {
  const suffix = new Array(led.length + 1)
  suffix[led.length] = 0
  for (let i = led.length - 1; i >= 0; i--) suffix[i] = suffix[i + 1] + led[i].eff
  return suffix
}

/**
 * Pergeseran saldo_awal bulan `ym` (saldo di AWAL bulan itu) akibat perubahan:
 * hanya transaksi di bulan SEBELUM ym yang ikut menggeser.
 */
function shiftAt(ch, ym) {
  let d = 0
  ch.added.forEach(function(a)   { if (Math.floor(a.pos[0] / 100) < ym) d += a.eff })
  ch.removed.forEach(function(r) { if (Math.floor(r.pos[0] / 100) < ym) d -= r.eff })
  return d
}

/**
 * Terapkan perubahan ledger beberapa barang sekaligus (satu type).
 * Dipanggil SETELAH perubahan struktural (baris sudah ditulis/dihapus dan kolom G
 * master sudah benar), karena ledger dibaca ulang dari sheet.
 *
 * @param {Object} changes  { id_barang: { removed, added, saldoAkhir } }
 *   removed:    [{ pos, eff }]                 transaksi lama yang lenyap dari barang ini
 *   added:      [{ kind, rowIndex, pos, eff }] transaksi baru yang sudah tertulis di sheet
 *   saldoAkhir: sisa_saldo master barang SESUDAH perubahan — jangkar untuk baris baru
 *
 * Baris yang ada digeser sebesar efek perubahan di sebelum-nya. Baris baru tidak
 * digeser melainkan dijangkar: saldo = saldoAkhir - jumlah efek baris sesudahnya.
 */
function cascadeSaldoMulti(type, changes) {
  const ids = Object.keys(changes).filter(function(id) {
    return changes[id].removed.length > 0 || changes[id].added.length > 0
  })
  if (ids.length === 0) return

  const only = {}
  ids.forEach(function(id) { only[id] = true })

  const rowsBy = { masuk: readRows(getMasukSheet(type)), keluar: readRows(getKeluarSheet(type)) }
  const ledger = buildLedgers(rowsBy, only)
  const edits  = { masuk: {}, keluar: {} }   // rowIndex → saldo baru

  // 1. Kolom I baris-baris transaksi
  ids.forEach(function(idB) {
    const ch  = changes[idB]
    const led = ledger[idB] || []
    const suffix  = suffixEffects(led)
    const isAdded = {}
    ch.added.forEach(function(a) { isAdded[a.kind + "|" + a.rowIndex] = true })

    led.forEach(function(e, i) {
      if (isAdded[e.kind + "|" + e.rowIndex]) {
        edits[e.kind][e.rowIndex] = ch.saldoAkhir - suffix[i + 1]
        return
      }
      let d = 0
      ch.added.forEach(function(a)   { if (posAfter(e.pos, a.pos)) d += a.eff })
      ch.removed.forEach(function(r) { if (posAfter(e.pos, r.pos)) d -= r.eff })
      if (d !== 0) edits[e.kind][e.rowIndex] = e.saldo + d
    })
  })

  ;["masuk", "keluar"].forEach(function(kind) {
    const idxs = Object.keys(edits[kind]).map(Number)
    if (idxs.length === 0) return
    // Hanya rentang yang berubah yang ditulis, bukan seluruh kolom.
    const lo = Math.min.apply(null, idxs)
    const hi = Math.max.apply(null, idxs)
    const col = []
    for (let r = lo; r <= hi; r++) {
      col.push([edits[kind][r] !== undefined ? edits[kind][r] : rowsBy[kind][r - 2][8]])
    }
    const sheet = kind === "masuk" ? getMasukSheet(type) : getKeluarSheet(type)
    sheet.getRange(lo, 9, col.length, 1).setValues(col)
  })

  // 2. Snapshot Saldo bulan-bulan sesudah transaksi
  if (SHEETS.snapshot) {
    const snapRows = readRows(SHEETS.snapshot)
    let changed = false
    const colE = snapRows.map(function(r) {
      if (String(r[2]) === type) {
        const ch = changes[String(r[3]).trim()]
        if (ch) {
          const d = shiftAt(ch, Number(r[0]) * 100 + Number(r[1]))
          if (d !== 0) { changed = true; return [(Number(r[4]) || 0) + d] }
        }
      }
      return [r[4]]
    })
    if (changed) {
      SHEETS.snapshot.getRange(2, 5, colE.length, 1).setValues(colE)
      resetMemo()
    }
  }

  // 3. Kolom F master (= saldo_awal bulan berjalan)
  const bSheet = getBarangSheet(type)
  const bMap   = buildBarangMap(readRows(bSheet))
  const nowYm  = currentYm()
  ids.forEach(function(idB) {
    const d = shiftAt(changes[idB], nowYm)
    const b = bMap[idB]
    if (d !== 0 && b) bSheet.getRange(b.rowIndex, 6).setValue(b.saldo_awal + d)
  })
  clearBarangCache(type)
}

/** Versi satu barang dari cascadeSaldoMulti. */
function cascadeSaldo(type, idBarang, removed, added, saldoAkhir) {
  const changes = {}
  changes[String(idBarang)] = { removed: removed, added: added, saldoAkhir: saldoAkhir }
  cascadeSaldoMulti(type, changes)
}

/** Ambil sampai n elemen yang tersebar merata (bukan n pertama, yang sering satu barang). */
function sampleEvenly(arr, n) {
  if (arr.length <= n) return arr
  const step = arr.length / n
  const out = []
  for (let i = 0; i < n; i++) out.push(arr[Math.floor(i * step)])
  return out
}

function fmtDay(dk) {
  const y = Math.floor(dk / 10000)
  const m = Math.floor(dk / 100) % 100
  const d = dk % 100
  return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0")
}

/**
 * Diagnosa read-only (tidak menulis apa pun): periksa KONTINUITAS kolom I apa
 * adanya, tanpa menjangkar ke kolom G.
 *
 * Untuk transaksi k dan k-1 milik satu barang (urut tanggal), seharusnya
 *   I[k] - I[k-1] == efek[k]
 * Selisihnya disebut "patahan". Dua pola patahan punya arti berbeda:
 *
 *   TERISOLASI  patahan +x lalu -x pada baris berikutnya → hanya SATU baris yang
 *               nilainya salah (mis. dulu edit menulis saldo hari ini ke baris
 *               lama, atau diketik manual). Menjangkar ke G memperbaikinya.
 *   LONCATAN    saldo berpindah dan TETAP di level baru → ada kejadian yang
 *               mengubah saldo tanpa transaksi (edit master barang, baris
 *               dihapus/disisipkan manual, saldo awal diubah). Menjangkar ke G
 *               akan MENULIS ULANG riwayat sebelum loncatan — periksa dulu.
 *
 * Juga dilaporkan "ujung ≠ G": barang yang kolom I terakhirnya tidak sama dengan G.
 */
function cekKontinuitas() {
  VALID_TYPES.forEach(function(type) {
    const bRows  = readRows(getBarangSheet(type))
    const rowsBy = { masuk: readRows(getMasukSheet(type)), keluar: readRows(getKeluarSheet(type)) }
    const ledger = buildLedgers(rowsBy, null)

    function txId(e) { return rowsBy[e.kind][e.rowIndex - 2][0] }

    let nBarang = 0, nPatah = 0, nIso = 0, nLonc = 0, nUjung = 0
    const isoS = [], loncS = [], ujungS = [], fDrift = []
    const nowYm = currentYm()

    bRows.forEach(function(b) {
      const idB = String(b[0]).trim()
      if (!idB) return
      const led = ledger[idB] || []
      const G   = Number(b[6]) || 0

      // F harus = G dikurangi transaksi bulan berjalan (juga untuk barang tanpa transaksi).
      let netNow = 0
      led.forEach(function(e) { if (Math.floor(e.pos[0] / 100) >= nowYm) netNow += e.eff })
      const wantF = G - netNow
      if (Math.abs((Number(b[5]) || 0) - wantF) > 1e-9) {
        fDrift.push({ idB: idB, nama: b[2], f: Number(b[5]) || 0, g: G, want: wantF })
      }

      if (led.length === 0) return
      nBarang++

      const jumps = []
      for (let i = 1; i < led.length; i++) {
        const j = (led[i].saldo - led[i - 1].saldo) - led[i].eff
        if (Math.abs(j) > 1e-9) jumps.push({ i: i, size: j })
      }
      if (jumps.length > 0) nPatah++

      let k = 0
      while (k < jumps.length) {
        const a = jumps[k], nx = jumps[k + 1]
        if (nx && nx.i === a.i + 1 && Math.abs(a.size + nx.size) < 1e-9) {
          nIso++
          const e = led[a.i]
          isoS.push({ idB: idB, id: txId(e), dk: e.pos[0], now: e.saldo, size: a.size })
          k += 2
        } else {
          nLonc++
          const p = led[a.i - 1], e = led[a.i]
          loncS.push({ idB: idB, dari: txId(p), dkDari: p.pos[0], ke: txId(e), dkKe: e.pos[0], size: a.size })
          k++
        }
      }

      const lastE = led[led.length - 1]
      const ujung = G - lastE.saldo
      if (Math.abs(ujung) > 1e-9) {
        nUjung++
        ujungS.push({ idB: idB, nama: b[2], g: G, last: lastE.saldo, id: txId(lastE), dk: lastE.pos[0] })
      }
    })

    Logger.log("[KONTINUITAS] " + type + ": barang bertransaksi=" + nBarang + ", barang berpatahan=" + nPatah +
      " | baris terisolasi=" + nIso + ", loncatan=" + nLonc + " | ujung≠G=" + nUjung)
    sampleEvenly(isoS, 5).forEach(function(m) {
      Logger.log("[KONTINUITAS] " + type + " TERISOLASI barang=" + m.idB + " " + m.id + " tgl=" + fmtDay(m.dk) +
        " I=" + m.now + " (meleset " + m.size + " dari rantainya)")
    })
    sampleEvenly(loncS, 5).forEach(function(m) {
      Logger.log("[KONTINUITAS] " + type + " LONCATAN barang=" + m.idB + " antara " + m.dari + " (" + fmtDay(m.dkDari) +
        ") dan " + m.ke + " (" + fmtDay(m.dkKe) + ") sebesar " + m.size)
    })

    // SENGKETA: G sendiri tidak cocok dengan transaksi. Daftar LENGKAP (maks 60 per
    // jenis) karena inilah yang harus dicek ke stok fisik sebelum menjangkar ke G.
    ujungS.slice(0, 60).forEach(function(m) {
      Logger.log("[SENGKETA] " + type + " barang=" + m.idB + " (" + m.nama + ") G=" + m.g +
        " tetapi I transaksi terakhir=" + m.last + " (" + m.id + ", " + fmtDay(m.dk) + ") selisih " + (m.g - m.last))
    })
    fDrift.slice(0, 60).forEach(function(m) {
      Logger.log("[SENGKETA] " + type + " barang=" + m.idB + " (" + m.nama + ") F=" + m.f + " G=" + m.g +
        " F-seharusnya=" + m.want + " (F lebih " + (m.f - m.want) + ")")
    })
  })
}

/**
 * Utility manual (jalankan dari editor Apps Script): hitung ulang SEMUA kolom I,
 * Snapshot Saldo, dan kolom F dari transaksi, dijangkar pada sisa_saldo (kolom G)
 * master sebagai kebenaran. Berguna setelah edit manual di spreadsheet atau untuk
 * memeriksa apakah data lama konsisten.
 *
 *   rebuildSaldo()        → hanya melaporkan jumlah selisih di log (dry run)
 *   rebuildSaldo(true)    → menulis perbaikan
 *
 * Catatan: kalau kolom G pernah dikoreksi tangan (stock opname) tanpa transaksi,
 * koreksi itu ikut tercermin di saldo yang dihitung mundur dari G.
 * Snapshot yang belum ada tidak dibuat — hanya yang sudah ada yang dikoreksi.
 */
function rebuildSaldo(apply) {
  const lock = LockService.getScriptLock()
  lock.waitLock(30000)
  try {
    markScriptWrite()
    rebuildSaldoCore(apply)
  } finally {
    lock.releaseLock()
  }
}

/**
 * Isi rebuildSaldo tanpa lock — pemanggil WAJIB sudah memegang script lock.
 * @returns {{ types: Object, snapshot: number, perBulan: Object }} jumlah selisih
 */
function rebuildSaldoCore(apply) {
  const report = { types: {}, snapshot: 0, perBulan: {} }
  const nowYm = currentYm()
  const snapAll = SHEETS.snapshot ? readRows(SHEETS.snapshot) : []
  const snapCol = snapAll.map(function(r) { return [r[4]] })
  let snapFix = 0
  const snapMiss = []

  VALID_TYPES.forEach(function(type) {
    const bSheet = getBarangSheet(type)
    const bRows  = readRows(bSheet)
    const rowsBy = { masuk: readRows(getMasukSheet(type)), keluar: readRows(getKeluarSheet(type)) }
    const ledger = buildLedgers(rowsBy, null)

    const outI = {
      masuk:  rowsBy.masuk.map(function(r)  { return [r[8]] }),
      keluar: rowsBy.keluar.map(function(r) { return [r[8]] }),
    }
    const fixI = { masuk: 0, keluar: 0 }
    const gBy  = {}
    let fixF = 0

    // Bahan diagnosa untuk log (tidak mempengaruhi penulisan).
    const missI     = []     // selisih kolom I
    const missF     = []     // selisih kolom F
    const diffsBy   = {}     // id_barang → { selisih: true } untuk baris I yang berbeda
    const unsortedBy = {}    // id_barang → true jika urutan baris di sheet ≠ urutan tanggal

    function differs(a, b) { return Math.abs((Number(a) || 0) - b) > 1e-9 }

    // saldo di AWAL bulan ym = G - jumlah efek transaksi dari bulan ym ke depan
    function opening(idB, ym) {
      let s = gBy[idB]
      ;(ledger[idB] || []).forEach(function(e) {
        if (Math.floor(e.pos[0] / 100) >= ym) s -= e.eff
      })
      return s
    }

    bRows.forEach(function(b, bi) {
      const idB = String(b[0]).trim()
      if (!idB) return
      const G = Number(b[6]) || 0
      gBy[idB] = G

      const led    = ledger[idB] || []
      const suffix = suffixEffects(led)
      // Apakah baris-baris barang ini di sheet (urutan input) sudah menurut tanggal?
      // Dicek per sheet, karena Masuk dan Keluar adalah dua sheet terpisah.
      ;["masuk", "keluar"].forEach(function(kind) {
        let prev = 0
        led.filter(function(e) { return e.kind === kind })
           .sort(function(a, b) { return a.rowIndex - b.rowIndex })
           .forEach(function(e) {
             if (e.pos[0] < prev) unsortedBy[idB] = true
             prev = Math.max(prev, e.pos[0])
           })
      })

      led.forEach(function(e, i) {
        const want = G - suffix[i + 1]
        const now  = outI[e.kind][e.rowIndex - 2][0]
        if (differs(now, want)) {
          missI.push({
            kind: e.kind, row: e.rowIndex, idTx: rowsBy[e.kind][e.rowIndex - 2][0],
            idB: idB, dk: e.pos[0], now: Number(now) || 0, want: want,
          })
          if (!diffsBy[idB]) diffsBy[idB] = {}
          diffsBy[idB][(Number(now) || 0) - want] = true
          outI[e.kind][e.rowIndex - 2][0] = want
          fixI[e.kind]++
        }
      })

      const wantF = opening(idB, nowYm)
      if (differs(b[5], wantF)) {
        fixF++
        missF.push({ idB: idB, f: Number(b[5]) || 0, g: G, want: wantF })
        if (apply) bSheet.getRange(bi + 2, 6).setValue(wantF)
      }
    })

    snapAll.forEach(function(r, i) {
      if (String(r[2]) !== type) return
      const idB = String(r[3]).trim()
      if (gBy[idB] === undefined) return
      const ym   = Number(r[0]) * 100 + Number(r[1])
      const want = opening(idB, ym)
      if (differs(r[4], want)) {
        snapCol[i][0] = want
        snapFix++
        snapMiss.push({ type: type, idB: idB, ym: ym, now: Number(r[4]) || 0, want: want })
      }
    })

    Logger.log("[REBUILD] " + type + ": kolom I masuk=" + fixI.masuk + " keluar=" + fixI.keluar +
      ", kolom F=" + fixF + (apply ? " — diperbaiki" : " (dry run)"))
    report.types[type] = { iMasuk: fixI.masuk, iKeluar: fixI.keluar, f: fixF }

    // ── Diagnosa: bantu menentukan PENYEBAB selisih ──
    const barangMiss = Object.keys(diffsBy)
    if (barangMiss.length > 0) {
      let konstan = 0, kacau = 0, kacauUrut = 0, konstanUrut = 0
      barangMiss.forEach(function(idB) {
        const varian = Object.keys(diffsBy[idB]).length === 1
        if (varian) { konstan++; if (unsortedBy[idB]) konstanUrut++ }
        else        { kacau++;   if (unsortedBy[idB]) kacauUrut++ }
      })
      // "konstan": semua baris salah barang itu meleset sama besar → tanda
      //   saldo tergeser (koreksi lama tidak dikaskadekan / edit manual).
      // "bervariasi": meleset berbeda-beda → tanda urutan input ≠ urutan tanggal.
      Logger.log("[DIAG] " + type + ": " + barangMiss.length + " barang kolom I-nya berbeda. " +
        "Geser konstan=" + konstan + " (urutan sheet ≠ tanggal: " + konstanUrut + "), " +
        "bervariasi=" + kacau + " (urutan sheet ≠ tanggal: " + kacauUrut + ")")
    }
    sampleEvenly(missI, 5).forEach(function(m) {
      Logger.log("[DIAG] " + type + " I " + m.kind + " baris " + m.row + " " + m.idTx + " barang=" + m.idB +
        " tgl=" + fmtDay(m.dk) + " sekarang=" + m.now + " seharusnya=" + m.want + " (selisih " + (m.now - m.want) + ")")
    })
    sampleEvenly(missF, 5).forEach(function(m) {
      // drift = F - (G - transaksi bulan ini). Bukan 0 berarti G, F, dan transaksi
      // bulan ini TIDAK saling cocok — periksa barang ini sebelum percaya pada G.
      Logger.log("[DIAG] " + type + " F barang=" + m.idB + " F=" + m.f + " G=" + m.g +
        " F-seharusnya=" + m.want + " (drift " + (m.f - m.want) + ")")
    })

    if (apply) {
      if (fixI.masuk  > 0) getMasukSheet(type).getRange(2, 9, outI.masuk.length, 1).setValues(outI.masuk)
      if (fixI.keluar > 0) getKeluarSheet(type).getRange(2, 9, outI.keluar.length, 1).setValues(outI.keluar)
      clearBarangCache(type)
    }
  })

  Logger.log("[REBUILD] snapshot selisih=" + snapFix + (apply ? " — diperbaiki" : " (dry run)"))

  // Sebaran per bulan: selisih menumpuk di bulan-bulan terbaru → tanda transaksi
  // mundur diinput setelah rollover; tersebar merata → koreksi lama tak dikaskadekan.
  const perBulan = {}
  snapMiss.forEach(function(m) { perBulan[m.ym] = (perBulan[m.ym] || 0) + 1 })
  Object.keys(perBulan).sort().forEach(function(ym) {
    Logger.log("[DIAG] snapshot bulan " + ym + ": " + perBulan[ym] + " selisih")
  })
  sampleEvenly(snapMiss, 5).forEach(function(m) {
    Logger.log("[DIAG] snapshot " + m.type + " " + m.ym + " barang=" + m.idB +
      " sekarang=" + m.now + " seharusnya=" + m.want + " (selisih " + (m.now - m.want) + ")")
  })

  if (apply) {
    if (snapFix > 0) SHEETS.snapshot.getRange(2, 5, snapCol.length, 1).setValues(snapCol)
    SpreadsheetApp.flush()
    resetMemo()
    bumpStokGenAll()
  }
  report.snapshot = snapFix
  report.perBulan = perBulan
  return report
}

// ── Modul Gudang (v3.6) ──────────────────────────────────────────────────────
//
// Dipanggil dari halaman /gudang lewat server Next.js (/api/gudang/[aksi]).
// Setiap action menolak payload tanpa gudangSecret yang cocok dengan Script
// Property GUDANG_SECRET. Secret hanya ada di server, tidak pernah di browser,
// sehingga action ini tidak bisa dipanggil langsung meski URL /exec diketahui.
//
// Kartu Stok memakai model yang sama dengan rebuildSaldo: saldo satu barang
// sepenuhnya ditentukan oleh saldo pembuka + transaksi. Bedanya, patokannya
// saldo pembuka (dipilih petugas), bukan kolom G.

const GUDANG_WRITE = [
  "gudangSimpanKartu", "gudangIsiSnapshot", "gudangRebuild",
  "gudangIdKembar", "gudangRollover", "gudangBersihkanCache",
]
const GUDANG_LOG_SHEET = "Log Gudang"
const EPS = 1e-9

function rnd(x) { return Math.round(x * 1000) / 1000 }

function ymNext(ym) { const m = ym % 100; return m === 12 ? (Math.floor(ym / 100) + 1) * 100 + 1 : ym + 1 }
function ymLabel(ym) { return Math.floor(ym / 100) + "-" + String(ym % 100).padStart(2, "0") }

function handleGudang(data) {
  const secret = PropertiesService.getScriptProperties().getProperty("GUDANG_SECRET")
  if (!secret || String(data.gudangSecret || "") !== secret) {
    Logger.log("[WARN] gudang: secret tidak cocok untuk action " + data.action)
    return errorResponse("unauthorized", 401)
  }

  const action = data.action
  try {
    switch (action) {
      case "gudangAnomali":        return jsonResponse({ status: "success", data: gudangAnomali() })
      case "gudangKartu":          return gudangKartuResponse(data)
      case "gudangSnapshotStatus": return jsonResponse({ status: "success", data: gudangSnapshotStatus() })
      case "gudangLog":            return jsonResponse({ status: "success", data: gudangLogRows(Number(data.limit) || 200) })
    }
    if (GUDANG_WRITE.indexOf(action) === -1) return errorResponse("unknown action: " + action)

    const lock = LockService.getScriptLock()
    try {
      lock.waitLock(30000)
    } catch (err) {
      return errorResponse("Server sedang sibuk. Coba lagi sebentar lagi.", 503)
    }
    try {
      markScriptWrite()
      switch (action) {
        case "gudangSimpanKartu":    return gudangSimpanKartu(data)
        case "gudangIsiSnapshot":    return gudangIsiSnapshot(data)
        case "gudangRebuild":        return gudangRebuild(data)
        case "gudangIdKembar":       return gudangIdKembar(data)
        case "gudangRollover":       return gudangRollover(data)
        case "gudangBersihkanCache": return gudangBersihkanCache()
      }
    } finally {
      SpreadsheetApp.flush()
      lock.releaseLock()
    }
  } catch (err) {
    // Hanya petugas gudang yang terautentikasi sampai di sini, jadi pesan aslinya
    // boleh diteruskan — membantu diagnosa tanpa harus membuka log eksekusi.
    Logger.log("[ERROR] " + action + ": " + err.message + "\n" + err.stack)
    return errorResponse("Gagal memproses " + action + ": " + err.message, 500)
  }
}

// ── Log Gudang ──

function ensureGudangLogSheet() {
  let sheet = SS.getSheetByName(GUDANG_LOG_SHEET)
  if (!sheet) {
    sheet = SS.insertSheet(GUDANG_LOG_SHEET)
    sheet.appendRow(["waktu", "petugas", "aksi", "type", "id_barang", "nama_barang", "ringkasan", "alasan", "detail"])
  }
  return sheet
}

function tulisLogGudang(data, aksi, info) {
  try {
    ensureGudangLogSheet().appendRow([
      new Date(), String(data.petugas || "-"), aksi,
      info.type || "", info.id_barang || "", info.nama || "",
      info.ringkasan || "", String(data.alasan || ""),
      info.detail ? JSON.stringify(info.detail).slice(0, 45000) : "",
    ])
  } catch (e) {
    Logger.log("[WARN] Gagal menulis Log Gudang: " + e.message)
  }
}

function gudangLogRows(limit) {
  const sheet = SS.getSheetByName(GUDANG_LOG_SHEET)
  if (!sheet) return []
  const last = sheet.getLastRow()
  if (last < 2) return []
  const n  = Math.min(limit, last - 1)
  const tz = Session.getScriptTimeZone()
  return sheet.getRange(last - n + 1, 1, n, 8).getValues().reverse().map(function(r) {
    return {
      waktu:       r[0] instanceof Date ? Utilities.formatDate(r[0], tz, "yyyy-MM-dd HH:mm") : String(r[0]),
      petugas:     String(r[1]),
      aksi:        String(r[2]),
      type:        String(r[3]),
      id_barang:   String(r[4]),
      nama_barang: String(r[5]),
      ringkasan:   String(r[6]),
      alasan:      String(r[7]),
    }
  })
}

// ── Anomali (cekKontinuitas + selisih snapshot, sebagai JSON) ──

/** id yang muncul lebih dari sekali di satu sheet transaksi. */
function idKembarSet(rows) {
  const seen = {}, dup = {}
  rows.forEach(function(r) {
    const id = String(r[0]).trim()
    if (!id) return
    if (seen[id]) dup[id] = true
    seen[id] = true
  })
  return dup
}

function gudangAnomali() {
  const nowYm = currentYm()
  const items = []
  let total = 0

  const snapBy = {}   // "type|id_barang" → [{ ym, val }]
  snapshotRowsAll().forEach(function(r) {
    const k = String(r[2]) + "|" + String(r[3]).trim()
    if (!snapBy[k]) snapBy[k] = []
    snapBy[k].push({ ym: Number(r[0]) * 100 + Number(r[1]), val: Number(r[4]) || 0 })
  })

  VALID_TYPES.forEach(function(type) {
    const bRows  = readRows(getBarangSheet(type))
    const rowsBy = { masuk: masukRowsOf(type), keluar: keluarRowsOf(type) }
    const ledger = buildLedgers(rowsBy, null)
    const dup    = { masuk: idKembarSet(rowsBy.masuk), keluar: idKembarSet(rowsBy.keluar) }
    function txId(e) { return String(rowsBy[e.kind][e.rowIndex - 2][0]).trim() }

    bRows.forEach(function(b) {
      const idB = String(b[0]).trim()
      if (!idB) return
      total++
      const led = ledger[idB] || []
      const F   = Number(b[5]) || 0
      const G   = Number(b[6]) || 0

      // Patahan rantai kolom I, dipasangkan seperti cekKontinuitas.
      const jumps = []
      for (let i = 1; i < led.length; i++) {
        const j = (led[i].saldo - led[i - 1].saldo) - led[i].eff
        if (Math.abs(j) > EPS) jumps.push({ i: i, size: j })
      }
      let iso = 0, lonc = 0, k = 0
      while (k < jumps.length) {
        const a = jumps[k], nx = jumps[k + 1]
        if (nx && nx.i === a.i + 1 && Math.abs(a.size + nx.size) < EPS) { iso++; k += 2 }
        else { lonc++; k++ }
      }

      const ujung = led.length ? G - led[led.length - 1].saldo : 0
      let netNow = 0
      led.forEach(function(e) { if (Math.floor(e.pos[0] / 100) >= nowYm) netNow += e.eff })
      const fDrift = F - (G - netNow)

      // Snapshot dibandingkan dengan hitungan berpatokan G, sama seperti rebuildSaldo.
      let snapBad = 0
      ;(snapBy[type + "|" + idB] || []).forEach(function(s) {
        let want = G
        led.forEach(function(e) { if (Math.floor(e.pos[0] / 100) >= s.ym) want -= e.eff })
        if (Math.abs(s.val - want) > EPS) snapBad++
      })

      const minus  = led.some(function(e) { return e.saldo < -EPS })
      const kembar = led.some(function(e) { return dup[e.kind][txId(e)] === true })

      if (lonc || iso || Math.abs(ujung) > EPS || Math.abs(fDrift) > EPS || snapBad || minus || kembar) {
        items.push({
          type: type, id_barang: idB,
          kode_barang: String(b[1]), nama_barang: String(b[2]), merk: String(b[3]), satuan: String(b[4]),
          transaksi: led.length, loncatan: lonc, terisolasi: iso,
          ujung: rnd(ujung), fDrift: rnd(fDrift), snapshot: snapBad, minus: minus, kembar: kembar,
        })
      }
    })
  })

  return { items: items, totalBarang: total, nowYm: nowYm }
}

// ── Kartu Stok ──

/**
 * Seluruh riwayat satu barang, urut seperti ledger. rowIndex disertakan untuk
 * dipakai gudangSimpanKartu dan dibuang sebelum dikirim ke browser.
 */
function kartuData(type, idB) {
  const bRows = readRows(getBarangSheet(type))
  let bi = -1
  for (let i = 0; i < bRows.length; i++) {
    if (String(bRows[i][0]).trim() === idB) { bi = i; break }
  }
  if (bi < 0) return null
  const b = bRows[bi]

  const rowsBy = { masuk: readRows(getMasukSheet(type)), keluar: readRows(getKeluarSheet(type)) }
  const only   = {}
  only[idB] = true
  const led = buildLedgers(rowsBy, only)[idB] || []
  const dup = { masuk: idKembarSet(rowsBy.masuk), keluar: idKembarSet(rowsBy.keluar) }

  const tx = led.map(function(e) {
    const r  = rowsBy[e.kind][e.rowIndex - 2]
    const id = String(r[0]).trim()
    return {
      kind: e.kind, id: id, tanggal: fmtDay(e.pos[0]),
      qty: Number(r[7]) || 0, saldo: Number(r[8]) || 0, keterangan: String(r[9] || ""),
      kembar: dup[e.kind][id] === true, rowIndex: e.rowIndex,
    }
  })

  const snapshot = []
  if (SHEETS.snapshot) {
    readRows(SHEETS.snapshot).forEach(function(r, i) {
      if (String(r[2]) === type && String(r[3]).trim() === idB) {
        snapshot.push({ ym: Number(r[0]) * 100 + Number(r[1]), saldo: Number(r[4]) || 0, rowIndex: i + 2 })
      }
    })
  }
  snapshot.sort(function(a, b) { return a.ym - b.ym })

  const barang = {
    id: idB, kode_barang: String(b[1]), nama_barang: String(b[2]), merk: String(b[3]), satuan: String(b[4]),
    saldo_awal: Number(b[5]) || 0, sisa_saldo: Number(b[6]) || 0, rowIndex: bi + 2,
  }
  return {
    barang: barang, tx: tx, snapshot: snapshot, hash: kartuHash(tx, barang),
    nowYm: currentYm(), today: fmtDay(dayKeyOf(new Date())),
  }
}

/** Sidik jari kartu. Berubah jika ada transaksi barang ini yang ditambah/diubah/dihapus. */
function kartuHash(tx, barang) {
  const s = tx.map(function(t) { return [t.kind, t.id, t.tanggal, t.qty, t.saldo].join("|") }).join(";") +
    "#" + barang.saldo_awal + "#" + barang.sisa_saldo
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)
    .map(function(x) { return ((x + 256) % 256).toString(16).padStart(2, "0") })
    .join("")
}

function gudangKartuResponse(data) {
  if (!isValidType(data.type)) return errorResponse("invalid type: " + data.type)
  const k = kartuData(data.type, String(data.id_barang || "").trim())
  if (!k) return errorResponse("id_barang tidak ditemukan: " + data.id_barang, 404)
  delete k.barang.rowIndex
  k.tx.forEach(function(t) { delete t.rowIndex })
  k.snapshot.forEach(function(s) { delete s.rowIndex })
  return jsonResponse({ status: "success", data: k })
}

/**
 * Terapkan perubahan Kartu Stok satu barang, lalu tulis ulang semua saldonya.
 *
 * Payload: { type, id_barang, baseHash, pembuka, alasan, petugas,
 *            ops: { update: [{kind,id,tanggal,qty}], delete: [{kind,id}],
 *                   add: [{kind,tanggal,qty,keterangan}] } }
 *
 * Angka saldo dari browser tidak dipakai — semuanya dihitung ulang di sini.
 * baseHash menolak penyimpanan jika ada yang mengubah barang ini sejak kartunya
 * dibuka, supaya input orang lain tidak tertimpa diam-diam.
 */
function gudangSimpanKartu(data) {
  const t = _t("gudangSimpanKartu")
  const type = data.type
  if (!isValidType(type)) return errorResponse("invalid type: " + type)
  const idB     = String(data.id_barang || "").trim()
  const pembuka = Number(data.pembuka)
  if (data.pembuka === null || data.pembuka === "" || !isFinite(pembuka)) return errorResponse("Saldo pembuka tidak valid.")
  if (String(data.alasan || "").trim().length < 5) return errorResponse("Alasan perubahan wajib diisi.")

  const cur = kartuData(type, idB)
  if (!cur) return errorResponse("id_barang tidak ditemukan: " + idB, 404)
  if (cur.hash !== data.baseHash) {
    return errorResponse("Data barang ini berubah sejak kartu dibuka. Muat ulang kartu, lalu ulangi perubahan.", 409)
  }

  const ops   = data.ops || {}
  const upd   = Array.isArray(ops.update) ? ops.update : []
  const del   = Array.isArray(ops.delete) ? ops.delete : []
  const add   = Array.isArray(ops.add)    ? ops.add    : []
  const today = dayKeyOf(new Date())
  const byKey = {}
  cur.tx.forEach(function(x) { byKey[x.kind + "|" + x.id] = x })

  function cekIsi(o, label) {
    if (o.kind !== "masuk" && o.kind !== "keluar") return label + ": jenis tidak valid"
    if (!isValidTanggal(o.tanggal)) return label + ": tanggal tidak valid"
    if (dayKeyOf(o.tanggal) > today) return label + ": tanggal tidak boleh setelah hari ini"
    const q = Number(o.qty)
    if (!isFinite(q) || q <= 0) return label + ": qty harus lebih dari 0"
    return null
  }
  const dipakai = {}
  function cekMilik(o, label) {
    const key = o.kind + "|" + String(o.id)
    const x = byKey[key]
    if (!x) return label + ": transaksi " + o.id + " bukan milik barang ini"
    if (x.kembar) return label + ": " + DUP_ID_MSG + o.id
    if (dipakai[key]) return label + ": transaksi " + o.id + " muncul dua kali"
    dipakai[key] = true
    return null
  }
  for (let i = 0; i < upd.length; i++) {
    const err = cekMilik(upd[i], "ubah[" + i + "]") || cekIsi(upd[i], "ubah[" + i + "]")
    if (err) return errorResponse(err)
    if (upd[i].kind !== byKey[upd[i].kind + "|" + upd[i].id].kind) return errorResponse("ubah[" + i + "]: jenis tidak bisa diubah")
  }
  for (let i = 0; i < del.length; i++) {
    const err = cekMilik(del[i], "hapus[" + i + "]")
    if (err) return errorResponse(err)
  }
  for (let i = 0; i < add.length; i++) {
    const err = cekIsi(add[i], "tambah[" + i + "]")
    if (err) return errorResponse(err)
  }

  const sheets = { masuk: getMasukSheet(type), keluar: getKeluarSheet(type) }
  const b = cur.barang

  // 1. Ubah tanggal/qty (nomor baris belum bergeser).
  upd.forEach(function(o) {
    const x = byKey[o.kind + "|" + o.id]
    sheets[o.kind].getRange(x.rowIndex, 7, 1, 2).setValues([[o.tanggal, Number(o.qty)]])
    if (o.keterangan !== undefined) sheets[o.kind].getRange(x.rowIndex, 10).setValue(String(o.keterangan))
  })

  // 2. Tambah di akhir sheet. ID diberikan menurut urutan array — urutan yang
  //    sama dipakai pratinjau di browser untuk transaksi baru di hari yang sama.
  const idBaru = []
  ;["masuk", "keluar"].forEach(function(kind) {
    const items = add.filter(function(o) { return o.kind === kind })
    if (items.length === 0) return
    const ids = reserveIds(sheets[kind], kind === "masuk" ? "CR" : "DB", type, items.length)
    batchInsertRows(sheets[kind], items.map(function(o, i) {
      idBaru.push(ids[i])
      return [ids[i], idB, b.kode_barang, b.nama_barang, b.merk, b.satuan, o.tanggal, Number(o.qty), 0, String(o.keterangan || "")]
    }))
  })

  // 3. Hapus dari baris paling bawah supaya nomor baris di atasnya tetap benar.
  ;["masuk", "keluar"].forEach(function(kind) {
    del.filter(function(o) { return o.kind === kind })
      .map(function(o) { return byKey[kind + "|" + o.id].rowIndex })
      .sort(function(a, c) { return c - a })
      .forEach(function(row) { sheets[kind].deleteRow(row) })
  })

  // 4. Tulis ulang kolom I, snapshot, F, G.
  const hasil = tulisUlangSaldoBarang(type, idB, pembuka, b.rowIndex)
  clearBarangCache(type)
  resetMemo()
  bumpStokGenAll()

  const first = cur.tx[0]
  const pembukaLama = first ? first.saldo - effectOf(first.kind, first.qty) : b.sisa_saldo
  const ringkas = []
  if (Math.abs(pembukaLama - pembuka) > EPS) ringkas.push("pembuka " + pembukaLama + " → " + pembuka)
  if (upd.length) ringkas.push(upd.length + " diubah")
  if (add.length) ringkas.push(add.length + " ditambah")
  if (del.length) ringkas.push(del.length + " dihapus")
  ringkas.push(hasil.iBerubah + " saldo transaksi ditulis ulang")
  if (hasil.snapshotBerubah) ringkas.push(hasil.snapshotBerubah + " snapshot")
  if (Math.abs(hasil.Glama - hasil.G) > EPS) ringkas.push("G " + hasil.Glama + " → " + hasil.G)
  hasil.idBaru = idBaru

  tulisLogGudang(data, "Simpan kartu stok", {
    type: type, id_barang: idB, nama: b.nama_barang, ringkasan: ringkas.join(" · "),
    detail: { pembukaLama: pembukaLama, pembuka: pembuka, ops: ops, idBaru: idBaru, hasil: hasil },
  })

  _te(t)
  return jsonResponse({ status: "success", data: hasil })
}

/**
 * Hitung ulang semua saldo turunan satu barang dari saldo pembuka:
 * kolom I tiap transaksi, Snapshot Saldo yang sudah ada, serta kolom F dan G.
 */
function tulisUlangSaldoBarang(type, idB, pembuka, barangRow) {
  const rowsBy = { masuk: readRows(getMasukSheet(type)), keluar: readRows(getKeluarSheet(type)) }
  const only   = {}
  only[idB] = true
  const led   = buildLedgers(rowsBy, only)[idB] || []
  const nowYm = currentYm()

  function openAt(ym) {
    let v = pembuka
    led.forEach(function(e) { if (Math.floor(e.pos[0] / 100) < ym) v += e.eff })
    return v
  }

  // 1. Kolom I
  const edits = { masuk: {}, keluar: {} }
  let s = pembuka, iBerubah = 0
  led.forEach(function(e) {
    s += e.eff
    if (Math.abs(e.saldo - s) > EPS) { edits[e.kind][e.rowIndex] = s; iBerubah++ }
  })
  const G = s
  ;["masuk", "keluar"].forEach(function(kind) {
    const idxs = Object.keys(edits[kind]).map(Number)
    if (idxs.length === 0) return
    const lo = Math.min.apply(null, idxs)
    const hi = Math.max.apply(null, idxs)
    const col = []
    for (let r = lo; r <= hi; r++) {
      col.push([edits[kind][r] !== undefined ? edits[kind][r] : rowsBy[kind][r - 2][8]])
    }
    const sheet = kind === "masuk" ? getMasukSheet(type) : getKeluarSheet(type)
    sheet.getRange(lo, 9, col.length, 1).setValues(col)
  })

  // 2. Snapshot Saldo — hanya baris yang sudah ada.
  let snapshotBerubah = 0
  if (SHEETS.snapshot) {
    const snapRows = readRows(SHEETS.snapshot)
    const colE = snapRows.map(function(r) {
      if (String(r[2]) === type && String(r[3]).trim() === idB) {
        const want = openAt(Number(r[0]) * 100 + Number(r[1]))
        if (Math.abs((Number(r[4]) || 0) - want) > EPS) { snapshotBerubah++; return [want] }
      }
      return [r[4]]
    })
    if (snapshotBerubah > 0) SHEETS.snapshot.getRange(2, 5, colE.length, 1).setValues(colE)
  }

  // 3. Master F (saldo awal bulan berjalan) dan G (sisa saldo)
  const bSheet = getBarangSheet(type)
  const lama   = bSheet.getRange(barangRow, 6, 1, 2).getValues()[0]
  const F      = openAt(nowYm)
  bSheet.getRange(barangRow, 6, 1, 2).setValues([[F, G]])

  return {
    iBerubah: iBerubah, snapshotBerubah: snapshotBerubah,
    F: F, G: G, Flama: Number(lama[0]) || 0, Glama: Number(lama[1]) || 0,
  }
}

// ── Snapshot, pemeliharaan, rollover ──

function gudangSnapshotStatus() {
  const totals = {}
  VALID_TYPES.forEach(function(t) {
    totals[t] = readRows(getBarangSheet(t)).filter(function(r) { return String(r[0]).trim() }).length
  })

  const counts = {}
  snapshotRowsAll().forEach(function(r) {
    const ym = Number(r[0]) * 100 + Number(r[1])
    if (!counts[ym]) counts[ym] = { atk: 0, rt: 0, obat: 0 }
    const t = String(r[2])
    if (counts[ym][t] !== undefined) counts[ym][t]++
  })

  const nowYm = currentYm()
  const yms   = Object.keys(counts).map(Number).filter(function(ym) { return ym < nowYm })
  const months = []
  if (yms.length > 0) {
    for (let ym = Math.min.apply(null, yms); ym < nowYm; ym = ymNext(ym)) {
      const c = counts[ym] || { atk: 0, rt: 0, obat: 0 }
      months.push({ ym: ym, atk: c.atk, rt: c.rt, obat: c.obat })
    }
  }
  months.reverse()
  return { months: months, totals: totals, nowYm: nowYm }
}

function gudangIsiSnapshot(data) {
  const ym = Number(data.ym)
  const y  = Math.floor(ym / 100), m = ym % 100
  if (!y || m < 1 || m > 12) return errorResponse("Bulan tidak valid.")
  if (ym >= currentYm()) return errorResponse("Snapshot bulan berjalan dibuat oleh rollover tanggal 1 bulan depan.")

  const n = fillSnapshotMonths([{ year: y, month: m }])[ym]
  if (n === null || n === undefined) {
    return errorResponse("Tidak ada snapshot sebelumnya (maks. 24 bulan ke belakang) yang bisa dijadikan acuan.")
  }
  tulisLogGudang(data, "Isi snapshot", { ringkasan: "Snapshot " + ymLabel(ym) + ": " + n + " baris ditambahkan" })
  return jsonResponse({ status: "success", data: { ym: ym, ditambah: n } })
}

function gudangRebuild(data) {
  const apply  = data.apply === true
  const report = rebuildSaldoCore(apply)
  if (apply) {
    VALID_TYPES.forEach(function(type) { clearBarangCache(type) })
    tulisLogGudang(data, "Hitung ulang semua saldo", { ringkasan: "Patokan G", detail: report })
  }
  return jsonResponse({ status: "success", data: report })
}

function gudangIdKembar(data) {
  const apply  = data.apply === true
  const report = repairDuplicateIdsCore(apply)
  if (apply && report.transaksi.length > 0) {
    tulisLogGudang(data, "Perbaiki ID kembar", {
      ringkasan: report.transaksi.map(function(x) { return x.sheet + ": " + x.baris.length }).join(", "),
      detail: report,
    })
  }
  return jsonResponse({ status: "success", data: report })
}

/**
 * Rollover manual, hanya untuk bulan yang rollover otomatisnya gagal. Penanda
 * "sudah jalan" adalah snapshot bulan lalu: rolloverCore menyimpannya lebih dulu.
 * Menjalankan ulang di tengah bulan akan menyalin G ke F dan merusak saldo awal.
 */
function gudangRollover(data) {
  const now  = new Date()
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const ym   = prev.getFullYear() * 100 + prev.getMonth() + 1
  if (Object.keys(buildSnapshotMap(prev.getFullYear(), prev.getMonth() + 1)).length > 0) {
    return errorResponse("Snapshot " + ymLabel(ym) + " sudah ada, berarti rollover bulan ini sudah jalan.", 409)
  }
  const r = rolloverCore()
  bumpStokGenAll()
  tulisLogGudang(data, "Rollover manual", { ringkasan: "Snapshot " + ymLabel(ym) + " dibuat, F = G" })
  return jsonResponse({ status: "success", data: r })
}

function gudangBersihkanCache() {
  VALID_TYPES.forEach(function(type) { clearBarangCache(type) })
  bumpStokGenAll()
  return jsonResponse({ status: "success" })
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

    // refresh=1 menembus semua cache dan membaca ulang dari spreadsheet.
    // Dipakai oleh tombol Refresh di seluruh halaman.
    const forceRefresh = e.parameter.refresh === "1"

    if (action === "ping")   return jsonResponse({ ok: true, ts: new Date().toISOString() })
    if (action === "barang") return handleGetBarang(type, forceRefresh)
    // Tanpa parameter type, keduanya mengembalikan ATK+RT+Obat sekaligus supaya
    // halaman cukup satu request, bukan tiga.
    if (action === "keluar") return handleGetTransaksi("keluar", type, month, year)
    if (action === "masuk")  return handleGetTransaksi("masuk",  type, month, year)
    // refresh=1 melewati cache dan menghitung ulang dari sheet — dipakai tombol
    // Refresh di halaman laporan stok.
    if (action === "stok")   return handleGetStok(month, year, forceRefresh)

    return errorResponse("unknown action: " + action)

  } catch (err) {
    Logger.log("[ERROR] doGet: " + err.message + "\n" + err.stack)
    return errorResponse("internal server error", 500)
  }
}

function handleGetBarang(type, forceRefresh) {
  // Master barang punya CacheService sendiri (TTL 300 detik). Tanpa membuangnya,
  // tombol Refresh hanya menyajikan ulang isi cache yang sama dan kolom
  // saldo_awal/sisa_saldo yang baru diedit di spreadsheet tidak akan terlihat.
  if (forceRefresh) {
    VALID_TYPES.forEach(function(t) { clearBarangCache(t) })
  }

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

    // Menu Gudang: diperiksa dengan GUDANG_SECRET dan mengambil lock sendiri.
    if (typeof action === "string" && action.indexOf("gudang") === 0) return handleGudang(data)

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
      // Lock ini global untuk seluruh pengguna, jadi penulisan selalu berurutan.
      // Satu penulisan makan 2–9 detik, sehingga 15 detik hanya menampung dua
      // antrean — terlalu sempit kalau beberapa orang menyimpan bersamaan.
      // 30 detik masih jauh di bawah batas eksekusi Apps Script (6 menit).
      lock.waitLock(30000)
    } catch (err) {
      // Pesan ini kini sampai ke layar pengguna, jadi ditulis dalam bahasa mereka.
      return errorResponse("Server sedang sibuk. Mohon simpan ulang sebentar lagi.", 503)
    }

    // Idempotensi hanya untuk "add*": itulah satu-satunya jalur yang menambah
    // baris baru, sehingga kiriman ganda benar-benar menggandakan data.
    // update bersifat idempoten sendiri (menyetel nilai absolut, pengulangan jadi
    // no-op) dan delete gagal aman di percobaan kedua karena id-nya sudah lenyap.
    const isAddAction = action.indexOf("add") === 0 && !isBarangAction
    const batchId = isAddAction && data.batchId ? String(data.batchId) : ""

    try {
      if (batchId) {
        const sebelumnya = getBatchResult(batchId)
        if (sebelumnya) {
          Logger.log("[BATCH] " + batchId + " sudah pernah diproses — tidak menulis ulang")
          return ContentService.createTextOutput(sebelumnya).setMimeType(ContentService.MimeType.JSON)
        }
      }

      markScriptWrite()
      const res = dispatch(action, type, sheet, data)

      if (batchId) {
        const content = res.getContent()
        let ok = false
        try { ok = JSON.parse(content).status !== "error" } catch (e) { ok = false }
        // Hanya hasil sukses yang diingat. Penolakan validasi tidak menulis apa
        // pun, jadi percobaan ulang setelah diperbaiki harus benar-benar jalan.
        if (ok) rememberBatchResult(batchId, action, type, content)
      }

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
      const from = isAddAction ? earliestMonthInPayload(data) : null
      if (from) bumpStokGenFrom(from.year, from.month)
      else bumpStokGenAll()

      return res
    } finally {
      // Paksa semua tulisan tertunda masuk ke sheet SEBELUM lock dilepas. Tanpa
      // ini request berikutnya bisa mulai saat baris terakhir belum terlihat,
      // lalu membaca getLastRow()/saldo yang basi.
      SpreadsheetApp.flush()
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

  const err = validateTransaksi(data)
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
  const newRow = sheet.getLastRow()

  getBarangSheet(type).getRange(entry.rowIndex, 7).setValue(sisaSaldo)

  // Tanggal bisa mundur: saldo baris ini dijangkar ke posisinya, dan transaksi
  // yang lebih baru ikut bergeser.
  cascadeSaldo(type, String(data.id_barang), [], [{
    kind: "keluar", rowIndex: newRow,
    pos: makePos("keluar", data.tanggal, id), eff: effectOf("keluar", qty),
  }], sisaSaldo)
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

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    const err  = validateTransaksi(item)
    if (err) return errorResponse("item[" + i + "]: " + err)

    const idB = String(item.id_barang)
    const qty = Number(item.qty)

    if (!(idB in runSaldo)) {
      const entry = barangMap[idB]
      if (!entry) return errorResponse("item[" + i + "]: id_barang tidak ditemukan: " + idB)
      runSaldo[idB] = entry.sisa_saldo
    }
    runSaldo[idB] -= qty

    newRows.push([
      null, item.id_barang, item.kode_barang, item.nama_barang,
      item.merk, item.satuan, item.tanggal, qty,
      runSaldo[idB], item.keterangan || "",
    ])
  }

  // ID dicadangkan setelah validasi lolos, supaya penolakan tidak membuang nomor.
  const ids = reserveIds(sheet, "DB", type, newRows.length)
  newRows.forEach(function(row, i) { row[0] = ids[i] })

  const firstRow = sheet.getLastRow() + 1
  batchInsertRows(sheet, newRows)

  const barangSheet = getBarangSheet(type)
  Object.keys(runSaldo).forEach(function(idB) {
    const entry = barangMap[idB]
    if (entry) barangSheet.getRange(entry.rowIndex, 7).setValue(runSaldo[idB])
  })

  // Item dengan tanggal mundur menggeser saldo transaksi yang lebih baru.
  const changes = {}
  newRows.forEach(function(row, i) {
    const idB = String(row[1])
    if (!changes[idB]) changes[idB] = { removed: [], added: [], saldoAkhir: runSaldo[idB] }
    changes[idB].added.push({
      kind: "keluar", rowIndex: firstRow + i,
      pos: makePos("keluar", row[6], row[0]), eff: effectOf("keluar", row[7]),
    })
  })
  cascadeSaldoMulti(type, changes)
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success", inserted: newRows.length })
}

function handleUpdate(type, sheet, data) {
  const t = _t("update")

  const err = validateFields(data, ["id"]) || validateTransaksi(data)
  if (err) return errorResponse(err)

  const keluarRows = readRows(sheet)
  const keluarMap  = buildTransaksiMap(keluarRows)
  const kEntry     = keluarMap[String(data.id)]
  if (!kEntry) return errorResponse("id keluar tidak ditemukan: " + data.id)
  if (kEntry.duplicate) return errorResponse(DUP_ID_MSG + data.id)

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

  // Koreksi qty/tanggal/barang pada transaksi lama: geser saldo semua transaksi
  // sesudahnya (kolom I), Snapshot Saldo, dan kolom F — bukan cuma baris ini.
  const oldTx = { pos: makePos("keluar", kEntry.tanggal, data.id), eff: effectOf("keluar", oldQty) }
  const newTx = {
    kind: "keluar", rowIndex: kEntry.rowIndex,
    pos: makePos("keluar", data.tanggal, data.id), eff: effectOf("keluar", newQty),
  }
  if (sameBarang) {
    cascadeSaldo(type, newIdBarang, [oldTx], [newTx], newSaldo)
  } else {
    cascadeSaldo(type, oldIdBarang, [oldTx], [], 0)
    cascadeSaldo(type, newIdBarang, [], [newTx], newSaldo)
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
  if (kEntry.duplicate) return errorResponse(DUP_ID_MSG + data.id)

  sheet.deleteRow(kEntry.rowIndex)

  const barangRows = readRows(getBarangSheet(type))
  const barangMap  = buildBarangMap(barangRows)
  const bEntry     = barangMap[kEntry.id_barang]
  if (bEntry) {
    getBarangSheet(type).getRange(bEntry.rowIndex, 7).setValue(bEntry.sisa_saldo + kEntry.qty)
    cascadeSaldo(type, kEntry.id_barang, [{
      pos: makePos("keluar", kEntry.tanggal, data.id), eff: effectOf("keluar", kEntry.qty),
    }], [], 0)
    clearBarangCache(type)
  }

  _te(t)
  return jsonResponse({ status: "success" })
}

// ── Masuk Handlers ────────────────────────────────────────────────────────────

function handleAddMasuk(type, sheet, data) {
  const t = _t("addMasuk")

  const err = validateTransaksi(data)
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
  const newRow = sheet.getLastRow()

  getBarangSheet(type).getRange(entry.rowIndex, 7).setValue(sisaSaldo)

  cascadeSaldo(type, String(data.id_barang), [], [{
    kind: "masuk", rowIndex: newRow,
    pos: makePos("masuk", data.tanggal, id), eff: effectOf("masuk", qty),
  }], sisaSaldo)
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

  for (let i = 0; i < data.items.length; i++) {
    const item = data.items[i]
    const err  = validateTransaksi(item)
    if (err) return errorResponse("item[" + i + "]: " + err)

    const idB = String(item.id_barang)
    const qty = Number(item.qty)

    if (!(idB in runSaldo)) {
      const entry = barangMap[idB]
      if (!entry) return errorResponse("item[" + i + "]: id_barang tidak ditemukan: " + idB)
      runSaldo[idB] = entry.sisa_saldo
    }
    runSaldo[idB] += qty

    newRows.push([
      null, item.id_barang, item.kode_barang, item.nama_barang,
      item.merk, item.satuan, item.tanggal, qty,
      runSaldo[idB], item.keterangan || "",
    ])
  }

  const ids = reserveIds(sheet, "CR", type, newRows.length)
  newRows.forEach(function(row, i) { row[0] = ids[i] })

  const firstRow = sheet.getLastRow() + 1
  batchInsertRows(sheet, newRows)

  const barangSheet = getBarangSheet(type)
  Object.keys(runSaldo).forEach(function(idB) {
    const entry = barangMap[idB]
    if (entry) barangSheet.getRange(entry.rowIndex, 7).setValue(runSaldo[idB])
  })

  const changes = {}
  newRows.forEach(function(row, i) {
    const idB = String(row[1])
    if (!changes[idB]) changes[idB] = { removed: [], added: [], saldoAkhir: runSaldo[idB] }
    changes[idB].added.push({
      kind: "masuk", rowIndex: firstRow + i,
      pos: makePos("masuk", row[6], row[0]), eff: effectOf("masuk", row[7]),
    })
  })
  cascadeSaldoMulti(type, changes)
  clearBarangCache(type)

  _te(t)
  return jsonResponse({ status: "success", inserted: newRows.length })
}

function handleUpdateMasuk(type, sheet, data) {
  const t = _t("updateMasuk")

  const err = validateFields(data, ["id"]) || validateTransaksi(data)
  if (err) return errorResponse(err)

  const masukRows  = readRows(sheet)
  const masukMap   = buildTransaksiMap(masukRows)
  const kEntry     = masukMap[String(data.id)]
  if (!kEntry) return errorResponse("id masuk tidak ditemukan: " + data.id)
  if (kEntry.duplicate) return errorResponse(DUP_ID_MSG + data.id)

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

  const oldTx = { pos: makePos("masuk", kEntry.tanggal, data.id), eff: effectOf("masuk", oldQty) }
  const newTx = {
    kind: "masuk", rowIndex: kEntry.rowIndex,
    pos: makePos("masuk", data.tanggal, data.id), eff: effectOf("masuk", newQty),
  }
  if (sameBarang) {
    cascadeSaldo(type, newIdBarang, [oldTx], [newTx], newSaldo)
  } else {
    cascadeSaldo(type, oldIdBarang, [oldTx], [], 0)
    cascadeSaldo(type, newIdBarang, [], [newTx], newSaldo)
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
  if (kEntry.duplicate) return errorResponse(DUP_ID_MSG + data.id)

  sheet.deleteRow(kEntry.rowIndex)

  const barangRows = readRows(getBarangSheet(type))
  const barangMap  = buildBarangMap(barangRows)
  const bEntry     = barangMap[kEntry.id_barang]
  if (bEntry) {
    getBarangSheet(type).getRange(bEntry.rowIndex, 7).setValue(bEntry.sisa_saldo - kEntry.qty)
    cascadeSaldo(type, kEntry.id_barang, [{
      pos: makePos("masuk", kEntry.tanggal, data.id), eff: effectOf("masuk", kEntry.qty),
    }], [], 0)
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
  const saldoAwal = Number(data.saldo_awal)
  if (!isFinite(saldoAwal) || saldoAwal < 0) return errorResponse("saldo_awal harus angka 0 atau lebih")
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

/**
 * Update master barang (v3.7).
 *
 * Kode, nama, merk, dan satuan disimpan apa adanya. Saldo TIDAK bisa diubah dari
 * sini untuk barang yang sudah punya transaksi: mengubah sisa_saldo tanpa
 * transaksi berarti stok berubah tanpa jejak, dan transaksi berikutnya dihitung
 * dari G yang baru — rantai saldo loncat. Koreksi stok dilakukan lewat menu
 * Gudang → Kartu Stok, yang mencatatnya sebagai transaksi penyesuaian + log.
 *
 * Barang yang belum punya transaksi sama sekali boleh diganti saldo_awal-nya
 * (salah ketik saat membuat barang); F, G, dan snapshotnya ikut disamakan.
 * sisa_saldo dari payload selalu diabaikan.
 */
const SALDO_TERKUNCI_MSG = "Saldo barang ini tidak bisa diubah dari Master Barang karena sudah punya transaksi. " +
  "Koreksi stok lewat menu Gudang → Kartu Stok."

function barangPunyaTransaksi(type, idB) {
  return [getMasukSheet(type), getKeluarSheet(type)].some(function(sheet) {
    const last = sheet ? sheet.getLastRow() : 0
    if (last < 2) return false
    // Hanya kolom B (id_barang) yang dibaca.
    return sheet.getRange(2, 2, last - 1, 1).getValues().some(function(r) { return String(r[0]).trim() === idB })
  })
}

function handleUpdateBarang(type, data) {
  const t = _t("updateBarang")

  const err = validateFields(data, ["id", "kode_barang", "nama_barang", "merk", "satuan"])
  if (err) return errorResponse(err)

  const bSheet    = getBarangSheet(type)
  const barangMap = buildBarangMap(readRows(bSheet))
  const idB       = String(data.id).trim()
  const entry     = barangMap[idB]
  if (!entry) return errorResponse("id barang tidak ditemukan: " + data.id)

  const adaSaldo = data.saldo_awal !== undefined && data.saldo_awal !== null && String(data.saldo_awal).trim() !== ""
  const saldoBaru = Number(data.saldo_awal)
  if (adaSaldo && (!isFinite(saldoBaru) || saldoBaru < 0)) return errorResponse("saldo_awal harus angka 0 atau lebih")
  const ubahSaldo = adaSaldo && Math.abs(saldoBaru - entry.saldo_awal) > 1e-9
  if (ubahSaldo && barangPunyaTransaksi(type, idB)) return errorResponse(SALDO_TERKUNCI_MSG, 409)

  bSheet.getRange(entry.rowIndex, 2, 1, 4).setValues([[
    data.kode_barang,
    data.nama_barang,
    data.merk,
    data.satuan,
  ]])
  // Tanpa transaksi, saldo pembuka = saldo awal = sisa saldo = semua snapshotnya.
  if (ubahSaldo) tulisUlangSaldoBarang(type, idB, saldoBaru, entry.rowIndex)
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

  rolloverCore()
  return true
}

/**
 * Isi rollover tanpa pemeriksaan secret. Pemanggil bertanggung jawab atas
 * otorisasi (rolloverSaldo: ROLLOVER_SECRET; menu Gudang: GUDANG_SECRET + lock).
 * @returns {{ snapYear: number, snapMonth: number }}
 */
function rolloverCore() {
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
  return { snapYear: snapYear, snapMonth: snapMonth }
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
  fillSnapshotMonths(FILL_MONTHS)
}

/**
 * Isi snapshot bulan-bulan yang diminta dari snapshot terdekat sebelumnya +
 * transaksi di antaranya. Baris yang sudah ada tidak ditimpa.
 * @returns {Object} { "YYYYMM": jumlah baris ditambahkan | null jika tidak ada snapshot acuan }
 */
function fillSnapshotMonths(FILL_MONTHS) {
  const hasil = {}
  const snapshotSheet = SHEETS.snapshot
  if (!snapshotSheet) {
    Logger.log("[ERROR] Sheet 'Snapshot Saldo' tidak ditemukan.")
    return hasil
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
      hasil[year * 100 + month] = null
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
    hasil[year * 100 + month] = newRows.length
  })

  Logger.log("[FILL] Selesai semua.")
  return hasil
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