import { useEffect, useRef, useState } from 'react';
import type { AppConfig, StoryProvider, ImageModel, CombatConfig, NarrationModel } from 'shared';
import { previewVoice } from './narration.ts';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STORY_PROVIDERS: { id: StoryProvider; label: string; models: { id: string; label: string }[] }[] = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    models: [
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: [
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o Mini' },
    ],
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    models: [
      { id: 'deepseek-chat', label: 'DeepSeek Chat' },
      { id: 'deepseek-reasoner', label: 'DeepSeek Reasoner' },
    ],
  },
];

const IMAGE_MODELS: { id: ImageModel; label: string }[] = [
  { id: 'gpt-image-1', label: 'GPT Image 1' },
  { id: 'dall-e-3',    label: 'DALL·E 3' },
  { id: 'dall-e-2',    label: 'DALL·E 2' },
];

const COMBAT_MODELS: { id: CombatConfig['model']; label: string }[] = [
  { id: 'gpt-4o-mini',  label: 'GPT-4o Mini (Recommended)' },
  { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
  { id: 'gpt-4o',       label: 'GPT-4o' },
];

const NARRATION_MODELS: { id: NarrationModel; label: string }[] = [
  { id: 'none',     label: 'None' },
  { id: 'browser',  label: 'Browser Speech Synthesis (Free)' },
  { id: 'tts-1',    label: 'OpenAI TTS — Standard (tts-1)' },
  { id: 'tts-1-hd', label: 'OpenAI TTS — HD (tts-1-hd)' },
];

const OPENAI_VOICES = [
  { id: 'alloy',   label: 'Alloy'   },
  { id: 'ash',     label: 'Ash'     },
  { id: 'coral',   label: 'Coral'   },
  { id: 'echo',    label: 'Echo'    },
  { id: 'fable',   label: 'Fable'   },
  { id: 'nova',    label: 'Nova'    },
  { id: 'onyx',    label: 'Onyx'    },
  { id: 'sage',    label: 'Sage'    },
  { id: 'shimmer', label: 'Shimmer' },
];

const DEFAULT_CONFIG: AppConfig = {
  story:     { provider: 'claude', model: 'claude-sonnet-4-6', apiKey: '' },
  image:     { model: 'gpt-image-1', apiKey: '' },
  combat:    { model: 'gpt-4o-mini', apiKey: '' },
  narration: { model: 'none', voice: 'onyx', apiKey: '' },
};

const API = `http://${window.location.hostname}:3001`;

export default function SettingsSidebar({ open, onClose }: Props) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState<AppConfig>(DEFAULT_CONFIG);
  const [storyStatus, setStoryStatus]       = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [imageStatus, setImageStatus]       = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [combatStatus, setCombatStatus]     = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [narrationPreviewing, setNarrationPreviewing] = useState(false);
  const discardRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/config`)
      .then(r => r.json())
      .then((c: AppConfig) => { setConfig(c); setSaved(c); })
      .catch(() => {});
  }, [open]);

  const isDirty = JSON.stringify(config) !== JSON.stringify(saved);

  function handleCancel() {
    if (isDirty) { discardRef.current?.showModal(); return; }
    onClose();
  }

  function handleDiscard() {
    discardRef.current?.close();
    setConfig(saved);
    onClose();
  }

  async function handleApply() {
    await fetch(`${API}/api/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    setSaved(config);
    onClose();
  }

  async function testConnection(type: 'story' | 'image' | 'combat') {
    const set = type === 'story' ? setStoryStatus : type === 'image' ? setImageStatus : setCombatStatus;
    set('testing');
    try {
      const r = await fetch(`${API}/api/config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type }),
      });
      const { ok } = await r.json() as { ok: boolean };
      set(ok ? 'ok' : 'fail');
    } catch {
      set('fail');
    }
  }

  const isOpenAIVoice = config.narration.model === 'tts-1' || config.narration.model === 'tts-1-hd';

  async function handleNarrationPreview() {
    if (!isOpenAIVoice || narrationPreviewing) return;
    setNarrationPreviewing(true);
    await previewVoice(
      config.narration.model as 'tts-1' | 'tts-1-hd',
      config.narration.voice,
      config.narration.apiKey,
    );
    setNarrationPreviewing(false);
  }

  const storyProvider = STORY_PROVIDERS.find(p => p.id === config.story.provider) ?? STORY_PROVIDERS[0]!;

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={handleCancel} />}
      <aside className={`settings-sidebar ${open ? 'settings-sidebar--open' : ''}`}>
        <div className="settings-sidebar-header">
          <h2 className="settings-title">Settings</h2>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">Story Generation</h3>
            <label className="modal-label">
              Provider
              <select
                className="modal-select"
                value={config.story.provider}
                onChange={e => setConfig(c => ({
                  ...c,
                  story: {
                    ...c.story,
                    provider: e.target.value as StoryProvider,
                    model: STORY_PROVIDERS.find(p => p.id === e.target.value)?.models[0]?.id ?? '',
                  },
                }))}
              >
                {STORY_PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="modal-label">
              Model
              <select
                className="modal-select"
                value={config.story.model}
                onChange={e => setConfig(c => ({ ...c, story: { ...c.story, model: e.target.value } }))}
              >
                {storyProvider.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="modal-label">
              API Key
              <input
                className="modal-input"
                type="password"
                value={config.story.apiKey}
                onChange={e => setConfig(c => ({ ...c, story: { ...c.story, apiKey: e.target.value } }))}
                placeholder="sk-..."
              />
            </label>
            <div className="settings-test-row">
              <button className="btn-test" onClick={() => testConnection('story')} disabled={storyStatus === 'testing'}>
                {storyStatus === 'testing' ? 'Testing…' : 'Test Connection'}
              </button>
              {storyStatus !== 'idle' && storyStatus !== 'testing' && (
                <span className={`status-badge status-badge--${storyStatus}`}>
                  {storyStatus === 'ok' ? '● Connected' : '● Failed'}
                </span>
              )}
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3 className="settings-section-title">Image Generation</h3>
            <label className="modal-label">
              Model
              <select
                className="modal-select"
                value={config.image.model}
                onChange={e => setConfig(c => ({ ...c, image: { ...c.image, model: e.target.value as ImageModel } }))}
              >
                {IMAGE_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="modal-label">
              OpenAI API Key
              <input
                className="modal-input"
                type="password"
                value={config.image.apiKey}
                onChange={e => setConfig(c => ({ ...c, image: { ...c.image, apiKey: e.target.value } }))}
                placeholder="sk-..."
              />
            </label>
            <div className="settings-test-row">
              <button className="btn-test" onClick={() => testConnection('image')} disabled={imageStatus === 'testing'}>
                {imageStatus === 'testing' ? 'Testing…' : 'Test Connection'}
              </button>
              {imageStatus !== 'idle' && imageStatus !== 'testing' && (
                <span className={`status-badge status-badge--${imageStatus}`}>
                  {imageStatus === 'ok' ? '● Connected' : '● Failed'}
                </span>
              )}
            </div>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3 className="settings-section-title">Combat AI</h3>
            <p className="settings-section-note">We recommend a lower-cost model here — encounter generation is a simple structured task that doesn't need frontier reasoning.</p>
            <label className="modal-label">
              Model
              <select
                className="modal-select"
                value={config.combat.model}
                onChange={e => setConfig(c => ({ ...c, combat: { ...c.combat, model: e.target.value } }))}
              >
                {COMBAT_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="modal-label">
              OpenAI API Key
              <input
                className="modal-input"
                type="password"
                value={config.combat.apiKey}
                onChange={e => setConfig(c => ({ ...c, combat: { ...c.combat, apiKey: e.target.value } }))}
                placeholder="sk-…"
              />
            </label>
            <div className="settings-test-row">
              <button className="btn-test" onClick={() => testConnection('combat')} disabled={combatStatus === 'testing'}>
                {combatStatus === 'testing' ? 'Testing…' : 'Test Connection'}
              </button>
              {combatStatus !== 'idle' && combatStatus !== 'testing' && (
                <span className={`status-badge status-badge--${combatStatus}`}>
                  {combatStatus === 'ok' ? '● Connected' : '● Failed'}
                </span>
              )}
            </div>
          </section>
          <div className="settings-divider" />

          <section className="settings-section">
            <h3 className="settings-section-title">Narration</h3>
            <label className="modal-label">
              Voice Provider
              <select
                className="modal-select"
                value={config.narration.model}
                onChange={e => setConfig(c => ({ ...c, narration: { ...c.narration, model: e.target.value as NarrationModel } }))}
              >
                {NARRATION_MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            {isOpenAIVoice && (
              <>
                <label className="modal-label">
                  Voice
                  <div className="settings-voice-row">
                    <select
                      className="modal-select"
                      value={config.narration.voice}
                      onChange={e => setConfig(c => ({ ...c, narration: { ...c.narration, voice: e.target.value } }))}
                    >
                      {OPENAI_VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                    <button
                      className="btn-test"
                      onClick={() => void handleNarrationPreview()}
                      disabled={narrationPreviewing || !config.narration.apiKey}
                    >
                      {narrationPreviewing ? '▶ Playing…' : '▶ Preview'}
                    </button>
                  </div>
                </label>
                <label className="modal-label">
                  OpenAI API Key
                  <input
                    className="modal-input"
                    type="password"
                    value={config.narration.apiKey}
                    onChange={e => setConfig(c => ({ ...c, narration: { ...c.narration, apiKey: e.target.value } }))}
                    placeholder="sk-…"
                  />
                </label>
              </>
            )}
          </section>
        </div>

        <div className="settings-footer">
          <button className="btn-secondary" onClick={handleCancel}>Cancel</button>
          <button className="btn-primary" onClick={handleApply}>Apply</button>
        </div>
      </aside>

      <dialog ref={discardRef} className="modal">
        <h2 className="modal-title">Discard changes?</h2>
        <p className="modal-body-text">You have unsaved changes. Discard them?</p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => discardRef.current?.close()}>Keep editing</button>
          <button className="btn-primary" onClick={handleDiscard}>Discard</button>
        </div>
      </dialog>
    </>
  );
}
