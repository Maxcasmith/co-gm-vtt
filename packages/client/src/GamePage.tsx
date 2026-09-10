import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import type { Character, Player, EnemyStatBlock, TokenPosition, Dungeon, Quest, TurnOrderEntry, StoryboardQueuePayload, HouseRules } from 'shared';
import { DEFAULT_HOUSE_RULES } from 'shared';
import { HIT_DICE } from './character-creation/srd.ts';
import { Button } from './components/Button/Button.tsx';
import Canvas from './Canvas.tsx';
import EncounterLoadingOverlay from './EncounterLoadingOverlay.tsx';
import DungeonLoadingOverlay from './DungeonLoadingOverlay.tsx';
import StoryboardOverlay from './StoryboardOverlay.tsx';
import PartyMemberOverlay from './PartyMemberOverlay.tsx';
import { useDungeonReady } from './canvas/useDungeonReady.ts';
import CommandPalette from './CommandPalette.tsx';
import CharacterSheetOverlay from './CharacterSheetOverlay.tsx';
import JournalOverlay from './JournalOverlay.tsx';
import QuestLog from './QuestLog.tsx';
import CombatLogOverlay from './CombatLogOverlay.tsx';
import ChatWidget from './ChatWidget.tsx';
import QuickChat from './QuickChat.tsx';
import ShortcutsOverlay from './ShortcutsOverlay.tsx';
import DevModal from './DevModal.tsx';
import RestModal from './RestModal.tsx';
import BattleMapBackground from './BattleMapBackground.tsx';
import CombatDock from './CombatDock.tsx';
import PartyHud from './PartyHud.tsx';
import TurnOrderBar from './TurnOrderBar.tsx';
import VictoryScreen from './VictoryScreen.tsx';
import DefeatScreen from './DefeatScreen.tsx';
import CongratsScreen from './CongratsScreen.tsx';
import ReactionPrompt from './ReactionPrompt.tsx';
import { dispatch, on } from './events.ts';
import { initNarration, narrate } from './narration.ts';
import { loadRuntimeTilesets } from './dungeonThemes.ts';
import './app.css';

const API = `http://${window.location.hostname}:3001`;
const sessionKey = (id: string) => `vtt-session:${id}`;

function readSession(campaignId: string): Character | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(campaignId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Character;
    return parsed.stats ? parsed : null;
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
  const [devModalOpen, setDevModalOpen] = useState(false);
  const [sessionActive, setSessionActive] = useState(false);
  const [storyboardQueue, setStoryboardQueue] = useState<StoryboardQueuePayload | null>(null);
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
  const [playerHpState, setPlayerHpState] = useState<{ current: number; max: number; temp?: number } | null>(null);
  const [playerSlotsState, setPlayerSlotsState] = useState<{ current: number; max: number } | null>(null);
  const [partyHp, setPartyHp] = useState<Record<string, { current: number; max: number }>>({});
  const [tokenUrls, setTokenUrls] = useState<Record<string, string>>({});
  const [portraitUrls, setPortraitUrls] = useState<Record<string, string>>({});
  const [partyCharacterIds, setPartyCharacterIds] = useState<Record<string, string>>({});
  const partyCharacterIdsRef = useRef<Record<string, string>>({});
  useEffect(() => { partyCharacterIdsRef.current = partyCharacterIds; }, [partyCharacterIds]);
  const [partyAiControlled, setPartyAiControlled] = useState<Record<string, boolean>>({});
  const [viewingMemberId, setViewingMemberId] = useState<string | null>(null);
  const [acquisitions, setAcquisitions] = useState<Character['inventory']>([]);
  const [itemQtyOverrides, setItemQtyOverrides] = useState<Record<string, number>>({});
  const [resourceOverrides, setResourceOverrides] = useState<Record<string, number> | null>(null);
  const [inspirationOverride, setInspirationOverride] = useState<boolean | null>(null);
  const [equipment, setEquipment] = useState<Character['equipment']>(character.equipment);
  const [liveConditions, setLiveConditions] = useState<Character['conditions']>(character.conditions);
  // Same pattern `equipment` uses: AITab edits its own copy of tactics/aiControlled and never
  // touches the `character` object the overlay was opened with, so without mirroring the saved
  // value back here, switching tabs (which unmounts AITab) would show stale pre-edit tactics
  // even though the edit already made it to disk.
  const [tactics, setTactics] = useState<Character['tactics']>(character.tactics);
  const [aiControlled, setAiControlled] = useState<Character['aiControlled']>(character.aiControlled);
  // Party allies (recruited NPCs, Find Familiar/Unseen Servant companions) — a subset of the
  // turn order, kept separately so Canvas can render their tokens and let an owner (ownerId
  // matching this character) drag theirs the same way they drag their own.
  const [companions, setCompanions] = useState<TurnOrderEntry[]>([]);
  // HUD actions unlocked by an active buff this turn (Expeditious Retreat's Dash-as-Bonus-Action,
  // Jump) — see ActionUnlockHook/emitTurn (server) and CombatDock's ACTION_UNLOCKS table (client).
  const [activeBuffs, setActiveBuffs] = useState<string[]>([]);
  // Elevation (Feather Fall, falling damage) — every token's height, not just this player's, so
  // Canvas can badge anyone currently off the ground.
  const [elevations, setElevations] = useState<Record<string, number>>({});
  const [itemNotifications, setItemNotifications] = useState<{ id: string; name: string }[]>([]);
  const [errorNotifications, setErrorNotifications] = useState<{ id: string; reason: string }[]>([]);
  const [worldMapUrl, setWorldMapUrl] = useState<string | undefined>(undefined);
  const [dungeon, setDungeon] = useState<Dungeon | null>(null);
  // The big socket-setup effect below only re-registers on character.name change, so its handlers
  // close over stale state — this mirror lets the quest:update handler read the CURRENT dungeon.
  const dungeonRef = useRef<Dungeon | null>(null);
  useEffect(() => { dungeonRef.current = dungeon; }, [dungeon]);
  const [dungeonGenerating, setDungeonGenerating] = useState(false);
  const dungeonReady = useDungeonReady(dungeon ?? undefined, dungeonGenerating);
  const [questLogOpen, setQuestLogOpen] = useState(false);
  const [quests, setQuests] = useState<Quest[]>([]);
  // Set once the dungeon's whole questChain resolves (quest:update's `final` flag) — the full
  // page recap screen, not the old per-stage popup. Cleared once Finish navigates away.
  const [congrats, setCongrats] = useState<{ dungeon: Dungeon; quests: Quest[]; roster: Character[] } | null>(null);
  const [act, setAct] = useState(1);
  const [worldTimeSecs, setWorldTimeSecs] = useState(43200);
  // Reaction-sidebar display prefs — set on GameSettingsPage, fetched once here since they never
  // change mid-session (a settings change means leaving this page and coming back).
  const [houseRules, setHouseRules] = useState<HouseRules>(DEFAULT_HOUSE_RULES);
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

  useEffect(() => { loadRuntimeTilesets(); }, []);

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

  useEffect(() => {
    fetch(`${API}/api/campaigns/${character.campaignId}`)
      .then(r => r.json())
      .then((c: { houseRules?: HouseRules }) => setHouseRules({ ...DEFAULT_HOUSE_RULES, ...c.houseRules }))
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
        onCharacterUpdateRef.current(c);
        setEquipment(c.equipment);
        setTactics(c.tactics);
        setAiControlled(c.aiControlled);
        if (c.maxSpellSlots1) setPlayerSlotsState({ current: c.currentSpellSlots1 ?? c.maxSpellSlots1, max: c.maxSpellSlots1 });
      })
      .catch(() => {});
    socket.on('players:update', setConnected);
    socket.on('players:characters', map => {
      setPartyCharacterIds(map);
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
            if (!c?.stats) return;
            const derivedMax = (HIT_DICE[c.class] ?? 8) + Math.floor((c.stats.con - 10) / 2);
            const max = c.maxHp ?? derivedMax;
            const current = c.currentHp ?? max;
            setPartyHp(prev => ({ ...prev, [name]: { current, max } }));
            setPartyAiControlled(prev => ({ ...prev, [name]: !!c.aiControlled }));
          })
          .catch(() => {});
      });
    });
    socket.on('character:aiControlled:update', ({ characterId, aiControlled }) => {
      const name = Object.entries(partyCharacterIdsRef.current).find(([, id]) => id === characterId)?.[0];
      if (name) setPartyAiControlled(prev => ({ ...prev, [name]: aiControlled }));
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
    socket.on('character:tactics:update', ({ characterId, tactics, aiControlled }) => {
      if (characterId !== character.id) return;
      setTactics(tactics);
      setAiControlled(aiControlled);
    });
    socket.on('character:inventory:remove', ({ itemId, quantity }) => {
      setItemQtyOverrides(prev => ({ ...prev, [itemId]: quantity }));
    });
    // Generic resource-pool pushes (Rage, Second Wind, Luck Points, ...) — keeps CombatDock's
    // resourceCurrent()-driven pips (and Lucky's point count) live without a full character
    // refetch. Kept as a separate override (see itemQtyOverrides above) rather than merged into
    // `character` directly — this effect only runs once per character.name, so `character` here
    // would otherwise be a stale closure by the time this fires.
    socket.on('combat:player:featureResources', ({ characterId, resourceUses }) => {
      if (characterId !== character.id) return;
      setResourceOverrides(resourceUses);
    });
    // Heroic Inspiration granted (Musician) or spent (roll toggles) — same stale-closure reasoning
    // as featureResources above, kept as its own override for the same fix.
    socket.on('character:inspiration:update', ({ heroicInspiration }) => {
      setInspirationOverride(heroicInspiration);
    });
    socket.on('character:currency:update', ({ characterId }) => {
      if (characterId !== character.id) return;
      fetch(`${API}/api/campaigns/${character.campaignId}/party/${character.id}`)
        .then(r => r.json())
        .then((c: Character) => onCharacterUpdateRef.current(c))
        .catch(() => {});
    });
    socket.on('character:condition:update', ({ targetId, conditions }) => {
      if (targetId !== character.id) return;
      setLiveConditions(conditions);
    });
    socket.on('combat:elevation:update', ({ targetId, elevationFt }) => {
      setElevations(prev => (elevationFt === 0
        ? Object.fromEntries(Object.entries(prev).filter(([id]) => id !== targetId))
        : { ...prev, [targetId]: elevationFt }));
    });
    socket.on('movement:granted', ({ ft }) => setMovementRemaining(prev => prev + ft));
    socket.on('combat:attack:blocked', ({ reason }) => {
      const id = crypto.randomUUID();
      setErrorNotifications(prev => [...prev, { id, reason }]);
      setTimeout(() => setErrorNotifications(prev => prev.filter(x => x.id !== id)), 4000);
    });

    // Bridge roll events from the UI → socket
    const unsubCheck = on('vtt:roll:check', payload => socket.emit('roll:check', payload));
    const unsubSave  = on('vtt:roll:save',  payload => socket.emit('roll:save',  payload));
    const unsubCastExploration = on('vtt:spell:cast:exploration', payload => socket.emit('spell:cast:exploration', payload));

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
    socket.on('storyboard:queue', setStoryboardQueue);
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
    socket.on('combat:effect:aura:start', data => dispatch('vtt:combat:effect:aura:start', data));
    socket.on('combat:effect:aura:end', data => dispatch('vtt:combat:effect:aura:end', data));
    socket.on('combat:effect:impact', data => dispatch('vtt:combat:effect:impact', data));
    socket.on('combat:damage:dealt', data => dispatch('vtt:combat:damage:dealt', data));
    socket.on('combat:concentration', data => dispatch('vtt:combat:concentration', data));
    socket.on('combat:mark', data => dispatch('vtt:combat:mark', data));
    socket.on('combat:player:damage', data => {
      dispatch('vtt:combat:player:damage', data);
      if (data.characterId === character.id) setPlayerHpState({ current: data.currentHp, max: data.maxHp, temp: data.tempHp });
      setPartyHp(prev => ({ ...prev, [data.characterName]: { current: data.currentHp, max: data.maxHp } }));
      if (data.currentHp <= 0) setDownPlayerNames(prev => new Set([...prev, data.characterName]));
      else setDownPlayerNames(prev => { const s = new Set(prev); s.delete(data.characterName); return s; });
    });
    socket.on('combat:player:tempHp', data => {
      dispatch('vtt:combat:player:tempHp', data);
      if (data.characterId === character.id) setPlayerHpState(prev => prev ? { ...prev, temp: data.tempHp } : { current: character.currentHp ?? 0, max: character.maxHp ?? 0, temp: data.tempHp });
    });
    socket.on('combat:player:heal', data => {
      dispatch('vtt:combat:player:heal', data);
      if (data.characterId === character.id) setPlayerHpState(prev => ({ current: data.currentHp, max: data.maxHp, temp: prev?.temp }));
      setPartyHp(prev => ({ ...prev, [data.characterName]: { current: data.currentHp, max: data.maxHp } }));
      if (data.currentHp > 0) setDownPlayerNames(prev => { const s = new Set(prev); s.delete(data.characterName); return s; });
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
    const unsubLockpick = on('vtt:consumable:lockpick', payload => socket.emit('consumable:lockpick', payload));
    const unsubTrapDisarm = on('vtt:consumable:trapdisarm', payload => socket.emit('consumable:trapdisarm', payload));
    socket.on('consumable:heal:result', data => {
      dispatch('vtt:consumable:heal:result', data);
      if (data.characterId === character.id) setPlayerHpState(prev => ({ current: data.currentHp, max: data.maxHp, temp: prev?.temp }));
      setPartyHp(prev => ({ ...prev, [data.characterName]: { current: data.currentHp, max: data.maxHp } }));
      if (data.currentHp > 0) setDownPlayerNames(prev => { const s = new Set(prev); s.delete(data.characterName); return s; });
    });
    socket.on('rest:result', data => {
      if (data.resting && data.currentHp != null && data.maxHp != null) {
        setPartyHp(prev => ({ ...prev, [data.characterName]: { current: data.currentHp!, max: data.maxHp! } }));
      }
      if (data.characterId !== character.id) return;
      if (data.resting && data.currentHp != null && data.maxHp != null) {
        setPlayerHpState(prev => ({ current: data.currentHp!, max: data.maxHp!, temp: prev?.temp }));
        if (data.maxSpellSlots1) setPlayerSlotsState({ current: data.currentSpellSlots1 ?? data.maxSpellSlots1, max: data.maxSpellSlots1 });
        if (data.resourceUses) setResourceOverrides(data.resourceUses);
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
    socket.on('dungeon:loaded', dungeon => { setDungeonGenerating(false); setDungeon(dungeon); dispatch('vtt:dungeon:loaded', dungeon); loadRuntimeTilesets(); });
    socket.on('dungeon:cleared', () => setDungeon(null));
    socket.on('quest:update', ({ quests: q, act: a, final }) => {
      setQuests(q);
      setAct(a);
      // `final` (see questChain.ts) means this update closed the dungeon's whole questChain, not
      // just one stage of it — only then does the full recap screen show, once, at the true end.
      const dungeonNow = dungeonRef.current;
      if (!final || !dungeonNow) return;
      const resolvedChain = q.filter((nq: Quest) => nq.sourceDungeonId === dungeonNow.id && nq.status === 'resolved');
      fetch(`${API}/api/campaigns/${character.campaignId}/party`)
        .then(r => r.json())
        .then((roster: Character[]) => setCongrats({ dungeon: dungeonNow, quests: resolvedChain, roster }))
        .catch(() => setCongrats({ dungeon: dungeonNow, quests: resolvedChain, roster: [] }));
    });
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
    const unsubEscape       = on('vtt:condition:escape:attempt', payload => socket.emit('combat:condition:escape', payload));
    const unsubElevation    = on('vtt:combat:elevation:set', payload => socket.emit('combat:elevation:set', payload));
    const unsubDisengage    = on('vtt:combat:disengage', payload => socket.emit('combat:disengage', payload));
    const unsubStdAction    = on('vtt:combat:standardAction:used', payload => socket.emit('combat:standardAction:used', payload));
    const unsubAlertSwap    = on('vtt:combat:alert:swap', payload => socket.emit('combat:alert:swap', { ...payload, campaignId: character.campaignId }));
    const unsubHealerKit    = on('vtt:combat:healerKit:use', payload => socket.emit('combat:healerKit:use', payload));
    const unsubDoorToggle   = on('vtt:door:toggle', ({ doorId }) => socket.emit('door:toggle', { campaignId: character.campaignId, doorId, characterName: character.name }));
    const unsubStairsUse    = on('vtt:stairs:use', ({ stairsId }) => socket.emit('stairs:use', { campaignId: character.campaignId, stairsId, characterName: character.name }));

    return () => {
      socketRef.current = null;
      socket.disconnect();
      unsubCheck();
      unsubSave();
      unsubCastExploration();
      unsubChat();
      unsubTokenMove();
      unsubTurnEnd();
      unsubInitRoll();
      unsubRestChoice();
      unsubRestCancel();
      unsubRestRequest();
      unsubEscape();
      unsubElevation();
      unsubDisengage();
      unsubStdAction();
      unsubAlertSwap();
      unsubHealerKit();
      unsubHeal();
      unsubLockpick();
      unsubTrapDisarm();
      unsubConsumableUsed();
      unsubDoorToggle();
      unsubStairsUse();
    };
  }, [character.name]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => on('vtt:combat:state', ({ active }) => {
    setCombatActive(active);
    if (active) { setJournalOpen(false); setQuickChatOpen(false); }
    if (!active) { setIsMyTurn(false); setVictory(null); setDefeated(false); setDeadCreatureIds(new Set()); setDownPlayerNames(new Set()); setDeadPlayerNames(new Set()); setPlayerHpState(null); setCompanions([]); setActiveBuffs([]); setElevations({}); }
  }), []);
  // Ally roster (teamId 'players') — recruited NPCs, spell-summoned companions, and offline
  // party members who opted into AI control (see the AI tab) all flow through the same
  // turn-order broadcasts real players do; the last group is isPlayer:true but absent from
  // `connected`, which is what distinguishes them from an actually-present player here.
  useEffect(() => on('vtt:combat:initiative', ({ entry }) => {
    if (entry.teamId !== 'players' || (entry.isPlayer && connected.includes(entry.name))) return;
    setCompanions(prev => [...prev.filter(e => e.id !== entry.id), entry]);
  }), [connected]);
  useEffect(() => on('vtt:combat:turn:order', ({ entries }) => {
    setCompanions(entries.filter(e => e.teamId === 'players' && (!e.isPlayer || !connected.includes(e.name))));
  }), [connected]);
  useEffect(() => on('vtt:combat:turn', ({ actorName }) => setIsMyTurn(actorName === character.name)), [character.name]);
  useEffect(() => on('vtt:combat:attack', ({ attackerId, attackerName, targetId, weapon, bonusSpell, isOffhand, useInspiration }) => {
    socketRef.current?.emit('combat:attack', { attackerId, attackerName, targetId, weapon, ...(bonusSpell ? { bonusSpell } : {}), ...(isOffhand ? { isOffhand } : {}), ...(useInspiration ? { useInspiration } : {}) });
  }), []);
  useEffect(() => on('vtt:combat:ability:use', ({ casterId, casterName, abilityKey, targetId, chosenItem, chosenAmount }) => {
    socketRef.current?.emit('combat:ability:use', { casterId, casterName, abilityKey, targetId, chosenItem, chosenAmount });
  }), []);
  useEffect(() => on('vtt:combat:spell:attack', ({ casterId, casterName, targetIds, spell, slotLevel, chosenDamageType }) => {
    socketRef.current?.emit('combat:spell:attack', { casterId, casterName, targetIds, spell, slotLevel, chosenDamageType });
  }), []);
  useEffect(() => on('vtt:combat:spell:cast', ({ casterId, casterName, spell, slotLevel, targetIds, chosenDamageType, chosenCommand, chosenSkill, originGx, originGy }) => {
    socketRef.current?.emit('combat:spell:cast', { casterId, casterName, spell, slotLevel, targetIds, chosenDamageType, chosenCommand, chosenSkill, ...(originGx !== undefined ? { originGx, originGy } : {}) });
  }), []);
  useEffect(() => on('vtt:equipment:update', payload => {
    socketRef.current?.emit('character:equipment:update', payload);
  }), []);
  useEffect(() => on('vtt:tactics:update', payload => {
    socketRef.current?.emit('character:tactics:update', payload);
  }), []);
  // Movement resets to full only at the START of this player's turn, not on combat start
  useEffect(() => { if (!combatActive) setMovementRemaining(0); }, [combatActive]);
  useEffect(() => on('vtt:combat:turn', ({ actorName, speedMultiplier, speedBonusFt, buffs }) => {
    if (actorName !== character.name) return;
    setMovementRemaining(Math.floor(((character.speed ?? 30) + (speedBonusFt ?? 0)) * (speedMultiplier ?? 1)));
    setActiveBuffs(buffs ?? []);
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
      } else if (e.key === 'D' && e.shiftKey) {
        setDevModalOpen(o => !o);
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

  const myDungeonPos = tokenPositions[character.name];
  const currentRoomName = dungeon && myDungeonPos
    ? dungeon.rooms.find(r => myDungeonPos.gx >= r.x && myDungeonPos.gx < r.x + r.width && myDungeonPos.gy >= r.y && myDungeonPos.gy < r.y + r.height)?.name
    : undefined;

  // Ally tokens on the map should include every party member the lobby knows about, not just
  // who's actually connected right now — an offline AI-controlled party member is still a live
  // token on the board (it takes damage, it should be visible), same as a connected human's.
  const mapAllyNames = [...new Set([...connected, ...Object.keys(partyCharacterIds)])];

  const liveCharacter: Character = {
    ...character,
    inventory: [...(character.inventory ?? []), ...(acquisitions ?? [])]
      .map(item => itemQtyOverrides[item.id] != null ? { ...item, quantity: itemQtyOverrides[item.id] } : item)
      .filter(item => item.quantity > 0),
    equipment,
    conditions: liveConditions,
    tactics,
    aiControlled,
    resourceUses: resourceOverrides ?? character.resourceUses,
    heroicInspiration: inspirationOverride ?? character.heroicInspiration,
  };

  return (
    <>
      <Canvas
        player={character.name}
        characterId={character.id}
        character={character}
        connected={mapAllyNames}
        showBattleMap={combatActive || dungeon != null}
        encounter={combatActive ? encounter : null}
        companions={combatActive ? companions : []}
        elevations={elevations}
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
      {currentRoomName && <div className="room-name-banner">{currentRoomName}</div>}
      <TurnOrderBar campaignId={character.campaignId} encounter={encounter} deadCreatureIds={deadCreatureIds} />
      <PartyHud
        roster={Object.keys(partyCharacterIds)}
        connected={connected}
        aiControlled={{ ...partyAiControlled, [character.name]: !!aiControlled }}
        portraitUrls={portraitUrls}
        characterIds={partyCharacterIds}
        self={character.name}
        hp={partyHp}
        selfTempHp={playerHpState?.temp}
        onSelectMember={setViewingMemberId}
      />
      <CombatDock character={liveCharacter} combatActive={combatActive} movementRemaining={movementRemaining} playerCurrentHp={playerHpState?.current} activeBuffs={activeBuffs} elevationFt={elevations[character.id] ?? 0} connectedAllies={connected} allyCharacterIds={partyCharacterIds} />
      <EncounterLoadingOverlay />
      <DungeonLoadingOverlay visible={!!dungeon && !dungeonReady} generating={dungeonGenerating} />
      {storyboardQueue && <StoryboardOverlay queue={storyboardQueue} onDone={() => setStoryboardQueue(null)} skippable={false} />}
      <PartyMemberOverlay characterId={viewingMemberId} campaignId={character.campaignId} onClose={() => setViewingMemberId(null)} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} items={paletteItems} header={<span className="palette-clock">{formatWorldTime(worldTimeSecs)}</span>} />
      <CharacterSheetOverlay
        character={liveCharacter}
        currentHp={playerHpState?.current} maxHp={playerHpState?.max} tempHp={playerHpState?.temp}
        currentSpellSlots1={playerSlotsState?.current} maxSpellSlots1={playerSlotsState?.max}
        sessionActive={sessionActive}
      />
      <JournalOverlay open={journalOpen} onClose={() => setJournalOpen(false)} character={character} sessionActive={sessionActive} dmThinking={dmThinking} />
      <QuestLog open={questLogOpen} onClose={() => setQuestLogOpen(false)} quests={quests} act={act} />
      <CombatLogOverlay open={combatLogOpen} onClose={() => setCombatLogOpen(false)} />
      <DevModal open={devModalOpen} onClose={() => setDevModalOpen(false)} />
      {!journalOpen && <ChatWidget />}
      <QuickChat open={quickChatOpen} onClose={() => setQuickChatOpen(false)} senderName={character.name} sessionActive={sessionActive} disabled={combatActive && !isMyTurn} />
      {victory && <VictoryScreen data={victory} onDismiss={() => setVictory(null)} />}
      {defeated && <DefeatScreen onDismiss={() => setDefeated(false)} />}
      {congrats && (
        <CongratsScreen
          dungeon={congrats.dungeon}
          quests={congrats.quests}
          roster={congrats.roster}
          onFinish={() => { socketRef.current?.disconnect(); window.location.href = `/${character.campaignId}/lobby`; }}
        />
      )}
      <ReactionPrompt
        onRespond={(requestId, spellName) => socketRef.current?.emit('combat:reaction:respond', { requestId, spellName })}
        showDetailsByDefault={houseRules.reactionShowDetailsByDefault}
      />
      <ShortcutsOverlay open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <RestModal character={liveCharacter} />
      <BattleMapBackground worldMapUrl={worldMapUrl} />
      <div className="item-notifications">
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
              <Button variant="outline" color="secondary" onClick={() => setShowLeaveConfirm(false)}>Cancel</Button>
              <Button onClick={() => {
                socketRef.current?.emit('session:end', { campaignId: character.campaignId });
                setTimeout(() => { socketRef.current?.disconnect(); window.location.href = '/'; }, 400);
              }}>
                End Session &amp; Leave
              </Button>
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
        // Every character refetch in GameCanvas lands here unchecked (no r.ok/shape guard at the
        // call site) — an error body (404/500 JSON) would otherwise fully replace a good character
        // with one missing `stats`, crashing every consumer that reads it (CharacterSheetOverlay,
        // the HP-derivation effect, ...). This is the one place all of those updates funnel through.
        if (!c?.stats) { console.error('[character] dropped update with no stats:', c); return; }
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
          <Button variant="ghost" className="btn-create-player-link" navigate={`/${campaignId}/player/create`}>
            New here? Create a character
          </Button>
          <Button onClick={() => void handleJoin()} disabled={!password || loading}>
            {loading ? 'Joining…' : 'Join'}
          </Button>
        </div>
      </div>
    </div>
  );
}
