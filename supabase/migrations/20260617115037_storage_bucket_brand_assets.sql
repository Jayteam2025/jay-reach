-- ============================================================================
-- STORAGE BUCKET: brand-assets (public, pour les images inline emails)
-- ============================================================================
-- Cree un bucket public pour les assets de branding : images inline.
-- Les images sont directement embarquees dans le corps HTML des emails
-- (src="<public_url>"), jamais en piece jointe separee.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('brand-assets', 'brand-assets', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- RLS storage.objects : Postgres ne supporte pas CREATE POLICY IF NOT EXISTS
-- -> DROP IF EXISTS puis CREATE (idempotent).
DROP POLICY IF EXISTS "brand-assets: public read" ON storage.objects;
CREATE POLICY "brand-assets: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'brand-assets');

DROP POLICY IF EXISTS "brand-assets: authenticated upload" ON storage.objects;
CREATE POLICY "brand-assets: authenticated upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'brand-assets' AND
    auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "brand-assets: authenticated update own" ON storage.objects;
CREATE POLICY "brand-assets: authenticated update own"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'brand-assets' AND
    auth.role() = 'authenticated'
  )
  WITH CHECK (
    bucket_id = 'brand-assets' AND
    auth.role() = 'authenticated'
  );

DROP POLICY IF EXISTS "brand-assets: authenticated delete own" ON storage.objects;
CREATE POLICY "brand-assets: authenticated delete own"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'brand-assets' AND
    auth.role() = 'authenticated'
  );
