// SETUP ROLLOVER_SECRET:
// Di Google Apps Script, buka menu: Extensions → Apps Script → Project Settings → Script Properties
// Tambahkan property: ROLLOVER_SECRET = <nilai secret yang sama dengan env ROLLOVER_SECRET di Vercel>

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
}

const PREFIX = { atk: "ATK", rt: "RT", obat: "OBT" }

// ── Data Access ───────────────────────────────────────────────────────────────

function getBarangSheet(type) { return SHEETS.barang[type] || null }
function getKeluarSheet(type) { return SHEETS.keluar[type] || null }

/** Read all data rows skipping header. 1x Spreadsheet API call. */
function readRows(sheet) {
  const data = sheet.getDataRange().getValues()
  data.shift()
  return data
}

/**
 * Build O(1) lookup map from barang rows.
 * { id_barang -> { rowIndex (sheet row, 1-based), saldo_awal, sisa_saldo } }
 */
function buildBarangMap(rows) {
  const map = {}
  for (let i = 0; i < rows.length; i++) {
    map[String(rows[i][0])] = {
      rowIndex:   i + 2,           // +1 header offset, +1 because 1-based
      saldo_awal: Number(rows[i][5]),
      sisa_saldo: Number(rows[i][6]),
    }
  }
  return map
}

/**
 * Build O(1) lookup map from keluar rows.
 * { id_keluar -> { rowIndex, id_barang, qty } }
 */
function buildKeluarMap(rows) {
  const map = {}
  for (let i = 0; i < rows.length; i++) {
    map[String(rows[i][0])] = {
      rowIndex:  i + 2,
      id_barang: String(rows[i][1]),
      qty:       Number(rows[i][7]),
    }
  }
  return map
}

// ── CacheService (TTL 300s) ───────────────────────────────────────────────────

const CACHE_TTL = 300

function _cacheKey(type) { return "barang_" + type }

function getBarangCached(type) {
  try {
    const raw = CacheService.getScriptCache().get(_cacheKey(type))
    return raw ? JSON.parse(raw) : null
  } catch (e) { return null }
}

function setBarangCache(type, rows) {
  try {
    CacheService.getScriptCache().put(_cacheKey(type), JSON.stringify(rows), CACHE_TTL)
  } catch (e) { /* fail silently — cache is optional */ }
}

/** Must be called after every mutation to avoid stale reads. */
function clearBarangCache(type) {
  CacheService.getScriptCache().remove(_cacheKey(type))
}

/** Cache-aside: read from cache or fall back to sheet. */
function getBarangRows(type) {
  const cached = getBarangCached(type)
  if (cached) return cached
  const rows = readRows(getBarangSheet(type))
  setBarangCache(type, rows)
  return rows
}

// ── Write Helpers ─────────────────────────────────────────────────────────────

/**
 * Batch insert N rows with a SINGLE setValues() call.
 * Replaces N separate appendRow() calls → drastically faster for large batches.
 */
function batchInsertRows(sheet, rows) {
  if (!rows || rows.length === 0) return
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows)
}

// ── Lightweight Performance Logger ───────────────────────────────────────────

function _t(label) { return { label: label, start: Date.now() } }
function _te(t)    { Logger.log("[PERF] " + t.label + ": " + (Date.now() - t.start) + "ms") }

// ── Response Helper ───────────────────────────────────────────────────────────

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}

// ── doGet ─────────────────────────────────────────────────────────────────────

function doGet(e) {
  const action = e.parameter.action
  const type   = e.parameter.type
  const month  = e.parameter.month
  const year   = e.parameter.year

  if (action == "ping")   return jsonResponse({ ok: true })
  if (action == "barang") return getBarang(type)
  if (action == "keluar") return getKeluar(type, month, year)
  if (action == "stok")   return getStok(month, year)

  return jsonResponse({ error: "unknown action" })
}

function getBarang(type) {
  // No type → return all grouped (used on initial page load)
  if (!type || !SHEETS.barang[type]) {
    const grouped = {}
    Object.keys(SHEETS.barang).forEach(function(t) { grouped[t] = getBarangRows(t) })
    return jsonResponse(grouped)
  }
  return jsonResponse(getBarangRows(type))
}

function getKeluar(type, month, year) {
  const sheet = getKeluarSheet(type)
  if (!sheet) return jsonResponse({ error: "invalid type" })

  let rows = readRows(sheet)

  if (month && year) {
    const m = Number(month)
    const y = Number(year)
    rows = rows.filter(function(r) {
      const d = new Date(r[6])
      return d.getMonth() + 1 === m && d.getFullYear() === y
    })
  }

  return jsonResponse(rows)
}

// ── Rollover Saldo Awal (via Vercel Cron tiap tanggal 1) ─────────────────────

function rolloverSaldo(secret) {
  const ROLLOVER_SECRET = PropertiesService.getScriptProperties().getProperty('ROLLOVER_SECRET')
  if (!ROLLOVER_SECRET || secret !== ROLLOVER_SECRET) return false

  Object.keys(SHEETS.barang).forEach(function(type) {
    const sheet   = SHEETS.barang[type]
    const rows    = readRows(sheet)
    // Batch: copy sisa_saldo (col G / idx 6) → saldo_awal (col F / idx 5)
    const updates = rows.map(function(r) { return [Number(r[6])] })
    if (updates.length > 0) sheet.getRange(2, 6, updates.length, 1).setValues(updates)
    clearBarangCache(type)
  })

  return true
}

// ── doPost ────────────────────────────────────────────────────────────────────

function doPost(e) {
  const data   = JSON.parse(e.postData.contents)
  const action = data.action
  const type   = data.type

  if (action == "rollover") {
    return jsonResponse({ status: rolloverSaldo(data.cronSecret) ? "success" : "unauthorized" })
  }

  const sheet  = getKeluarSheet(type)
  const prefix = PREFIX[type] || "DB"

  // LockService: prevent race conditions on concurrent stok updates
  const lock = LockService.getScriptLock()
  try {
    lock.waitLock(10000)
  } catch (err) {
    return jsonResponse({ status: "error", message: "lock timeout" })
  }

  try {

    // ── ADD ────────────────────────────────────────────────────────────────
    if (action == "add") {
      const t = _t("add")

      const lastRow    = sheet.getLastRow()
      const id         = prefix + "-" + String(lastRow).padStart(4, "0")
      const barangRows = readRows(getBarangSheet(type))       // 1x read
      const barangMap  = buildBarangMap(barangRows)           // O(1) map
      const entry      = barangMap[String(data.id_barang)]
      const sisaSaldo  = (entry ? entry.sisa_saldo : 0) - Number(data.qty)

      sheet.appendRow([
        id, data.id_barang, data.kode_barang, data.nama_barang,
        data.merk, data.satuan, data.tanggal, Number(data.qty),
        sisaSaldo, data.keterangan
      ])

      // Incremental update: saldo -= qty (no full keluar scan)
      if (entry) {
        getBarangSheet(type).getRange(entry.rowIndex, 7).setValue(sisaSaldo)
        clearBarangCache(type)
      }

      _te(t)
    }

    // ── ADD BATCH ──────────────────────────────────────────────────────────
    if (action == "addBatch") {
      const t = _t("addBatch(" + data.items.length + ")")

      const barangRows = readRows(getBarangSheet(type))       // 1x read
      const barangMap  = buildBarangMap(barangRows)           // O(1) map

      // Track running saldo per id_barang across batch
      const runSaldo   = {}
      const newRows    = []
      let   nextRowNum = sheet.getLastRow() + 1

      data.items.forEach(function(item) {
        const id  = prefix + "-" + String(nextRowNum - 1).padStart(4, "0")
        const idB = String(item.id_barang)
        const qty = Number(item.qty)

        // Initialize running saldo from sheet on first encounter
        if (!(idB in runSaldo)) {
          const entry = barangMap[idB]
          runSaldo[idB] = entry ? entry.sisa_saldo : 0
        }
        runSaldo[idB] -= qty

        newRows.push([
          id, item.id_barang, item.kode_barang, item.nama_barang,
          item.merk, item.satuan, item.tanggal, qty,
          runSaldo[idB], item.keterangan
        ])
        nextRowNum++
      })

      // 1 batch write to Keluar sheet (replaces N appendRow calls)
      batchInsertRows(sheet, newRows)

      // Batch update sisa_saldo in Barang sheet
      const barangSheet = getBarangSheet(type)
      Object.keys(runSaldo).forEach(function(idB) {
        const entry = barangMap[idB]
        if (entry) barangSheet.getRange(entry.rowIndex, 7).setValue(runSaldo[idB])
      })
      clearBarangCache(type)

      _te(t)
    }

    // ── UPDATE ─────────────────────────────────────────────────────────────
    if (action == "update") {
      const t = _t("update")

      // 1x read keluar + 1x read barang
      const keluarRows = readRows(sheet)
      const keluarMap  = buildKeluarMap(keluarRows)
      const kEntry     = keluarMap[String(data.id)]
      if (!kEntry) return jsonResponse({ status: "error", message: "id not found" })

      const oldIdBarang = kEntry.id_barang
      const oldQty      = kEntry.qty
      const newQty      = Number(data.qty)
      const sameBtarang = oldIdBarang === String(data.id_barang)

      const barangRows  = readRows(getBarangSheet(type))
      const barangMap   = buildBarangMap(barangRows)
      const barangSheet = getBarangSheet(type)

      // Update keluar row
      sheet.getRange(kEntry.rowIndex, 1, 1, 10).setValues([[
        data.id, data.id_barang, data.kode_barang, data.nama_barang,
        data.merk, data.satuan, data.tanggal, newQty, 0, data.keterangan
      ]])

      // Incremental stok update for new barang
      const newEntry = barangMap[String(data.id_barang)]
      if (newEntry) {
        const newSaldo = sameBtarang
          ? newEntry.sisa_saldo - (newQty - oldQty)   // same barang: adjust delta
          : newEntry.sisa_saldo - newQty               // different barang: deduct full
        barangSheet.getRange(newEntry.rowIndex, 7).setValue(newSaldo)
        sheet.getRange(kEntry.rowIndex, 9).setValue(newSaldo)
      }

      // Restore old barang saldo if barang changed
      if (!sameBtarang) {
        const oldEntry = barangMap[String(oldIdBarang)]
        if (oldEntry) barangSheet.getRange(oldEntry.rowIndex, 7).setValue(oldEntry.sisa_saldo + oldQty)
      }

      clearBarangCache(type)
      _te(t)
    }

    // ── DELETE ─────────────────────────────────────────────────────────────
    if (action == "delete") {
      const t = _t("delete")

      const keluarRows = readRows(sheet)
      const keluarMap  = buildKeluarMap(keluarRows)
      const kEntry     = keluarMap[String(data.id)]
      if (!kEntry) return jsonResponse({ status: "error", message: "id not found" })

      sheet.deleteRow(kEntry.rowIndex)

      // Incremental restore: saldo += qty
      const barangRows = readRows(getBarangSheet(type))
      const barangMap  = buildBarangMap(barangRows)
      const bEntry     = barangMap[kEntry.id_barang]
      if (bEntry) {
        getBarangSheet(type).getRange(bEntry.rowIndex, 7).setValue(bEntry.sisa_saldo + kEntry.qty)
        clearBarangCache(type)
      }

      _te(t)
    }

  } finally {
    lock.releaseLock()
  }

  return jsonResponse({ status: "success" })
}

// ── getStok ───────────────────────────────────────────────────────────────────

function getStok(month, year) {
  const t = _t("getStok")
  month = Number(month)
  year  = Number(year)

  const daysInMonth = new Date(year, month, 0).getDate()

  // 1x read all 3 barang sheets
  const barangData = []
  Object.values(SHEETS.barang).forEach(function(sheet) {
    readRows(sheet).forEach(function(r) { barangData.push(r) })
  })

  // 1x read all 3 keluar sheets, build per-barang per-day map
  const keluarByBarang = {}
  Object.values(SHEETS.keluar).forEach(function(sheet) {
    readRows(sheet).forEach(function(r) {
      const d = new Date(r[6])
      if (d.getMonth() + 1 !== month || d.getFullYear() !== year) return
      const idB = String(r[1])
      const day = d.getDate()
      if (!keluarByBarang[idB]) keluarByBarang[idB] = {}
      keluarByBarang[idB][day] = (keluarByBarang[idB][day] || 0) + Number(r[7])
    })
  })

  const result = barangData.map(function(r) {
    const id_barang  = String(r[0])
    const dayMap     = keluarByBarang[id_barang] || {}
    const saldo_awal = Number(r[5])
    const sisa_saldo = Number(r[6])
    const keluar_per_tanggal = []
    for (let d = 1; d <= daysInMonth; d++) keluar_per_tanggal.push(dayMap[d] || 0)
    return {
      id_barang,
      kode_barang:         r[1],
      nama_barang:         r[2],
      merk:                r[3],
      satuan:              r[4],
      saldo_awal,
      sisa_saldo,
      total_pemakaian:     saldo_awal - sisa_saldo,
      days_in_month:       daysInMonth,
      keluar_per_tanggal,
    }
  })

  _te(t)
  return jsonResponse(result)
}


