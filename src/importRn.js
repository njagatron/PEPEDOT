import JSZip from "jszip";

function uint8ToDataURL(u8, mime = "image/jpeg") {
  const bin = Array.from(u8).map((b) => String.fromCharCode(b)).join("");
  const b64 = btoa(bin);
  return `data:${mime};base64,${b64}`;
}

export async function importRnFromZip(file) {
  const zip = await JSZip.loadAsync(file);
  const rnJsonFile = zip.file("rn.json");
  if (!rnJsonFile) throw new Error("Nedostaje rn.json u ZIP-u.");

  const rnJson = JSON.parse(await rnJsonFile.async("string"));

  const pdfs = [];
  for (const p of rnJson.pdfs || []) {
    const zf = zip.file(p.dataPath);
    if (!zf) continue;
    const u8 = new Uint8Array(await zf.async("uint8array"));
    pdfs.push({ id: Date.now() + Math.random(), name: p.name, data: Array.from(u8), numPages: 1 });
  }

  const points = [];
  for (const pt of rnJson.points || []) {
    let imageData = null;
    if (pt.imagePath) {
      const zf = zip.file(pt.imagePath);
      if (zf) {
        const u8 = new Uint8Array(await zf.async("uint8array"));
        imageData = uint8ToDataURL(u8, "image/jpeg");
      }
    }
    const { imagePath, ...rest } = pt;
    points.push({ ...rest, imageData });
  }

  return {
    rnName: rnJson.rnName || "",
    activePdfIdx: rnJson.activePdfIdx || 0,
    pageNumber: rnJson.pageNumber || 1,
    seqCounter: rnJson.seqCounter || 0,
    pdfs,
    points,
  };
}
