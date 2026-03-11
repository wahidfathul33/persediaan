const ss = SpreadsheetApp.getActiveSpreadsheet()

const sheetBarang = ss.getSheetByName("List Barang")
const sheetMasuk = ss.getSheetByName("Persediaan Masuk")
const sheetKeluar = ss.getSheetByName("Persediaan Keluar")

function doGet(e){

  const action = e.parameter.action

  if(action == "barang"){
    return getBarang()
  }

  if(action == "masuk"){
    return getMasuk()
  }

  if(action == "keluar"){
    return getKeluar()
  }

  if(action == "stok"){
    return getStok()
  }

}

function getBarang(){

  const data = sheetBarang.getDataRange().getValues()
  data.shift()

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)

}

function getMasuk(){

  const data = sheetMasuk.getDataRange().getValues()
  data.shift()

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)

}

function getKeluar(){

  const data = sheetKeluar.getDataRange().getValues()
  data.shift()

  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)

}

function doPost(e){

  const data = JSON.parse(e.postData.contents)
  const action = data.action  // "add" | "update" | "delete"
  const type   = data.type    // "masuk" | "keluar"

  const sheet = type == "masuk" ? sheetMasuk : sheetKeluar

  // ── ADD ──────────────────────────────────────────────────────────────────
  if(action == "add"){

    const lastRow = sheet.getLastRow()
    const prefix = type == "masuk" ? "CR" : "DB"
    const id = prefix + "-" + String(lastRow).padStart(4, "0")

    if(type == "masuk"){
      sheet.appendRow([
        id, data.id_barang, data.kode_barang, data.nama_barang,
        data.merk, data.uom, data.tanggal, data.qty
      ])
    } else {
      sheet.appendRow([
        id, data.id_barang, data.kode_barang, data.nama_barang,
        data.merk, data.uom, data.tanggal, data.qty, data.keterangan
      ])
    }

  }

  // ── UPDATE ────────────────────────────────────────────────────────────────
  if(action == "update"){

    const rows = sheet.getDataRange().getValues()
    for(let i = 1; i < rows.length; i++){
      if(String(rows[i][0]) == String(data.id)){
        const rowNum = i + 1  // spreadsheet rows are 1-indexed, +1 for header
        if(type == "masuk"){
          sheet.getRange(rowNum, 1, 1, 8).setValues([[
            data.id, data.id_barang, data.kode_barang, data.nama_barang,
            data.merk, data.uom, data.tanggal, data.qty
          ]])
        } else {
          sheet.getRange(rowNum, 1, 1, 9).setValues([[
            data.id, data.id_barang, data.kode_barang, data.nama_barang,
            data.merk, data.uom, data.tanggal, data.qty, data.keterangan
          ]])
        }
        break
      }
    }

  }

  // ── DELETE ────────────────────────────────────────────────────────────────
  if(action == "delete"){

    const rows = sheet.getDataRange().getValues()
    for(let i = 1; i < rows.length; i++){
      if(String(rows[i][0]) == String(data.id)){
        sheet.deleteRow(i + 1)
        break
      }
    }

  }

  return ContentService
  .createTextOutput(JSON.stringify({ status:"success" }))
  .setMimeType(ContentService.MimeType.JSON)

}

function getStok(){

  const masuk = sheetMasuk.getDataRange().getValues()
  const keluar = sheetKeluar.getDataRange().getValues()

  let stok = {}

  masuk.slice(1).forEach(r => {

    const barang = r[1]  // ID_Barang
    const qty = Number(r[7])

    if(!stok[barang]) stok[barang] = 0

    stok[barang] += qty

  })

  keluar.slice(1).forEach(r => {

    const barang = r[1]  // ID_Barang
    const qty = Number(r[7])

    if(!stok[barang]) stok[barang] = 0

    stok[barang] -= qty

  })

  return ContentService
  .createTextOutput(JSON.stringify(stok))
  .setMimeType(ContentService.MimeType.JSON)

}