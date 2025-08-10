import JSZip from "jszip";

function dataURLToUint8(dataURL) {
  const [meta, b64] = dataURL.split(",");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export async function exportRnToZip(state) {
  const { rnName, pdfs, activePdfIdx, pageNumber, points, seqCounter } = state;
  const zip = new JSZip();

  const pdfArr = [];
  for (let i = 0; i < (pdfs || []).length; i++) {
    const p = pdfs[i];
    const name = p.name || `tlocrt_${i + 1}.pdf`;
    const u8 = new Uint8Array(p.data || []);
    zip.file(`pdf/${name}`, u8);
    pdfArr.push({ name, dataPath: `pdf/${name}` });
  }

  const pointsForJson = [];
  for (const pt of points || []) {
    let imagePath = null;
    if (pt.imageData && pt.imageData.startsWith("data:image/")) {
      const fname = `images/pt_${pt.seq}.jpg`;
      zip.file(fname, dataURLToUint8(pt.imageData));
      imagePath = fname;
    }
    const { imageData, ...rest } = pt;
    pointsForJson.push({ ...rest, imagePath });
  }

  zip.file(
    "rn.json",
    JSON.stringify(
      {
        rnName: rnName || "",
        activePdfIdx: activePdfIdx || 0,
        pageNumber: pageNumber || 1,
        seqCounter: seqCounter || 0,
        pdfs: pdfArr,
        points: pointsForJson,
      },
      null,
      2
    )
  );

  return zip;
}
