import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Character, Player } from 'shared';
import Canvas from './Canvas.tsx';
import CommandPalette from './CommandPalette.tsx';
import CharacterSheetOverlay from './CharacterSheetOverlay.tsx';
import JournalOverlay from './JournalOverlay.tsx';
import ChatWidget from './ChatWidget.tsx';
import QuickChat from './QuickChat.tsx';
import ShortcutsOverlay from './ShortcutsOverlay.tsx';
import { dispatch, on } from './events.ts';
import './app.css';

const API = `http://${window.location.hostname}:3001`;
const sessionKey = (id: string) => `vtt-session:${id}`;

function readSession(campaignId: string): Character | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(campaignId));
    return raw ? (JSON.parse(raw) as Character) : null;
  } catch {
    return null;
  }
}

// ── game canvas once authenticated ───────────────────────────────────────────

const DOUBLE_TAP_MS = 350;

function GameCanvas({ character }: { character: Character }) {
  const [connected, setConnected] = useState<Player[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [quickChatOpen, setQuickChatOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const lastSpaceRef = useRef<number>(0);

  useEffect(() => {
    const socket = io(API);
    socket.emit('player:join', character.name);
    socket.on('players:update', setConnected);

    // Bridge roll events from the UI → socket
    const unsubCheck = on('vtt:roll:check', payload => socket.emit('roll:check', payload));
    const unsubSave  = on('vtt:roll:save',  payload => socket.emit('roll:save',  payload));

    // Bridge roll results → chat
    socket.on('roll:result', result => {
      dispatch('vtt:chat:message-received', {
        text: result.description,
        senderName: 'System',
        timestamp: Date.now(),
      });
    });

    // Bridge outgoing chat → socket, incoming → chat event
    const unsubChat = on('vtt:chat:message-sent', ({ text, senderName }) => {
      socket.emit('chat:message', { text, senderName });
    });
    socket.on('chat:message', payload => {
      dispatch('vtt:chat:message-received', payload);
    });

    return () => {
      socket.disconnect();
      unsubCheck();
      unsubSave();
      unsubChat();
    };
  }, [character.name]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return;
      const now = Date.now();
      if (e.code === 'Space') {
        if (now - lastSpaceRef.current < DOUBLE_TAP_MS) {
          setPaletteOpen(true);
          lastSpaceRef.current = 0;
        } else {
          lastSpaceRef.current = now;
        }
      } else if (e.key === 'c' && now - lastSpaceRef.current < DOUBLE_TAP_MS) {
        lastSpaceRef.current = 0;
        setQuickChatOpen(true);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const paletteItems = [
    {
      label: 'Character Sheet',
      description: 'View your full character',
      onSelect: () => dispatch('vtt:sheet:opened', { characterId: character.id }),
    },
    {
      label: 'Journal',
      description: 'Session log and party chat',
      onSelect: () => setJournalOpen(true),
    },
    {
      label: 'Shortcuts',
      description: 'View keyboard shortcuts',
      onSelect: () => setShortcutsOpen(true),
    },
  ];

  return (
    <>
      <Canvas player={character.name} connected={connected} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} />
      <CharacterSheetOverlay character={character} />
      <JournalOverlay open={journalOpen} onClose={() => setJournalOpen(false)} character={character} />
      <ChatWidget />
      <QuickChat open={quickChatOpen} onClose={() => setQuickChatOpen(false)} senderName={character.name} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
}

// ── auth gate ─────────────────────────────────────────────────────────────────

export default function GamePage({ campaignId }: { campaignId: string }) {
  const [character, setCharacter] = useState<Character | null>(() => readSession(campaignId));
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Autofill password from localStorage if the user created a character here
  useEffect(() => {
    if (character) return;
    const store = JSON.parse(localStorage.getItem('vtt-passwords') ?? '{}') as Record<string, string>;
    const saved = Object.entries(store).find(([k]) => k.startsWith(`${campaignId}:`));
    if (saved?.[1]) setPassword(saved[1]);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [campaignId, character]);

  async function handleJoin() {
    if (!password || loading) return;
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/party/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await r.json() as Character & { error?: string };
      if (!r.ok || data.error) throw new Error(data.error ?? 'Invalid password');
      sessionStorage.setItem(sessionKey(campaignId), JSON.stringify(data));
      setCharacter(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect to server');
    } finally {
      setLoading(false);
    }
  }

  if (character) return <GameCanvas character={character} />;

  return (
    <div className="auth-gate">
      <div className="auth-gate-card">
        <h1 className="auth-gate-title">Join Game</h1>
        <p className="auth-gate-sub">Enter your character password to continue.</p>
        <label className="modal-label">
          Password
          <input
            ref={inputRef}
            className="modal-input"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void handleJoin(); }}
            placeholder="Your character password"
          />
        </label>
        {error && <p className="modal-error">{error}</p>}
        <div className="auth-gate-actions">
          <a className="btn-create-player-link" href={`/${campaignId}/player/create`}>
            New here? Create a character
          </a>
          <button className="btn-primary" onClick={() => void handleJoin()} disabled={!password || loading}>
            {loading ? 'Joining…' : 'Join'}
          </button>
        </div>
      </div>
    </div>
  );
}
