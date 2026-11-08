# Fase 6 y experiencia de usuario final

Validación: 7 de noviembre de 2026. Base: `2a9cb509795a9769ef7b8f60239ace7ca0173277`; rama de implementación: `feature/fase-6-final-ux`.

## Operación

- **Pagos:** consulta finalizada → orden administrativa → entregas físicas → revisar importe → confirmar pago recibido → orden procesada. Se utiliza `pago` existente, sin gateway, pagos parciales ni integración bancaria. El servidor calcula y redondea el total; el cliente no puede enviar importe, precio, Tenant ni estado. El bloqueo de la orden y su unicidad evitan doble registro, incluso entre dos sesiones.
- **Precios históricos:** los servicios conservan el snapshot de la orden; la primera entrega física de un medicamento vinculado guarda `precio_unitario_aplicado`. Los reintentos no lo recalculan. Una entrega anterior sin precio guardado se bloquea para revisión, sin asignarle el precio actual. La prueba cambia catálogo de 450/40 a 999 y conserva total 530 = 450 + 2 × 40.
- **Dashboard:** datos reales de citas, consultas, pacientes, órdenes, pagos e inventario, según permiso funcional. Médico: citas/consultas propias. Próximas citas y enlaces a módulos autorizados; sin actividad ficticia.
- **Reportes:** diez tipos existentes en `reportTypes`, Tenant y permisos del módulo además de `reportes.ver`. Periodos de hasta 366 días; hasta 1000 filas. Historial individual filtra el conjunto de eventos autorizado antes de limitar; probado con un evento antiguo precedido por más de 200 recientes. Pacientes y stock bajo son listados actuales: no se inventa fecha de registro de mascota.
- **Configuración:** nombre, dirección, teléfono, correo, horario, descripción e imagen HTTPS de la veterinaria actual. Solo columnas reales; sin ajustes sin persistencia.

## UX y continuidad

Se conserva la identidad verde de VetTrack y las funciones de Fases 0–5B. Shell, navegación móvil, cabecera con usuario/rol/clínica/cierre de sesión, tablas, formularios, estados y mensajes comparten `design-system.css`. `SearchableSelect` concentra buscar/seleccionar/limpiar en un control con estados de carga, vacío, teclado y ARIA. Abre hacia arriba cuando falta espacio y desplaza la opción activa a la vista. `Icon`, `StatusBadge` y `ConfirmProvider` unifican iconos SVG, estados y resúmenes de confirmación.

Citas usa cuatro pasos con creación inline autorizada de propietario/paciente, múltiples servicios, horarios/disponibilidad y resumen. Especialidad nunca impide asignación. Las duraciones se muestran como `20 h 3 min`, manteniendo minutos en BD. Consultas organiza diez secciones, edita registros dentro de la página y conserva cierre, documentos, reapertura y resumen. Expediente mantiene timeline y paginación. Inventario conserva FEFO, lotes, recetas sin descuento automático, uso físico, ventas preparadas, compras divididas por lote, documento del proveedor y recepciones recientes. Usuarios conserva contraseñas, estados y personalizaciones; permite cédula médica al administrador.

Se mantienen los permisos reales: 82 para admin, 36 para médico y 25 para recepcionista. En particular, `venta_libre.ver` y `venta_libre.preparar` no están en los defaults actuales de recepción; deben delegarse para listar/preparar ventas. El catálogo de productos Venta libre se consulta con `inventario.ver`. No se amplían defaults silenciosamente.

## Migración aplicada

- Proyecto: `yugbrcyrztwksiewzuvy`.
- Archivo CLI incremental: `supabase/migrations/20261107182416_final_operations_payments_reports.sql`.
- Versión registrada por Supabase MCP: **`20261107192435`**, nombre `final_operations_payments_reports`. El mecanismo remoto asigna su versión al aplicar; no se renombra el archivo ni se modifica su SQL.
- SHA-256 del SQL aplicado: `ea60be7af37315b831c3afdcee44a135573de75169e4a586b90e891c2f35c566`.
- Extiende `pago` y `movimiento_inventario`; agrega RPCs de operación final/cédula y tres métodos de registro de pago. No modifica migraciones anteriores ni crea permisos nuevos.

| Datos existentes | Antes | Después de migración y suites rollback |
|---|---:|---:|
| Perfiles | 8 | 8 |
| Pacientes | 4 | 4 |
| Citas | 3 | 3 |
| Consultas | 1 | 1 |
| Pagos | 0 | 0 |

Las huellas del contenido completo de esas cinco tablas coinciden antes/después. No se reescribieron propietarios históricos ni pacientes. Los fixtures aleatorios y usuarios Auth insertados por las suites se descartaron mediante ROLLBACK. No hubo cobros ni altas reales de usuarios de prueba mediante Auth Admin.

## Validaciones

| Capa | Resultado |
|---|---|
| Backend `npm.cmd test` | 253/253, sin omitidos |
| Frontend `npm.cmd run lint` | Pasa |
| Frontend `npm.cmd run build` | Pasa; TypeScript y Vite 8.3.6 |
| `git diff --check` | Pasa |
| PostgreSQL 17 desechable | Siete suites más clínica repetida; preservación y concurrencia FEFO/pago pasan |
| Supabase real, BEGIN/ROLLBACK | `final_operations`, `clinical`, `inventory_lots`, `inventory`, `users_roles_permissions`, `tenant_isolation`, `clinic_operations_remote`: pasan |
| Navegador local | Cuatro suites CDP/Chrome: operación, clínica, inventario y UX final; pasan |

Las pruebas de navegador ejecutan React real con Auth/API simulados y bloquean llamadas externas; cubren flujo y visibilidad. La autorización persistente se comprueba por separado con HTTP tests y las suites SQL sobre Supabase real bajo JWT de fixtures. No se presentan las simulaciones como sesiones reales de usuarios finales. Se revisaron los tres roles en 1440 px y 390 px y todas sus rutas permitidas, sin overflow de página; hay desplazamiento interno de tablas. Se inspeccionaron capturas de dashboard, asistente móvil y consulta. Las capturas viven en carpetas temporales, no en el repositorio.

## Manuales derivados del frontend final

- [Administrador](MANUAL_ADMINISTRADOR.md)
- [Recepcionista](MANUAL_RECEPCIONISTA.md)
- [Médico](MANUAL_MEDICO.md)
- [Matriz de pantallas y permisos](MATRIZ_PANTALLAS_PERMISOS.md)

Se revisaron las 17 rutas finales y 98 grupos de acciones, campos y validaciones. La [inspección previa](PHASE_6_INSPECTION.md) conserva el inventario de componentes anterior a los cambios; los manuales describen el resultado final. La [auditoría](SECURITY_FINAL_AUDIT.md) detalla los hallazgos residuales sin ocultarlos. No se implementa Fase 7.
