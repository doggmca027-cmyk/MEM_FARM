import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { RefreshCw, Shield, Star, Swords, Trophy, Zap } from 'lucide-react';
import type { RaidOpponent } from '../types/quests';
import { flattenCharacters, MAX_RAID_TICKETS, selectFarmPower, TICKET_REFILL_MS, useGameStore } from '../store/useGameStore';
import { LEADERBOARD, pickOpponent } from '../data/raid';
import { MEME_EMOJI } from '../lib/meme';
import { fmtHMS, formatNum } from '../lib/format';
import { haptic } from '../lib/haptics';
import { GameButton } from '../components/ui/GameButton';
import { BattleModal } from '../components/raid/BattleModal';

export function RaidScreen() {
  const farmPower = useGameStore(selectFarmPower);
  const raidTickets = useGameStore((s) => s.raidTickets);
  const lastTicketRefillAt = useGameStore((s) => s.lastTicketRefillAt);
  const pvpRating = useGameStore((s) => s.pvpRating);
  const xp = useGameStore((s) => s.xp);
  const tickDaily = useGameStore((s) => s.tickDaily);
  const startRaidBattle = useGameStore((s) => s.startRaidBattle);
  const userMeme = useGameStore((s) => {
    const top = [...flattenCharacters(s.tiers)].sort((a, b) => b.power - a.power)[0];
    return top?.memeType ?? 'gigachad';
  });

  const [sub, setSub] = useState<'arena' | 'leaders'>('arena');
  const [metric, setMetric] = useState<'power' | 'xp'>('power');
  const [opp, setOpp] = useState<RaidOpponent>(() => pickOpponent(farmPower));
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    tickDaily();
    const id = window.setInterval(() => {
      setNow(Date.now());
      tickDaily();
    }, 1000);
    return () => window.clearInterval(id);
  }, [tickDaily]);

  const winChance = farmPower / (farmPower + opp.power || 1);
  const nextTicketMs = Math.max(0, lastTicketRefillAt + TICKET_REFILL_MS - now);

  const reroll = () => {
    haptic.select();
    setOpp(pickOpponent(farmPower, opp.id));
  };

  const attack = () => {
    if (raidTickets <= 0) {
      haptic.notify('error');
      return;
    }
    haptic.impact('heavy');
    startRaidBattle(opp);
  };

  const leaders = useMemo(() => {
    const rows = [
      ...LEADERBOARD.map((r) => ({ ...r, self: false })),
      { name: 'Ти', memeType: userMeme, rating: pvpRating, power: farmPower, xp, self: true },
    ];
    return rows
      .sort((a, b) => (metric === 'xp' ? b.xp - a.xp : b.power - a.power))
      .slice(0, 10)
      .map((r, i) => ({ ...r, place: i + 1 }));
  }, [userMeme, pvpRating, farmPower, xp, metric]);

  return (
    <div className="space-y-5">
      {/* ===== FIGHTER HEADER ===== */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-pink border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />
        <div className="relative flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/50">
              Сила ферми
            </div>
            <div className="flex items-center gap-1.5 font-display text-3xl text-stroke">
              <Zap className="h-6 w-6 text-neon-cyan" strokeWidth={2.5} />
              {formatNum(farmPower)}
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-neon-yellow">
              <Trophy className="h-3.5 w-3.5" strokeWidth={3} />
              {pvpRating} PvP
            </div>
          </div>
          <div className="text-right">
            <div className="font-display text-2xl text-stroke">
              ⚡ {raidTickets}/{MAX_RAID_TICKETS}
            </div>
            <div className="text-[11px] font-semibold text-white/45">
              {raidTickets >= MAX_RAID_TICKETS ? 'повний запас' : `+1 через ${fmtHMS(nextTicketMs)}`}
            </div>
          </div>
        </div>
      </div>

      {/* subtab */}
      <div className="flex gap-2">
        {(['arena', 'leaders'] as const).map((k) => (
          <button
            key={k}
            onClick={() => {
              haptic.select();
              setSub(k);
            }}
            className={[
              'flex-1 rounded-2xl border-2 border-b-4 border-black px-2 py-2 text-[11px] font-extrabold uppercase',
              sub === k ? 'border-b-black/40 bg-neon-lime text-black' : 'border-b-black/40 bg-farm-card text-white/50',
            ].join(' ')}
          >
            {k === 'arena' ? 'Арена' : 'Лідери'}
          </button>
        ))}
      </div>

      {sub === 'arena' ? (
        <motion.div
          key={opp.id}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-black border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md"
        >
          <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />

          <div className="relative flex items-center gap-3">
            <span className="grid h-16 w-16 flex-none place-items-center rounded-2xl border-2 border-black bg-farm-deep text-3xl">
              {MEME_EMOJI[opp.memeType]}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate font-display text-lg text-stroke-sm">{opp.name}</div>
              <div className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-neon-cyan">
                <Shield className="h-3.5 w-3.5" strokeWidth={3} />
                Сила {formatNum(opp.power)}
              </div>
            </div>
            <div className="flex-none text-right">
              <div className="font-display text-2xl text-neon-lime text-stroke-sm">
                {Math.round(winChance * 100)}%
              </div>
              <div className="text-[9px] font-bold uppercase text-white/40">шанс</div>
            </div>
          </div>

          {/* chance bar */}
          <div className="relative mt-3 h-3 w-full overflow-hidden rounded-full border-2 border-black bg-neon-pink/40">
            <div className="h-full rounded-full bg-neon-lime" style={{ width: `${winChance * 100}%` }} />
          </div>

          <div className="relative mt-3 flex gap-2">
            <GameButton accent="cyan" onClick={reroll} className="text-xs">
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className="h-4 w-4" strokeWidth={3} />
                Знайти іншого
              </span>
            </GameButton>
            <GameButton accent="pink" block disabled={raidTickets <= 0} onClick={attack}>
              <span className="inline-flex items-center gap-1.5">
                <Swords className="h-4 w-4" strokeWidth={3} />
                Атакувати · ⚡1
              </span>
            </GameButton>
          </div>
        </motion.div>
      ) : (
        <>
          <div className="mb-3 flex gap-2">
            <button
              onClick={() => {
                haptic.select();
                setMetric('power');
              }}
              className={[
                'flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 border-b-4 border-black px-2 py-2 text-[11px] font-extrabold uppercase',
                metric === 'power' ? 'border-b-black/40 bg-neon-cyan text-black' : 'border-b-black/40 bg-farm-card text-white/50',
              ].join(' ')}
            >
              <Zap className="h-3.5 w-3.5" strokeWidth={3} />
              Топ за Силою
            </button>
            <button
              onClick={() => {
                haptic.select();
                setMetric('xp');
              }}
              className={[
                'flex-1 inline-flex items-center justify-center gap-1.5 rounded-2xl border-2 border-b-4 border-black px-2 py-2 text-[11px] font-extrabold uppercase',
                metric === 'xp' ? 'border-b-black/40 bg-neon-yellow text-black' : 'border-b-black/40 bg-farm-card text-white/50',
              ].join(' ')}
            >
              <Star className="h-3.5 w-3.5" strokeWidth={3} />
              Топ за Досвідом
            </button>
          </div>

          <ol className="space-y-2">
            {leaders.map((r) => (
              <li
                key={`${r.name}-${r.place}`}
                className={[
                  'flex items-center gap-3 rounded-2xl border-2 border-b-4 border-black border-b-black/40 px-3 py-2.5 backdrop-blur-md',
                  r.self ? 'border-neon-lime bg-neon-lime/10' : 'bg-farm-card/70',
                ].join(' ')}
              >
                <span className="w-6 flex-none text-center font-display text-lg text-stroke-sm">
                  {r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : r.place}
                </span>
                <span className="grid h-9 w-9 flex-none place-items-center rounded-xl border-2 border-black bg-farm-deep text-lg">
                  {MEME_EMOJI[r.memeType]}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{r.name}</div>
                  <div className="inline-flex items-center gap-0.5 text-[10px] font-bold text-neon-yellow">
                    <Star className="h-3 w-3 fill-neon-yellow" strokeWidth={2.5} />
                    {formatNum(r.xp)} XP
                  </div>
                </div>
                <span className="inline-flex flex-none items-center gap-1 font-display text-sm text-neon-cyan text-stroke-sm">
                  {metric === 'xp' ? (
                    <>
                      <Star className="h-3.5 w-3.5" strokeWidth={3} />
                      {formatNum(r.xp)}
                    </>
                  ) : (
                    <>
                      <Zap className="h-3.5 w-3.5" strokeWidth={3} />
                      {formatNum(r.power)}
                    </>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}

      <BattleModal />
    </div>
  );
}
