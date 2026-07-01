import { Router } from 'express';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Spell } from 'shared';

const __dir = dirname(fileURLToPath(import.meta.url));

// ── CSV parsing ───────────────────────────────────────────────────────────────
// The CSV has quoted fields, some spanning multiple lines and containing escaped
// ("") quotes — scan the whole text by character so quote state is tracked
// directly rather than re-derived per line (which was the source of past bugs).

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\r') { /* skip, \n handles the line break */ }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else { field += ch; }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const LEVEL_MAP: Record<string, number> = {
  Cantrip: 0, '1st': 1, '2nd': 2, '3rd': 3, '4th': 4,
  '5th': 5, '6th': 6, '7th': 7, '8th': 8, '9th': 9,
};

// Extract base class name from "Wizard (PHB'14)" → "Wizard"
function parseClasses(raw: string): string[] {
  if (!raw.trim()) return [];
  return [...new Set(
    raw.split(',')
      .map(s => s.trim().replace(/\s*\(.*?\)\s*/g, '').trim())
      .filter(Boolean)
  )];
}

function loadSpells(): Spell[] {
  const csvPath = join(__dir, '../../storage/spells/Spells.csv');
  const text = readFileSync(csvPath, 'utf-8');
  const rows = parseCSV(text).slice(1); // skip header
  const spells: Spell[] = [];

  for (const fields of rows) {
    if (fields.length === 1 && !fields[0]) continue; // trailing blank row

    const [name, source, , levelRaw, castingTime, duration, schoolRaw, range, components, classesA, classesB, , spellText, atHigherLevels] = fields;
    if (!name) continue;

    const isRitual = (schoolRaw ?? '').includes('(ritual)');
    const school = (schoolRaw ?? '').replace(/\s*\(ritual\)\s*/i, '').trim();
    const levelLabel = (levelRaw ?? '').trim();
    const level = LEVEL_MAP[levelLabel] ?? 0;
    const classes = [...new Set([...parseClasses(classesA ?? ''), ...parseClasses(classesB ?? '')])];

    spells.push({ name: name.trim(), source: source?.trim() ?? '', level, levelLabel, castingTime: castingTime?.trim() ?? '', duration: duration?.trim() ?? '', school, range: range?.trim() ?? '', components: components?.trim() ?? '', classes, text: spellText?.trim() ?? '', atHigherLevels: atHigherLevels?.trim() ?? '', isRitual });
  }
  return spells;
}

// Load once at startup
const ALL_SPELLS = loadSpells();

// ── Router ────────────────────────────────────────────────────────────────────

export const spellsRouter = Router();

/**
 * GET /api/spells
 * Query params:
 *   level  — '0', '1', … '9'  (can repeat: ?level=0&level=1)
 *   class  — 'Wizard' (can repeat)
 *   school — 'Evocation' (can repeat, case-insensitive)
 *   ritual — 'true' | 'false'
 *   name   — partial name search (case-insensitive)
 */
spellsRouter.get('/', (req, res) => {
  const qLevel  = [req.query.level].flat().filter(Boolean) as string[];
  const qClass  = [req.query.class].flat().filter(Boolean) as string[];
  const qSchool = [req.query.school].flat().filter(Boolean) as string[];
  const qRitual = req.query.ritual as string | undefined;
  const qName   = (req.query.name as string | undefined)?.toLowerCase();

  let results = ALL_SPELLS;

  if (qLevel.length)  results = results.filter(s => qLevel.includes(String(s.level)));
  if (qClass.length)  results = results.filter(s => qClass.some(c => s.classes.some(sc => sc.toLowerCase() === c.toLowerCase())));
  if (qSchool.length) results = results.filter(s => qSchool.some(sch => s.school.toLowerCase() === sch.toLowerCase()));
  if (qRitual === 'true')  results = results.filter(s => s.isRitual);
  if (qRitual === 'false') results = results.filter(s => !s.isRitual);
  if (qName) results = results.filter(s => s.name.toLowerCase().includes(qName));

  res.json(results);
});

/** GET /api/spells/meta — distinct values for filter dropdowns */
spellsRouter.get('/meta', (_req, res) => {
  const schools = [...new Set(ALL_SPELLS.map(s => s.school).filter(Boolean))].sort();
  const classes = [...new Set(ALL_SPELLS.flatMap(s => s.classes))].sort();
  res.json({ schools, classes });
});
