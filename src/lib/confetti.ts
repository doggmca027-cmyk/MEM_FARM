import confetti from 'canvas-confetti';

const COLORS = ['#84CC16', '#FACC15', '#06B6D4', '#EC4899', '#A855F7'];

/** Celebratory double-cannon burst — used on a successful farm claim. */
export function fireClaimConfetti(): void {
  const base = { spread: 70, startVelocity: 45, colors: COLORS, disableForReducedMotion: true };
  confetti({ ...base, particleCount: 90, origin: { x: 0.2, y: 0.7 }, angle: 60 });
  confetti({ ...base, particleCount: 90, origin: { x: 0.8, y: 0.7 }, angle: 120 });
  window.setTimeout(() => {
    confetti({ ...base, particleCount: 60, origin: { x: 0.5, y: 0.4 }, spread: 100 });
  }, 140);
}

/** Over-the-top golden storm for a Legendary Jackpot pull. */
export function fireJackpot(): void {
  const gold = ['#FACC15', '#FDE68A', '#F59E0B', '#FFFFFF'];
  const end = Date.now() + 900;
  (function frame() {
    confetti({ particleCount: 8, angle: 60, spread: 65, origin: { x: 0, y: 0.8 }, colors: gold, disableForReducedMotion: true });
    confetti({ particleCount: 8, angle: 120, spread: 65, origin: { x: 1, y: 0.8 }, colors: gold, disableForReducedMotion: true });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
  confetti({ particleCount: 160, spread: 130, startVelocity: 55, origin: { x: 0.5, y: 0.45 }, colors: gold, disableForReducedMotion: true });
}

/** Small pop for lesser wins — level ups, equips. */
export function firePop(): void {
  confetti({
    particleCount: 40,
    spread: 55,
    startVelocity: 30,
    colors: COLORS,
    origin: { x: 0.5, y: 0.5 },
    disableForReducedMotion: true,
  });
}
