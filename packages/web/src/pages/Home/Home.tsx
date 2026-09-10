import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { CompassIcon, DropIcon, FlameIcon, GemIcon, SparkleIcon, StarIcon } from '../../components/icons/Icons';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import './Home.css';

const VIBES = [
  { label: 'Fantasy', icon: FlameIcon },
  { label: 'Horror', icon: DropIcon },
  { label: 'Heist', icon: GemIcon },
  { label: 'Exploration', icon: CompassIcon },
  { label: 'Any Setting', icon: StarIcon },
];

export function Home() {
  const navigate = useNavigate();
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  function addTag(tag: string) {
    const clean = tag.trim();
    if (!clean || tags.includes(clean)) return;
    setTags(ts => [...ts, clean]);
  }

  function removeTag(i: number) {
    setTags(ts => ts.filter((_, ti) => ti !== i));
  }

  function handleGenerate() {
    navigate('/signup', { state: { prompt: tags.join(', ') } });
  }

  return (
    <ParchmentLayout
      autoReady={false}
      header={
        <PageHeader
          actions={
            <>
              <Link className="btn btn--outline btn--primary btn--md" to="/login">Log In</Link>
              <Button onClick={() => navigate('/signup')}>Get Started</Button>
            </>
          }
        />
      }
      skeleton={
        <section className="home--hero">
          <div className="home--hero--prompt-card torn-parchment">
            <span className="skeleton home--skeleton--label" />
            <div className="home--hero--prompt-row">
              <span className="skeleton home--skeleton--input" />
              <span className="skeleton home--skeleton--button" />
            </div>
            <div className="home--hero--chips">
              {[0, 1, 2, 3, 4].map(i => (
                <span className="skeleton home--skeleton--chip" key={i} />
              ))}
            </div>
          </div>
        </section>
      }
    >
      {setReady => (
        <>
          <section className="home--hero">
            <video
              className="home--hero--video"
              src="/hero-bg.mp4"
              autoPlay
              muted
              loop
              playsInline
              onCanPlayThrough={() => setReady(true)}
              onError={() => setReady(true)}
            />

            <div className="home--hero--prompt-card torn-parchment">
              <label className="home--hero--prompt-label" htmlFor="prompt-input">
                Describe the adventure you want to create…
              </label>

              {tags.length > 0 && (
                <div className="home--hero--tags">
                  {tags.map((t, i) => (
                    <span className="home--hero--tag" key={`${t}_${i}`}>
                      {t}
                      <button
                        type="button"
                        className="home--hero--tag-remove"
                        aria-label={`Remove ${t}`}
                        onClick={() => removeTag(i)}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <div className="home--hero--prompt-row">
                <input
                  id="prompt-input"
                  className="home--hero--prompt-input"
                  value={draft}
                  onChange={e => {
                    const char = e.nativeEvent instanceof InputEvent ? e.nativeEvent.data : null;
                    const val = e.target.value.replaceAll(',', '');
                    if (char === ',' && val.trim() !== '') {
                      addTag(val);
                      setDraft('');
                    } else {
                      setDraft(val);
                    }
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addTag(draft);
                      setDraft('');
                    }
                  }}
                  placeholder="e.g. cursed coastal town, political intrigue, sea monsters…"
                />
                <Button className="home--hero--generate" onClick={handleGenerate}>
                  <SparkleIcon className="home--hero--generate-icon" />
                  Create My Campaign
                </Button>
              </div>
              <div className="home--hero--chips">
                {VIBES.map(v => (
                  <button
                    key={v.label}
                    type="button"
                    className={`home--hero--chip${tags.includes(v.label) ? ' home--hero--chip--active' : ''}`}
                    onClick={() => addTag(v.label)}
                  >
                    <v.icon className="home--hero--chip-icon" />
                    {v.label}
                  </button>
                ))}
              </div>
              <p className="home--hero--quote">From a spark of an idea… to a living world.</p>
            </div>
          </section>
        </>
      )}
    </ParchmentLayout>
  );
}
