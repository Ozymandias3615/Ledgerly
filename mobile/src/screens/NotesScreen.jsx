import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Notepad, Plus, Trash } from "@phosphor-icons/react";
import api from "../lib/api";
import Brand from "../components/Brand";
import BackButton from "../components/BackButton";
import { AUTOSAVE_MS, NOTE_PAGE, noteRelativeTime, noteSourceLabel, splitNote } from "../lib/notes";

// List + editor in one screen. Same save rules as desktop's NotesWidget:
// autosaves as you type, a new note only exists once you type something,
// and a note emptied out is dropped when you leave it.
export default function NotesScreen() {
  const navigate = useNavigate();
  const location = useLocation();
  const backTo = location.state?.from || "/";

  const [notes, setNotes] = useState(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // { id: string|null, page, body }
  const [saveState, setSaveState] = useState("saved"); // "saved" | "saving" | "error"
  const editingRef = useRef(null);
  const creatingRef = useRef(null);
  const saveTimerRef = useRef(null);
  editingRef.current = editing;

  useEffect(() => {
    api
      .get("/notes")
      .then(({ data }) => setNotes(data))
      .catch(() => {
        setNotes([]);
        setError("Couldn't load your notes.");
      });
  }, []);

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
      setError(err.response?.data?.detail || "Couldn't save your note.");
    }
  }, []);

  const onDraftChange = (e) => {
    const body = e.target.value;
    setEditing((cur) => ({ ...cur, body }));
    editingRef.current = { ...editingRef.current, body };
    setSaveState("saving");
    setError("");
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(persist, AUTOSAVE_MS);
  };

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

  const deleteNote = async () => {
    const draft = editingRef.current;
    if (!draft) return;
    if (!window.confirm("Delete this note? This can't be undone.")) return;
    clearTimeout(saveTimerRef.current);
    editingRef.current = null;
    setEditing(null);
    if (!draft.id) return;
    setNotes((prev) => (prev || []).filter((n) => n.id !== draft.id));
    try {
      await api.delete(`/notes/${draft.id}`);
    } catch {
      setError("Couldn't delete that note.");
    }
  };

  // Never lose a pending edit to leaving the screen.
  useEffect(() => () => { if (editingRef.current?.body?.trim()) persist(); }, [persist]);

  if (editing) {
    const { title } = splitNote(editing.body);
    return (
      <div className="chat-screen">
        <div className="chat-header">
          <button type="button" className="icon-btn" aria-label="Back to notes" onClick={closeEditor}>
            <svg width="16" height="16" viewBox="0 0 256 256" fill="none" stroke="currentColor" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
              <polyline points="160,48 80,128 160,208" />
            </svg>
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="list-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title || "New note"}</div>
            <div className="list-meta">
              {saveState === "saving" ? "Saving…" : saveState === "error" ? "Not saved" : editing.id ? "Saved" : "Start typing"}
            </div>
          </div>
          <button type="button" className="icon-btn list-delete-btn" aria-label="Delete note" onClick={deleteNote}>
            <Trash size={16} />
          </button>
        </div>
        {error && <p className="error-text" style={{ padding: "0 1rem" }}>{error}</p>}
        <textarea
          className="note-editor"
          autoFocus
          value={editing.body}
          onChange={onDraftChange}
          placeholder={"Title\nWrite anything - it saves as you type."}
          maxLength={20000}
        />
      </div>
    );
  }

  return (
    <div className="screen screen-narrow">
      <div className="top-row">
        <div className="top-row-left">
          <BackButton to={backTo} />
          <Brand compact />
        </div>
        <button type="button" className="icon-btn" aria-label="New note" title="New note" onClick={() => setEditing({ id: null, page: NOTE_PAGE, body: "" })}>
          <Plus size={16} />
        </button>
      </div>
      <div className="eyebrow">Notes</div>
      <h2 className="heading">Your notes</h2>
      <p className="subtitle">Private to you, and the same notes as on desktop.</p>

      {error && <p className="error-text">{error}</p>}
      {notes === null && (
        <p className="subtitle thinking">
          <span className="thinking-dots"><span /><span /><span /></span>
          Loading
        </p>
      )}

      {notes && notes.length === 0 && (
        <div className="card" style={{ textAlign: "center" }}>
          <Notepad size={28} style={{ opacity: 0.6 }} />
          <p className="subtitle" style={{ margin: "0.5rem 0 1rem" }}>
            No notes yet. Jot down anything - reminders, to-dos, numbers to check.
          </p>
          <button type="button" className="btn-primary" onClick={() => setEditing({ id: null, page: NOTE_PAGE, body: "" })}>
            Write a note
          </button>
        </div>
      )}

      {notes && notes.length > 0 && (
        <div className="list">
          {notes.map((n) => {
            const { title, preview } = splitNote(n.body);
            return (
              <button type="button" className="list-card note-card" key={n.id} onClick={() => setEditing({ id: n.id, page: n.page, body: n.body })}>
                <div className="list-title">{title || "Untitled"}</div>
                {preview && <div className="note-preview">{preview}</div>}
                <div className="list-meta">
                  {n.page && <span className="note-source">{noteSourceLabel(n.page)}</span>}
                  {noteRelativeTime(n.updated_at)}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
