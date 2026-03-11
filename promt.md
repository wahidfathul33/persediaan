Buatkan aplikasi web inventory sederhana menggunakan HTML, TailwindCSS, dan next js.

Backend menggunakan REST API dari Google Apps Script yang terhubung dengan Google Spreadsheet.

Fitur aplikasi:

1. Master Barang
- tampilkan list barang
- field:
  - kode_barang
  - nama_barang
  - merk
  - uom

2. Persediaan Masuk (CRUD)
field:
- id
- kode_barang
- nama_barang
- merk
- uom
- tanggal
- qty

3. Persediaan Keluar (CRUD)
field:
- id
- kode_barang
- nama_barang
- merk
- uom
- tanggal
- qty
- keterangan

4. Laporan Stok
menampilkan:
- nama_barang
- merk
- total_masuk
- total_keluar
- stok_akhir

stok_akhir = total_masuk - total_keluar

Fitur tambahan:
- form tambah data
- edit data
- delete data
- tabel data
- dashboard stok

API endpoint:

GET /barang
GET /masuk
GET /keluar
POST /masuk
POST /keluar
PUT /masuk
PUT /keluar
DELETE /masuk
DELETE /keluar
GET /stok

Gunakan fetch() untuk komunikasi API.