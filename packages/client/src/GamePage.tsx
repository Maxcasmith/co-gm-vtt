import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Character, Player, EnemyStatBlock, TokenPosition, Dungeon, Quest } from 'shared';
import { HIT_DICE } from './character-creation/srd.ts';
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
import PartyHud from './PartyHud.tsx';
import TurnOrderBar from './TurnOrderBar.tsx';
import VictoryScreen from './VictoryScreen.tsx';
import DefeatScreen from './DefeatScreen.tsx';
import ReactionPrompt from './ReactionPrompt.tsx';
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
  const [playerSlotsState, setPlayerSlotsState] = useState<{ current: number; max: number } | null>(null);
  const [partyHp, setPartyHp] = useState<Record<string, { current: number; max: number }>>({});
  const [tokenUrls, setTokenUrls] = useState<Record<string, string>>({});
  const [portraitUrls, setPortraitUrls] = useState<Record<string, string>>({});
  const [acquisitions, setAcquisitions] = useState<Character['inventory']>([]);
  const [itemQtyOverrides, setItemQtyOverrides] = useState<Record<string, number>>({});
  const [equipment, setEquipment] = useState<Character['equipment']>(character.equipment);
  const [itemNotifications, setItemNotifications] = useState<{ id: string; name: string }[]>([]);
  const [errorNotifications, setErrorNotifications] = useState<{ id: string; reason: string }[]>([]);
  const [worldMapUrl, setWorldMapUrl] = useState<string | undefined>(undefined);
  const [dungeon, setDungeon] = useState<Dungeon | null>(null);
  const [dungeonGenerating, setDungeonGenerating] = useState(false);
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
    const derivedMax = (HIT_DICE[character.class] ?? 8) + Math.floor((character.stats.con - 10) / 2);
    const max = character.maxHp ?? derivedMax;
    const current = character.currentHp ?? max;
    setPartyHp(prev => ({ ...prev, [character.name]: { current, max } }));
  }, [character.id, character.maxHp, character.currentHp]);

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
    fetch(`${API}/api/campaigns/${character.campaignId}/party/${character.id}`)
      .then(r => r.json())
      .then((c: Character) => {
        setEquipment(c.equipment);
        if (c.maxSpellSlots1) setPlayerSlotsState({ current: c.currentSpellSlots1 ?? c.maxSpellSlots1, max: c.maxSpellSlots1 });
      })
      .catch(() => {});
    socket.on('players:update', setConnected);
    socket.on('players:characters', map => {
      setTokenUrls(Object.fromEntries(
        Object.entries(map).map(([name, charId]) => [name, `${API}/api/campaigns/${character.campaignId}/party/${charId}/token`])
      ));
      setPortraitUrls(Object.fromEntries(
        Object.entries(map).map(([name, charId]) => [name, `${API}/api/campaigns/${character.campaignId}/party/${charId}/portrait`])
      ));
      Object.entries(map).forEach(([name, charId]) => {
        if (name === character.name) return;
        fetch(`${API}/api/campaigns/${character.campaignId}/party/${charId}`)
          .then(r => r.json())
          .then((c: Character) => {
            const derivedMax = (HIT_DICE[c.class] ?? 8) + Math.floor((c.stats.con - 10) / 2);
            const max = c.maxHp ?? derivedMax;
            const current = c.currentHp ?? max;
            setPartyHp(prev => ({ ...prev, [name]: { current, max } }));
          })
          .catch(() => {});
      });
    });
    socket.on('character:inventory:add', items => {
      const acquired = items as NonNullable<Character['inventory']>;
      setAcquisitions(prev => [...(prev ?? []), ...acquired]);
      const notifs = acquired.map(item => ({ id: crypto.randomUUID(), name: item.name }));
      setItemNotifications(prev => [...prev, ...notifs]);
      notifs.forEach(n => setTimeout(() => setItemNotifications(prev => prev.filter(x => x.id !== n.id)), 8500));
    });
    socket.on('character:equipment:update', ({ characterId, slot, itemId }) => {
      if (characterId !== character.id) return;
      setEquipment(prev => ({ ...prev, [slot]: itemId ?? undefined }));
    });
    socket.on('character:inventory:remove', ({ itemId, quantity }) => {
      setItemQtyOverrides(prev => ({ ...prev, [itemId]: quantity }));
    });
    socket.on('combat:attack:blocked', ({ reason }) => {
      const id = crypto.randomUUID();
      setErrorNotifications(prev => [...prev, { id, reason }]);
      setTimeout(() => setErrorNotifications(prev => prev.filter(x => x.id !== id)), 4000);
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
      if (!active) {
        setEncounter(null);
        fetch(`${API}/api/campaigns/${character.campaignId}/party/${character.id}`)
          .then(r => r.json())
          .then((c: Character) => onCharacterUpdateRef.current(c))
          .catch(() => {});
      }
    });
    socket.on('combat:turn', data => dispatch('vtt:combat:turn', data));
    socket.on('combat:initiative', entry => dispatch('vtt:combat:initiative', { entry }));
    socket.on('combat:turn:order', entries => dispatch('vtt:combat:turn:order', { entries }));
    socket.on('combat:attack:result', result => dispatch('vtt:combat:attack:result', result));
    socket.on('combat:spell:attack:result', result => dispatch('vtt:combat:spell:attack:result', result));
    socket.on('combat:spell:save:result', result => dispatch('vtt:combat:spell:save:result', result));
    socket.on('combat:damage:dealt', data => dispatch('vtt:combat:damage:dealt', data));
    socket.on('combat:player:damage', data => {
      dispatch('vtt:combat:player:damage', data);
      if (data.characterId === character.id) setPlayerHpState({ current: data.currentHp, max: data.maxHp });
      setPartyHp(prev => ({ ...prev, [data.characterName]: { current: data.currentHp, max: data.maxHp } }));
      if (data.currentHp <= 0) setDownPlayerNames(prev => new Set([...prev, data.characterName]));
      else setDownPlayerNames(prev => { const s = new Set(prev); s.delete(data.characterName); return s; });
    });
    socket.on('combat:player:slots', data => {
      dispatch('vtt:combat:player:slots', data);
      if (data.characterId === character.id) setPlayerSlotsState({ current: data.currentSpellSlots1, max: data.maxSpellSlots1 });
    });
    socket.on('combat:death:save', data => dispatch('vtt:combat:death:save', data));
    socket.on('combat:defeat', () => { dispatch('vtt:combat:defeat', {}); setDefeated(true); });
    socket.on('combat:player:dead', data => {
      dispatch('vtt:combat:player:dead', data);
      setDeadPlayerNames(prev => new Set([...prev, data.characterName]));
      setDownPlayerNames(prev => { const s = new Set(prev); s.delete(data.characterName); return s; });
    });
    const unsubConsumableUsed = on('vtt:consumable:used', ({ item, characterId }) => {
      socket.emit('consumable:used', { characterId, itemId: item.id });
    });
    const unsubHeal = on('vtt:consumable:heal', payload => socket.emit('consumable:heal', payload));
    socket.on('consumable:heal:result', data => {
      dispatch('vtt:consumable:heal:result', data);
      if (data.characterId === character.id) setPlayerHpState({ current: data.currentHp, max: data.maxHp });
      setPartyHp(prev => ({ ...prev, [data.characterName]: { current: data.currentHp, max: data.maxHp } }));
      if (data.currentHp > 0) setDownPlayerNames(prev => { const s = new Set(prev); s.delete(data.characterName); return s; });
    });
    socket.on('rest:result', data => {
      if (data.resting && data.currentHp != null && data.maxHp != null) {
        setPartyHp(prev => ({ ...prev, [data.characterName]: { current: data.currentHp!, max: data.maxHp! } }));
      }
      if (data.characterId !== character.id) return;
      if (data.resting && data.currentHp != null && data.maxHp != null) {
        setPlayerHpState({ current: data.currentHp, max: data.maxHp });
        if (data.maxSpellSlots1) setPlayerSlotsState({ current: data.currentSpellSlots1 ?? data.maxSpellSlots1, max: data.maxSpellSlots1 });
        fetch(`${API}/api/campaigns/${character.campaignId}/party/${character.id}`)
          .then(r => r.json())
          .then((c: Character) => onCharacterUpdateRef.current(c))
          .catch(() => {});
      }
      dispatch('vtt:rest:result', data);
    });
    socket.on('creature:update', data => {
      dispatch('vtt:creature:update', data);
      if (data.effects.includes('Dead')) setDeadCreatureIds(prev => new Set([...prev, data.id]));
    });
    socket.on('combat:victory', data => {
      dispatch('vtt:combat:victory', data);
      setVictory(data);
    });
    socket.on('token:moved', (pos: TokenPosition) => {
      setTokenPositions(prev => ({ ...prev, [pos.tokenId]: { gx: pos.gx, gy: pos.gy } }));
    });
    socket.on('encounter:generating', () => dispatch('vtt:encounter:generating', {}));
    socket.on('encounter:ready', enemies => { setEncounter(enemies); dispatch('vtt:encounter:ready', { enemies }); });
    socket.on('session:recap', ({ text, senderName, checkRequests }) => {
      dispatch('vtt:chat:message-received', { text, senderName, timestamp: Date.now(), variant: 'recap', checkRequests });
    });
    socket.on('combat:player:resources', data => dispatch('vtt:combat:player:resources', data));
    socket.on('rest:open', () => dispatch('vtt:rest:open', {}));
    socket.on('rest:progress', data => dispatch('vtt:rest:progress', data));
    socket.on('combat:reaction:offer', data => dispatch('vtt:combat:reaction:offer', data));
    socket.on('combat:reaction:close', data => dispatch('vtt:combat:reaction:close', data));
    socket.on('combat:log', data => dispatch('vtt:combat:log', { kind: 'text', ...data }));
    socket.on('dungeon:generating', () => setDungeonGenerating(true));
    socket.on('dungeon:loaded', dungeon => { setDungeonGenerating(false); setDungeon(dungeon); dispatch('vtt:dungeon:loaded', dungeon); });
    socket.on('dungeon:cleared', () => setDungeon(null));
    socket.on('quest:update', ({ quests: q, act: a }) => { setQuests(q); setAct(a); });
    socket.on('clock:update', ({ worldTimeSecs: t }) => { setWorldTimeSecs(t); });

    const unsubTokenMove = on('vtt:token:move', pos => {
      socket.emit('token:move', pos);
      setTokenPositions(prev => ({ ...prev, [pos.tokenId]: { gx: pos.gx, gy: pos.gy } }));
    });
    const unsubTurnEnd      = on('vtt:combat:turn:end', () => socket.emit('combat:turn:end'));
    const unsubInitRoll     = on('vtt:combat:initiative:roll', ({ entry }) => socket.emit('combat:initiative:roll', entry));
    const unsubRestChoice   = on('vtt:rest:choice', payload => socket.emit('rest:choice', { ...payload, campaignId: character.campaignId, characterId: character.id }));
    const unsubRestCancel   = on('vtt:rest:cancel', () => socket.emit('rest:cancel', { campaignId: character.campaignId, characterId: character.id }));
    const unsubRestRequest  = on('vtt:rest:request', () => socket.emit('rest:open'));

    return () => {
      socketRef.current = null;
      socket.disconnect();
      unsubCheck();
      unsubSave();
      unsubChat();
      unsubTokenMove();
      unsubTurnEnd();
      unsubInitRoll();
      unsubRestChoice();
      unsubRestCancel();
      unsubRestRequest();
      unsubHeal();
      unsubConsumableUsed();
    };
  }, [character.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:state', ({ active }) => {
    setCombatActive(active);
    if (active) { setJournalOpen(false); setQuickChatOpen(false); }
    if (!active) { setIsMyTurn(false); setVictory(null); setDefeated(false); setDeadCreatureIds(new Set()); setDownPlayerNames(new Set()); setDeadPlayerNames(new Set()); setPlayerHpState(null); }
  }), []);
  useEffect(() => on('vtt:combat:turn', ({ actorName }) => setIsMyTurn(actorName === character.name)), [character.name]);
  useEffect(() => on('vtt:combat:attack', ({ attackerId, attackerName, targetId, weapon, bonusSpell }) => {
    socketRef.current?.emit('combat:attack', { attackerId, attackerName, targetId, weapon, ...(bonusSpell ? { bonusSpell } : {}) });
  }), []);
  useEffect(() => on('vtt:combat:spell:attack', ({ casterId, casterName, targetId, spell, slotLevel }) => {
    socketRef.current?.emit('combat:spell:attack', { casterId, casterName, targetId, spell, slotLevel });
  }), []);
  useEffect(() => on('vtt:combat:spell:cast', ({ casterId, casterName, spell, slotLevel, targetIds }) => {
    socketRef.current?.emit('combat:spell:cast', { casterId, casterName, spell, slotLevel, targetIds });
  }), []);
  useEffect(() => on('vtt:equipment:update', payload => {
    socketRef.current?.emit('character:equipment:update', payload);
  }), []);
  // Movement resets to full only at the START of this player's turn, not on combat start
  useEffect(() => { if (!combatActive) setMovementRemaining(0); }, [combatActive]);
  useEffect(() => on('vtt:combat:turn', ({ actorName }) => {
    if (actorName === character.name) setMovementRemaining(character.speed ?? 30);
  }), [character.name, character.speed]);
  useEffect(() => on('vtt:movement:used',   ({ ft }) => setMovementRemaining(prev => Math.max(0, prev - ft))), []);
  useEffect(() => on('vtt:movement:gained', ({ ft }) => setMovementRemaining(prev => prev + ft)), []);

  useEffect(() => {
    if (!dungeon) return;
    const socket = socketRef.current;
    const room = dungeon.rooms.find(r => r.role === 'entrance') ?? dungeon.rooms[0];
    if (!room) return;

    // Spread players across the entrance room without stacking any two on the same cell —
    // a raw +i offset collapses onto the room's edge once the party outgrows a small room.
    const cx = room.x + Math.floor(room.width / 2);
    const cy = room.y + Math.floor(room.height / 2);
    const used = new Set<string>();
    const key = (x: number, y: number) => `${x},${y}`;
    // Organic-grid rooms are irregular shapes, not solid rects — a bounding-box cell can be a wall
    // (e.g. the geometric center of an L-shaped room). Must check the actual floor, not just the box.
    const isFloor = (x: number, y: number) => dungeon.cells[y]?.[x] === 1;
    const inRoom = (x: number, y: number) => x >= room.x && x < room.x + room.width && y >= room.y && y < room.y + room.height && isFloor(x, y);
    const findFree = (targetX: number, targetY: number): { gx: number; gy: number } => {
      if (inRoom(targetX, targetY) && !used.has(key(targetX, targetY))) return { gx: targetX, gy: targetY };
      const maxRadius = Math.max(room.width, room.height);
      for (let r = 1; r <= maxRadius; r++) {
        for (let dx = -r; dx <= r; dx++) {
          for (let dy = -r; dy <= r; dy++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = targetX + dx, y = targetY + dy;
            if (x < room.x || x >= room.x + room.width || y < room.y || y >= room.y + room.height) continue;
            if (!isFloor(x, y)) continue;
            if (!used.has(key(x, y))) return { gx: x, gy: y };
          }
        }
      }
      return { gx: targetX, gy: targetY }; // room genuinely full — overlap is the least-bad fallback
    };

    // dungeon.positions is the server's saved-position snapshot, bundled directly on this same
    // payload — never default-place (or emit a move for) a player who already has one, otherwise
    // every reconnect/refresh silently stomps their real position with a fresh entrance spawn.
    const saved = dungeon.positions ?? {};
    const defaults: Record<string, { gx: number; gy: number }> = {};
    connected.forEach((name, i) => {
      if (saved[name]) return;
      const pos = findFree(cx + i, cy);
      used.add(key(pos.gx, pos.gy));
      defaults[name] = pos;
    });

    setTokenPositions(prev => {
      const next = { ...prev };
      Object.entries(saved).forEach(([id, pos]) => { next[id] = pos; });
      Object.entries(defaults).forEach(([id, pos]) => { if (!next[id]) next[id] = pos; });
      return next;
    });

    if (socket) {
      Object.entries(defaults).forEach(([tokenId, pos]) => socket.emit('token:move', { tokenId, ...pos }));
    }
  }, [dungeon]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } else if (e.key === 'c' && !journalOpen && now - lastSpaceRef.current < DOUBLE_TAP_MS) {
        lastSpaceRef.current = 0;
        setQuickChatOpen(true);
      } else if (e.key === 'q' && now - lastSpaceRef.current < DOUBLE_TAP_MS) {
        lastSpaceRef.current = 0;
        setQuestLogOpen(o => !o);
      } else if (e.key === 'j' && now - lastSpaceRef.current < DOUBLE_TAP_MS) {
        lastSpaceRef.current = 0;
        setJournalOpen(o => !o);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [journalOpen]);

  const paletteItems = [
    {
      label: 'Character Sheet',
      description: 'View your full character',
      onSelect: () => dispatch('vtt:sheet:opened', { characterId: character.id }),
    },
    ...(!combatActive ? [{
      label: 'Rest',
      description: 'Take a short or long rest',
      onSelect: () => socketRef.current?.emit('rest:open'),
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

  const liveCharacter: Character = {
    ...character,
    inventory: [...(character.inventory ?? []), ...(acquisitions ?? [])]
      .map(item => itemQtyOverrides[item.id] != null ? { ...item, quantity: itemQtyOverrides[item.id] } : item)
      .filter(item => item.quantity > 0),
    equipment,
  };

  return (
    <>
      <Canvas
        player={character.name}
        characterId={character.id}
        character={character}
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
        speed={character.speed}
        sessionActive={sessionActive}
      />
      <TurnOrderBar campaignId={character.campaignId} />
      <PartyHud connected={connected} portraitUrls={portraitUrls} self={character.name} hp={partyHp} />
      <CombatDock character={liveCharacter} combatActive={combatActive} movementRemaining={movementRemaining} playerCurrentHp={playerHpState?.current} />
      <EncounterLoadingOverlay />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} header={<span className="palette-clock">{formatWorldTime(worldTimeSecs)}</span>} />
      <CharacterSheetOverlay
        character={liveCharacter}
        currentHp={playerHpState?.current} maxHp={playerHpState?.max}
        currentSpellSlots1={playerSlotsState?.current} maxSpellSlots1={playerSlotsState?.max}
        sessionActive={sessionActive}
      />
      <JournalOverlay open={journalOpen} onClose={() => setJournalOpen(false)} character={character} sessionActive={sessionActive} dmThinking={dmThinking} />
      <QuestLog open={questLogOpen} onClose={() => setQuestLogOpen(false)} quests={quests} act={act} />
      <CombatLogOverlay open={combatLogOpen} onClose={() => setCombatLogOpen(false)} />
      {!journalOpen && <ChatWidget />}
      <QuickChat open={quickChatOpen} onClose={() => setQuickChatOpen(false)} senderName={character.name} sessionActive={sessionActive} disabled={combatActive && !isMyTurn} />
      {victory && <VictoryScreen data={victory} onDismiss={() => setVictory(null)} />}
      {defeated && <DefeatScreen onDismiss={() => setDefeated(false)} />}
      <ReactionPrompt onRespond={(requestId, accepted) => socketRef.current?.emit('combat:reaction:respond', { requestId, accepted })} />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <RestModal character={character} />
      <BattleMapBackground worldMapUrl={worldMapUrl} />
      <div className="item-notifications">
        {dungeonGenerating && (
          <div className="item-notification">
            <span className="item-notification-label">Generating dungeon…</span>
          </div>
        )}
        {itemNotifications.map(n => (
          <div key={n.id} className="item-notification">
            <span className="item-notification-label">Item received</span>
            <span className="item-notification-name">{n.name}</span>
          </div>
        ))}
        {errorNotifications.map(n => (
          <div key={n.id} className="item-notification item-notification--error">
            <span className="item-notification-name">{n.reason}</span>
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
