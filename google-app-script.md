/**
 * ============================================================
 *  INVENTORY MANAGEMENT — Google Apps Script
 *  Production-ready | v2.0
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
 *    Snapshot Saldo                        ← BARU (buat manual, header di baris 1)
 *
 *  Kolom Sheet Barang  : A=id  B=kode_barang  C=nama_barang  D=merk  E=satuan  F=saldo_awal  G=sisa_saldo
 *  Kolom Sheet Keluar  : A=id  B=id_barang    C=kode_barang  D=nama  E=merk    F=satuan      G=tanggal  H=qty  I=sisa_saldo  J=keterangan
 *  Kolom Sheet Masuk   : (sama dengan Keluar)
 *  Kolom Snapshot Saldo: A=tahun  B=bulan  C=type  D=id_barang  E=saldo_awal
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
const VALID_ACTIONS_GET  = ["ping", "barang", "keluar", "masuk", "stok"]
const VALID_ACTIONS_POST = [
  "add", "addBatch",
  "addMasuk", "addMasukBatch",
  "update", "delete",
  "updateMasuk", "deleteMasuk",
  "addBarang", "updateBarang", "deleteBarang",
  "rollover",
]

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate type parameter.
 * @param {string} type
 * @returns {boolean}
 */
function isValidType(type) {
  return VALID_TYPES.indexOf(type) !== -1
}

/**
 * Validate required fields exist and are non-empty on a data object.
 * Returns null if ok, or an error message string.
 * @param {Object} data
 * @param {string[]} fields
 * @returns {string|null}
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
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {any[][]}
 */
function readRows(sheet) {
  const lastRow = sheet.getLastRow()
  if (lastRow < 2) return []
  return sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues()
}

/**
 * Build O(1) lookup map from barang rows.
 * Key: id_barang (string)
 * Value: { rowIndex, saldo_awal, sisa_saldo }
 * @param {any[][]} rows
 * @returns {Object}
 */
function buildBarangMap(rows) {
  const map = {}
  for (let i = 0; i < rows.length; i++) {
    const id = String(rows[i][0]).trim()
    if (!id) continue
    map[id] = {
      rowIndex:   i + 2,            // 1-based + header offset
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
 * @param {any[][]} rows
 * @returns {Object}
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

function _cacheKey(type) { return "barang_v2_" + type }

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

/** Must be called after every mutation to prevent stale reads. */
function clearBarangCache(type) {
  try {
    CacheService.getScriptCache().remove(_cacheKey(type))
  } catch (e) { /* fail silently */ }
}

/** Cache-aside: read from cache, fall back to sheet. */
function getBarangRows(type) {
  const cached = getBarangCached(type)
  if (cached) return cached
  const rows = readRows(getBarangSheet(type))
  setBarangCache(type, rows)
  return rows
}

// ── Snapshot Saldo ────────────────────────────────────────────────────────────

/**
 * Save saldo_awal snapshot for all barang before rollover overwrites it.
 * Called internally by rolloverSaldo BEFORE updating col F.
 *
 * Sheet "Snapshot Saldo" columns:
 *   A=tahun  B=bulan  C=type  D=id_barang  E=saldo_awal
 *
 * If a snapshot for (year, month, type, id_barang) already exists,
 * it will NOT be overwritten (rollover is idempotent).
 */
function saveSnapshot(year, month) {
  const snapshotSheet = SHEETS.snapshot
  if (!snapshotSheet) {
    Logger.log("[WARN] Sheet 'Snapshot Saldo' tidak ditemukan, snapshot dilewati.")
    return
  }

  // Read existing snapshots to avoid duplicates
  const existingRows  = readRows(snapshotSheet)
  const existingKeys  = {}
  existingRows.forEach(function(r) {
    const key = [r[0], r[1], r[2], r[3]].join("|")
    existingKeys[key] = true
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
  }
}

/**
 * Lookup saldo_awal for a specific (year, month, type, id_barang) from snapshot.
 * Returns null if not found.
 * @param {Object} snapshotMap — built by buildSnapshotMap()
 * @param {string} type
 * @param {string} id_barang
 * @returns {number|null}
 */
function lookupSnapshot(snapshotMap, type, id_barang) {
  const key = type + "|" + id_barang
  return (snapshotMap && snapshotMap[key] !== undefined) ? snapshotMap[key] : null
}

/**
 * Build snapshot map for a given (year, month).
 * Key: "type|id_barang"  Value: saldo_awal
 * @param {number} year
 * @param {number} month
 * @returns {Object}
 */
function buildSnapshotMap(year, month) {
  const snapshotSheet = SHEETS.snapshot
  if (!snapshotSheet) return {}

  const rows = readRows(snapshotSheet)
  const map  = {}
  rows.forEach(function(r) {
    if (Number(r[0]) === year && Number(r[1]) === month) {
      const key  = String(r[2]) + "|" + String(r[3])
      map[key]   = Number(r[4]) || 0
    }
  })
  return map
}

// ── Write Helpers ─────────────────────────────────────────────────────────────

/**
 * Batch insert N rows with a single setValues() call.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {any[][]} rows
 */
function batchInsertRows(sheet, rows) {
  if (!rows || rows.length === 0) return
  const startRow = sheet.getLastRow() + 1
  sheet.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows)
}

/**
 * Generate next ID for a sheet.
 * Format: PREFIX-TYPELABEL-NNNN  (e.g. DB-ATK-0012)
 * Uses lastRow as counter (assumes no gaps; safe under LockService).
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string} prefix   "DB" | "CR" | "BR"
 * @param {string} type     "atk" | "rt" | "obat"
 * @returns {string}
 */
function generateId(sheet, prefix, type) {
  const lastRow = sheet.getLastRow()   // includes header
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
    // No type → return all grouped (initial page load)
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

    // Rollover tidak butuh lock
    if (action === "rollover") {
      return jsonResponse({ status: rolloverSaldo(data.cronSecret) ? "success" : "unauthorized" })
    }

    if (!action || VALID_ACTIONS_POST.indexOf(action) === -1) {
      return errorResponse("unknown action: " + action)
    }

    // Semua action selain rollover butuh type
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

    // LockService: prevent race conditions on concurrent stok updates
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

/**
 * Dispatch to the correct handler based on action.
 */
function dispatch(action, type, sheet, data) {
  switch (action) {

    // ── Keluar ──────────────────────────────────────────────────────────────
    case "add":       return handleAdd(type, sheet, data)
    case "addBatch":  return handleAddBatch(type, sheet, data)
    case "update":    return handleUpdate(type, sheet, data)
    case "delete":    return handleDelete(type, sheet, data)

    // ── Masuk ───────────────────────────────────────────────────────────────
    case "addMasuk":      return handleAddMasuk(type, sheet, data)
    case "addMasukBatch": return handleAddMasukBatch(type, sheet, data)
    case "updateMasuk":   return handleUpdateMasuk(type, sheet, data)
    case "deleteMasuk":   return handleDeleteMasuk(type, sheet, data)

    // ── Barang ──────────────────────────────────────────────────────────────
    case "addBarang":    return handleAddBarang(type, data)
    case "updateBarang": return handleUpdateBarang(type, data)
    case "deleteBarang": return handleDeleteBarang(type, data)

    default:
      return errorResponse("unhandled action: " + action)
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

  const oldIdBarang  = kEntry.id_barang
  const oldQty       = kEntry.qty
  const newQty       = Number(data.qty)
  const newIdBarang  = String(data.id_barang)
  const sameBarang   = oldIdBarang === newIdBarang

  const barangRows   = readRows(getBarangSheet(type))
  const barangMap    = buildBarangMap(barangRows)
  const barangSheet  = getBarangSheet(type)
  const newEntry     = barangMap[newIdBarang]

  if (!newEntry) return errorResponse("id_barang baru tidak ditemukan: " + newIdBarang)

  // Calculate new sisa_saldo for the target barang
  const newSaldo = sameBarang
    ? newEntry.sisa_saldo - (newQty - oldQty)   // same barang: apply delta
    : newEntry.sisa_saldo - newQty               // different barang: deduct full

  // Update keluar row first (set sisa_saldo col to 0, will be recalculated via newSaldo)
  sheet.getRange(kEntry.rowIndex, 1, 1, 10).setValues([[
    data.id, data.id_barang, data.kode_barang, data.nama_barang,
    data.merk, data.satuan, data.tanggal, newQty, newSaldo, data.keterangan || "",
  ]])

  // Update barang saldo for new (or same) barang
  barangSheet.getRange(newEntry.rowIndex, 7).setValue(newSaldo)

  // Restore saldo for old barang if barang changed
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

  // Restore saldo += qty
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
    ? newEntry.sisa_saldo + (newQty - oldQty)   // same barang: apply delta
    : newEntry.sisa_saldo + newQty               // different barang: add full

  sheet.getRange(kEntry.rowIndex, 1, 1, 10).setValues([[
    data.id, data.id_barang, data.kode_barang, data.nama_barang,
    data.merk, data.satuan, data.tanggal, newQty, newSaldo, data.keterangan || "",
  ]])

  barangSheet.getRange(newEntry.rowIndex, 7).setValue(newSaldo)

  // Remove old barang addition if barang changed
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

  // Restore saldo -= qty
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

  const bSheet     = getBarangSheet(type)
  const saldoAwal  = Number(data.saldo_awal) || 0
  const id         = generateId(bSheet, "BR", type)

  bSheet.appendRow([
    id,
    data.kode_barang,
    data.nama_barang,
    data.merk,
    data.satuan,
    saldoAwal,
    saldoAwal,   // sisa_saldo starts equal to saldo_awal
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
  const newSisaSaldo = entry.sisa_saldo + delta   // maintain relative stok position

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
 * Rollover: save snapshot THEN copy sisa_saldo → saldo_awal for next month.
 * Called by Vercel Cron on the 1st of each month via POST { action: "rollover", cronSecret: "..." }
 *
 * The snapshot saves the CURRENT saldo_awal (i.e. the month that just ended)
 * so getStok() can reconstruct historical reports accurately.
 *
 * @param {string} secret
 * @returns {boolean} true if authorized and executed
 */
function rolloverSaldo(secret) {
  const ROLLOVER_SECRET = PropertiesService.getScriptProperties().getProperty("ROLLOVER_SECRET")
  if (!ROLLOVER_SECRET || secret !== ROLLOVER_SECRET) {
    Logger.log("[WARN] rolloverSaldo: unauthorized attempt")
    return false
  }

  const t = _t("rollover")

  // Determine the month that just ended (previous month from now)
  const now      = new Date()
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const snapYear = prevDate.getFullYear()
  const snapMonth= prevDate.getMonth() + 1

  // 1. Save snapshot of saldo_awal for the month that just ended (idempotent)
  saveSnapshot(snapYear, snapMonth)

  // 2. Copy sisa_saldo → saldo_awal (open new month)
  VALID_TYPES.forEach(function(type) {
    const sheet   = SHEETS.barang[type]
    const rows    = readRows(sheet)
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
 * saldo_awal logic (fixed):
 *   1. Try snapshot for (year, month) — populated by rollover at month-end.
 *   2. If snapshot not found (current month / snapshot not yet run),
 *      fall back to current saldo_awal in master sheet.
 *
 * sisa_saldo = saldo_awal + total_masuk_bulan_ini - total_keluar_bulan_ini
 *
 * This ensures historical reports are stable after rollover.
 */
function handleGetStok(month, year) {
  const t = _t("getStok")

  if (!month || !year) return errorResponse("month dan year wajib diisi")

  month = Number(month)
  year  = Number(year)

  if (isNaN(month) || isNaN(year) || month < 1 || month > 12) {
    return errorResponse("invalid month/year")
  }

  const daysInMonth = new Date(year, month, 0).getDate()

  // 1. Read all barang (all types)
  const barangData = []   // [ { type, row } ]
  VALID_TYPES.forEach(function(type) {
    readRows(getBarangSheet(type)).forEach(function(r) {
      barangData.push({ type: type, row: r })
    })
  })

  // 2. Build snapshot map for requested month (for historical saldo_awal)
  const snapshotMap = buildSnapshotMap(year, month)

  // 3. Aggregate keluar per barang per day for the requested month
  const keluarByBarang = {}   // { id_barang: { day: totalQty } }
  VALID_TYPES.forEach(function(type) {
    readRows(getKeluarSheet(type)).forEach(function(r) {
      const d = new Date(r[6])
      if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
      const idB = String(r[1])
      const day = d.getDate()
      if (!keluarByBarang[idB]) keluarByBarang[idB] = {}
      keluarByBarang[idB][day] = (keluarByBarang[idB][day] || 0) + (Number(r[7]) || 0)
    })
  })

  // 4. Aggregate masuk per barang per day for the requested month
  const masukByBarang = {}    // { id_barang: { day: totalQty } }
  VALID_TYPES.forEach(function(type) {
    readRows(getMasukSheet(type)).forEach(function(r) {
      const d = new Date(r[6])
      if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
      const idB = String(r[1])
      const day = d.getDate()
      if (!masukByBarang[idB]) masukByBarang[idB] = {}
      masukByBarang[idB][day] = (masukByBarang[idB][day] || 0) + (Number(r[7]) || 0)
    })
  })

  // 5. Build result
  const result = barangData.map(function(item) {
    const type       = item.type
    const r          = item.row
    const id_barang  = String(r[0])

    // saldo_awal: prefer snapshot, fall back to master sheet col F
    const snapshotVal = lookupSnapshot(snapshotMap, type, id_barang)
    const saldo_awal  = snapshotVal !== null ? snapshotVal : (Number(r[5]) || 0)

    // keluar per day array [day1, day2, ..., dayN]
    const keluarDayMap        = keluarByBarang[id_barang] || {}
    const masukDayMap         = masukByBarang[id_barang]  || {}
    const keluar_per_tanggal  = []
    const masuk_per_tanggal   = []

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

    const sisa_saldo = saldo_awal + total_masuk - total_keluar

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
      saldo_awal_from_snapshot: snapshotVal !== null,
    }
  })

  _te(t)
  return jsonResponse(result)
}