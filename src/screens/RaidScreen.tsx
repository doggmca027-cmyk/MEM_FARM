import { useEffect, useMemo, useState } from 'react';
import { Star, Swords, Trophy, X, Zap } from 'lucide-react';
import {
  flattenCharacters,
  pvpFee,
  pvpPayout,
  pvpPot,
  selectFarmPower,
  STAKE_TIERS,
  useGameStore,
} from '../store/useGameStore';
import { MEME_EMOJI } from '../lib/meme';
import { formatNum } from '../lib/format';
import { haptic } from '../lib/haptics';
import { GameButton } from '../components/ui/GameButton';
import { GramIcon } from '../components/icons/Icons';
import { BattleModal } from '../components/raid/BattleModal';
import { useT } from '../i18n/useT';

const fmt2 = (n: number) => n.toFixed(2);

export function RaidScreen() {
  const t = useT();
  const mode = useGameStore((s) => s.mode);
  const farmPower = useGameStore(selectFarmPower);
  const balanceGram = useGameStore((s) => s.balanceGram);
  const pvpRating = useGameStore((s) => s.pvpRating);
  const xp = useGameStore((s) => s.xp);
  const stake = useGameStore((s) => s.pvpStake);
  const setPvpStake = useGameStore((s) => s.setPvpStake);
  const pvpLobby = useGameStore((s) => s.pvpLobby);
  const openLobbies = useGameStore((s) => s.openLobbies);
  const leaderboard = useGameStore((s) => s.leaderboard);
  const tickDaily = useGameStore((s) => s.tickDaily);
  const startWagerBattle = useGameStore((s) => s.startWagerBattle);
  const cancelLobby = useGameStore((s) => s.cancelLobby);
  const refreshLobbies = useGameStore((s) => s.refreshLobbies);
  const fetchLeaderboard = useGameStore((s) => s.fetchLeaderboard);
  const joinLobby = useGameStore((s) => s.joinLobby);
  const userMeme = useGameStore((s) => {
    const top = [...flattenCharacters(s.tiers)].sort((a, b) => b.power - a.power)[0];
    return top?.memeType ?? 'gigachad';
  });

  const [sub, setSub] = useState<'arena' | 'leaders'>('arena');
  const [metric, setMetric] = useState<'power' | 'xp'>('power');

  useEffect(() => {
    tickDaily();
    void refreshLobbies();
    void fetchLeaderboard();
    const id = window.setInterval(() => {
      tickDaily();
      void refreshLobbies();
    }, 5000);
    return () => window.clearInterval(id);
  }, [tickDaily, refreshLobbies, fetchLeaderboard]);

  const canAfford = balanceGram + 1e-9 >= stake;
  const otherLobbies = openLobbies.filter((l) => l.stake === stake);

  const findMatch = () => {
    if (mode !== 'live') {
      haptic.notify('error');
      return;
    }
    if (!canAfford) {
      haptic.notify('error');
      return;
    }
    haptic.impact('heavy');
    void startWagerBattle();
  };

  const leaders = useMemo(() => {
    const rows = [
      ...leaderboard.map((r) => ({ ...r, self: false })),
      { name: t('battle.you'), memeType: userMeme, rating: pvpRating, power: farmPower, xp, self: true },
    ];
    return rows
      .sort((a, b) => (metric === 'xp' ? b.xp - a.xp : b.power - a.power))
      .slice(0, 20)
      .map((r, i) => ({ ...r, place: i + 1 }));
  }, [leaderboard, userMeme, pvpRating, farmPower, xp, metric, t]);

  return (
    <div className="space-y-5">
      {/* ===== FIGHTER HEADER ===== */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-pink border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />
        <div className="relative flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/50">
              {t('raid.farmPower')}
            </div>
            <div className="flex items-center gap-1.5 font-display text-3xl text-stroke">
              <Zap className="h-6 w-6 text-neon-cyan" strokeWidth={2.5} />
              <span className="dir-ltr">{formatNum(farmPower)}</span>
            </div>
            <div className="mt-0.5 inline-flex items-center gap-1 text-[11px] font-bold text-neon-yellow dir-ltr">
              <Trophy className="h-3.5 w-3.5" strokeWidth={3} />
              {pvpRating} PvP
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-bold uppercase tracking-wide text-white/50">
              {t('raid.balance')}
            </div>
            <div className="inline-flex items-center gap-1 font-display text-2xl text-neon-cyan text-stroke dir-ltr">
              <GramIcon className="h-5 w-5" />
              {fmt2(balanceGram)}
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
            {k === 'arena' ? t('raid.arena') : t('raid.leaders')}
          </button>
        ))}
      </div>

      {sub === 'arena' ? (
        <>
          {/* ===== STAKE SELECTOR ===== */}
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-white/50">
              <span>{t('raid.stake')}</span>
              <span className="dir-ltr text-neon-lime">
                {t('raid.winPreview', { n: fmt2(pvpPayout(stake)) })}
              </span>
            </div>
            <div className="grid grid-cols-6 gap-1.5">
              {STAKE_TIERS.map((v) => {
                const on = v === stake;
                return (
                  <button
                    key={v}
                    onClick={() => {
                      haptic.select();
                      setPvpStake(v);
                    }}
                    className={[
                      'rounded-xl border-2 border-b-4 border-black py-1.5 text-[11px] font-extrabold dir-ltr',
                      on ? 'border-b-black/40 bg-neon-yellow text-black' : 'border-b-black/40 bg-farm-card text-white/60',
                    ].join(' ')}
                  >
                    {v}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ===== MATCH CARD (real players only) ===== */}
          <div className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-black border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md">
            <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />

            <div className="relative flex justify-between text-[10px] font-bold text-white/45 dir-ltr">
              <span>{t('raid.pot')}: {fmt2(pvpPot(stake))}</span>
              <span className="text-neon-pink">−{fmt2(pvpFee(stake))} (10%)</span>
              <span className="text-neon-lime">+{fmt2(pvpPayout(stake))}</span>
            </div>

            {mode !== 'live' ? (
              <div className="relative mt-3 text-center text-xs font-bold text-white/50">
                {t('raid.onlineOnly')}
              </div>
            ) : pvpLobby ? (
              <div className="relative mt-3 flex items-center justify-between rounded-2xl border-2 border-b-4 border-neon-yellow border-b-black/40 bg-neon-yellow/10 p-3">
                <div className="text-xs font-bold text-white/70">
                  {t('raid.waiting', { n: fmt2(pvpLobby.stake) })}
                </div>
                <button
                  onClick={() => {
                    haptic.select();
                    void cancelLobby();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border-2 border-black bg-farm-deep px-2 py-1 text-[10px] font-extrabold uppercase text-neon-pink"
                >
                  <X className="h-3 w-3" strokeWidth={3} />
                  {t('raid.cancel')}
                </button>
              </div>
            ) : (
              <>
                <div className="relative mt-3">
                  <GameButton accent="pink" block disabled={!canAfford} onClick={findMatch}>
                    <span className="inline-flex items-center gap-1.5">
                      <Swords className="h-4 w-4" strokeWidth={3} />
                      <span className="dir-ltr">{t('raid.fightForStake', { n: fmt2(stake) })}</span>
                    </span>
                  </GameButton>
                </div>
                {!canAfford && (
                  <div className="relative mt-2 text-center text-[10px] font-bold text-neon-pink">
                    {t('raid.insufficientForStake')}
                  </div>
                )}
                <div className="relative mt-2 text-center text-[10px] text-white/40">
                  {t('raid.matchHint')}
                </div>
              </>
            )}
          </div>

          {/* ===== OPEN LOBBIES (other players, same stake) ===== */}
          {mode === 'live' && !pvpLobby && (
            <div>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/50">
                {t('raid.openLobbies')}
              </div>
              {otherLobbies.length === 0 ? (
                <div className="rounded-2xl border-2 border-dashed border-white/20 bg-farm-card/40 py-6 text-center text-xs text-white/45">
                  {t('raid.noOpponents')}
                </div>
              ) : (
                <ul className="space-y-2">
                  {otherLobbies.map((l) => (
                    <li
                      key={l.id}
                      className="flex items-center justify-between rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/70 px-3 py-2"
                    >
                      <span className="inline-flex items-center gap-1 font-display text-sm text-neon-cyan dir-ltr">
                        <GramIcon className="h-4 w-4" />
                        {fmt2(l.stake)}
                      </span>
                      <GameButton
                        accent="pink"
                        className="text-[11px]"
                        disabled={!canAfford}
                        onClick={() => {
                          haptic.impact('medium');
                          void joinLobby(l.id);
                        }}
                      >
                        {t('raid.join')}
                      </GameButton>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
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
              {t('raid.topByPower')}
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
              {t('raid.topByXp')}
            </button>
          </div>

          {leaderboard.length === 0 && mode !== 'live' ? (
            <div className="rounded-2xl border-2 border-dashed border-white/20 bg-farm-card/40 py-10 text-center text-xs text-white/45">
              {t('raid.onlineOnly')}
            </div>
          ) : (
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
                    <div className="inline-flex items-center gap-0.5 text-[10px] font-bold text-neon-yellow dir-ltr">
                      <Star className="h-3 w-3 fill-neon-yellow" strokeWidth={2.5} />
                      {formatNum(r.xp)} XP
                    </div>
                  </div>
                  <span className="inline-flex flex-none items-center gap-1 font-display text-sm text-neon-cyan text-stroke-sm dir-ltr">
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
          )}
        </>
      )}

      <BattleModal />
    </div>
  );
}
