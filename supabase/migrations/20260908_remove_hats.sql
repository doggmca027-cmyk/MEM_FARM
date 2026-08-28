-- =============================================================================
-- Meme Farm — remove the "Hats / Equipment / Boost slot" mechanic
--   Income is now the raw sum of character incomes (no percentage boost).
-- =============================================================================

alter table public.farm_slots   drop column if exists hat_item_id;
alter table public.tier_states  drop column if exists hat_item_id;

-- these were never created, but drop defensively in case an earlier draft added them
drop table if exists public.user_equipment;
drop table if exists public.equipment_items;
