import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Clock, Megaphone, Send, X } from 'lucide-react';
import { useGameStore } from '../store/useGameStore';
import {
  fetchMyAmbassador,
  submitAmbassadorApplication,
  submitAmbassadorPost,
  type MyAmbassadorData,
} from '../services/api';
import type { AmbStatus } from '../types/ambassador';
import { GameButton } from '../components/ui/GameButton';
import { haptic } from '../lib/haptics';
import { useT } from '../i18n/useT';

type TFn = (key: string, vars?: Record<string, string | number>) => string;

function StatusPill({ status, t }: { status: AmbStatus; t: TFn }) {
  const map: Record<AmbStatus, { label: string; cls: string; Icon: typeof Check }> = {
    PENDING: { label: t('ambassador.statusPending'), cls: 'bg-neon-yellow text-black', Icon: Clock },
    APPROVED: { label: t('ambassador.statusApproved'), cls: 'bg-neon-lime text-black', Icon: Check },
    REJECTED: { label: t('ambassador.statusRejected'), cls: 'bg-neon-pink text-white', Icon: X },
  };
  const m = map[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border-2 border-black px-1.5 py-0.5 text-[10px] font-extrabold uppercase ${m.cls}`}
    >
      <m.Icon className="h-3 w-3" strokeWidth={3} />
      {m.label}
    </span>
  );
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
}

export function AmbassadorScreen() {
  const t = useT();
  const mode = useGameStore((s) => s.mode);

  const [data, setData] = useState<MyAmbassadorData | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      setData(await fetchMyAmbassador());
    } catch (e) {
      setLoadErr(String((e as Error).message ?? e));
      setData({ application: null, posts: [] });
    }
  }, []);

  useEffect(() => {
    if (mode === 'live') void load();
  }, [mode, load]);

  if (mode !== 'live') {
    return (
      <div className="grid place-items-center rounded-3xl border-2 border-dashed border-white/20 bg-farm-card/40 px-4 py-16 text-center">
        <Megaphone className="h-8 w-8 text-neon-violet" strokeWidth={2.5} />
        <div className="mt-3 max-w-[30ch] text-xs text-white/55">{t('ambassador.onlineOnly')}</div>
      </div>
    );
  }

  const app = data?.application ?? null;
  const approved = app?.status === 'APPROVED';
  const canApply = !app || app.status === 'REJECTED';

  return (
    <div className="space-y-5">
      {loadErr && (
        <div className="rounded-xl border-2 border-neon-pink bg-neon-pink/10 px-3 py-2 text-[11px] font-bold text-neon-pink">
          {loadErr}
        </div>
      )}

      <ApplicationCard app={app} canApply={canApply} onDone={load} t={t} />
      <PostsCard approved={approved} posts={data?.posts ?? []} onDone={load} t={t} />
    </div>
  );
}

// ============ Block 1 — channel application ============

function ApplicationCard({
  app,
  canApply,
  onDone,
  t,
}: {
  app: MyAmbassadorData['application'];
  canApply: boolean;
  onDone: () => Promise<void>;
  t: TFn;
}) {
  const [channel, setChannel] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    if (!channel.trim()) return setErr(t('ambassador.errChannel'));
    if (!contact.trim()) return setErr(t('ambassador.errContact'));
    setBusy(true);
    try {
      await submitAmbassadorApplication(channel, contact);
      haptic.notify('success');
      setChannel('');
      setContact('');
      await onDone();
    } catch (e) {
      const msg = String((e as { code?: string; message?: string }).code === '23505'
        ? t('ambassador.errDuplicate')
        : (e as Error).message ?? e);
      setErr(msg);
      haptic.notify('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-violet border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md"
    >
      <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-bold text-white/75">
          <Megaphone className="h-5 w-5 text-neon-violet" strokeWidth={2.5} />
          {t('ambassador.applyTitle')}
        </div>
        {app && <StatusPill status={app.status} t={t} />}
      </div>

      <p className="relative mt-1.5 text-[11px] leading-relaxed text-white/55">
        {t('ambassador.applyIntro')}
      </p>
      <p className="relative mt-1.5 text-[11px] font-semibold leading-relaxed text-neon-lime/90">
        {t('ambassador.applyNote')}
      </p>

      {app && !canApply ? (
        <div className="relative mt-3 rounded-2xl border-2 border-black bg-farm-deep p-3 text-[11px] text-white/70">
          <div className="dir-ltr break-all font-mono text-white/80">{app.channelLink}</div>
          <div className="mt-1 text-white/40">{t('ambassador.contactPlaceholder')}: {app.contactUsername}</div>
          {app.status === 'APPROVED' && (
            <div className="mt-2 text-neon-lime">{t('ambassador.approvedNote')}</div>
          )}
        </div>
      ) : (
        <div className="relative mt-3 space-y-2">
          {app?.status === 'REJECTED' && (
            <div className="text-[10px] font-bold text-neon-pink">{t('ambassador.reapply')}</div>
          )}
          <input
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            placeholder={t('ambassador.channelPlaceholder')}
            className="w-full rounded-xl border-2 border-black bg-farm-deep px-3 py-2 text-xs text-white outline-none placeholder:text-white/30"
          />
          <input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder={t('ambassador.contactPlaceholder')}
            className="w-full rounded-xl border-2 border-black bg-farm-deep px-3 py-2 text-xs text-white outline-none placeholder:text-white/30"
          />
          {err && <div className="text-[10px] font-bold text-neon-pink">{err}</div>}
          <GameButton accent="violet" block disabled={busy} onClick={submit}>
            <span className="inline-flex items-center gap-1.5">
              <Send className="h-4 w-4" strokeWidth={3} />
              {t('ambassador.submitApplication')}
            </span>
          </GameButton>
        </div>
      )}
    </motion.div>
  );
}

// ============ Block 2 — publication reports ============

function PostsCard({
  approved,
  posts,
  onDone,
  t,
}: {
  approved: boolean;
  posts: MyAmbassadorData['posts'];
  onDone: () => Promise<void>;
  t: TFn;
}) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const v = link.trim();
    if (!/^https?:\/\/\S+$/.test(v)) return setErr(t('ambassador.errPostLink'));
    setBusy(true);
    try {
      await submitAmbassadorPost(v);
      haptic.notify('success');
      setLink('');
      await onDone();
    } catch (e) {
      setErr(String((e as Error).message ?? e));
      haptic.notify('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="relative overflow-hidden rounded-3xl border-2 border-b-4 border-neon-cyan border-b-black/50 bg-farm-card/80 p-4 backdrop-blur-md">
      <div className="pointer-events-none absolute inset-0 bg-stripes opacity-50" />
      <div className="relative flex items-center gap-2 text-sm font-bold text-white/75">
        <Send className="h-5 w-5 text-neon-cyan" strokeWidth={2.5} />
        {t('ambassador.postsTitle')}
      </div>
      <p className="relative mt-1.5 text-[11px] leading-relaxed text-white/55">
        {t('ambassador.postsIntro')}
      </p>

      {!approved ? (
        <div className="relative mt-3 rounded-2xl border-2 border-dashed border-white/20 bg-farm-deep/60 px-3 py-4 text-center text-[11px] text-white/45">
          {t('ambassador.needApproved')}
        </div>
      ) : (
        <div className="relative mt-3 space-y-2">
          <input
            value={link}
            onChange={(e) => setLink(e.target.value)}
            inputMode="url"
            placeholder={t('ambassador.postPlaceholder')}
            className="dir-ltr w-full rounded-xl border-2 border-black bg-farm-deep px-3 py-2 text-xs text-white outline-none placeholder:text-white/30"
          />
          {err && <div className="text-[10px] font-bold text-neon-pink">{err}</div>}
          <GameButton accent="cyan" block disabled={busy} onClick={submit}>
            {t('ambassador.submitPost')}
          </GameButton>
        </div>
      )}

      <div className="relative mt-3 space-y-2">
        {posts.length === 0 ? (
          <div className="text-[11px] text-white/40">{t('ambassador.postsEmpty')}</div>
        ) : (
          posts.map((p) => (
            <div
              key={p.id}
              className="rounded-xl border-2 border-black bg-farm-deep px-3 py-2 text-[11px]"
            >
              <div className="flex items-center justify-between gap-2">
                <a
                  href={p.postLink}
                  target="_blank"
                  rel="noreferrer"
                  className="dir-ltr min-w-0 flex-1 truncate font-mono text-neon-cyan underline"
                >
                  {p.postLink}
                </a>
                <StatusPill status={p.status} t={t} />
              </div>
              <div className="mt-1 flex items-center justify-between text-white/40">
                <span>{fmtDate(p.createdAt)}</span>
                {p.adminComment && <span className="text-neon-pink">{p.adminComment}</span>}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
