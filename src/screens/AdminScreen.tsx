import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Ban, Check, Copy, Crown, ExternalLink, Search, ShieldCheck, X } from 'lucide-react';
import { useGameStore } from '../store/useGameStore';
import {
  adminFetchMetrics,
  adminFindUser,
  adminGetAmbassadorStats,
  adminGrantAmbassadorDeposit,
  adminListAmbassadorApplications,
  adminListAmbassadorPosts,
  adminListWithdrawals,
  adminSetAmbassadorApplicationStatus,
  adminSetAmbassadorPostStatus,
  adminUserDetail,
} from '../services/api';
import type { AdminMetrics, AdminUserDetail, AdminUserRow, WithdrawalRequest } from '../types/admin';
import type {
  AdminAmbassadorApplication,
  AdminAmbassadorPost,
  AmbassadorStatRow,
} from '../types/ambassador';
import { EMISSION_FACTORS } from '../types/admin';
import { fmtDateTime, fmtGram } from '../lib/format';
import { haptic } from '../lib/haptics';
import { GameButton } from '../components/ui/GameButton';
import { GramIcon } from '../components/icons/Icons';

type Tab = 'queue' | 'economy' | 'users' | 'amb_apps' | 'amb_posts' | 'amb_stats';

export function AdminScreen() {
  const setAdminOpen = useGameStore((s) => s.setAdminOpen);
  const [tab, setTab] = useState<Tab>('queue');

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="fixed inset-0 z-40 flex flex-col bg-farm-deep"
    >
      <header className="safe-t flex items-center justify-between border-b-2 border-black bg-farm-bg px-4 pb-3">
        <h1 className="inline-flex items-center gap-2 font-display text-xl text-stroke">
          <Crown className="h-5 w-5 text-neon-yellow" strokeWidth={3} />
          Адмін-панель
        </h1>
        <button
          onClick={() => {
            haptic.select();
            setAdminOpen(false);
          }}
          className="grid h-9 w-9 place-items-center rounded-xl border-2 border-black bg-farm-card text-white/70 active:translate-y-0.5"
        >
          <X className="h-4 w-4" strokeWidth={3} />
        </button>
      </header>

      <div className="flex gap-1.5 overflow-x-auto border-b-2 border-black bg-farm-bg px-3 py-2">
        <TabBtn active={tab === 'queue'} onClick={() => setTab('queue')}>
          Виводи
        </TabBtn>
        <TabBtn active={tab === 'economy'} onClick={() => setTab('economy')}>
          Метрики
        </TabBtn>
        <TabBtn active={tab === 'users'} onClick={() => setTab('users')}>
          Юзери
        </TabBtn>
        <TabBtn active={tab === 'amb_apps'} onClick={() => setTab('amb_apps')}>
          Амб · Заявки
        </TabBtn>
        <TabBtn active={tab === 'amb_posts'} onClick={() => setTab('amb_posts')}>
          Амб · Пости
        </TabBtn>
        <TabBtn active={tab === 'amb_stats'} onClick={() => setTab('amb_stats')}>
          Амб · Аналітика
        </TabBtn>
      </div>

      <div className="safe-b flex-1 overflow-y-auto px-4 py-4">
        {tab === 'queue' && <QueueTab />}
        {tab === 'economy' && <EconomyTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'amb_apps' && <AmbAppsTab />}
        {tab === 'amb_posts' && <AmbPostsTab />}
        {tab === 'amb_stats' && <AmbStatsTab />}
      </div>
    </motion.div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={() => {
        haptic.select();
        onClick();
      }}
      className={[
        'flex-none whitespace-nowrap rounded-xl border-2 border-b-4 border-black px-2.5 py-1.5 text-[11px] font-extrabold uppercase',
        active ? 'border-b-black/40 bg-neon-yellow text-black' : 'border-b-black/40 bg-farm-card text-white/50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

// ============ TAB 1 — WITHDRAWALS QUEUE ============

const STATUS_TONE: Record<string, string> = {
  PENDING: 'text-neon-yellow',
  AUTO_PENDING: 'text-neon-cyan',
  APPROVED: 'text-neon-cyan',
  PROCESSING: 'text-neon-lime',
};

function QueueTab() {
  const approve = useGameStore((s) => s.adminApproveWithdrawal);
  const reject = useGameStore((s) => s.adminRejectWithdrawal);
  const triggerPayout = useGameStore((s) => s.adminTriggerPayout);

  const [rows, setRows] = useState<WithdrawalRequest[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [hashFor, setHashFor] = useState<string | null>(null);
  const [hash, setHash] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setRows(await adminListWithdrawals());
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const doApprove = async (txId: string) => {
    setBusy(txId);
    try {
      await approve(txId, hash.trim());
      haptic.notify('success');
      setHashFor(null);
      setHash('');
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(null);
    }
  };

  // no hash → hand the payout to ton-payout-worker
  const doApproveAuto = async (txId: string) => {
    setBusy(txId);
    try {
      await approve(txId, '');
      await triggerPayout();
      haptic.notify('success');
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(null);
    }
  };

  const kickWorker = async (txId: string) => {
    setBusy(txId);
    try {
      await triggerPayout();
      haptic.notify('success');
      await load();
    } finally {
      setBusy(null);
    }
  };

  const doReject = async (txId: string) => {
    setBusy(txId);
    try {
      await reject(txId);
      haptic.notify('success');
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(null);
    }
  };

  const copy = (addr: string, id: string) => {
    haptic.select();
    navigator.clipboard?.writeText(addr).catch(() => {});
    setCopied(id);
    window.setTimeout(() => setCopied(null), 1200);
  };

  if (rows === null) return <Loading />;

  return (
    <div className="space-y-3">
      {err && <ErrBox msg={err} />}
      {rows.length === 0 ? (
        <Empty text="Немає заявок на виведення" />
      ) : (
        rows.map((r) => (
          <div
            key={r.txId}
            className="relative overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/80 p-3"
          >
            <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">
                  {r.username ? `@${r.username}` : r.firstName ?? 'anon'}
                </div>
                <div className="text-[10px] text-white/40">
                  {r.userId.slice(0, 8)}… · reg {fmtDateTime(r.registeredAt)}
                </div>
              </div>
              <div className="text-right text-[11px] font-bold text-white/60">
                <span className={STATUS_TONE[r.status] ?? 'text-white/50'}>{r.status}</span>
                <div className="inline-flex items-center gap-0.5 text-neon-cyan">
                  <GramIcon className="h-3 w-3" />
                  {fmtGram(r.balanceGram, 3)}
                </div>
              </div>
            </div>

            <div className="relative mt-2 grid grid-cols-3 gap-1 rounded-xl border-2 border-black bg-farm-deep p-2 text-center text-[11px]">
              <Stat label="Сума" value={fmtGram(r.amount, 3)} />
              <Stat label="Комісія" value={fmtGram(r.fee, 3)} tone="text-neon-pink" />
              <Stat label="До виплати" value={fmtGram(r.netAmount, 3)} tone="text-neon-lime" />
            </div>

            <button
              onClick={() => r.walletAddress && copy(r.walletAddress, r.txId)}
              className="relative mt-2 flex w-full items-center gap-2 rounded-lg border-2 border-black bg-farm-deep px-2 py-1.5 text-left text-[11px] text-white/60"
            >
              <span className="flex-1 truncate">{r.walletAddress ?? '—'}</span>
              {copied === r.txId ? (
                <Check className="h-3.5 w-3.5 flex-none text-neon-lime" strokeWidth={3} />
              ) : (
                <Copy className="h-3.5 w-3.5 flex-none" strokeWidth={3} />
              )}
            </button>

            {r.status !== 'PENDING' ? (
              <div className="relative mt-2 flex items-center gap-2">
                <span className="flex-1 text-[11px] font-bold text-white/50">
                  {r.status === 'PROCESSING' ? 'Відправляється воркером…' : 'У черзі на авто-виплату'}
                </span>
                {r.status !== 'PROCESSING' && (
                  <GameButton accent="cyan" className="text-[11px]" disabled={busy === r.txId} onClick={() => kickWorker(r.txId)}>
                    Штовхнути воркер
                  </GameButton>
                )}
              </div>
            ) : hashFor === r.txId ? (
              <div className="relative mt-2 space-y-2">
                <input
                  value={hash}
                  onChange={(e) => setHash(e.target.value)}
                  placeholder="Tx Hash (ручна відправка)"
                  className="w-full rounded-lg border-2 border-black bg-farm-deep px-2 py-1.5 text-xs text-white outline-none placeholder:text-white/30"
                />
                <div className="flex gap-2">
                  <GameButton accent="lime" block disabled={busy === r.txId} onClick={() => doApprove(r.txId)}>
                    Позначити виплаченим
                  </GameButton>
                  <GameButton
                    accent="cyan"
                    onClick={() => {
                      setHashFor(null);
                      setHash('');
                    }}
                  >
                    Скасувати
                  </GameButton>
                </div>
              </div>
            ) : (
              <div className="relative mt-2 space-y-1.5">
                <div className="flex gap-2">
                  <GameButton accent="lime" block disabled={busy === r.txId} onClick={() => doApproveAuto(r.txId)}>
                    Схвалити
                  </GameButton>
                  <GameButton accent="pink" block disabled={busy === r.txId} onClick={() => doReject(r.txId)}>
                    Відхилити
                  </GameButton>
                </div>
                <button
                  onClick={() => setHashFor(r.txId)}
                  className="text-[10px] font-bold text-white/40 underline"
                >
                  ввести хеш вручну
                </button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ============ TAB 2 — ECONOMY / TREASURY ============

function EconomyTab() {
  const setFactor = useGameStore((s) => s.adminSetEmissionFactor);
  const getSettings = useGameStore((s) => s.adminGetSettings);
  const toggleAuto = useGameStore((s) => s.adminToggleAutoWithdraw);
  const [m, setM] = useState<AdminMetrics | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [auto, setAuto] = useState(false);
  const [limit, setLimit] = useState('5');
  const [payoutBusy, setPayoutBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setM(await adminFetchMetrics());
      const cfg = await getSettings();
      setAuto(cfg.autoWithdraw);
      setLimit(String(cfg.maxInstantLimit));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }, [getSettings]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePayout = async (nextAuto: boolean) => {
    setPayoutBusy(true);
    try {
      const lim = Math.max(0, parseFloat(limit.replace(',', '.')) || 0);
      const cfg = await toggleAuto(nextAuto, lim);
      setAuto(cfg.autoWithdraw);
      setLimit(String(cfg.maxInstantLimit));
      haptic.notify('success');
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setPayoutBusy(false);
    }
  };

  const apply = async (f: number) => {
    setBusy(true);
    try {
      await setFactor(f);
      haptic.notify('success');
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(false);
    }
  };

  if (!m && !err) return <Loading />;

  return (
    <div className="space-y-4">
      {err && <ErrBox msg={err} />}
      {m && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <BigStat label="Обов'язання (Σ balances)" value={`${fmtGram(m.totalBalances)} GRAM`} tone="text-neon-cyan" />
            <BigStat label="Користувачів" value={String(m.userCount)} tone="text-neon-lime" />
            <BigStat label="Виведено 24 год" value={`${fmtGram(m.withdrawn24h)} GRAM`} tone="text-neon-yellow" />
            <BigStat label="Виведено 7 днів" value={`${fmtGram(m.withdrawn7d)} GRAM`} tone="text-neon-yellow" />
            <BigStat
              label="У черзі"
              value={`${m.pendingCount} · ${fmtGram(m.pendingSum)}`}
              tone="text-neon-pink"
            />
            <BigStat label="Emission Factor" value={m.emissionFactor.toFixed(2)} tone="text-neon-lime" />
          </div>

          <div className="rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/80 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/50">
              Emission Factor (доходність ферми)
            </div>
            <div className="grid grid-cols-4 gap-2">
              {EMISSION_FACTORS.map((f) => {
                const on = Math.abs(m.emissionFactor - f) < 0.001;
                return (
                  <button
                    key={f}
                    disabled={busy}
                    onClick={() => apply(f)}
                    className={[
                      'rounded-xl border-2 border-b-4 border-black py-2 font-display text-sm active:translate-y-0.5',
                      on ? 'border-b-black/40 bg-neon-lime text-black' : 'border-b-black/40 bg-farm-deep text-white/60',
                    ].join(' ')}
                  >
                    {f.toFixed(1)}
                  </button>
                );
              })}
            </div>
            <div className="mt-1.5 text-[10px] text-white/40">
              Застосовується до всіх ферм миттєво + до нових акаунтів.
            </div>
          </div>

          {/* ⚡ Режим виплат */}
          <div className="rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/80 p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-white/50">
              ⚡ Режим виплат
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                disabled={payoutBusy}
                onClick={() => savePayout(true)}
                className={[
                  'rounded-xl border-2 border-b-4 border-black py-2 text-[11px] font-extrabold uppercase active:translate-y-0.5',
                  auto ? 'border-b-black/40 bg-neon-lime text-black' : 'border-b-black/40 bg-farm-deep text-white/60',
                ].join(' ')}
              >
                Автоматичні виплати
              </button>
              <button
                disabled={payoutBusy}
                onClick={() => savePayout(false)}
                className={[
                  'rounded-xl border-2 border-b-4 border-black py-2 text-[11px] font-extrabold uppercase active:translate-y-0.5',
                  !auto ? 'border-b-black/40 bg-neon-yellow text-black' : 'border-b-black/40 bg-farm-deep text-white/60',
                ].join(' ')}
              >
                Ручне підтвердження
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-white/50">Ліміт без підтвердження</span>
              <input
                inputMode="decimal"
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="w-20 rounded-lg border-2 border-black bg-farm-deep px-2 py-1 text-right text-xs text-white outline-none"
              />
              <span className="text-[11px] text-white/50">GRAM</span>
              <GameButton accent="cyan" className="ml-auto text-[11px]" disabled={payoutBusy} onClick={() => savePayout(auto)}>
                Зберегти
              </GameButton>
            </div>
            <div className="mt-1.5 text-[10px] text-white/40">
              Авто: виплати ≤ ліміту йдуть у чергу воркера без ручного підтвердження.
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ============ TAB 3 — USERS ============

function UsersTab() {
  const setBanned = useGameStore((s) => s.adminSetBanned);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<AdminUserRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setErr(null);
    setDetail(null);
    setOpenId(null);
    try {
      setRows(await adminFindUser(q.trim()));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setRows([]);
    }
  };

  const openDetail = async (id: string) => {
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetail(null);
    try {
      setDetail(await adminUserDetail(id));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  };

  const toggleBan = async (id: string, next: boolean) => {
    setBusy(true);
    try {
      await setBanned(id, next);
      haptic.notify('success');
      setRows((rs) => rs?.map((r) => (r.userId === id ? { ...r, isBanned: next } : r)) ?? rs);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-xl border-2 border-black bg-farm-deep px-2">
          <Search className="h-4 w-4 flex-none text-white/40" strokeWidth={3} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && search()}
            placeholder="Telegram ID / @username"
            className="w-full bg-transparent py-2 text-sm text-white outline-none placeholder:text-white/30"
          />
        </div>
        <GameButton accent="yellow" onClick={search}>
          Пошук
        </GameButton>
      </div>

      {err && <ErrBox msg={err} />}
      {rows !== null && rows.length === 0 && <Empty text="Нічого не знайдено" />}

      {rows?.map((u) => (
        <div
          key={u.userId}
          className="overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/80"
        >
          <button onClick={() => openDetail(u.userId)} className="flex w-full items-center gap-2 p-3 text-left">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-bold">
                  {u.username ? `@${u.username}` : u.firstName ?? 'anon'}
                </span>
                {u.isAdmin && <Crown className="h-3.5 w-3.5 flex-none text-neon-yellow" strokeWidth={3} />}
                {u.isBanned && (
                  <span className="rounded border border-black bg-neon-pink px-1 text-[8px] font-extrabold uppercase text-white">
                    ban
                  </span>
                )}
              </div>
              <div className="text-[10px] text-white/40">
                TG {u.telegramId ?? '—'} · L1×{u.referralL1} · reg {fmtDateTime(u.registeredAt)}
              </div>
            </div>
            <div className="flex-none text-right text-[11px] font-bold text-neon-cyan">
              {fmtGram(u.balanceGram, 3)}
            </div>
          </button>

          {openId === u.userId && (
            <div className="border-t-2 border-black bg-farm-deep p-3">
              <div className="mb-2 flex gap-2">
                <GameButton
                  accent={u.isBanned ? 'lime' : 'pink'}
                  disabled={busy}
                  onClick={() => toggleBan(u.userId, !u.isBanned)}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {u.isBanned ? (
                      <ShieldCheck className="h-4 w-4" strokeWidth={3} />
                    ) : (
                      <Ban className="h-4 w-4" strokeWidth={3} />
                    )}
                    {u.isBanned ? 'Розблокувати' : 'Заблокувати'}
                  </span>
                </GameButton>
              </div>

              {!detail ? (
                <Loading />
              ) : (
                <div className="space-y-2 text-[11px]">
                  <div className="font-bold uppercase text-white/45">
                    Реферали ({detail.referrals.length})
                  </div>
                  {detail.referrals.length === 0 ? (
                    <div className="text-white/30">—</div>
                  ) : (
                    detail.referrals.slice(0, 8).map((r, i) => (
                      <div key={i} className="flex justify-between text-white/60">
                        <span>
                          L{r.tier} · {r.referee ? `@${r.referee}` : 'anon'}
                        </span>
                        <span className="text-neon-lime">{fmtGram(r.earned, 3)}</span>
                      </div>
                    ))
                  )}
                  <div className="pt-1 font-bold uppercase text-white/45">
                    Транзакції ({detail.transactions.length})
                  </div>
                  {detail.transactions.slice(0, 12).map((t, i) => (
                    <div key={i} className="flex justify-between text-white/60">
                      <span>
                        {t.type} · {t.status}
                      </span>
                      <span>{fmtGram(t.amount, 3)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ============ TAB 4 — AMBASSADOR APPLICATIONS ============

function AmbAppsTab() {
  const [rows, setRows] = useState<AdminAmbassadorApplication[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [grant, setGrant] = useState<Record<string, string>>({});
  const [granted, setGranted] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setRows(await adminListAmbassadorApplications());
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setBusy(id);
    try {
      await adminSetAmbassadorApplicationStatus(id, status);
      haptic.notify('success');
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(null);
    }
  };

  const grantDeposit = async (userId: string) => {
    const amt = parseFloat((grant[userId] ?? '').replace(',', '.'));
    if (!Number.isFinite(amt) || amt <= 0) return;
    setBusy(userId);
    try {
      await adminGrantAmbassadorDeposit(userId, amt);
      haptic.notify('success');
      setGrant((g) => ({ ...g, [userId]: '' }));
      setGranted(userId);
      window.setTimeout(() => setGranted(null), 1600);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(null);
    }
  };

  if (rows === null) return <Loading />;

  return (
    <div className="space-y-3">
      {err && <ErrBox msg={err} />}
      {rows.length === 0 ? (
        <Empty text="Немає заявок амбасадорів" />
      ) : (
        rows.map((r) => (
          <div
            key={r.id}
            className="relative overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/80 p-3"
          >
            <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">
                  {r.username ? `@${r.username}` : r.firstName ?? 'anon'}
                </div>
                <div className="text-[10px] text-white/40">
                  TG {r.telegramId ?? '—'} · {fmtGram(r.balanceGram, 3)} GRAM · {fmtDateTime(r.createdAt)}
                </div>
              </div>
              <span
                className={[
                  'flex-none rounded border-2 border-black px-1 text-[8px] font-extrabold uppercase',
                  r.status === 'APPROVED'
                    ? 'bg-neon-lime text-black'
                    : r.status === 'REJECTED'
                      ? 'bg-neon-pink text-white'
                      : 'bg-neon-yellow text-black',
                ].join(' ')}
              >
                {r.status}
              </span>
            </div>

            <div className="relative mt-2 rounded-xl border-2 border-black bg-farm-deep p-2 text-[11px] text-white/70">
              <a
                href={r.channelLink.startsWith('http') ? r.channelLink : undefined}
                target="_blank"
                rel="noreferrer"
                className="dir-ltr block break-all font-mono text-neon-cyan"
              >
                {r.channelLink}
              </a>
              <div className="mt-1 text-white/40">звʼязок: {r.contactUsername}</div>
            </div>

            {r.status === 'PENDING' && (
              <div className="relative mt-2 flex gap-2">
                <GameButton accent="lime" block disabled={busy === r.id} onClick={() => review(r.id, 'APPROVED')}>
                  Схвалити
                </GameButton>
                <GameButton accent="pink" block disabled={busy === r.id} onClick={() => review(r.id, 'REJECTED')}>
                  Відхилити
                </GameButton>
              </div>
            )}

            <div className="relative mt-2 flex items-center gap-2">
              <input
                inputMode="decimal"
                value={grant[r.userId] ?? ''}
                onChange={(e) => setGrant((g) => ({ ...g, [r.userId]: e.target.value }))}
                placeholder="GRAM"
                className="w-20 rounded-lg border-2 border-black bg-farm-deep px-2 py-1 text-right text-xs text-white outline-none"
              />
              <GameButton
                accent={granted === r.userId ? 'lime' : 'cyan'}
                className="ml-auto text-[11px]"
                disabled={busy === r.userId}
                onClick={() => grantDeposit(r.userId)}
              >
                {granted === r.userId ? 'Нараховано' : 'Видати рекламний депозит'}
              </GameButton>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ============ TAB 5 — AMBASSADOR POST REPORTS ============

function AmbPostsTab() {
  const [rows, setRows] = useState<AdminAmbassadorPost[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setRows(await adminListAmbassadorPosts());
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const review = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setBusy(id);
    try {
      await adminSetAmbassadorPostStatus(id, status);
      haptic.notify('success');
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(null);
    }
  };

  if (rows === null) return <Loading />;

  return (
    <div className="space-y-3">
      {err && <ErrBox msg={err} />}
      {rows.length === 0 ? (
        <Empty text="Немає звітів про пости" />
      ) : (
        rows.map((r) => (
          <div
            key={r.id}
            className="relative overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/80 p-3"
          >
            <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
            <div className="relative flex items-start justify-between gap-2">
              <div className="min-w-0 text-sm font-bold">
                {r.username ? `@${r.username}` : r.firstName ?? 'anon'}
              </div>
              <span
                className={[
                  'flex-none rounded border-2 border-black px-1 text-[8px] font-extrabold uppercase',
                  r.status === 'APPROVED'
                    ? 'bg-neon-lime text-black'
                    : r.status === 'REJECTED'
                      ? 'bg-neon-pink text-white'
                      : 'bg-neon-yellow text-black',
                ].join(' ')}
              >
                {r.status}
              </span>
            </div>

            <a
              href={r.postLink}
              target="_blank"
              rel="noreferrer"
              className="relative mt-2 flex items-center gap-1.5 rounded-lg border-2 border-black bg-farm-deep px-2 py-1.5 text-[11px] text-neon-cyan"
            >
              <span className="dir-ltr flex-1 truncate font-mono">{r.postLink}</span>
              <ExternalLink className="h-3.5 w-3.5 flex-none" strokeWidth={3} />
            </a>
            <div className="relative mt-1 text-[10px] text-white/40">{fmtDateTime(r.createdAt)}</div>

            {r.status === 'PENDING' && (
              <div className="relative mt-2 flex gap-2">
                <GameButton accent="lime" block disabled={busy === r.id} onClick={() => review(r.id, 'APPROVED')}>
                  Зарахувати пост
                </GameButton>
                <GameButton accent="pink" block disabled={busy === r.id} onClick={() => review(r.id, 'REJECTED')}>
                  Відхилити
                </GameButton>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ============ TAB 6 — AMBASSADOR ANALYTICS ============

function AmbStatsTab() {
  const [rows, setRows] = useState<AmbassadorStatRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setRows(await adminGetAmbassadorStats());
      } catch (e) {
        setErr(String((e as Error).message ?? e));
        setRows([]);
      }
    })();
  }, []);

  if (rows === null) return <Loading />;

  return (
    <div className="space-y-3">
      {err && <ErrBox msg={err} />}
      {rows.length === 0 ? (
        <Empty text="Немає схвалених амбасадорів" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr className="text-left text-[9px] font-extrabold uppercase text-white/40">
                <th className="py-1 pr-2">Амбасадор</th>
                <th className="px-2">Канал</th>
                <th className="px-2 text-center">L1/L2/L3</th>
                <th className="pl-2 text-right">Депозити L1/L2/L3</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className="border-t-2 border-black/30 align-top">
                  <td className="py-1.5 pr-2 font-bold">
                    {r.username ? `@${r.username}` : r.userId.slice(0, 6)}
                  </td>
                  <td className="dir-ltr px-2 font-mono text-neon-cyan">
                    <span className="block max-w-[120px] truncate">{r.channelLink}</span>
                  </td>
                  <td className="px-2 text-center font-mono text-white/80">
                    {r.l1Count}/{r.l2Count}/{r.l3Count}
                  </td>
                  <td className="dir-ltr pl-2 text-right font-mono text-neon-lime">
                    {fmtGram(r.l1DepositTotal, 2)}/{fmtGram(r.l2DepositTotal, 2)}/{fmtGram(r.l3DepositTotal, 2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ shared bits ============

function Loading() {
  return <div className="py-10 text-center text-xs text-white/40">Завантаження…</div>;
}
function Empty({ text }: { text: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border-2 border-dashed border-white/20 bg-farm-card/40 py-10 text-center text-xs text-white/45">
      {text}
    </div>
  );
}
function ErrBox({ msg }: { msg: string }) {
  return (
    <div className="rounded-xl border-2 border-neon-pink bg-neon-pink/10 px-3 py-2 text-[11px] font-bold text-neon-pink">
      {msg}
    </div>
  );
}
function Stat({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] font-extrabold uppercase tracking-wide text-white/40">{label}</div>
      <div className={`font-display text-stroke-sm ${tone}`}>{value}</div>
    </div>
  );
}
function BigStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-2xl border-2 border-black bg-farm-card/70 p-2.5">
      <div className={`font-display text-base leading-tight text-stroke-sm ${tone}`}>{value}</div>
      <div className="mt-0.5 text-[9px] font-extrabold uppercase tracking-wide text-white/40">{label}</div>
    </div>
  );
}
