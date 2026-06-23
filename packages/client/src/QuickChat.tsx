import { useEffect, useRef, useState } from 'react';
import { on, dispatch } from './events.ts';

interface Props {
  open: boolean;
  onClose: () => void;
  senderName: string;
}

export default function QuickChat({ open, onClose, senderName }: Props) {
  const [lastMessage, setLastMessage] = useState<{ text: string; senderName: string } | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => on('vtt:chat:message-received', msg => setLastMessage(msg)), []);

  useEffect(() => {
    if (open) {
      setText('');
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  function send() {
    const trimmed = text.trim();
    if (!trimmed) return;
    dispatch('vtt:chat:message-sent', { text: trimmed, senderName, timestamp: Date.now() });
    onClose();
  }

  return (
    <div className="quick-chat">
      {lastMessage && (
        <p className="quick-chat-last">
          &#x201C;{lastMessage.text}&#x201D; — {lastMessage.senderName}
        </p>
      )}
      <input
        ref={inputRef}
        className="quick-chat-input"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); send(); }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        placeholder="Say something…"
      />
    </div>
  );
}
