BEGIN;
-- Resolve auth_rls_initplan without changing the scope or grants of this policy.
ALTER POLICY platform_audit_read ON public.auditoria_plataforma
 USING ((SELECT private.is_superadmin(auth.uid())));
COMMIT;
