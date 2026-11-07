# Extensión de Fase 5: lotes, caducidades y recepción

Incremental sobre `83f3a864913fdfa357cbaa1410022fa04fd6e0f6`. No modifica archivos de migraciones anteriores, permisos, Superadmin ni módulos ajenos. No incluye Fase 6 ni rediseño.

## Migración

- Archivo: `supabase/migrations/20261107061648_inventory_lots_expiry_receipts.sql`.
- Proyecto: `yugbrcyrztwksiewzuvy`.
- Aplicada mediante Supabase `apply_migration`, nombre `inventory_lots_expiry_receipts`.
- Versión remota: **20261107062820**.
- SHA256 del archivo enviado: `cdff32ac3b7c96d56aee276407244a95216a64a487b5bae9e188c575d5031634`.

`lote_inventario` conserva producto/Tenant, detalle solicitado y detalle recibido opcionales, número de lote, caducidad nullable, cantidades inicial/actual, recepción, estado activo y origen. `cantidad_inicial>0` y `0<=cantidad_actual<=cantidad_inicial`. No se guarda caducidad en producto.

`recepcion_compra_detalle` conserva las líneas físicas de recepción con cantidad, precio, lote y caducidad. Permite varios lotes del mismo producto sin alterar la cantidad/precio originalmente solicitados en `compra_detalle`. `movimiento_lote` relaciona cada entrada/salida con sus lotes y cantidades firmadas. Las FK compuestas evitan referencias a otro producto o Tenant.

`compra` incorpora fecha de solicitud, fecha y folio del documento, URL HTTPS nullable y observaciones. La solicitud histórica se obtiene de su fecha original de creación. No se descargan documentos ni se implementa almacenamiento de archivos.

## Stock e idempotencia

Se mantiene el historial original de movimientos. La función de movimiento existente conserva su OID y añade asignación de lotes; todos los flujos previos de venta, entrega de receta y aplicación clínica usan el mismo control. Las primitivas internas no son ejecutables por clientes.

- Una recepción crea líneas físicas, movimientos y lotes en la misma transacción. La compra cambia a recibida al terminar. Reintentar una compra recibida no duplica stock ni lotes.
- La recepción es completa: la suma de líneas de cada producto debe coincidir con la cantidad solicitada. No se agregan recepciones parciales ni contabilidad.
- Cada línea física puede tener cantidad y precio propios. El costo de compra actual conserva el criterio previo de último costo recibido; los precios de cada recepción quedan guardados.
- Si un producto empieza a manejar lotes teniendo saldo previo, ese saldo se registra como `saldo_previo`, sin inventar número ni caducidad y sin reescribir movimientos anteriores.
- Una entrada posterior sin número para un producto ya controlado por lotes crea saldo identificado como `sin_lote`. Productos que nunca registraron lotes ni recepciones mantienen el comportamiento anterior.
- El stock físico total coincide con la suma de saldos de lotes de productos controlados. Incluye mercancía caducada conservada físicamente; no equivale a disponibilidad vigente.
- Las salidas usan FEFO: caducidad vigente más cercana, recepción y UUID para desempate; sin caducidad al final. Excluyen lotes caducados e inactivos. La fecha de hoy sigue siendo vigente; caducado significa fecha menor a hoy en `America/Tijuana`.
- Si el saldo vigente no alcanza, se revierte toda la operación, incluidos movimiento y asignaciones. Los reintentos idempotentes no vuelven a descontar lotes.
- No se elimina automáticamente mercancía caducada. Esta extensión no añade bajas manuales dirigidas a lotes caducados.

## API y UI

Se extiende `/api/inventario/:operacion` y el RPC JWT existente:

- `lotes`: producto opcional, estado `todos/activos/caducados/proximos`, ventana 30/60/90 días; retorna saldo, estado y procedencia restringida.
- `recepciones`: ventana 7/30/90 días, default 7; incluye proveedor, fecha, referencia/folio/documento y cantidades, precios, lotes/caducidades de las líneas recibidas. Para compras recibidas antes de esta extensión muestra los detalles originales sin inventar datos de lote.
- `mover`: entrada con número/caducidad opcionales; las salidas siguen asignación automática FEFO.
- `compra_crear`: metadatos del documento/solicitud opcionales.
- `compra_recibir`: líneas `recepciones` con detalle solicitado, cantidad, precio, lote/caducidad; metadatos del documento. El payload anterior `{id}` sigue siendo compatible.
- Catálogos: alertas agregadas de lotes caducados y próximos a 30 días, sin revelar costos de compra.

Inventario permite **Ver lotes** por producto y una pestaña **Caducidades** con filtros 30/60/90. Los estados son VIGENTE, PRÓXIMO A CADUCAR, CADUCADO y AGOTADO. Las entradas manuales permiten capturar lote/caducidad. La recepción permite dividir un producto entre varios lotes, validar cantidades y conservar documento del proveedor. Compras incluye **Recepciones recientes**, con últimos 7 días por defecto. Recibir mercancía ya caducada muestra aviso y la conserva identificada.

## Seguridad y validación

No se agregan permisos redundantes: lectura de lotes usa `inventario.ver`, entradas `inventario.ajustar`, documentos/historial `compras.ver` y recepción `compras.recibir`. El catálogo de 82 permisos y defaults 82/36/25 permanecen iguales.

Las tres tablas nuevas tienen RLS, Tenant obligatorio y acceso directo revocado a `anon` y `authenticated`, incluidos grants de columnas. El dispatcher privado valida perfil activo, Tenant y permiso. La función pública continúa SECURITY INVOKER; helpers privados con SECURITY DEFINER y `search_path` vacío. Se revoca ejecución al dispatcher anterior para impedir omitir esta extensión. Usuarios sin `compras.ver` no reciben procedencia del proveedor ni documentos a través de lotes.

- Backend: **243/243** tests.
- Frontend: lint y build correctos; tres suites de navegador con API/Auth simuladas, incluyendo recepción dividida, documento, últimos 7 días y filtros de lotes.
- PostgreSQL 17 local desechable: `node supabase/tests/run-inventory-lots-local.cjs`; nueva suite, regresiones, preservación legacy y dos conexiones concurrentes. Sólo una salida puede consumir stock limitado; reintentos idénticos conservan saldo/asignaciones coherentes.
- Supabase real, todas con `BEGIN/ROLLBACK`: `inventory_lots.sql`, `inventory.sql`, `clinical.sql`, `users_roles_permissions.sql`, `tenant_isolation.sql`, `clinic_operations_remote.sql`.
- Antes/después: perfiles 8/8, pacientes 4/4, citas 2/2, productos/compras/movimientos 0/0. No quedaron lotes, recepciones ni asignaciones de prueba.
- Hashes idénticos de perfiles `cd4a6960fd83f4ce421ab744f0743906`, pacientes `691c0f424f2bd7e6f3c00d791091b0e2`, citas `d5fe15a0197684799426ca92ee8b5729` y Superadmin `b34d49625dc29a732742f5ca6b61033f`.

Advisors de seguridad sin hallazgos nuevos: RLS sin policy INFO 2/2, GraphQL autenticado WARN 25/25 y protección de contraseñas filtradas WARN 1/1, todos preexistentes. Rendimiento: FK sin índice INFO 21/21, policies permisivas múltiples WARN 2/2, índices sin uso INFO 32/36 (cinco índices nuevos aún sin uso; uno anterior dejó de reportarse). No se eliminan índices de integridad/búsqueda por falta de tráfico inicial.
