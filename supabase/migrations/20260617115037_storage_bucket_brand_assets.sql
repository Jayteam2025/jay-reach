-- ============================================================================
-- STORAGE BUCKET: brand-assets (public, pour les images inline emails)
-- ============================================================================
-- Cree un bucket public pour les assets de branding : images inline, logos, etc.
-- Les images sont directement embarquees dans le corps HTML des emails
-- (src="<public_url>"), jamais en pièce jointe séparée.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- RLS: lecture publique, écriture pour les membres authentifiés du workspace
CREATE POLICY IF NOT EXISTS "brand-assets: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');

CREATE POLICY IF NOT EXISTS "brand-assets: authenticated upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'brand-assets' AND
    auth.role() = 'authenticated'
  );

CREATE POLICY IF NOT EXISTS "brand-assets: authenticated update own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'brand-assets' AND
    auth.role() = 'authenticated'
  )
  WITH CHECK (
    bucket_id = 'brand-assets' AND
    auth.role() = 'authenticated'
  );

CREATE POLICY IF NOT EXISTS "brand-assets: authenticated delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'brand-assets' AND
    auth.role() = 'authenticated'
  );
