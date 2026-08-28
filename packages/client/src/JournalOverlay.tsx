import React, { useEffect, useRef, useState } from 'react';
import type { Character, CheckRequest } from 'shared';
import { hasOriginFeat, resourceCurrent } from 'shared';
import type { ChatMessageReceivedPayload } from './events.ts';
import { on, dispatch } from './events.ts';
import { SKILLS } from './character-creation/srd.ts';

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

interface Props {
  open: boolean;
  onClose: () => void;
  character: Character;
  sessionActive: boolean;
  dmThinking: boolean;
}

function formatSender(name: string): React.ReactNode {
  const match = name.match(/^(.+) \(Virtual DM\)$/);
  if (!match) return name;
  return <>{match[1]} <span className="vdm-tag">(Virtual DM)</span></>;
}

export default function JournalOverlay({ open, onClose, character, sessionActive, dmThinking }: Props) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Messages live above the open-guard so they survive close/reopen
  const [messages, setMessages] = useState<ChatMessageReceivedPayload[]>([]);
  const [rollingKeys, setRollingKeys] = useState<Set<string>>(new Set());
  const [doneKeys, setDoneKeys] = useState<Set<string>>(new Set());
  // Origin feat Lucky — which pending roll requests are armed to spend a Luck Point for Advantage.
  const [luckKeys, setLuckKeys] = useState<Set<string>>(new Set());
  // Which pending roll requests are armed to spend Heroic Inspiration for Advantage.
  const [inspirationKeys, setInspirationKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    return on('vtt:chat:message-received', msg => {
      setMessages(prev => [...prev, msg]);
    });
  }, []);

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
    setInput('');
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

  return (
    <div className={`journal-dock${open ? ' journal-dock--open' : ''}`} aria-hidden={!open}>
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
            messages.map((msg, i) => {
              const myRequests = (msg.checkRequests ?? []).filter(r => r.player === character.name);
              return (
                <div key={i} className={`journal-msg${msg.variant === 'recap' ? ' journal-msg--recap' : msg.senderName === 'System' ? ' journal-msg--system' : ''}`}>
                  <div className="journal-msg-header">
                    <span className="journal-msg-sender">{formatSender(msg.senderName)}</span>
                    <span className="journal-msg-time">
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div className="journal-msg-text">{msg.text}</div>
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
                            <button
                              className="journal-roll-btn"
                              disabled={rolling}
                              onClick={() => rollRequest(msg.timestamp, req)}
                            >
                              {rolling ? 'Rolling…' : `Roll ${req.skill} ${req.type === 'save' ? 'Save' : 'Check'}`}
                            </button>
                            {luckPoints > 0 && !rolling && (
                              <button
                                className={`journal-luck-toggle${luckArmed ? ' journal-luck-toggle--active' : ''}`}
                                title="Spend a Luck Point on this roll for Advantage"
                                onClick={() => setLuckKeys(prev => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key); else next.add(key);
                                  return next;
                                })}
                              >
                                Luck ({luckPoints})
                              </button>
                            )}
                            {character.heroicInspiration && !rolling && (
                              <button
                                className={`journal-luck-toggle${inspirationKeys.has(key) ? ' journal-luck-toggle--active' : ''}`}
                                title="Spend Heroic Inspiration on this roll for Advantage"
                                onClick={() => setInspirationKeys(prev => {
                                  const next = new Set(prev);
                                  if (next.has(key)) next.delete(key); else next.add(key);
                                  return next;
                                })}
                              >
                                Inspiration
                              </button>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
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
            ref={inputRef}
            className="journal-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send(); }}
            placeholder={sessionActive ? 'Say something…' : 'Session hasn\'t started yet'}
            disabled={!sessionActive}
          />
          <button className="btn-primary" onClick={send} disabled={!sessionActive || !input.trim()}>Send</button>
        </div>
      </div>
    </div>
  );
}
