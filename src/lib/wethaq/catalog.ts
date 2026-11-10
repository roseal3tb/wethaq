import { gaussian, mulberry32 } from "./rng";
import { LOCATIONS, type DemandClass, type LocationFilter, type LocationId, type Part } from "./types";

const NAMES = [
  "Hydraulic Pump Assembly", "Fuel Control Unit", "Brake Disc Kit", "Main Wheel Assembly", "Starter Generator",
  "Bleed Air Valve", "Oil Filter Element", "Igniter Plug", "Fuel Nozzle", "Landing Light Assembly",
  "Pitot Static Probe", "Actuator Seal Kit", "Cabin Pressure Controller", "Avionics Cooling Fan", "Hydraulic Filter",
  "Main Tire 26x6.6", "De-icing Boot Segment", "Air Cycle Machine", "Oxygen Mask Assembly", "Fire Detector Loop",
  "Navigation Light Lens", "Servo Actuator", "Generator Control Unit", "Fuel Quantity Probe", "Engine Mount Bushing",
  "Torque Link Assembly", "Anti-skid Valve", "Windshield Wiper Motor", "Battery Cell Pack", "Static Inverter",
  "Heat Exchanger Core", "Wheel Bearing Set", "O-ring Kit", "Turbine Blade Set", "Compressor Wash Nozzle",
  "Thrust Reverser Seal", "Flap Track Roller", "Rudder Pedal Spring", "Trim Tab Hinge", "Cockpit Display Unit",
  "Air Data Computer", "Transponder Module", "VHF Antenna", "Emergency Locator Beacon", "Smoke Detector",
  "Lavatory Pump", "Galley Oven Element", "Seat Track Fitting", "Door Seal Profile", "Cargo Roller Unit",
  "Hydraulic Accumulator", "Pressure Transducer", "Temperature Sensor", "Vibration Sensor", "Chip Detector",
  "Fuel Boost Pump", "Check Valve", "Shutoff Valve", "Cable Harness", "Control Cable Assembly",
];

export const HISTORY_MONTHS = 72;
export const HOLDOUT = 12;
/** First synthetic month (Nov 2020) through Oct 2026. */
export const MONTHS: string[] = Array.from({ length: HISTORY_MONTHS }, (_, i) => {
  const d = new Date(Date.UTC(2020, 10 + i, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
});
export function futureMonths(n: number): string[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10 + i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const CLASS_PLAN: DemandClass[] = [
  ...Array<DemandClass>(8).fill("Smooth"),
  ...Array<DemandClass>(8).fill("Erratic"),
  ...Array<DemandClass>(26).fill("Intermittent"),
  ...Array<DemandClass>(18).fill("Lumpy"),
];

function buildParts(): Part[] {
  const r = mulberry32(20261110);
  const classes = [...CLASS_PLAN];
  for (let i = classes.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [classes[i], classes[j]] = [classes[j], classes[i]];
  }
  return NAMES.map((name, i) => ({
    id: `SP-${String(i + 1).padStart(3, "0")}`,
    name,
    demandClass: classes[i],
    leadTimeMonths: 1 + Math.floor(r() * 5),
    unitCostSar: Math.round((200 + r() * 18000) / 10) * 10,
  }));
}

export const PARTS: Part[] = buildParts();
export const PART_BY_ID: Map<string, Part> = new Map(PARTS.map((p) => [p.id, p]));

const PROFILE: Record<DemandClass, { p: number; cv: number }> = {
  Smooth: { p: 0.93, cv: 0.22 },
  Erratic: { p: 0.86, cv: 0.85 },
  Intermittent: { p: 0.3, cv: 0.3 },
  Lumpy: { p: 0.27, cv: 0.95 },
};
const LOC_FACTOR: Record<LocationId, number> = { CW: 1, DC: 0.62, DS: 0.38 };

export interface DemandRecord { partId: string; location: LocationId; month: string; qty: number; }

function buildDemand(): Map<string, number[]> {
  const out = new Map<string, number[]>();
  PARTS.forEach((part, pi) => {
    const r = mulberry32(9001 + pi * 131);
    const prof = PROFILE[part.demandClass];
    const mu = 3 + r() * 16;
    const trend = (r() - 0.45) * 0.006;
    for (const loc of LOCATIONS) {
      const series: number[] = [];
      for (let t = 0; t < HISTORY_MONTHS; t++) {
        const pOcc = Math.min(0.98, prof.p * (loc.id === "DS" ? 0.85 : 1));
        if (r() > pOcc) { series.push(0); continue; }
        const season = 1 + 0.18 * Math.sin((2 * Math.PI * (t + 10)) / 12 + pi);
        const sigma = Math.sqrt(Math.log(1 + prof.cv * prof.cv));
        const ln = Math.exp(gaussian(r) * sigma - (sigma * sigma) / 2);
        series.push(Math.max(1, Math.round(mu * LOC_FACTOR[loc.id] * ln * season * (1 + trend * t))));
      }
      out.set(`${part.id}|${loc.id}`, series);
    }
  });
  return out;
}

const DEMAND = buildDemand();

export function getSeries(partId: string, loc: LocationFilter): number[] {
  if (loc !== "ALL") return DEMAND.get(`${partId}|${loc}`) ?? [];
  const parts = LOCATIONS.map((l) => DEMAND.get(`${partId}|${l.id}`) ?? []);
  return Array.from({ length: HISTORY_MONTHS }, (_, t) => parts.reduce((s, p) => s + (p[t] ?? 0), 0));
}

export function demandRecordCount(): number {
  let n = 0;
  DEMAND.forEach((s) => (n += s.length));
  return n;
}

export function allDemandRecords(): DemandRecord[] {
  const out: DemandRecord[] = [];
  DEMAND.forEach((series, key) => {
    const [partId, location] = key.split("|") as [string, LocationId];
    series.forEach((qty, i) => out.push({ partId, location, month: MONTHS[i], qty }));
  });
  return out;
}
