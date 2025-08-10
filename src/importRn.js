// src/importRn.js
import JSZip from "jszip";

export async function importRnFromZip(fileOrBlob) {
  const zip = await JSZip.loadAsync(fileOrBlob);

  const manifestStr = await zip.file("manifest.json").async("string");
  const manifest = JSON.parse(manifestStr);

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

  const pointsStr = await zip.file("points.json").async("string");
  let points = JSON.parse(pointsStr);

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
    imageData: p.imageData ?? null,
    authorInitials: p.authorInitials ?? "", // <-- dodano
  }));

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
