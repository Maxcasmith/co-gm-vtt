import { useEffect, useRef, useState } from 'react';
import type { AppConfig, StoryProvider, ImageModel } from 'shared';

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
  { id: 'dall-e-3', label: 'DALL·E 3' },
  { id: 'dall-e-2', label: 'DALL·E 2' },
];

const DEFAULT_CONFIG: AppConfig = {
  story: { provider: 'claude', model: 'claude-sonnet-4-6', apiKey: '' },
  image: { model: 'dall-e-3', apiKey: '' },
};

const API = `http://${window.location.hostname}:3001`;

export default function SettingsSidebar({ open, onClose }: Props) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState<AppConfig>(DEFAULT_CONFIG);
  const [storyStatus, setStoryStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [imageStatus, setImageStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
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

  async function testConnection(type: 'story' | 'image') {
    const set = type === 'story' ? setStoryStatus : setImageStatus;
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
