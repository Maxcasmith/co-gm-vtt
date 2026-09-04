import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Card } from '../../components/Card';
import './Home.css';

const FEATURES = [
  {
    title: 'AI-Designed Worlds',
    body: 'Unique lore, factions, and plots built from your prompt.',
  },
  {
    title: 'Complete & Playable',
    body: 'Maps, NPCs, items, and encounters — session-ready.',
  },
  {
    title: 'Built For Play',
    body: "Runs straight into your table's virtual tabletop.",
  },
  {
    title: 'Yours To Customize',
    body: 'Edit anything. Make it your own world.',
  },
];

export function Home() {
  const navigate = useNavigate();
  const [prompt, setPrompt] = useState('');
  const [tone, setTone] = useState('');

  function handleGenerate() {
    navigate('/signup', { state: { prompt, tone } });
  }

  return (
    <div className="home--page">
      <header className="home--nav">
        <span className="home--nav--wordmark">Untitled AI VTT</span>
        <nav className="home--nav--actions">
          <Link className="home--nav--login" to="/login">Log in</Link>
          <Button className="home--nav--signup" onClick={() => navigate('/signup')}>Sign Up Free</Button>
        </nav>
      </header>

      <section className="home--hero">
        <div className="home--hero--copy">
          <span className="home--hero--eyebrow">AI-Powered Tabletop Adventures</span>
          <h1 className="home--hero--title">
            Build your world.<br />We&apos;ll draft the campaign.
          </h1>
          <p className="home--hero--subtitle">
            Describe your idea and our AI drafts the story, NPCs, maps, and encounters. You bring the players — we&apos;ll handle the rest.
          </p>

          <div className="home--hero--prompt-card">
            <label className="home--hero--prompt-label">
              Describe the adventure you want to create
              <textarea
                className="home--hero--prompt-input"
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="A haunted coastal town cursed by an ancient sea god"
                rows={2}
              />
            </label>
            <label className="home--hero--prompt-label home--hero--prompt-label--optional">
              Tone (optional)
              <input
                className="home--hero--tone-input"
                value={tone}
                onChange={e => setTone(e.target.value)}
                placeholder="Dark and mysterious, with political intrigue"
              />
            </label>
            <Button className="home--hero--generate" onClick={handleGenerate}>
              Generate My Campaign
            </Button>
            <span className="home--hero--prompt-hint">Free to start — takes less than a minute</span>
          </div>
        </div>

        <div className="home--hero--art">
          <img
            className="home--hero--art-img"
            src="https://picsum.photos/seed/untitled-ai-vtt/1200/900"
            alt=""
          />
        </div>
      </section>

      <section className="home--features">
        {FEATURES.map(f => (
          <Card key={f.title}>
            <div className="home--feature--tile">
              <span className="home--feature--title">{f.title}</span>
              <span className="home--feature--body">{f.body}</span>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}
