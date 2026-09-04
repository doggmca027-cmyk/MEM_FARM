-- =============================================================================
-- Meme Farm — ad reward 0.002 -> 0.001 GRAM per view.
-- =============================================================================

alter table public.ad_views alter column reward_gram set default 0.001;
