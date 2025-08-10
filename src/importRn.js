// src/importRn.js
import JSZip from "jszip";

/**
 * Učitaj ZIP i vrati objekt stanja:
 * { pdfs, activePdfIdx, pageNumber, points, seqCounter, pageMap }
 *
 * Napomena:
 * - Očekuje datoteke: manifest.json, pdfs/manifest.json, points.json, pdf binarne fajlove.
 * - points.json već sadrži imageData (dataURL) — ako postoji, koristi se direktno.
 */
export async function importRnFromZip(fileOrBlob) {
  const zip = await JSZip.loadAsync(fileOrBlob);

  // 1) Manifest (osnovni metapodaci)
  const manifestStr = await zip.file("manifest.json").async("string");
  const manifest = JSON.parse(manifestStr);

  // 2) PDF manifest i binarni PDF-ovi
  const pdfsManifestStr = await zip.file("pdfs/manifest.json").async("string");
  const pdfsManifest = JSON.parse(pdfsManifestStr);

  const pdfs = [];
  for (const entry of pdfsManifest) {
    const fileEntry = zip.file(`pdfs/${entry.file}`);
    if (!fileEntry) continue;
    const bytes = await fileEntry.async("uint8array");
    pdfs[entry.index] = {
      id: Date.now() + entry.index,
      name: entry.name || entry.file,
      data: Array.from(bytes),
      numPages: entry.numPages || 1,
    };
  }

  // 3) Točke (JSON). Očekujemo imageData kao dataURL, ako ju je izvoz spremio.
  const pointsStr = await zip.file("points.json").async("string");
  let points = JSON.parse(pointsStr);

  // Osiguraj kompatibilnost (ako neki field nedostaje)
  points = points.map((p) => ({
    id: p.id ?? Date.now() + Math.floor(Math.random() * 100000),
    pdfIdx: p.pdfIdx ?? 0,
    page: p.page ?? 1,
    x: p.x ?? 0,
    y: p.y ?? 0,
    title: p.title ?? "",
    dateISO: p.dateISO ?? "",
    timeISO: p.timeISO ?? "",
    note: p.note ?? "",
    imageData: p.imageData ?? null, // ako nema u JSON-u, mogli bismo pročitati iz /images (nije nužno)
  }));

  // Vraćamo stanje za App.jsx
  return {
    pdfs,
    activePdfIdx: manifest.activePdfIdx ?? 0,
    pageNumber: manifest.pageNumber ?? 1,
    points,
    seqCounter: manifest.seqCounter ?? points.length,
    pageMap: manifest.pageMap ?? {},
    rnName: manifest.rnName ?? "RN",
  };
}
