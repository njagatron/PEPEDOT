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
  const MAX_PDFS = 10;

  // Tema/UI
  const deco = {
    bg: "#0d1f24",
    card: "#10282f",
    edge: "#12343b",
    ink: "#e7ecef",
    gold: "#c9a227",
    accent: "#2a6f77",
  };
  const panel = {
    background: deco.card,
    border: `1px solid ${deco.edge}`,
    borderRadius: 14,
    padding: 12,
    boxShadow:
      "0 1px 0 rgba(255,255,255,0.03) inset, 0 6px 24px rgba(0,0,0,0.25)",
  };
  const btn = {
    base: {
      padding: "8px 12px",
      borderRadius: 10,
      border: `1px solid ${deco.edge}`,
      background: "#0f2328",
      color: deco.ink,
      cursor: "pointer",
    },
    primary: { background: deco.accent, borderColor: deco.accent, color: "#fff" },
    gold: { background: deco.gold, borderColor: deco.gold, color: "#1a1a1a" },
    warn: { background: "#d99114", borderColor: "#d99114", color: "#fff" },
    danger: { background: "#a62c2b", borderColor: "#a62c2b", color: "#fff" },
    ghost: { background: "transparent" },
  };

  // RN / spremanje
  const [rnList, setRnList] = useState([]);
  const [activeRn, setActiveRn] = useState("");
  const [persistWarning, setPersistWarning] = useState("");

  // PDF + točke
  const [pdfs, setPdfs] = useState([]); // [{id,name,data(uint8[]),numPages}]
  const [activePdfIdx, setActivePdfIdx] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageMap, setPageMap] = useState({}); // per-PDF zadnja stranica
  const [numPages, setNumPages] = useState(1);

  const [points, setPoints] = useState([]); // [{id,pdfIdx,page,x,y,title,dateISO,note,imageData?}]
  const [seqCounter, setSeqCounter] = useState(0);

  // Lista/UX
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [compactList, setCompactList] = useState(false);
  const [modeInfoOnly, setModeInfoOnly] = useState(false);

  // Hover oblačić
  const [hoverPointId, setHoverPointId] = useState(null);

  const viewerRef = useRef(null);

  // Helpers
  const safePersist = (key, value) => {
    try {
      localStorage.setItem(key, value);
      setPersistWarning("");
    } catch {
      setPersistWarning(
        "Upozorenje: nedovoljno prostora za trajno spremanje svih fotografija/podataka."
      );
    }
  };

  const loadRnList = () => {
    try {
      const raw = localStorage.getItem("pepedot2_rn_list");
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  };

  useEffect(() => {
    setRnList(loadRnList());
  }, []);

  // Učitavanje/snimanje stanja RN-a
  const loadActiveRn = (name) => {
    if (!name) return;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + name);
      if (!raw) {
        // inicijalni RN objekt
        setPdfs([]);
        setActivePdfIdx(0);
        setPageNumber(1);
        setPoints([]);
        setSeqCounter(0);
        setPageMap({});
        return;
      }
      const obj = JSON.parse(raw);
      setPdfs(obj.pdfs || []);
      setActivePdfIdx(obj.activePdfIdx || 0);
      setPageNumber(obj.pageNumber || 1);
      setPoints(obj.points || []);
      setSeqCounter(obj.seqCounter || 0);
      setPageMap(obj.pageMap || {});
    } catch (e) {
      console.error(e);
    }
  };

  const persistActiveRn = () => {
    if (!activeRn) return;
    const payload = JSON.stringify({
      rnName: activeRn,
      pdfs,
      activePdfIdx,
      pageNumber,
      pageMap,
      points,
      seqCounter,
    });
    safePersist(STORAGE_PREFIX + activeRn, payload);
  };

  useEffect(() => {
    persistActiveRn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRn, pdfs, activePdfIdx, pageNumber, points, seqCounter, pageMap]);

  // RN akcije
  const createRn = () => {
    const name = window.prompt("Naziv novog RN-a:");
    if (!name) return;
    if (rnList.includes(name)) return window.alert("RN s tim nazivom već postoji.");
    const updated = [...rnList, name];
    setRnList(updated);
    safePersist("pepedot2_rn_list", JSON.stringify(updated));
    setActiveRn(name);
    // reset state
    setPdfs([]);
    setActivePdfIdx(0);
    setPageNumber(1);
    setPoints([]);
    setSeqCounter(0);
    setPageMap({});
    // odmah persist
    persistActiveRn();
  };

  const renameRn = () => {
    if (!activeRn) return window.alert("Nema aktivnog RN-a.");
    const newName = window.prompt("Novi naziv RN-a:", activeRn);
    if (!newName || newName === activeRn) return;
    if (rnList.includes(newName)) return window.alert("RN s tim nazivom već postoji.");
    // presnimi ključ u localStorage
    const oldKey = STORAGE_PREFIX + activeRn;
    const newKey = STORAGE_PREFIX + newName;
    const data = localStorage.getItem(oldKey);
    if (data) {
      safePersist(newKey, data);
      localStorage.removeItem(oldKey);
    }
    const updated = rnList.map((r) => (r === activeRn ? newName : r));
    setRnList(updated);
    safePersist("pepedot2_rn_list", JSON.stringify(updated));
    setActiveRn(newName);
  };

  const deleteRnWithConfirm = (rnName) => {
    if (!rnName) return;
    const confirmation = window.prompt(
      `Za brisanje RN-a upišite njegov naziv: "${rnName}"`
    );
    if (confirmation !== rnName)
      return window.alert("Naziv RN-a nije ispravan, brisanje otkazano.");
    if (
      !window.confirm(`Jeste li sigurni da želite obrisati RN "${rnName}"?`)
    )
      return;
    localStorage.removeItem(STORAGE_PREFIX + rnName);
    const updated = rnList.filter((x) => x !== rnName);
    setRnList(updated);
    safePersist("pepedot2_rn_list", JSON.stringify(updated));
    if (activeRn === rnName) {
      setActiveRn("");
      setPdfs([]);
      setActivePdfIdx(0);
      setPageNumber(1);
      setPoints([]);
      setSeqCounter(0);
      setPageMap({});
    }
  };

  // PDF
  const onPdfLoadSuccess = ({ numPages }) => {
    setNumPages(numPages || 1);
  };

  const setActivePdf = (idx) => {
    if (idx < 0 || idx >= pdfs.length) return;
    setActivePdfIdx(idx);
    setPageNumber(pageMap[idx] || 1);
  };

  useEffect(() => {
    // pamti zadnju stranicu po PDF-u
    setPageMap((prev) => ({ ...prev, [activePdfIdx]: pageNumber }));
  }, [activePdfIdx, pageNumber]);

  const handlePdfUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await addPdf(file);
    e.target.value = "";
  };

  const addPdf = async (file) => {
    if (pdfs.length >= MAX_PDFS) {
      return window.alert(`Dosegnut je maksimalan broj PDF-ova (${MAX_PDFS}) za ovaj RN.`);
    }
    try {
      const buf = await file.arrayBuffer();
      const uint8 = new Uint8Array(buf);
      const item = {
        id: Date.now(),
        name: file.name || `tlocrt-${pdfs.length + 1}.pdf`,
        data: Array.from(uint8),
        numPages: 1,
      };
      const next = [...pdfs, item];
      setPdfs(next);
      // Ostani na trenutnom PDF-u (ne prebacuj automatski)
      // Ako želiš auto-prebacivanje, odkomentiraj:
      // setActivePdfIdx(next.length - 1);
      // setPageNumber(1);
    } catch (e) {
      console.error(e);
      window.alert("Neuspješno dodavanje PDF-a.");
    }
  };

  const renamePdf = (idx) => {
    if (!pdfs.length) return;
    const p = pdfs[idx];
    const newName = window.prompt("Novi naziv PDF-a:", p.name || "");
    if (!newName || newName === p.name) return;
    const next = pdfs.map((item, i) => (i === idx ? { ...item, name: newName } : item));
    setPdfs(next);
  };

  const deletePdfWithConfirm = (idx) => {
    if (!pdfs.length) return;
    if (pdfs.length === 1) {
      return window.alert("Ne možete obrisati jedini PDF u RN-u.");
    }
    const p = pdfs[idx];
    const confirmation = window.prompt(`Za brisanje PDF-a upišite njegov naziv: "${p.name}"`);
    if (confirmation !== p.name)
      return window.alert("Naziv PDF-a nije ispravan, brisanje otkazano.");
    if (
      !window.confirm(
        `Jeste li sigurni da želite obrisati PDF "${p.name}"? (točke s tog PDF-a će se obrisati)`
      )
    )
      return;
    const filteredPoints = points.filter((pt) => pt.pdfIdx !== idx);
    const compacted = filteredPoints.map((pt) => {
      // ako brišemo pdf idx, pomakni indekse većih
      const newIdx = pt.pdfIdx > idx ? pt.pdfIdx - 1 : pt.pdfIdx;
      return { ...pt, pdfIdx: newIdx };
    });
    const nextPdfs = pdfs.filter((_, i) => i !== idx);
    let nextActive = activePdfIdx;
    if (idx === activePdfIdx) nextActive = Math.max(0, activePdfIdx - 1);
    setPdfs(nextPdfs);
    setPoints(compacted);
    setActivePdfIdx(nextActive);
    setPageNumber(1);
    // očisti pageMap
    const pm = { ...pageMap };
    delete pm[idx];
    const pm2 = Object.fromEntries(
      Object.entries(pm).map(([k, v]) => {
        const n = Number(k);
        return [String(n > idx ? n - 1 : n), v];
      })
    );
    setPageMap(pm2);
  };

  // TOČKE
  const pointsOnCurrent = useMemo(
    () => points.filter((p) => p.pdfIdx === activePdfIdx && p.page === pageNumber),
    [points, activePdfIdx, pageNumber]
  );

  const isTooCloseToExisting = (x, y, rect, minPx = 18) => {
    const list = pointsOnCurrent;
    const px = x * rect.width;
    const py = y * rect.height;
    return list.some((p) => {
      const qx = p.x * rect.width;
      const qy = p.y * rect.height;
      const dx = qx - px;
      const dy = qy - py;
      return Math.hypot(dx, dy) < minPx;
    });
  };

  const handleViewerClick = (e) => {
    if (modeInfoOnly) return; // u info modu ne dodaj točke
    const node = viewerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    if (isTooCloseToExisting(x, y, rect, 18)) {
      window.alert(
        "Točka je preblizu postojećoj. Odaberi obližnju poziciju (mogu se dodirivati, ne smiju se prekriti)."
      );
      return;
    }

    const title = window.prompt("Naziv točke:", `T${seqCounter + 1}`) || `T${seqCounter + 1}`;
    const dateISO = window.prompt("Datum (YYYY-MM-DD):", new Date().toISOString().slice(0, 10)) ||
      new Date().toISOString().slice(0, 10);
    const note = window.prompt("Komentar (opcionalno):", "") || "";

    const newPoint = {
      id: Date.now(),
      pdfIdx: activePdfIdx,
      page: pageNumber,
      x,
      y,
      title,
      dateISO,
      note,
      imageData: null,
    };
    setPoints((prev) => [...prev, newPoint]);
    setSeqCounter((n) => n + 1);
  };

  const editPoint = (globalIdx) => {
    const p = points[globalIdx];
    if (!p) return;
    const title =
      window.prompt("Naziv točke:", p.title || "") ?? p.title;
    const dateISO =
      window.prompt("Datum (YYYY-MM-DD):", p.dateISO || "") ?? p.dateISO;
    const note =
      window.prompt("Komentar (opcionalno):", p.note || "") ?? p.note;
    const next = [...points];
    next[globalIdx] = { ...p, title, dateISO, note };
    setPoints(next);
  };

  const deletePoint = (globalIdx) => {
    if (!window.confirm("Obrisati točku?")) return;
    setPoints((prev) => prev.filter((_, i) => i !== globalIdx));
  };

  // EXCEL (za gumb "Izvoz Excel")
  const exportExcel = () => {
    const list = pointsOnCurrent.map((p, i) => ({
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
    XLSX.writeFile(wb, "tocke.xlsx");
  };

  // PDF Snapshot (kanvas s točkama)
  const exportPDF = async () => {
    const node = document.getElementById("pdf-capture-area");
    if (!node) return;
    const canvas = await html2canvas(node, { scale: 2 });
    const img = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pw = pdf.internal.pageSize.getWidth();
    const ph = pdf.internal.pageSize.getHeight();
    pdf.addImage(img, "PNG", 6, 6, pw - 12, ph - 12);
    pdf.save("nacrt_s_tockama.pdf");
  };

  // Export RN (ZIP) + Import
  const doExportZip = async () => {
    if (!activeRn) return window.alert("Nema aktivnog RN-a.");
    const state = { pdfs, activePdfIdx, pageNumber, points, seqCounter, rnName: activeRn, pageMap };
    const zip = await exportRnToZip(state);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    saveAs(await zip.generateAsync({ type: "blob" }), `${activeRn}-${stamp}.zip`);
  };

  const doImportZip = async (file) => {
    if (!file) return;
    if (!activeRn) return window.alert("Odaberi ili kreiraj RN prije importa.");

    // backup trenutnog stanja
    try {
      const current = { pdfs, activePdfIdx, pageNumber, points, seqCounter, rnName: activeRn, pageMap };
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
      setPageMap(imported.pageMap || {});
      // odmah persist
      const payload = {
        rnName: activeRn,
        pdfs: imported.pdfs || [],
        activePdfIdx: imported.activePdfIdx || 0,
        pageNumber: imported.pageNumber || 1,
        pageMap: imported.pageMap || {},
        points: imported.points || [],
        seqCounter: imported.seqCounter || 0,
      };
      localStorage.setItem(STORAGE_PREFIX + activeRn, JSON.stringify(payload));
      window.alert("Import završen.");
    } catch (e) {
      console.error(e);
      window.alert("Greška pri importu ZIP-a.");
    }
  };

  const onClickImportButton = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,application/zip";
    input.onchange = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!window.confirm("Importat ćeš RN iz ZIP-a i prebrisati trenutačne podatke (napravit će se BACKUP). Nastaviti?")) {
        return;
      }
      doImportZip(file);
    };
    input.click();
  };

  // RN selektor
  const RnPicker = () => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {rnList.map((rn) => (
        <div key={rn} style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button
            style={{
              ...btn.base,
              ...(activeRn === rn ? btn.primary : {}),
            }}
            onClick={() => {
              setActiveRn(rn);
              loadActiveRn(rn);
            }}
          >
            {rn}
          </button>
          <button
            style={{ ...btn.base, ...btn.danger }}
            onClick={() => deleteRnWithConfirm(rn)}
          >
            Obriši
          </button>
        </div>
      ))}
    </div>
  );

  // Render jedne točke + tooltip
  const renderPoint = (p, idx) => {
    const isHovered = hoverPointId === p.id;
    const left = `${p.x * 100}%`;
    const top = `${p.y * 100}%`;

    return (
      <div
        key={p.id}
        style={{
          position: "absolute",
          left,
          top,
          transform: "translate(-50%, -50%)",
        }}
        onMouseEnter={() => setHoverPointId(p.id)}
        onMouseLeave={() => setHoverPointId(null)}
      >
        {/* marker */}
        <div
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: deco.gold,
            border: `2px solid ${deco.card}`,
            boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
          }}
          title={p.title || ""}
        />
        {/* tooltip: Naziv + Datum */}
        {isHovered && (
          <div
            style={{
              position: "absolute",
              bottom: "120%",
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(0,0,0,0.85)",
              color: "#fff",
              padding: "6px 8px",
              borderRadius: 8,
              whiteSpace: "nowrap",
              fontSize: 12,
              pointerEvents: "none",
            }}
          >
            <div>
              <strong>{p.title || "(bez naziva)"}</strong>
            </div>
            <div style={{ opacity: 0.9 }}>
              Datum: {p.dateISO || "(n/a)"}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: "100vh", background: deco.bg, color: deco.ink, fontFamily: "Inter,system-ui,Arial,sans-serif" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: 16 }}>
        {/* HEADER + GLAVNE TIPKE */}
        <header style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h1 style={{ margin: 0, fontSize: 18, flex: 1 }}>PEPEDOT 2</h1>

          <button style={{ ...btn.base, ...btn.primary }} onClick={createRn}>Novi RN</button>
          <button style={{ ...btn.base }} onClick={renameRn} disabled={!activeRn}>Preimenuj RN</button>
          <button style={{ ...btn.base, ...btn.danger }} onClick={() => deleteRnWithConfirm(activeRn)} disabled={!activeRn}>Obriši RN</button>

          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={handlePdfUpload}
            disabled={!activeRn || pdfs.length >= MAX_PDFS}
            style={{
              padding: 6,
              background: "#0f2328",
              border: `1px solid ${deco.edge}`,
              borderRadius: 10,
              color: (!activeRn || pdfs.length >= MAX_PDFS) ? "#7b8a8f" : deco.ink,
              opacity: (!activeRn || pdfs.length >= MAX_PDFS) ? 0.6 : 1,
              cursor: (!activeRn || pdfs.length >= MAX_PDFS) ? "not-allowed" : "pointer",
            }}
          />
          <button style={{ ...btn.base }} onClick={() => renamePdf(activePdfIdx)} disabled={!pdfs.length}>Preimenuj PDF</button>
          <button style={{ ...btn.base, ...btn.danger }} onClick={() => deletePdfWithConfirm(activePdfIdx)} disabled={!pdfs.length}>Obriši PDF</button>
        </header>

        {persistWarning && (
          <div style={{ ...panel, background: "#3b2b17", borderColor: "#8e5d12", color: "#fff", marginBottom: 12 }}>
            {persistWarning}
          </div>
        )}

        {/* RN lista */}
        <section style={{ ...panel, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "#c7d3d7" }}>Radni nalozi</h3>
          </div>
          <RnPicker />
        </section>

        {/* PDF TABOVI */}
        {!!pdfs.length && (
          <section style={{ ...panel, marginBottom: 12 }}>
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                padding: 8,
                background: "#0f2328",
                border: `1px solid ${deco.edge}`,
                borderRadius: 12,
                overflowX: "auto",
              }}
            >
              {pdfs.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => setActivePdf(i)}
                  title={p.name || `PDF ${i + 1}`}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 10,
                    border: `1px solid ${deco.edge}`,
                    background: i === activePdfIdx ? deco.accent : "#132b31",
                    color: i === activePdfIdx ? "#fff" : deco.ink,
                    whiteSpace: "nowrap",
                    cursor: "pointer",
                  }}
                >
                  {p.name || `PDF ${i + 1}`}
                </button>
              ))}
              <span style={{ marginLeft: "auto", fontSize: 12, color: "#c7d3d7" }}>
                {pdfs.length}/{MAX_PDFS}
              </span>
            </div>
          </section>
        )}

        {/* VIEWER + KONTROLE */}
        <section style={{ ...panel, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "#c7d3d7" }}>
              Aktivni PDF: <strong style={{ color: deco.gold }}>{pdfs[activePdfIdx]?.name || "(nema)"}</strong>
            </div>
            <div style={{ flex: 1 }} />
            <button style={{ ...btn.base }} onClick={() => setModeInfoOnly(s => !s)}>
              {modeInfoOnly ? "➕ Dodavanje točaka: UKLJUČI" : "ℹ️ Info režim (bez dodavanja)"}
            </button>
            <button style={{ ...btn.base }} onClick={exportExcel}>Izvoz Excel</button>
            <button style={{ ...btn.base, ...btn.gold }} onClick={exportPDF}>Izvoz PDF</button>
            <button style={{ ...btn.base }} onClick={doExportZip}>💾 Export RN (.zip)</button>
            <button style={{ ...btn.base }} onClick={onClickImportButton}>📂 Import RN (.zip)</button>
          </div>

          <div
            id="pdf-capture-area"
            ref={viewerRef}
            style={{
              position: "relative",
              background: "#0a1a1f",
              border: `1px solid ${deco.edge}`,
              borderRadius: 12,
              overflow: "hidden",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: 420,
            }}
            onClick={handleViewerClick}
          >
            {pdfs[activePdfIdx] ? (
              <Document
                file={{ data: new Uint8Array(pdfs[activePdfIdx].data) }}
                onLoadSuccess={onPdfLoadSuccess}
                loading={<div style={{ padding: 16 }}>Učitavanje PDF-a…</div>}
              >
                <Page
                  pageNumber={pageNumber}
                  renderAnnotationLayer={true}
                  renderTextLayer={true}
                  width={900}
                />
              </Document>
            ) : (
              <div style={{ padding: 24, color: "#c7d3d7" }}>Dodaj PDF datoteku za prikaz.</div>
            )}

            {/* Overlay točke */}
            <div
              style={{
                position: "absolute",
                inset: 0,
                pointerEvents: "none",
              }}
            >
              {pointsOnCurrent.map(renderPoint)}
            </div>
          </div>

          {/* Paginacija PDF-a */}
          {!!pdfs.length && (
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
              <button
                style={{ ...btn.base }}
                onClick={() => setPageNumber((n) => Math.max(1, n - 1))}
                disabled={pageNumber <= 1}
              >
                ◀︎
              </button>
              <div style={{ fontSize: 12, color: "#c7d3d7" }}>
                Stranica {pageNumber} / {numPages}
              </div>
              <button
                style={{ ...btn.base }}
                onClick={() => setPageNumber((n) => Math.min(numPages, n + 1))}
                disabled={pageNumber >= numPages}
              >
                ▶︎
              </button>
            </div>
          )}
        </section>

        {/* LISTA TOČAKA (sa traženim gumbima) */}
        <section style={{ ...panel, marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <h3 style={{ margin: 0, fontSize: 14, color: "#c7d3d7" }}>Fotografije (lista)</h3>
            <div style={{ flex: 1 }} />
            <button style={{ ...btn.base }} onClick={() => setShowAllSessions(s => !s)}>
              {showAllSessions ? "Prikaži samo novu sesiju" : "Prikaži sve sesije"}
            </button>
            <button style={{ ...btn.base }} onClick={() => setCompactList(s => !s)}>
              {compactList ? "Prikaz: detaljno" : "📱 Kompaktna lista"}
            </button>
          </div>

          <div style={{ display: "grid", gap: 8 }}>
            {points
              .filter((p) =>
                showAllSessions ? true : (p.pdfIdx === activePdfIdx && p.page === pageNumber)
              )
              .map((p, globalIdx) => {
                const hasPhoto = !!p.imageData;
                return (
                  <div
                    key={p.id}
                    style={{
                      border: `1px solid ${deco.edge}`,
                      borderRadius: 12,
                      background: "#0f2328",
                      padding: 10,
                      display: "flex",
                      gap: 10,
                      alignItems: "center",
                    }}
                  >
                    <div style={{ width: 48, height: 48, borderRadius: 8, overflow: "hidden", background: "#09161a", display: "flex", alignItems: "center", justifyContent: "center" }}>
                      {hasPhoto ? (
                        <img
                          src={p.imageData}
                          alt=""
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        <span style={{ fontSize: 12, color: "#7b8a8f" }}>bez slike</span>
                      )}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, color: deco.ink }}>
                        {p.title || "(bez naziva)"}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.9 }}>
                        Datum: {p.dateISO || "(n/a)"} · PDF: {pdfs[p.pdfIdx]?.name || "?"} · str: {p.page}
                      </div>
                      {!!p.note && (
                        <div style={{ fontSize: 12, opacity: 0.9, marginTop: 4 }}>
                          Komentar: {p.note}
                        </div>
                      )}
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      {hasPhoto && (
                        <a
                          href={p.imageData}
                          download={`${p.title || "foto"}.jpg`}
                          style={{ ...btn.base, ...btn.ghost, textDecoration: "none" }}
                        >
                          ⬇️
                        </a>
                      )}
                      <button style={{ ...btn.base, ...btn.warn }} onClick={() => editPoint(globalIdx)}>
                        Uredi
                      </button>
                      <button style={{ ...btn.base, ...btn.danger }} onClick={() => deletePoint(globalIdx)}>
                        Obriši
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* placeholder uklonjen (raniji bug):
              {/* compact list placeholder removed */ }
        </section>

        <footer style={{ textAlign: "center", fontSize: 12, color: "#8ea3a9", padding: 16 }}>
          © PEPEDOT 2
        </footer>
      </div>
    </div>
  );
}
