import { Bell, Flame, Swords, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { NotifPrefs } from '../../services/api';
import { useGameStore } from '../../store/useGameStore';
import { haptic } from '../../lib/haptics';
import { Modal } from '../ui/Modal';

const ROWS: { key: keyof NotifPrefs; label: string; hint: string; icon: ReactNode }[] = [
  {
    key: 'farm_ready',
    label: 'Ферма готова',
    hint: 'Коли накопичився максимум GRAM',
    icon: <Flame className="h-4 w-4 text-neon-yellow" strokeWidth={3} />,
  },
  {
    key: 'pvp_attack',
    label: 'Атака в рейді',
    hint: 'Коли суперник переміг тебе',
    icon: <Swords className="h-4 w-4 text-neon-pink" strokeWidth={3} />,
  },
  {
    key: 'referral_income',
    label: 'Реферальний дохід',
    hint: 'Коли друг приніс тобі GRAM',
    icon: <Users className="h-4 w-4 text-neon-cyan" strokeWidth={3} />,
  },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = useGameStore((s) => s.notifPrefs);
  const setNotifPref = useGameStore((s) => s.setNotifPref);
  const mode = useGameStore((s) => s.mode);

  return (
    <Modal
      open={open}
      onClose={onClose}
      accent="#06B6D4"
      title={
        <span className="inline-flex items-center gap-2">
          <Bell className="h-5 w-5 text-neon-cyan" strokeWidth={2.5} />
          Сповіщення
        </span>
      }
    >
      <div className="space-y-2">
        {ROWS.map((r) => {
          const on = prefs[r.key];
          return (
            <button
              key={r.key}
              onClick={() => {
                haptic.select();
                setNotifPref(r.key, !on);
              }}
              className="flex w-full items-center gap-3 rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-farm-card/80 p-3 text-left"
            >
              <span className="grid h-9 w-9 flex-none place-items-center rounded-xl border-2 border-black bg-farm-deep">
                {r.icon}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-bold">{r.label}</div>
                <div className="text-[10px] text-white/45">{r.hint}</div>
              </div>
              <span
                className={[
                  'relative h-6 w-11 flex-none rounded-full border-2 border-black transition-colors',
                  on ? 'bg-neon-lime' : 'bg-farm-deep',
                ].join(' ')}
              >
                <span
                  className={[
                    'absolute top-0.5 h-4 w-4 rounded-full border-2 border-black bg-white transition-all',
                    on ? 'left-[22px]' : 'left-0.5',
                  ].join(' ')}
                />
              </span>
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-[10px] text-white/35">
        {mode === 'live'
          ? 'Push через Telegram-бота. Зміни зберігаються миттєво.'
          : 'Демо-режим: налаштування не зберігаються без входу через Telegram.'}
      </p>
    </Modal>
  );
}
