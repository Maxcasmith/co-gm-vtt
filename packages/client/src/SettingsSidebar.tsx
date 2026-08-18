import { useEffect, useRef, useState } from 'react';
import type { AppConfig, StoryProvider, ImageModel, NarrationModel } from 'shared';
import { previewVoice } from './narration.ts';
import ConfigureAiWorkflowsModal from './ConfigureAiWorkflowsModal.tsx';

interface Props {
  open: boolean;
  onClose: () => void;
}

export const STORY_PROVIDERS: { id: StoryProvider; label: string; models: { id: string; label: string; supportsEffort?: boolean }[] }[] = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    models: [
      { id: 'claude-fable-5', label: 'Claude Fable 5' },
      { id: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI (GPT)',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5', supportsEffort: true },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', supportsEffort: true },
      { id: 'gpt-5.4', label: 'GPT-5.4', supportsEffort: true },
      { id: 'gpt-4.1', label: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', label: 'GPT-4.1 Nano' },
      { id: 'o4-mini', label: 'o4 Mini (Reasoning)', supportsEffort: true },
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
      { id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash' },
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro' },
    ],
  },
  {
    id: 'kimi',
    label: 'Kimi (Moonshot AI)',
    models: [
      { id: 'kimi-k3', label: 'Kimi K3', supportsEffort: true },
    ],
  },
];

const IMAGE_MODELS: { id: ImageModel; label: string }[] = [
  { id: 'gpt-image-1', label: 'GPT Image 1' },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
  { id: 'gpt-image-2', label: 'GPT Image 2' },
  { id: 'dall-e-3', label: 'DALL·E 3' },
  { id: 'dall-e-2', label: 'DALL·E 2' },
];


const NARRATION_MODELS: { id: NarrationModel; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'browser', label: 'Browser Speech Synthesis (Free)' },
  { id: 'tts-1', label: 'OpenAI TTS — Standard (tts-1)' },
  { id: 'tts-1-hd', label: 'OpenAI TTS — HD (tts-1-hd)' },
];

const OPENAI_VOICES = [
  { id: 'alloy', label: 'Alloy' },
  { id: 'ash', label: 'Ash' },
  { id: 'coral', label: 'Coral' },
  { id: 'echo', label: 'Echo' },
  { id: 'fable', label: 'Fable' },
  { id: 'nova', label: 'Nova' },
  { id: 'onyx', label: 'Onyx' },
  { id: 'sage', label: 'Sage' },
  { id: 'shimmer', label: 'Shimmer' },
];

const DEFAULT_CONFIG: AppConfig = {
  workflows: [],
  apiKeys: { openai: '', anthropic: '', deepseek: '', kimi: '' },
  image: { model: 'gpt-image-1', generateWorldMap: false, generateTilesets: false },
  narration: { model: 'none', voice: 'onyx' },
};

const API = `http://${window.location.hostname}:3001`;

export default function SettingsSidebar({ open, onClose }: Props) {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState<AppConfig>(DEFAULT_CONFIG);
  const [imageStatus, setImageStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [narrationPreviewing, setNarrationPreviewing] = useState(false);
  const [workflowsModalOpen, setWorkflowsModalOpen] = useState(false);
  const discardRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    fetch(`${API}/api/config`)
      .then(r => r.json())
      .then((c: AppConfig) => { setConfig(c); setSaved(c); })
      .catch(() => { });
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

  async function testImageConnection() {
    setImageStatus('testing');
    try {
      const r = await fetch(`${API}/api/config/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'image' }),
      });
      const { ok } = await r.json() as { ok: boolean };
      setImageStatus(ok ? 'ok' : 'fail');
    } catch {
      setImageStatus('fail');
    }
  }

  const isOpenAIVoice = config.narration.model === 'tts-1' || config.narration.model === 'tts-1-hd';

  async function handleNarrationPreview() {
    if (!isOpenAIVoice || narrationPreviewing) return;
    setNarrationPreviewing(true);
    await previewVoice(
      config.narration.model as 'tts-1' | 'tts-1-hd',
      config.narration.voice,
      config.apiKeys.openai,
    );
    setNarrationPreviewing(false);
  }

  return (
    <>
      {open && <div className="sidebar-backdrop" onClick={handleCancel} />}
      <aside className={`settings-sidebar ${open ? 'settings-sidebar--open' : ''}`}>
        <div className="settings-sidebar-header">
          <h2 className="settings-title">Settings</h2>
        </div>

        <div className="settings-body">
          <section className="settings-section">
            <h3 className="settings-section-title">API Keys</h3>
            <label className="modal-label">
              ChatGPT (OpenAI)
              <input
                className="modal-input"
                type="password"
                value={config.apiKeys.openai}
                onChange={e => setConfig(c => ({ ...c, apiKeys: { ...c.apiKeys, openai: e.target.value } }))}
                placeholder="sk-..."
              />
            </label>
            <label className="modal-label">
              Anthropic
              <input
                className="modal-input"
                type="password"
                value={config.apiKeys.anthropic}
                onChange={e => setConfig(c => ({ ...c, apiKeys: { ...c.apiKeys, anthropic: e.target.value } }))}
                placeholder="sk-ant-..."
              />
            </label>
            <label className="modal-label">
              DeepSeek
              <input
                className="modal-input"
                type="password"
                value={config.apiKeys.deepseek}
                onChange={e => setConfig(c => ({ ...c, apiKeys: { ...c.apiKeys, deepseek: e.target.value } }))}
                placeholder="sk-..."
              />
            </label>
            <label className="modal-label">
              Kimi (Moonshot AI)
              <input
                className="modal-input"
                type="password"
                value={config.apiKeys.kimi}
                onChange={e => setConfig(c => ({ ...c, apiKeys: { ...c.apiKeys, kimi: e.target.value } }))}
                placeholder="sk-..."
              />
            </label>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3 className="settings-section-title">AI Workflows</h3>
            <p className="settings-section-note">Configure named workflows, each with its own model chain, and assign which AI features each one handles.</p>
            <button className="btn-secondary" onClick={() => setWorkflowsModalOpen(true)}>Configure AI Workflows</button>
          </section>

          <div className="settings-divider" />

          <section className="settings-section">
            <h3 className="settings-section-title">Image Generation</h3>
            <div className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">Generate world map for campaigns</span>
                <span className="settings-toggle-desc">
                  {config.image.generateWorldMap
                    ? 'A world map will be generated after campaign creation and used as the canvas background outside of combat.'
                    : 'No world map will be generated. The canvas will be blank outside of combat.'}
                </span>
              </div>
              <button
                className={`settings-toggle ${config.image.generateWorldMap ? 'settings-toggle--on' : ''}`}
                onClick={() => setConfig(c => ({ ...c, image: { ...c.image, generateWorldMap: !c.image.generateWorldMap } }))}
                aria-pressed={config.image.generateWorldMap}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
            <div className="settings-toggle-row">
              <div className="settings-toggle-text">
                <span className="settings-toggle-label">Generate custom tilesets for dungeon themes</span>
                <span className="settings-toggle-desc">
                  {config.image.generateTilesets
                    ? 'When a dungeon’s theme has no matching tileset, one is generated with AI before the dungeon loads.'
                    : 'Dungeons with no matching tileset fall back to the default look instead of generating one.'}
                </span>
              </div>
              <button
                className={`settings-toggle ${config.image.generateTilesets ? 'settings-toggle--on' : ''}`}
                onClick={() => setConfig(c => ({ ...c, image: { ...c.image, generateTilesets: !c.image.generateTilesets } }))}
                aria-pressed={config.image.generateTilesets}
              >
                <span className="settings-toggle-thumb" />
              </button>
            </div>
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
            <div className="settings-test-row">
              <button className="btn-test" onClick={() => void testImageConnection()} disabled={imageStatus === 'testing'}>
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
                      disabled={narrationPreviewing || !config.apiKeys.openai}
                    >
                      {narrationPreviewing ? '▶ Playing…' : '▶ Preview'}
                    </button>
                  </div>
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

      <ConfigureAiWorkflowsModal
        open={workflowsModalOpen}
        workflows={config.workflows}
        onCancel={() => setWorkflowsModalOpen(false)}
        onSave={newWorkflows => {
          setConfig(c => ({ ...c, workflows: newWorkflows }));
          setWorkflowsModalOpen(false);
        }}
      />

    </>
  );
}
