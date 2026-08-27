import { useMemo, useState, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { CHAIN, useTonAddress, useTonConnectUI, useTonWallet } from '@tonconnect/ui-react';
import { ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Copy, Loader2, LogOut, Wallet, XCircle } from 'lucide-react';
import { useGameStore, selectPendingGram, selectTotalEarned } from '../store/useGameStore';
import { CREDIT_TYPES, type Transaction, type TransactionStatus } from '../types/finance';
import { fmtDateTime, fmtGram, shortAddress } from '../lib/format';
import { haptic } from '../lib/haptics';
import { GameButton } from '../components/ui/GameButton';
import { GramIcon } from '../components/icons/Icons';
import { DepositModal } from '../components/wallet/DepositModal';
import { WithdrawModal } from '../components/wallet/WithdrawModal';

const TX_LABEL: Record<string, string> = {
  DEPOSIT: 'Депозит',
  WITHDRAW: 'Вивід',
  FARM_CLAIM: 'Збір з ферми',
  TIER_ROLL: 'Ролл тіру',
  STUDY_FEE: 'Навчання',
  MERGE_FEE: 'Злиття',
  SLOT_UNLOCK: 'Слот',
  REFERRAL_REWARD: 'Реферал',
  STREAK_REWARD: 'Стрік',
  QUEST_REWARD: 'Завдання',
};

type Tab = 'history' | 'pending';

export function WalletScreen() {
  const [tonConnectUI] = useTonConnectUI();
  const wallet = useTonWallet();
  const address = useTonAddress(); // user-friendly, '' when disconnected
  const isTestnet = wallet?.account.chain === CHAIN.TESTNET;

  const balanceGram = useGameStore((s) => s.balanceGram);
  const transactions = useGameStore((s) => s.transactions);
  const totalEarned = useGameStore(selectTotalEarned);
  const pendingGram = useGameStore(selectPendingGram);

  const [tab, setTab] = useState<Tab>('history');
  const [modal, setModal] = useState<null | 'deposit' | 'withdraw'>(null);
  const [copied, setCopied] = useState(false);

  const { history, pending } = useMemo(
    () => ({
      history: transactions.filter((t) => t.status !== 'PENDING'),
      pending: transactions.filter((t) => t.status === 'PENDING'),
    }),
    [transactions],
  );

  const copy = () => {
    if (!address) return;
    haptic.select();
    navigator.clipboard?.writeText(address).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const list = tab === 'history' ? history : pending;

  return (
    <div className="space-y-5">
      {/* ============ WALLET HEADER ============ */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-cyan border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />

        {!address ? (
          <div className="relative">
            <div className="mb-3 flex items-center gap-2 text-sm font-bold text-white/70">
              <Wallet className="h-5 w-5 text-neon-cyan" strokeWidth={2.5} />
              Гаманець не підключено
            </div>
            <GameButton accent="cyan" block onClick={() => tonConnectUI.openModal()}>
              Підключити гаманець
            </GameButton>
          </div>
        ) : (
          <div className="relative">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-xl border-2 border-black bg-neon-cyan text-black">
                  <Wallet className="h-4 w-4" strokeWidth={3} />
                </span>
                <div>
                  <div className="font-display text-lg leading-none text-stroke-sm">
                    {shortAddress(address, 4, 3)}
                  </div>
                  <span
                    className={`text-[10px] font-extrabold uppercase ${
                      isTestnet ? 'text-neon-pink' : 'text-neon-lime'
                    }`}
                  >
                    {isTestnet ? 'Testnet' : 'Mainnet'}
                  </span>
                </div>
              </div>
              <button
                onClick={copy}
                className="grid h-9 w-9 place-items-center rounded-xl border-2 border-black bg-farm-deep text-white/70 active:translate-y-0.5"
              >
                {copied ? (
                  <CheckCircle2 className="h-4 w-4 text-neon-lime" strokeWidth={3} />
                ) : (
                  <Copy className="h-4 w-4" strokeWidth={3} />
                )}
              </button>
            </div>

            <button
              onClick={() => {
                haptic.impact('medium');
                tonConnectUI.disconnect();
              }}
              className="mt-3 inline-flex items-center gap-1.5 rounded-xl border-2 border-black bg-farm-deep px-3 py-1.5 text-xs font-extrabold uppercase text-neon-pink active:translate-y-0.5"
            >
              <LogOut className="h-3.5 w-3.5" strokeWidth={3} />
              Відключити
            </button>
          </div>
        )}
      </div>

      {/* ============ BALANCES ============ */}
      <div className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-black border-b-black/50 bg-farm-card/80 p-3 backdrop-blur-md">
        <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
        <div className="relative grid grid-cols-3 gap-2 text-center">
          <BalanceCell label="Доступно" value={fmtGram(balanceGram)} tone="text-neon-lime" big />
          <BalanceCell label="В обробці" value={fmtGram(pendingGram)} tone="text-neon-yellow" />
          <BalanceCell label="Зароблено" value={fmtGram(totalEarned, 3)} tone="text-neon-cyan" />
        </div>
      </div>

      {/* ============ ACTIONS ============ */}
      <div className="grid grid-cols-2 gap-2">
        <GameButton accent="lime" block onClick={() => setModal('deposit')}>
          <span className="inline-flex items-center gap-1.5">
            <ArrowDownToLine className="h-4 w-4" strokeWidth={3} />
            Депозит
          </span>
        </GameButton>
        <GameButton accent="cyan" block onClick={() => setModal('withdraw')}>
          <span className="inline-flex items-center gap-1.5">
            <ArrowUpFromLine className="h-4 w-4" strokeWidth={3} />
            Вивести
          </span>
        </GameButton>
      </div>

      {/* ============ HISTORY TABS ============ */}
      <section>
        <div className="mb-3 flex gap-2">
          <TabButton active={tab === 'history'} onClick={() => setTab('history')}>
            Історія транзакцій
          </TabButton>
          <TabButton active={tab === 'pending'} onClick={() => setTab('pending')}>
            Підтвердження {pending.length > 0 && `(${pending.length})`}
          </TabButton>
        </div>

        {list.length === 0 ? (
          <div className="grid place-items-center rounded-3xl border-2 border-dashed border-white/20 bg-farm-card/40 py-10 text-center text-xs text-white/45">
            {tab === 'history' ? 'Ще немає завершених транзакцій' : 'Немає транзакцій в обробці'}
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((tx, i) => (
              <TxCard key={tx.id} tx={tx} index={i} />
            ))}
          </ul>
        )}
      </section>

      <DepositModal open={modal === 'deposit'} onClose={() => setModal(null)} />
      <WithdrawModal open={modal === 'withdraw'} onClose={() => setModal(null)} />
    </div>
  );
}

function BalanceCell({
  label,
  value,
  tone,
  big = false,
}: {
  label: string;
  value: string;
  tone: string;
  big?: boolean;
}) {
  return (
    <div className="relative rounded-2xl border-2 border-black bg-farm-deep px-1 py-2">
      <div className="text-[9px] font-extrabold uppercase tracking-wide text-white/40">{label}</div>
      <div
        className={`mt-0.5 flex items-center justify-center gap-1 font-display text-stroke-sm ${tone} ${
          big ? 'text-lg' : 'text-sm'
        }`}
      >
        <GramIcon className="h-3.5 w-3.5" />
        {value}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={() => {
        haptic.select();
        onClick();
      }}
      className={[
        'flex-1 rounded-2xl border-2 border-b-4 border-black px-2 py-2 text-[11px] font-extrabold uppercase leading-tight',
        active ? 'border-b-black/40 bg-neon-lime text-black' : 'border-b-black/40 bg-farm-card text-white/50',
      ].join(' ')}
    >
      {children}
    </button>
  );
}

const STATUS_ICON: Record<TransactionStatus, typeof CheckCircle2> = {
  COMPLETED: CheckCircle2,
  PENDING: Loader2,
  FAILED: XCircle,
};

function TxCard({ tx, index }: { tx: Transaction; index: number }) {
  const credit = CREDIT_TYPES.has(tx.type);
  const Icon = STATUS_ICON[tx.status];
  const mins = Math.max(1, Math.round((Date.now() - tx.timestamp) / 60000));

  return (
    <motion.li
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04 }}
      className="relative overflow-hidden rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/70 px-3 py-2.5 backdrop-blur-md"
    >
      <div className="pointer-events-none absolute inset-0 bg-stripes opacity-40" />
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon
            className={[
              'h-5 w-5 flex-none',
              tx.status === 'COMPLETED'
                ? 'text-neon-lime'
                : tx.status === 'FAILED'
                  ? 'text-neon-pink'
                  : 'animate-spin text-neon-yellow',
            ].join(' ')}
            strokeWidth={2.6}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-display text-sm uppercase text-stroke-sm">
                {TX_LABEL[tx.type] ?? tx.type}
              </span>
              {tx.status === 'PENDING' && (
                <span className="rounded-md border-2 border-black bg-neon-yellow px-1 text-[8px] font-extrabold uppercase leading-4 text-black">
                  Обробляється
                </span>
              )}
            </div>
            <div className="truncate text-[10px] text-white/40">
              {tx.status === 'PENDING'
                ? `перевірка · ${mins} хв`
                : fmtDateTime(tx.timestamp)}
              {tx.type === 'WITHDRAW' && tx.netAmount != null && tx.fee != null && (
                <> · чисті {fmtGram(tx.netAmount)} (−{fmtGram(tx.fee)})</>
              )}
            </div>
          </div>
        </div>
        <div
          className={`flex-none font-display text-sm ${credit ? 'text-neon-lime' : 'text-neon-pink'}`}
        >
          {credit ? '+' : '−'}
          {fmtGram(tx.amount, 3)}
        </div>
      </div>
    </motion.li>
  );
}
