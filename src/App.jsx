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
      const uint8 =
