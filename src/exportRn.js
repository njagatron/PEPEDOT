// src/exportRn.js
import JSZip from "jszip";
import * as XLSX from "xlsx";

/**
 * Pretvori dataURL u Uint8Array
 */
function dataURLToBytes(dataURL) {
  const parts = dataURL.split(",");
  const base64 = parts[1] || "";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/**
 * Izvuci ekstenziju iz dataURL-a (default: jpg)
 */
function extFromDataURL(dataURL) {
  const m = /^data:(.+?);base64,/.exec(dataURL || "");
  if (!m) return "jpg";
  const mime = m[1].toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("jpeg")) return "jpg";
  return "jpg";
}

/**
 * Izradi Excel (tocke.xlsx) iz liste točaka + pdf naziva.
 * Redni broj je po (pdfIdx, page) i redoslijedu unosa (prema id).
 */
function buildExcel(points, pdfs) {
  // izračun rednog broja po PDF-u i stranici
  const ordinals = new Map(); // key: `${pdfIdx}-${page}` -> sorted array of ids
  const byKey = {};
  points.forEach((p) => {
    const k = `${p.pdfIdx}-${p.page}`;
    (byKey[k] ||= []).push(p);
  });
  Object.keys(byKey).forEach((k) => {
    byKey[k].sort((a, b) => a.id - b.id);
    byKey[k].forEach((p, i) => ordinals.set(p.id, i + 1));
  });

  const rows = points.map((p) => ({
    RedniBroj: ordinals.get(p.id) ?? "",
    Naziv: p.title || "",
    Datum: p.dateISO || "",
    Vrijeme: p.timeISO || "",
    Komentar: p.note || "",
    PDF: pdfs[p.pdfIdx]?.name || "",
    Stranica: p.page ?? "",
    X: p.x ?? "",
    Y: p.y ?? "",
    ImaFotku: p.imageData ? "DA" : "NE",
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tocke");
  // vrati ArrayBuffer
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

/**
 * Glavna funkcija za izvoz.
 * @param {Object} state - { pdfs, activePdfIdx, pageNumber, points, seqCounter, rnName, pageMap }
 * @returns {JSZip} zip instanca spremna za generateAsync(...)
 */
export async function exportRnToZip(state) {
  const {
    pdfs = [],
    activePdfIdx = 0,
    pageNumber = 1,
    points = [],
    seqCounter = 0,
    rnName = "RN",
    pageMap = {},
  } = state || {};

  const zip = new JSZip();

  // 1) Manifest i metapodaci (bez binarnih polja)
  const manifest = {
    rnName,
    exportedAt: new Date().toISOString(),
    activePdfIdx,
    pageNumber,
    pageMap,
    seqCounter,
    pdfCount: pdfs.length,
    versions: {
      format: 2, // bumpaj ako budeš mijenjao format
    },
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // 2) PDF-ovi (binarno) + manifest za PDF-ove
  const pdfsFolder = zip.folder("pdfs");
  const pdfsManifest = [];
  pdfs.forEach((p, i) => {
    const fileName = p.name || `tlocrt-${i + 1}.pdf`;
    const safeName = fileName.replace(/[\\/:*?"<>|]+/g, "_");
    const bytes = new Uint8Array(p.data || []);
    pdfsFolder.file(safeName, bytes);
    pdfsManifest.push({
      index: i,
      name: p.name || fileName,
      file: safeName,
      numPages: p.numPages || undefined,
    });
  });
  zip.file("pdfs/manifest.json", JSON.stringify(pdfsManifest, null, 2));

  // 3) Točke – JSON (sa imageData kao dataURL radi jednostavnog importa)
  zip.file("points.json", JSON.stringify(points, null, 2));

  // 4) Fotke i kao zasebne datoteke (nije nužno, ali praktično)
  const imagesFolder = zip.folder("images");
  points.forEach((p, idx) => {
    if (p.imageData) {
      const ext = extFromDataURL(p.imageData); // npr. jpg
      const bytes = dataURLToBytes(p.imageData);
      imagesFolder.file(`pt-${idx + 1}.${ext}`, bytes);
    }
  });

  // 5) Excel (tocke.xlsx)
  const excelBuffer = buildExcel(points, pdfs);
  zip.file("tocke.xlsx", excelBuffer);

  return zip;
}
