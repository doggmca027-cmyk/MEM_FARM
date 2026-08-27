import { useEffect, useState } from 'react';
import { useTonAddress } from '@tonconnect/ui-react';
import { ArrowUpFromLine } from 'lucide-react';
import {
  WITHDRAW_COOLDOWN_MS,
  WITHDRAW_MIN,
  useGameStore,
  withdrawalFee,
} from '../../store/useGameStore';
import { fmtGram, fmtHMS } from '../../lib/format';
import { firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';
import { Modal } from '../ui/Modal';
import { GameButton } from '../ui/GameButton';
import { GramIcon } from '../icons/Icons';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WithdrawModal({ open, onClose }: Props) {
  const connected = useTonAddress();
  const balanceGram = useGameStore((s) => s.balanceGram);
  const lastWithdrawAt = useGameStore((s) => s.lastWithdrawAt);
  const requestWithdrawal = useGameStore((s) => s.requestWithdrawal);

  const [address, setAddress] = useState('');
  const [raw, setRaw] = useState('');
  const [now, setNow] = useState(() => Date.now());

  // prefill / refresh the address field when the sheet opens
  useEffect(() => {
    if (open) setAddress((cur) => cur || connected);
  }, [open, connected]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const amount = parseFloat(raw.replace(',', '.'));
  const amountValid = Number.isFinite(amount) && amount > 0;
  const fee = amountValid ? withdrawalFee(amount) : 0;
  const net = amountValid ? Math.max(0, +(amount - fee).toFixed(4)) : 0;

  const cooldownLeft =
    lastWithdrawAt != null ? Math.max(0, lastWithdrawAt + WITHDRAW_COOLDOWN_MS - now) : 0;

  let error: string | null = null;
  if (raw && !amountValid) error = 'Некоректна сума';
  else if (amountValid && amount < WITHDRAW_MIN) error = `Мінімум ${fmtGram(WITHDRAW_MIN)} GRAM`;
  else if (amountValid && amount > balanceGram) error = 'Недостатньо коштів';
  else if (address.trim().length < 40) error = 'Вкажіть коректну адресу гаманця';
  else if (cooldownLeft > 0) error = `Наступний вивід через ${fmtHMS(cooldownLeft)}`;

  const canSubmit = amountValid && !error;

  const onConfirm = () => {
    if (!canSubmit) return;
    requestWithdrawal(amount, address.trim());
    haptic.notify('success');
    firePop();
    setRaw('');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      accent="#06B6D4"
      title={
        <span className="inline-flex items-center gap-2">
          <ArrowUpFromLine className="h-5 w-5 text-neon-cyan" strokeWidth={2.5} />
          Вивід GRAM
        </span>
      }
    >
      <label className="block text-[11px] font-bold uppercase tracking-wide text-white/45">
        Адреса гаманця
      </label>
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="UQ… / EQ…"
        spellCheck={false}
        className="mt-1 w-full rounded-2xl border-2 border-black bg-farm-deep px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
      />
      {connected && address !== connected && (
        <button
          onClick={() => setAddress(connected)}
          className="mt-1 text-[11px] font-bold text-neon-cyan underline"
        >
          Підставити підключений гаманець
        </button>
      )}

      <label className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-white/45">
        Сума
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-2xl border-2 border-black bg-farm-deep px-3 py-2">
        <GramIcon className="h-5 w-5 flex-none" />
        <input
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="0.00"
          className="w-full bg-transparent font-display text-xl text-white outline-none"
        />
        <button
          onClick={() => {
            haptic.select();
            setRaw(String(balanceGram));
          }}
          className="flex-none rounded-lg border-2 border-black bg-neon-yellow px-2 py-0.5 text-[11px] font-extrabold text-black active:translate-y-0.5"
        >
          MAX
        </button>
      </div>
      <div className="mt-1 text-[11px] text-white/40">
        Доступно: {fmtGram(balanceGram)} GRAM
      </div>

      {/* breakdown */}
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border-2 border-black bg-farm-card/70 p-2.5 text-center">
        <Cell label="Сума" value={fmtGram(amountValid ? amount : 0)} />
        <Cell label="Комісія" value={fmtGram(fee)} tone="text-neon-pink" />
        <Cell label="Отримаєте" value={fmtGram(net)} tone="text-neon-lime" />
      </div>
      <div className="mt-1 text-[10px] text-white/35">
        Комісія: max({fmtGram(0.01)}, сума × 2%) · мін. вивід {fmtGram(WITHDRAW_MIN)} · 1 вивід / 24 год
      </div>

      {error && (
        <div className="mt-2 rounded-xl border-2 border-neon-pink bg-neon-pink/10 px-3 py-1.5 text-[11px] font-bold text-neon-pink">
          {error}
        </div>
      )}

      <div className="mt-4">
        <GameButton accent="cyan" block disabled={!canSubmit} onClick={onConfirm}>
          Вивести {fmtGram(net)} GRAM
        </GameButton>
      </div>
    </Modal>
  );
}

function Cell({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] font-extrabold uppercase tracking-wide text-white/40">{label}</div>
      <div className={`font-display text-sm text-stroke-sm ${tone}`}>{value}</div>
    </div>
  );
}
