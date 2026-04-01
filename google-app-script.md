// SETUP ROLLOVER_SECRET:
// Di Google Apps Script, buka menu: Extensions → Apps Script → Project Settings → Script Properties
// Tambahkan property: ROLLOVER_SECRET = <nilai secret yang sama dengan env ROLLOVER_SECRET di Vercel>

const ss = SpreadsheetApp.getActiveSpreadsheet()

const sheetBarang     = ss.getSheetByName("List Barang")
const sheetKeluarATK  = ss.getSheetByName("Keluar ATK")
const sheetKeluarRT   = ss.getSheetByName("Keluar RT")
const sheetKeluarObat = ss.getSheetByName("Keluar Obat")

// ── Helpers ───────────────────────────────────────────────────────────────────

function getKeluarSheet(type) {
  if (type == "atk")  return sheetKeluarATK
  if (type == "rt")   return sheetKeluarRT
  if (type == "obat") return sheetKeluarObat
  return null
}

function getKeluarPrefix(type) {
  if (type == "atk")  return "ATK"
  if (type == "rt")   return "RT"
  if (type == "obat") return "OBT"
  return "DB"
}

// Hitung ulang dan simpan Sisa Saldo di List Barang untuk id_barang tertentu
function updateSisaSaldoBarang(id_barang) {

  const barangRows = sheetBarang.getDataRange().getValues()
  let saldoAwal    = 0
  let barangRowNum = -1

  for (let i = 1; i < barangRows.length; i++) {
    if (String(barangRows[i][0]) == String(id_barang)) {
      saldoAwal    = Number(barangRows[i][5])
      barangRowNum = i + 1
      break
    }
  }

  if (barangRowNum == -1) return 0

  let totalKeluar = 0
  ;[sheetKeluarATK, sheetKeluarRT, sheetKeluarObat].forEach(function(sheet) {
    const rows = sheet.getDataRange().getValues()
    rows.slice(1).forEach(function(r) {
      if (String(r[1]) == String(id_barang)) {
        totalKeluar += Number(r[7])
      }
    })
  })

  const sisaSaldo = saldoAwal - totalKeluar
  sheetBarang.getRange(barangRowNum, 7).setValue(sisaSaldo)
  return sisaSaldo

}

// ── doGet ─────────────────────────────────────────────────────────────────────

function doGet(e) {

  const action = e.parameter.action
  const type   = e.parameter.type
  const month  = e.parameter.month
  const year   = e.parameter.year

  if (action == "barang") return getBarang()
  if (action == "keluar") return getKeluar(type, month, year)
  if (action == "stok")   return getStok(month, year)

}

function getBarang() {

  const data = sheetBarang.getDataRange().getValues()
  data.shift()

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)

}

function getKeluar(type, month, year) {

  const sheet = getKeluarSheet(type)
  if (!sheet) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: "invalid type" }))
      .setMimeType(ContentService.MimeType.JSON)
  }

  let data = sheet.getDataRange().getValues()
  data.shift()

  if (month && year) {
    const m = Number(month)
    const y = Number(year)
    data = data.filter(function(r) {
      const t = new Date(r[6])
      return t.getMonth() + 1 === m && t.getFullYear() === y
    })
  }

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)

}

// ── Rollover Saldo Awal (dipanggil tiap tanggal 1 via Vercel Cron) ────────────

function rolloverSaldo(secret) {

  const ROLLOVER_SECRET = PropertiesService.getScriptProperties().getProperty('ROLLOVER_SECRET')
  if (!ROLLOVER_SECRET || secret !== ROLLOVER_SECRET) return false

  const rows = sheetBarang.getDataRange().getValues()
  // Mulai dari baris 2 (index 1) untuk melewati header
  for (let i = 1; i < rows.length; i++) {
    const sisaSaldo = Number(rows[i][6]) // kolom G (index 6) = sisa_saldo
    sheetBarang.getRange(i + 1, 6).setValue(sisaSaldo) // kolom F (index 6 di getRange = 1-based 6) = saldo_awal
  }

  return true

}

// ── doPost ────────────────────────────────────────────────────────────────────

function doPost(e) {

  const data   = JSON.parse(e.postData.contents)
  const action = data.action  // "add" | "update" | "delete" | "rollover"
  const type   = data.type    // "atk" | "rt" | "obat"

  // ── ROLLOVER SALDO ────────────────────────────────────────────────────────
  if (action == "rollover") {
    const success = rolloverSaldo(data.cronSecret)
    return ContentService
      .createTextOutput(JSON.stringify({ status: success ? "success" : "unauthorized" }))
      .setMimeType(ContentService.MimeType.JSON)
  }

  const sheet = getKeluarSheet(type)

  // ── ADD ──────────────────────────────────────────────────────────────────
  if (action == "add") {

    const lastRow = sheet.getLastRow()
    const prefix  = getKeluarPrefix(type)
    const id      = prefix + "-" + String(lastRow).padStart(4, "0")

    // Baca Sisa Saldo saat ini dari List Barang
    const barangRows = sheetBarang.getDataRange().getValues()
    let sisaSaldoBarang = 0
    for (let i = 1; i < barangRows.length; i++) {
      if (String(barangRows[i][0]) == String(data.id_barang)) {
        sisaSaldoBarang = Number(barangRows[i][6])
        break
      }
    }

    const sisaSaldoRow = sisaSaldoBarang - Number(data.qty)

    sheet.appendRow([
      id, data.id_barang, data.kode_barang, data.nama_barang,
      data.merk, data.satuan, data.tanggal, data.qty,
      sisaSaldoRow, data.keterangan
    ])

    updateSisaSaldoBarang(data.id_barang)

  }

  // ── UPDATE ────────────────────────────────────────────────────────────────
  if (action == "update") {

    let oldIdBarang = null
    const rows = sheet.getDataRange().getValues()
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) == String(data.id)) {
        oldIdBarang = String(rows[i][1])
        const rowNum = i + 1
        sheet.getRange(rowNum, 1, 1, 10).setValues([[
          data.id, data.id_barang, data.kode_barang, data.nama_barang,
          data.merk, data.satuan, data.tanggal, data.qty,
          0, data.keterangan
        ]])
        break
      }
    }

    // Hitung ulang sisa saldo di List Barang
    const newSisaSaldo = updateSisaSaldoBarang(data.id_barang)

    // Update kolom Sisa Saldo (kolom 9) pada baris yang baru diupdate
    const updatedRows = sheet.getDataRange().getValues()
    for (let i = 1; i < updatedRows.length; i++) {
      if (String(updatedRows[i][0]) == String(data.id)) {
        sheet.getRange(i + 1, 9).setValue(newSisaSaldo)
        break
      }
    }

    // Jika id_barang berubah, perbarui juga saldo barang lama
    if (oldIdBarang && oldIdBarang !== String(data.id_barang)) {
      updateSisaSaldoBarang(oldIdBarang)
    }

  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if (action == "delete") {

    let id_barang = null
    const rows = sheet.getDataRange().getValues()
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) == String(data.id)) {
        id_barang = String(rows[i][1])
        sheet.deleteRow(i + 1)
        break
      }
    }

    if (id_barang) updateSisaSaldoBarang(id_barang)

  }

  return ContentService
    .createTextOutput(JSON.stringify({ status: "success" }))
    .setMimeType(ContentService.MimeType.JSON)

}

// ── getStok ───────────────────────────────────────────────────────────────────

function getStok(month, year) {

  month = Number(month)
  year  = Number(year)

  // Jumlah hari di bulan tersebut
  const daysInMonth = new Date(year, month, 0).getDate()

  const barangRows = sheetBarang.getDataRange().getValues()
  const barangData = barangRows.slice(1)

  // Kumpulkan keluar per id_barang per hari untuk bulan & tahun ini
  const keluarByBarang = {}
  ;[sheetKeluarATK, sheetKeluarRT, sheetKeluarObat].forEach(function(sheet) {
    const rows = sheet.getDataRange().getValues()
    rows.slice(1).forEach(function(r) {
      const id_barang = String(r[1])
      const tanggal   = new Date(r[6])
      const rowMonth  = tanggal.getMonth() + 1
      const rowYear   = tanggal.getFullYear()
      const qty       = Number(r[7])

      if (rowMonth == month && rowYear == year) {
        const day = tanggal.getDate()
        if (!keluarByBarang[id_barang]) keluarByBarang[id_barang] = {}
        if (!keluarByBarang[id_barang][day]) keluarByBarang[id_barang][day] = 0
        keluarByBarang[id_barang][day] += qty
      }
    })
  })

  const result = barangData.map(function(r) {
    const id_barang   = String(r[0])
    const kode_barang = r[1]
    const nama_barang = r[2]
    const merk        = r[3]
    const satuan      = r[4]
    const saldo_awal  = Number(r[5])
    const sisa_saldo  = Number(r[6])

    const keluar_per_tanggal = []
    for (let d = 1; d <= daysInMonth; d++) {
      keluar_per_tanggal.push(
        keluarByBarang[id_barang] ? (keluarByBarang[id_barang][d] || 0) : 0
      )
    }

    const total_pemakaian = saldo_awal - sisa_saldo

    return {
      id_barang,
      kode_barang,
      nama_barang,
      merk,
      satuan,
      saldo_awal,
      sisa_saldo,
      total_pemakaian,
      days_in_month: daysInMonth,
      keluar_per_tanggal
    }
  })

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON)

}