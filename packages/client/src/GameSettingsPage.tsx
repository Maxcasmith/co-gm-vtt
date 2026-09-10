import { useEffect, useState } from 'react';
import type { HouseRules } from 'shared';
import { DEFAULT_HOUSE_RULES } from 'shared';
import { Button } from './components/Button/Button.tsx';
import './app.css';

interface Props { campaignId: string }

const API = `http://${window.location.hostname}:3001`;

export default function GameSettingsPage({ campaignId }: Props) {
  const [rules, setRules] = useState<HouseRules>(DEFAULT_HOUSE_RULES);
  const [gamePassword, setGamePassword] = useState('');

  useEffect(() => {
    fetch(`${API}/api/campaigns/${campaignId}`)
      .then(r => r.json())
      .then((c: { houseRules?: HouseRules }) => setRules({ ...DEFAULT_HOUSE_RULES, ...c.houseRules }))
      .catch(() => {});
    fetch(`${API}/api/campaigns/${campaignId}/game-password`)
      .then(r => r.json())
      .then((d: { gamePassword?: string }) => setGamePassword(d.gamePassword ?? ''))
      .catch(() => {});
  }, [campaignId]);

  async function handleApply() {
    // Sequential, not Promise.all — both PUTs read-modify-write the same world.json file;
    // firing them concurrently interleaves the two writes and corrupts it.
    await fetch(`${API}/api/campaigns/${campaignId}/house-rules`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rules),
    });
    await fetch(`${API}/api/campaigns/${campaignId}/game-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gamePassword }),
    });
    window.location.href = `/${campaignId}/lobby`;
  }

  return (
    <div className="home">
      <div className="home-atmosphere" aria-hidden="true" />
      <div className="game-settings-page">
        <div className="settings-sidebar-header">
          <Button variant="outline" color="secondary" navigate={`/${campaignId}/lobby`}>&larr; Back</Button>
          <h2 className="settings-title">Game Settings</h2>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Game Password</h3>
            <label className="modal-label">
              Password
              <input
                className="modal-input"
                type="text"
                value={gamePassword}
                onChange={e => setGamePassword(e.target.value)}
                placeholder="No password — anyone can join"
              />
            </label>
          </section>
          <section className="settings-section">
            <h3 className="settings-section-title">House Rules</h3>
            <div className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">Perkins Crit</span>
                <span className="settings-toggle-desc">
                  {rules.perkinsCrit
                    ? "On a critical hit, the extra damage is the die's max value instead of a second roll."
                    : 'Off — a critical hit rolls the damage dice a second time, as normal.'}
                </span>
              </div>
              <Button
                variant="ghost"
                className={`settings-toggle ${rules.perkinsCrit ? 'settings-toggle--on' : ''}`}
                onClick={() => setRules(r => ({ ...r, perkinsCrit: !r.perkinsCrit }))}
                aria-pressed={rules.perkinsCrit}
              >
                <span className="settings-toggle-thumb" />
              </Button>
            </div>
            <div className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">No Attacks of Opportunity</span>
                <span className="settings-toggle-desc">
                  {rules.noAttacksOfOpportunity
                    ? 'Leaving a hostile creature’s reach never provokes an attack.'
                    : 'Off — leaving a hostile creature’s reach provokes an Opportunity Attack, as normal.'}
                </span>
              </div>
              <Button
                variant="ghost"
                className={`settings-toggle ${rules.noAttacksOfOpportunity ? 'settings-toggle--on' : ''}`}
                onClick={() => setRules(r => ({ ...r, noAttacksOfOpportunity: !r.noAttacksOfOpportunity }))}
                aria-pressed={rules.noAttacksOfOpportunity}
              >
                <span className="settings-toggle-thumb" />
              </Button>
            </div>
            <div className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">Level Up HP</span>
                <span className="settings-toggle-desc">
                  How hit points are determined when a character levels up.
                </span>
              </div>
              <select
                className="settings-select"
                value={rules.levelUpHp}
                onChange={e =>
                  setRules(r => ({ ...r, levelUpHp: e.target.value as HouseRules['levelUpHp'] }))
                }
              >
                <option value="roll">Roll</option>
                <option value="average">Take Average</option>
                <option value="max">Take Maximum</option>
                <option value="min">Take Minimum</option>
              </select>
            </div>
          </section>
          <section className="settings-section">
            <h3 className="settings-section-title">Reaction Sidebar</h3>
            <div className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">Reaction Window</span>
                <span className="settings-toggle-desc">
                  How long (seconds) a reaction offer stays open before auto-declining.
                </span>
              </div>
              <input
                className="modal-input settings-number-input"
                type="number"
                min={1}
                max={120}
                value={rules.reactionTimeoutSecs}
                onChange={e => setRules(r => ({ ...r, reactionTimeoutSecs: Math.max(1, Number(e.target.value) || 1) }))}
              />
            </div>
            <div className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">Show Condition Details</span>
                <span className="settings-toggle-desc">
                  Shows each reaction's roll/AC math (e.g. what an enemy rolled) by default, instead of just the prompt.
                </span>
              </div>
              <Button
                variant="ghost"
                className={`settings-toggle ${rules.reactionShowDetailsByDefault ? 'settings-toggle--on' : ''}`}
                onClick={() => setRules(r => ({ ...r, reactionShowDetailsByDefault: !r.reactionShowDetailsByDefault }))}
                aria-pressed={rules.reactionShowDetailsByDefault}
              >
                <span className="settings-toggle-thumb" />
              </Button>
            </div>
          </section>
        </div>

        <div className="settings-footer">
          <Button variant="outline" color="secondary" navigate={`/${campaignId}/lobby`}>Cancel</Button>
          <Button onClick={() => void handleApply()}>Apply</Button>
        </div>
      </div>
    </div>
  );
}
