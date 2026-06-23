import { useState, useEffect } from 'react';
import { useCharacter } from './CharacterContext.tsx';
import { SKILLS, CLASS_SKILLS, BACKGROUND_FEAT, BACKGROUND_SKILLS, CLASS_FEATURES } from './srd.ts';

interface Source {
  key: string;
  label: string;
  skills: string[]; // empty = any skill allowed
  count: number;
}

function usedBySource(profs: Record<string, string>, label: string): number {
  return Object.values(profs).filter(v => v === label).length;
}

const EXPERTISE_COUNT = 2;

export default function SkillPicker() {
  const c = useCharacter();
  const [activeKey, setActiveKey] = useState<string>('');

  const hasExpertise = c.characterClass
    ? (CLASS_FEATURES[c.characterClass] ?? []).some(f => f.name === 'Expertise')
    : false;

  // Build the available sources from current character choices
  const sources: Source[] = [];

  if (c.characterClass && CLASS_SKILLS[c.characterClass]) {
    const cs = CLASS_SKILLS[c.characterClass]!;
    sources.push({ key: 'class', label: c.characterClass, skills: cs.skills, count: cs.count });
  }

  const bgFeatName = c.background ? BACKGROUND_FEAT[c.background]?.name : '';
  if (bgFeatName === 'Skilled') {
    sources.push({ key: 'bg-skilled', label: 'Skilled', skills: [], count: 3 });
  }

  if (c.species === 'Human') {
    sources.push({ key: 'skillful', label: 'Skillful', skills: [], count: 1 });
    if (c.speciesOriginFeat === 'Skilled') {
      sources.push({ key: 'origin-skilled', label: 'Skilled (Origin)', skills: [], count: 3 });
    }
  }

  // Keep active tab valid when sources change (e.g. class changes)
  const allKeys = [...sources.map(s => s.key), ...(hasExpertise ? ['expertise'] : [])];
  const validKey = allKeys.includes(activeKey) ? activeKey : (allKeys[0] ?? '');
  useEffect(() => { setActiveKey(validKey); }, [validKey]);

  if (sources.length === 0 && !hasExpertise) return null;

  const bgSkills = new Set(c.background ? (BACKGROUND_SKILLS[c.background] ?? []) : []);

  // All proficient skills (for the expertise tab filter)
  const allProficientSkills = new Set([
    ...Object.keys(c.skillProficiencies),
    ...bgSkills,
  ]);

  // ── Expertise tab rendering ──────────────────────────────────────────────
  if (validKey === 'expertise') {
    const expertiseSlots = c.expertiseSkills;
    const slotsLeft = EXPERTISE_COUNT - expertiseSlots.length;

    function toggleExpertise(skillName: string) {
      const idx = c.expertiseSkills.indexOf(skillName);
      if (idx >= 0) {
        c.set('expertiseSkills', c.expertiseSkills.filter(s => s !== skillName));
      } else {
        if (slotsLeft <= 0) return;
        c.set('expertiseSkills', [...c.expertiseSkills, skillName]);
      }
    }

    return (
      <div className="skill-picker">
        <div className="skill-picker-header">
          <span className="settings-section-title">Skill Proficiencies</span>
        </div>
        <div className="skill-tabs">
          {sources.map(src => {
            const used = usedBySource(c.skillProficiencies, src.label);
            return (
              <button key={src.key} className={`skill-tab ${validKey === src.key ? 'skill-tab--active' : ''}`} onClick={() => setActiveKey(src.key)}>
                {src.label}
                <span className={`skill-tab-count ${used === src.count ? 'skill-tab-count--full' : ''}`}>{used}/{src.count}</span>
              </button>
            );
          })}
          <button className={`skill-tab ${validKey === 'expertise' ? 'skill-tab--active' : ''}`} onClick={() => setActiveKey('expertise')}>
            Expertise
            <span className={`skill-tab-count ${expertiseSlots.length === EXPERTISE_COUNT ? 'skill-tab-count--full' : ''}`}>
              {expertiseSlots.length}/{EXPERTISE_COUNT}
            </span>
          </button>
        </div>

        <div className="skill-list">
          {SKILLS.map(skill => {
            const isProficient = allProficientSkills.has(skill.name);
            const isExpert = expertiseSlots.includes(skill.name);
            const canToggle = isProficient && (isExpert || slotsLeft > 0);

            return (
              <button
                key={skill.name}
                className={['skill-item', isExpert ? 'skill-item--active' : '', !isProficient ? 'skill-item--disabled' : ''].filter(Boolean).join(' ')}
                onClick={() => { if (canToggle) toggleExpertise(skill.name); }}
                disabled={!isProficient}
              >
                <span className="skill-stat-badge">{skill.stat}</span>
                <span className="skill-name">{skill.name}</span>
                {isExpert && <span className="skill-source skill-source--mine">Expertise</span>}
                {!isProficient && <span className="skill-source skill-source--faded">not proficient</span>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── Normal proficiency tab rendering ────────────────────────────────────
  const source = sources.find(s => s.key === validKey)!;
  if (!source) return null;
  const profs = c.skillProficiencies;

  function isAllowed(skillName: string): boolean {
    return source.skills.length === 0 || source.skills.includes(skillName);
  }

  function toggle(skillName: string) {
    const takenBy = profs[skillName];
    if (takenBy && takenBy !== source.label) return;
    if (!isAllowed(skillName)) return;

    const next = { ...profs };
    if (takenBy === source.label) {
      delete next[skillName];
    } else {
      if (usedBySource(profs, source.label) >= source.count) return;
      next[skillName] = source.label;
    }
    c.set('skillProficiencies', next);
  }

  const slotsLeft = source.count - usedBySource(profs, source.label);

  return (
    <div className="skill-picker">
      <div className="skill-picker-header">
        <span className="settings-section-title">Skill Proficiencies</span>
      </div>

      <div className="skill-tabs">
        {sources.map(src => {
          const used = usedBySource(profs, src.label);
          return (
            <button key={src.key} className={`skill-tab ${validKey === src.key ? 'skill-tab--active' : ''}`} onClick={() => setActiveKey(src.key)}>
              {src.label}
              <span className={`skill-tab-count ${used === src.count ? 'skill-tab-count--full' : ''}`}>{used}/{src.count}</span>
            </button>
          );
        })}
        {hasExpertise && (
          <button className={`skill-tab ${validKey === 'expertise' ? 'skill-tab--active' : ''}`} onClick={() => setActiveKey('expertise')}>
            Expertise
            <span className={`skill-tab-count ${c.expertiseSkills.length === EXPERTISE_COUNT ? 'skill-tab-count--full' : ''}`}>
              {c.expertiseSkills.length}/{EXPERTISE_COUNT}
            </span>
          </button>
        )}
      </div>

      <div className="skill-list">
        {SKILLS.map(skill => {
          const fromBg = bgSkills.has(skill.name);
          const takenBy = profs[skill.name];
          const isMine = takenBy === source.label;
          const isTakenByOther = Boolean(takenBy && !isMine);
          const allowed = isAllowed(skill.name);
          const canAdd = !takenBy && !fromBg && allowed && slotsLeft > 0;
          const isDisabled = fromBg || isTakenByOther || (!isMine && !allowed);

          return (
            <button
              key={skill.name}
              className={[
                'skill-item',
                fromBg          ? 'skill-item--bg'       : '',
                isMine          ? 'skill-item--active'   : '',
                isTakenByOther  ? 'skill-item--other'    : '',
                isDisabled      ? 'skill-item--disabled'  : '',
                !canAdd && !isMine && !isTakenByOther && !fromBg && allowed ? 'skill-item--full' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => toggle(skill.name)}
              disabled={isDisabled}
            >
              <span className="skill-stat-badge">{skill.stat}</span>
              <span className="skill-name">{skill.name}</span>
              {fromBg
                ? <span className="skill-source skill-source--bg">{c.background}</span>
                : takenBy && (
                  <span className={`skill-source ${isMine ? 'skill-source--mine' : 'skill-source--other'}`}>
                    {takenBy}
                  </span>
                )
              }
            </button>
          );
        })}
      </div>
    </div>
  );
}
