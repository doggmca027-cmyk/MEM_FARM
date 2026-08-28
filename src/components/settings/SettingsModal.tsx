import { Bell, Flame, Globe, Swords, Users } from 'lucide-react';
import type { ReactNode } from 'react';
import type { NotifPrefs } from '../../services/api';
import { useGameStore } from '../../store/useGameStore';
import { haptic } from '../../lib/haptics';
import { LANGS } from '../../i18n';
import { useT } from '../../i18n/useT';
import { Modal } from '../ui/Modal';

const ROWS: { key: keyof NotifPrefs; labelKey: string; hintKey: string; icon: ReactNode }[] = [
  {
    key: 'farm_ready',
    labelKey: 'settings.farmReady',
    hintKey: 'settings.farmReadyHint',
    icon: <Flame className="h-4 w-4 text-neon-yellow" strokeWidth={3} />,
  },
  {
    key: 'pvp_attack',
    labelKey: 'settings.pvpAttack',
    hintKey: 'settings.pvpAttackHint',
    icon: <Swords className="h-4 w-4 text-neon-pink" strokeWidth={3} />,
  },
  {
    key: 'referral_income',
    labelKey: 'settings.refIncome',
    hintKey: 'settings.refIncomeHint',
    icon: <Users className="h-4 w-4 text-neon-cyan" strokeWidth={3} />,
  },
];

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const prefs = useGameStore((s) => s.notifPrefs);
  const setNotifPref = useGameStore((s) => s.setNotifPref);
  const mode = useGameStore((s) => s.mode);
  const lang = useGameStore((s) => s.lang);
  const setLang = useGameStore((s) => s.setLang);

  return (
    <Modal
      open={open}
      onClose={onClose}
      accent="#06B6D4"
      title={
        <span className="inline-flex items-center gap-2">
          <Bell className="h-5 w-5 text-neon-cyan" strokeWidth={2.5} />
          {t('settings.title')}
        </span>
      }
    >
      {/* language grid */}
      <div className="mb-4">
        <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-white/50">
          <Globe className="h-4 w-4 text-neon-cyan" strokeWidth={3} />
          {t('settings.language')}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {LANGS.map((l) => {
            const active = l.code === lang;
            return (
              <button
                key={l.code}
                onClick={() => {
                  haptic.select();
                  setLang(l.code);
                }}
                className={[
                  'flex flex-col items-center gap-1 rounded-2xl border-2 border-b-4 border-black p-2 text-center transition-colors',
                  active ? 'bg-neon-lime text-black border-b-black/40' : 'bg-farm-card/80 border-b-black/40',
                ].join(' ')}
              >
                <span className="text-xl leading-none">{l.flag}</span>
                <span className="text-[10px] font-bold leading-tight">{l.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-white/50">
        <Bell className="h-4 w-4 text-neon-cyan" strokeWidth={3} />
        {t('settings.notifications')}
      </div>
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
                <div className="text-sm font-bold">{t(r.labelKey)}</div>
                <div className="text-[10px] text-white/45">{t(r.hintKey)}</div>
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
        {mode === 'live' ? t('settings.pushLive') : t('settings.pushDemo')}
      </p>
    </Modal>
  );
}
