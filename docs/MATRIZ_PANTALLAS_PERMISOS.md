# Matriz de pantallas y permisos — VetTrack

Revisada contra clinicRoutes de App.tsx, componentes finales y catálogo real: 82 permisos; admin 82, recepcionista 25, médico 36. Sí/No son defaults; usuario_permiso puede permitir/denegar salvo restricciones de rol. Las pantallas de clínica exigen sesión activa y Tenant activo; soporte admite el Tenant suspendido con perfil activo. `&` exige ambos; `/` separa permisos de distintas acciones agrupadas o tipos de documento. Cada acción necesita además el permiso de su ruta.

| Pantalla | Acción | Admin | Recepcionista | Médico | Permiso requerido |
|---|---|---|---|---|---|
| Dashboard (/dashboard) | Abrir pantalla | Sí | Sí | Sí | dashboard.ver |
| Dashboard | Tarjetas de indicadores | Sí | Sí | Sí | dashboard.ver |
| Dashboard | Abrir agenda | Sí | Sí | Sí | citas.ver |
| Propietarios (/propietarios) | Abrir pantalla | Sí | Sí | Sí | propietarios.ver |
| Propietarios | + Nuevo propietario / + Registrar primer propietario | Sí | Sí | No | propietarios.crear |
| Propietarios | Guardar propietario | Sí | Sí | No | propietarios.crear |
| Propietarios | Editar / Guardar cambios | Sí | Sí | No | propietarios.editar |
| Propietarios | Eliminar / Sí, eliminar | Sí | No | No | propietarios.eliminar |
| Pacientes (/pacientes) | Abrir pantalla | Sí | Sí | Sí | pacientes.ver |
| Pacientes | + Nuevo paciente | Sí | Sí | Sí | pacientes.crear |
| Pacientes | Guardar paciente | Sí | Sí | Sí | pacientes.crear / pacientes.editar |
| Pacientes | Editar | Sí | Sí | Sí | pacientes.editar |
| Pacientes | Eliminar / Eliminar paciente | Sí | No | No | pacientes.eliminar |
| Pacientes | Ver expediente | Sí | No | Sí | expediente.ver; rol admin/medico |
| Citas (/citas) | Abrir pantalla | Sí | Sí | Sí | citas.ver |
| Citas | + Nueva cita | Sí | Sí | No | citas.crear |
| Citas | Crear propietario | Sí | Sí | No | propietarios.crear |
| Citas | Crear paciente | Sí | Sí | Sí | pacientes.crear |
| Citas | Quitar | Sí | Sí | No | citas.crear / citas.editar |
| Citas | Siguiente / Anterior / Revisar cita | Sí | Sí | No | citas.crear / citas.editar |
| Citas | Ver todos los médicos / Actualizar disponibilidad | Sí | Sí | No | citas.crear / citas.editar |
| Citas | Usar hora fuera del horario semanal | Sí | No | No | citas.forzar_horario |
| Citas | Guardar cita | Sí | Sí | No | citas.crear / citas.editar |
| Citas | Editar | Sí | Sí | No | citas.editar |
| Citas | Cancelar cita / Confirmar cancelación | Sí | Sí | No | citas.cancelar |
| Citas | Atender | Sí | No | Sí | consultas.crear; rol admin/medico |
| Citas | Recargar | Sí | Sí | Sí | citas.ver |
| Consultas (/clinica) | Abrir pantalla | Sí | No | Sí | consultas.ver; rol admin/medico |
| Consultas | Iniciar consulta / Abrir consulta | Sí | No | Sí | consultas.crear |
| Consultas | Guardar consulta / Guardar indicaciones | Sí | No | Sí | consultas.editar |
| Consultas | + Registrar / Editar · Diagnósticos | Sí | No | Sí | diagnosticos.crear / diagnosticos.editar |
| Consultas | + Registrar / Editar · Tratamientos | Sí | No | Sí | tratamientos.crear / tratamientos.editar |
| Consultas | + Registrar / Editar · Vacunas | Sí | No | Sí | vacunas.crear / vacunas.editar |
| Consultas | + Registrar / Editar · Desparasitación | Sí | No | Sí | desparasitacion.crear / desparasitacion.editar |
| Consultas | + Registrar / Editar · Estudios | Sí | No | Sí | estudios.crear / estudios.editar |
| Consultas | + Registrar receta / Editar receta / Guardar receta | Sí | No | Sí | recetas.crear / recetas.editar |
| Consultas | Registrar aplicación | Sí | No | Sí | inventario.uso_clinico |
| Consultas | Agregar servicio | Sí | No | Sí | consultas.editar&servicios.ver |
| Consultas | Datos profesionales | Sí | No | Sí | consultas.editar |
| Consultas | Finalizar consulta / Confirmar finalización | Sí | No | Sí | consultas.finalizar |
| Consultas | Reabrir con motivo / Reabrir consulta | Sí | No | No | consultas.reabrir |
| Consultas | Descargar PDF | Sí | No | Sí | consultas.ver / tratamientos.ver / recetas.ver / orden_recepcion.ver |
| Consultas | Volver | Sí | No | Sí | consultas.ver |
| Expediente (/expediente) | Abrir pantalla | Sí | No | Sí | expediente.ver; rol admin/medico |
| Expediente | Paciente / Filtrar eventos | Sí | No | Sí | expediente.ver |
| Expediente | Más recientes / Más antiguas | Sí | No | Sí | expediente.ver |
| Expediente | Abrir consulta relacionada | Sí | No | Sí | consultas.ver |
| Órdenes de recepción (/ordenes-recepcion) | Abrir pantalla | Sí | Sí | Sí | orden_recepcion.ver |
| Órdenes de recepción | Revisar entregas / Confirmar entrega física | Sí | Sí | No | inventario.entregar |
| Órdenes de recepción | Revisar pago | Sí | Sí | No | pagos.ver |
| Órdenes de recepción | Descargar orden PDF | Sí | Sí | Sí | orden_recepcion.ver |
| Órdenes de recepción | Marcar procesada / Confirmar procesamiento | Sí | Sí | No | orden_recepcion.procesar |
| Médicos (/medicos) | Abrir pantalla | Sí | Sí | Sí | medicos.ver |
| Médicos | Recargar / Ver todos los médicos | Sí | Sí | Sí | medicos.ver |
| Médicos | Especialidades / Guardar especialidad | Sí | No | No | medicos.administrar |
| Médicos | Editar horario | Sí | No | No | horarios.administrar |
| Médicos | Ver horario | Sí | Sí | Sí | horarios.ver |
| Médicos | Bloqueos | Sí | Sí | Sí | horarios.ver |
| Médicos | Ver agenda | Sí | Sí | Sí | citas.ver |
| Horarios (/horarios) | Abrir pantalla | Sí | Sí | Sí | horarios.ver |
| Horarios | Veterinario | Sí | Sí | Sí | horarios.ver |
| Horarios | Ver bloqueos y ausencias | Sí | Sí | Sí | horarios.ver |
| Horarios | Agregar bloque / Quitar / Activo | Sí | No | No | horarios.administrar |
| Horarios | Guardar cambios | Sí | No | No | horarios.administrar |
| Horarios | Agregar bloqueo | Sí | No | No | horarios.administrar |
| Horarios | Eliminar / Confirmar | Sí | No | No | horarios.administrar |
| Horarios | Cerrar | Sí | Sí | Sí | horarios.ver |
| Servicios (/servicios) | Abrir pantalla | Sí | Sí | Sí | servicios.ver |
| Servicios | Recargar | Sí | Sí | Sí | servicios.ver |
| Servicios | + Nuevo servicio / Crear servicio | Sí | No | No | servicios.crear |
| Servicios | Editar / Guardar cambios | Sí | No | No | servicios.editar |
| Servicios | Cambiar precio | Sí | No | No | servicios.editar_precio |
| Servicios | Desactivar / Desactivar servicio | Sí | No | No | servicios.eliminar |
| Servicios | Reintentar especialidades | Sí | No | No | servicios.crear / servicios.editar |
| Inventario (/inventario) | Abrir pantalla | Sí | Sí | Sí | inventario.ver |
| Inventario | Medicamentos / Insumos / Venta libre / Caducidades | Sí | Sí | Sí | inventario.ver |
| Inventario | Ver lotes | Sí | Sí | Sí | inventario.ver |
| Inventario | Crear producto | Sí | No | No | inventario.crear |
| Inventario | Editar | Sí | No | No | inventario.editar |
| Inventario | Registrar movimiento / Confirmar movimiento / Confirmar movimiento físico | Sí | No | No | inventario.ajustar |
| Inventario | Movimientos | Sí | No | No | inventario.movimientos |
| Inventario | Preparar venta libre / Preparar entrega | Sí | Sí | No | venta_libre.preparar |
| Inventario | Entregas de venta libre | Sí | Sí | No | venta_libre.ver |
| Inventario | Confirmar entrega física / Confirmar entrega | Sí | No | No | venta_libre.ver & inventario.entregar |
| Proveedores (/proveedores) | Abrir pantalla | Sí | No | No | proveedores.ver |
| Proveedores | Crear proveedor | Sí | No | No | proveedores.crear |
| Proveedores | Editar proveedor | Sí | No | No | proveedores.editar |
| Compras (/compras) | Abrir pantalla | Sí | No | No | compras.ver |
| Compras | Crear compra | Sí | No | No | compras.crear |
| Compras | Agregar producto / Quitar | Sí | No | No | compras.crear |
| Compras | Compras registradas / Recepciones recientes | Sí | No | No | compras.ver |
| Compras | Recibir compra | Sí | No | No | compras.recibir |
| Compras | Dividir en otro lote / Quitar línea | Sí | No | No | compras.recibir |
| Compras | Confirmar recepción física / Confirmar recepción | Sí | No | No | compras.recibir |
| Compras | Documento del proveedor | Sí | No | No | compras.ver |
| Pagos (/pagos) | Abrir pantalla | Sí | Sí | No | pagos.ver |
| Pagos | Revisar pago / Ver detalle | Sí | Sí | No | pagos.ver |
| Pagos | Actualizar orden | Sí | Sí | No | pagos.ver |
| Pagos | Volver a pagos | Sí | Sí | No | pagos.ver |
| Pagos | Ir a órdenes de recepción | Sí | Sí | No | orden_recepcion.ver |
| Pagos | Registrar pago / Confirmar pago recibido | Sí | Sí | No | pagos.crear&orden_recepcion.procesar |
| Reportes (/reportes) | Abrir pantalla | Sí | No | No | reportes.ver |
| Reportes | Consultar reporte | Sí | No | No | reportes.ver |
| Reportes | Abrir consulta | Sí | No | No | consultas.ver; rol admin/medico |
| Configuración (/configuracion) | Abrir pantalla | Sí | No | No | configuracion.ver |
| Configuración | Guardar configuración | Sí | No | No | configuracion.editar |
| Usuarios (/configuracion/usuarios) | Abrir pantalla | Sí | No | No | usuarios.ver |
| Usuarios | + Nuevo usuario / Crear usuario | Sí | No | No | usuarios.crear |
| Usuarios | Editar / Guardar cambios | Sí | No | No | usuarios.editar |
| Usuarios | Contraseña / Cambiar contraseña | Sí | No | No | usuarios.editar |
| Usuarios | Desactivar / Desactivar usuario / Reactivar / Reactivar usuario | Sí | No | No | usuarios.desactivar |
| Usuarios | Permisos / Guardar permisos | Sí | No | No | usuarios.permisos; rol admin |
| Usuarios | Restaurar permisos del rol | Sí | No | No | usuarios.permisos; rol admin |
| Usuarios | + Crear especialidad / Crear y seleccionar / Cancelar especialidad | Sí | No | No | usuarios.crear |
| Usuarios | Recargar / Reintentar | Sí | No | No | usuarios.ver |

## Reportes: requisito adicional a reportes.ver

| Reporte | Permiso funcional | Restricción adicional |
|---|---|---|
| Agenda de citas | citas.ver | Médico: agenda asignada |
| Pacientes registrados | pacientes.ver | Listado actual |
| Historial clínico por paciente | expediente.ver | admin/medico; cada tipo conserva su permiso |
| Seguimiento de vacunas | vacunas.ver | admin/medico |
| Seguimiento de desparasitaciones | desparasitacion.ver | admin/medico |
| Seguimiento de tratamientos | tratamientos.ver | admin/medico |
| Servicios realizados | servicios.ver | Periodo |
| Medicamentos e insumos utilizados | inventario.movimientos | Periodo |
| Stock bajo | inventario.ver | Listado actual |
| Lotes próximos a caducar | inventario.ver | Caducidad dentro del periodo |

## Reglas adicionales

- Médico puede crear/editar pacientes; no cambia citas por defecto. Atiende sus consultas; consultas.tomar_ajenas permite otra asignación cuando se delega.
- Recepción no edita clínica ni descarga documentos clínicos por delegar únicamente un permiso; sí descarga orden administrativa.
- Pagos necesita pagos.crear y orden_recepcion.procesar para registro, tras entregas físicas.
- Venta libre distingue preparación (venta_libre.preparar), listado (venta_libre.ver) y entrega física (inventario.entregar).
- usuarios.permisos es exclusivo de administrador. Cédula ajena exige admin y usuarios.editar. Administradores y Superadmin mantienen sus protecciones.
- Superadmin depende exclusivamente de app_metadata.super_admin === true, sin rol clínico superadmin.
- Las métricas de Dashboard exigen permiso funcional de su destino.
- Asignar médico exige citas.asignar_medico; excepción de hora solo flexibiliza semana, nunca bloqueos/solapamientos.

La pestaña Venta libre del catálogo se puede consultar con inventario.ver. El listado de preparaciones exige venta_libre.ver y su creación venta_libre.preparar; esos dos permisos no están en los defaults actuales de recepción y deben delegarse explícitamente si se desea ese flujo. Entregar una preparación exige además inventario.entregar. Se conserva el catálogo de permisos existente.

## Fase 7: acciones y autorización global

El catálogo permanece en 82 permisos (admin 82, recepcionista 25, médico 36). No se agrega superadmin a perfilusuario. Los permisos funcionales no permiten cruzar clínicas.

| Pantalla/acción | Admin | Recepcionista | Médico | Requisito |
|---|---|---|---|---|
| Propietarios: Ver detalle | Sí | Sí | Sí | propietarios.ver; pacientes.ver para relación |
| Propietarios: Ver paciente / Editar paciente | Sí | Sí | Sí | pacientes.ver / pacientes.ver & pacientes.editar |
| Propietarios: + Registrar paciente | Sí | Sí | Sí | propietarios.ver & pacientes.crear |
| Propietarios: Ver expediente | Sí | No | Sí | expediente.ver; rol admin/medico |
| Citas: Hoy/Pendientes/Todas | Sí | Sí | Sí | citas.ver; misma clínica, paginado |
| Estudios: subir/reemplazar | Sí | No | Sí | estudios.crear o estudios.editar, consulta abierta autorizada |
| Estudios: Ver archivo | Sí | No | Sí | estudios.ver; rol admin/medico; registro padre propio |
| Compras: documento del proveedor | Sí | No | No | compras.recibir para subir; compras.ver para abrir |
| Compras: Cancelar compra / Marcar no recibida | Sí | No | No | compras.administrar, estado pendiente, motivo obligatorio |
| Configuración: Guardar logo / Eliminar logo | Sí | No | No | configuracion.ver & configuracion.editar |
| Navegación: ver logo | Sí | Sí | Sí | perfil activo y Tenant activo |
| Ayuda y soporte (/soporte) | Sí | Sí | Sí | perfil activo; admin tickets propios del Tenant, otros solo suyos |
| Soporte: crear/responder/adjuntar | Sí | Sí | Sí | alcance anterior; ticket no cerrado; sin nuevo permiso funcional |

| Ruta global | Acciones | Autorización |
|---|---|---|
| /superadmin/dashboard | Métricas administrativas | app_metadata.super_admin === true actual |
| /superadmin/veterinarias | Listar/crear/detalle/editar/suspender/reactivar; administradores y acceso | Superadmin actual; sin clínica rutinaria |
| /superadmin/soporte | Tickets de todos los Tenants; filtros/respuestas/estado/resolver/cerrar/adjuntos | Superadmin actual; solo soporte y logos administrativos entre Tenants |
| /superadmin/cuenta | Correo y cambiar su contraseña | Superadmin actual; exclusivamente su cuenta |

Storage es privado. Las descargas usan el JWT y autorización del padre. No existe carga, modificación ni borrado directo de los nuevos buckets desde frontend; el backend comprueba actor, Tenant, permiso, contenido y límites antes de escribir. Superadmin no puede descargar compras ni estudios. Suspender bloquea operaciones normales incluso con JWT previamente emitido. La sesión y el soporte permanecen disponibles para perfiles activos.
