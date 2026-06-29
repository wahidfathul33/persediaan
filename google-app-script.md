/**
 * ============================================================
 *  INVENTORY MANAGEMENT — Google Apps Script
 *  Production-ready | v3.1
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
function readRows(sheet) {
  if (!sheet) return []
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  const lastCol = sheet.getLastColumn()
  if (lastCol < 1) return []
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues()
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
    Logger.log("[SNAPSHOT] Saved " + newRows.length + " rows for " + year + "-" + month)
  } else {
    Logger.log("[SNAPSHOT] No new rows for " + year + "-" + month + " (already exists or empty)")
  }
}

/**
 * Build snapshot map for a given (year, month).
 * Key: "type|id_barang"  Value: saldo_awal
 */
function buildSnapshotMap(year, month) {
  const snapshotSheet = SHEETS.snapshot
  if (!snapshotSheet) return {}

  const rows = readRows(snapshotSheet)
  const map  = {}
  rows.forEach(function(r) {
    if (Number(r[0]) === year && Number(r[1]) === month) {
      const key = String(r[2]) + "|" + String(r[3])
      map[key]  = Number(r[4]) || 0
    }
  })
  return map
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

  VALID_TYPES.forEach(function(type) {
    readRows(getMasukSheet(type)).forEach(function(r) {
      if (!inRange(r[6])) return
      addEntry(type, String(r[1]).trim(), "masuk", Number(r[7]) || 0)
    })
    readRows(getKeluarSheet(type)).forEach(function(r) {
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
    if (action === "keluar") return handleGetKeluar(type, month, year)
    if (action === "masuk")  return handleGetMasuk(type, month, year)
    if (action === "stok")   return handleGetStok(month, year)

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

function handleGetKeluar(type, month, year) {
  if (!isValidType(type)) return errorResponse("invalid type: " + type)
  const sheet = getKeluarSheet(type)
  if (!sheet) return errorResponse("sheet not found for type: " + type)

  let rows = readRows(sheet)

  if (month && year) {
    const m = Number(month)
    const y = Number(year)
    if (isNaN(m) || isNaN(y) || m < 1 || m > 12) return errorResponse("invalid month/year")
    rows = rows.filter(function(r) {
      const d = new Date(r[6])
      return d.getMonth() + 1 === m && d.getFullYear() === y
    })
  }

  return jsonResponse(rows)
}

function handleGetMasuk(type, month, year) {
  if (!isValidType(type)) return errorResponse("invalid type: " + type)
  const sheet = getMasukSheet(type)
  if (!sheet) return errorResponse("sheet not found for type: " + type)

  let rows = readRows(sheet)

  if (month && year) {
    const m = Number(month)
    const y = Number(year)
    if (isNaN(m) || isNaN(y) || m < 1 || m > 12) return errorResponse("invalid month/year")
    rows = rows.filter(function(r) {
      const d = new Date(r[6])
      return d.getMonth() + 1 === m && d.getFullYear() === y
    })
  }

  return jsonResponse(rows)
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
      return jsonResponse({ status: rolloverSaldo(data.cronSecret) ? "success" : "unauthorized" })
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
      return dispatch(action, type, sheet, data)
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
function handleGetStok(month, year) {
  const t = _t("getStok")

  if (!month || !year) return errorResponse("month dan year wajib diisi")

  month = Number(month)
  year  = Number(year)

  if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
    return errorResponse("invalid month/year")
  }

  const now            = new Date()
  const isCurrentMonth = month === (now.getMonth() + 1) && year === now.getFullYear()
  const nextMonth      = month === 12 ? 1 : month + 1
  const nextYear       = month === 12 ? year + 1 : year
  const daysInMonth    = new Date(year, month, 0).getDate()

  // ── 1. Read all barang ──────────────────────────────────────────────────────
  const barangData = []
  VALID_TYPES.forEach(function(type) {
    readRows(getBarangSheet(type)).forEach(function(r) {
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
    readRows(getKeluarSheet(type)).forEach(function(r) {
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
    readRows(getMasukSheet(type)).forEach(function(r) {
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

  _te(t)
  return jsonResponse(result)
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