import { useEffect } from 'react';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { AppLayout } from './components/layout/AppLayout';
import { initTelegram } from './telegram/telegram';
import { authenticateWithTelegram } from './services/auth';
import { useGameStore } from './store/useGameStore';
import { applyDir } from './i18n';

const manifestUrl =
  typeof window !== 'undefined'
    ? `${window.location.origin}/tonconnect-manifest.json`
    : 'https://meme-farm.vercel.app/tonconnect-manifest.json';

export default function App() {
  const hydrate = useGameStore((s) => s.hydrate);
  const lang = useGameStore((s) => s.lang);

  // Keep <html dir/lang> in sync with the active language (RTL for ar/fa).
  useEffect(() => {
    applyDir(lang);
  }, [lang]);

  useEffect(() => {
    initTelegram();
    // Try to establish a Supabase session from Telegram initData, then hydrate.
    // Both steps are best-effort — the store falls back to mock data.
    void (async () => {
      await authenticateWithTelegram();
      await hydrate();
    })();
  }, [hydrate]);

  return (
    <TonConnectUIProvider
      manifestUrl={manifestUrl}
      language={lang === 'ru' ? 'ru' : 'en'}
    >
      <AppLayout />
    </TonConnectUIProvider>
  );
}
