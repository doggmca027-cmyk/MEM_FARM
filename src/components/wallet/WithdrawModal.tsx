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
import { useT } from '../../i18n/useT';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function WithdrawModal({ open, onClose }: Props) {
  const t = useT();
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
  if (raw && !amountValid) error = t('withdraw.errBadAmount');
  else if (amountValid && amount < WITHDRAW_MIN) error = t('withdraw.errMin', { n: fmtGram(WITHDRAW_MIN) });
  else if (amountValid && amount > balanceGram) error = t('withdraw.errInsufficient');
  else if (address.trim().length < 40) error = t('withdraw.errAddress');
  else if (cooldownLeft > 0) error = t('withdraw.errCooldown', { t: fmtHMS(cooldownLeft) });

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
          {t('withdraw.title')}
        </span>
      }
    >
      <label className="block text-[11px] font-bold uppercase tracking-wide text-white/45">
        {t('withdraw.address')}
      </label>
      <input
        value={address}
        onChange={(e) => setAddress(e.target.value)}
        placeholder="UQ… / EQ…"
        spellCheck={false}
        dir="ltr"
        className="mt-1 w-full rounded-2xl border-2 border-black bg-farm-deep px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
      />
      {connected && address !== connected && (
        <button
          onClick={() => setAddress(connected)}
          className="mt-1 text-[11px] font-bold text-neon-cyan underline"
        >
          {t('withdraw.useConnected')}
        </button>
      )}

      <label className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-white/45">
        {t('withdraw.amount')}
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
      <div className="mt-1 text-[11px] text-white/40 dir-ltr">
        {t('withdraw.available', { n: fmtGram(balanceGram) })}
      </div>

      {/* breakdown */}
      <div className="mt-3 grid grid-cols-3 gap-2 rounded-2xl border-2 border-black bg-farm-card/70 p-2.5 text-center">
        <Cell label={t('withdraw.sum')} value={fmtGram(amountValid ? amount : 0)} />
        <Cell label={t('withdraw.fee')} value={fmtGram(fee)} tone="text-neon-pink" />
        <Cell label={t('withdraw.youGet')} value={fmtGram(net)} tone="text-neon-lime" />
      </div>
      <div className="mt-1 text-[10px] text-white/35">
        {t('withdraw.feeNote', { min: fmtGram(0.01), minw: fmtGram(WITHDRAW_MIN) })}
      </div>

      {error && (
        <div className="mt-2 rounded-xl border-2 border-neon-pink bg-neon-pink/10 px-3 py-1.5 text-[11px] font-bold text-neon-pink">
          {error}
        </div>
      )}

      <div className="mt-4">
        <GameButton accent="cyan" block disabled={!canSubmit} onClick={onConfirm}>
          {t('withdraw.submit', { n: fmtGram(net) })}
        </GameButton>
      </div>
    </Modal>
  );
}

function Cell({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[9px] font-extrabold uppercase tracking-wide text-white/40">{label}</div>
      <div className={`font-display text-sm text-stroke-sm dir-ltr ${tone}`}>{value}</div>
    </div>
  );
}
