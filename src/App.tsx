import { useEffect } from 'react';
import { TonConnectUIProvider } from '@tonconnect/ui-react';
import { AppLayout } from './components/layout/AppLayout';
import { initTelegram } from './telegram/telegram';
import { authenticateWithTelegram } from './services/auth';
import { useGameStore } from './store/useGameStore';

const manifestUrl =
  typeof window !== 'undefined'
    ? `${window.location.origin}/tonconnect-manifest.json`
    : 'https://meme-farm.vercel.app/tonconnect-manifest.json';

export default function App() {
  const hydrate = useGameStore((s) => s.hydrate);

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
    <TonConnectUIProvider manifestUrl={manifestUrl}>
      <AppLayout />
    </TonConnectUIProvider>
  );
}
