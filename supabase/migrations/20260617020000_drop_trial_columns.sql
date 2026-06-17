-- Drop trial-related columns from profiles table (deprecated in OSS, no paywall model)
ALTER TABLE public.profiles DROP COLUMN IF EXISTS trial_started_at;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS trial_used;
