BEGIN;
-- Keep the actor lookup explicit so both Postgres and the RLS linter see its InitPlan.
ALTER POLICY platform_audit_read ON public.auditoria_plataforma
 USING ((SELECT private.is_superadmin((SELECT auth.uid()))));
COMMIT;
