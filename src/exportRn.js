import JSZip from "jszip";
import * as XLSX from "xlsx";

function dataURLToUint8(dataURL) {
  const [meta, b64] = dataURL.split(",");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Excel builder – po zadanom: SVE točke iz RN-a.
// Ako želiš samo za aktivni PDF/stranicu, filtriraj prije poziva.
function buildExcelAll(points, pdfs) {
  const list = points.map((p, i) => ({
    ID: i + 1,
    Naziv: p.title || "",
    Datum: p.dateISO || "",
    Komentar: p.note || "",
    PDF: pdfs[p.pdfIdx]?.name || "",
    Stranica: p.page,
    X: p.x,
    Y: p.y,
  }));
  const ws = XLSX.utils.json_to_sheet(list);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tocke");
  // Vrati ArrayBuffer za ZIP
  return XLSX.write(wb, { bookType: "xlsx", type: "array" });
}

export async function exportRnToZip(state) {
  const { rnName, pdfs, activePdfIdx, pageNumber, points, seqCounter, pageMap } = state;
  const zip = new JSZip();

  // rn.json
  const rnJson = {
    rnName: rnName || "",
    activePdfIdx: activePdfIdx || 0,
    pageNumber: pageNumber || 1,
    seqCounter: seqCounter || 0,
    pageMap: pageMap || {},
    pdfs: [],
    points: [],
  };

  // PDF-ovi u /pdfs i rn.json.pdfs (samo meta)
  for (let i = 0; i < pdfs.length; i++) {
    const p = pdfs[i];
    const filename = `pdfs/${i}-${(p.name || `tlocrt-${i + 1}.pdf`).replace(/\s+/g, "_")}`;
    zip.file(filename, new Uint8Array(p.data));
    rnJson.pdfs.push({ id: p.id, name: p.name || "", path: filename, numPages: p.numPages || 1 });
  }

  // Slike (ako postoje) u /images i rn.json.points
  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    let imagePath = null;
    if (pt.imageData) {
      const bytes = dataURLToUint8(pt.imageData);
      imagePath = `images/pt-${i}.jpg`;
      zip.file(imagePath, bytes);
    }
    const { imageData, ...rest } = pt;
    rnJson.points.push({ ...rest, imagePath });
  }

  // Snimi rn.json
  zip.file("rn.json", JSON.stringify(rnJson, null, 2));

  // DODANO: Excel (sve točke)
  try {
    const excelArray = buildExcelAll(points, pdfs);
    zip.file("tocke.xlsx", excelArray);
  } catch (e) {
    console.warn("Excel export u ZIP nije uspio:", e);
  }

  return zip;
}
