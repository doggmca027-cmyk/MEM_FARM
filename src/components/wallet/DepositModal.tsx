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

const QUICK = [1, 4, 8, 16, 32];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function DepositModal({ open, onClose }: Props) {
  const [tonConnectUI] = useTonConnectUI();
  const address = useTonAddress();
  const profile = useGameStore((s) => s.profile);
  const deposit = useGameStore((s) => s.deposit);

  const [amount, setAmount] = useState(4);
  const [raw, setRaw] = useState('4');
  const [busy, setBusy] = useState(false);

  const setAmt = (n: number) => {
    setAmount(n);
    setRaw(String(n));
  };

  const valid = amount > 0 && Number.isFinite(amount);

  const onConfirm = async () => {
    if (!address) {
      haptic.impact('medium');
      tonConnectUI.openModal();
      return;
    }
    if (!valid || busy) return;
    setBusy(true);
    try {
      const comment = `memefarm:deposit:${profile?.id ?? 'guest'}`;
      const res = await tonConnectUI.sendTransaction({
        validUntil: validUntil(300),
        messages: [
          {
            address: TREASURY_ADDRESS,
            amount: gramToNano(amount),
            payload: textCommentPayload(comment),
          },
        ],
      });
      deposit(amount, res.boc ? res.boc.slice(0, 24) : null);
      haptic.notify('success');
      firePop();
      onClose();
    } catch {
      haptic.notify('error');
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
          Депозит GRAM
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
        Або вкажи суму
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
        Кошти йдуть на скарбницю{' '}
        <span className="font-bold text-neon-cyan">{shortAddress(TREASURY_ADDRESS, 6, 4)}</span> з
        коментарем <span className="font-bold text-white/75">memefarm:deposit</span>. Баланс
        оновиться після підтвердження мережі.
      </div>

      <div className="mt-4">
        <GameButton accent="lime" block disabled={busy} onClick={onConfirm}>
          {!address
            ? 'Підключити гаманець'
            : busy
              ? 'Відкриваю гаманець…'
              : `Поповнити на ${fmtGram(amount)} GRAM`}
        </GameButton>
      </div>
    </Modal>
  );
}
