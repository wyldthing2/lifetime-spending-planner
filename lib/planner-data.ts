export type Category = {
  id: string;
  name: string;
  group: "Recurring" | "Major events" | "Goals";
  lifetime: number;
  annual: number;
  peak: number;
  color: string;
};

export type Scenario = "Baseline" | "No second house" | "Conservative income";

export const seedCategories: Category[] = [
  { id: "living", name: "Living expenses", group: "Recurring", lifetime: 0, annual: 0, peak: 2024, color: "#5B8C85" },
  { id: "house", name: "Housing", group: "Major events", lifetime: 0, annual: 0, peak: 2024, color: "#D9895B" },
  { id: "college", name: "College", group: "Major events", lifetime: 0, annual: 0, peak: 2024, color: "#7A83C2" },
  { id: "retirement", name: "Retirement", group: "Goals", lifetime: 0, annual: 0, peak: 2024, color: "#C4A24A" },
  { id: "cars", name: "Cars", group: "Major events", lifetime: 0, annual: 0, peak: 2024, color: "#C76C7B" },
  { id: "mission", name: "Missions", group: "Major events", lifetime: 0, annual: 0, peak: 2024, color: "#8B6FAE" },
  { id: "health", name: "Health", group: "Recurring", lifetime: 0, annual: 0, peak: 2024, color: "#4C88A8" },
  { id: "reserve", name: "Emergency reserve", group: "Goals", lifetime: 0, annual: 0, peak: 2024, color: "#8C9A91" },
  { id: "weddings", name: "Weddings", group: "Major events", lifetime: 0, annual: 0, peak: 2024, color: "#D8A0A7" },
];

export type PlannerSnapshot = {
  categories: Category[];
  selectedIds: string[];
  savedViews: string[];
  scenario: Scenario;
  yearRange: string;
};

export const initialSnapshot: PlannerSnapshot = {
  categories: seedCategories,
  selectedIds: seedCategories.map((item) => item.id),
  savedViews: ["My annual budget", "Family goals"],
  scenario: "Baseline",
  yearRange: "2024–2060",
};

