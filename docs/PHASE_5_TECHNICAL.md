# Fase 5: inventario, proveedores y compras

Implementada sobre Fase 4, sin pagos, facturación, rediseño general ni Fase 6.

## Migración y preservación

- Archivo: `supabase/migrations/20261107052705_inventory_suppliers_purchases.sql`.
- Proyecto autorizado: `yugbrcyrztwksiewzuvy`.
- Aplicada mediante Supabase `apply_migration`, nombre `inventory_suppliers_purchases`.
- Versión remota registrada: **20261107054505**.
- SHA256 del SQL aplicado: `6a772418464d480c7a5e31d06f2770a0ff94fe1623bf0345e810b7e7397e9f43`.
- No se modificaron migraciones previamente aplicadas.
- `producto` conserva sus columnas originales y `precio`; el precio de venta inicial copia el precio legacy disponible. El stock inicial es cero; cualquier existencia física se registra como movimiento.
- Nuevas tablas: `proveedor`, `compra`, `compra_detalle`, `venta_preparada`, `venta_preparada_detalle`, `movimiento_inventario`.
- `receta_detalle.id_producto` es opcional y tiene FK compuesta con Tenant. Una receta puede seguir registrándose sin inventario.
- Antes/después de las pruebas remotas: perfiles **8/8**, pacientes **4/4**, citas **2/2**, productos **0/0**, recetas **0/0**, consultas **0/0**. Ninguna compra, venta, proveedor o movimiento de prueba quedó guardado.
- Hashes antes/después idénticos: perfiles `cd4a6960fd83f4ce421ab744f0743906`, pacientes `691c0f424f2bd7e6f3c00d791091b0e2`, citas `d5fe15a0197684799426ca92ee8b5729`, Superadmin `b34d49625dc29a732742f5ca6b61033f`.

## Seguridad y operaciones

La API `/api/inventario/:operacion` utiliza exclusivamente el JWT del usuario y `vettrack_inventario`. Cada operación deriva el Tenant del perfil activo y exige su permiso funcional. Los identificadores externos se resuelven dentro del mismo Tenant. No se utiliza Auth Admin para inventario.

Todas las tablas tienen RLS. Se revocan accesos directos de `anon` y `authenticated`, incluidos grants de columnas; las lecturas y escrituras pasan por RPC. La función pública es SECURITY INVOKER; el dispatcher privado es SECURITY DEFINER con `search_path` vacío y autorización interna. La primitiva de movimiento no tiene EXECUTE para clientes.

Los precios de compra sólo aparecen en el catálogo RPC si existe `compras.ver`. Las respuestas no incluyen la columna legacy `precio`. Médicos y recepción no tienen proveedores/compras por defecto. Superadmin mantiene su separación mediante `app_metadata.super_admin`; `experto` sigue sin uso.

Se agregan **13** permisos nuevos, preservando los previos: catálogo total **82**; defaults admin **82**, médico **36**, recepción **25**. Las regresiones comprueban las claves exactas, además de los conteos.

- Entradas y compras aumentan existencias. Salidas, ventas y aplicaciones clínicas las disminuyen. Ajustes aceptan cantidad con signo, siempre con motivo.
- El movimiento guarda producto, cantidad firmada, stock anterior/nuevo, usuario, fecha, referencia e idempotencia. No existen rutas para editar o borrar el historial.
- Los RPC bloquean perfil/clínica y producto. No permiten stock negativo. Una clave repetida devuelve el movimiento original; reutilizarla con otro producto, cantidad o tipo se rechaza.
- Recibir una compra es atómico e idempotente. Cada detalle genera un único movimiento y actualiza el último costo de compra. Un error revierte toda la recepción.
- Preparar venta libre congela nombre/precio y no reserva ni descuenta stock. La confirmación de entrega física descuenta una sola vez. La disponibilidad se valida en ese momento; no se registra un cobro.
- Grupo I, productos sin clasificar y medicamentos que requieren receta no pueden evadir controles mediante venta libre. La clasificación de medicamentos vinculados se obtiene del catálogo, aunque el cliente envíe otro grupo.
- Recetar para casa nunca descuenta stock. La aplicación en clínica exige consulta abierta, permiso y médico asignado o autorización para tomar consultas ajenas.
- La entrega de receta exige orden del Tenant y revisión finalizada, detalle solicitado para entrega, producto vinculado y clasificación admitida. Para Grupo II/producto con receta requerida también debe existir el documento de receta simple de esa revisión. Grupo I no se entrega por este flujo.
- Las entregas guardan vínculo compuesto al detalle y son idempotentes. El estado entregado se consulta sin exponer diagnóstico, notas clínicas ni costo de compra. No se puede reabrir una consulta con entregas físicas, igual que el bloqueo previo de órdenes procesadas.

## UI y validación

Inventario contiene Medicamentos, Insumos, Venta libre, alertas de stock bajo y movimientos. Se activan Proveedores y Compras según permisos. La receta permite vínculo opcional con medicamento/stock disponible, y la consulta tiene registro de aplicación física. Recepción puede revisar y confirmar entregas sin ver contenido clínico.

- Backend: **239/239** tests. Incluyen JWT/permisos, DTO, Tenant inyectado, cantidades/precios, idempotencia enviada al RPC, compras, entrega física, receta opcional y PDFs reales de Fase 4.
- Frontend: lint y build correctos.
- Tres suites de navegador con Chrome y Auth/API simuladas, sin tráfico a Supabase: agenda; operación clínica/expediente/PDF/aplicación/receta vinculada/entrega; inventario/proveedores/compras/stock/roles.
- `node supabase/tests/run-inventory-local.cjs`: PostgreSQL 17 desechable; aplica Fases 2–5, repite suite clínica, ejecuta inventario y regresiones, verifica producto/precio legacy, y prueba dos conexiones concurrentes contra stock limitado y reintentos idénticos.
- Supabase real: `inventory.sql`, `clinical.sql`, `users_roles_permissions.sql`, `tenant_isolation.sql`, `clinic_operations_remote.sql`; todas con `BEGIN/ROLLBACK`, correctas.
- `git diff --check` correcto. Auditoría backend: **0 vulnerabilidades**, Express **5.3.0**, body-parser **2.4.0**, proxy-addr **2.0.8**.

## Advisors antes/después de Fase 5

Sin nuevos hallazgos de seguridad ni errores graves.

| Advisor | Antes | Después | Resultado |
| --- | ---: | ---: | --- |
| RLS sin policy (INFO) | 2 | 2 | Preexistentes: refugio/solicitudadopcion |
| Objetos visibles en GraphQL autenticado (WARN) | 25 | 25 | Preexistentes, protegidos por permisos/RLS |
| Protección de contraseñas filtradas desactivada (WARN) | 1 | 1 | Preexistente |
| FK sin índice (INFO) | 22 | 21 | Sin nuevos; mejora un hallazgo |
| Índices sin uso (INFO) | 23 | 32 | 10 índices nuevos aún sin uso y uno previo dejó de reportarse |
| Policies permisivas múltiples (WARN) | 2 | 2 | Preexistentes |

Se conservan los índices de integridad/búsqueda aunque todavía no exista tráfico del nuevo módulo. No se cambiaron ajustes de Auth ni políticas de módulos ajenos para silenciar avisos.

Pendientes fuera de alcance: Fase 6, rediseño guardado en `UI_REDESIGN_NOTES.md` y documento Avance 3.
