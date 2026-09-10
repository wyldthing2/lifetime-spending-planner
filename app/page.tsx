"use client";

import {
  BarChart3, CalendarRange, Check, ChevronRight, Download, FileSpreadsheet, Filter,
  GitCompare, Grid2X2, History, KeyRound, Layers3, Menu, MoreHorizontal,
  Plus, Save, Settings2, Share2, SlidersHorizontal, Sparkles, Target,
  UsersRound, Upload, X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, FormEvent } from "react";
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, type User } from "firebase/auth";
import { doc, onSnapshot, runTransaction, serverTimestamp } from "firebase/firestore";
import { firebaseConfigured, getFirebaseServices } from "@/lib/firebase";
import { createBlankWorkbook, importLifetimeWorkbook } from "@/lib/workbook-import";
import { Category, Scenario, initialSnapshot } from "@/lib/planner-data";

const navItems = [
  ["Summary", BarChart3],
  ["Full view", Grid2X2],
  ["Living expenses", Layers3],
  ["Major events", CalendarRange],
  ["Income & investing", Target],
  ["Scenario compare", GitCompare],
] as const;

const years = [2024, 2028, 2032, 2036, 2040, 2044, 2048, 2052, 2056, 2060];

function money(value: number) {
  if (Math.abs(value) >= 1000000) return "$" + (value / 1000000).toFixed(1) + "M";
  if (Math.abs(value) >= 1000) return "$" + Math.round(value / 1000) + "k";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);
}

function base64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function bytes(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function backupKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: 120000, hash: "SHA-256" }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function downloadBinaryFile(name: string, contents: ArrayBuffer, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function downloadFile(name: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

function isPlannerSnapshot(value: unknown): value is typeof initialSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<typeof initialSnapshot>;
  return Array.isArray(item.categories) && Array.isArray(item.selectedIds) && Array.isArray(item.savedViews) && typeof item.scenario === "string" && typeof item.yearRange === "string";
}

function SectionTitle({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        <h2 className="text-[17px] font-semibold tracking-[-0.02em] text-[#1c2a27]">{title}</h2>
        {description ? <p className="mt-1 text-[13px] text-[#74827d]">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function Drawer({ title, eyebrow, onClose, children }: { title: string; eyebrow: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-[#0f2c27]/25 backdrop-blur-[2px]">
      <div className="h-full w-full max-w-[430px] overflow-y-auto border-l border-[#dce9e2] bg-[#fbfdfb] p-5 shadow-[-18px_0_40px_rgba(25,61,52,0.12)] md:p-7">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#6c887d]">{eyebrow}</div>
            <h2 className="mt-2 text-[22px] font-semibold tracking-[-0.04em]">{title}</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[#80958c] hover:bg-[#edf6f1]" aria-label="Close panel"><X size={19} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Home() {
  const [activeView, setActiveView] = useState("Summary");
  const [categories, setCategories] = useState(initialSnapshot.categories);
  const [scenario, setScenario] = useState<Scenario>("Baseline");
  const [yearRange, setYearRange] = useState("2024–2060");
  const [drawer, setDrawer] = useState<"collab" | "builder" | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(initialSnapshot.selectedIds);
  const [savedViews, setSavedViews] = useState(initialSnapshot.savedViews);
  const [viewName, setViewName] = useState("");
  const [saveState, setSaveState] = useState("Connecting…");
  const [hydrated, setHydrated] = useState(false);
  const [revision, setRevision] = useState(0);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [firebaseReady, setFirebaseReady] = useState(false);
  const [authMode, setAuthMode] = useState<"signIn" | "register">("signIn");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const firebaseRef = useRef<ReturnType<typeof getFirebaseServices>>(null);
  const skipRemoteRevision = useRef(-1);
  const firebaseEnabled = firebaseConfigured();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState("");
  const [inviteCopied, setInviteCopied] = useState(false);

  useEffect(() => {
    if (!firebaseEnabled) {
      setFirebaseReady(true);
      return;
    }
    const services = getFirebaseServices();
    if (!services) {
      setFirebaseReady(true);
      return;
    }
    firebaseRef.current = services;
    return onAuthStateChanged(services.auth, (user) => {
      setFirebaseUser(user);
      setFirebaseReady(true);
    });
  }, [firebaseEnabled]);

  useEffect(() => {
    if (firebaseEnabled) return;
    let cancelled = false;
    const loadWorkspace = async () => {
      try {
        const response = await fetch("/api/workspace", { cache: "no-store" });
        if (!response.ok) throw new Error("workspace unavailable");
        const payload = await response.json() as { version: number; data: typeof initialSnapshot };
        if (cancelled) return;
        setCategories(payload.data.categories);
        setSelectedIds(payload.data.selectedIds);
        setSavedViews(payload.data.savedViews);
        setScenario(payload.data.scenario);
        setYearRange(payload.data.yearRange);
        setRevision(payload.version);
        setSaveState("Synced");
      } catch {
        if (!cancelled) setSaveState("Local preview");
      } finally {
        if (!cancelled) setHydrated(true);
      }
    };
    void loadWorkspace();
    const poll = window.setInterval(() => {
      void fetch("/api/workspace", { cache: "no-store" }).then(async (response) => {
        if (!response.ok || cancelled) return;
        const payload = await response.json() as { version: number; data: typeof initialSnapshot };
        if (payload.version <= revision) return;
        setCategories(payload.data.categories);
        setSelectedIds(payload.data.selectedIds);
        setSavedViews(payload.data.savedViews);
        setScenario(payload.data.scenario);
        setYearRange(payload.data.yearRange);
        setRevision(payload.version);
        setSaveState("Updated by collaborator");
      }).catch(() => undefined);
    }, 5000);
    return () => { cancelled = true; window.clearInterval(poll); };
  }, [revision, firebaseEnabled]);

  useEffect(() => {
    if (firebaseEnabled || !hydrated) return;
    const timer = window.setTimeout(() => {
      void fetch("/api/workspace", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: revision, data: { categories, selectedIds, savedViews, scenario, yearRange } }),
      }).then(async (response) => {
        if (response.status === 409) { setSaveState("Changed by collaborator"); return; }
        if (!response.ok) throw new Error("save failed");
        const payload = await response.json() as { version: number };
        setRevision(payload.version);
        setSaveState("Synced just now");
      }).catch(() => setSaveState("Saved locally for now"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [categories, selectedIds, savedViews, scenario, yearRange, hydrated, revision, firebaseEnabled]);

  useEffect(() => {
    if (!firebaseEnabled || !firebaseReady || !firebaseUser || !firebaseRef.current) return;
    const { db } = firebaseRef.current;
    const snapshotRef = doc(db, "workspaces", "household");
    const unsubscribe = onSnapshot(snapshotRef, (snapshot) => {
      if (!snapshot.exists()) {
        void runTransaction(db, async (transaction) => {
          const current = await transaction.get(snapshotRef);
          if (!current.exists()) {
            transaction.set(snapshotRef, { version: 1, data: initialSnapshot, updatedBy: firebaseUser.uid, updatedAt: serverTimestamp() });
          }
        });
        return;
      }
      const payload = snapshot.data() as { version?: unknown; data?: unknown };
      if (!isPlannerSnapshot(payload.data)) return;
      const version = typeof payload.version === "number" ? payload.version : 1;
      skipRemoteRevision.current = version;
      setCategories(payload.data.categories);
      setSelectedIds(payload.data.selectedIds);
      setSavedViews(payload.data.savedViews);
      setScenario(payload.data.scenario);
      setYearRange(payload.data.yearRange);
      setRevision(version);
      setHydrated(true);
      setSaveState("Synced");
    }, () => setSaveState("Firebase unavailable"));
    return unsubscribe;
  }, [firebaseEnabled, firebaseReady, firebaseUser]);

  useEffect(() => {
    if (!firebaseEnabled || !firebaseReady || !firebaseUser || !hydrated || !firebaseRef.current) return;
    if (revision === skipRemoteRevision.current) {
      skipRemoteRevision.current = -1;
      return;
    }
    const timer = window.setTimeout(() => {
      const { db } = firebaseRef.current!;
      const snapshotRef = doc(db, "workspaces", "household");
      void runTransaction(db, async (transaction) => {
        const current = await transaction.get(snapshotRef);
        const currentVersion = current.exists() && typeof current.data().version === "number" ? current.data().version as number : 0;
        if (currentVersion > revision) throw new Error("CONFLICT");
        const nextVersion = currentVersion + 1;
        transaction.set(snapshotRef, { version: nextVersion, data: { categories, selectedIds, savedViews, scenario, yearRange }, updatedBy: firebaseUser.uid, updatedAt: serverTimestamp() });
        return nextVersion;
      }).then((nextVersion) => {
        skipRemoteRevision.current = nextVersion;
        setRevision(nextVersion);
        setSaveState("Synced just now");
      }).catch((error: unknown) => setSaveState(error instanceof Error && error.message === "CONFLICT" ? "Changed by collaborator" : "Could not save to Firebase"));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [categories, selectedIds, savedViews, scenario, yearRange, hydrated, revision, firebaseEnabled, firebaseReady, firebaseUser]);

  useEffect(() => {
    let sequence = "";
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "/" && event.target instanceof HTMLElement && event.target.tagName !== "INPUT" && event.target.tagName !== "TEXTAREA") {
        setDrawer("builder");
      }
      if (event.key.toLowerCase() === "g") sequence = "g";
      else if (sequence === "g") {
        const route: Record<string, string> = { s: "Summary", f: "Full view", l: "Living expenses", m: "Major events", i: "Income & investing", c: "Scenario compare" };
        if (route[event.key.toLowerCase()]) setActiveView(route[event.key.toLowerCase()]);
        sequence = "";
      } else sequence = "";
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const factor = scenario === "No second house" ? 0.78 : scenario === "Conservative income" ? 1.08 : 1;
  const included = useMemo(() => categories.filter((item) => selectedIds.includes(item.id)), [categories, selectedIds]);
  const lifetimeTotal = included.reduce((sum, item) => sum + item.lifetime * factor, 0);
  const recurringTotal = included.filter((item) => item.group === "Recurring").reduce((sum, item) => sum + item.annual * factor, 0);
  const largest = [...included].sort((a, b) => b.lifetime - a.lifetime)[0];

  const setAnnual = (id: string, value: number) => {
    setCategories((current) => current.map((item) => item.id === id ? { ...item, annual: value } : item));
    setSaveState("Unsaved changes");
  };
  const toggleId = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const saveCustomView = () => {
    const name = viewName.trim();
    if (!name) return;
    setSavedViews((current) => [...current.filter((item) => item !== name), name]);
    setViewName("");
    setSaveState("View saved just now");
  };

  const submitAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!firebaseRef.current) return;
    setAuthError("");
    try {
      if (authMode === "register") await createUserWithEmailAndPassword(firebaseRef.current.auth, authEmail.trim(), authPassword);
      else await signInWithEmailAndPassword(firebaseRef.current.auth, authEmail.trim(), authPassword);
    } catch {
      setAuthError(authMode === "register" ? "That account could not be created. Try a different email or a password with at least 6 characters." : "Email or password not recognized.");
    }
  };

  const downloadBlankSpreadsheet = () => {
    downloadBinaryFile("lifetime-spending-planner-template.xlsx", createBlankWorkbook(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    setSaveState("Blank spreadsheet downloaded");
  };

  const importWorkbookFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setImportError("");
    try {
      const result = importLifetimeWorkbook(await file.arrayBuffer());
      setCategories(result.snapshot.categories);
      setSelectedIds(result.snapshot.selectedIds);
      setSavedViews(result.snapshot.savedViews);
      setScenario(result.snapshot.scenario);
      setYearRange(result.snapshot.yearRange);
      skipRemoteRevision.current = -1;
      setHydrated(true);
      setSaveState("Imported " + result.matched + " categories from " + result.sheetName);
    } catch {
      setImportError("That workbook could not be read. Please choose an .xlsx or .xls file.");
    }
  };

  const copyInviteLink = async () => {
    const inviteLink = window.location.href.split("#")[0];
    try {
      await navigator.clipboard.writeText(inviteLink);
      setInviteCopied(true);
      setSaveState("Invite link copied");
      window.setTimeout(() => setInviteCopied(false), 3000);
    } catch {
      window.prompt("Copy this invite link:", inviteLink);
    }
  };

  if (firebaseEnabled && firebaseReady && !firebaseUser) return <AuthScreen mode={authMode} email={authEmail} password={authPassword} error={authError} onModeChange={setAuthMode} onEmailChange={setAuthEmail} onPasswordChange={setAuthPassword} onSubmit={submitAuth} />;

  const downloadBackup = async () => {
    const password = window.prompt("Choose a password for this encrypted backup.");
    if (!password) return;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await backupKey(password, salt);
    const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as unknown as BufferSource }, key, new TextEncoder().encode(JSON.stringify({ categories, selectedIds, savedViews, scenario, yearRange })));
    downloadFile("lifetime-planner-backup.lifetime", JSON.stringify({ format: "lifetime-planner", version: 1, salt: base64(salt), iv: base64(iv), data: base64(new Uint8Array(encrypted)) }), "application/json");
    setSaveState("Encrypted backup downloaded");
  };

  const restoreBackup = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".lifetime,.json,application/json";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then(async (text) => {
        try {
          const payload = JSON.parse(text) as { salt: string; iv: string; data: string };
          const password = window.prompt("Enter the backup password.");
          if (!password) return;
          const key = await backupKey(password, bytes(payload.salt));
          const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(payload.iv) as unknown as BufferSource }, key, bytes(payload.data));
          const data = JSON.parse(new TextDecoder().decode(decrypted)) as typeof initialSnapshot;
          if (!Array.isArray(data.categories) || !Array.isArray(data.selectedIds) || !Array.isArray(data.savedViews)) throw new Error("Invalid backup");
          setCategories(data.categories);
          setSelectedIds(data.selectedIds);
          setSavedViews(data.savedViews);
          setScenario(data.scenario);
          setYearRange(data.yearRange);
          setSaveState("Restored, syncing…");
        } catch {
          setSaveState("Backup could not be opened");
        }
      });
    };
    input.click();
  };

  const downloadSpreadsheet = () => {
    const header = "Category,Group,Lifetime total,Annual amount,Peak year";
    const rows = categories.map((item) => [item.name, item.group, item.lifetime, item.annual, item.peak].map((value) => '"' + String(value).replaceAll('"', '""') + '"').join(","));
    downloadFile("lifetime-planner-export.csv", [header, ...rows].join("\\n"), "text/csv");
    setSaveState("Spreadsheet export downloaded");
  };

  const nav = (
    <nav className="space-y-1" aria-label="Planning views">
      {navItems.map(([name, Icon]) => (
        <button key={name} onClick={() => { setActiveView(name); setMobileNavOpen(false); }} className={"group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13px] transition " + (activeView === name ? "bg-[#244d47] text-white shadow-[0_5px_14px_rgba(18,51,46,0.22)]" : "text-[#afc1bb] hover:bg-[#193d38] hover:text-white")}>
          <Icon size={16} strokeWidth={1.8} /><span>{name}</span>
          {activeView === name ? <ChevronRight size={14} className="ml-auto text-[#8fdbca]" /> : null}
        </button>
      ))}
    </nav>
  );

  return (
    <main className="min-h-screen bg-[#f4f7f5] text-[#1c2a27]">
      <input ref={importInputRef} className="hidden" type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" onChange={importWorkbookFile} />
      <div className="flex min-h-screen">
        <aside className="hidden w-[242px] shrink-0 flex-col bg-[#102d29] px-4 py-5 text-white lg:flex">
          <div className="mb-9 flex items-center gap-3 px-3">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#8fdbca] text-[#153d36]"><Sparkles size={18} /></div>
            <div><div className="text-[14px] font-semibold tracking-tight">Lifetime planner</div><div className="text-[11px] text-[#9db2ab]">Shared household workspace</div></div>
          </div>
          <div className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e8c83]">Views</div>
          {nav}
          <div className="mt-7 mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#6e8c83]">Saved views</div>
          <div className="space-y-1">
            {savedViews.map((name) => <button key={name} onClick={() => { setViewName(name); setDrawer("builder"); }} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] text-[#afc1bb] hover:bg-[#193d38] hover:text-white"><BookOpenIcon />{name}</button>)}
            <button onClick={() => setDrawer("builder")} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[13px] text-[#8fdbca] hover:bg-[#193d38]"><Plus size={15} />Create a view</button>
          </div>
          <div className="mt-auto rounded-2xl border border-[#315951] bg-[#173b35] p-3.5">
            <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-[#dbefea]"><KeyRound size={14} className="text-[#8fdbca]" /> Private by default</div>
            <p className="text-[11px] leading-5 text-[#9db2ab]">Your data stays in the shared workspace. Export an encrypted backup whenever you like.</p>
            <button onClick={() => setDrawer("collab")} className="mt-3 flex items-center gap-2 text-[12px] font-medium text-[#8fdbca]">Manage sharing <ChevronRight size={14} /></button>
          </div>
        </aside>

        {mobileNavOpen ? <div className="fixed inset-0 z-30 bg-[#102d29] p-5 lg:hidden"><div className="mb-8 flex items-center justify-between"><div className="flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-[#8fdbca] text-[#153d36]"><Sparkles size={18} /></div><div className="text-sm font-semibold text-white">Lifetime planner</div></div><button onClick={() => setMobileNavOpen(false)} className="text-white" aria-label="Close menu"><X size={21} /></button></div>{nav}</div> : null}

        <section className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 flex min-h-[74px] items-center justify-between gap-4 border-b border-[#dfe9e4] bg-[#f4f7f5]/95 px-5 backdrop-blur md:px-8">
            <div className="flex items-center gap-3"><button onClick={() => setMobileNavOpen(true)} className="rounded-lg p-2 text-[#44635c] hover:bg-white lg:hidden" aria-label="Open menu"><Menu size={20} /></button><div><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#789089]"><span>Household planning</span><span className="h-1 w-1 rounded-full bg-[#8fdbca]" /><span>{saveState}</span></div><h1 className="mt-1 text-[21px] font-semibold tracking-[-0.035em] text-[#1b302b]">{activeView}</h1></div></div>
            <div className="flex items-center gap-2"><button onClick={() => setDrawer("builder")} className="hidden items-center gap-2 rounded-xl border border-[#d6e3de] bg-white px-3 py-2 text-[12px] font-medium text-[#36534c] shadow-sm sm:flex"><SlidersHorizontal size={15} /> Customize view</button><button onClick={() => setDrawer("collab")} className="flex items-center gap-2 rounded-xl bg-[#1e5a50] px-3 py-2 text-[12px] font-semibold text-white shadow-[0_5px_13px_rgba(30,90,80,0.18)]"><Share2 size={15} /><span className="hidden sm:inline">Share</span></button><button className="rounded-xl border border-[#d6e3de] bg-white p-2 text-[#526d65] shadow-sm" aria-label="More actions"><MoreHorizontal size={18} /></button></div>
          </header>

          <div className="mx-auto max-w-[1440px] px-5 py-6 md:px-8 md:py-8">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-[13px] text-[#657c74]"><span className="h-2 w-2 rounded-full bg-[#57b99f]" /> Planning model active <span className="text-[#a7b5b0]">·</span> <span>{yearRange}</span></div><div className="flex items-center gap-2"><label className="flex items-center gap-2 rounded-xl border border-[#d6e3de] bg-white px-3 py-2 text-[12px] text-[#526d65] shadow-sm"><CalendarRange size={15} /><span className="hidden sm:inline">Years</span><select value={yearRange} onChange={(event) => setYearRange(event.target.value)} className="bg-transparent font-medium outline-none"><option>2024–2060</option><option>2024–2040</option><option>2040–2060</option></select></label><label className="flex items-center gap-2 rounded-xl border border-[#d6e3de] bg-white px-3 py-2 text-[12px] text-[#526d65] shadow-sm"><GitCompare size={15} /><span className="hidden sm:inline">Scenario</span><select value={scenario} onChange={(event) => setScenario(event.target.value as Scenario)} className="max-w-[145px] bg-transparent font-medium outline-none"><option>Baseline</option><option>No second house</option><option>Conservative income</option></select></label></div></div>

            {activeView === "Summary" ? <SummaryView included={included} lifetimeTotal={lifetimeTotal} recurringTotal={recurringTotal} largest={largest} factor={factor} scenario={scenario} setActiveView={setActiveView} openCollab={() => setDrawer("collab")} openImport={() => importInputRef.current?.click()} downloadBlank={downloadBlankSpreadsheet} importError={importError} /> : null}
            {activeView === "Living expenses" ? <LivingView categories={categories} recurringTotal={recurringTotal} scenario={scenario} setAnnual={setAnnual} /> : null}
            {activeView === "Full view" ? <FullView included={included} factor={factor} /> : null}
            {activeView === "Major events" ? <MajorEvents categories={categories} factor={factor} setActiveView={setActiveView} /> : null}
            {activeView === "Income & investing" ? <IncomeView setActiveView={setActiveView} /> : null}
            {activeView === "Scenario compare" ? <ScenarioView categories={included} factor={factor} scenario={scenario} setScenario={setScenario} /> : null}
          </div>
        </section>
      </div>

      {drawer === "builder" ? <Drawer title="Make this view yours" eyebrow="View builder" onClose={() => setDrawer(null)}><div className="mt-7"><label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#71877e]">View name</label><input value={viewName} onChange={(event) => setViewName(event.target.value)} placeholder="e.g. Annual budget" className="mt-2 w-full rounded-xl border border-[#d8e6df] bg-white px-3 py-2.5 text-[13px] outline-none focus:border-[#76bda8] focus:ring-2 focus:ring-[#c6e7db]" /></div><div className="mt-7"><div className="flex items-center justify-between"><div className="text-[13px] font-semibold">Categories</div><button onClick={() => setSelectedIds(categories.map((item) => item.id))} className="text-[11px] font-semibold text-[#347a68]">Select all</button></div><div className="mt-3 space-y-2">{categories.map((item) => <button key={item.id} onClick={() => toggleId(item.id)} className="flex w-full items-center gap-3 rounded-xl border border-[#e3ece8] bg-white px-3 py-3 text-left hover:border-[#aed4c5]"><span className={"grid h-5 w-5 place-items-center rounded-md border " + (selectedIds.includes(item.id) ? "border-[#3e947d] bg-[#3e947d] text-white" : "border-[#cbdad3] bg-white text-transparent")}><Check size={13} /></span><span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} /><span className="flex-1 text-[13px] font-medium">{item.name}</span><span className="text-[11px] text-[#9aa9a4]">{item.group}</span></button>)}</div></div><div className="mt-7"><div className="text-[13px] font-semibold">Saved views</div><div className="mt-3 space-y-2">{savedViews.map((name) => <div key={name} className="flex items-center justify-between rounded-xl bg-[#f2f8f5] px-3 py-2.5 text-[12px] text-[#527067]"><span>{name}</span><Check size={14} className="text-[#49a083]" /></div>)}</div></div><div className="mt-8 flex gap-2"><button onClick={saveCustomView} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#1e5a50] px-4 py-3 text-[12px] font-semibold text-white"><Save size={15} /> Save view</button><button onClick={() => setDrawer(null)} className="rounded-xl border border-[#d8e6df] px-4 py-3 text-[12px] font-semibold text-[#5e756d]">Done</button></div><div className="mt-6 rounded-xl border border-dashed border-[#c6dbd2] bg-[#f5faf7] p-3 text-[11px] leading-5 text-[#789089]">Press <kbd className="rounded border border-[#d4e3dc] bg-white px-1.5 py-0.5 font-mono text-[10px]">/</kbd> to open this builder, or use <kbd className="rounded border border-[#d4e3dc] bg-white px-1.5 py-0.5 font-mono text-[10px]">g</kbd> then a view key to switch views.</div></Drawer> : null}
      {drawer === "collab" ? <Drawer title="Collaborate safely" eyebrow="Shared workspace" onClose={() => setDrawer(null)}><div className="mt-6 flex items-center gap-3 rounded-2xl border border-[#cfe6db] bg-[#eff9f4] p-4"><div className="grid h-9 w-9 place-items-center rounded-full bg-[#3f9b86] text-white"><UsersRound size={17} /></div><div><div className="text-[13px] font-semibold text-[#2e6254]">Private and shared</div><div className="mt-1 text-[11px] text-[#6f8d82]">Signed-in collaborators can view or edit</div></div></div><div className="mt-7"><div className="flex items-center justify-between"><div className="text-[13px] font-semibold">People</div><button onClick={copyInviteLink} className="flex items-center gap-1.5 rounded-lg bg-[#eaf5f0] px-2.5 py-1.5 text-[11px] font-semibold text-[#347a68]"><Plus size={13} /> {inviteCopied ? "Copied" : "Invite"}</button></div><div className="mt-3 space-y-2"><Person name="You" role="Owner · active now" initials="Y" color="#356c64" /></div></div><div className="mt-7"><div className="text-[13px] font-semibold">Backup and access</div><div className="mt-3 space-y-2"><BackupButton icon={DownloadIcon} title="Download encrypted backup" detail="Save a private copy on this computer" onClick={downloadBackup} /><BackupButton icon={Upload} title="Restore encrypted backup" detail="Upload a private copy from this computer" onClick={restoreBackup} /><BackupButton icon={FileSpreadsheet} title="Export to spreadsheet" detail="Keep an editable Excel copy" onClick={downloadSpreadsheet} /><BackupButton icon={History} title="View change history" detail="Restore an earlier version" /></div></div><div className="mt-7 rounded-xl border border-dashed border-[#c6dbd2] bg-[#f5faf7] p-3 text-[11px] leading-5 text-[#789089]"><KeyRound size={14} className="mb-1 text-[#4d8d7d]" /> Backups will be encrypted before they leave the app. The public website contains the app, not your financial file.</div></Drawer> : null}
    </main>
  );
}

function AuthScreen({ mode, email, password, error, onModeChange, onEmailChange, onPasswordChange, onSubmit }: { mode: "signIn" | "register"; email: string; password: string; error: string; onModeChange: (mode: "signIn" | "register") => void; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <main className="grid min-h-screen place-items-center bg-[#f4f7f5] px-5 text-[#1c2a27]"><form onSubmit={onSubmit} className="w-full max-w-[410px] rounded-3xl border border-[#dfe9e4] bg-white p-7 shadow-[0_18px_50px_rgba(32,62,53,0.08)]"><div className="mb-7"><div className="grid h-11 w-11 place-items-center rounded-2xl bg-[#8fdbca] text-[#153d36]"><Sparkles size={20} /></div><h1 className="mt-5 text-[25px] font-semibold tracking-[-0.04em]">Lifetime planner</h1><p className="mt-2 text-[13px] leading-5 text-[#74827d]">Sign in to the shared household workspace.</p></div><label className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#71877e]">Email<input required type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d8e6df] px-3 py-3 text-[13px] outline-none focus:border-[#76bda8]" /></label><label className="mt-4 block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#71877e]">Password<input required minLength={6} type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} className="mt-2 w-full rounded-xl border border-[#d8e6df] px-3 py-3 text-[13px] outline-none focus:border-[#76bda8]" /></label>{error ? <p className="mt-3 text-[12px] text-[#a14d4d]">{error}</p> : null}<button type="submit" className="mt-6 w-full rounded-xl bg-[#1e5a50] px-4 py-3 text-[13px] font-semibold text-white">{mode === "register" ? "Create account" : "Sign in"}</button><button type="button" onClick={() => onModeChange(mode === "register" ? "signIn" : "register")} className="mt-4 w-full text-[12px] font-semibold text-[#347a68]">{mode === "register" ? "Already have an account? Sign in" : "New collaborator? Create an account"}</button><p className="mt-6 rounded-xl border border-dashed border-[#c6dbd2] bg-[#f5faf7] p-3 text-[11px] leading-5 text-[#789089]">Each collaborator uses their own Firebase login. Everyone who signs in can edit this shared household workspace.</p></form></main>;
}

function BookOpenIcon() { return <span className="grid h-4 w-4 place-items-center rounded border border-[#54776e] text-[9px]">V</span>; }
function DownloadIcon() { return <Download size={15} />; }
function Person({ name, role, initials, color }: { name: string; role: string; initials: string; color: string }) { return <div className="flex items-center gap-3 rounded-xl border border-[#e3ece8] bg-white p-3"><div className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: color }}>{initials}</div><div className="flex-1"><div className="text-[12px] font-semibold">{name}</div><div className="text-[11px] text-[#91a19b]">{role}</div></div><span className="h-2 w-2 rounded-full bg-[#54b68e]" /></div>; }
function BackupButton({ icon: Icon, title, detail, onClick }: { icon: React.ComponentType<{ size?: number }>; title: string; detail: string; onClick?: () => void }) { return <button onClick={onClick} className="flex w-full items-center gap-3 rounded-xl border border-[#e3ece8] bg-white p-3 text-left hover:border-[#aed4c5]"><div className="grid h-8 w-8 place-items-center rounded-lg bg-[#f1f2fb] text-[#626a9e]"><Icon size={15} /></div><div><div className="text-[12px] font-semibold">{title}</div><div className="mt-1 text-[11px] text-[#91a19b]">{detail}</div></div></button>; }

function SummaryView({ included, lifetimeTotal, recurringTotal, largest, factor, scenario, setActiveView, openCollab, openImport, downloadBlank, importError }: { included: Category[]; lifetimeTotal: number; recurringTotal: number; largest?: Category; factor: number; scenario: Scenario; setActiveView: (name: string) => void; openCollab: () => void; openImport: () => void; downloadBlank: () => void; importError: string }) {
  return (
    <>
      <section className="mb-5 rounded-2xl border border-[#dfe9e4] bg-[#eef8f3] p-5 md:p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div><div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#4d8d7d]">Start here</div><h2 className="mt-2 text-[19px] font-semibold tracking-[-0.03em]">Build your planning model</h2><p className="mt-1 max-w-[650px] text-[13px] leading-5 text-[#638077]">Fill it out directly on the site, or import the workbook you already use. The original workbook is read in your browser; only the planning model is saved to the shared workspace.</p></div>
          <div className="flex shrink-0 flex-wrap gap-2"><button onClick={openImport} className="rounded-xl bg-[#1e5a50] px-3 py-2.5 text-[12px] font-semibold text-white">Import workbook</button><button onClick={downloadBlank} className="rounded-xl border border-[#bed8cc] bg-white px-3 py-2.5 text-[12px] font-semibold text-[#347a68]">Download blank template</button></div>
        </div>
        {importError ? <p className="mt-3 text-[12px] text-[#a14d4d]">{importError}</p> : null}
      </section>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Lifetime plan" value={money(lifetimeTotal)} note={included.length + " categories included"} icon={BarChart3} color="teal" />
        <Metric label="Recurring baseline" value={money(recurringTotal)} note="Annual expenses in 2024" icon={CalendarRange} color="sand" />
        <Metric label="Largest driver" value={largest?.name || "None"} note={largest ? money(largest.lifetime * factor) : "—"} icon={Layers3} color="blue" />
        <Metric label="Funding check" value="On track" note="No gap in the selected range" icon={Check} color="green" />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <section className="rounded-2xl border border-[#dfe9e4] bg-white p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)] md:p-6">
          <SectionTitle title="Spending over time" description="Recurring costs and major events across the selected planning horizon" action={<button className="rounded-lg border border-[#e0e9e5] p-2 text-[#6e837b]" aria-label="Filter chart"><Filter size={15} /></button>} />
          <div className="relative mt-7 h-[238px]"><div className="absolute inset-0 flex flex-col justify-between"><div className="border-t border-dashed border-[#e7eeeb]" /><div className="border-t border-dashed border-[#e7eeeb]" /><div className="border-t border-dashed border-[#e7eeeb]" /><div className="border-t border-dashed border-[#e7eeeb]" /><div className="border-t border-dashed border-[#e7eeeb]" /></div><svg viewBox="0 0 900 220" className="absolute inset-0 h-full w-full" role="img" aria-label="Annual spending rises through the 2030s and then levels out"><defs><linearGradient id="areaFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#5bb8a0" stopOpacity=".32" /><stop offset="100%" stopColor="#5bb8a0" stopOpacity=".02" /></linearGradient></defs><path d="M18 178 L115 158 L215 128 L315 89 L415 57 L515 73 L615 111 L715 136 L815 122 L882 89 L882 204 L18 204 Z" fill="url(#areaFill)" /><path d="M18 178 L115 158 L215 128 L315 89 L415 57 L515 73 L615 111 L715 136 L815 122 L882 89" fill="none" stroke="#3f9b86" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><path d="M18 190 L115 181 L215 169 L315 156 L415 143 L515 137 L615 131 L715 125 L815 119 L882 113" fill="none" stroke="#d89a68" strokeWidth="2.5" strokeDasharray="7 7" strokeLinecap="round" /></svg><div className="absolute -bottom-6 inset-x-0 flex justify-between text-[10px] font-medium text-[#91a09b]">{years.map((year) => <span key={year}>{year}</span>)}</div></div>
          <div className="mt-10 flex flex-wrap items-center gap-5 text-[11px] text-[#70827c]"><span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-[#3f9b86]" /> Total planned spending</span><span className="flex items-center gap-2"><span className="h-0.5 w-4 border-t-2 border-dashed border-[#d89a68]" /> Recurring baseline</span><span className="ml-auto text-[#9aa9a4]">Peak year: 2040</span></div>
        </section>
        <section className="rounded-2xl border border-[#dfe9e4] bg-[#193e37] p-5 text-white shadow-[0_8px_22px_rgba(32,62,53,0.10)] md:p-6"><div className="text-[10px] font-semibold uppercase tracking-[0.15em] text-[#8ebbb0]">Scenario lens</div><h2 className="mt-2 text-[21px] font-semibold tracking-[-0.04em]">{scenario}</h2><p className="mt-5 text-[13px] leading-5 text-[#bad1c9]">Change one assumption and see every view update from the same planning model.</p><div className="mt-7 border-t border-[#376056] pt-4"><div className="flex items-center justify-between text-[12px] text-[#a9c6bd]"><span>Compared with baseline</span><span className="font-semibold text-[#a0dfce]">{scenario === "Baseline" ? "—" : scenario === "No second house" ? "−22%" : "+8%"}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[#31584f]"><div className="h-full rounded-full bg-[#8fdbca]" style={{ width: scenario === "No second house" ? "44%" : scenario === "Conservative income" ? "67%" : "53%" }} /></div></div><button onClick={() => setActiveView("Scenario compare")} className="mt-8 flex items-center gap-2 text-[12px] font-semibold text-[#a0dfce]">Open comparison <ChevronRight size={15} /></button></section>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <section className="rounded-2xl border border-[#dfe9e4] bg-white p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)] md:p-6"><SectionTitle title="Where the plan goes" description="Click into a category to edit its drivers" action={<button onClick={() => setActiveView("Full view")} className="flex items-center gap-1 text-[12px] font-semibold text-[#2d7767]">Full detail <ChevronRight size={14} /></button>} /><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left"><thead><tr className="border-b border-[#e7eeeb] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#91a09b]"><th className="pb-3">Category</th><th className="pb-3">Lifetime</th><th className="pb-3">Share</th><th className="pb-3">Peak year</th></tr></thead><tbody>{included.slice(0, 7).map((item) => <tr key={item.id} className="border-b border-[#edf2ef] last:border-0"><td className="py-3.5"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />{item.name}</td><td className="py-3.5 text-[13px] font-semibold">{money(item.lifetime * factor)}</td><td className="py-3.5 text-[12px] text-[#75877f]">{lifetimeTotal ? Math.round((item.lifetime * factor / lifetimeTotal) * 100) + "%" : "0%"}</td><td className="py-3.5 text-[12px] text-[#75877f]">{item.peak}</td></tr>)}</tbody></table></div></section>
        <section className="rounded-2xl border border-[#dfe9e4] bg-white p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)] md:p-6"><SectionTitle title="Shared activity" description="Recent changes in this workspace" action={<button onClick={openCollab} className="rounded-lg p-1.5 text-[#6e837b]" aria-label="Open collaboration"><UsersRound size={16} /></button>} /><div className="space-y-4"><Activity person="You" text="Updated the housing timing" time="4 min ago" color="#356C64" /><Activity person="You" text="Saved the baseline scenario" time="Yesterday" color="#356C64" /></div><button onClick={openCollab} className="mt-6 flex items-center gap-2 rounded-lg bg-[#f0f7f4] px-3 py-2 text-[11px] font-semibold text-[#337564]"><UsersRound size={14} /> View collaborators</button></section>
      </div>
    </>
  );
}

function Metric({ label, value, note, icon: Icon, color }: { label: string; value: string; note: string; icon: React.ComponentType<{ size?: number }>; color: string }) {
  const colors: Record<string, string> = { teal: "bg-[#e0f3ed] text-[#317866]", sand: "bg-[#f8eed8] text-[#a77a25]", blue: "bg-[#e7ebfa] text-[#5962a0]", green: "bg-[#e5f4e7] text-[#43824c]" };
  return <div className="rounded-2xl border border-[#dfe9e4] bg-white p-4 shadow-[0_8px_22px_rgba(32,62,53,0.045)]"><div className={"grid h-9 w-9 place-items-center rounded-xl " + colors[color]}><Icon size={17} /></div><div className="mt-4 text-[23px] font-semibold tracking-[-0.04em] text-[#1d302b]">{value}</div><div className="mt-1 text-[12px] font-medium text-[#6a7e77]">{label}</div><div className="mt-3 text-[11px] text-[#91a09b]">{note}</div></div>;
}
function Activity({ person, text, time, color }: { person: string; text: string; time: string; color: string }) { return <div className="flex gap-3"><div className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white" style={{ background: color }}>{person[0]}</div><div><p className="text-[12px] leading-5 text-[#506861]"><span className="font-semibold text-[#294a41]">{person}</span> {text}</p><div className="mt-0.5 text-[10px] text-[#9aa9a4]">{time}</div></div></div>; }

function LivingView({ categories, recurringTotal, scenario, setAnnual }: { categories: Category[]; recurringTotal: number; scenario: Scenario; setAnnual: (id: string, value: number) => void }) {
  return <section className="rounded-2xl border border-[#dfe9e4] bg-white p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)] md:p-6"><SectionTitle title="Living expenses" description="Edit the annual baseline. Every other view reads the same values." action={<button className="flex items-center gap-2 rounded-xl bg-[#eaf5f0] px-3 py-2 text-[12px] font-semibold text-[#2c7765]"><Plus size={15} /> Add expense</button>} /><div className="mb-5 grid gap-3 sm:grid-cols-3"><Mini label="Annual baseline" value={money(recurringTotal)} /><Mini label="Per month" value={money(recurringTotal / 12)} /><Mini label="Scenario" value={scenario} /></div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead><tr className="border-b border-[#e7eeeb] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#91a09b]"><th className="pb-3">Expense</th><th className="pb-3">Type</th><th className="pb-3">Annual amount</th><th className="pb-3">Inflation</th><th className="pb-3">Applies to</th></tr></thead><tbody>{categories.filter((item) => item.group === "Recurring").map((item) => <tr key={item.id} className="border-b border-[#edf2ef] last:border-0"><td className="py-4"><span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: item.color }} />{item.name}</td><td className="py-4 text-[12px] text-[#788c84]">Recurring</td><td className="py-4"><div className="flex w-[145px] items-center rounded-lg border border-[#dbe8e2] bg-[#fbfdfc] px-2.5 focus-within:border-[#82bea9]"><span className="text-[12px] text-[#80958d]">$</span><input aria-label={item.name + " annual amount"} type="number" value={Math.round(item.annual)} onChange={(event) => setAnnual(item.id, Number(event.target.value))} className="w-full bg-transparent px-1.5 py-2 text-[13px] font-semibold outline-none" /></div></td><td className="py-4"><select className="rounded-lg border border-[#dbe8e2] bg-white px-2 py-2 text-[12px] text-[#526d65]"><option>Inflation</option><option>Fixed</option><option>Custom</option></select></td><td className="py-4 text-[12px] text-[#788c84]">Household</td></tr>)}</tbody></table></div></section>;
}
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-[#f2f8f5] p-3"><div className="text-[11px] text-[#789089]">{label}</div><div className="mt-1 text-xl font-semibold">{value}</div></div>; }

function FullView({ included, factor }: { included: Category[]; factor: number }) {
  return <section className="rounded-2xl border border-[#dfe9e4] bg-white p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)] md:p-6"><SectionTitle title="Full planning view" description="The spreadsheet-like surface, with the same shared numbers behind every view" action={<div className="flex gap-2"><button className="rounded-xl border border-[#dbe8e2] p-2 text-[#657c74]" aria-label="Download spreadsheet"><Download size={16} /></button><button className="rounded-xl border border-[#dbe8e2] p-2 text-[#657c74]" aria-label="Edit columns"><Settings2 size={16} /></button></div>} /><div className="mb-5 flex flex-wrap gap-2"><span className="flex items-center gap-2 rounded-lg bg-[#eaf5f0] px-3 py-2 text-[12px] font-semibold text-[#2d7767]"><Filter size={14} /> {included.length} categories</span><span className="rounded-lg border border-[#dbe8e2] px-3 py-2 text-[12px] text-[#647a72]">Annual</span><span className="rounded-lg border border-[#dbe8e2] px-3 py-2 text-[12px] text-[#647a72]">Nominal dollars</span></div><div className="overflow-auto rounded-xl border border-[#e3ece8]"><table className="w-full min-w-[980px] border-collapse text-left"><thead className="bg-[#f3f8f5]"><tr className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#80948b]"><th className="sticky left-0 bg-[#f3f8f5] px-4 py-3">Category</th>{years.map((year) => <th key={year} className="px-4 py-3 text-right">{year}</th>)}</tr></thead><tbody>{included.map((item) => <tr key={item.id} className="border-t border-[#edf2ef] text-[12px]"><td className="sticky left-0 bg-white px-4 py-3.5 font-medium"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />{item.name}</td>{years.map((year, index) => <td key={year} className="px-4 py-3.5 text-right text-[#5f756d]">{money((item.annual * (1 + index * 0.045) + (item.group === "Major events" ? year * 18 : 0)) * factor)}</td>)}</tr>)}<tr className="border-t-2 border-[#cdded7] bg-[#f7fbf9] text-[12px] font-semibold"><td className="sticky left-0 bg-[#f7fbf9] px-4 py-3.5">Total plan</td>{years.map((year) => <td key={year} className="px-4 py-3.5 text-right text-[#2d675a]">{money((year * 100 + 280000) * factor)}</td>)}</tr></tbody></table></div></section>;
}

function MajorEvents({ categories, factor, setActiveView }: { categories: Category[]; factor: number; setActiveView: (name: string) => void }) {
  return <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]"><div className="rounded-2xl border border-[#dfe9e4] bg-white p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)] md:p-6"><SectionTitle title="Major events" description="Large, time-bound costs that shape the lifetime plan" action={<button className="flex items-center gap-2 rounded-xl bg-[#eaf5f0] px-3 py-2 text-[12px] font-semibold text-[#2c7765]"><Plus size={15} /> Add event</button>} /><div className="space-y-2">{categories.filter((item) => item.group === "Major events").map((item) => <div key={item.id} className="flex flex-wrap items-center gap-4 rounded-xl border border-[#e6eeea] p-4 hover:border-[#b9d9cc]"><div className="grid h-9 w-9 place-items-center rounded-xl" style={{ background: item.color + "22", color: item.color }}><CalendarRange size={17} /></div><div className="min-w-[160px] flex-1"><div className="text-[13px] font-semibold">{item.name}</div><div className="mt-1 text-[11px] text-[#8a9b94]">Peak in {item.peak} · Scheduled event</div></div><div className="text-right"><div className="text-[15px] font-semibold">{money(item.lifetime * factor)}</div><div className="mt-1 text-[11px] text-[#8a9b94]">lifetime total</div></div></div>)}</div></div><div className="rounded-2xl border border-[#dfe9e4] bg-[#fffaf0] p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)]"><div className="text-[12px] font-semibold text-[#8d6e29]">Planning note</div><p className="mt-3 text-[13px] leading-6 text-[#7d6b45]">Housing, college, cars, and missions are easier to reason about when their timing is visible beside the recurring baseline.</p><button onClick={() => setActiveView("Full view")} className="mt-6 flex items-center gap-2 text-[12px] font-semibold text-[#9c7625]">Show on timeline <ChevronRight size={14} /></button></div></section>;
}

function IncomeView({ setActiveView }: { setActiveView: (name: string) => void }) {
  return <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_330px]"><div className="rounded-2xl border border-[#dfe9e4] bg-white p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)] md:p-6"><SectionTitle title="Income and investing" description="Separate cash available, savings, and long-term goals from consumption expenses" /><div className="grid gap-3 sm:grid-cols-3"><Mini label="Starting income" value="$50,000" /><Mini label="Annual growth" value="4.0%" /><Mini label="Investing rate" value="15%" /></div><div className="mt-6 rounded-xl border border-[#e6eeea] p-4"><div className="mb-4 flex items-center justify-between"><div className="text-[13px] font-semibold">Cash available vs plan</div><div className="text-[11px] text-[#8a9b94]">annual view</div></div><div className="space-y-3">{years.slice(0, 6).map((year, index) => <div key={year} className="flex items-center gap-3"><div className="w-10 text-[11px] text-[#82958d]">{year}</div><div className="h-2 flex-1 overflow-hidden rounded-full bg-[#edf3ef]"><div className="h-full rounded-full bg-[#5cab96]" style={{ width: (36 + index * 8) + "%" }} /></div><div className="w-16 text-right text-[11px] font-semibold text-[#547069]">{money(164000 + index * 41000)}</div></div>)}</div></div></div><div className="rounded-2xl border border-[#dfe9e4] bg-[#193e37] p-5 text-white shadow-[0_8px_22px_rgba(32,62,53,0.10)]"><div className="flex items-center gap-2 text-[#a0dfce]"><Target size={16} /><span className="text-[12px] font-semibold">Goal lens</span></div><h2 className="mt-3 text-[21px] font-semibold tracking-[-0.04em]">Retirement stays funded</h2><p className="mt-3 text-[13px] leading-5 text-[#bad1c9]">Goals stay separate from annual spending so you can see what is consumed and what is being built.</p><button onClick={() => setActiveView("Summary")} className="mt-7 flex items-center gap-2 text-[12px] font-semibold text-[#a0dfce]">Back to summary <ChevronRight size={15} /></button></div></section>;
}

function ScenarioView({ categories, factor, scenario, setScenario }: { categories: Category[]; factor: number; scenario: Scenario; setScenario: (value: Scenario) => void }) {
  const total = categories.reduce((sum, item) => sum + item.lifetime, 0);
  return <section className="rounded-2xl border border-[#dfe9e4] bg-white p-5 shadow-[0_8px_22px_rgba(32,62,53,0.045)] md:p-6"><SectionTitle title="Compare scenarios" description="Change the lens without duplicating the planning model" action={<button onClick={() => setScenario("Baseline")} className="rounded-xl border border-[#dbe8e2] px-3 py-2 text-[12px] font-semibold text-[#4d675f]">Reset baseline</button>} /><div className="grid gap-4 md:grid-cols-3">{(["Baseline", "No second house", "Conservative income"] as Scenario[]).map((name) => { const multiplier = name === "No second house" ? .78 : name === "Conservative income" ? 1.08 : 1; return <button key={name} onClick={() => setScenario(name)} className={"rounded-2xl border p-5 text-left transition " + (scenario === name ? "border-[#78bba7] bg-[#f0f9f5] shadow-[0_0_0_3px_rgba(120,187,167,0.12)]" : "border-[#e3ece8] bg-white hover:border-[#bedacf]")}><div className="flex items-center justify-between"><div className="text-[14px] font-semibold">{name}</div>{scenario === name ? <span className="grid h-6 w-6 place-items-center rounded-full bg-[#2f816d] text-white"><Check size={14} /></span> : null}</div><div className="mt-6 text-[25px] font-semibold tracking-[-0.04em]">{money(total * multiplier)}</div><div className="mt-1 text-[11px] text-[#82958d]">estimated lifetime plan</div><div className="mt-5 h-2 overflow-hidden rounded-full bg-[#e6efeb]"><div className="h-full rounded-full bg-[#5cab96]" style={{ width: (multiplier * 50) + "%" }} /></div></button>; })}</div><div className="mt-6 rounded-xl bg-[#f7faf8] p-4 text-[12px] leading-5 text-[#647a72]"><span className="font-semibold text-[#38574d]">How this works:</span> scenarios change assumptions, not presentation. Saved views remain reusable across all options. Current lens: {scenario} ({factor.toFixed(2)}x).</div></section>;
}
