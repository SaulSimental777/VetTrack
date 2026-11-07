# Auditoría final de Fase 6

Proyecto `yugbrcyrztwksiewzuvy`, 7 de noviembre de 2026. Comparación de advisors inmediatamente antes y después de aplicar `final_operations_payments_reports`; no se modifican políticas de otros módulos ni datos para resolver hallazgos preexistentes.

## Rutas y autorización

Se revisaron todos los routers montados en `backend/index.js`: propietarios, pacientes, usuarios, especialidades, sesión, médicos, servicios, citas, clínica, inventario, operación final y tenants. Únicamente `/` y `/api/health` son públicos y devuelven salud del servicio. Cada router de clínica valida JWT mediante `auth.getUser(token)`, carga perfil activo y permisos efectivos de BD y usa un cliente con el JWT del usuario. Los routers de inventario/operación validan además la lista permitida de operaciones y campos; las mutaciones no se ejecutan por GET. Clínica añade la restricción de rol admin/médico para historia, diagnósticos y demás registros; recepción usa exclusivamente órdenes y documentos administrativos.

Los endpoints de usuarios validan permiso y pertenencia del objetivo antes de Auth Admin. `last_sign_in_at` sale del backend mediante una proyección explícita; no se devuelve el registro Auth completo. La gestión de cédula ajena requiere admin y usuarios.editar, Tenant del actor y objetivo médico que no sea Superadmin. Los helpers SQL consultan metadatos Auth actuales para excluir a Superadmin.

La navegación es una capa adicional: 17 rutas autorizadas por `can`, estados y rol clínico cuando corresponde. Cambiar hash o enviar una petición manual no elude HTTP/RPC/RLS. Pruebas cubren usuario inactivo, otro Tenant, permisos individuales permitidos/denegados y restricciones de recepción/médico.

## Comprobación real de BD

- **44 tablas públicas con RLS habilitada**; ninguna sin RLS.
- **anon sin privilegios de tabla ni de columna** sobre tablas públicas, incluyendo privilegios heredados de PUBLIC. Sin EXECUTE sobre las nuevas RPCs/helpers.
- `pago` no concede SELECT/INSERT/UPDATE/DELETE directos a authenticated; solo operaciones verificadas. Sus referencias compuestas conservan Tenant y una orden admite un único pago.
- `vettrack_operacion_final` y `vettrack_usuario_cedula`: SECURITY INVOKER con search_path vacío. Los dispatchers `private.fin_api` y `private.fin_license`: SECURITY DEFINER con search_path vacío y autorización del actor. Primitivas `fin_order` y `fin_report`: sin EXECUTE a authenticated/anon; solo se usan desde el dispatcher.
- Las demás funciones SECURITY DEFINER de los módulos anteriores mantienen su ACL y guards existentes. La redefinición de `inv_move` conserva su firma y no abre acceso directo a authenticated. La proyección de médicos agrega únicamente cédula profesional.
- El frontend usa `VITE_SUPABASE_ANON_KEY`. La inspección local de variables y código no encontró credenciales service_role/sb_secret ni operaciones Auth Admin en frontend. Las cadenas internas `service_role` del SDK no son claves ni config de la aplicación. No se imprimieron valores de `.env`.
- Superadmin sigue dependiendo exclusivamente de `app_metadata.super_admin === true`. Huella agregada de metadatos Auth idéntica antes/después; no se crea rol clínico superadmin. Roles finales: admin/recepcionista/medico. `experto` continúa con cero filas y sin uso.
- Catálogo/defaults intactos: 82 permisos; admin 82, médico 36, recepción 25. Las suites probaron tanto permitir como denegar en usuario_permiso.

Las siete suites SQL reales se ejecutaron con BEGIN/ROLLBACK. Las huellas completas de perfiles, pacientes, citas, consultas y pagos coinciden después de las pruebas. Los fixtures se insertan con UUID aleatorio en tenants nuevos, sin corregir datos reales.

## Security Advisors

**Ningún hallazgo nuevo.**

| Hallazgo | Antes | Después | Lectura |
|---|---:|---:|---|
| RLS enabled, no policy (INFO) | 2 | 2 | refugio y solicitudadopcion cerradas, sin grants anon |
| Tablas visibles en GraphQL authenticated (WARN) | 25 | 25 | Descubrimiento de esquema preexistente; las lecturas siguen sujetas a RLS/permiso |
| Leaked password protection disabled (WARN) | 1 | 1 | Configuración Auth preexistente; no se habilitó como efecto lateral |

Referencias: [RLS sin política](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [visibilidad GraphQL](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed), [protección de contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Performance Advisors

| Hallazgo | Antes | Después |
|---|---:|---:|
| FK sin índice de cobertura (INFO) | 21 | 19 |
| Índices aún no utilizados (INFO) | 35 | 34 |
| Políticas permisivas múltiples (WARN) | 2 | 2 |

La comparación por detalle, no solo por conteo, identifica **cuatro INFO nuevos**: `pago_orden_tenant_fk` sin índice compuesto de cobertura y `pago_usuario_idx`, `pago_cita_idx`, `pago_metodo_idx` sin uso registrado. La FK de orden sí dispone de la unicidad/indexación de id_orden, que identifica una sola fila; no se agrega otro índice redundante sin evidencia de carga. Los índices nuevos de una tabla de pagos vacía pueden no tener uso registrado. Se cubrieron tres FK simples preexistentes con los índices nuevos; otros índices fueron usados durante validación. No hay WARN de rendimiento nuevos; las dos políticas múltiples de especialidades ya existían.

Referencias: [FK sin índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [índice sin uso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [políticas múltiples](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).

## npm audit

- Backend: **0 vulnerabilidades**, comando con salida 0.
- Frontend inicial: 14 (4 altas, 10 moderadas). Actualizaciones compatibles de paquetes padre y transitivos eliminaron las altas; Vite 8.3.6, ESLint 10.14.0 y typescript-eslint 8.72.1.
- Frontend final: **10 moderadas, 0 altas, 0 críticas**, todas en herramientas de desarrollo por minimatch 10.2.6 y su propagación a ESLint/typescript-eslint. `npm audit` sale con código 1 por estos hallazgos; no se presenta como auditoría en cero. Las dependencias de ejecución no incluyen esa cadena.
- El minimatch corregido es 11.x; los padres actuales siguen declarando 10.x. Se conserva la compatibilidad declarada: no se ejecuta audit fix --force, no se fuerza una major transitiva ni se retrocede de major ESLint automáticamente. No hay override agregado. El riesgo residual es denegación de servicio con patrones glob adversarios al ejecutar herramientas de desarrollo sobre entradas no confiables; los formularios de VetTrack no ejecutan ESLint.

Referencia primaria del hallazgo restante: [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). Revisar cuando los paquetes padre publiquen soporte para el matcher corregido. Lint, build, tests HTTP/SQL y navegador pasan con el lockfile final.

## Límites de la evidencia

Navegador automatizado: React real, APIs simuladas, escritorio/móvil y tres roles; no usa credenciales de personas reales. HTTP: 253 tests, con dobles de Auth/RPC cuando corresponde. Persistencia/autorización: suites sobre PostgreSQL local y Supabase real bajo contexto JWT de fixtures y rollback. Concurrencia física y pago: dos conexiones en PostgreSQL local desechable. No se afirma una sesión de navegador extremo a extremo contra cuentas productivas.

No se escriben datos, ramas ni commits en companero. No se alteran secretos, migraciones previas ni el modelo de permisos. No se inicia Fase 7.
