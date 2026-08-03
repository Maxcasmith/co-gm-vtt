import { useState } from 'react';
import { useCharacter } from './CharacterContext.tsx';
import CharacterSheet from './CharacterSheet.tsx';

const API = `http://${window.location.hostname}:3001`;

interface CheckResult { score: number; verdict: string; issues: string[]; suggestions: string[] }

export default function BackstoryTab({ campaignId }: { campaignId: string }) {
  const c = useCharacter();
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [result, setResult] = useState<CheckResult | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');

  async function checkConcept() {
    setChecking(true);
    setCheckError('');
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/party/backstory-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: c.name,
          species: c.species,
          background: c.background,
          characterClass: c.characterClass,
          backstory: c.backstory,
        }),
      });
      const data = await r.json() as CheckResult & { error?: string };
      if (data.error) throw new Error(data.error);
      setResult(data);
    } catch (err) {
      setCheckError(err instanceof Error ? err.message : 'Concept check failed');
    } finally {
      setChecking(false);
    }
  }

  async function generateBackstory() {
    setGenerating(true);
    setGenerateError('');
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/party/backstory-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: c.name,
          species: c.species,
          background: c.background,
          characterClass: c.characterClass,
        }),
      });
      const data = await r.json() as { backstory?: string; error?: string };
      if (data.error) throw new Error(data.error);
      c.set('backstory', data.backstory ?? '');
      setResult(null);
    } catch (err) {
      setGenerateError(err instanceof Error ? err.message : 'Backstory generation failed');
    } finally {
      setGenerating(false);
    }
  }

  const scoreClass = result == null ? '' : result.score >= 70 ? 'lore-score--good' : result.score >= 40 ? 'lore-score--mixed' : 'lore-score--poor';

  return (
    <div className="player-info-layout">
      <div className="tab-content">
        <section className="spells-section">
          <div className="spells-section-header">
            <h3 className="spells-section-title">Backstory</h3>
          </div>
          <textarea
            className="modal-textarea"
            value={c.backstory}
            onChange={e => c.set('backstory', e.target.value)}
            placeholder="Where did your character come from? What do they want?"
            rows={10}
          />
          <div className="finished-create-row">
            <button className="btn-secondary" onClick={generateBackstory} disabled={generating}>
              {generating ? 'Generating…' : 'Generate Backstory From World'}
            </button>
            <button className="btn-secondary" onClick={checkConcept} disabled={checking || !c.backstory.trim()}>
              {checking ? 'Checking…' : 'Check Concept Against World Lore'}
            </button>
          </div>
          {generateError && <p className="modal-error">{generateError}</p>}
          {checkError && <p className="modal-error">{checkError}</p>}
        </section>

        {result && (
          <section className="spells-section">
            <div className="spells-section-header">
              <h3 className="spells-section-title">Lore Fit</h3>
              <span className={`lore-score ${scoreClass}`}>{result.score}/100</span>
            </div>
            <p className="origin-feat-desc">{result.verdict}</p>
            {result.issues.length > 0 && (
              <div>
                <span className="spells-section-title">Issues</span>
                <ul className="lore-list">
                  {result.issues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              </div>
            )}
            {result.suggestions.length > 0 && (
              <div>
                <span className="spells-section-title">Suggestions</span>
                <ul className="lore-list">
                  {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
          </section>
        )}
      </div>
      <CharacterSheet />
    </div>
  );
}
