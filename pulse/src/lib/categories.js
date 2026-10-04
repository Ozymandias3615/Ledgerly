import { useEffect, useState } from "react";
import api from "./api";

// Ground-truth category strings, matching what's actually stored on seeded
// personal_transactions/personal_budgets/personal_bills documents - a
// budget's category must match a transaction's category string exactly for
// spend-vs-limit to compute correctly.
export const EXPENSE_CATEGORIES = ["Groceries", "Rent/Mortgage", "Utilities", "Subscriptions", "Dining", "Transportation", "Healthcare", "Entertainment", "Shopping", "Bills"];
export const INCOME_CATEGORIES = ["Salary", "Freelance", "Gifts", "Refunds"];

// Users can add their own categories on top of the built-ins (stored via
// /personal/categories, shared with the desktop app). Same cache-and-notify
// pattern as frontend/src/lib/personalCategories.js so every picker on a
// screen stays in sync after one of them adds a category.

const EMPTY = { income: INCOME_CATEGORIES, expense: EXPENSE_CATEGORIES, custom: [] };
let cache = null;
let inflight = null;
const listeners = new Set();

function fetchCategories() {
  if (!inflight) {
    inflight = api
      .get("/personal/categories")
      .then(({ data }) => {
        cache = data;
        listeners.forEach((fn) => fn(data));
        return data;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}

export async function addPersonalCategory(type, name) {
  const { data } = await api.post("/personal/categories", { type, name });
  await fetchCategories();
  return data;
}

// Also renames it on every transaction/budget/bill already using it.
export async function renamePersonalCategory(id, name) {
  const { data } = await api.put(`/personal/categories/${id}`, { name });
  await fetchCategories();
  return data;
}

// Only removes it from the pickers - records already using the name keep it.
export async function removePersonalCategory(id) {
  await api.delete(`/personal/categories/${id}`);
  await fetchCategories();
}

export function usePersonalCategories() {
  const [categories, setCategories] = useState(cache || EMPTY);
  useEffect(() => {
    listeners.add(setCategories);
    fetchCategories().catch(() => {});
    return () => {
      listeners.delete(setCategories);
    };
  }, []);
  return categories;
}
