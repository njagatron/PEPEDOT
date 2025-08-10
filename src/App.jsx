import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { exportRnToZip } from "./exportRn";
import { importRnFromZip } from "./importRn";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function App() {
  const STORAGE_PREFIX = "pepedot2_rn_";

  const [rnList, setRnList] = useState([]);
  const [activeRn, setActiveRn] = useState("");

  const [pdfs, setPdfs] = useState([]);
  const [activePdfIdx, setActivePdfIdx] = useState(0);
  const [numPages, setNumPages] = useState(1);
  const [pageNumber, setPageNumber] = useState(1);

  const [points, setPoints] = useState([]);
  const [seqCounter, setSeqCounter] = useState(0);

  const [previewPhoto, setPreviewPhoto] = useState(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [compactList, setCompactList] = useState(false);
  const sessionId = useMemo(() => Date.now(), []);

  const [pdfError, setPdfError] = useState("");
  const [persistWarning, setPersistWarning] = useState("");

  const [stage, setStage] = useState("idle");
  const [stagedPhoto, setStagedPhoto] = useState(null);

  const [infoMode, setInfoMode] = useState(true);
  const [hoverSeq, setHoverSeq] = useState(null);

  const pageWrapRef = useRef(null);
  const exportRef = useRef(null);

  const deco = {
    bg: "#0d1f24",
    card: "#10282f",
    edge: "#12343b",
    ink: "#e7ecef",
    gold: "#c9a227",
    accent: "#2a6f77",
  };

  const safePersist = (key, value) => {
    try {
      localStorage.setItem(key, value);
      setPersistWarning("");
    } catch {
      setPersistWarning("Upozorenje: nedovoljno prostora za trajno spremanje svih fotografija.");
    }
  };

  const fileToDataURL = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  const compressImage = (dataUrl, maxDim = 800, quality = 0.7) =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });

  useEffect(() => {
    const savedList = JSON.parse(localStorage.getItem("pepedot2_rn_list") || "[]");
    const savedActive = localStorage.getItem("pepedot2_active_rn") || "";
    setRnList(savedList);
    if (savedActive && savedList.includes(savedActive)) loadRn(savedActive);
  }, []);

  useEffect(() => {
    if (!activeRn) return;
    const payload = { pdfs, activePdfIdx, pageNumber, points, seqCounter };
    safePersist(STORAGE_PREFIX + activeRn, JSON.stringify(payload));
    safePersist("pepedot2_active_rn", activeRn);
  }, [pdfs, activePdfIdx, pageNumber, points, seqCounter, activeRn]);

  const loadRn = (rn) => {
    const raw = localStorage.getItem(STORAGE_PREFIX + rn);
    const data = raw ? JSON.parse(raw) : { pdfs: [], activePdfIdx: 0, pageNumber: 1, points: [], seqCounter: 0 };
    setActiveRn(rn);
    setPdfs(data.pdfs || []);
    setActivePdfIdx(data.activePdfIdx || 0);
    setPageNumber(data.pageNumber || 1);
    setPoints(data.points || []);
    setSeqCounter(Number(data.seqCounter || 0));
    setShowAllSessions(false);
    setStage("idle");
    setStagedPhoto(null);
    setPersistWarning("");
    setInfoMode(true);
  };

  const createRn = () => {
    const name = (window.prompt("Unesi naziv novog RN-a (npr. RN001 ili RN1-KAT):") || "").trim();
    if (!name) return;
    if (rnList.includes(name)) return window.alert("RN s tim nazivom već postoji.");
    const updated = [...rnList, name];
    setRnList(updated);
    safePersist("pepedot2_rn_list", JSON.stringify(updated));
    const init = { pdfs: [], activePdfIdx: 0, pageNumber: 1, points: [], seqCounter: 0 };
    safePersist(STORAGE_PREFIX + name, JSON.stringify(init));
    setActiveRn(name);
    setPdfs([]); setActivePdfIdx(0); setPageNumber(1); setPoints([]); setSeqCounter(0);
    setShowAllSessions(false);
    setStage("idle");
    setStagedPhoto(null);
    setInfoMode(true);
  };

  const renameRn = () => {
    if (!activeRn) return;
    const newName = (window.prompt("Novi naziv za RN:", activeRn) || "").trim();
    if (!newName || newName === activeRn) return;
    if (rnList.includes(newName)) return window.alert("RN s tim nazivom već postoji.");
    const oldKey = STORAGE_PREFIX + activeRn;
    const data = localStorage.getItem(oldKey);
    if (data) {
      safePersist(STORAGE_PREFIX + newName, data);
      localStorage.removeItem(oldKey);
    }
    const updated = rnList.map((r) => (r === activeRn ? newName : r));
    setRnList(updated);
    safePersist("pepedot2_rn_list", JSON.stringify(updated));
    setActiveRn(newName);
  };

  const deleteRnWithConfirm = (rnName) => {
    const confirmation = window.prompt(`Za brisanje RN-a upišite njegov naziv: "${rnName}"`);
    if (confirmation !== rnName) return window.alert("Naziv RN-a nije ispravan, brisanje otkazano.");
    if (!window.confirm(`Jeste li sigurni da želite obrisati RN "${rnName}"?`)) return;
    localStorage.removeItem(STORAGE_PREFIX + rnName);
    const updated = rnList.filter((x) => x !== rnName);
    setRnList(updated);
    if (activeRn === rnName) {
      setActiveRn("");
      setPdfs([]); setActivePdfIdx(0); setPageNumber(1); setPoints([]); setSeqCounter(0);
    }
  };

  const addPdf = async (file) => {
    try {
      const buf = await file.arrayBuffer();
      const uint8 = new Uint8Array(buf);
      const item = { id: Date.now(), name: file.name || "tlocrt.pdf", data: Array.from(uint8), numPages: 1 };
      const next = [...pdfs, item];
      setPdfs(next);
      setActivePdfIdx(next.length - 1);
      setPageNumber(1);
    } catch (e) {
      console.error("addPdf error:", e);
      setPdfError("Ne mogu učitati ovaj PDF (addPdf).");
    }
  };

  const handlePdfUpload = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    await addPdf(f);
    e.target.value = "";
  };

  const renamePdf = (idx) => {
    const p = pdfs[idx];
    const newName = (window.prompt("Novi naziv PDF-a:", p.name) || "").trim();
    if (!newName) return;
    const next = [...pdfs];
    next[idx] = { ...p, name: newName };
    setPdfs(next);
  };

  const deletePdfWithConfirm = (idx) => {
    const p = pdfs[idx];
    if (!p) return;
    const confirmation = window.prompt(`Za brisanje PDF-a upišite njegov naziv: "${p.name}"`);
    if (confirmation !== p.name) return window.alert("Naziv PDF-a nije ispravan, brisanje otkazano.");
    if (!window.confirm(`Jeste li sigurni da želite obrisati PDF "${p.name}"? (točke s tog PDF-a će se obrisati)`)) return;
    const filteredPoints = points.filter(pt => pt.pdfIdx !== idx);
    const reindexed = filteredPoints.map(pt => ({ ...pt, pdfIdx: pt.pdfIdx > idx ? pt.pdfIdx - 1 : pt.pdfIdx }));
    const next = pdfs.filter((_, i) => i !== idx);
    setPoints(reindexed);
    setPdfs(next);
    if (next.length === 0) { setActivePdfIdx(0); setPageNumber(1); }
    else { setActivePdfIdx(Math.max(0, idx - 1)); setPageNumber(1); }
  };

  const onDocLoad = ({ numPages }) => setNumPages(numPages);

  const pageFile = (() => {
    const p = pdfs[activePdfIdx];
    if (!p) return null;
    const u8 = new Uint8Array(p.data);
    return { data: u8 };
  })();

  const pickPhoto = (preferCamera=false) => new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    if (preferCamera) input.capture = "environment";
    input.onchange = (ev) => resolve(ev.target.files?.[0] || null);
    input.click();
  });

  const startPhotoFlow = async (fromCamera) => {
    const file = await pickPhoto(!!fromCamera);
    if (!file) return;
    const raw = await fileToDataURL(file);
    const compressed = await compressImage(raw, 800, 0.7);
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    setStagedPhoto({
      dataURL: compressed,
      originalName: file.name || (fromCamera ? "camera.jpg" : "gallery.jpg"),
      source: fromCamera ? "captured" : "uploaded",
      dateISO: `${yyyy}-${mm}-${dd}`,
    });
    setStage("awaitPlacement");
    setInfoMode(false);
  };

  const isTooCloseToExisting = (xNorm, yNorm, rect, minDistancePx = 18) => {
    const w = rect.width, h = rect.height;
    const curr = points.filter(p => p.pdfIdx === activePdfIdx && p.page === pageNumber);
    for (const p of curr) {
      const dx = (xNorm - p.xNorm) * w;
      const dy = (yNorm - p.yNorm) * h;
      if (Math.hypot(dx, dy) < minDistancePx) return true;
    }
    return false;
  };

  const handlePlanClick = async (e) => {
    if (!pdfs.length) return;
    if (infoMode) return;

    const rect = pageWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (isTooCloseToExisting(x, y, rect, 18)) {
      window.alert("Točka je preblizu postojećoj. Odaberi obližnju poziciju (mogu se dodirivati, ne smiju se prekriti).");
      return;
    }

    if (stage !== "awaitPlacement" || !stagedPhoto) return;

    const nextSeq = seqCounter + 1;

    const base = window.prompt("Unesi naziv točke (npr. A233VIO):");
    if (!base) { setStage("idle"); setStagedPhoto(null); return; }
    const comment = window.prompt("Unesi komentar (opcionalno):") || "";

    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const fullName = `${base}${yyyy}${mm}${dd}`;

    const newPt = {
      xNorm: x,
      yNorm: y,
      seq: nextSeq,
      name: fullName,
      comment,
      imageData: stagedPhoto.dataURL,
      originalName: stagedPhoto.originalName,
      dateISO: stagedPhoto.dateISO,
      pdfIdx: activePdfIdx,
      page: pageNumber,
      source: stagedPhoto.source,
      sessionId
    };

    setPoints((prev) => [...prev, newPt]);
    setSeqCounter(nextSeq);
    setStage("idle");
    setStagedPhoto(null);
  };

  const attachPhotoToPoint = async (globalIdx, fromCamera) => {
    const file = await pickPhoto(!!fromCamera);
    if (!file) return;
    const raw = await fileToDataURL(file);
    const compressed = await compressImage(raw, 800, 0.7);
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");

    setPoints(prev => {
      const copy = [...prev];
      const p = { ...copy[globalIdx] };
      p.imageData = compressed;
      p.originalName = file.name || (fromCamera ? "camera.jpg" : "gallery.jpg");
      p.source = fromCamera ? "captured" : "uploaded";
      p.dateISO = `${yyyy}-${mm}-${dd}`;
      copy[globalIdx] = p;
      return copy;
    });
  };

  const editPoint = (globalIdx) => {
    const copy = [...points];
    const p = { ...copy[globalIdx] };
    const newName = window.prompt("Uredi naziv točke:", p.name || "");
    if (newName !== null) p.name = newName.trim();
    const newComment = window.prompt("Uredi komentar:", p.comment || "");
    if (newComment !== null) p.comment = newComment;
    copy[globalIdx] = p;
    setPoints(copy);
  };

  const deletePoint = (globalIdx) => {
    if (!window.confirm("Obrisati ovu točku?")) return;
    const copy = [...points];
    copy.splice(globalIdx, 1);
    setPoints(copy);
  };

  const exportExcel = () => {
    const list = points
      .filter((p) => pdfs[p.pdfIdx])
      .filter((p) => (showAllSessions ? true : p.sessionId === sessionId))
      .filter((p) => p.pdfIdx === activePdfIdx && p.page === pageNumber);
    const data = list.map((p, i) => ({
      ID: i + 1,
      NazivTocke: p.name || "",
      NazivFotografije: p.originalName || "",
      Datum: p.dateISO || ""
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tocke");
    XLSX.writeFile(wb, "tocke.xlsx");
  };

  const exportPDF = async () => {
    const node = exportRef.current;
    if (!node) return;
    const canvas = await html2canvas(node, { scale: 2 });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    pdf.addImage(img, "PNG", 6, 6, pw - 12, ph - 12);
    pdf.save("nacrt_s_tockama.pdf");
  };

  const doExportZip = async () => {
    if (!activeRn) return window.alert("Nema aktivnog RN-a.");
    const state = { pdfs, activePdfIdx, pageNumber, points, seqCounter, rnName: activeRn };
    const zip = await exportRnToZip(state);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    saveAs(await zip.generateAsync({ type: "blob" }), `RN-${activeRn}-${stamp}.zip`);
  };

  const doImportZip = async (file) => {
    if (!file) return;
    if (!activeRn) return window.alert("Odaberi ili kreiraj RN prije importa.");
    try {
      const current = { pdfs, activePdfIdx, pageNumber, points, seqCounter, rnName: activeRn };
      const backupZip = await exportRnToZip(current);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      saveAs(await backupZip.generateAsync({ type: "blob" }), `BACKUP-${activeRn}-${stamp}.zip`);
    } catch {}
    try {
      const imported = await importRnFromZip(file);
      setPdfs(imported.pdfs || []);
      setActivePdfIdx(imported.activePdfIdx || 0);
      setPageNumber(imported.pageNumber || 1);
      setPoints(imported.points || []);
      setSeqCounter(imported.seqCounter || 0);
      const payload = { pdfs: imported.pdfs || [], activePdfIdx: imported.activePdfIdx || 0, pageNumber: imported.pageNumber || 1, points: imported.points || [], seqCounter: imported.seqCounter || 0 };
      localStorage.setItem(STORAGE_PREFIX + activeRn, JSON.stringify(payload));
      window.alert("Import završen.");
    } catch (e) {
      console.error(e);
      window.alert("Neuspješan import ZIP-a.");
    }
  };

  const onClickImportButton = () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".zip,application/zip";
    inp.onchange = (ev) => doImportZip(ev.target.files?.[0] || null);
    inp.click();
  };

  const wrap = { minHeight: "100%", background: `linear-gradient(180deg, ${deco.bg} 0%, #0b181c 100%)`, color: deco.ink, fontFamily: "Inter,system-ui,Arial,sans-serif" };
  const container = { maxWidth: 1180, margin: "0 auto", padding: 16 };
  const panel = { background: deco.card, border: `1px solid ${deco.edge}`, borderRadius: 14, padding: 12, boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 6px 24px rgba(0,0,0,0.25)" };
  const btn = {
    base: { padding: "8px 12px", borderRadius: 10, border: `1px solid ${deco.edge}`, background: "#0f2328", color: deco.ink, cursor: "pointer" },
    primary: { background: deco.accent, borderColor: deco.accent, color: "#fff" },
    gold: { background: deco.gold, borderColor: deco.gold, color: "#1a1a1a" },
    warn: { background: "#d99114", borderColor: "#d99114", color: "#fff" },
    danger: { background: "#a62c2b", borderColor: "#a62c2b", color: "#fff" },
    ghost: { background: "transparent" },
  };

  const currentPoints = points
    .map((p, idx) => ({ ...p, _idx: idx }))
    .filter((p) => p.pdfIdx === activePdfIdx && p.page === pageNumber)
    .filter((p) => (showAllSessions ? true : p.sessionId === sessionId));

  return (
    <div style={wrap}>
      <div style={container}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 40, height: 40, borderRadius: 8, background: deco.gold, display: "grid", placeItems: "center", color: "#1b1b1b", fontWeight: 800, letterSpacing: 1 }}>P</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>PEPEDOT 2</div>
              <div style={{ fontSize: 12, color: "#b7c3c8" }}>PP BRTVLJENJE - FOTOTOČKA NANACRTU</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button style={{ ...btn.base, ...btn.primary }} onClick={createRn}>+ Novi RN</button>
            <button style={{ ...btn.base }} onClick={renameRn} disabled={!activeRn}>Preimenuj RN</button>
          </div>
        </header>

        <section style={{ ...panel, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "#b9c6ca" }}>
              Aktivni RN: {activeRn ? <strong style={{ color: deco.gold, marginLeft: 4 }}>{activeRn}</strong> : "nema"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            {rnList.map((rn) => (
              <div key={rn} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button style={{ ...btn.base, ...(rn === activeRn ? btn.gold : btn.ghost) }} onClick={() => loadRn(rn)}>{rn}</button>
                <button style={{ ...btn.base, ...btn.danger }} onClick={() => deleteRnWithConfirm(rn)}>Obriši</button>
              </div>
            ))}
          </div>
        </section>

        <section style={{ ...panel, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input type="file" accept=".pdf,application/pdf" onChange={handlePdfUpload}
              style={{ padding: 6, background: "#0f2328", border: `1px solid ${deco.edge}`, borderRadius: 10, color: deco.ink }} />
            {!!pdfs.length && (<>
              <span style={{ fontSize: 12, color: "#c7d3d7" }}>
                Aktivni PDF: <strong style={{ color: deco.gold }}>{pdfs[activePdfIdx]?.name}</strong>
              </span>
              <button style={{ ...btn.base }} onClick={() => renamePdf(activePdfIdx)} disabled={!pdfs.length}>Preimenuj PDF</button>
              <button style={{ ...btn.base, ...btn.danger }} onClick={() => deletePdfWithConfirm(activePdfIdx)} disabled={!pdfs.length}>Obriši PDF</button>
            </>)}
            <div style={{ flex: 1 }} />
            <button style={{ ...btn.base }} onClick={() => setShowAllSessions(s => !s)}>
              {showAllSessions ? "Prikaži samo novu sesiju" : "Prikaži sve sesije"}
            </button>
            <button style={{ ...btn.base }} onClick={() => setCompactList(s => !s)}>
              {compactList ? "Prikaz: detaljno" : "📱 Kompaktna lista"}
            </button>
            <button style={{ ...btn.base }} onClick={exportExcel}>Izvoz Excel</button>
            <button style={{ ...btn.base, ...btn.gold }} onClick={exportPDF}>Izvoz PDF</button>
            <button style={{ ...btn.base }} onClick={doExportZip}>💾 Export RN (.zip)</button>
            <button style={{ ...btn.base }} onClick={onClickImportButton}>📂 Import RN (.zip)</button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button
              style={{ ...btn.base, ...btn.primary }}
              onClick={() => startPhotoFlow(true)}
              disabled={!pdfs.length}
              title="1) fotografiraj  2) klik na tlocrt  3) naziv/komentar"
            >
              📷 Nova točka (kamera)
            </button>
            <button
              style={{ ...btn.base }}
              onClick={() => startPhotoFlow(false)}
              disabled={!pdfs.length}
              title="1) odaberi iz galerije  2) klik na tlocrt  3) naziv/komentar"
            >
              📁 Nova točka (galerija)
            </button>
            <button
              style={{ ...btn.base }}
              onClick={() => setInfoMode(v => !v)}
              disabled={!pdfs.length}
              title="Pregled točaka: info samo na hover/tap"
            >
              TOČKA INFO: {infoMode ? "UKLJUČENO" : "ISKLJUČENO"}
            </button>
            {stage === "awaitPlacement" && (
              <div style={{ alignSelf: "center", fontSize: 12, color: "#cfdadd" }}>
                Odabrana je fotografija — sada dodirni tlocrt za poziciju točke…
              </div>
            )}
          </div>

          {pdfError && <div style={{ marginTop: 8, fontSize: 12, color: "#ffb3b3" }}>{pdfError}</div>}
          {persistWarning && <div style={{ marginTop: 8, fontSize: 12, color: "#ffd27d" }}>{persistWarning}</div>}
        </section>

        <section ref={exportRef} style={{ ...panel }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Tlocrt</div>
            <div style={{ fontSize: 12, color: "#9fb2b8" }}>
              {activeRn && <span style={{ marginRight: 12 }}>RN: <strong style={{ color: deco.gold }}>{activeRn}</strong></span>}
              {!!pdfs.length && <span>Datoteka: <strong style={{ color: deco.gold }}>{pdfs[activePdfIdx]?.name}</strong></span>}
            </div>
          </div>

          <div
            ref={pageWrapRef}
            onClick={handlePlanClick}
            style={{ position: "relative", border: `1px solid ${deco.edge}`, borderRadius: 12, overflow: "hidden", background: "#0f2328", padding: 8 }}
            title={infoMode ? "Pregled točaka (TOČKA INFO uključena)" : "Klikni na tlocrt za dodavanje točke"}
          >
            {pageFile ? (
              <Document file={pageFile} onLoadSuccess={onDocLoad} onLoadError={() => setPdfError("Greška pri učitavanju PDF-a.")}>
                <Page pageNumber={pageNumber} width={Math.min(1100, window.innerWidth - 60)} />
              </Document>
            ) : (
              <div style={{ padding: 24, color: "#9fb2b8" }}>
                Učitaj PDF kako bi započeo. Primjer: preuzmi <a href="/assets/test.pdf" style={{ color:"#c9a227" }} download>test.pdf</a>
              </div>
            )}

            {currentPoints.map((p) => (
              <div
                key={p.seq}
                onMouseEnter={() => infoMode && setHoverSeq(p.seq)}
                onMouseLeave={() => infoMode && setHoverSeq(s => (s === p.seq ? null : s))}
                onClick={(e) => {
                  if (infoMode) {
                    e.stopPropagation();
                    setHoverSeq(p.seq);
                    setTimeout(() => setHoverSeq((s)=> (s===p.seq? null : s)), 2000);
                  }
                }}
                style={{ position: "absolute", left: `${p.xNorm*100}%`, top: `${p.yNorm*100}%`, transform: "translate(-50%,-50%)", cursor: infoMode ? "pointer" : "crosshair" }}
              >
                <div style={{ width: 14, height: 14, borderRadius: 999, background: deco.gold, border: "2px solid #000" }} />
                <div style={{ position: "absolute", left: 18, top: -10, background: "rgba(0,0,0,0.65)", color: "#fff", padding: "2px 6px", borderRadius: 8, fontSize: 12 }}>
                  {p.seq}
                </div>

                {infoMode && hoverSeq === p.seq && (p.name || p.dateISO) && (
                  <div style={{
                    position: "absolute",
                    left: 20, top: 14,
                    background: "rgba(0,0,0,0.85)",
                    color: "#fff",
                    padding: "6px 8px",
                    borderRadius: 10,
                    border: "1px solid rgba(255,255,255,.2)",
                    minWidth: 160,
                    zIndex: 10
                  }}>
                    <div style={{ fontWeight: 800, marginBottom: 4 }}>{p.name || "(bez naziva)"}</div>
                    <div style={{ fontSize: 12, opacity: 0.9 }}>Datum: {p.dateISO || "(n/a)"}</div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {!!pdfs.length && (
            <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
              <button style={{ ...btn.base }} onClick={() => setPageNumber(p => Math.max(1, p-1))}>◀</button>
              <span style={{ fontSize: 12, color: "#c7d3d7" }}>Stranica: <strong>{pageNumber}</strong> / {numPages}</span>
              <button style={{ ...btn.base }} onClick={() => setPageNumber(p => Math.min(numPages, p+1))}>▶</button>
            </div>
          )}
        </section>

        <section style={{ ...panel, marginTop: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Fotografije (lista)</div>

          {!compactList && (
            <div style={{ display: "grid", gap: 8 }}>
              {currentPoints.map((p) => {
                const globalIdx = points.findIndex(q => q.seq === p.seq);
                const hasPhoto = !!p.imageData;
                return (
                  <div key={p.seq} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, border: `1px solid ${deco.edge}`, borderRadius: 10, padding: "8px 10px", background: "#0f2328" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 800, color: deco.gold }}>#{p.seq}</span>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button style={{ ...btn.base }} onClick={() => attachPhotoToPoint(globalIdx, false)}>➕ Foto (galerija)</button>
                        <button style={{ ...btn.base }} onClick={() => attachPhotoToPoint(globalIdx, true)}>➕ Foto (kamera)</button>
                      </div>
                      {hasPhoto && (
                        <button style={{ ...btn.base }} onClick={() => setPreviewPhoto(p)} title="Pregled fotografije">🔍</button>
                      )}
                      <div style={{ fontWeight: 700, minWidth: 120 }}>{p.name || "(bez naziva)"}</div>
                      <div style={{ fontSize: 12, color: "#9fb2b8" }}>
                        {hasPhoto ? `${p.originalName} · ${p.dateISO} · ${p.source === "captured" ? "kamera" : "galerija"}` : "bez fotografije"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {hasPhoto && (
                        <a href={p.imageData} download={`${p.source || "photo"}_${p.originalName || "photo.jpg"}`} style={{ ...btn.base, ...btn.ghost, textDecoration: "none" }}>⬇️</a>
                      )}
                      <button style={{ ...btn.base, ...btn.warn }} onClick={() => editPoint(globalIdx)}>Uredi</button>
                      <button style={{ ...btn.base, ...btn.danger }} onClick={() => deletePoint(globalIdx)}>Obriši</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* compact list placeholder removed */}
        </section>

        {previewPhoto && (
          <div onClick={() => setPreviewPhoto(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "grid", placeItems: "center", zIndex: 9999, padding: 16 }} title="Zatvori">
            <div style={{ maxWidth: "95vw", maxHeight: "90vh", background: "#0f2328", border: `1px solid ${deco.edge}`, borderRadius: 12, padding: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontWeight: 700 }}>{previewPhoto.name || `(točka #${previewPhoto.seq})`}</div>
                <button style={{ ...btn.base, ...btn.danger }} onClick={() => setPreviewPhoto(null)}>Zatvori ✖</button>
              </div>
              <img src={previewPhoto.imageData} alt={previewPhoto.name || "photo"} style={{ maxWidth: "90vw", maxHeight: "75vh", borderRadius: 8 }} />
            </div>
          </div>
        )}

        <footer style={{ textAlign: "center", fontSize: 12, color: "#8ea3a9", padding: 16 }}>
          © {new Date().getFullYear()} PEPEDOT 2 · PP BRTVLJENJE - FOTOTOČKA NANACRTU
        </footer>
      </div>
    </div>
  );
}
