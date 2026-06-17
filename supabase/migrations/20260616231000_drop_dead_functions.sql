-- Drop orphaned RPC functions from removed subsystems
DROP FUNCTION IF EXISTS public.cleanup_old_pending_emails CASCADE;
