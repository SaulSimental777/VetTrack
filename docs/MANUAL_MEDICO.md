# Manual de Médico — VetTrack

Frontend de Fase 7, revisado el 8 de noviembre de 2026. Usa rutas y componentes finales. Describe defaults del catálogo real (36 permisos). usuario_permiso puede ampliar/restringir acciones; la matriz detalla requisitos. Todas las operaciones pertenecen a la clínica de sesión.

## Cambios de operación en Fase 7

**Propietarios (/propietarios).** La tabla muestra hasta dos nombres de pacientes y “+ N más”; “Sin pacientes” es válido. Busca por propietario o por el inicio del nombre de un paciente relacionado. El listado avanza con Anterior/Siguiente (25 propietarios por página). **Ver** abre Detalle del propietario con teléfono, correo, dirección y pacientes relacionados. **Ver paciente** consulta su ficha; **Editar paciente** exige pacientes.editar; **Ver expediente** exige expediente.ver y rol admin/médico. **+ Registrar paciente** mantiene al propietario preseleccionado: completa Nombre y Especie, pulsa **Guardar y seleccionar** y se actualizan la relación y su resumen. Las acciones y los datos de pacientes requieren sus permisos; propietarios.ver por sí solo no los habilita.

**Citas (/citas).** **Hoy**, **Pendientes** y **Todas** mantienen filtros por fecha, médico, estado y búsqueda. Pendientes incluye citas anteriores todavía abiertas; Todas y Pendientes usan Anterior/Siguiente (50 por página). Elegir otro filtro vuelve a la primera página. No se cancela ninguna cita por el paso del tiempo.

**Ayuda y soporte (/soporte).** **+ Nuevo ticket** captura Asunto, Categoría, Descripción, Prioridad, Módulo o pantalla y Adjunto opcional. **Crear ticket** registra automáticamente clínica, usuario, rol y fecha. **Ver ticket** muestra el Historial del ticket; escribe una respuesta y pulsa **Enviar respuesta**, con archivo opcional. Filtra por Estado y Prioridad y usa **Recargar** o Anterior/Siguiente. El administrador ve solicitudes de su clínica; otros usuarios solo las propias. Los estados son Abierto, En revisión, En proceso, Resuelto y Cerrado; el usuario de clínica no los cambia. Un ticket cerrado conserva su historial y deja de aceptar respuestas. Si la veterinaria está suspendida, el workspace conserva Ayuda y soporte y bloquea las operaciones normales hasta su reactivación.

**Archivos.** **Seleccionar archivo** o arrastrar permite PDF, PNG o JPG/JPEG de hasta 10 MB; el logo solo PNG/JPG/JPEG de hasta 5 MB. Se muestran nombre, tamaño, tipo y estado. **Reemplazar**, **Quitar archivo** y **Ver archivo** aparecen según la selección. Espera “Archivo listo” antes de guardar el formulario. Quitar un archivo del borrador no elimina un documento histórico. Los archivos privados siguen los permisos de su registro; los enlaces HTTPS históricos siguen abriéndose. Si no hay logo o falla su carga, la aplicación conserva el nombre y la marca VetTrack.

**Consultas (/clinica).** Citas de hoy, Citas pendientes anteriores y Próximas citas se muestran por separado. **Atrasada** identifica pendientes anteriores; **En consulta** indica una atención iniciada. Se conservan fechas y estados. Próxima cita sugerida no admite una fecha anterior al día local de inicio de consulta; se valida al guardar indicaciones y finalizar. Estudios usa Archivo adjunto y **Ver archivo**, también en Expediente. Los documentos nuevos (Nota de Consulta, Plan de Tratamiento, Orden de Cierre y Receta Simple) llevan encabezado, logo disponible, datos en columnas, secciones, firma, página X/Y y revisión. Los documentos históricos conservan sus snapshots y diseño previo.

## Acceso y controles comunes

Inicia con correo y contraseña. No existe ruta independiente /login: la sesión determina la pantalla. La cabecera indica nombre, rol y clínica; Cerrar sesión termina el acceso. En móvil, Abrir navegación despliega menú y Cerrar navegación lo oculta; seleccionar opción lo cierra.

Las rutas usan #, por ejemplo #/citas. Sin permiso aparece 403 · Acceso no autorizado. El backend valida cada operación. Una cuenta inactiva no opera.

Un campo con * es obligatorio. En buscadores escribe y selecciona coincidencia; flechas/Enter usan teclado, Escape cierra y Limpiar selección retira valor. Cargando opciones y Sin resultados indican estado. Cancelar o cerrar descartan el borrador; durante guardado se bloquean repeticiones. Los editores dentro de Consulta también tienen Cancelar. Tablas anchas se desplazan dentro de su contenedor en móvil. Horas de Tijuana e importes MXN.

## Dashboard

Ruta: `/dashboard`. Fuente revisada: `frontend/src/pages/Dashboard.tsx`.

**Objetivo.** Identificar pendientes reales y abrir el módulo que los resuelve.

**Información.** Fecha de Tijuana, indicadores autorizados y hasta diez próximas citas. Las tarjetas necesitan el permiso de su módulo. Cero significa ausencia de registros. Para el médico, citas y consultas se limitan a las asignadas.

**Acciones disponibles.**

- **Tarjetas de indicadores:** Abren el módulo indicado; exigen además su permiso de lectura.
- **Abrir agenda:** Abre Citas.

**Campos.** No captura datos.

**Validaciones.** Las alertas de caducidad usan 30 días. Abre la agenda para continuar después de las diez próximas citas.

**Resultado esperado.** Se abre el módulo de la tarjeta sin modificar información.

**Continuar.** Abrir agenda lleva a Citas; las tarjetas abren Pacientes, Consultas, Órdenes de recepción, Inventario, Compras o Pagos según título y permiso.

**Acciones fuera del acceso predeterminado.** Todas las acciones anteriores están permitidas, sujetas al estado del registro y sus reglas. Describir campos de una acción restringida no los habilita para este rol.

## Propietarios

Ruta: `/propietarios`. Fuente revisada: `frontend/src/pages/Duenos.tsx`.

**Objetivo.** Consultar y mantener propietarios.

**Información.** Listado con nombre, teléfono, correo, dirección, búsqueda y acciones permitidas.

**Acciones disponibles.**



**Campos.** Nombre *; teléfono, correo y dirección opcionales.

**Validaciones.** Nombre no vacío y correo completo cuando se captura. La eliminación puede rechazarse si existen registros relacionados.

**Resultado esperado.** Crear o editar actualiza el listado. Eliminar pide confirmación con el nombre del propietario.

**Continuar.** Ve a Pacientes para asociar una mascota o a Citas para agendar.

**Acciones fuera del acceso predeterminado.** + Nuevo propietario / + Registrar primer propietario; Guardar propietario; Editar / Guardar cambios; Eliminar / Sí, eliminar. Describir campos de una acción restringida no los habilita para este rol.

## Pacientes

Ruta: `/pacientes`. Fuente revisada: `frontend/src/pages/Pacientes.tsx`.

**Objetivo.** Registrar pacientes y consultar sus datos generales.

**Información.** Nombre, especie, raza, sexo, nacimiento, peso y propietario. Buscar pacientes filtra por nombre, especie o propietario.

**Acciones disponibles.**

- **+ Nuevo paciente:** Abre Registrar paciente; el selector de propietarios debe haber cargado.
- **Guardar paciente:** Guarda creación o edición, según el permiso correspondiente.
- **Editar:** Abre Editar paciente, incluidos sus datos y propietario actual.
- **Ver expediente:** Abre el historial longitudinal.

**Campos.** Nombre * y Propietario * de la lista. Especie, raza, sexo, fecha de nacimiento, peso actual y observaciones generales opcionales.

**Validaciones.** Nacimiento no futuro. Peso positivo con hasta tres decimales cuando se captura. El propietario debe existir en la clínica; busca y selecciona dentro del mismo campo.

**Resultado esperado.** Guardar paciente actualiza el listado. Eliminar paciente exige confirmación y respeta las relaciones existentes.

**Continuar.** Ver expediente abre /expediente?paciente=<id>. En Citas selecciona al paciente con su propietario actual.

**Acciones fuera del acceso predeterminado.** Eliminar / Eliminar paciente. Describir campos de una acción restringida no los habilita para este rol.

## Citas

Ruta: `/citas`. Fuente revisada: `frontend/src/pages/Citas.tsx`.

**Objetivo.** Agendar y administrar citas conservando servicios y precios históricos.

**Información.** Filtros Fecha, Médico, Estado y Buscar. Tabla con fecha/hora, paciente/propietario, médico, servicios, subtotal, estado y acciones. El subtotal es una estimación, no un pago.

**Acciones disponibles.**

- **Crear paciente:** Formulario del paso 1 vinculado al propietario seleccionado.
- **Atender:** Abre atención; necesita además consultas.ver y asignación propia o consultas.tomar_ajenas.
- **Recargar:** Actualiza la agenda con sus filtros.

**Campos.** Propietario *, Paciente *, al menos un servicio, Veterinario *, Fecha * y horario disponible. Motivo opcional. Crear propietario necesita nombre; Crear paciente necesita nombre y el propietario ya seleccionado.

**Validaciones.** Paciente del propietario actual elegido. Especialidad es filtro opcional: Ver todos los médicos lo retira. La disponibilidad considera duración total, semana, bloqueos y citas existentes. Usar hora fuera del horario semanal necesita citas.forzar_horario; nunca permite solapamientos ni ignorar bloqueos. Programada es el estado inicial automático. Cambiar médico requiere citas.asignar_medico.

**Resultado esperado.** Guardar cita crea/actualiza la cita. Cancelar cita conserva el registro y libera el horario. En edición, Actualizar atención ofrece únicamente transiciones permitidas.

**Guardar creación rápida.** Guardar y seleccionar crea y selecciona el registro; Cancelar registro vuelve al asistente sin crearlo. Teléfono/correo del propietario y especie del paciente son opcionales.

**Continuar.** Propietario y paciente → Servicios → Veterinario y disponibilidad → Resumen. Atender abre /clinica?cita=<id>.

**Acciones fuera del acceso predeterminado.** + Nueva cita; Crear propietario; Quitar; Siguiente / Anterior / Revisar cita; Ver todos los médicos / Actualizar disponibilidad; Usar hora fuera del horario semanal; Guardar cita; Editar; Cancelar cita / Confirmar cancelación. Describir campos de una acción restringida no los habilita para este rol.

## Consultas

Ruta: `/clinica`. Fuente revisada: `frontend/src/pages/Clinica.tsx + ../lib/clinical.ts`.

**Objetivo.** Registrar la atención clínica y generar cierre y documentos.

**Información.** Consultas clínicas para administrador y Mis citas y consultas para médico: Citas para atención y Consultas registradas. Dentro, Consulta · <paciente>, propietario, médico, fecha, motivo, estado y revisión; diez secciones de trabajo.

**Acciones disponibles.**

- **Iniciar consulta / Abrir consulta:** Inicia o retoma la cita; Abrir consulta desde Consultas registradas requiere consultas.ver.
- **Guardar consulta / Guardar indicaciones:** Guarda evaluación e indicaciones sin finalizar.
- **+ Registrar / Editar · Diagnósticos:** Editor dentro de la sección: Guardar cambios confirma y Cancelar descarta el borrador.
- **+ Registrar / Editar · Tratamientos:** Registra/edita uno de los tratamientos dentro de la página.
- **+ Registrar / Editar · Vacunas:** Guarda aplicación y seguimiento.
- **+ Registrar / Editar · Desparasitación:** Guarda producto, dosis, fecha y seguimiento.
- **+ Registrar / Editar · Estudios:** Guarda estudio, resultado y referencia HTTPS.
- **+ Registrar receta / Editar receta / Guardar receta:** Editor dentro de la página; + Agregar medicamento y Quitar medicamento cambian las líneas del borrador.
- **Registrar aplicación:** Confirma Producto, Cantidad y Motivo antes de registrar uso físico con FEFO.
- **Agregar servicio:** Agrega el servicio elegido con precio y duración guardados.
- **Datos profesionales:** Muestra la cédula del tratante; solo el propio médico la edita aquí. El administrador edita cédula ajena en Usuarios. Domicilio exige configuracion.editar.
- **Finalizar consulta / Confirmar finalización:** Presentan resumen y generan el cierre.
- **Descargar PDF:** Documentos disponibles según permiso: Nota de Consulta Veterinaria, Plan de Tratamiento, Receta Médica Veterinaria Simple y Orden de Cierre a Recepción.
- **Volver:** Regresa a la lista sin cerrar la consulta.

**Campos.** Evaluación: Motivo de consulta *; anamnesis, exploración física, temperatura, frecuencia cardiaca/respiratoria, mucosas, TRC, peso, observaciones y pronóstico. Indicaciones: indicaciones generales, próxima cita sugerida y observaciones administrativas. Diagnósticos: Tipo * y Diagnóstico *. Tratamientos: Tratamiento *; indicaciones, duración y observaciones. Vacunas: Vacuna *, Fecha de aplicación *; laboratorio, lote, próxima aplicación y observaciones. Desparasitación: Producto *, Dosis *, Fecha *; peso, próxima aplicación y observaciones. Estudios: Tipo *, Nombre *, Fecha *; resultado, observaciones y Archivo adjunto opcional (PDF, PNG o JPG/JPEG, hasta 10 MB). Receta: Medicamento *, Dosis *, Frecuencia *, Duración *, Vía de administración *, Cantidad * y Grupo de prescripción * por cada línea; principio activo, concentración, presentación, tiempo de retiro e indicaciones opcionales. Vincular medicamento de inventario es opcional. Reapertura: Motivo obligatorio.

**Validaciones.** Iniciar exige cita atendible y médico activo asignado. El médico atiende sus consultas; tomar ajenas requiere permiso. Signos vitales, cantidades, fechas y HTTPS se validan. Recetar no descuenta existencias y permite medicamentos ajenos al inventario. Registrar aplicación y entregas físicas sí descuentan. Grupo I se conserva en expediente pero no se genera como receta simple; revisa documentos pendientes si faltan cédula/domicilio o clasificación. Una consulta finalizada queda sin edición. Reabrir exige motivo y orden aún no procesada.

**Resultado esperado.** Guardar consulta o Guardar indicaciones preserva el formulario de evaluación completo. Finalizar muestra resumen de paciente, médico, diagnósticos, tratamientos, medicamentos y servicios; al confirmar guarda, completa la cita y genera documentos y orden de la revisión.

**Continuar.** Volver regresa a la lista. Órdenes de recepción permite entregar y registrar pago. Expediente muestra el historial longitudinal.

**Acciones fuera del acceso predeterminado.** Reabrir con motivo / Reabrir consulta. Describir campos de una acción restringida no los habilita para este rol.

## Expediente

Ruta: `/expediente`. Fuente revisada: `frontend/src/pages/Expediente.tsx`.

**Objetivo.** Consultar el historial longitudinal del paciente.

**Información.** Cabecera con nombre, especie, raza, sexo, nacimiento y peso disponibles; timeline de consultas, diagnósticos, tratamientos, recetas, vacunas, desparasitaciones, estudios, servicios e historial previo según permisos.

**Acciones disponibles.**

- **Paciente / Filtrar eventos:** Seleccionan paciente y tipo de evento.
- **Más recientes / Más antiguas:** Cambian la página cuando corresponde.
- **Abrir consulta relacionada:** Abre la atención que originó el evento.

**Campos.** Paciente seleccionado; Filtrar eventos opcional.

**Validaciones.** Página de hasta 100 eventos. El filtro de tipo actúa en la página actual; usa Más antiguas para continuar. Sin edición directa del historial.

**Resultado esperado.** Datos guardados con fecha en orden cronológico descendente.

**Continuar.** Abrir consulta relacionada lleva a /clinica?consulta=<id>.

**Acciones fuera del acceso predeterminado.** Todas las acciones anteriores están permitidas, sujetas al estado del registro y sus reglas. Describir campos de una acción restringida no los habilita para este rol.

## Órdenes de recepción

Ruta: `/ordenes-recepcion`. Fuente revisada: `frontend/src/pages/OrdenesRecepcion.tsx`.

**Objetivo.** Revisar el cierre administrativo y realizar entregas físicas.

**Información.** Paciente, propietario, médico, fecha, estado, servicios e importes, productos solicitados, próxima cita y observaciones administrativas. Recepción no ve diagnóstico, tratamiento ni notas clínicas.

**Acciones disponibles.**

- **Descargar orden PDF:** Descarga el documento administrativo.

**Campos.** La lista no captura datos. Revisar entregas muestra producto, cantidad y stock; la confirmación identifica la línea seleccionada.

**Validaciones.** Entrega exige existencias y aplica FEFO. Repetir no duplica descuento. Marcar procesada es una acción administrativa existente y no registra dinero: usa Revisar pago. Una orden procesada bloquea reapertura.

**Resultado esperado.** Entrega registrada una vez; registrar pago procesa automáticamente la orden.

**Continuar.** Revisar pago abre /pagos?orden=<id>; el PDF conserva el cierre administrativo.

**Acciones fuera del acceso predeterminado.** Revisar entregas / Confirmar entrega física; Revisar pago; Marcar procesada / Confirmar procesamiento. Describir campos de una acción restringida no los habilita para este rol.

## Médicos

Ruta: `/medicos`. Fuente revisada: `frontend/src/pages/Medicos.tsx`.

**Objetivo.** Consultar médicos, especialidades, horarios y agenda.

**Información.** Nombre, múltiples especialidades, cédula, estado, horario de hoy y próxima cita cuando están permitidos. Buscar médico y Especialidad filtran.

**Acciones disponibles.**

- **Recargar / Ver todos los médicos:** Actualizan o limpian los filtros.
- **Ver horario:** Consulta la semana cuando no tienes administración.
- **Bloqueos:** Abre bloqueos; editar exige horarios.administrar.
- **Ver agenda:** Consulta citas del médico por fecha.

**Campos.** Consulta sin captura. Especialidades: Nombre * y descripción opcional. Horarios y bloqueos se describen en Horarios.

**Validaciones.** Especialidad no bloquea citas. Crear cuentas médicas, cambiar estado o asignar especialidades se hace en Usuarios; no existe un botón de crear médico en este listado.

**Resultado esperado.** Consulta de datos de la clínica; el administrador guarda el catálogo de especialidades y horarios.

**Continuar.** Ver agenda presenta fecha en diálogo. Para crear médico ve a Usuarios y selecciona rol Médico.

**Acciones fuera del acceso predeterminado.** Especialidades / Guardar especialidad; Editar horario. Describir campos de una acción restringida no los habilita para este rol.

## Horarios

Ruta: `/horarios`. Fuente revisada: `frontend/src/pages/Horarios.tsx + Medicos.tsx`.

**Objetivo.** Consultar/administrar semana y ausencias.

**Información.** Veterinario en un único buscador y siete días con varios bloques. Ver bloqueos y ausencias muestra inicio, fin, tipo y motivo.

**Acciones disponibles.**

- **Veterinario:** Busca y selecciona el médico.
- **Ver bloqueos y ausencias:** Abre Bloqueos de <médico>.
- **Cerrar:** Cierra el panel sin modificar.

**Campos.** Veterinario seleccionado. Bloque semanal: hora inicial/final y Activo. Bloqueo: Inicio (Tijuana) * y Fin (Tijuana) *; Tipo y Motivo.

**Validaciones.** Inicio anterior a fin; no se admiten solapamientos entre bloques activos. Horario de Tijuana. El bloqueo retira disponibilidad incluso para excepciones de semana.

**Resultado esperado.** Guardar cambios reemplaza la semana. Crear/eliminar bloqueos actualiza disponibilidad.

**Continuar.** Citas consulta disponibilidad; Médicos muestra la agenda.

**Acciones fuera del acceso predeterminado.** Agregar bloque / Quitar / Activo; Guardar cambios; Agregar bloqueo; Eliminar / Confirmar. Describir campos de una acción restringida no los habilita para este rol.

## Servicios

Ruta: `/servicios`. Fuente revisada: `frontend/src/pages/Servicios.tsx`.

**Objetivo.** Consultar/administrar el catálogo de citas y consultas.

**Información.** Nombre, descripción, duración humana, precio, estado y especialidades sugeridas. Buscar servicio y Mostrar inactivos filtran.

**Acciones disponibles.**

- **Recargar:** Actualiza catálogo.

**Campos.** Servicio *, Duración en minutos *, precio; estado, descripción y especialidades sugeridas. Cambiar precio captura únicamente importe.

**Validaciones.** Nombre no vacío, duración válida y precio no negativo. Listados usan duración humana: 1 h 30 min o 20 h 3 min. Especialidades opcionales. Cambiar catálogo no altera precios/duraciones históricos.

**Resultado esperado.** Crear servicio o Guardar cambios actualiza catálogo; Desactivar retira nuevas selecciones y conserva citas previas.

**Continuar.** Citas agrega varios servicios; Consultas permite servicio adicional con permiso.

**Acciones fuera del acceso predeterminado.** + Nuevo servicio / Crear servicio; Editar / Guardar cambios; Cambiar precio; Desactivar / Desactivar servicio; Reintentar especialidades. Describir campos de una acción restringida no los habilita para este rol.

## Inventario

Ruta: `/inventario`. Fuente revisada: `frontend/src/pages/Inventario.tsx + InventoryLots.tsx`.

**Objetivo.** Consultar existencias, lotes, movimientos y entregas.

**Información.** Medicamentos, Insumos, Venta libre y Caducidades; Movimientos con permiso. Tabla de producto, tipo, stock, mínimo, precio y estado. Medicamentos: principio activo, concentración, presentación y grupo. Precio de compra solo con compras.ver.

**Acciones disponibles.**

- **Medicamentos / Insumos / Venta libre / Caducidades:** Cambian pestaña; caducidad ofrece ventanas 30, 60 o 90 días y estado.
- **Ver lotes:** Abre Lotes · <producto>, Estado de lotes y Ventana de caducidad.

**Campos.** Producto: Nombre *, Unidad *, Precio de venta *, Stock mínimo * y Precio de compra * si autorizado; descripción, tipo, SKU, activo y datos farmacológicos. Movimiento: Producto *, Cantidad *, Motivo * y Tipo para administración. Entrada: lote opcional, obligatorio si capturas caducidad. Venta libre: producto(s), cantidad positiva y referencia opcional.

**Validaciones.** Stock no editable desde catálogo. Precios/mínimos no negativos. Ajuste admite cantidad con signo; no stock negativo. Salidas físicas aplican FEFO, excluyen caducados y son idempotentes. Preparar venta no descuenta; confirmar entrega sí. Recetar tampoco descuenta.

**Resultado esperado.** Estados legibles: Vigente, Próximo a caducar, Caducado, Agotado y Stock bajo. Lotes muestra recepción, caducidad, cantidad actual/inicial y procedencia.

**Continuar.** Órdenes de recepción entrega receta; Compras recibe productos/documentos.

**Acciones fuera del acceso predeterminado.** Crear producto; Editar; Registrar movimiento / Confirmar movimiento / Confirmar movimiento físico; Movimientos; Preparar venta libre / Preparar entrega; Entregas de venta libre; Confirmar entrega física / Confirmar entrega. Describir campos de una acción restringida no los habilita para este rol.

## Pantallas que no aparecen por defecto

- **Proveedores** (`/proveedores`): falta proveedores.ver.
- **Compras** (`/compras`): falta compras.ver.
- **Pagos** (`/pagos`): falta pagos.ver.
- **Reportes** (`/reportes`): falta reportes.ver.
- **Configuración** (`/configuracion`): falta configuracion.ver.
- **Usuarios** (`/configuracion/usuarios`): falta usuarios.ver.

Diagnósticos, tratamientos, recetas, vacunas, desparasitación, estudios e indicaciones son secciones de Consultas, sin rutas independientes. Lotes/recepciones son paneles de Inventario/Compras. Ningún permiso concede acceso a otra clínica.

La pestaña Venta libre del catálogo se puede consultar con inventario.ver. El listado de preparaciones exige venta_libre.ver y su creación venta_libre.preparar; esos dos permisos no están en los defaults actuales de recepción y deben delegarse explícitamente si se desea ese flujo. Entregar una preparación exige además inventario.entregar. Se conserva el catálogo de permisos existente.
