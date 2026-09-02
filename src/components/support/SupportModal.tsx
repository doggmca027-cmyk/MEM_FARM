import { useCallback, useEffect, useRef, useState } from 'react';
import { LifeBuoy, Send } from 'lucide-react';
import { useGameStore } from '../../store/useGameStore';
import { fetchMySupport, markSupportRead, sendSupportMessage, type MySupportData } from '../../services/api';
import { haptic } from '../../lib/haptics';
import { Modal } from '../ui/Modal';
import { useT } from '../../i18n/useT';

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function SupportModal() {
  const t = useT();
  const open = useGameStore((s) => s.supportOpen);
  const setOpen = useGameStore((s) => s.setSupportOpen);
  const mode = useGameStore((s) => s.mode);

  const [data, setData] = useState<MySupportData | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const d = await fetchMySupport();
      setData(d);
      markSupportRead().catch(() => {});
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    }
  }, []);

  useEffect(() => {
    if (!open || mode !== 'live') return;
    void load();
    const id = window.setInterval(load, 12000);
    return () => window.clearInterval(id);
  }, [open, mode, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [data?.messages.length, open]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await sendSupportMessage(body);
      setText('');
      haptic.notify('success');
      await load();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      accent="#F59E0B"
      title={
        <span className="inline-flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-neon-yellow" strokeWidth={2.5} />
          {t('support.title')}
        </span>
      }
    >
      {mode !== 'live' ? (
        <div className="grid place-items-center rounded-2xl border-2 border-dashed border-white/20 bg-farm-card/40 px-4 py-12 text-center text-xs text-white/55">
          {t('support.onlineOnly')}
        </div>
      ) : (
        <div className="flex h-[60vh] flex-col">
          <div className="flex-1 space-y-2 overflow-y-auto pr-1">
            {!data ? (
              <div className="py-8 text-center text-xs text-white/40">{t('common.loading')}</div>
            ) : data.messages.length === 0 ? (
              <div className="py-8 text-center text-xs text-white/45">{t('support.empty')}</div>
            ) : (
              data.messages.map((m) => {
                const mine = m.sender === 'USER';
                return (
                  <div key={m.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                    <div
                      className={[
                        'max-w-[80%] rounded-2xl border-2 border-black px-3 py-2 text-[13px] leading-snug',
                        mine
                          ? 'border-b-4 border-b-black/40 bg-neon-yellow/90 text-black'
                          : 'border-b-4 border-b-black/40 bg-farm-card text-white',
                      ].join(' ')}
                    >
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={mine ? 'mt-1 text-[9px] text-black/50' : 'mt-1 text-[9px] text-white/35'}>
                        {mine ? t('support.you') : t('support.team')} · {fmtTime(m.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          {data?.status === 'CLOSED' && (
            <div className="mt-2 text-center text-[10px] font-bold uppercase text-white/35">
              {t('support.closedHint')}
            </div>
          )}
          {err && <div className="mt-2 text-[11px] font-bold text-neon-pink">{err}</div>}

          <div className="mt-2 flex items-end gap-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              placeholder={t('support.inputPlaceholder')}
              className="max-h-24 min-h-[40px] flex-1 resize-none rounded-2xl border-2 border-black bg-farm-deep px-3 py-2 text-sm text-white outline-none placeholder:text-white/30"
            />
            <button
              onClick={send}
              disabled={busy || !text.trim()}
              className="grid h-10 w-10 flex-none place-items-center rounded-2xl border-2 border-b-4 border-black border-b-black/40 bg-neon-yellow text-black active:translate-y-0.5 disabled:opacity-40"
            >
              <Send className="h-4 w-4" strokeWidth={3} />
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
