import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { CloudIcon, D20Icon, SparkleIcon } from '../../components/icons/Icons';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import './About.css';

const PILLARS = [
  {
    icon: SparkleIcon,
    title: 'An AI Dungeon Master',
    body: 'Narrates the story, adjudicates the rules, and builds dungeons scaled to your party — so every session has someone running the table.',
  },
  {
    icon: D20Icon,
    title: 'A Real Ruleset',
    body: 'The full 2024 D&D rules, not a simplified stand-in — character creation, spellcasting, and combat all play by the book.',
  },
  {
    icon: CloudIcon,
    title: 'Play However You Want',
    body: 'Jump in from the browser with the cloud plan, or own the desktop app outright — your campaigns follow you either way.',
  },
];

export function About() {
  const navigate = useNavigate();

  return (
    <ParchmentLayout
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
        <>
          <div className="about--intro parchment-container">
            <span className="skeleton about--skeleton--title" />
            <span className="skeleton about--skeleton--subtitle" />
            <span className="skeleton about--skeleton--subtitle" />
          </div>
          <div className="about--pillars parchment-container">
            {[0, 1, 2].map(i => (
              <div className="about--pillar" key={i}>
                <span className="skeleton about--skeleton--icon" />
                <span className="skeleton about--skeleton--pillar-title" />
                <span className="skeleton about--skeleton--pillar-body" />
                <span className="skeleton about--skeleton--pillar-body" />
              </div>
            ))}
          </div>
        </>
      }
    >
      <div className="about--intro parchment-container">
        <h1 className="about--intro--title">About Us</h1>
        <p className="about--intro--subtitle">
          Getting a table together for a tabletop campaign is hard — schedules, a DM willing to prep,
          someone to track a hundred small rules. We built an AI Dungeon Master to handle the bookkeeping
          so your group can just play.
        </p>
      </div>

      <div className="about--pillars parchment-container">
        {PILLARS.map(pillar => (
          <div className="about--pillar" key={pillar.title}>
            <pillar.icon className="about--pillar--icon" />
            <h2 className="about--pillar--title">{pillar.title}</h2>
            <p className="about--pillar--body">{pillar.body}</p>
          </div>
        ))}
      </div>
    </ParchmentLayout>
  );
}
