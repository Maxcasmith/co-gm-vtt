import { useRef, useState, useCallback } from 'react';
import { Button } from '../components/Button/Button.tsx';
import { useCharacter, type ConceptSuggestions } from './CharacterContext.tsx';
import ImageCropModal from './ImageCropModal.tsx';
import InfoTooltip from '../create-campaign/InfoTooltip.tsx';

const API = `http://${window.location.hostname}:3001`;

export default function ProfileTab({ campaignId }: { campaignId: string }) {
  const c = useCharacter();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [tokenVersion, setTokenVersion] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState('');

  async function suggestConcept() {
    setSuggesting(true);
    setSuggestError('');
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/party/concept-suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept: c.aiConcept }),
      });
      const data = await r.json() as ConceptSuggestions & { error?: string };
      if (data.error) throw new Error(data.error);
      c.set('aiConceptSuggestions', data);
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : 'Concept suggestion failed');
    } finally {
      setSuggesting(false);
    }
  }

  const uploadCroppedImage = useCallback(async (base64image: string) => {
    setCropFile(null);
    setUploading(true);
    setUploadError('');
    c.set('portraitBase64', base64image);
    try {
      const r = await fetch(`${API}/api/campaigns/${campaignId}/party/portrait`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ charId: c.id, base64image }),
      });
      const data = await r.json() as { portraitPath?: string; tokenPath?: string; error?: string };
      if (data.error) throw new Error(data.error);
      c.set('portraitPath', data.portraitPath ?? '');
      c.set('tokenPath', data.tokenPath ?? '');
      setTokenVersion(v => v + 1);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [campaignId, c]);

  return (
    <>
      {/* ── portrait + name (top) ── */}
      <div className="portrait-name-row">
        <div
          className={`inline-portrait-drop inline-portrait-drop--compact ${uploading ? 'inline-portrait-drop--loading' : ''}`}
          onClick={() => !uploading && fileInputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f && !uploading) setCropFile(f); }}
        >
          {c.portraitBase64
            ? <img src={`data:image/jpeg;base64,${c.portraitBase64}`} className="inline-portrait-preview" alt="Portrait" />
            : <span className="portrait-upload-hint">{uploading ? 'Processing…' : '+ Photo'}</span>
          }
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="portrait-file-input"
            onChange={e => { const f = e.target.files?.[0]; if (f) setCropFile(f); e.target.value = ''; }}
          />
        </div>

        <div className="inline-token-box">
          {c.tokenPath
            ? <img src={`${API}/api/campaigns/${campaignId}/party/${c.id}/token?v=${tokenVersion}`} className="inline-token-img" alt="Token" />
            : <span className="portrait-upload-hint">Token</span>
          }
        </div>
      </div>

      <div className="portrait-name-fields">
        {uploadError && <p className="modal-error">{uploadError}</p>}
        <label className="modal-label">
          <span className="create-label-row">
            Character Name
            <InfoTooltip text="What your character is called in the campaign." />
          </span>
          <input className="modal-input" value={c.name} onChange={e => c.set('name', e.target.value)} placeholder="Enter character name…" />
        </label>
        <label className="modal-label">
          <span className="create-label-row">
            Join Password
            <InfoTooltip text="Required to join the game as this character. Save it, you can't recover it later." />
          </span>
          <input className="modal-input" type="password" value={c.password} onChange={e => c.set('password', e.target.value)} placeholder="Choose a password to join as this character" />
        </label>
      </div>

      <section className="spells-section">
        <div className="spells-section-header">
          <h3 className="spells-section-title">Not Sure Where to Start?</h3>
        </div>
        <p className="origin-feat-desc">Tell us all about your character, we'll help you build them.</p>
        <textarea
          className="modal-textarea"
          value={c.aiConcept}
          onChange={e => c.set('aiConcept', e.target.value)}
          placeholder="e.g. A grizzled ex-soldier who lost their squad and now just wants to protect people who can't protect themselves…"
          rows={5}
        />
        <div className="finished-create-row">
          <Button variant="outline" color="secondary" onClick={suggestConcept} disabled={suggesting || !c.aiConcept.trim()}>
            {suggesting ? 'Thinking…' : 'Suggest a Build'}
          </Button>
        </div>
        {suggestError && <p className="modal-error">{suggestError}</p>}

        {c.aiConceptSuggestions && (
          <div className="concept-suggestions">
            <p className="origin-feat-desc">{c.aiConceptSuggestions.summary}</p>
            {c.aiConceptSuggestions.options.map((opt, i) => (
              <div key={i} className="concept-option">
                <p className="concept-option-title">{opt.class} — {opt.subspecies ? `${opt.species} (${opt.subspecies})` : opt.species}</p>
                <p className="concept-option-reason">{opt.reason}</p>
                {opt.skills.length > 0 && (
                  <p className="concept-option-line"><strong>Skills:</strong> {opt.skills.join(', ')}</p>
                )}
                {opt.spells.length > 0 && (
                  <p className="concept-option-line"><strong>Spells:</strong> {opt.spells.join(', ')}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <ImageCropModal
        file={cropFile}
        onCancel={() => setCropFile(null)}
        onConfirm={base64 => void uploadCroppedImage(base64)}
      />
    </>
  );
}
