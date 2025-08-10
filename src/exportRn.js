// src/exportRn.js
import JSZip from "jszip";
import * as XLSX from "xlsx";

/** dataURL -> bytes */
function dataURLToBytes(dataURL) {
  const parts = String(dataURL || "").split(",");
  const base64 = parts[1] || "";
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** proširi ekstenziju iz dataURL-a (default: jpg) */
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

/** Excel: RedniBroj + inicijali + ostalo */
function buildExcel(points, pdfs) {
  // ordinal per (pdfIdx,page)
  const groups = {};
  points.forEach((p) => {
    const k = `${p.pdfIdx}-${p.page}`;
    (groups[k] ||= []).push(p);
  });
  const ordMap = new Map();
  Object.keys(groups).forEach((k) => {
    groups[k].sort((a, b) => a.id - b.id);
    groups[k].forEach((p, i) => ordMap.set(p.id, i + 1));
  });

  const rows = points
    .slice()
    .sort((a, b) => (a.pdfIdx - b.pdfIdx) || (a.page - b.page) || (a.id - b.id))
    .map((p) => ({
      RedniBroj: ordMap.get(p.id) ?? "",
      Naziv: p.title || "",
      Datum: p.dateISO || "",
      Vrijeme: p.timeISO || "",
      Komentar: p.note || "",
      "Unos (inicijali)": p.authorInitials || "",
      PDF: pdfs[p.pdfIdx]?.name || "",
      Stranica: p.page ?? "",
      X: p.x ?? "",
      Y: p.y ?? "",
      ImaFotku: p.imageData ? "DA" : "NE",
    }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tocke");
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

/**
 * Export RN (osnovni paket: manifest, pdfs, points, images, excel)
 * Napomena: nacrti s ucrtanim oznakama dodaju se u App.jsx (doExportZip) u folder "nacrti".
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

  // manifest
  const manifest = {
    rnName,
    exportedAt: new Date().toISOString(),
    activePdfIdx,
    pageNumber,
    pageMap,
    seqCounter,
    pdfCount: pdfs.length,
    versions: { format: 3 },
  };
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));

  // PDF binarije + manifest
  const pdfsFolder = zip.folder("pdfs");
  const pdfsManifest = [];
  pdfs.forEach((p, i) => {
    const fileName = (p.name || `tlocrt-${i + 1}.pdf`).replace(/[\\/:*?"<>|]+/g, "_");
    const bytes = new Uint8Array(p.data || []);
    pdfsFolder.file(fileName, bytes);
    pdfsManifest.push({ index: i, name: p.name || fileName, file: fileName, numPages: p.numPages || undefined });
  });
  zip.file("pdfs/manifest.json", JSON.stringify(pdfsManifest, null, 2));

  // Točke JSON
  zip.file("points.json", JSON.stringify(points, null, 2));

  // Slike točaka — naziv: RedniBroj_Naziv_PDFNaziv.ext
  // Treba ordinal map kao u Excelu
  const groups = {};
  points.forEach((p) => {
    const k = `${p.pdfIdx}-${p.page}`;
    (groups[k] ||= []).push(p);
  });
  const ordMap = new Map();
  Object.keys(groups).forEach((k) => {
    groups[k].sort((a, b) => a.id - b.id);
    groups[k].forEach((p, i) => ordMap.set(p.id, i + 1));
  });

  const imagesFolder = zip.folder("fotografije");
  points.forEach((p) => {
    if (!p.imageData) return;
    const ord = ordMap.get(p.id) ?? 0;
    const pdfName = (pdfs[p.pdfIdx]?.name || `pdf-${p.pdfIdx + 1}`).replace(/[\\/:*?"<>|]+/g, "_");
    const titlePart = (p.title || "foto").replace(/[\\/:*?"<>|]+/g, "_");
    const ext = extFromDataURL(p.imageData);
    const bytes = dataURLToBytes(p.imageData);
    imagesFolder.file(`${ord}_${titlePart}_${pdfName}.${ext}`, bytes);
  });

  // Excel
  const excelBuffer = buildExcel(points, pdfs);
  zip.file("tocke.xlsx", excelBuffer);

  return zip;
}
