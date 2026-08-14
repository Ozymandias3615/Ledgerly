// Ground-truth category strings, matching what's actually stored on seeded
// personal_transactions/personal_budgets/personal_bills documents - a
// budget's category must match a transaction's category string exactly for
// spend-vs-limit to compute correctly.
export const EXPENSE_CATEGORIES = ["Groceries", "Rent/Mortgage", "Utilities", "Subscriptions", "Dining", "Transportation", "Healthcare", "Entertainment", "Shopping", "Bills"];
export const INCOME_CATEGORIES = ["Salary", "Freelance", "Gifts", "Refunds"];
