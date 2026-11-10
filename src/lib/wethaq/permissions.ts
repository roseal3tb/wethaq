import type { Role } from "./types";

export type Permission =
  | "view:overview" | "view:forecasts" | "view:inventory" | "view:shipments" | "view:ledger"
  | "action:createRequest" | "action:dispatch" | "action:transit" | "action:receive" | "admin:users";

export const ALL_PERMISSIONS: { id: Permission; label: string }[] = [
  { id: "view:overview", label: "View Overview" },
  { id: "view:forecasts", label: "View Demand Forecasting" },
  { id: "view:inventory", label: "View Inventory & Alerts" },
  { id: "view:shipments", label: "View Shipments" },
  { id: "view:ledger", label: "View Ledger" },
  { id: "action:createRequest", label: "Create simulated shipment request" },
  { id: "action:dispatch", label: "Record dispatch" },
  { id: "action:transit", label: "Mark In Transit" },
  { id: "action:receive", label: "Confirm receipt" },
  { id: "admin:users", label: "Manage users & roles" },
];

const VIEW_ALL: Permission[] = ["view:overview", "view:forecasts", "view:inventory", "view:shipments", "view:ledger"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  Planner: [...VIEW_ALL, "action:createRequest"],
  Dispatcher: [...VIEW_ALL, "action:dispatch", "action:transit"],
  Receiver: ["view:overview", "view:inventory", "view:shipments", "view:ledger", "action:receive"],
  Admin: [...VIEW_ALL, "admin:users"],
};

export function can(role: Role | null | undefined, p: Permission): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(p);
}

export type NavKey = "overview" | "forecasts" | "inventory" | "shipments" | "users";
export const NAV_PERMISSION: Record<NavKey, Permission> = {
  overview: "view:overview",
  forecasts: "view:forecasts",
  inventory: "view:inventory",
  shipments: "view:shipments",
  users: "admin:users",
};
