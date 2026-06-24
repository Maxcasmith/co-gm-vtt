import { useEffect, useRef, useState } from 'react';
import type { Character } from 'shared';
import type { ChatMessageReceivedPayload } from './events.ts';
import { on, dispatch } from './events.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  sessionActive: boolean;
  dmThinking: boolean;
}

export default function JournalOverlay({ open, onClose, character, sessionActive, dmThinking }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Messages live above the open-guard so they survive close/reopen
  const [messages, setMessages] = useState<ChatMessageReceivedPayload[]>([]);

  useEffect(() => {
    return on('vtt:chat:message-received', msg => {
      setMessages(prev => [...prev, msg]);
    });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

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
    dispatch('vtt:chat:message-sent', { text, senderName: character.name, timestamp: Date.now() });
    setInput('');
  }

  return (
    <div className="journal-scrim">
      <div className="journal-panel">
        <div className="journal-header">
          <h2 className="journal-title">Journal</h2>
          <button className="sheet-close" onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className="journal-messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="journal-empty">
              <p className="journal-empty-text">The pages are blank.</p>
              <p className="journal-empty-hint">Roll a die or say something to begin the record.</p>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div key={i} className={`journal-msg${msg.variant === 'recap' ? ' journal-msg--recap' : msg.senderName === 'System' ? ' journal-msg--system' : ''}`}>
                <div className="journal-msg-header">
                  <span className="journal-msg-sender">{msg.senderName}</span>
                  <span className="journal-msg-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <div className="journal-msg-text">{msg.text}</div>
              </div>
            ))
          )}
        </div>

        {dmThinking && (
          <div className="journal-msg journal-msg--recap journal-thinking">
            <div className="journal-msg-header">
              <span className="journal-msg-sender">Virtual DM</span>
            </div>
            <div className="journal-msg-text">
              <span className="journal-thinking-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          </div>
        )}

        <div className="journal-input-row">
          <input
            className="journal-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder={sessionActive ? 'Say something…' : 'Session hasn\'t started yet'}
            disabled={!sessionActive}
            autoFocus
          />
          <button className="btn-primary" onClick={send} disabled={!sessionActive || !input.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}
