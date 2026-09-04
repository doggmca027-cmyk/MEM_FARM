// Thin client-side loaders for the 4 rewarded-ad SDKs. None of these credit
// GRAM by themselves — a resolved show() only means "the user watched it";
// the actual reward is granted server-side once the network's own postback
// confirms the view (see ad_views / credit_ad_view / credit_oldest_pending_ad_view
// and supabase/functions/{adsgram,monetag}-postback).

function loadScriptOnce(id: string, src: string, attrs?: Record<string, string>): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.id = id;
    s.src = src;
    s.async = true;
    if (attrs) for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

// --- Adsgram — https://docs.adsgram.ai ---------------------------------
// window.Adsgram.init({ blockId }) -> controller; controller.show() resolves
// once the ad was watched to the end. Reward reaches us via their own GET
// postback to /functions/v1/adsgram-postback (no click_id passthrough).
interface AdsgramController {
  show(): Promise<{ done: boolean }>;
}
let adsgramController: AdsgramController | null = null;

export async function showAdsgram(blockId: string): Promise<void> {
  await loadScriptOnce('adsgram-sdk', 'https://sad.adsgram.ai/js/sad.min.js');
  const w = window as unknown as {
    Adsgram?: { init(opts: { blockId: string }): AdsgramController };
  };
  if (!w.Adsgram) throw new Error('Adsgram SDK unavailable');
  if (!adsgramController) adsgramController = w.Adsgram.init({ blockId });
  await adsgramController.show();
}

// --- Monetag — https://docs.monetag.com ---------------------------------
// <script data-zone="{zoneId}" data-sdk="show_{zoneId}"> exposes
// window.show_<zoneId>({ ymid }) -> Promise. `ymid` is our click_id, echoed
// back in the postback (see supabase/functions/monetag-postback — macro
// name assumed `ymid`, verify against the Monetag dashboard).
export async function showMonetag(zoneId: string, ymid: string): Promise<void> {
  const fnName = `show_${zoneId}`;
  await loadScriptOnce(`monetag-sdk-${zoneId}`, 'https://libtl.com/sdk.js', {
    'data-zone': zoneId,
    'data-sdk': fnName,
  });
  const w = window as unknown as Record<string, ((opts?: { ymid?: string }) => Promise<void>) | undefined>;
  const show = w[fnName];
  if (typeof show !== 'function') throw new Error('Monetag SDK unavailable');
  await show({ ymid });
}

// --- GigaPub — https://docs.giga.pub -------------------------------------
// <script src="https://ad.gigapub.tech/script?id={projectId}"> exposes
// window.showGiga() -> Promise. No confirmed passthrough param yet, so the
// postback side isn't wired (nothing is credited until it is — matches
// "no working postback = no reward").
export async function showGigapub(projectId: string): Promise<void> {
  await loadScriptOnce('gigapub-sdk', `https://ad.gigapub.tech/script?id=${encodeURIComponent(projectId)}`);
  const w = window as unknown as { showGiga?: () => Promise<void> };
  if (typeof w.showGiga !== 'function') throw new Error('GigaPub SDK unavailable');
  await w.showGiga();
}

// --- RichAds --------------------------------------------------------------
// RichAds hands out a fully personalized <script> tag (publisher id + widget
// id baked in) from their dashboard rather than a generic public SDK — there
// is nothing generic to wire until that snippet exists.
export async function showRichAds(): Promise<void> {
  throw new Error('RichAds not configured yet');
}
