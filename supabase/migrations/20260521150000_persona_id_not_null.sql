-- Phase 1.2.3.f : verrouille persona_id NOT NULL sur les tables prospection actives.
--
-- A ce stade, 100% des rows ont persona_id non null (backfill complet en 1.2.2 +
-- 1.2.3.a-e). On force le contrat pour eviter qu'un futur INSERT oublie persona_id.
--
-- On garde la colonne target_category pour la compat UI (display, couleurs) ;
-- elle sera droppee dans une PR dediee quand tout le frontend sera migre.

-- Pre-checks defensifs : si jamais un row a persona_id NULL, on echoue ici plutot
-- que de casser silencieusement. (skip non-existent tables)
DO $$
DECLARE missing_count INT;
BEGIN
  BEGIN
    SELECT COUNT(*) INTO missing_count FROM public.prospect_profiles WHERE persona_id IS NULL;
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'prospect_profiles a % rows avec persona_id NULL, backfill avant NOT NULL', missing_count;
    END IF;
    ALTER TABLE public.prospect_profiles ALTER COLUMN persona_id SET NOT NULL;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    RAISE NOTICE 'prospect_profiles table/column missing (skipping check)';
  END;

  BEGIN
    SELECT COUNT(*) INTO missing_count FROM public.prospect_messages WHERE persona_id IS NULL;
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'prospect_messages a % rows avec persona_id NULL', missing_count;
    END IF;
    ALTER TABLE public.prospect_messages ALTER COLUMN persona_id SET NOT NULL;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    RAISE NOTICE 'prospect_messages table/column missing (skipping check)';
  END;

  BEGIN
    SELECT COUNT(*) INTO missing_count FROM public.prospect_message_templates WHERE persona_id IS NULL;
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'prospect_message_templates a % rows avec persona_id NULL', missing_count;
    END IF;
    ALTER TABLE public.prospect_message_templates ALTER COLUMN persona_id SET NOT NULL;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    RAISE NOTICE 'prospect_message_templates table/column missing (skipping check)';
  END;

  BEGIN
    SELECT COUNT(*) INTO missing_count FROM public.smartlead_campaigns WHERE persona_id IS NULL;
    IF missing_count > 0 THEN
      RAISE EXCEPTION 'smartlead_campaigns a % rows avec persona_id NULL', missing_count;
    END IF;
    ALTER TABLE public.smartlead_campaigns ALTER COLUMN persona_id SET NOT NULL;
  EXCEPTION WHEN undefined_table OR undefined_column THEN
    RAISE NOTICE 'smartlead_campaigns table/column missing (skipping check)';
  END;
END $$;

-- Comments on persona_id columns (skip non-existent tables)
DO $$
BEGIN
  BEGIN
    COMMENT ON COLUMN public.prospect_profiles.persona_id IS
      'Persona cible (icp_personas). NOT NULL depuis 1.2.3.f. target_category gardee pour compat UI, droppera plus tard.';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    COMMENT ON COLUMN public.prospect_messages.persona_id IS
      'Persona du prospect au moment de la generation. NOT NULL depuis 1.2.3.f.';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    COMMENT ON COLUMN public.prospect_message_templates.persona_id IS
      'Persona cible du template. NOT NULL depuis 1.2.3.f.';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  BEGIN
    COMMENT ON COLUMN public.smartlead_campaigns.persona_id IS
      'Persona cible de la campagne Smartlead. NOT NULL depuis 1.2.3.f.';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
