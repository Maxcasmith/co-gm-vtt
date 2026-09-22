import React, { Fragment, useEffect, useRef, useState } from 'react';
import type { Character, CheckRequest } from 'shared';
import { hasOriginFeat, resourceCurrent } from 'shared';
import type { ChatMessageReceivedPayload } from './events.ts';
import { on, dispatch } from './events.ts';
import { SKILLS } from './character-creation/srd.ts';
import { Button } from './components/Button/Button.tsx';
import SplitBlock from './SplitBlock.tsx';
import { RollTooltip } from './RollBreakdown.tsx';

const SAVE_STAT: Record<string, string> = {
  strength: 'STR', str: 'STR',
  dexterity: 'DEX', dex: 'DEX',
  constitution: 'CON', con: 'CON',
  intelligence: 'INT', int: 'INT',
  wisdom: 'WIS', wis: 'WIS',
  charisma: 'CHA', cha: 'CHA',
};

// Scoped to the message it came with (timestamp), not just player/skill/type — otherwise rolling
// one Investigation check marks every future Investigation-check request for that player as already
// done, since a bare player/skill/type key collides across messages.
function reqKey(timestamp: number, req: CheckRequest) { return `${timestamp}:${req.player}:${req.skill}:${req.type}`; }
function reqStat(req: CheckRequest): string {
  if (req.type === 'check') return SKILLS.find(s => s.name === req.skill)?.stat ?? req.skill.slice(0, 3).toUpperCase();
  return SAVE_STAT[req.skill.toLowerCase()] ?? req.skill.slice(0, 3).toUpperCase();
}

type LogEntry = { msg: ChatMessageReceivedPayload; index: number };
type LogSegment = { kind: 'msg'; entry: LogEntry } | { kind: 'split'; splitId: string; entries: LogEntry[] };

// Untagged messages render one by one; every message from the same split collects into a single
// segment placed where that split's first message fell.
function logSegments(messages: ChatMessageReceivedPayload[]): LogSegment[] {
  const segments: LogSegment[] = [];
  const bySplit = new Map<string, LogEntry[]>();
  messages.forEach((msg, index) => {
    if (!msg.splitId) { segments.push({ kind: 'msg', entry: { msg, index } }); return; }
    const existing = bySplit.get(msg.splitId);
    if (existing) { existing.push({ msg, index }); return; }
    const entries = [{ msg, index }];
    bySplit.set(msg.splitId, entries);
    segments.push({ kind: 'split', splitId: msg.splitId, entries });
  });
  return segments;
}

interface Props {
  open: boolean;
  variant?: 'full' | 'side';
  onClose: () => void;
  character: Character;
  sessionActive: boolean;
  dmThinking: boolean;
  /** Other players in your audience currently typing — never includes you (the server skips the typer). */
  typers: string[];
  /** The live Party Groups split, if any — its block renders expanded. */
  liveSplitId?: string | undefined;
}

function formatSender(name: string): React.ReactNode {
  const match = name.match(/^(.+) \(Virtual DM\)$/);
  if (!match) return name;
  return <>{match[1]} <span className="vdm-tag">(Virtual DM)</span></>;
}

function typingLabel(typers: string[]): string {
  const [first, second] = typers;
  if (typers.length === 1) return `${first} is typing`;
  if (typers.length === 2) return `${first} and ${second} are typing`;
  return `${first} + ${typers.length - 1} more people are typing`;
}

// Heartbeat interval while typing — receivers expire a typer after 4s without one (see GamePage).
const TYPING_HEARTBEAT_MS = 2000;

export default function JournalOverlay({ open, variant = 'full', onClose, character, sessionActive, dmThinking, typers, liveSplitId }: Props) {
  const [input, setInput] = useState('');
  const lastTypingSent = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Messages live above the open-guard so they survive close/reopen
  const [messages, setMessages] = useState<ChatMessageReceivedPayload[]>([]);
  const [rollingKeys, setRollingKeys] = useState<Set<string>>(new Set());
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(new Set());
  // Origin feat Lucky — which pending roll requests are armed to spend a Luck Point for Advantage.
  const [luckKeys, setLuckKeys] = useState<Set<string>>(new Set());
  // Which pending roll requests are armed to spend Heroic Inspiration for Advantage.
  const [inspirationKeys, setInspirationKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    return on('vtt:chat:message-received', msg => {
      setMessages(prev => [...prev, msg]);
    });
  }, []);
  useEffect(() => on('vtt:chat:history', setMessages), []);

  useEffect(() => on('vtt:roll:result', result => {
    setRollingKeys(prev => {
      const next = new Set(prev);
      for (const msg of messages) {
        for (const req of msg.checkRequests ?? []) {
          if (req.player === result.characterName && req.type === result.rollType && reqStat(req) === result.stat) {
            next.delete(reqKey(msg.timestamp, req));
          }
        }
      }
      return next;
    });
    setDoneKeys(prev => {
      const next = new Set(prev);
      for (const msg of messages) {
        for (const req of msg.checkRequests ?? []) {
          if (req.player === result.characterName && req.type === result.rollType && reqStat(req) === result.stat) {
            next.add(reqKey(msg.timestamp, req));
          }
        }
      }
      return next;
    });
  }), [messages]);

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

  function send() {
    const text = input.trim();
    if (!text) return;
    dispatch('vtt:chat:message-sent', { text, senderName: character.name, timestamp: Date.now() });
    changeInput('');
  }

  function changeInput(value: string) {
    setInput(value);
    const now = Date.now();
    if (!value.trim()) {
      if (lastTypingSent.current) dispatch('vtt:chat:typing', { typing: false });
      lastTypingSent.current = 0;
    } else if (now - lastTypingSent.current > TYPING_HEARTBEAT_MS) {
      dispatch('vtt:chat:typing', { typing: true });
      lastTypingSent.current = now;
    }
  }

  function pinMessage(key: string, msg: ChatMessageReceivedPayload) {
    dispatch('vtt:note:add', { text: msg.text, authorName: msg.senderName, pinnedBy: character.name });
    setPinnedKeys(prev => new Set([...prev, key]));
    setTimeout(() => setPinnedKeys(prev => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    }), 2000);
  }

  function rollRequest(timestamp: number, req: CheckRequest) {
    const key = reqKey(timestamp, req);
    setRollingKeys(prev => new Set([...prev, key]));
    const stat = reqStat(req).toLowerCase();
    const useLuckPoint = luckKeys.has(key);
    const useInspiration = inspirationKeys.has(key);
    const base = { characterId: character.id, campaignId: character.campaignId, stat, ...(useLuckPoint ? { useLuckPoint } : {}), ...(useInspiration ? { useInspiration } : {}) };
    if (req.type === 'check') dispatch('vtt:roll:check', { ...base, skill: req.skill });
    else dispatch('vtt:roll:save', base);
  }

  function renderMessage(msg: ChatMessageReceivedPayload, i: number) {
    const myRequests = (msg.checkRequests ?? []).filter(r => r.player === character.name);
    return (
      <div className={`journal-msg${msg.variant === 'recap' ? ' journal-msg--recap' : msg.senderName === 'System' ? ' journal-msg--system' : ''}`}>
        <div className="journal-msg-header">
          <span className="journal-msg-sender">{formatSender(msg.senderName)}</span>
          <span className="journal-msg-time">
            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <Button
            variant="ghost"
            className="journal-roll-btn journal-pin-btn"
            onClick={() => pinMessage(`${msg.timestamp}:${i}`, msg)}
            disabled={pinnedKeys.has(`${msg.timestamp}:${i}`)}
          >
            {pinnedKeys.has(`${msg.timestamp}:${i}`) ? 'Pinned' : 'Pin'}
          </Button>
        </div>
        <div className="journal-msg-text">
          {msg.breakdown ? <RollTooltip breakdown={msg.breakdown}>{msg.text}</RollTooltip> : msg.text}
        </div>
        {myRequests.length > 0 && (
          <div className="journal-roll-requests">
            {myRequests.map(req => {
              const key = reqKey(msg.timestamp, req);
              if (doneKeys.has(key)) return null;
              const rolling = rollingKeys.has(key);
              const luckPoints = hasOriginFeat(character, 'Lucky') ? resourceCurrent(character, 'luckPoints') : 0;
              const luckArmed = luckKeys.has(key);
              return (
                <span key={key} className="journal-roll-request">
                  <Button
                    variant="ghost"
                    className="journal-roll-btn"
                    disabled={rolling}
                    onClick={() => rollRequest(msg.timestamp, req)}
                  >
                    {rolling ? 'Rolling…' : `Roll ${req.skill} ${req.type === 'save' ? 'Save' : 'Check'}`}
                  </Button>
                  {luckPoints > 0 && !rolling && (
                    <Button
                      variant="ghost"
                      className={`journal-luck-toggle${luckArmed ? ' journal-luck-toggle--active' : ''}`}
                      title="Spend a Luck Point on this roll for Advantage"
                      onClick={() => setLuckKeys(prev => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      })}
                    >
                      Luck ({luckPoints})
                    </Button>
                  )}
                  {character.heroicInspiration && !rolling && (
                    <Button
                      variant="ghost"
                      className={`journal-luck-toggle${inspirationKeys.has(key) ? ' journal-luck-toggle--active' : ''}`}
                      title="Spend Heroic Inspiration on this roll for Advantage"
                      onClick={() => setInspirationKeys(prev => {
                        const next = new Set(prev);
                        if (next.has(key)) next.delete(key); else next.add(key);
                        return next;
                      })}
                    >
                      Inspiration
                    </Button>
                  )}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (variant === 'full' && !open) return null;

  return (
    <div className={variant === 'side' ? `journal-dock${open ? ' journal-dock--open' : ''}` : 'journal-scrim'} aria-hidden={variant === 'side' ? !open : undefined}>
      <div className="journal-panel">
        <div className="journal-header">
          <h2 className="journal-title">Adventure Log</h2>
          <Button variant="outline" color="secondary" className="sheet-close" onClick={onClose} aria-label="Close">×</Button>
        </div>

        <div className="journal-messages" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="journal-empty">
              <p className="journal-empty-text">The pages are blank.</p>
              <p className="journal-empty-hint">Roll a die or say something to begin the record.</p>
            </div>
          ) : (
            logSegments(messages).map(seg => seg.kind === 'split'
              ? <SplitBlock key={`split:${seg.splitId}`} entries={seg.entries} live={seg.splitId === liveSplitId} renderMessage={renderMessage} />
              : <Fragment key={seg.entry.index}>{renderMessage(seg.entry.msg, seg.entry.index)}</Fragment>)
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

        {typers.length > 0 && (
          <div className="journal-msg journal-thinking">
            <div className="journal-msg-header">
              <span className="journal-msg-sender">{typingLabel(typers)}</span>
            </div>
            <div className="journal-msg-text">
              <span className="journal-thinking-dots"><span>.</span><span>.</span><span>.</span></span>
            </div>
          </div>
        )}

        <div className="journal-input-row">
          <input
            ref={inputRef}
            className="journal-input"
            value={input}
            onChange={e => changeInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder={sessionActive ? 'Say something…' : 'Session hasn\'t started yet'}
            disabled={!sessionActive}
          />
          <Button onClick={send} disabled={!sessionActive || !input.trim()}>Send</Button>
        </div>
      </div>
    </div>
  );
}
