import { useEffect, useState } from "react";
import api from "@/lib/api";

// Built-in categories - same lists as backend/personal_router.py's
// DEFAULT_*_CATEGORIES. Used until GET /personal/categories answers, so
// pickers are never empty while it loads.
export const DEFAULT_INCOME = ["Salary", "Freelance", "Gifts", "Refunds"];
export const DEFAULT_EXPENSE = ["Groceries", "Rent/Mortgage", "Utilities", "Subscriptions", "Dining", "Transportation", "Healthcare", "Entertainment", "Shopping", "Bills"];

const EMPTY = { income: DEFAULT_INCOME, expense: DEFAULT_EXPENSE, custom: [] };

// Shared across every picker on the page, so a category added in one dialog
// shows up in the others without a reload.
let cache = null;
let inflight = null;
const listeners = new Set();

function publish(next) {
  cache = next;
  listeners.forEach((fn) => fn(next));
}

function fetchCategories() {
  if (!inflight) {
    inflight = api.get("/personal/categories")
      .then(({ data }) => { publish(data); return data; })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export async function addPersonalCategory(type, name) {
  const { data } = await api.post("/personal/categories", { type, name });
  await fetchCategories();
  return data;
}

export async function removePersonalCategory(id) {
  await api.delete(`/personal/categories/${id}`);
  await fetchCategories();
}

export function usePersonalCategories() {
  const [categories, setCategories] = useState(cache || EMPTY);
  useEffect(() => {
    listeners.add(setCategories);
    fetchCategories().catch(() => {});
    return () => { listeners.delete(setCategories); };
  }, []);
  return categories;
}
