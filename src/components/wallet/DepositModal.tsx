import { useState } from 'react';
import { useTonAddress, useTonConnectUI } from '@tonconnect/ui-react';
import { Wallet } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import { fmtGram, shortAddress } from '../../lib/format';
import { gramToNano, textCommentPayload, TREASURY_ADDRESS, validUntil } from '../../lib/ton';
import { firePop } from '../../lib/confetti';
import { haptic } from '../../lib/haptics';
import { Modal } from '../ui/Modal';
import { GameButton } from '../ui/GameButton';
import { GramIcon } from '../icons/Icons';
import { useT } from '../../i18n/useT';

const QUICK = [1, 4, 8, 16, 32];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DepositModal({ open, onClose }: Props) {
  const t = useT();
  const [tonConnectUI] = useTonConnectUI();
  const address = useTonAddress();
  const profile = useGameStore((s) => s.profile);
  const deposit = useGameStore((s) => s.deposit);

  const [amount, setAmount] = useState(4);
  const [raw, setRaw] = useState('4');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setAmt = (n: number) => {
    setAmount(n);
    setRaw(String(n));
  };

  const valid = amount > 0 && Number.isFinite(amount);
  // the deposit is attributed by the Telegram ID in the transfer comment
  const memo = String(profile?.telegramId ?? '').replace(/\D+/g, '');

  const onConfirm = async () => {
    setErr(null);
    if (!address) {
      haptic.impact('medium');
      tonConnectUI.openModal();
      return;
    }
    if (!valid || busy) return;
    if (!memo) {
      haptic.notify('error');
      setErr(t('deposit.needAuth'));
      return;
    }
    setBusy(true);
    try {
      const res = await tonConnectUI.sendTransaction({
        validUntil: validUntil(300),
        messages: [
          {
            address: TREASURY_ADDRESS,
            amount: gramToNano(amount),
            payload: textCommentPayload(memo),
          },
        ],
      });
      deposit(amount, res.boc ? res.boc.slice(0, 24) : null);
      haptic.notify('success');
      firePop();
      onClose();
    } catch {
      haptic.notify('error');
      setErr(t('deposit.txRejected'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      accent="#84CC16"
      title={
        <span className="inline-flex items-center gap-2">
          <Wallet className="h-5 w-5 text-neon-lime" strokeWidth={2.5} />
          {t('deposit.title')}
        </span>
      }
    >
      <div className="grid grid-cols-5 gap-2">
        {QUICK.map((n) => (
          <button
            key={n}
            onClick={() => {
              haptic.select();
              setAmt(n);
            }}
            className={[
              'rounded-xl border-2 border-b-4 border-black py-2 text-sm font-extrabold',
              amount === n ? 'border-b-black/40 bg-neon-lime text-black' : 'border-b-black/40 bg-farm-card text-white/70',
            ].join(' ')}
          >
            {n}
          </button>
        ))}
      </div>

      <label className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-white/45">
        {t('deposit.orAmount')}
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-2xl border-2 border-black bg-farm-deep px-3 py-2">
        <GramIcon className="h-5 w-5 flex-none" />
        <input
          inputMode="decimal"
          value={raw}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.');
            setRaw(v);
            const n = parseFloat(v);
            if (Number.isFinite(n)) setAmount(n);
          }}
          className="w-full bg-transparent font-display text-xl text-white outline-none"
          placeholder="0.00"
        />
        <span className="flex-none text-xs font-bold text-white/40">GRAM</span>
      </div>

      <div className="mt-3 rounded-2xl border-2 border-black bg-farm-card/70 p-3 text-[11px] text-white/55">
        {t('deposit.note', { addr: shortAddress(TREASURY_ADDRESS, 6, 4), memo: memo || '—' })}
      </div>

      {err && (
        <div className="mt-2 rounded-xl border-2 border-neon-pink bg-neon-pink/10 px-3 py-1.5 text-[11px] font-bold text-neon-pink">
          {err}
        </div>
      )}

      <div className="mt-4">
        <GameButton accent="lime" block disabled={busy} onClick={onConfirm}>
          {!address
            ? t('wallet.connect')
            : busy
              ? t('deposit.opening')
              : t('deposit.topUp', { n: fmtGram(amount) })}
        </GameButton>
      </div>
    </Modal>
  );
}
