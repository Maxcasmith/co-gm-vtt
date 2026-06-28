import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Character, Player, EnemyStatBlock, TokenPosition, Dungeon, Quest } from 'shared';
import Canvas from './Canvas.tsx';
import EncounterLoadingOverlay from './EncounterLoadingOverlay.tsx';
import CommandPalette from './CommandPalette.tsx';
import CharacterSheetOverlay from './CharacterSheetOverlay.tsx';
import JournalOverlay from './JournalOverlay.tsx';
import QuestLog from './QuestLog.tsx';
import CombatLogOverlay from './CombatLogOverlay.tsx';
import ChatWidget from './ChatWidget.tsx';
import QuickChat from './QuickChat.tsx';
import ShortcutsOverlay from './ShortcutsOverlay.tsx';
import RestModal from './RestModal.tsx';
import BattleMapBackground from './BattleMapBackground.tsx';
import CombatDock from './CombatDock.tsx';
import TurnOrderBar from './TurnOrderBar.tsx';
import VictoryScreen from './VictoryScreen.tsx';
import DefeatScreen from './DefeatScreen.tsx';
import { dispatch, on } from './events.ts';
import { initNarration, narrate } from './narration.ts';
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

function formatWorldTime(secs: number): string {
  const day = Math.floor(secs / 86400) + 1;
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const period = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 || 12;
  return `Day ${day}  •  ${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function GameCanvas({ character, onCharacterUpdate }: { character: Character; onCharacterUpdate: (c: Character) => void }) {
  const [connected, setConnected] = useState<Player[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [journalOpen, setJournalOpen] = useState(false);
  const [combatLogOpen, setCombatLogOpen] = useState(false);
  const [quickChatOpen, setQuickChatOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [combatActive, setCombatActive] = useState(false);
  const [encounter, setEncounter] = useState<EnemyStatBlock[] | null>(null);
  const [tokenPositions, setTokenPositions] = useState<Record<string, { gx: number; gy: number }>>({});
  const [movementRemaining, setMovementRemaining] = useState(0);
  const [dmThinking, setDmThinking] = useState(false);
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [victory, setVictory] = useState<import('./VictoryScreen.tsx').VictoryData | null>(null);
  const [defeated, setDefeated] = useState(false);
  const [deadCreatureIds, setDeadCreatureIds] = useState<Set<string>>(new Set());
  const [downPlayerNames, setDownPlayerNames] = useState<Set<string>>(new Set());
  const [deadPlayerNames, setDeadPlayerNames] = useState<Set<string>>(new Set());
  const [playerHpState, setPlayerHpState] = useState<{ current: number; max: number } | null>(null);
  const [tokenUrls, setTokenUrls] = useState<Record<string, string>>({});
  const [acquisitions, setAcquisitions] = useState<Character['inventory']>([]);
  const [itemNotifications, setItemNotifications] = useState<{ id: string; name: string }[]>([]);
  const [worldMapUrl, setWorldMapUrl] = useState<string | undefined>(undefined);
  const [dungeon, setDungeon] = useState<Dungeon | null>(null);
  const [questLogOpen, setQuestLogOpen] = useState(false);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [act, setAct] = useState(1);
  const [worldTimeSecs, setWorldTimeSecs] = useState(43200);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const lastSpaceRef = useRef<number>(0);
  const socketRef = useRef<ReturnType<typeof io> | null>(null);
  const onCharacterUpdateRef = useRef(onCharacterUpdate);
  useEffect(() => { onCharacterUpdateRef.current = onCharacterUpdate; });

  // Ref so navigation interceptors always see the latest values without re-registering
  const shouldConfirmRef = useRef(false);
  shouldConfirmRef.current = sessionActive && connected.length <= 1;

  // Block refresh/close when session is live and we're the last one
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (shouldConfirmRef.current) { e.preventDefault(); e.returnValue = ''; }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Block browser back button — push a sentinel state so we can intercept popstate
  useEffect(() => {
    history.pushState(null, '', window.location.href);
    function onPopState() {
      history.pushState(null, '', window.location.href); // re-push to stay on page
      if (shouldConfirmRef.current) {
        setShowLeaveConfirm(true);
      } else {
        socketRef.current?.disconnect();
        window.location.href = '/';
      }
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    fetch(`${API}/api/config`)
      .then(r => r.json())
      .then((c: import('shared').AppConfig) => {
        const { model, voice, apiKey } = c.narration;
        initNarration(model, voice, apiKey);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const url = `${API}/api/campaigns/${character.campaignId}/world-map`;
    fetch(url, { method: 'HEAD' })
      .then(r => { if (r.ok) setWorldMapUrl(url); })
      .catch(() => {});
  }, [character.campaignId]);

  useEffect(() => on('vtt:chat:message-received', ({ text, senderName }) => {
    if (senderName === 'Virtual DM') narrate(text);
  }), []);

  useEffect(() => {
    const socket = io(API);
    socketRef.current = socket;
    socket.emit('player:join', { name: character.name, id: character.id, campaignId: character.campaignId });
    socket.on('players:update', setConnected);
    socket.on('players:characters', map => {
      setTokenUrls(Object.fromEntries(
        Object.entries(map).map(([name, charId]) => [name, `${API}/api/campaigns/${character.campaignId}/party/${charId}/token`])
      ));
    });
    socket.on('character:inventory:add', items => {
      const acquired = items as NonNullable<Character['inventory']>;
      setAcquisitions(prev => [...(prev ?? []), ...acquired]);
      const notifs = acquired.map(item => ({ id: crypto.randomUUID(), name: item.name }));
      setItemNotifications(prev => [...prev, ...notifs]);
      notifs.forEach(n => setTimeout(() => setItemNotifications(prev => prev.filter(x => x.id !== n.id)), 3500));
    });

    // Bridge roll events from the UI → socket
    const unsubCheck = on('vtt:roll:check', payload => socket.emit('roll:check', payload));
    const unsubSave  = on('vtt:roll:save',  payload => socket.emit('roll:save',  payload));

    // Replay persisted history into chat on join
    socket.on('chat:history', messages => {
      messages.forEach(msg => dispatch('vtt:chat:message-received', msg));
    });

    // Bridge roll results → chat + typed event
    socket.on('roll:result', result => {
      dispatch('vtt:chat:message-received', {
        text: result.description,
        senderName: 'System',
        timestamp: Date.now(),
      });
      dispatch('vtt:roll:result', result);
    });

    // Bridge outgoing chat → socket, incoming → chat event
    const unsubChat = on('vtt:chat:message-sent', ({ text, senderName }) => {
      socket.emit('chat:message', { text, senderName });
    });
    socket.on('chat:message', payload => {
      dispatch('vtt:chat:message-received', payload);
    });

    socket.on('session:state', setSessionActive);
    socket.on('dm:thinking', setDmThinking);
    socket.on('combat:state', active => {
      setCombatActive(active);
      dispatch('vtt:combat:state', { active });
      if (!active) { setEncounter(null); setTokenPositions({}); }
    });
    socket.on('combat:turn', data => dispatch('vtt:combat:turn', data));
    socket.on('combat:initiative', entry => dispatch('vtt:combat:initiative', { entry }));
    socket.on('combat:turn:order', entries => dispatch('vtt:combat:turn:order', { entries }));
    socket.on('combat:attack:result', result => dispatch('vtt:combat:attack:result', result));
    socket.on('combat:player:damage', data => {
      dispatch('vtt:combat:player:damage', data);
      if (data.characterId === character.id) setPlayerHpState({ current: data.currentHp, max: data.maxHp });
      if (data.currentHp <= 0) setDownPlayerNames(prev => new Set([...prev, data.characterName]));
      else setDownPlayerNames(prev => { const s = new Set(prev); s.delete(data.characterName); return s; });
    });
    socket.on('combat:death:save', data => dispatch('vtt:combat:death:save', data));
    socket.on('combat:defeat', () => { dispatch('vtt:combat:defeat', {}); setDefeated(true); });
    socket.on('combat:player:dead', data => {
      dispatch('vtt:combat:player:dead', data);
      setDeadPlayerNames(prev => new Set([...prev, data.characterName]));
      setDownPlayerNames(prev => { const s = new Set(prev); s.delete(data.characterName); return s; });
    });
    const unsubRest = on('vtt:rest:result', ({ currentHp, maxHp }) => setPlayerHpState({ current: currentHp, max: maxHp }));
    socket.on('creature:update', data => {
      dispatch('vtt:creature:update', data);
      if (data.effects.includes('Dead')) setDeadCreatureIds(prev => new Set([...prev, data.id]));
    });
    socket.on('combat:victory', data => {
      dispatch('vtt:combat:victory', data);
      setVictory(data);
      setTimeout(() => {
        fetch(`${API}/api/campaigns/${character.campaignId}/party/${character.id}`)
          .then(r => r.json())
          .then((c: Character) => onCharacterUpdateRef.current(c))
          .catch(() => {});
      }, 500);
    });
    socket.on('token:moved', (pos: TokenPosition) => {
      setTokenPositions(prev => ({ ...prev, [pos.tokenId]: { gx: pos.gx, gy: pos.gy } }));
    });
    socket.on('map:generating', () => dispatch('vtt:map:generating', {}));
    socket.on('map:generated', mapId => dispatch('vtt:map:generated', { mapId, campaignId: character.campaignId }));
    socket.on('encounter:generating', () => dispatch('vtt:encounter:generating', {}));
    socket.on('encounter:ready', enemies => { setEncounter(enemies); dispatch('vtt:encounter:ready', { enemies }); });
    socket.on('session:recap', ({ text, senderName, checkRequests }) => {
      dispatch('vtt:chat:message-received', { text, senderName, timestamp: Date.now(), variant: 'recap', checkRequests });
    });
    socket.on('combat:log', data => dispatch('vtt:combat:log', { kind: 'text', ...data }));
    socket.on('dungeon:loaded', dungeon => { setDungeon(dungeon); dispatch('vtt:dungeon:loaded', dungeon); });
    socket.on('quest:update', ({ quests: q, act: a }) => { setQuests(q); setAct(a); });
    socket.on('clock:update', ({ worldTimeSecs: t }) => { setWorldTimeSecs(t); });

    const unsubTokenMove = on('vtt:token:move', pos => {
      socket.emit('token:move', pos);
      setTokenPositions(prev => ({ ...prev, [pos.tokenId]: { gx: pos.gx, gy: pos.gy } }));
    });
    const unsubTurnEnd      = on('vtt:combat:turn:end', () => socket.emit('combat:turn:end'));
    const unsubInitRoll     = on('vtt:combat:initiative:roll', ({ entry }) => socket.emit('combat:initiative:roll', entry));

    return () => {
      socketRef.current = null;
      socket.disconnect();
      unsubCheck();
      unsubSave();
      unsubChat();
      unsubTokenMove();
      unsubTurnEnd();
      unsubInitRoll();
      unsubRest();
    };
  }, [character.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:state', ({ active }) => {
    setCombatActive(active);
    if (active) { setJournalOpen(false); setQuickChatOpen(false); }
    if (!active) { setIsMyTurn(false); setVictory(null); setDefeated(false); setDeadCreatureIds(new Set()); setDownPlayerNames(new Set()); setDeadPlayerNames(new Set()); setPlayerHpState(null); }
  }), []);
  useEffect(() => on('vtt:combat:turn', ({ actorName }) => setIsMyTurn(actorName === character.name)), [character.name]);
  useEffect(() => on('vtt:combat:attack', ({ attackerId, attackerName, targetId, weapon }) => {
    socketRef.current?.emit('combat:attack', { attackerId, attackerName, targetId, weapon });
  }), []);
  // Movement resets to full only at the START of this player's turn, not on combat start
  useEffect(() => { if (!combatActive) setMovementRemaining(0); }, [combatActive]);
  useEffect(() => on('vtt:combat:turn', ({ actorName }) => {
    if (actorName === character.name) setMovementRemaining(character.speed ?? 30);
  }), [character.name, character.speed]);
  useEffect(() => on('vtt:movement:used',   ({ ft }) => setMovementRemaining(prev => Math.max(0, prev - ft))), []);
  useEffect(() => on('vtt:movement:gained', ({ ft }) => setMovementRemaining(prev => prev + ft)), []);

  useEffect(() => {
    if (!combatActive || !encounter) return;
    const socket = socketRef.current;
    const CELL = 64;
    const cols = Math.floor(window.innerWidth / CELL);

    // Compute default positions before touching state so we can emit them immediately
    const defaults: Record<string, { gx: number; gy: number }> = {};
    connected.forEach((name, i)  => { defaults[name]      = { gx: 2,        gy: 3 + i * 2 }; });
    encounter.forEach((enemy, i) => { defaults[enemy.id]  = { gx: cols - 3, gy: 3 + i * 2 }; });

    setTokenPositions(prev => {
      const next = { ...prev };
      Object.entries(defaults).forEach(([id, pos]) => { if (!next[id]) next[id] = pos; });
      return next;
    });

    // Send every default that isn't already tracked on the server
    if (socket) {
      Object.entries(defaults).forEach(([tokenId, { gx, gy }]) => {
        socket.emit('token:move', { tokenId, gx, gy });
      });
    }
  }, [combatActive, encounter]); // eslint-disable-line react-hooks/exhaustive-deps

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
    ...(!combatActive ? [{
      label: 'Rest',
      description: 'Take a short or long rest',
      onSelect: () => dispatch('vtt:rest:open', {}),
    }] : []),
    {
      label: 'Journal',
      description: 'Session log and party chat',
      onSelect: () => setJournalOpen(true),
    },
    {
      label: 'Quest Log',
      description: 'Active quests and story progress',
      onSelect: () => setQuestLogOpen(true),
    },
    {
      label: 'Combat Log',
      description: 'Technical combat output',
      onSelect: () => setCombatLogOpen(true),
    },
    {
      label: 'Shortcuts',
      description: 'View keyboard shortcuts',
      onSelect: () => setShortcutsOpen(true),
    },
    sessionActive
      ? {
          label: 'End Session',
          description: 'Save notes and close the session',
          onSelect: () => socketRef.current?.emit('session:end', { campaignId: character.campaignId }),
        }
      : {
          label: 'Start Session',
          description: 'Begin session and get a recap from the Virtual DM',
          onSelect: () => socketRef.current?.emit('session:start', { campaignId: character.campaignId }),
        },
    {
      label: 'Leave',
      description: 'Disconnect and return to the main menu',
      onSelect: () => {
        if (shouldConfirmRef.current) { setShowLeaveConfirm(true); }
        else { socketRef.current?.disconnect(); window.location.href = '/'; }
      },
    },
  ];

  return (
    <>
      <Canvas
        player={character.name}
        characterId={character.id}
        connected={connected}
        showBattleMap={combatActive || dungeon != null}
        encounter={combatActive ? encounter : null}
        tokenUrls={tokenUrls}
        tokenPositions={tokenPositions}
        movementRemaining={movementRemaining}
        deadCreatureIds={deadCreatureIds}
        downPlayerNames={downPlayerNames}
        deadPlayerNames={deadPlayerNames}
        dungeon={dungeon ?? undefined}
      />
      <TurnOrderBar campaignId={character.campaignId} />
      <CombatDock character={character} combatActive={combatActive} movementRemaining={movementRemaining} playerCurrentHp={playerHpState?.current} />
      <EncounterLoadingOverlay />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} header={<span className="palette-clock">{formatWorldTime(worldTimeSecs)}</span>} />
      <CharacterSheetOverlay character={{ ...character, inventory: [...(character.inventory ?? []), ...(acquisitions ?? [])] }} currentHp={playerHpState?.current} maxHp={playerHpState?.max} />
      <JournalOverlay open={journalOpen} onClose={() => setJournalOpen(false)} character={character} sessionActive={sessionActive} dmThinking={dmThinking} />
      <QuestLog open={questLogOpen} onClose={() => setQuestLogOpen(false)} quests={quests} act={act} />
      <CombatLogOverlay open={combatLogOpen} onClose={() => setCombatLogOpen(false)} />
      <ChatWidget />
      <QuickChat open={quickChatOpen} onClose={() => setQuickChatOpen(false)} senderName={character.name} sessionActive={sessionActive} disabled={combatActive && !isMyTurn} />
      {victory && <VictoryScreen data={victory} onDismiss={() => setVictory(null)} />}
      {defeated && <DefeatScreen onDismiss={() => setDefeated(false)} />}
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <RestModal character={character} />
      <BattleMapBackground campaignId={character.campaignId} worldMapUrl={worldMapUrl} />
      <div className="item-notifications">
        {itemNotifications.map(n => (
          <div key={n.id} className="item-notification">
            <span className="item-notification-label">Item received</span>
            <span className="item-notification-name">{n.name}</span>
          </div>
        ))}
      </div>
      {showLeaveConfirm && (
        <div className="modal-overlay" onClick={() => setShowLeaveConfirm(false)}>
          <dialog className="modal" open onClick={e => e.stopPropagation()}>
            <h2 className="modal-title">Adventure still ongoing</h2>
            <p className="modal-hint">Your adventure is still ongoing, would you like to end the session and leave?</p>
            <div className="modal-actions">
              <button className="btn-secondary" onClick={() => setShowLeaveConfirm(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => {
                socketRef.current?.emit('session:end', { campaignId: character.campaignId });
                setTimeout(() => { socketRef.current?.disconnect(); window.location.href = '/'; }, 400);
              }}>
                End Session &amp; Leave
              </button>
            </div>
          </dialog>
        </div>
      )}
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
    if (password === 'admin') { window.location.href = '/admin'; return; }
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

  if (character) return (
    <GameCanvas
      character={character}
      onCharacterUpdate={c => {
        sessionStorage.setItem(sessionKey(campaignId), JSON.stringify(c));
        setCharacter(c);
      }}
    />
  );

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
