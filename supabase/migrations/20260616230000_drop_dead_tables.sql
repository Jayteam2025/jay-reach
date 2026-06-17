-- Drop extension Chrome + email direct tables (subsystems removed from code)
DROP TABLE IF EXISTS public.extension_tokens CASCADE;
DROP TABLE IF EXISTS public.extension_action_queue CASCADE;
DROP TABLE IF EXISTS public.email_connections CASCADE;
DROP TABLE IF EXISTS public.pending_emails CASCADE;
DROP TABLE IF EXISTS public.linkedin_invitation_queue CASCADE;
