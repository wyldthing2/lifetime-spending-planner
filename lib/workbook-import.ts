import * as XLSX from "xlsx";
import { initialSnapshot, type AnnualPlanRow, type Category, type DetailRow, type PlannerSnapshot } from "@/lib/planner-data";

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


function cellMetric(row: unknown[], index: number): number | string | null {
  const value = row[index];
  const numeric = numberValue(value);
  return numeric ?? (text(value) || null);
}

function addDetail(rows: DetailRow[], section: string, categoryId: string, label: string, metrics: Record<string, number | string | null>, notes?: string) {
  const cleaned = Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== null && value !== ""));
  if (label.trim() && Object.keys(cleaned).length) rows.push({ id: `${section}-${rows.length}`, section, categoryId, label: label.trim(), metrics: cleaned, ...(notes ? { notes } : {}) });
}

function detailedRowsFromWorkbook(rows: unknown[][]): { detailRows: DetailRow[]; annualPlan: AnnualPlanRow[] } {
  const detailRows: DetailRow[] = [];
  const add = (section: string, categoryId: string, label: string, metrics: Record<string, number | string | null>, notes?: string) => addDetail(detailRows, section, categoryId, label, metrics, notes);

  for (let index = 131; index <= 173; index += 1) {
    const row = rows[index] ?? [];
    const label = text(row[12]);
    if (label) add("Living expense drivers", "living", label, {
      monthlyPerPerson: cellMetric(row, 10),
      fixedMonthly: cellMetric(row, 24),
      insuranceAnnual: cellMetric(row, 33),
      annualTotal: cellMetric(row, 34),
    });
  }
  for (let index = 131; index <= 173; index += 1) {
    const row = rows[index] ?? [];
    const year = numberValue(row[15]);
    const total = numberValue(row[34]);
    if (year !== null && total !== null) add("Living expense timeline", "living", `Household living expenses · ${year}`, {
      year,
      people: cellMetric(row, 19),
      perPersonMonthly: cellMetric(row, 17),
      secondaryMonthly: cellMetric(row, 36),
      annualTotal: total,
      inflationFactor: cellMetric(row, 29),
      insuranceAnnual: cellMetric(row, 33),
    });
  }

  const housing = [
    { label: "Home 1", summary: 186, mortgage: 190, loan: 192, paid: 197, total: 199 },
    { label: "Home 2", summary: 201, mortgage: 203, loan: 205, paid: 210, total: 212 },
    { label: "Home 3", summary: 214, mortgage: 216, loan: 218, paid: 223, total: 229 },
  ];
  for (const item of housing) {
    const summary = rows[item.summary] ?? [];
    const mortgage = rows[item.mortgage] ?? [];
    const loan = rows[item.loan] ?? [];
    const paid = rows[item.paid] ?? [];
    const total = rows[item.total] ?? [];
    add("Housing scenarios", "house", item.label, {
      annualCost: cellMetric(summary, 10),
      startYear: cellMetric(summary, 13),
      endYear: cellMetric(summary, 14),
      mortgageAndTaxAnnual: cellMetric(mortgage, 10),
      loanPrincipal: cellMetric(loan, 17),
      apr: cellMetric(loan, 13),
      loanYears: cellMetric(loan, 14),
      utility: cellMetric(loan, 15),
      mortgagePayment: cellMetric(rows[item.mortgage + 4] ?? [], 10),
      monthsPaid: cellMetric(paid, 12),
      principalPaidDown: cellMetric(paid, 13),
      closingFees: cellMetric(paid, 14),
      propertyTaxRate: cellMetric(paid, 15),
      overallCost: cellMetric(total, 10),
    });
  }

  for (let index = 240; index <= 256; index += 1) {
    const row = rows[index] ?? [];
    const label = text(row[12]);
    if (label) add("Car cost drivers", "cars", label, { amount: cellMetric(row, 10), yearsOrCount: cellMetric(row, 14) }, text(row[13]));
  }
  for (let index = 241; index <= 275; index += 1) {
    const row = rows[index] ?? [];
    const year = numberValue(row[15]);
    const total = numberValue(row[32]);
    if (year !== null && total !== null) add("Car timeline", "cars", `Vehicle costs · ${year}`, { year, annualTotal: total, inflationFactor: cellMetric(row, 29) });
  }

  for (const index of [287, 289]) {
    const row = rows[index] ?? [];
    const label = text(row[12]);
    if (label) add("Health costs", "health", label, { annualAmount: cellMetric(row, 10), startYear: cellMetric(row, 14), endYear: cellMetric(row, 15) });
  }
  add("Health costs", "health", "Health schedule total", { lifetimeTotal: cellMetric(rows[291] ?? [], 10) });

  for (let index = 313; index <= 337; index += 1) {
    const row = rows[index] ?? [];
    const label = text(row[12]);
    if (label) add("Mission cost drivers", "mission", label, { amount: cellMetric(row, 10), count: cellMetric(row, 14) });
  }
  for (let index = 313; index <= 335; index += 1) {
    const row = rows[index] ?? [];
    const year = numberValue(row[15]);
    const total = numberValue(row[24]);
    if (year !== null && total !== null) add("Mission timeline", "mission", `Mission costs · ${year}`, { year, annualTotal: total, inflationFactor: cellMetric(row, 22) });
  }

  add("College cost drivers", "college", "College cost per year", { annualAmount: cellMetric(rows[349] ?? [], 10) });
  for (let index = 349; index <= 369; index += 1) {
    const row = rows[index] ?? [];
    const year = numberValue(row[15]);
    const total = numberValue(row[32]);
    if (year !== null && total !== null) add("College timeline", "college", `College costs · ${year}`, { year, annualTotal: total, inflationFactor: cellMetric(row, 29) });
  }

  add("Emergency reserve", "reserve", "Unemployment reserve", { amount: cellMetric(rows[379] ?? [], 10) }, text((rows[379] ?? [])[12]));
  for (const index of [405, 406, 407, 410, 412, 414, 416, 418, 423]) {
    const row = rows[index] ?? [];
    const label = text(row[12]) || text(row[10]);
    if (label) add("Retirement and goals", "retirement", label, { value: cellMetric(row, 10), secondaryValue: cellMetric(row, 22), year: cellMetric(row, 24), rate: cellMetric(row, 10) });
  }
  for (const index of [429, 431, 433, 435, 438, 440, 448, 450, 452, 454, 457, 459, 461]) {
    const row = rows[index] ?? [];
    const label = text(row[12]);
    if (label) add("Housing calculations", "house", label, { value: cellMetric(row, 10), startYear: cellMetric(row, 13), endYear: cellMetric(row, 14), apr: cellMetric(row, 13), years: cellMetric(row, 14) });
  }

  add("Wedding cost drivers", "weddings", "Cost per boys wedding", { amount: cellMetric(rows[471] ?? [], 10) }, text((rows[471] ?? [])[2]));
  add("Wedding cost drivers", "weddings", "Cost per girls wedding", { amount: cellMetric(rows[473] ?? [], 10) }, text((rows[473] ?? [])[2]));
  for (let index = 474; index <= 495; index += 1) {
    const row = rows[index] ?? [];
    const person = text(row[14]);
    const year = numberValue(row[15]);
    const total = numberValue(row[24]);
    if (person && year !== null) add("Wedding timeline", "weddings", person, { year, nominalCost: total, scheduledCost: cellMetric(row, 21), inflationFactor: cellMetric(row, 22) });
  }

  const annualPlan: AnnualPlanRow[] = [];
  for (let index = 17; index < 80; index += 1) {
    const row = rows[index] ?? [];
    const year = numberValue(row[15]);
    if (year === null) continue;
    annualPlan.push({
      year,
      income: numberValue(row[10]) ?? 0,
      afterInvestingAndTithing: numberValue(row[12]) ?? 0,
      houseSales: numberValue(row[13]) ?? 0,
      living: numberValue(row[17]) ?? 0,
      cars: numberValue(row[19]) ?? 0,
      housing: numberValue(row[22]) ?? 0,
      healthcare: numberValue(row[24]) ?? 0,
      college: numberValue(row[25]) ?? 0,
      missions: numberValue(row[27]) ?? 0,
      downPayments: numberValue(row[29]) ?? 0,
      investing: numberValue(row[30]) ?? 0,
      netSavings: numberValue(row[32]) ?? 0,
      accruingSavings: numberValue(row[33]) ?? 0,
    });
  }
  return { detailRows, annualPlan };
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
  const detailed = detailedRowsFromWorkbook(rows);
  const defaults: Record<string, number> = {};
  for (const row of detailed.detailRows) {
    const amount = row.metrics.annualTotal ?? row.metrics.annualAmount ?? row.metrics.amount ?? row.metrics.lifetimeTotal;
    if (typeof amount === "number" && defaults[row.categoryId] === undefined) defaults[row.categoryId] = amount;
  }
  categories.forEach((item) => {
    if (!item.annual && defaults[item.id] !== undefined) item.annual = defaults[item.id];
  });
  return {
    sheetName,
    matched: imported.size,
    snapshot: {
      categories,
      selectedIds: categories.map((item) => item.id),
      savedViews: [...initialSnapshot.savedViews],
      scenario: "Baseline",
      yearRange: "2024–2060",
      ...detailed,
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
