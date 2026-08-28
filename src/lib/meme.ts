import type { MemeType, Rarity } from '../types/game';

/** Emoji placeholder per meme — swap for generated sticker art later. */
export const MEME_EMOJI: Record<MemeType, string> = {
  capybara: '🦫',
  pepe: '🐸',
  doge: '🐕',
  gigachad: '🗿',
};

/** Neon flash colours: grey -> green -> blue -> purple -> gold. */
export const RARITY_HEX: Record<Rarity, string> = {
  common: '#94A3B8',
  uncommon: '#84CC16',
  rare: '#06B6D4',
  epic: '#A855F7',
  legendary: '#FACC15',
};

export const RARITY_LABEL: Record<Rarity, string> = {
  common: 'Common',
  uncommon: 'Uncommon',
  rare: 'Rare',
  epic: 'Epic',
  legendary: 'Legendary',
};

const PROMPT_TAIL =
  'cute meme cartoon sticker style, thick bold black outline, flat vibrant colors, ' +
  'isolated on pure white background, mobile game UI asset, Pop-Art Meme aesthetic --no background, shadows';

/** Copy-paste AI prompt for a character sticker, surfaced in card tooltips. */
export function characterArtPrompt(name: string, memeType: MemeType, rarity: Rarity): string {
  const base: Record<MemeType, string> = {
    capybara: 'a chubby capybara meme character',
    pepe: 'a pepe the frog meme character',
    doge: 'a shiba inu doge meme character',
    gigachad: 'a gigachad statue-faced buff meme character',
  };
  const flair: Record<Rarity, string> = {
    common: 'simple outfit, muted grey accents',
    uncommon: 'sporty gear, green neon accents',
    rare: 'adventurer gear, blue neon accents and a faint glow',
    epic: 'ornate armor, purple neon aura and sparkles',
    legendary: 'god-tier regalia, radiant golden aura, floating crown, jackpot vibes',
  };
  return `2D vector game asset sticker of ${base[memeType]} named ${name}, ${flair[rarity]}, ${PROMPT_TAIL}`;
}
