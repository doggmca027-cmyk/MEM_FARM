// Supabase Edge Function — treasury hot-wallet payout worker.
//
// On each call (cron / admin "Confirm" / event) it drains WITHDRAW rows that
// are AUTO_PENDING or APPROVED: claims one (-> PROCESSING), sends `net_amount`
// TON from the treasury wallet to the player's address, and on a confirmed
// seqno bump marks it COMPLETED with the outgoing tx hash. Failures refund.
//
// Gate: PAYOUT_WORKER_SECRET via `x-worker-secret` or `Authorization: Bearer`.
//
// Secrets:
//   TREASURY_WALLET_MNEMONIC   – 24 space-separated words of the hot wallet
//   TONCENTER_API_KEY          – optional, raises the toncenter rate limit
//   PAYOUT_WORKER_SECRET       – shared secret protecting this endpoint
//   PAYOUT_MAX_BATCH           – optional, rows per invocation (default 5)
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY – auto-injected
//
// Deploy: supabase functions deploy ton-payout-worker --no-verify-jwt
//   ⚠️  This function can move real funds. Keep the mnemonic in Supabase
//       secrets only, never in the repo, and keep the hot-wallet float small.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import { mnemonicToPrivateKey } from 'npm:@ton/crypto@3.3.0';
import {
  TonClient,
  WalletContractV5R1,
  internal,
  toNano,
  Address,
  SendMode,
} from 'npm:@ton/ton@15.1.0';

const MNEMONIC = (Deno.env.get('TREASURY_WALLET_MNEMONIC') ?? '').trim();
const TONCENTER_API_KEY = Deno.env.get('TONCENTER_API_KEY') ?? '';
const WORKER_SECRET = Deno.env.get('PAYOUT_WORKER_SECRET') ?? '';
const MAX_BATCH = Number(Deno.env.get('PAYOUT_MAX_BATCH') ?? '5') || 5;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TONCENTER_RPC = 'https://toncenter.com/api/v2/jsonRPC';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-worker-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function authorized(req: Request): boolean {
  if (!WORKER_SECRET) return true;
  const h =
    req.headers.get('x-worker-secret') ??
    (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  return h === WORKER_SECRET;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: 'not configured' }, 500);
  if (!MNEMONIC) return json({ error: 'TREASURY_WALLET_MNEMONIC not set' }, 500);
  if (!authorized(req)) return json({ error: 'unauthorized' }, 401);

  const db = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const client = new TonClient({
    endpoint: TONCENTER_RPC,
    apiKey: TONCENTER_API_KEY || undefined,
  });

  const key = await mnemonicToPrivateKey(MNEMONIC.split(/\s+/));
  // v5r1 treasury wallet (Tonkeeper / MyTonWallet default on new wallets)
  const wallet = WalletContractV5R1.create({ workchain: 0, publicKey: key.publicKey });
  const contract = client.open(wallet);

  const results: Array<Record<string, unknown>> = [];

  for (let i = 0; i < MAX_BATCH; i++) {
    const { data, error } = await db.rpc('worker_claim_payout');
    if (error) return json({ error: error.message, done: results }, 500);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.tx_id) break; // queue drained

    const txId = row.tx_id as string;
    const dest = String(row.dest_address ?? '');
    const net = Number(row.net_amount ?? 0);

    try {
      if (!dest || net <= 0) throw new Error('bad destination or amount');
      Address.parse(dest); // validate

      const seqnoBefore: number = await contract.getSeqno();
      await contract.sendTransfer({
        seqno: seqnoBefore,
        secretKey: key.secretKey,
        sendMode: SendMode.PAY_GAS_SEPARATELY + SendMode.IGNORE_ERRORS,
        messages: [
          internal({
            to: dest,
            value: toNano(net.toFixed(9)),
            bounce: false,
            body: 'Meme Farm payout',
          }),
        ],
      });

      // wait for the seqno to advance (tx accepted by the network)
      let confirmed = false;
      for (let a = 0; a < 20; a++) {
        await sleep(2500);
        if ((await contract.getSeqno()) > seqnoBefore) {
          confirmed = true;
          break;
        }
      }
      if (!confirmed) throw new Error('payout not confirmed in time');

      // best-effort: last outgoing tx hash from the treasury wallet
      let hash = `seqno:${seqnoBefore}`;
      try {
        const txs = await client.getTransactions(wallet.address, { limit: 1 });
        if (txs[0]?.hash) hash = txs[0].hash().toString('hex');
      } catch {
        /* keep the seqno marker */
      }

      await db.rpc('worker_complete_payout', { p_tx_id: txId, p_hash: hash });
      results.push({ txId, status: 'COMPLETED', hash });
    } catch (e) {
      await db.rpc('worker_fail_payout', { p_tx_id: txId, p_reason: String(e) });
      results.push({ txId, status: 'FAILED', error: String(e) });
    }
  }

  return json({ processed: results.length, results });
});
