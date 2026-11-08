-- Local disposable PostgreSQL only; real Storage tables are managed by Supabase.
DO $$ BEGIN IF current_database() NOT LIKE 'vettrack_phase2_clinic_%' THEN RAISE EXCEPTION 'Disposable database required';END IF;END $$;
ALTER TABLE auth.users ADD COLUMN last_sign_in_at timestamptz;
CREATE SCHEMA storage;
GRANT USAGE ON SCHEMA storage TO anon,authenticated,service_role;
CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean DEFAULT false,file_size_limit bigint,allowed_mime_types text[]);
CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text REFERENCES storage.buckets(id),name text,metadata jsonb,UNIQUE(bucket_id,name));
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT ALL ON storage.objects TO anon,authenticated,service_role;
GRANT SELECT ON storage.buckets TO authenticated;
-- Mirror the hosted Storage statement guard inspected on 2026-11-08.
CREATE FUNCTION storage.protect_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF coalesce(current_setting('storage.allow_delete_query',true),'false')<>'true' THEN
  RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.' USING ERRCODE='42501';
 END IF;RETURN NULL;
END $$;
CREATE TRIGGER protect_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();
