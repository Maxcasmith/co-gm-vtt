import { useEffect, useRef, useState } from 'react';
import type { Character } from 'shared';
import type { NoteReceivedPayload } from './events.ts';
import { on, dispatch } from './events.ts';
import { Button } from './components/Button/Button.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
}

const PAGE_SIZE = 8;

export default function NotesOverlay({ open, onClose, character }: Props) {
  const [input, setInput] = useState('');
  const [notes, setNotes] = useState<NoteReceivedPayload[]>([]);
  const [page, setPage] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [input]);

  useEffect(() => on('vtt:note:received', note => {
    setNotes(prev => [...prev, note]);
  }), []);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function send() {
    const text = input.trim();
    if (!text) return;
    dispatch('vtt:note:add', { text, authorName: character.name });
    setInput('');
  }

  const pageCount = Math.max(1, Math.ceil(notes.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const pageNotes = notes.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);

  return (
    <div className="journal-scrim">
      <div className="journal-panel notes-panel">
        <div className="journal-header">
          <h2 className="journal-title">Notes</h2>
          <Button variant="outline" color="secondary" className="sheet-close" onClick={onClose} aria-label="Close">×</Button>
        </div>

        <div className="journal-messages">
          {notes.length === 0 ? (
            <div className="journal-empty">
              <p className="journal-empty-text">No notes yet.</p>
              <p className="journal-empty-hint">Anything a party member writes here, everyone can see.</p>
            </div>
          ) : (
            pageNotes.map((note, i) => (
              <div key={currentPage * PAGE_SIZE + i} className="journal-msg">
                <div className="journal-msg-header">
                  <span className="journal-msg-sender">{note.pinnedBy ? `Pinned by ${note.pinnedBy}` : `Noted by ${note.authorName}`}</span>
                  <span className="journal-msg-time">
                    {new Date(note.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                {note.pinnedBy && <div className="notes-pin-origin">originally from {note.authorName}</div>}
                <div className="journal-msg-text">{note.text}</div>
              </div>
            ))
          )}
        </div>

        {notes.length > 0 && (
          <div className="notes-pagination">
            <Button variant="ghost" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>Prev</Button>
            <span className="notes-page-label">Page {currentPage + 1} of {pageCount}</span>
            <Button variant="ghost" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={currentPage >= pageCount - 1}>Next</Button>
          </div>
        )}

        <div className="journal-input-row">
          <textarea
            ref={textareaRef}
            className="journal-input notes-input"
            rows={1}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Add a note for the party…"
          />
          <Button onClick={send} disabled={!input.trim()}>Add</Button>
        </div>
      </div>
    </div>
  );
}
