import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import type { ServerToClientEvents, ClientToServerEvents, Player, CharacterStats } from 'shared';
import { configRouter } from './routes/config.ts';
import { campaignsRouter } from './routes/campaigns.ts';
import { getCharacter } from './storage.ts';

const app = express();
app.use(cors());
app.use(express.json({ limit: '15mb' }));
app.use('/api/config', configRouter);
app.use('/api/campaigns', campaignsRouter);

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: { origin: '*' },
});

const ROOM = 'sandbox';
const connected = new Set<Player>();

const STAT_FULL: Record<string, string> = {
  STR: 'Strength', DEX: 'Dexterity', CON: 'Constitution',
  INT: 'Intelligence', WIS: 'Wisdom', CHA: 'Charisma',
};

const BG_SKILLS: Record<string, string[]> = {
  Acolyte:       ['Insight', 'Religion'],
  Charlatan:     ['Deception', 'Sleight of Hand'],
  Criminal:      ['Deception', 'Stealth'],
  Entertainer:   ['Acrobatics', 'Performance'],
  'Folk Hero':   ['Animal Handling', 'Survival'],
  Gladiator:     ['Acrobatics', 'Performance'],
  'Guild Artisan':['Insight', 'Persuasion'],
  Hermit:        ['Medicine', 'Religion'],
  Noble:         ['History', 'Persuasion'],
  Outlander:     ['Athletics', 'Survival'],
  Sage:          ['Arcana', 'History'],
  Sailor:        ['Athletics', 'Perception'],
  Soldier:       ['Athletics', 'Intimidation'],
  Urchin:        ['Sleight of Hand', 'Stealth'],
};

const SAVE_PROFS: Record<string, string[]> = {
  Barbarian: ['STR', 'CON'], Bard:    ['DEX', 'CHA'], Cleric:   ['WIS', 'CHA'],
  Druid:     ['INT', 'WIS'], Fighter: ['STR', 'CON'], Monk:     ['STR', 'DEX'],
  Paladin:   ['WIS', 'CHA'], Ranger:  ['STR', 'DEX'], Rogue:    ['DEX', 'INT'],
  Sorcerer:  ['CON', 'CHA'], Warlock: ['WIS', 'CHA'], Wizard:   ['INT', 'WIS'],
};

function d20() { return Math.floor(Math.random() * 20) + 1; }
function statMod(score: number) { return Math.floor((score - 10) / 2); }
function fmtMod(n: number) { return n >= 0 ? `+${n}` : `${n}`; }

io.on('connection', (socket) => {
  socket.on('player:join', (player) => {
    connected.add(player);
    void socket.join(ROOM);
    io.to(ROOM).emit('players:update', [...connected]);

    socket.on('roll:check', ({ campaignId, characterId, stat, skill }) => {
      void (async () => {
        const char = await getCharacter(campaignId, characterId);
        if (!char) return;
        const statKey = stat as keyof CharacterStats;
        const base = statMod(char.stats[statKey]);
        const proficient = skill ? (
          (char.skillProficiencies ?? []).includes(skill) ||
          (BG_SKILLS[char.background] ?? []).includes(skill)
        ) : false;
        const modifier = base + (proficient ? 2 : 0);
        const roll = d20();
        const total = roll + modifier;
        const label = skill ?? (STAT_FULL[stat.toUpperCase()] ?? stat.toUpperCase());
        console.log(`[roll] ${char.name} rolls ${label}: ${total} | proficient=${proficient}`);
        io.to(ROOM).emit('roll:result', {
          characterName: char.name,
          rollType: 'check',
          stat: stat.toUpperCase(),
          d20: roll,
          modifier,
          total,
          description: `${char.name} rolls ${label}: ${total}`,
        });
      })();
    });

    socket.on('roll:save', ({ campaignId, characterId, stat }) => {
      void (async () => {
        const char = await getCharacter(campaignId, characterId);
        if (!char) return;
        const statKey = stat as keyof CharacterStats;
        const statUpper = stat.toUpperCase();
        const base = statMod(char.stats[statKey]);
        const proficient = (SAVE_PROFS[char.class] ?? []).includes(statUpper);
        const modifier = base + (proficient ? 2 : 0);
        const roll = d20();
        const total = roll + modifier;
        const statLabel = STAT_FULL[statUpper] ?? statUpper;
        const profText = proficient ? ' (proficient)' : '';
        console.log(`[roll] ${char.name} rolls ${statLabel} Save: ${total}`);
        io.to(ROOM).emit('roll:result', {
          characterName: char.name,
          rollType: 'save',
          stat: statUpper,
          d20: roll,
          modifier,
          total,
          description: `${char.name} rolls ${statLabel} Save: ${total}`,
        });
      })();
    });

    socket.on('chat:message', ({ text, senderName }) => {
      io.to(ROOM).emit('chat:message', { text, senderName, timestamp: Date.now() });
    });

    socket.on('disconnect', () => {
      connected.delete(player);
      io.to(ROOM).emit('players:update', [...connected]);
    });
  });
});

const PORT = 3001;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`api listening on :${PORT}`);
});
