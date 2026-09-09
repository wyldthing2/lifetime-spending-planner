import * as XLSX from "xlsx";
import { initialSnapshot, type Category, type PlannerSnapshot } from "@/lib/planner-data";

const aliases: Record<string, string> = {
  living: "Living expenses",
  "living expenses": "Living expenses",
  house: "Housing",
  housing: "Housing",
  cars: "Cars",
  car: "Cars",
  health: "Health",
  mission: "Missions",
  missions: "Missions",
  college: "College",
  unemployment: "Emergency reserve",
  "emergency reserve": "Emergency reserve",
  retirement: "Retirement",
  practice: "Practice",
};

const colors = ["#5B8C85", "#D9895B", "#7A83C2", "#C4A24A", "#C76C7B", "#8B6FAE", "#4C88A8", "#8C9A91", "#D8A0A7"];

function text(value: unknown) {
  return String(value ?? "").trim();
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!cleaned || cleaned === "n.a.") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalized(value: unknown) {
  return text(value).toLowerCase().replace(/\s+/g, " ");
}

function categoryForName(name: string, group?: Category["group"], index = 0): Category {
  const existing = initialSnapshot.categories.find((item) => item.name === name);
  if (existing) return { ...existing };
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `imported-${index}`,
    name,
    group: group ?? "Major events",
    lifetime: 0,
    annual: 0,
    peak: 2024,
    color: colors[index % colors.length],
  };
}

function groupFor(value: unknown): Category["group"] {
  const group = normalized(value);
  if (group.includes("goal") || group.includes("retire") || group.includes("reserve")) return "Goals";
  if (group.includes("recurr") || group.includes("living")) return "Recurring";
  return "Major events";
}

export function importLifetimeWorkbook(buffer: ArrayBuffer): { snapshot: PlannerSnapshot; sheetName: string; matched: number } {
  const workbook = XLSX.read(buffer, { type: "array", cellFormula: true, cellNF: true });
  const sheetName = workbook.SheetNames.find((name) => /with notes/i.test(name)) ?? workbook.SheetNames.find((name) => /latest full data/i.test(name)) ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error("The workbook has no readable sheets.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
  const imported = new Map<string, Category>();

  const headerIndex = rows.findIndex((row) => {
    const cells = row.map(normalized);
    return cells.some((cell) => cell === "category") && cells.some((cell) => cell.includes("lifetime"));
  });
  if (headerIndex >= 0) {
    const header = rows[headerIndex].map(normalized);
    const categoryColumn = header.findIndex((cell) => cell === "category");
    const groupColumn = header.findIndex((cell) => cell === "group");
    const lifetimeColumn = header.findIndex((cell) => cell.includes("lifetime"));
    const annualColumn = header.findIndex((cell) => cell.includes("annual"));
    const peakColumn = header.findIndex((cell) => cell.includes("peak"));
    rows.slice(headerIndex + 1).forEach((row, index) => {
      const label = text(row[categoryColumn]);
      if (!label) return;
      const canonical = aliases[normalized(label)] ?? label;
      const item = categoryForName(canonical, groupColumn >= 0 ? groupFor(row[groupColumn]) : undefined, index);
      item.lifetime = numberValue(row[lifetimeColumn]) ?? item.lifetime;
      item.annual = annualColumn >= 0 ? numberValue(row[annualColumn]) ?? item.annual : item.annual;
      item.peak = peakColumn >= 0 ? numberValue(row[peakColumn]) ?? item.peak : item.peak;
      imported.set(item.name, item);
    });
  }

  rows.slice(0, 25).forEach((row) => {
    const label = normalized(row[0] ?? row[1]);
    const canonical = aliases[label];
    const lifetime = numberValue(row[1] ?? row[2]);
    if (!canonical || lifetime === null) return;
    const item = categoryForName(canonical, canonical === "Living expenses" || canonical === "Health" ? "Recurring" : canonical === "Retirement" || canonical === "Emergency reserve" ? "Goals" : "Major events");
    item.lifetime = lifetime;
    imported.set(item.name, item);
  });

  const categories = imported.size ? [...imported.values()] : initialSnapshot.categories.map((item) => ({ ...item }));
  return {
    sheetName,
    matched: imported.size,
    snapshot: {
      categories,
      selectedIds: categories.map((item) => item.id),
      savedViews: [...initialSnapshot.savedViews],
      scenario: "Baseline",
      yearRange: "2024–2060",
    },
  };
}

export function createBlankWorkbook() {
  const rows = [
    ["Category", "Group", "Lifetime total", "Annual amount", "Peak year", "Notes"],
    ...initialSnapshot.categories.map((item) => [item.name, item.group, "", "", "", ""]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = [{ wch: 24 }, { wch: 16 }, { wch: 18 }, { wch: 18 }, { wch: 12 }, { wch: 34 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Planner input");
  return XLSX.write(workbook, { bookType: "xlsx", type: "array" });
}
