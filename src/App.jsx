import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { exportRnToZip } from "./exportRn";
import { importRnFromZip } from "./importRn";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "./responsive.css";

// Ako CDN worker ikad zezne, možeš preći na lokalni worker (pdfjs-dist) kako je opisano u uputi.
// Trenutno koristimo CDN:
pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

/* ------------ Error Boundary da se crnilo pretvori u poruku --------------- */
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error){ return { hasError: true, error }; }
  componentDidCatch(error, info){ console.error("App crashed:", error, info); }
  render(){
    if(this.state.hasError){
      return (
        <div style={{padding:24, color:"#fff", background:"#0d1f24", fontFamily:"Inter,system-ui,Arial"}}>
          <h2 style={{marginTop:0}}>Došlo je do greške u aplikaciji</h2>
          <pre style={{whiteSpace:"pre-wrap"}}>{String(this.state.error)}</pre>
          <p>Otvorite DevTools → Console za detalje.</p>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ============================== APP ======================================= */
export default function App() {
  const STORAGE_PREFIX = "pepedot2_rn_";
  const MAX_PDFS = 10;
  const MAX_RN = 10;

  const deco = { bg:"#0d1f24", card:"#10282f", edge:"#12343b", ink:"#e7ecef", gold:"#c9a227", accent:"#2a6f77" };
  const panel = { background:deco.card, border:`1px solid ${deco.edge}`, borderRadius:14, padding:12, boxShadow:"0 1px 0 rgba(255,255,255,0.03) inset, 0 6px 24px rgba(0,0,0,0.25)" };

  // RN
  const [rnList, setRnList] = useState([]);
  const [activeRn, setActiveRn] = useState("");
  const [persistWarning, setPersistWarning] = useState("");

  // Nacrti
  const [pdfs, setPdfs] = useState([]);
  const [activePdfIdx, setActivePdfIdx] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageMap, setPageMap] = useState({});
  const [numPages, setNumPages] = useState(1);

  // Točke
  const [points, setPoints] = useState([]);
  const [seqCounter, setSeqCounter] = useState(0);

  // Lista
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [compactList, setCompactList] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  // Inicijali
  const [userInitials, setUserInitials] = useState(() => localStorage.getItem("pepedot2_user_initials") || "");

  // Foto staging + edit
  const [stagedPhoto, setStagedPhoto] = useState(null);
  const [stagedNotice, setStagedNotice] = useState(false);
  const [photoEditTargetId, setPhotoEditTargetId] = useState(null);
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);
  const editPhotoInputRef = useRef(null);

  // Tooltip
  const [hoverPointId, setHoverPointId] = useState(null);
  const hoverInT = useRef(null);
  const hoverOutT = useRef(null);

  // Export meni + odabiri
  const [exportOpen, setExportOpen] = useState(false);
  const exportBtnRef = useRef(null);
  const [exportSize, setExportSize] = useState("a3"); // za screenshot varijantu

  // Viewer (pan/zoom)
  const captureRef = useRef(null);
  const viewerInnerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const panState = useRef({ panning:false, startX:0, startY:0, originX:0, originY:0 });

  // Mobilni pan/zoom fokus (na touch uređajima default ON – ne dodaje točke slučajno)
  const isTouch = typeof window !== "undefined" ? window.matchMedia("(pointer: coarse)").matches : false;
  const [panFocus, setPanFocus] = useState(isTouch);

  // Dijagnostika
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // sitni utili
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const sanitizeName = (s) => (s || "").replace(/\.[^.]+$/, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10) || "NAZIV";

  // zatvaranje export menija klikom izvan njega
  useEffect(() => {
    const onDocClick = (e) => { if (!exportBtnRef.current) return; if (!exportBtnRef.current.parentElement.contains(e.target)) setExportOpen(false); };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => () => { clearTimeout(hoverInT.current); clearTimeout(hoverOutT.current); }, []);

  // autofit na resize/orijentaciju
  useEffect(() => {
    const onResize = () => resetView();
    window.addEventListener("orientationchange", onResize);
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("orientationchange", onResize); window.removeEventListener("resize", onResize); };
  }, []);

  const safePersist = (key, value) => {
    try { localStorage.setItem(key, value); setPersistWarning(""); }
    catch { setPersistWarning("Upozorenje: nedovoljno prostora za spremanje svih fotografija/podataka."); }
  };

  const loadRnList = () => {
    try { const raw = localStorage.getItem("pepedot2_rn_list"); return raw ? JSON.parse(raw) : []; }
    catch { return []; }
  };
  useEffect(() => { setRnList(loadRnList()); }, []);

  // traženje inicijala kad se otvori RN
  useEffect(() => {
    if (!activeRn) return;
    let initials = localStorage.getItem("pepedot2_user_initials") || userInitials;
    if (!initials) {
      initials = (window.prompt("Unesite svoje inicijale (npr. JN):", "") || "").toUpperCase();
      setUserInitials(initials);
      localStorage.setItem("pepedot2_user_initials", initials);
    }
  }, [activeRn]); // eslint-disable-line

  const loadActiveRn = (name) => {
    if (!name) return;
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + name);
      if (!raw) {
        setPdfs([]); setActivePdfIdx(0); setPageNumber(1);
        setPoints([]); setSeqCounter(0); setPageMap({});
        return;
      }
      const obj = JSON.parse(raw);
      const sanitizedPoints = (obj.points || []).map((p) => ({ ...p, x: clamp01(p.x ?? 0), y: clamp01(p.y ?? 0) }));
      setPdfs(obj.pdfs || []);
      setActivePdfIdx(obj.activePdfIdx || 0);
      setPageNumber(obj.pageNumber || 1);
      setPoints(sanitizedPoints);
      setSeqCounter(obj.seqCounter || 0);
      setPageMap(obj.pageMap || {});
    } catch (e) { console.error(e); }
  };

const persistActiveRn = () => {
  if (!activeRn) return;
  const slimPdfs = pdfs.map(p => ({ id: p.id, name: p.name, numPages: p.numPages || null }));
  const payload = JSON.stringify({
    rnName: activeRn,
    pdfs: slimPdfs,             // bez data
    activePdfIdx,
    pageNumber,
    pageMap,
    points,
    seqCounter
  });
  safePersist(STORAGE_PREFIX + activeRn, payload);
};

  useEffect(() => { persistActiveRn(); }, [activeRn, pdfs, activePdfIdx, pageNumber, points, seqCounter, pageMap]); // eslint-disable-line

  // RN akcije
  const createRn = () => {
    if (rnList.length >= MAX_RN) return window.alert(`Dosegnut je maksimalan broj RN-ova (${MAX_RN}).`);
    const raw = window.prompt("Naziv novog RN-a (max 10 znakova A-Z0-9):");
    if (!raw) return;
    const name = sanitizeName(raw);
    if (rnList.includes(name)) return window.alert("RN s tim nazivom već postoji.");
    const updated = [...rnList, name];
    setRnList(updated);
    safePersist("pepedot2_rn_list", JSON.stringify(updated));
    setActiveRn(name);
    setPdfs([]); setActivePdfIdx(0); setPageNumber(1);
    setPoints([]); setSeqCounter(0); setPageMap({});
    setTimeout(() => {
      let initials = localStorage.getItem("pepedot2_user_initials") || "";
      if (!initials) {
        initials = (window.prompt("Unesite svoje inicijale (npr. JN):", "") || "").toUpperCase();
        setUserInitials(initials);
        localStorage.setItem("pepedot2_user_initials", initials);
      }
    }, 0);
  };

  const renameRn = (oldName) => {
    const raw = window.prompt("Novi naziv RN-a (max 10 znakova A-Z0-9):", oldName);
    if (!raw) return;
    const newName = sanitizeName(raw);
    if (!newName || newName === oldName) return;
    if (rnList.includes(newName)) return window.alert("RN s tim nazivom već postoji.");
    const oldKey = STORAGE_PREFIX + oldName;
    const newKey = STORAGE_PREFIX + newName;
    const data = localStorage.getItem(oldKey);
    if (data) { safePersist(newKey, data); localStorage.removeItem(oldKey); }
    const updated = rnList.map((r) => (r === oldName ? newName : r));
    setRnList(updated);
    safePersist("pepedot2_rn_list", JSON.stringify(updated));
    if (activeRn === oldName) setActiveRn(newName);
  };

  const changeInitialsForUser = () => {
    const cur = localStorage.getItem("pepedot2_user_initials") || userInitials || "";
    const next = (window.prompt("Unesite nove inicijale (npr. JN):", cur) || "").toUpperCase();
    setUserInitials(next);
    localStorage.setItem("pepedot2_user_initials", next);
  };

  const deleteRnWithConfirm = (rnName) => {
    if (!rnName) return;
    const confirmation = window.prompt(`Za brisanje RN-a upišite njegov naziv: "${rnName}"`);
    if (confirmation !== rnName) return window.alert("Naziv RN-a nije ispravan, brisanje otkazano.");
    if (!window.confirm(`Obrisati RN "${rnName}"?`)) return;
    localStorage.removeItem(STORAGE_PREFIX + rnName);
    const updated = rnList.filter((x) => x !== rnName);
    setRnList(updated);
    safePersist("pepedot2_rn_list", JSON.stringify(updated));
    if (activeRn === rnName) {
      setActiveRn("");
      setPdfs([]); setActivePdfIdx(0); setPageNumber(1);
      setPoints([]); setSeqCounter(0); setPageMap({});
    }
  };

  // NACRT (PDF)
  const onPdfLoadSuccess = ({ numPages }) => { setNumPages(numPages || 1); setTimeout(fitToPage, 0); };
  const setActivePdf = (idx) => {
    if (idx >= 0 && idx < pdfs.length) {
      setActivePdfIdx(idx);
      setPageNumber(pageMap[idx] || 1);
      setTimeout(fitToPage, 0);
      resetView();
    }
  };
  useEffect(() => { setTimeout(fitToPage, 0); }, [pageNumber]);
  const addPdf = async (file) => {
    if (pdfs.length >= MAX_PDFS) return window.alert(`Dosegnut je maksimalan broj nacrta (${MAX_PDFS}).`);
    try {
      const buf = await file.arrayBuffer();
      const uint8 = new Uint8Array(buf);
      const item = { id: Date.now(), name: sanitizeName(file.name || `NACRT${pdfs.length + 1}`), data: Array.from(uint8), numPages: 1 };
      setPdfs((prev) => [...prev, item]);
    } catch { window.alert("Neuspješno dodavanje nacrta."); }
  };

  const handlePdfPicker = () => {
    if (!activeRn) { window.alert("Najprije odaberi ili kreiraj RN."); return; }
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".pdf,application/pdf";
    input.onchange = async (e) => { const file = e.target.files?.[0]; if (!file) return; await addPdf(file); input.value = ""; };
    input.click();
  };

  const renamePdf = (idx) => {
    const p = pdfs[idx]; if (!p) return;
    const raw = window.prompt("Novi naziv nacrta (max 10 znakova A-Z0-9):", p.name || "");
    if (!raw) return;
    const newName = sanitizeName(raw);
    if (!newName || newName === p.name) return;
    setPdfs((arr) => arr.map((it,i) => i===idx ? ({...it, name:newName}) : it));
  };

  const deletePdfWithConfirm = (idx) => {
    if (!pdfs.length) return;
    const p = pdfs[idx];
    const confirmation = window.prompt(`Za brisanje nacrta upišite njegov naziv: "${p.name}"`);
    if (confirmation !== p.name) return window.alert("Naziv nacrta nije ispravan, brisanje otkazano.");
    if (!window.confirm(`Obrisati nacrt "${p.name}"? (točke s tog nacrta će se obrisati)`)) return;
    const filteredPoints = points.filter((pt) => pt.pdfIdx !== idx);
    const compacted = filteredPoints.map((pt) => ({ ...pt, pdfIdx: pt.pdfIdx > idx ? pt.pdfIdx - 1 : pt.pdfIdx, x: clamp01(pt.x), y: clamp01(pt.y) }));
    const nextPdfs = pdfs.filter((_, i) => i !== idx);
    setPdfs(nextPdfs); setPoints(compacted);
    setActivePdfIdx((cur) => (idx===cur ? Math.max(0, cur-1) : (cur>idx? cur-1 : cur)));
    setPageNumber(1);
    const pm = { ...pageMap }; delete pm[idx];
    const pm2 = Object.fromEntries(Object.entries(pm).map(([k,v]) => { const n=Number(k); return [String(n>idx? n-1:n), v]; }));
    setPageMap(pm2);
    resetView();
  };

  const activePdfFile = useMemo(() => {
    const p = pdfs[activePdfIdx]; if (!p) return null;
    return { data: new Uint8Array(p.data) };
  }, [pdfs, activePdfIdx]);

  const pointsOnCurrent = useMemo(
    () => points.filter((p) => p.pdfIdx === activePdfIdx && p.page === pageNumber),
    [points, activePdfIdx, pageNumber]
  );

  const getOrdinalForPoint = (pt) => {
    const arr = points.filter((p) => p.pdfIdx === pt.pdfIdx && p.page === pt.page).sort((a, b) => a.id - b.id);
    const idx = arr.findIndex((p) => p.id === pt.id);
    return idx >= 0 ? idx + 1 : null;
  };

  // kompresija slike
  const loadImage = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  const compressDataUrl = async (dataURL, maxSide = 900, quality = 0.7) => {
    const img = await loadImage(dataURL);
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const readAndCompress = async (file) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = async () => { try { resolve(await compressDataUrl(fr.result)); } catch (e) { reject(e); } };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });

  // pan/zoom granice
const clampOffset = (nextOffset, nextZoom = zoom) => {
  const wrap = captureRef.current;
  const inner = viewerInnerRef.current;
  if (!wrap || !inner) return nextOffset;

  const wrapRect = wrap.getBoundingClientRect();

  // mjeri stvarnu renderiranu veličinu PDF stranice (Page -> canvas)
  const pageEl = inner.querySelector(".react-pdf__Page") || inner;
  const pageRect = pageEl.getBoundingClientRect();
  // baza je trenutna CSS veličina stranice, ne intrinsic canvas pikseli
  const baseW = pageRect.width / (zoom || 1);
  const baseH = pageRect.height / (zoom || 1);

  const contentW = baseW * nextZoom;
  const contentH = baseH * nextZoom;

  const minX = Math.min(0, wrapRect.width - contentW);
  const maxX = 0;
  const minY = Math.min(0, wrapRect.height - contentH);
  const maxY = 0;

  return { x: Math.min(maxX, Math.max(minX, nextOffset.x)), y: Math.min(maxY, Math.max(minY, nextOffset.y)) };
};
const fitToPage = () => {
  const wrap = captureRef.current;
  const inner = viewerInnerRef.current;
  if (!wrap || !inner) return;

  const wrapRect = wrap.getBoundingClientRect();
  const pageEl = inner.querySelector(".react-pdf__Page");
  if (!pageEl) { setZoom(1); setOffset({x:0,y:0}); return; }

  // veličina stranice prije primjene transform-a
  const pageRect = pageEl.getBoundingClientRect();
  const currentZoom = zoom || 1;
  const pageW = pageRect.width / currentZoom;
  const pageH = pageRect.height / currentZoom;

  // zoom koji stanjuje cijelu stranicu u okvir
  const scale = Math.min(
    (wrapRect.width - 8) / pageW,
    (wrapRect.height - 8) / pageH,
    4 // cap
  );

  const contentW = pageW * scale;
  const contentH = pageH * scale;

  const offX = Math.round((wrapRect.width - contentW) / 2);
  const offY = Math.round((wrapRect.height - contentH) / 2);

  setZoom(scale);
  setOffset(clampOffset({ x: offX, y: offY }, scale));
};

  // dodavanje točke (dupli klik/tap)
  const addPointAtClientXY = (clientX, clientY) => {
    if (panFocus) return; // u pan/zoom fokusu ne dodajemo
    if (!captureRef.current || !viewerInnerRef.current) return;
    const rect = captureRef.current.getBoundingClientRect();
    const localX = (clientX - rect.left - offset.x) / rect.width / zoom;
    const localY = (clientY - rect.top - offset.y) / rect.height / zoom;
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return;

    const xx = clamp01(localX);
    const yy = clamp01(localY);

    const defTitle = `T${seqCounter + 1}`;
    const title = window.prompt("Naziv točke (npr. A123VIO):", defTitle) || defTitle;
    const d = new Date();
    const dateISO = window.prompt("Datum (YYYY-MM-DD):", d.toISOString().slice(0, 10)) || d.toISOString().slice(0, 10);
    const note = window.prompt("Komentar (opcionalno):", "") || "";

    const newPoint = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      pdfIdx: activePdfIdx, page: pageNumber,
      x: xx, y: yy,
      title, dateISO, timeISO: "", note,
      imageData: stagedPhoto || null,
      authorInitials: (userInitials || "").toUpperCase(),
    };
    setPoints((prev) => [...prev, newPoint]);
    setSeqCounter((n) => n + 1);
    if (stagedPhoto) { setStagedPhoto(null); setStagedNotice(false); }
  };
  const onDoubleClickViewer = (e) => { e.preventDefault(); addPointAtClientXY(e.clientX, e.clientY); };

  // pan & zoom – miš
  const onMouseDown = (e) => { if (e.button !== 0) return; if (!captureRef.current) return;
    panState.current = { panning:true, startX:e.clientX, startY:e.clientY, originX:offset.x, originY:offset.y }; };
  const onMouseMove = (e) => {
    if (!panState.current.panning) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    setOffset((prev) => clampOffset({ x: panState.current.originX + dx, y: panState.current.originY + dy }, zoom));
  };
  const onMouseUp = () => { panState.current.panning = false; };

  // scroll = pan, Ctrl/Cmd + scroll = zoom
  const onWheel = (e) => {
    if (!captureRef.current) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = captureRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left - offset.x;
      const my = e.clientY - rect.top - offset.y;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      const newZoom = clamp(zoom * factor, 1, 4);
      const newOffset = { x: mx - (mx * newZoom) / zoom + offset.x, y: my - (my * newZoom) / zoom + offset.y };
      const clamped = clampOffset(newOffset, newZoom);
      setZoom(newZoom); setOffset(clamped);
    } else {
      const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
      const dy = -e.deltaY;
      setOffset((prev) => clampOffset({ x: prev.x + (dx || 0), y: prev.y + dy }, zoom));
    }
  };

  // touch: pan + pinch
  const touchState = useRef({ touches: [], lastDist: 0 });
  const getDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  const onTouchStart = (e) => {
    const ts = e.touches;
    if (ts.length === 1) {
      panState.current = { panning:true, startX:ts[0].clientX, startY:ts[0].clientY, originX:offset.x, originY:offset.y };
    } else if (ts.length === 2) {
      touchState.current.touches = [ts[0], ts[1]];
      touchState.current.lastDist = getDist(ts[0], ts[1]);
    }
  };
  const onTouchMove = (e) => {
    const ts = e.touches;
    if (ts.length === 1 && panState.current.panning) {
      const dx = ts[0].clientX - panState.current.startX;
      const dy = ts[0].clientY - panState.current.startY;
      setOffset((prev) => clampOffset({ x: panState.current.originX + dx, y: panState.current.originY + dy }, zoom));
    } else if (ts.length === 2) {
      const dist = getDist(ts[0], ts[1]);
      const factor = dist / (touchState.current.lastDist || dist);
      const newZoom = clamp(zoom * factor, 1, 4);
      setZoom(newZoom);
      setOffset((prev) => clampOffset(prev, newZoom));
      touchState.current.lastDist = dist;
    }
  };
  const onTouchEnd = () => { panState.current.panning = false; touchState.current.touches = []; };

  // uredi/obriši točku
  const editPoint = (globalIdx) => {
    const p = points[globalIdx]; if (!p) return;
    const title = window.prompt("Naziv točke:", p.title || "") ?? p.title;
    const d = new Date();
    const dateDefault = p.dateISO || d.toISOString().slice(0, 10);
    const dateISO = window.prompt("Datum (YYYY-MM-DD):", dateDefault) ?? dateDefault;
    const note = window.prompt("Komentar (opcionalno):", p.note || "") ?? p.note;
    const initials = window.prompt("Inicijali (opcionalno):", p.authorInitials || userInitials || "") ?? (p.authorInitials || userInitials || "");
    const next = [...points];
    next[globalIdx] = { ...p, title, dateISO, timeISO: "", note, authorInitials: (initials || "").toUpperCase(), x: clamp01(p.x), y: clamp01(p.y) };
    setPoints(next);
  };
  const deletePoint = (globalIdx) => { if (window.confirm("Obrisati točku?")) setPoints((prev) => prev.filter((_, i) => i !== globalIdx)); };

  // foto pickeri (kamera/galerija + edit)
  const onPickCamera = () => cameraInputRef.current?.click();
  const onPickGallery = () => galleryInputRef.current?.click();
const onCameraSelected = async (e) => {
  const f = e.target.files?.[0]; e.target.value="";
  if (!f) return;
  const dataURL = await readAndCompress(f);
  setStagedPhoto(dataURL);
  setStagedNotice(true);
  setPanFocus(false); // olakšaj dodavanje
};

const onGallerySelected = async (e) => {
  const f = e.target.files?.[0]; e.target.value="";
  if (!f) return;
  const dataURL = await readAndCompress(f);
  setStagedPhoto(dataURL);
  setStagedNotice(true);
  setPanFocus(false); // olakšaj dodavanje
};
  const onEditPhotoSelected = async (e) => { const file = e.target.files?.[0]; e.target.value=""; if (!file || !photoEditTargetId) return; const dataURL = await readAndCompress(file); setPoints((prev) => prev.map((p) => (p.id === photoEditTargetId ? { ...p, imageData: dataURL } : p))); setPhotoEditTargetId(null); };
  const startEditPhoto = (pointId) => { setPhotoEditTargetId(pointId); editPhotoInputRef.current?.click(); };
  const removePhotoFromPoint = (pointId) => { if (!window.confirm("Ukloniti fotku s ove točke?")) return; setPoints((prev) => prev.map((p) => (p.id === pointId ? { ...p, imageData: null } : p))); };

  // ===== Screenshot export (ostaje kao opcija) =====
  const snapshotFitToCanvas = async () => {
    const prev = { zoom, offset };
    setZoom(1); setOffset({ x: 0, y: 0 });
    await new Promise((r) => setTimeout(r, 80));
    const node = document.getElementById("pdf-capture-area");
    const canvas = await html2canvas(node, { scale: 2 });
    setZoom(prev.zoom); setOffset(prev.offset);
    await new Promise((r) => setTimeout(r, 0));
    return canvas;
  };
  const exportNacrtScreenshot = async () => {
    const canvas = await snapshotFitToCanvas();
    const img = canvas.toDataURL("image/png");
    const isLandscape = canvas.width >= canvas.height;
    const pdf = new jsPDF({ orientation: isLandscape ? "landscape" : "portrait", unit: "mm", format: exportSize });
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const imgRatio = canvas.width / canvas.height, pageRatio = pageW / pageH;
    let w, h;
    if (imgRatio > pageRatio) { w = pageW - 12; h = w / imgRatio; } else { h = pageH - 12; w = h * imgRatio; }
    const x = (pageW - w) / 2, y = (pageH - h) / 2;
    pdf.addImage(img, "PNG", x, y, w, h);
    pdf.save(`nacrt_${exportSize}.pdf`);
  };

  // ===== Original PDF export (trenutna stranica) =====
  const exportNacrtOriginal = async () => {
    const src = pdfs[activePdfIdx];
    if (!src) return window.alert("Nema aktivnog nacrta.");
    try {
      const uint8 = new Uint8Array(src.data);
      const pdfDoc = await PDFDocument.load(uint8);
      const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const page = pdfDoc.getPage((pageNumber || 1) - 1);
      const { width: pw, height: ph } = page.getSize();

      const pts = points.filter((p) => p.pdfIdx === activePdfIdx && p.page === pageNumber).sort((a,b)=>a.id-b.id);
      const circleR = Math.max(pw, ph) * 0.012;
      pts.forEach((p, i) => {
        const cx = (p.x || 0) * pw;
        const cy = (1 - (p.y || 0)) * ph;
        const label = String(i + 1);
        page.drawCircle({ x: cx, y: cy, size: circleR, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: circleR * 0.18, color: rgb(0.79, 0.64, 0.15) });
        const fs = circleR * 0.9;
        const tw = helvBold.widthOfTextAtSize(label, fs);
        const th = helvBold.heightAtSize(fs);
        page.drawText(label, { x: cx - tw / 2, y: cy - th / 3, size: fs, font: helvBold, color: rgb(0.1, 0.1, 0.1) });
      });

      const outBytes = await pdfDoc.save();
      const blob = new Blob([outBytes], { type: "application/pdf" });
      saveAs(blob, `${src.name || "NACRT"}-str${pageNumber}.pdf`);
    } catch (e) { console.error(e); window.alert("Greška pri exportu originalnog PDF-a."); }
  };

  // ===== Excel (trenutna stranica) =====
  const exportExcel = () => {
    const sorted = pointsOnCurrent.slice().sort((a, b) => a.id - b.id);
    const rows = sorted.map((p, i) => ({
      RedniBroj: i + 1,
      Naziv: p.title || "",
      Datum: p.dateISO || "",
      Vrijeme: p.timeISO || "",
      Komentar: p.note || "",
      "Unos (inicijali)": p.authorInitials || "",
      Nacrt: pdfs[p.pdfIdx]?.name || "",
      Stranica: p.page, X: p.x, Y: p.y,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tocke");
    XLSX.writeFile(wb, "tocke.xlsx");
  };

  // Contact sheet 9/str
  const exportFotoContactSheet = () => {
    const pts = points.filter((p) => p.imageData).slice().sort((a,b)=>a.id-b.id);
    if (!pts.length) return window.alert("Nema fotografija za ispis.");
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const cols = 3, rows = 3, margin = 8;
    const cellW = (pageW - margin*2) / cols;
    const cellH = (pageH - margin*2) / rows;

    const getOrdinal = (p) => {
      const arr = points.filter((q) => q.pdfIdx === p.pdfIdx && q.page === p.page).sort((a,b)=>a.id-b.id);
      return (arr.findIndex((q) => q.id === p.id) + 1) || "";
    };

    pts.forEach((p, idx) => {
      if (idx && idx % (cols*rows) === 0) pdf.addPage();
      const cellX = idx % cols;
      const cellY = Math.floor(idx / cols) % rows;
      const x = margin + cellX * cellW;
      const y = margin + cellY * cellH;

      const imgW = cellW - 8;
      const imgH = cellH - 18;
      const cx = x + (cellW - imgW)/2;
      const cy = y + 4;

      try { pdf.addImage(p.imageData, "JPEG", cx, cy, imgW, imgH); } catch {}
      const ord = getOrdinal(p);
      pdf.setFontSize(10);
      pdf.text(`${ord}. ${p.title || ""}`, x + 4, y + cellH - 6, { baseline: "bottom" });
    });

    pdf.save("fotografije_9_po_stranici.pdf");
  };

  // helperi
  const dataURLToBytes = (dataURL) => {
    const [_, b64] = String(dataURL || "").split(",");
    const bin = atob(b64 || ""); const bytes = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  // ===== Export RN (.zip) – originalni PDF-ovi sa markerima + excel + fotke =====
  const doExportZip = async () => {
    if (!activeRn) return window.alert("Nema aktivnog RN-a.");
    if (!pdfs.length) return window.alert("Nema nacrta u RN-u.");
    const state = { pdfs, activePdfIdx, pageNumber, points, seqCounter, rnName: activeRn, pageMap };
    const zip = await exportRnToZip(state);

    const folderNacrti = zip.folder("nacrti_pdf");
    const folderExcel = zip.folder("excel");
    const folderFotos = zip.folder("fotografije");

    // Excel (sve točke)
    const groups = {};
    points.forEach((p) => { const k = `${p.pdfIdx}-${p.page}`; (groups[k] ||= []).push(p); });
    const ordMap = new Map();
    Object.keys(groups).forEach((k) => { groups[k].sort((a,b)=>a.id-b.id); groups[k].forEach((p,i)=>ordMap.set(p.id,i+1)); });

    const excelRows = points
      .slice()
      .sort((a,b)=>(a.pdfIdx-b.pdfIdx)||(a.page-b.page)||(a.id-b.id))
      .map((p)=>({
        RedniBroj: ordMap.get(p.id) ?? "",
        Naziv: p.title || "",
        Datum: p.dateISO || "",
        Vrijeme: p.timeISO || "",
        Komentar: p.note || "",
        "Unos (inicijali)": p.authorInitials || "",
        Nacrt: pdfs[p.pdfIdx]?.name || "",
        Stranica: p.page ?? "",
        X: p.x ?? "",
        Y: p.y ?? "",
        ImaFotku: p.imageData ? "DA" : "NE",
      }));
    const ws = XLSX.utils.json_to_sheet(excelRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tocke");
    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    folderExcel.file("tocke.xlsx", excelBuffer);

    // Originalni PDF-ovi sa markerima (po stranici)
    const sanitize = (s) => (s || "").replace(/[\\/:*?"<>|]+/g, "_");
    for (let i = 0; i < pdfs.length; i++) {
      try {
        const srcBytes = new Uint8Array(pdfs[i].data);
        const srcDoc = await PDFDocument.load(srcBytes);
        const helvBold = await srcDoc.embedFont(StandardFonts.HelveticaBold);

        const totalPages = srcDoc.getPageCount();
        for (let p = 1; p <= totalPages; p++) {
          const page = srcDoc.getPage(p - 1);
          const { width: pw, height: ph } = page.getSize();

          const pts = points
            .filter((pt) => pt.pdfIdx === i && pt.page === p)
            .slice()
            .sort((a,b)=>a.id-b.id);

          if (pts.length) {
            const circleR = Math.max(pw, ph) * 0.012;
            pts.forEach((pt, idxOnPage) => {
              const cx = (pt.x || 0) * pw;
              const cy = (1 - (pt.y || 0)) * ph;
              const label = String(idxOnPage + 1);
              page.drawCircle({ x: cx, y: cy, size: circleR, borderColor: rgb(0.1,0.1,0.1), borderWidth: circleR*0.18, color: rgb(0.79,0.64,0.15) });
              const fs = circleR*0.9;
              const tw = helvBold.widthOfTextAtSize(label, fs);
              const th = helvBold.heightAtSize(fs);
              page.drawText(label, { x: cx - tw/2, y: cy - th/3, size: fs, font: helvBold, color: rgb(0.1,0.1,0.1) });
            });
          }

          const singleDoc = await PDFDocument.create();
          const [copied] = await singleDoc.copyPages(srcDoc, [p - 1]);
          singleDoc.addPage(copied);
          const outBytes = await singleDoc.save();
          const pdfName = sanitize(pdfs[i].name || `PDF${i + 1}`);
          folderNacrti.file(`${pdfName}-str${p}.pdf`, outBytes);
        }
      } catch (e) { console.error("Greška pri dodavanju PDF-a u ZIP:", e); }
    }

    // Fotografije
    points.forEach((pt) => {
      if (!pt.imageData) return;
      const ord = ordMap.get(pt.id) ?? 0;
      const pdfName = sanitize(pdfs[pt.pdfIdx]?.name || `PDF${pt.pdfIdx + 1}`);
      const titlePart = sanitize(pt.title || "foto");
      const base64 = (pt.imageData || "").split(",")[1] || "";
      folderFotos.file(`${ord}_${titlePart}_${pdfName}.jpg`, base64, { base64: true });
    });

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `${activeRn}-${stamp}.zip`);
  };

  // ===== Elaborat ZIP – originalni PDF-ovi + excel + fotografije =====
  const exportElaborat = async () => {
    if (!activeRn) return window.alert("Nema aktivnog RN-a.");
    if (!pdfs.length) return window.alert("Nema nacrta u RN-u.");

    const zip = new JSZip();
    const folderExcel = zip.folder("excel");
    const folderNacrti = zip.folder("nacrti_pdf");
    const folderFotos = zip.folder("fotografije");

    // Excel svih točaka (sortirano)
    const groups = {};
    points.forEach((p) => { const k = `${p.pdfIdx}-${p.page}`; (groups[k] ||= []).push(p); });
    const ordMap = new Map();
    Object.keys(groups).forEach((k) => { groups[k].sort((a,b)=>a.id-b.id); groups[k].forEach((p,i)=>ordMap.set(p.id,i+1)); });
    const excelRows = points.slice().sort((a,b)=>(a.pdfIdx-b.pdfIdx)||(a.page-b.page)||(a.id-b.id)).map((p)=>({
      RedniBroj: ordMap.get(p.id) ?? "",
      Naziv: p.title || "",
      Datum: p.dateISO || "",
      Vrijeme: p.timeISO || "",
      Komentar: p.note || "",
      "Unos (inicijali)": p.authorInitials || "",
      Nacrt: pdfs[p.pdfIdx]?.name || "",
      Stranica: p.page ?? "",
      X: p.x ?? "",
      Y: p.y ?? "",
      ImaFotku: p.imageData ? "DA" : "NE",
    }));
    const ws = XLSX.utils.json_to_sheet(excelRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tocke");
    const excelBuffer = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    folderExcel.file("tocke.xlsx", excelBuffer);

    // PDF-ovi
    const sanitize = (s) => (s || "").replace(/[\\/:*?"<>|]+/g, "_");
    for (let i = 0; i < pdfs.length; i++) {
      try {
        const srcBytes = new Uint8Array(pdfs[i].data);
        const srcDoc = await PDFDocument.load(srcBytes);
        const helvBold = await srcDoc.embedFont(StandardFonts.HelveticaBold);
        const totalPages = srcDoc.getPageCount();

        for (let p = 1; p <= totalPages; p++) {
          const page = srcDoc.getPage(p - 1);
          const { width: pw, height: ph } = page.getSize();
          const pts = points.filter((pt) => pt.pdfIdx === i && pt.page === p).slice().sort((a,b)=>a.id-b.id);
          if (pts.length) {
            const circleR = Math.max(pw, ph) * 0.012;
            pts.forEach((pt, idxOnPage) => {
              const cx = (pt.x || 0) * pw;
              const cy = (1 - (pt.y || 0)) * ph;
              const label = String(idxOnPage + 1);
              page.drawCircle({ x: cx, y: cy, size: circleR, borderColor: rgb(0.1,0.1,0.1), borderWidth: circleR*0.18, color: rgb(0.79,0.64,0.15) });
              const fs = circleR*0.9;
              const tw = helvBold.widthOfTextAtSize(label, fs);
              const th = helvBold.heightAtSize(fs);
              page.drawText(label, { x: cx - tw/2, y: cy - th/3, size: fs, font: helvBold, color: rgb(0.1,0.1,0.1) });
            });
          }
          const singleDoc = await PDFDocument.create();
          const [copied] = await singleDoc.copyPages(srcDoc, [p - 1]);
          singleDoc.addPage(copied);
          const outBytes = await singleDoc.save();
          const pdfName = sanitize(pdfs[i].name || `PDF${i + 1}`);
          folderNacrti.file(`${pdfName}-str${p}.pdf`, outBytes);
        }
      } catch (e) { console.error("Greška pri obradi PDF-a u elaboratu:", e); }
    }

    // Fotografije
    points.forEach((pt) => {
      if (!pt.imageData) return;
      const ord = ordMap.get(pt.id) ?? 0;
      const pdfName = sanitize(pdfs[pt.pdfIdx]?.name || `PDF${pt.pdfIdx + 1}`);
      const titlePart = sanitize(pt.title || "foto");
      const base64 = (pt.imageData || "").split(",")[1] || "";
      folderFotos.file(`${ord}_${titlePart}_${pdfName}.jpg`, base64, { base64: true });
    });

    const manifest = {
      rnName: activeRn,
      exportedAt: new Date().toISOString(),
      nacrti: pdfs.map((p,i)=>({ index:i, name:p.name })),
      totals: { points: points.length, nacrti: pdfs.length, photos: points.filter(p=>p.imageData).length },
      userInitials,
      version: 2,
      format: "PDF per page with drawn markers"
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("points.json", JSON.stringify(points, null, 2));

    const blob = await zip.generateAsync({ type: "blob" });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    saveAs(blob, `ELABORAT-${activeRn}-${stamp}.zip`);
  };

  // RN UI (chipovi)
  const RnPicker = () => (
    <div className="rn-row">
      {rnList.map((rn) => (
        <div key={rn} className="rn-chip">
          <button className={`rn-btn ${activeRn === rn ? "is-active" : ""}`} onClick={() => { setActiveRn(rn); loadActiveRn(rn); }} title={`Otvori RN "${rn}"`}>
            {rn}
          </button>
          <button className="iconbtn" title="Promijeni inicijale" onClick={changeInitialsForUser}>🧾</button>
          <button className="iconbtn" title="Preimenuj RN" onClick={() => renameRn(rn)}>📝</button>
          <button className="iconbtn danger" title="Obriši RN" onClick={() => deleteRnWithConfirm(rn)}>🗑️</button>
        </div>
      ))}
      <span className="rn-count">{rnList.length}/{MAX_RN}</span>
      <button className="rn-add" onClick={createRn} title={rnList.length >= MAX_RN ? `Maksimum ${MAX_RN} RN` : "Dodaj novi RN"} disabled={rnList.length >= MAX_RN}>+</button>
    </div>
  );

  // render točke + tooltip (Naziv + Datum + inicijali u naslovu)
  const renderPoint = (p) => {
    if (panFocus) return null; // manje smetnji u pan režimu
    const isOpen = hoverPointId === p.id;
    const x = clamp01(p.x ?? 0), y = clamp01(p.y ?? 0);
    const ord = getOrdinalForPoint(p);
    const onEnter = () => { clearTimeout(hoverOutT.current); hoverInT.current = setTimeout(() => setHoverPointId(p.id), 80); };
    const onLeave = () => { clearTimeout(hoverInT.current); hoverOutT.current = setTimeout(() => setHoverPointId(null), 120); };
    const onTouch = () => { clearTimeout(hoverInT.current); clearTimeout(hoverOutT.current); setHoverPointId(p.id); setTimeout(() => setHoverPointId((cur)=>cur===p.id?null:cur), 1400); };

    let tipPos = "top";
    if (y < 0.15) tipPos = "bottom";
    if (x > 0.85) tipPos = "left";
    if (x < 0.15) tipPos = "right";

    const tipBase = {
      position: "absolute", background: "rgba(0,0,0,0.9)", color: "#fff",
      padding: "6px 8px", borderRadius: 8, whiteSpace: "nowrap", fontSize: 12,
      pointerEvents: "none", zIndex: 7, opacity: isOpen ? 1 : 0, visibility: isOpen ? "visible" : "hidden",
      transition: "opacity 120ms ease, visibility 120ms ease", maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis",
    };
    const tipStyle =
      tipPos === "top" ? { ...tipBase, left: "50%", bottom: "120%", transform: "translateX(-50%)" } :
      tipPos === "bottom" ? { ...tipBase, left: "50%", top: "120%", transform: "translateX(-50%)" } :
      tipPos === "left" ? { ...tipBase, right: "120%", top: "50%", transform: "translateY(-50%)" } :
                          { ...tipBase, left: "120%", top: "50%", transform: "translateY(-50%)" };

    return (
      <div
        key={p.id}
        style={{ position: "absolute", left: `${x*100}%`, top: `${y*100}%`, transform: "translate(-50%, -50%)", width: 36, height: 36, zIndex: 6 }}
        onMouseEnter={onEnter} onMouseLeave={onLeave} onTouchStart={onTouch} onClick={(e)=>e.stopPropagation()}
      >
        <div
          style={{
            position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
            width: 22, height: 22, borderRadius: "50%", background: deco.gold, border: `2px solid ${deco.card}`,
            boxShadow: "0 1px 4px rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 11, fontWeight: 700, color: "#1a1a1a", pointerEvents: "none",
          }}
          title={p.title || ""}
        >
          {ord}
        </div>
        <div style={tipStyle}>
          <div><strong>{p.title || "(bez naziva)"}{p.authorInitials ? ` — ${p.authorInitials}` : ""}</strong></div>
          <div style={{ opacity: 0.9 }}>{p.dateISO || "(n/a)"}</div>
        </div>
      </div>
    );
  };

  const resetView = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };

  /* -------------------------------- UI ---------------------------------- */
  return (
    <ErrorBoundary>
      {/* dijagnostika u kutu */}
      <div style={{ position:"fixed", top:8, right:8, zIndex:99999, fontSize:12, color:"#b7c6cb", background:"#10282f", border:"1px solid #12343b", borderRadius:8, padding:"6px 8px" }}>
        {mounted ? "App: OK" : "App: mounting…"} · RN:{rnList.length} · PDF:{pdfs.length}
      </div>

      <div style={{ minHeight: "100vh", background: deco.bg, color: deco.ink, fontFamily: "Inter,system-ui,Arial,sans-serif" }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: 16 }}>
          {/* HEADER */}
          <header className="header">
            <h1 className="app-title">PEPEDOT - FOTOTOČKA NANACRTU</h1>

            <div className="header-actions">
              <div className="export-wrap">
                <button
                  ref={exportBtnRef}
                  className="btn big"
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={!activeRn}
                  title={!activeRn ? "Najprije odaberi ili kreiraj RN" : "Izvoz"}
                >
                  ⬇️ Export
                </button>
                {exportOpen && (
                  <div className="export-menu">
                    <button onClick={() => { setExportOpen(false); exportExcel(); }}>Export Excel (trenutna stranica)</button>
                    <button onClick={() => { setExportOpen(false); exportNacrtOriginal(); }}>Export nacrta (ORIGINAL PDF)</button>
                    <div style={{ display:"flex", gap:6, alignItems:"center", padding:"4px 2px 4px 2px" }}>
                      <span className="muted">Screenshot format:</span>
                      <select value={exportSize} onChange={(e)=>setExportSize(e.target.value)} style={{ padding:"6px 8px", borderRadius:8, background:"#132b31", color:"#e7ecef", border:`1px solid ${deco.edge}` }}>
                        <option value="a5">A5</option>
                        <option value="a4">A4</option>
                        <option value="a3">A3</option>
                        <option value="a2">A2</option>
                        <option value="a1">A1</option>
                        <option value="a0">A0</option>
                      </select>
                    </div>
                    <button onClick={() => { setExportOpen(false); exportNacrtScreenshot(); }}>Export nacrta (SCREENSHOT)</button>
                    <button onClick={() => { setExportOpen(false); exportFotoContactSheet(); }}>Export foto 9/stranici (A4)</button>
                    <button onClick={() => { setExportOpen(false); doExportZip(); }}>Export RN (.zip)</button>
                    <button onClick={() => { setExportOpen(false); exportElaborat(); }}>Export ELABORAT (.zip)</button>
                    <hr />
                    <button onClick={() => { setExportOpen(false);
                      const input = document.createElement("input");
                      input.type = "file"; input.accept = ".zip,application/zip";
                      input.onchange = (e) => { const f = e.target.files?.[0]; if (f) doImportZip(f); };
                      input.click();
                    }}>📂 Import RN (.zip)</button>
                  </div>
                )}
              </div>

              <button className="btn" onClick={() => setPanFocus((s)=>!s)} title="Prekidač za fokus na pan/zoom (mobitel)">
                {panFocus ? "🖐️ Pan/Zoom fokus: ON" : "🖐️ Pan/Zoom fokus: OFF"}
              </button>

              <button className="btn" onClick={onPickCamera} disabled={!activeRn}>📷 Kamera</button>
              <button className="btn" onClick={onPickGallery} disabled={!activeRn}>🖼️ Galerija</button>

              <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={onCameraSelected} style={{ display: "none" }} />
              <input ref={galleryInputRef} type="file" accept="image/*" onChange={onGallerySelected} style={{ display: "none" }} />
              <input ref={editPhotoInputRef} type="file" accept="image/*" onChange={onEditPhotoSelected} style={{ display: "none" }} />
            </div>
          </header>

          {persistWarning && (
            <div style={{ ...panel, background: "#3b2b17", borderColor: "#8e5d12", color: "#fff", marginBottom: 12 }}>
              {persistWarning}
            </div>
          )}

          {/* RN */}
          <section style={{ ...panel, marginBottom: 12 }}>
            <div className="section-title">Radni nalozi</div>
            <RnPicker />
          </section>

          {/* NACRTI – prikaz i kad je 0, tipka je uvijek dostupna za aktivan RN */}
          <section style={{ ...panel, marginBottom: 12 }}>
            <div className="pdf-tabs">
              {pdfs.map((p, i) => (
                <div key={p.id} className="pdf-chip">
                  <button onClick={() => setActivePdf(i)} title={p.name || `Nacrt ${i + 1}`} className={`pdf-btn ${i === activePdfIdx ? "is-active" : ""}`}>
                    {p.name || `NACRT${i + 1}`}
                  </button>
                  <button className="iconbtn" title="Preimenuj nacrt" onClick={() => renamePdf(i)}>📝</button>
                  <button className="iconbtn danger" title="Obriši nacrt" onClick={() => deletePdfWithConfirm(i)}>🗑️</button>
                </div>
              ))}
              <span className="pdf-count">{pdfs.length}/{MAX_PDFS}</span>
              <button
                className="btn big"
                onClick={handlePdfPicker}
                disabled={!activeRn || pdfs.length >= MAX_PDFS}
                title={!activeRn ? "Najprije odaberi ili kreiraj RN" : (pdfs.length >= MAX_PDFS ? `Maksimum ${MAX_PDFS} nacrta` : "Dodaj nacrt")}
                style={{ marginLeft: "auto" }}
              >
                📄 Dodaj nacrt
              </button>
            </div>
          </section>

          {/* VIEWER */}
          <section style={{ ...panel, marginBottom: 12 }}>
            <div className="bar" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="muted">Aktivni nacrt: <strong style={{ color: deco.gold }}>{pdfs[activePdfIdx]?.name || "(nema)"}</strong></div>
              <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                <button className="btn" onClick={() => { const nz = clamp(zoom * 1.1, 1, 4); setZoom(nz); setOffset((o)=>clampOffset(o,nz)); }}>🔍 +</button>
                <button className="btn" onClick={() => { const nz = clamp(zoom * 0.9, 1, 4); setZoom(nz); setOffset((o)=>clampOffset(o,nz)); }}>🔍 −</button>
                <button className="btn" onClick={fitToPage}>🔁 Fit</button>
              </div>
            </div>

            <div
              id="pdf-capture-area"
              className="pdf-wrap"
              ref={captureRef}
              onDoubleClick={onDoubleClickViewer}
              onWheel={onWheel}
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseUp}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onClick={(e) => {
  if (stagedPhoto) {
    // ako je fotka “na čekanju”, jednim klikom dodaj točku
    addPointAtClientXY(e.clientX, e.clientY);
  }
}}
            >
              {/* Mobilni vertikalni slider za pan (samo touch) */}
{isTouch && (
  <input
    type="range"
    min="0"
    max="1000"
    defaultValue="500"
    onChange={(e) => {
      const wrap = captureRef.current;
      const inner = viewerInnerRef.current;
      if (!wrap || !inner) return;
      const wrapRect = wrap.getBoundingClientRect();
      const pageEl = inner.querySelector(".react-pdf__Page") || inner;
      const pageRect = pageEl.getBoundingClientRect();
      const baseW = pageRect.width / (zoom || 1);
      const baseH = pageRect.height / (zoom || 1);
      const contentH = baseH * zoom;
      const minY = Math.min(0, wrapRect.height - contentH);
      const maxY = 0;
      // slider 0..1000 -> minY..maxY
      const t = Number(e.target.value) / 1000;
      const y = minY + (maxY - minY) * t;
      setOffset((prev) => ({ x: prev.x, y }));
    }}
    style={{ position:"absolute", right: 6, top: 16, bottom: 16, zIndex: 20, writingMode:"bt-lr", transform:"rotate(180deg)", opacity:.8 }}
  />
)}
              {activePdfFile ? (
                <div
                  ref={viewerInnerRef}
                  style={{ position: "relative", lineHeight: 0, transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`, transformOrigin: "0 0" }}
                >
                  <Document
                    file={activePdfFile}
                    onLoadSuccess={onPdfLoadSuccess}
                    onLoadError={(e) => { console.error("PDF load error:", e); }}
                    loading={<div style={{ padding: 16 }}>Učitavanje nacrta…</div>}
                    error={<div style={{ padding: 16, color: "#f3b0b0" }}>Greška pri učitavanju nacrta.</div>}
                  >
                    <Page
                      className="pdf-page"
                      pageNumber={pageNumber}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      onRenderError={(e) => { console.error("PDF page render error:", e); }}
                    />
                  </Document>

                  {/* sloj s točkama */}
                  <div style={{ position: "absolute", inset: 0, pointerEvents: "auto", zIndex: 5 }}>
                    {pointsOnCurrent.map(renderPoint)}
                  </div>
                </div>
              ) : (
                <div style={{ padding: 24, color: "#c7d3d7" }}>
                  {activeRn ? "Dodaj nacrt (PDF) za prikaz." : "Kreiraj ili odaberi RN."}
                </div>
              )}
            </div>

            {!!pdfs.length && (
              <div className="pager">
                <button className="btn" onClick={() => setPageNumber((n) => Math.max(1, n - 1))} disabled={pageNumber <= 1}>◀︎</button>
                <div className="muted">Stranica {pageNumber} / {numPages}</div>
                <button className="btn" onClick={() => setPageNumber((n) => Math.min(numPages, n + 1))} disabled={pageNumber >= numPages}>▶︎</button>
              </div>
            )}

            {stagedNotice && stagedPhoto && (
              <div className="hint success" style={{ marginTop: 8 }}>
                Fotografija je učitana. <strong>Dupli klik/tap</strong> na nacrt postavlja točku s pridruženom fotografijom.
              </div>
            )}
          </section>

          {/* LISTA TOČAKA */}
          <section style={{ ...panel, marginBottom: 12 }}>
            <div className="bar">
              <div className="section-title">Fotografije (lista)</div>
              <div className="spacer" />
              <button className="btn" onClick={() => setShowAllSessions((s) => !s)}>{showAllSessions ? "Prikaži samo novu sesiju" : "Prikaži sve sesije"}</button>
              <button className="btn" onClick={() => setCompactList((s) => !s)}>{compactList ? "Prikaz: detaljno" : "📱 Kompaktna lista"}</button>
              <button className="btn" onClick={() => setShowPreview((s) => !s)}>{showPreview ? "Sakrij predpregled" : "Prikaži predpregled"}</button>
            </div>

            <div className={`list ${compactList ? "list-compact" : ""}`}>
              {points
                .filter((p) => (showAllSessions ? true : (p.pdfIdx === activePdfIdx && p.page === pageNumber)))
                .map((p, globalIdx) => {
                  const hasPhoto = !!p.imageData;
                  const ord = getOrdinalForPoint(p);
                  return (
                    <div key={p.id} className="card">
                      <div className="thumb">
                        {showPreview ? (hasPhoto ? <img src={p.imageData} alt="" /> : <span className="noimg">{compactList ? "—" : "bez slike"}</span>) : <span className="noimg">•</span>}
                      </div>
                      <div className="meta">
                        <div className="title">{ord != null ? `${ord}. ` : ""}{p.title || "(bez naziva)"}{p.authorInitials ? ` — ${p.authorInitials}` : ""}</div>
                        <div className="sub">{p.dateISO || "(n/a)"} · Nacrt: {pdfs[p.pdfIdx]?.name || "?"} · str: {p.page}</div>
                        {!compactList && !!p.note && <div className="note">Komentar: {p.note}</div>}
                      </div>
                      <div className="actions">
                        <button className="iconbtn" title="Uredi točku" onClick={() => editPoint(globalIdx)}>✏️</button>
                        <button className="iconbtn danger" title="Obriši točku" onClick={() => deletePoint(globalIdx)}>🗑️</button>
                        {isTouch ? (
                          <>
                            <button className="iconbtn" title={hasPhoto ? "Promijeni fotku (kamera)" : "Dodaj fotku (kamera)"} onClick={onPickCamera}>📷</button>
                            <button className="iconbtn" title={hasPhoto ? "Promijeni fotku (datoteka)" : "Dodaj fotku (datoteka)"} onClick={() => startEditPhoto(p.id)}>🖼️</button>
                          </>
                        ) : (
                          <button className="iconbtn" title={hasPhoto ? "Promijeni fotku" : "Dodaj fotku"} onClick={() => startEditPhoto(p.id)}>🖼️</button>
                        )}
                        {hasPhoto && (
                          <>
                            <button className="iconbtn warn" title="Ukloni fotku" onClick={() => removePhotoFromPoint(p.id)}>🚫</button>
                            <a className="iconbtn ghost" title="Preuzmi fotku" href={p.imageData} download={`${(ord ?? 0)}_${p.title || "foto"}_${pdfs[p.pdfIdx]?.name || "NACRT"}.jpg`}>⬇️</a>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>

          <footer className="footer">© PEPEDOT 2</footer>
        </div>
      </div>
    </ErrorBoundary>
  );
}
