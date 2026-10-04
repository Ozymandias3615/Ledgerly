import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import api from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatApiError } from "@/lib/utils_app";
import { ArrowLeft, Notepad, Plus, Trash, X } from "@phosphor-icons/react";
import { toast } from "sonner";

const AUTOSAVE_MS = 600;

// "/personal/budgets" -> "Personal · Budgets", "/invoices/abc123" -> "Invoices"
// - detail-page ids aren't meaningful to read, the section is.
function pageLabel(path) {
  if (!path) return "";
  const parts = path.split("/").filter(Boolean).filter((p) => !/\d/.test(p) || p.length < 8);
  if (parts.length === 0) return "Home";
  return parts.map((p) => p.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase())).join(" · ");
}

function relativeTime(iso) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Like a notepad: the first line is the title, the rest is the preview.
function splitNote(body) {
  const trimmed = (body || "").trim();
  const nl = trimmed.indexOf("\n");
  if (nl === -1) return { title: trimmed, preview: "" };
  return { title: trimmed.slice(0, nl).trim(), preview: trimmed.slice(nl + 1).trim().replace(/\s+/g, " ") };
}

export default function NotesWidget() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState(null);
  const [scope, setScope] = useState("page"); // "page" | "all"
  // { id: string|null, page, body } - id is null until the first keystroke
  // creates the note, so opening "New" and backing out leaves nothing behind.
  const [editing, setEditing] = useState(null);
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving" | "error"
  const [pendingDelete, setPendingDelete] = useState(null);
  const saveTimerRef = useRef(null);
  const editingRef = useRef(null);
  const creatingRef = useRef(null);
  const textareaRef = useRef(null);
  editingRef.current = editing;

  const loadNotes = useCallback(() => {
    api.get("/notes").then(({ data }) => setNotes(data)).catch(() => setNotes((prev) => prev || []));
  }, []);
  useEffect(() => { loadNotes(); }, [loadNotes]);

  const pageNotes = useMemo(() => (notes || []).filter((n) => n.page === pathname), [notes, pathname]);
  const shown = scope === "page" ? pageNotes : notes || [];

  // Saves whatever is in the editor right now - used by the debounce and
  // flushed immediately when leaving the editor or closing the panel.
  const persist = useCallback(async () => {
    clearTimeout(saveTimerRef.current);
    const draft = editingRef.current;
    if (!draft) return;
    const body = draft.body;
    try {
      if (!draft.id) {
        if (!body.trim()) return;
        // A save fired while the create is still in flight waits for it,
        // then runs again as an update - never a second, duplicate note.
        if (creatingRef.current) {
          await creatingRef.current.catch(() => {});
          return persist();
        }
        setSaveState("saving");
        creatingRef.current = api.post("/notes", { body, page: draft.page }).then(({ data }) => data);
        const data = await creatingRef.current;
        creatingRef.current = null;
        setNotes((prev) => [data, ...(prev || [])]);
        setEditing((cur) => (cur && !cur.id ? { ...cur, id: data.id } : cur));
        if (editingRef.current && !editingRef.current.id) {
          editingRef.current = { ...editingRef.current, id: data.id };
          // Typed more while it was being created - save that too.
          if (editingRef.current.body !== body) return persist();
        }
      } else {
        setSaveState("saving");
        const { data } = await api.put(`/notes/${draft.id}`, { body });
        setNotes((prev) => [data, ...(prev || []).filter((n) => n.id !== data.id)]);
      }
      setSaveState("saved");
    } catch (err) {
      creatingRef.current = null;
      setSaveState("error");
      toast.error(formatApiError(err) || "Couldn't save your note");
    }
  }, []);

  const onDraftChange = (e) => {
    const body = e.target.value;
    setEditing((cur) => ({ ...cur, body }));
    editingRef.current = { ...editingRef.current, body };
    setSaveState("saving");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(persist, AUTOSAVE_MS);
  };

  // Leaving the editor: flush the save, and quietly drop a note that was
  // emptied out rather than keeping a blank card in the list.
  const closeEditor = async () => {
    const draft = editingRef.current;
    setEditing(null);
    if (!draft) return;
    if (draft.id && !draft.body.trim()) {
      clearTimeout(saveTimerRef.current);
      setNotes((prev) => (prev || []).filter((n) => n.id !== draft.id));
      api.delete(`/notes/${draft.id}`).catch(() => {});
      return;
    }
    editingRef.current = draft;
    await persist();
    editingRef.current = null;
  };

  const closePanel = async () => {
    await closeEditor();
    setOpen(false);
  };

  const togglePanel = () => {
    if (open) closePanel();
    else {
      setOpen(true);
      loadNotes();
    }
  };

  const newNote = () => {
    setEditing({ id: null, page: pathname, body: "" });
    setSaveState("saved");
  };

  const openNote = (note) => {
    setEditing({ id: note.id, page: note.page, body: note.body });
    setSaveState("saved");
  };

  const confirmDelete = async () => {
    const note = pendingDelete;
    setPendingDelete(null);
    if (!note) return;
    clearTimeout(saveTimerRef.current);
    if (editingRef.current?.id === note.id || (!note.id && editingRef.current)) {
      editingRef.current = null;
      setEditing(null);
    }
    if (!note.id) return;
    setNotes((prev) => (prev || []).filter((n) => n.id !== note.id));
    try {
      await api.delete(`/notes/${note.id}`);
      toast.success("Note deleted");
    } catch (err) {
      toast.error(formatApiError(err) || "Couldn't delete the note");
      loadNotes();
    }
  };

  const isEditing = !!editing;
  useEffect(() => {
    if (isEditing && textareaRef.current) textareaRef.current.focus();
  }, [isEditing]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && !pendingDelete) {
        if (editingRef.current) closeEditor();
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, pendingDelete]); // eslint-disable-line react-hooks/exhaustive-deps

  // Never lose a pending edit to an unmount (sign-out, window close).
  useEffect(() => () => { if (editingRef.current?.body?.trim()) persist(); }, [persist]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            // Drops down from the header button, top-right - floating over the
            // bottom corner covered page content (e.g. Transactions' row menus).
            className="fixed top-16 right-6 z-40 w-[22rem] h-[32rem] max-h-[calc(100vh-6rem)] rounded-xl border border-slate-200 bg-card text-slate-900 shadow-2xl flex flex-col overflow-hidden origin-top-right"
            role="dialog"
            aria-label="Notes"
            data-testid="notes-panel"
          >
            <div className="shrink-0 flex items-center gap-2 px-4 h-14 border-b border-slate-200">
              {editing ? (
                <button type="button" onClick={closeEditor} className="h-8 w-8 -ml-1.5 grid place-items-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100" title="Back to notes" data-testid="notes-back">
                  <ArrowLeft size={16} />
                </button>
              ) : (
                <Notepad size={18} className="text-slate-500" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold tracking-tight truncate" style={{ fontFamily: "Manrope, sans-serif" }}>
                  {editing ? splitNote(editing.body).title || "New note" : "Notes"}
                </div>
                {editing && (
                  <div className="text-[11px] text-slate-500 truncate">
                    {pageLabel(editing.page)}
                    {" · "}
                    {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : editing.id ? "Saved" : "Start typing"}
                  </div>
                )}
              </div>
              {editing ? (
                <button type="button" onClick={() => setPendingDelete(editing)} className="h-8 w-8 grid place-items-center rounded-md text-slate-400 hover:text-red-600 hover:bg-red-50" title="Delete note" data-testid="notes-delete">
                  <Trash size={16} />
                </button>
              ) : (
                <button type="button" onClick={newNote} className="h-8 px-2.5 flex items-center gap-1 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:opacity-90" data-testid="notes-new">
                  <Plus size={14} weight="bold" /> New
                </button>
              )}
              <button type="button" onClick={closePanel} className="h-8 w-8 -mr-1.5 grid place-items-center rounded-md text-slate-400 hover:text-slate-900 hover:bg-slate-100" title="Close" data-testid="notes-close">
                <X size={16} />
              </button>
            </div>

            {editing ? (
              <textarea
                ref={textareaRef}
                value={editing.body}
                onChange={onDraftChange}
                placeholder={"Title\nWrite anything - it saves as you type."}
                maxLength={20000}
                className="flex-1 min-h-0 w-full resize-none bg-transparent px-4 py-3 text-sm leading-relaxed text-slate-800 placeholder:text-slate-400 focus:outline-none"
                data-testid="notes-editor"
              />
            ) : (
              <>
                <div className="shrink-0 px-4 pt-3">
                  <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 text-xs font-medium">
                    {[
                      { key: "page", label: `This page${pageNotes.length ? ` (${pageNotes.length})` : ""}` },
                      { key: "all", label: `All notes${notes?.length ? ` (${notes.length})` : ""}` },
                    ].map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setScope(t.key)}
                        className={`rounded-md py-1.5 transition-colors ${scope === t.key ? "bg-card text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-900"}`}
                        data-testid={`notes-scope-${t.key}`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-2">
                  {notes === null ? (
                    <div className="text-sm text-slate-500 py-6 text-center">Loading…</div>
                  ) : shown.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center px-6 gap-3">
                      <div className="h-11 w-11 rounded-full bg-slate-100 grid place-items-center text-slate-500">
                        <Notepad size={20} />
                      </div>
                      <div className="text-sm text-slate-500">
                        {scope === "page" ? "No notes on this page yet." : "No notes yet."}
                        <br />
                        Jot down anything - reminders, to-dos, numbers to check.
                      </div>
                      <button type="button" onClick={newNote} className="text-sm font-medium text-slate-900 underline underline-offset-4 hover:opacity-80">
                        Write a note
                      </button>
                    </div>
                  ) : (
                    shown.map((n) => {
                      const { title, preview } = splitNote(n.body);
                      return (
                        <button
                          key={n.id}
                          type="button"
                          onClick={() => openNote(n)}
                          className="w-full text-left rounded-lg border border-slate-200 bg-card px-3 py-2.5 hover:border-slate-300 hover:bg-slate-50 transition-colors"
                          data-testid={`note-${n.id}`}
                        >
                          <div className="text-sm font-semibold truncate">{title || "Untitled"}</div>
                          {preview && <div className="text-xs text-slate-500 mt-0.5 line-clamp-2">{preview}</div>}
                          <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-slate-400">
                            {scope === "all" && n.page && (
                              <>
                                <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500 truncate max-w-[11rem]">{pageLabel(n.page)}</span>
                                <span>·</span>
                              </>
                            )}
                            <span>{relativeTime(n.updated_at)}</span>
                          </div>
                        </button>
                      );
                    })
                  )}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <button
        type="button"
        onClick={togglePanel}
        // Same look as the NotificationBell button beside it in the header.
        className={`relative h-9 w-9 grid place-items-center rounded-md border transition-colors ${open ? "border-slate-300 bg-slate-100 text-slate-900" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
        title="Notes"
        aria-label={open ? "Close notes" : "Open notes"}
        aria-expanded={open}
        data-testid="notes-button"
      >
        <Notepad size={18} weight={open ? "fill" : "regular"} />
        {pageNotes.length > 0 && (
          <span className="absolute -top-1.5 -right-1.5 h-4 min-w-[16px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold grid place-items-center leading-none">
            {pageNotes.length}
          </span>
        )}
      </button>

      <ConfirmDialog
        open={!!pendingDelete}
        onOpenChange={(o) => !o && setPendingDelete(null)}
        title="Delete this note?"
        description="This can't be undone."
        onConfirm={confirmDelete}
      />
    </>
  );
}
