import React, { useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { exportRnToZip } from "./exportRn";
import { importRnFromZip } from "./importRn";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";
import "./responsive.css";

pdfjs.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;

export default function App() {
  const STORAGE_PREFIX = "pepedot2_rn_";
  const MAX_PDFS = 10;
  const MAX_RN = 10;

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
    boxShadow: "0 1px 0 rgba(255,255,255,0.03) inset, 0 6px 24px rgba(0,0,0,0.25)",
  };

  // RN / spremanje
  const [rnList, setRnList] = useState([]);
  const [activeRn, setActiveRn] = useState("");
  const [persistWarning, setPersistWarning] = useState("");

  // PDF + točke
  const [pdfs, setPdfs] = useState([]);
  const [activePdfIdx, setActivePdfIdx] = useState(0);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageMap, setPageMap] = useState({});
  const [numPages, setNumPages] = useState(1);

  // Točke
  const [points, setPoints] = useState([]);
  const [seqCounter, setSeqCounter] = useState(0);

  // Lista/UX
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [compactList, setCompactList] = useState(false);
  const [showPreview, setShowPreview] = useState(false); // “Predpregled” default OFF

  // Dodavanje točke – RUČNI prekidač
  const [addPointMode, setAddPointMode] = useState(false);

  // Korisnik – inicijali
  const [userInitials, setUserInitials] = useState(() => localStorage.getItem("pepedot2_user_initials") || "");

  // Foto staging
  const [stagedPhoto, setStagedPhoto] = useState(null);
  const [stagedNotice, setStagedNotice] = useState(false);

  // Tooltip/hover
  const [hoverPointId, setHoverPointId] = useState(null);
  const hoverInT = useRef(null);
  const hoverOutT = useRef(null);

  // Edit fotke postojeće točke
  const [photoEditTargetId, setPhotoEditTargetId] = useState(null);
  const editPhotoInputRef = useRef(null);

  // Export dropdown
  const [exportOpen, setExportOpen] = useState(false);
  const exportBtnRef = useRef(null);

  // Viewer (pan & zoom)
  const captureRef = useRef(null);
  const viewerInnerRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const panState = useRef({ panning: false, startX: 0, startY: 0, originX: 0, originY: 0, moved: false });

  // mob/desktop
  const isTouch = typeof window !== "undefined" ? window.matchMedia("(pointer: coarse)").matches : false;

  // file pickeri (globalni + edit)
  const cameraInputRef = useRef(null);
  const galleryInputRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => {
      if (!exportBtnRef.current) return;
      if (!exportBtnRef.current.parentElement.contains(e.target)) setExportOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  useEffect(() => {
    return () => { clearTimeout(hoverInT.current); clearTimeout(hoverOutT.current); };
  }, []);

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const safePersist = (key, value) => {
    try {
      localStorage.setItem(key, value);
      setPersistWarning("");
    } catch {
      setPersistWarning("Upozorenje: nedovoljno prostora za spremanje svih fotografija/podataka.");
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

  useEffect(() => { setRnList(loadRnList()); }, []);

  // inicijali pri otvaranju
  useEffect(() => {
    if (!activeRn) return;
    let initials = localStorage.getItem("pepedot2_user_initials") || userInitials;
    if (!initials) {
      initials = window.prompt("Unesite svoje inicijale (npr. JN):", "") || "";
      initials = initials.toUpperCase();
      setUserInitials(initials);
      localStorage.setItem("pepedot2_user_initials", initials);
    }
  }, [activeRn]);

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
    const payload = JSON.stringify({ rnName: activeRn, pdfs, activePdfIdx, pageNumber, pageMap, points, seqCounter });
    safePersist(STORAGE_PREFIX + activeRn, payload);
  };
  useEffect(() => { persistActiveRn(); }, [activeRn, pdfs, activePdfIdx, pageNumber, points, seqCounter, pageMap]);

  // RN akcije
  const createRn = () => {
    if (rnList.length >= MAX_RN) return window.alert(`Dosegnut je maksimalan broj RN-ova (${MAX_RN}).`);
    const name = window.prompt("Naziv novog RN-a:"); if (!name) return;
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
        initials = window.prompt("Unesite svoje inicijale (npr. JN):", "") || "";
        initials = initials.toUpperCase();
        setUserInitials(initials);
        localStorage.setItem("pepedot2_user_initials", initials);
      }
    }, 0);
  };

  const renameRn = (oldName) => {
    const newName = window.prompt("Novi naziv RN-a:", oldName);
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

  // PDF
  const onPdfLoadSuccess = ({ numPages }) => setNumPages(numPages || 1);
  const setActivePdf = (idx) => { if (idx>=0 && idx<pdfs.length){ setActivePdfIdx(idx); setPageNumber(pageMap[idx] || 1);} };
  useEffect(() => { setPageMap((prev) => ({ ...prev, [activePdfIdx]: pageNumber })); }, [activePdfIdx, pageNumber]);

  const addPdf = async (file) => {
    if (pdfs.length >= MAX_PDFS) return window.alert(`Dosegnut je maksimalan broj PDF-ova (${MAX_PDFS}).`);
    try {
      const buf = await file.arrayBuffer();
      const uint8 = new Uint8Array(buf);
      const item = { id: Date.now(), name: file.name || `tlocrt-${pdfs.length + 1}.pdf`, data: Array.from(uint8), numPages: 1 };
      setPdfs((prev) => [...prev, item]);
    } catch { window.alert("Neuspješno dodavanje PDF-a."); }
  };

  const handlePdfPicker = () => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = ".pdf,application/pdf";
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      await addPdf(file);
      input.value = "";
    };
    input.click();
  };

  const renamePdf = (idx) => {
    const p = pdfs[idx]; if (!p) return;
    const newName = window.prompt("Novi naziv PDF-a:", p.name || "");
    if (!newName || newName === p.name) return;
    setPdfs((arr) => arr.map((it,i) => i===idx ? ({...it, name:newName}) : it));
  };

  const deletePdfWithConfirm = (idx) => {
    if (!pdfs.length) return;
    if (pdfs.length === 1) return window.alert("Ne možete obrisati jedini PDF u RN-u.");
    const p = pdfs[idx];
    const confirmation = window.prompt(`Za brisanje PDF-a upišite njegov naziv: "${p.name}"`);
    if (confirmation !== p.name) return window.alert("Naziv PDF-a nije ispravan, brisanje otkazano.");
    if (!window.confirm(`Obrisati PDF "${p.name}"? (točke s tog PDF-a će se obrisati)`)) return;
    const filteredPoints = points.filter((pt) => pt.pdfIdx !== idx);
    const compacted = filteredPoints.map((pt) => ({ ...pt, pdfIdx: pt.pdfIdx > idx ? pt.pdfIdx - 1 : pt.pdfIdx, x: clamp01(pt.x), y: clamp01(pt.y) }));
    const nextPdfs = pdfs.filter((_, i) => i !== idx);
    setPdfs(nextPdfs); setPoints(compacted);
    setActivePdfIdx((cur) => (idx===cur ? Math.max(0, cur-1) : (cur>idx? cur-1 : cur)));
    setPageNumber(1);
    const pm = { ...pageMap }; delete pm[idx];
    const pm2 = Object.fromEntries(Object.entries(pm).map(([k,v]) => { const n=Number(k); return [String(n>idx? n-1:n), v]; }));
    setPageMap(pm2);
  };

  // Memo PDF file
  const activePdfFile = useMemo(() => {
    const p = pdfs[activePdfIdx]; if (!p) return null;
    return { data: new Uint8Array(p.data) };
  }, [pdfs, activePdfIdx]);

  // Točke helpers
  const pointsOnCurrent = useMemo(
    () => points.filter((p) => p.pdfIdx === activePdfIdx && p.page === pageNumber),
    [points, activePdfIdx, pageNumber]
  );

  const getOrdinalForPoint = (pt) => {
    const arr = points.filter((p) => p.pdfIdx === pt.pdfIdx && p.page === pt.page).sort((a, b) => a.id - b.id);
    const idx = arr.findIndex((p) => p.id === pt.id);
    return idx >= 0 ? idx + 1 : null;
  };

  // --- Image compression (less storage) ---
  const loadImage = (src) =>
    new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  const compressDataUrl = async (dataURL, maxSide = 1600, quality = 0.82) => {
    const img = await loadImage(dataURL);
    let { width, height } = img;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", quality);
  };
  const readAndCompress = async (file) =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = async () => {
        try {
          const compressed = await compressDataUrl(fr.result);
        resolve(compressed);
        } catch (e) { reject(e); }
      };
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });

  // --- Dodavanje točke (trigger kad je addPointMode=ON) ---
  const addPointAtClientXY = (clientX, clientY) => {
    if (!captureRef.current || !viewerInnerRef.current) return;
    const rect = captureRef.current.getBoundingClientRect();

    // u lokalne (0..1) koordinate uz pan/zoom
    const localX = (clientX - rect.left - offset.x) / rect.width / zoom;
    const localY = (clientY - rect.top - offset.y) / rect.height / zoom;
    if (localX < 0 || localX > 1 || localY < 0 || localY > 1) return;

    const xx = clamp01(localX);
    const yy = clamp01(localY);

    // preblizu?
    const px = (clientX - rect.left);
    const py = (clientY - rect.top);
    const tooClose = pointsOnCurrent.some((p) => {
      const qx = (p.x * rect.width) * zoom + offset.x;
      const qy = (p.y * rect.height) * zoom + offset.y;
      return Math.hypot(qx - px, qy - py) < 18;
    });
    if (tooClose) { window.alert("Točka je preblizu postojećoj. Odaberi obližnju poziciju."); return; }

    const defTitle = `T${seqCounter + 1}`;
    const title = window.prompt("Naziv točke (npr. A123VIO):", defTitle) || defTitle;
    const d = new Date();
    const dateISO = window.prompt("Datum (YYYY-MM-DD):", d.toISOString().slice(0, 10)) || d.toISOString().slice(0, 10);
    const timeISO = window.prompt("Vrijeme (HH:MM:SS):", d.toTimeString().slice(0, 8)) || d.toTimeString().slice(0, 8);
    const note = window.prompt("Komentar (opcionalno):", "") || "";

    const newPoint = {
      id: Date.now() + Math.floor(Math.random() * 1000),
      pdfIdx: activePdfIdx, page: pageNumber,
      x: xx, y: yy,
      title, dateISO, timeISO, note,
      imageData: stagedPhoto || null,
      authorInitials: (userInitials || "").toUpperCase(),
    };
    setPoints((prev) => [...prev, newPoint]);
    setSeqCounter((n) => n + 1);
    if (stagedPhoto) { setStagedPhoto(null); setStagedNotice(false); }
  };

  // --- Pan & Zoom handlers (default ponašanje) ---
  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    if (!captureRef.current) return;
    if (addPointMode) return; // u modu dodavanja ne započinji pan
    panState.current = {
      panning: true,
      startX: e.clientX, startY: e.clientY,
      originX: offset.x, originY: offset.y,
      moved: false,
    };
  };
  const onMouseMove = (e) => {
    if (!panState.current.panning) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    if (Math.hypot(dx, dy) > 3) panState.current.moved = true;
    setOffset({ x: panState.current.originX + dx, y: panState.current.originY + dy });
  };
  const onMouseUp = (e) => {
    if (panState.current.panning) {
      panState.current.panning = false;
      return;
    }
    // ako nismo panali i addPointMode je ON – dodaj točku jednim klikom
    if (addPointMode && e.type === "mouseup") {
      addPointAtClientXY(e.clientX, e.clientY);
    }
  };

  const onWheel = (e) => {
    if (!captureRef.current) return;
    e.preventDefault();
    const rect = captureRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left - offset.x;
    const my = e.clientY - rect.top - offset.y;
    const delta = -e.deltaY;
    const factor = delta > 0 ? 1.1 : 0.9;
    const newZoom = clamp(zoom * factor, 1, 4);
    const newOffset = {
      x: mx - (mx * newZoom) / zoom + offset.x,
      y: my - (my * newZoom) / zoom + offset.y,
    };
    setZoom(newZoom);
    setOffset(newOffset);
  };

  // Touch (pan + pinch + tap za točku kad je addPointMode)
  const touchState = useRef({ touches: [], lastDist: 0 });
  const getDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);

  const onTouchStart = (e) => {
    const ts = e.touches;
    if (ts.length === 1 && !addPointMode) {
      panState.current = {
        panning: true,
        startX: ts[0].clientX, startY: ts[0].clientY,
        originX: offset.x, originY: offset.y,
        moved: false,
      };
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
      if (Math.hypot(dx, dy) > 3) panState.current.moved = true;
      setOffset({ x: panState.current.originX + dx, y: panState.current.originY + dy });
    } else if (ts.length === 2) {
      const dist = getDist(ts[0], ts[1]);
      const factor = dist / (touchState.current.lastDist || dist);
      const newZoom = clamp(zoom * factor, 1, 4);
      setZoom(newZoom);
      touchState.current.lastDist = dist;
    }
  };
  const onTouchEnd = (e) => {
    // ako je bio pan – samo ugasi
    if (panState.current.panning) {
      panState.current.panning = false;
      return;
    }
    // tap = dodaj točku kad je addPointMode
    if (addPointMode && e.changedTouches && e.changedTouches.length === 1) {
      const t = e.changedTouches[0];
      addPointAtClientXY(t.clientX, t.clientY);
    }
  };

  // Uredi/obriši točku
  const editPoint = (globalIdx) => {
    const p = points[globalIdx]; if (!p) return;
    const title = window.prompt("Naziv točke:", p.title || "") ?? p.title;
    const d = new Date();
    const dateDefault = p.dateISO || d.toISOString().slice(0, 10);
    const timeDefault = p.timeISO || d.toTimeString().slice(0, 8);
    const dateISO = window.prompt("Datum (YYYY-MM-DD):", dateDefault) ?? dateDefault;
    const timeISO = window.prompt("Vrijeme (HH:MM:SS):", timeDefault) ?? timeDefault;
    const note = window.prompt("Komentar (opcionalno):", p.note || "") ?? p.note;
    const initials = window.prompt("Inicijali (opcionalno):", p.authorInitials || userInitials || "") ?? (p.authorInitials || userInitials || "");
    const next = [...points];
    next[globalIdx] = { ...p, title, dateISO, timeISO, note, authorInitials: (initials || "").toUpperCase(), x: clamp01(p.x), y: clamp01(p.y) };
    setPoints(next);
  };
  const deletePoint = (globalIdx) => { if (window.confirm("Obrisati točku?")) setPoints((prev) => prev.filter((_, i) => i !== globalIdx)); };

  // FOTO (kamera/galerija) – kompresija
  const onPickCamera = () => cameraInputRef.current?.click();
  const onPickGallery = () => galleryInputRef.current?.click();
  const onCameraSelected = async (e) => {
    const f = e.target.files?.[0]; e.target.value="";
    if (!f) return;
    const dataURL = await readAndCompress(f);
    setStagedPhoto(dataURL);
    setStagedNotice(true);
    setAddPointMode(true); // čim je foto učitana, uključi dodavanje točke
  };
  const onGallerySelected = async (e) => {
    const f = e.target.files?.[0]; e.target.value="";
    if (!f) return;
    const dataURL = await readAndCompress(f);
    setStagedPhoto(dataURL);
    setStagedNotice(true);
    setAddPointMode(true);
  };

  // EDIT FOTKE NA POSTOJEĆOJ TOČKI
  const startEditPhoto = (pointId) => { setPhotoEditTargetId(pointId); editPhotoInputRef.current?.click(); };
  const onEditPhotoSelected = async (e) => {
    const file = e.target.files?.[0]; e.target.value="";
    if (!file || !photoEditTargetId) return;
    const dataURL = await readAndCompress(file);
    setPoints((prev) => prev.map((p) => (p.id === photoEditTargetId ? { ...p, imageData: dataURL } : p)));
    setPhotoEditTargetId(null);
  };
  const removePhotoFromPoint = (pointId) => {
    if (!window.confirm("Ukloniti fotku s ove točke?")) return;
    setPoints((prev) => prev.map((p) => (p.id === pointId ? { ...p, imageData: null } : p)));
  };

  // Exporti
  const exportExcel = () => {
    const sorted = pointsOnCurrent.slice().sort((a, b) => a.id - b.id);
    const rows = sorted.map((p, i) => ({
      RedniBroj: i + 1, Naziv: p.title || "", Datum: p.dateISO || "", Vrijeme: p.timeISO || "",
      Komentar: p.note || "", "Unos (inicijali)": p.authorInitials || "", PDF: pdfs[p.pdfIdx]?.name || "",
      Stranica: p.page, X: p.x, Y: p.y,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Tocke");
    XLSX.writeFile(wb, "tocke.xlsx");
  };

  const exportPDF = async () => {
    const node = document.getElementById("pdf-capture-area"); if (!node) return;
    const canvas = await html2canvas(node, { scale: 2 });
    const img = canvas.toDataURL("image/png");
    const isLandscape = canvas.width >= canvas.height;
    const pdf = new jsPDF({ orientation: isLandscape ? "landscape" : "portrait", unit: "mm", format: "a4" });
    const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
    const imgRatio = canvas.width / canvas.height, pageRatio = pageW / pageH;
    let w, h;
    if (imgRatio > pageRatio) { w = pageW - 12; h = w / imgRatio; } else { h = pageH - 12; w = h * imgRatio; }
    const x = (pageW - w) / 2, y = (pageH - h) / 2;
    pdf.addImage(img, "PNG", x, y, w, h);
    pdf.save("nacrt_s_tockama.pdf");
  };

  const dataURLToBytes = (dataURL) => {
    const [_, b64] = String(dataURL || "").split(",");
    const bin = atob(b64 || ""); const bytes = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  const doExportZip = async () => {
    if (!activeRn) return window.alert("Nema aktivnog RN-a.");
    if (!pdfs.length) return window.alert("Nema PDF-ova u RN-u.");
    const state = { pdfs, activePdfIdx, pageNumber, points, seqCounter, rnName: activeRn, pageMap };
    const zip = await exportRnToZip(state);
    const folderNacrti = zip.folder("nacrti");
    const snapshotNode = () => document.getElementById("pdf-capture-area");
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    for (let i = 0; i < pdfs.length; i++) {
      setActivePdf(i); await wait(150);
      const pages = pdfs[i].numPages || numPages || 1;
      for (let p = 1; p <= pages; p++) {
        setPageNumber(p); await wait(200);
        const node = snapshotNode(); if (!node) continue;
        const canvas = await html2canvas(node, { scale: 2 });
        const pngDataURL = canvas.toDataURL("image/png");
        const pdfName = (pdfs[i].name || `pdf-${i + 1}`).replace(/[\\/:*?"<>|]+/g, "_");
        folderNacrti.file(`${pdfName}-str${p}.png`, pngDataURL.split(",")[1], { base64: true });
      }
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const blob = await zip.generateAsync({ type: "blob" });
    saveAs(blob, `${activeRn}-${stamp}.zip`);
  };

  const exportElaborat = async () => {
    if (!activeRn) return window.alert("Nema aktivnog RN-a.");
    if (!pdfs.length) return window.alert("Nema PDF-ova u RN-u.");
    const zip = new JSZip();
    const folderExcel = zip.folder("excel");
    const folderNacrti = zip.folder("nacrti");
    const folderFotos = zip.folder("fotografije");

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
      PDF: pdfs[p.pdfIdx]?.name || "",
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

    const snapshotNode = () => document.getElementById("pdf-capture-area");
    const wait = (ms) => new Promise((res) => setTimeout(res, ms));
    for (let i=0;i<pdfs.length;i++){
      setActivePdf(i); await wait(150);
      const pages = pdfs[i].numPages || numPages || 1;
      for (let p=1;p<=pages;p++){
        setPageNumber(p); await wait(200);
        const node = snapshotNode(); if (!node) continue;
        const canvas = await html2canvas(node, { scale: 2 });
        const pngDataURL = canvas.toDataURL("image/png");
        const pdfName = (pdfs[i].name || `pdf-${i + 1}`).replace(/[\\/:*?"<>|]+/g, "_");
        folderNacrti.file(`${pdfName}-str${p}.png`, pngDataURL.split(",")[1], { base64: true });
      }
    }

    points.forEach((pt) => {
      if (!pt.imageData) return;
      const ord = ordMap.get(pt.id) ?? 0;
      const pdfName = (pdfs[pt.pdfIdx]?.name || `pdf-${pt.pdfIdx + 1}`).replace(/[\\/:*?"<>|]+/g, "_");
      const titlePart = (pt.title || "foto").replace(/[\\/:*?"<>|]+/g, "_");
      const bytes = dataURLToBytes(pt.imageData);
      folderFotos.file(`${ord}_${titlePart}_${pdfName}.jpg`, bytes);
    });

    const manifest = {
      rnName: activeRn, exportedAt: new Date().toISOString(),
      pdfs: pdfs.map((p,i)=>({index:i, name:p.name, numPages:p.numPages||null})),
      totals: { points: points.length, pdfs: pdfs.length },
      userInitials, version: 1,
    };
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
    zip.file("points.json", JSON.stringify(points, null, 2));

    const blob = await zip.generateAsync({ type: "blob" });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    saveAs(blob, `ELABORAT-${activeRn}-${stamp}.zip`);
  };

  const doImportZip = async (file) => {
    if (!file) return;
    if (!activeRn) return window.alert("Odaberi ili kreiraj RN prije importa.");
    try {
      const current = { pdfs, activePdfIdx, pageNumber, points, seqCounter, rnName: activeRn, pageMap };
      const backupZip = await exportRnToZip(current);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      saveAs(await backupZip.generateAsync({ type: "blob" }), `BACKUP-${activeRn}-${stamp}.zip`);
    } catch {}
    try {
      const imported = await importRnFromZip(file);
      const sanitizedPoints = (imported.points || []).map((p) => ({ ...p, x: clamp01(p.x ?? 0), y: clamp01(p.y ?? 0) }));
      setPdfs(imported.pdfs || []);
      setActivePdfIdx(imported.activePdfIdx || 0);
      setPageNumber(imported.pageNumber || 1);
      setPoints(sanitizedPoints);
      setSeqCounter(imported.seqCounter || 0);
      setPageMap(imported.pageMap || {});
      const payload = {
        rnName: activeRn, pdfs: imported.pdfs || [], activePdfIdx: imported.activePdfIdx || 0,
        pageNumber: imported.pageNumber || 1, pageMap: imported.pageMap || {}, points: sanitizedPoints, seqCounter: imported.seqCounter || 0,
      };
      localStorage.setItem(STORAGE_PREFIX + activeRn, JSON.stringify(payload));
      window.alert("Import završen.");
    } catch (e) { console.error(e); window.alert("Greška pri importu ZIP-a."); }
  };

  // RN traka (ikone + brojač + +)
  const RnPicker = () => (
    <div className="rn-row">
      {rnList.map((rn) => (
        <div key={rn} className="rn-chip">
          <button
            className={`rn-btn ${activeRn === rn ? "is-active" : ""}`}
            onClick={() => { setActiveRn(rn); loadActiveRn(rn); }}
            title={`Otvori RN "${rn}"`}
          >
            {rn}
          </button>
          <button className="iconbtn" title="Promijeni inicijale" onClick={changeInitialsForUser}>🧾</button>
          <button className="iconbtn" title="Preimenuj RN" onClick={() => renameRn(rn)}>📝</button>
          <button className="iconbtn danger" title="Obriši RN" onClick={() => deleteRnWithConfirm(rn)}>🗑️</button>
        </div>
      ))}

      <span className="rn-count">{rnList.length}/{MAX_RN}</span>

      <button
        className="rn-add"
        onClick={createRn}
        title={rnList.length >= MAX_RN ? `Maksimum ${MAX_RN} RN` : "Dodaj novi RN"}
        disabled={rnList.length >= MAX_RN}
      >
        +
      </button>
    </div>
  );

  // Tooltip “gravitira” prema centru
  const renderPoint = (p) => {
    const isOpen = hoverPointId === p.id;
    const xx = clamp01(p.x), yy = clamp01(p.y);
    const leftPercent = xx * 100, topPercent = yy * 100;
    const ord  = getOrdinalForPoint(p);

    const onEnter = () => { clearTimeout(hoverOutT.current); hoverInT.current = setTimeout(() => setHoverPointId(p.id), 80); };
    const onLeave = () => { clearTimeout(hoverInT.current); hoverOutT.current = setTimeout(() => setHoverPointId(null), 120); };
    const onTouch = () => { clearTimeout(hoverInT.current); clearTimeout(hoverOutT.current); setHoverPointId(p.id); setTimeout(() => setHoverPointId((cur) => (cur === p.id ? null : cur)), 1600); };

    const dx = xx - 0.5;
    const dy = yy - 0.5;
    let tipPos = "top";
    if (Math.abs(dx) > 0.35) tipPos = dx < 0 ? "right" : "left";
    if (yy < 0.15) tipPos = "bottom";

    const tipStyleBase = {
      position: "absolute",
      background: "rgba(0,0,0,0.9)",
      color: "#fff",
      padding: "6px 8px",
      borderRadius: 8,
      whiteSpace: "nowrap",
      fontSize: 12,
      pointerEvents: "none",
      zIndex: 7,
      opacity: isOpen ? 1 : 0,
      visibility: isOpen ? "visible" : "hidden",
      transition: "opacity 120ms ease, visibility 120ms ease",
      maxWidth: 220,
      overflow: "hidden",
      textOverflow: "ellipsis",
    };

    const tipStyle =
      tipPos === "top"
        ? { ...tipStyleBase, left: "50%", bottom: "120%", transform: "translateX(-50%)" }
        : tipPos === "bottom"
        ? { ...tipStyleBase, left: "50%", top: "120%", transform: "translateX(-50%)" }
        : tipPos === "left"
        ? { ...tipStyleBase, right: "120%", top: "50%", transform: "translateY(-50%)" }
        : { ...tipStyleBase, left: "120%", top: "50%", transform: "translateY(-50%)" }; // right

    return (
      <div
        key={p.id}
        style={{
          position: "absolute",
          left: `${leftPercent}%`,
          top: `${topPercent}%`,
          transform: `translate(-50%, -50%)`,
          width: 36, height: 36, zIndex: 6,
        }}
        onMouseEnter={onEnter} onMouseLeave={onLeave} onTouchStart={onTouch}
        onClick={(e) => e.stopPropagation()}
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
          <div style={{ opacity: 0.9 }}>Datum: {p.dateISO || "(n/a)"} · Vrijeme: {p.timeISO || "(n/a)"}</div>
          {!!p.note && <div style={{ opacity: 0.9 }}>{p.note}</div>}
        </div>
      </div>
    );
  };

  const resetView = () => { setZoom(1); setOffset({ x: 0, y: 0 }); };

  return (
    <div style={{ minHeight: "100vh", background: deco.bg, color: deco.ink, fontFamily: "Inter,system-ui,Arial,sans-serif" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", padding: 16 }}>
        {/* HEADER */}
        <header className="header">
          <h1 className="app-title">PEPEDOT - FOTOČKA NANACRTU</h1>

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
                  <button onClick={() => {
