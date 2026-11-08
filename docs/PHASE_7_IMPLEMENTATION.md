# Fase 7 — implementación y checkpoints

Base main e2a9faed1a514228aa37ca43c7889b5db98904c3, limpia; origin Vector3232/VetTrack; companero SaulSimental777/VetTrack solo inspeccionado. Rama única feature/fase-7-superadmin-support-branding. Especificación autorizada: adjunto 3f7ae951-fd54-44aa-b403-d01eddb4fd93 (64 bloques). No Fase 8.

## Decisiones

- Superadmin: app_metadata actual, workspace global, métricas administrativas sin clínica. Gestión de Tenant y administradores, suspensión auditada sin borrar datos/Auth.
- Suspensión central en my_veterinaria/my_permissions; soporte permanece disponible para perfiles activos aun con Tenant suspendido.
- Tickets: admin ve los de su Tenant; otros usuarios sus propios tickets; Superadmin ve todos. No se agregan permisos innecesarios.
- Dos buckets privados: clinic-assets (logos, 5 MB PNG/JPEG) y clinic-files (compras/estudios/soporte, 10 MB PDF/PNG/JPEG). Misma reserva/metadatos/validación/lectura para todos. Escritura Storage solo backend tras autorización JWT y firma real del contenido; RLS de lectura sigue al padre. Sin URLs técnicas en formularios.
- Objetos inmutables con UUID. Reemplazar crea una versión; quitar logo elimina referencia activa. Un objeto usado en snapshots no se borra, para preservar documentos históricos. Los archivos sin referencias pueden borrarse mediante backend autorizado.
- Columnas de archivo nuevas junto a documento_url/archivo_url/foto_veterinaria existentes. Compatibilidad histórica explícita.
- PDFKit: renderer versionado para documentos futuros; no actualizar snapshots históricos. Logo del snapshot, no del catálogo actual; fallback sin logo.
- Compras: cierre solo desde pendiente y con compras.administrar, motivo obligatorio, sin cambios de stock/lotes. Recibir conserva FEFO/idempotencia.
- Propietario/pacientes: relación existente, proyección mínima/paginada y permisos independientes; no tabla intermedia.
- Citas: Hoy/Pendientes/Todas con paginación. Consultas distingue anteriores y en consulta. Próxima cita >= fecha local de consulta, sin otras restricciones médicas.

## Secuencia obligatoria

1. BD: migraciones CLI 20261108191709_platform_support_branding_files.sql y ajustes incrementales de política de auditoría; fixtures Storage locales; SQL BEGIN/ROLLBACK, regresión, suspensión, archivos, tenants, soporte, compras, fechas y aislamiento. Completado localmente.
2. Backend y tests, sin continuar con fallos críticos. Completado localmente.
3. Frontend, lint/build, cuatro roles responsive, uploads/errores. Completado localmente.
4. PDFs cortos/largos, con/sin logo, visualización de páginas. Completado localmente.
5. Regresiones completas 0–6, audits/advisors comparados, manuales actualizados + Superadmin. Completado localmente.
6. Solo tras validación local, aplicar migración real a yugbrcyrztwksiewzuvy. Fallo real → detener sin SQL alternativo. Preservación y SQL rollback/advisors remotos. Completado.
7. diff-check, commit exacto solicitado, push origin feature, ff main, push origin main, status limpio. Nunca escribir companero. Cierre autorizado tras checks correctos; referencias finales verificables en git.

## Evidencia local

- PostgreSQL desechable: Fase 7, Fases 2–6, clinical dos veces, inventario/lotes, pagos y aislamiento; todas las suites mantienen BEGIN/ROLLBACK. Se preservan fixtures legacy; concurrencia real en FEFO, pago idempotente y vincular/borrar archivo (solo una operación gana).
- Backend: 287/287; frontend lint/build correctos. Cinco suites Chrome con APIs simuladas: operaciones clínicas, consulta, inventario, UX final y plataforma F7. Cuatro roles y tamaños 1440/390; estas pruebas no se presentan como pruebas end-to-end de Auth real.
- PDFs: 16 documentos generados con PDFKit; PDF.js y canvas instalados solo en temporal para renderizar todas las páginas y revisar límites/texto/footer/firmas. Inspección de primeras y últimas páginas de las 16 variantes; casos largos de 4–16 páginas, pocos campos en una. Sin firma huérfana, texto montado ni páginas vacías. Renderer anterior conservado exactamente respecto a main; snapshots antiguos sin cambios.
- Auditoría de campos de archivo: proveedor, estudio, logo y soporte usan FileUpload; documento_url/archivo_url/foto_veterinaria históricos conservados. Ningún formulario solicita URL técnica para nuevas cargas.
- npm audit backend: 0. Frontend: 10 moderadas preexistentes en minimatch/cadena ESLint de desarrollo, 0 altas/críticas; sin dependencias runtime nuevas, sin fix --force ni downgrade mayor automático.
- Manuales de Administrador, Recepcionista, Médico y matriz actualizados; nuevo manual Superadmin con rutas/botones contrastados.

## Integridad y arquitectura

Se separan dos buckets privados por límite y MIME, con la misma arquitectura de reservas/metadatos/lectura. Rutas inmutables por Tenant/categoría/UUID. Backend usa service_role solo después de validar JWT, autorización del padre, estado, tamaño, firma real y dimensiones; nunca entrega su clave al cliente. Lectura usa JWT/Storage RLS, no enlaces públicos. Storage rechaza escritura directa, incluso ante políticas permisivas ajenas. SQL no puede inspeccionar los bytes: el bucket limita MIME/tamaño y el backend inspecciona el contenido. ACL de metadatos sin acceso directo authenticated/anon.

Eliminar requiere creador, autorización y ausencia de referencias, con bloqueo de fila; vincular y crear snapshots bloquean esa misma fila. Un logo histórico sigue disponible tras reemplazar o quitar la identidad actual. Suspensión central invalida Tenant/permisos aun con JWT anterior; soporte sigue disponible a perfiles activos. Catálogo/roles/Superadmin existentes conservados. Próxima cita usa fecha local de inicio de consulta, sin reescribir fechas históricas.

Integridad remota se compara mediante conteos y hashes de las 44 tablas públicas previas, todos sus campos anteriores (incluidos estados y snapshots), Auth y objetos Storage; se omiten únicamente las columnas nuevas. Las suites remotas usarán UUID aleatorio y ROLLBACK; objetos Storage de prueba son solo metadatos revertidos, sin tocar binarios reales.

## Supabase real: resultado

Proyecto autorizado yugbrcyrztwksiewzuvy. Migraciones aplicadas correctamente por el mecanismo MCP de migraciones (el servidor asigna la versión registrada):

| Archivo local | Versión remota | Resultado |
|---|---|---|
| 20261108191709_platform_support_branding_files.sql | 20261108203106 | Correcto |
| 20261108203459_platform_audit_policy_initplan.sql | 20261108203603 | Correcto |
| 20261108203854_platform_audit_auth_uid_initplan.sql | 20261108203954 | Correcto |

La primera migración mantuvo SHA-256 1a40f5c53dee83b05eb1bbd3eba064263e0cc62341536c7c99131ff2d02fc2ba; no se editó después de aplicarse. Las dos siguientes solo optimizan la política de auditoría sin alterar permisos ni alcance. EXPLAIN confirmó InitPlan; el subselect directo de auth.uid eliminó además el aviso del linter.

Pasaron platform_support_branding, final_operations, clinical, inventory_lots, inventory, users_roles_permissions, tenant_isolation y clinic_operations_remote con BEGIN/ROLLBACK. Fase 7 se repitió tras el último ajuste de política. Los hashes/conteos de las 44 tablas públicas anteriores, Auth y objetos Storage coinciden antes/después; sin fixtures persistentes. Los cuatro nuevos registros de soporte/archivo/auditoría quedaron vacíos tras las pruebas. Se preservan Auth, perfiles, roles, catálogo de 82 permisos, snapshots, estados previos e historial; experto sigue vacío. Todas las clínicas anteriores quedan activas y su fecha de creación desconocida permanece NULL.

El primer ensayo de la suite detectó que Storage real rechaza DELETE SQL antes de RLS. Se actualizó exclusivamente la prueba y su fixture local para admitir 42501 y comprobar además el gate RLS con la bandera transaccional de la API. Solo se apuntó a metadatos de los Tenants aleatorios de prueba y se mantuvo ROLLBACK; no se corrigieron datos reales ni se alteró la migración aplicada.

Buckets clinic-assets/clinic-files privados, límites/MIME correctos y cuatro políticas Storage verificadas. Las cuatro tablas nuevas tienen RLS y carecen de grants directos para anon/authenticated; el RPC público es invoker, autenticado y guardado. Superadmin continúa exclusivamente en app_metadata y no accede a clínica rutinaria.

## Advisors y audits finales

- Security: sin hallazgos nuevos. Preexistentes: 25 advertencias GraphQL authenticated bajo RLS, protección de contraseñas filtradas deshabilitada y 2 INFO por tablas cerradas sin políticas. Referencias: [GraphQL](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed), [protección de contraseñas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
- Performance: sin WARN nuevos tras la corrección. Permanecen 19 INFO de FK sin índice y 2 WARN de políticas permisivas anteriores. Índices sin uso: 34 antes, 43 después; 11 avisos INFO nuevos, mientras 2 anteriores desaparecieron por uso. Se mantienen índices de Tenant/FK/búsqueda aunque la muestra sea pequeña o las tablas estén vacías. [Índices sin uso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), [políticas permisivas](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies).
- npm audit backend: 0; frontend completo: 10 moderadas preexistentes de desarrollo, 0 altas/críticas; frontend --omit=dev: 0. Sin fix --force ni cambios de dependencias runtime.
