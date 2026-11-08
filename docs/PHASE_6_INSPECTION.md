# Inspección previa a Fase 6
Base main: 2a9cb509795a9769ef7b8f60239ace7ca0173277. Inspección completa del árbol frontend/src y rutas/controllers antes de modificar UX.
Rutas: #/dashboard, #/propietarios, #/pacientes, #/citas, #/clinica, #/expediente, #/ordenes-recepcion, #/medicos, #/servicios, #/inventario, #/proveedores, #/compras, #/configuracion/usuarios. Login sin sesión; Superadmin usa workspace de Veterinarias separado.
Patrones existentes: OperationsPage/State/Notice/Dialog/Footer, CSS por módulo, formularios CRUD en modales, JWT apiFetch, permisos can y revalidación de sesión. No eliminar acciones ni endpoints.

## frontend/src/App.css
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 609
}

## frontend/src/App.tsx
{
  "componentes": [
    "SessionScreen",
    "LogoutButton",
    "Workspace",
    "ClinicWorkspace",
    "App"
  ],
  "controles": [],
  "acciones": [
    " <span aria-hidden=\"true\">←</span> <span className=\"nav-label\">{pending ? 'Cerrando sesión…' : 'Cerrar sesión'}</span> ",
    "Reintentar",
    " <span aria-hidden=\"true\">{item.icon}</span> <span className=\"nav-label\">{item.title}</span> ",
    "<span aria-hidden=\"true\">{icon}</span> <span className=\"nav-label\">{label}</span>",
    "Reintentar",
    "<span aria-hidden=\"true\">▦</span> <span className=\"nav-label\">Veterinarias</span>"
  ],
  "permisos": [],
  "endpoints": [
    "/api/sesion"
  ],
  "lineas": 271
}

## frontend/src/components/OperationsUI.tsx
{
  "componentes": [
    "OperationsPage",
    "OperationNotice",
    "OperationState",
    "OperationDialog",
    "OperationFooter",
    "SpecialtiesField"
  ],
  "controles": [
    "dialog ref={dialog} className={`users-dialog${wide ? ' users-dialog-wide' : ''}`} aria-labelledby={titleId} aria-busy={pending} onCancel={event => { event.preventDefau",
    "input type=\"checkbox\" disabled={disabled} checked={selected.includes(item.id_especialidad)} onChange={event => onChange(event.target.checked ? [...selected, item.id_e"
  ],
  "acciones": [
    "×",
    "Cancelar",
    "{pending ? 'Guardando…' : label}"
  ],
  "permisos": [],
  "endpoints": [],
  "lineas": 45
}

## frontend/src/index.css
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 12
}

## frontend/src/lib/api.ts
{
  "componentes": [
    "apiFetch",
    "downloadApiFile"
  ],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [
    "/api/sesion"
  ],
  "lineas": 83
}

## frontend/src/lib/clinical.ts
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 42
}

## frontend/src/lib/duration.ts
{
  "componentes": [
    "formatDuration"
  ],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 8
}

## frontend/src/lib/inventory.ts
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [
    "/api/inventario/${operation}"
  ],
  "lineas": 9
}

## frontend/src/lib/operations.ts
{
  "componentes": [
    "useOperationResource",
    "useOperationMutation"
  ],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 91
}

## frontend/src/lib/permissions.ts
{
  "componentes": [
    "usePermissions"
  ],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 27
}

## frontend/src/lib/supabase.ts
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 10
}

## frontend/src/main.tsx
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 11
}

## frontend/src/pages/Citas.tsx
{
  "componentes": [
    "AppointmentEditor",
    "CancelAppointment",
    "Citas"
  ],
  "controles": [
    "form onSubmit={save}",
    "input id=\"appointment-owner-search\" data-initial-focus type=\"search\" placeholder=\"Nombre del propietario\" value={ownerQuery} onChange={event => setOwnerQuery(event.ta",
    "select id=\"appointment-owner\" value={form.owner} onChange={event => setForm(previous => ({ ...previous, owner: event.target.value, patient: '' }))} required",
    "select id=\"appointment-patient\" value={form.patient} disabled={!form.owner} onChange={event => setForm(previous => ({ ...previous, patient: event.target.value }))} req",
    "select id=\"appointment-state\" value={form.estado} onChange={event => setForm(previous => ({ ...previous, estado: event.target.value }))}",
    "textarea id=\"appointment-reason\" value={form.motivo} rows={2} maxLength={2000} onChange={event => setForm(previous => ({ ...previous, motivo: event.target.value }))}",
    "input type=\"checkbox\" checked={selectedServices.includes(service.id_servicio)} disabled={!service.activo && !selectedServices.includes(service.id_servicio)} onChange=",
    "input id=\"appointment-doctor-search\" type=\"search\" value={doctorQuery} onChange={event => setDoctorQuery(event.target.value)}",
    "select id=\"appointment-specialty\" value={doctorSpecialty} onChange={event => setDoctorSpecialty(event.target.value)}",
    "select id=\"appointment-doctor\" value={form.doctor} disabled={!can('citas.asignar_medico')} onChange={event => { setForm(previous => ({ ...previous, doctor: event.targe",
    "input id=\"appointment-date\" type=\"date\" value={form.date} onChange={event => { setForm(previous => ({ ...previous, date: event.target.value })); setSlot('') }} requir",
    "input type=\"checkbox\" checked={force} onChange={event => setForce(event.target.checked)}",
    "input id=\"appointment-force-time\" type=\"time\" value={form.time} onChange={event => setForm(previous => ({ ...previous, time: event.target.value }))} required",
    "form onSubmit={save}",
    "input id=\"appointments-date\" type=\"date\" value={date} onChange={event => setDate(event.target.value)}",
    "select id=\"appointments-doctor\" value={doctor} onChange={event => setDoctor(event.target.value)}",
    "select id=\"appointments-state\" value={state} onChange={event => setState(event.target.value)}",
    "input id=\"appointments-search\" type=\"search\" value={query} onChange={event => setQuery(event.target.value)} placeholder=\"Paciente, propietario o médico\"",
    "table className=\"users-table\""
  ],
  "acciones": [
    "Ver todos los médicos",
    "{clinicInputDateTime(item.fecha_inicio).slice(11, 16)} – {clinicInputDateTime(item.fecha_fin).slice(11, 16)}",
    "Actualizar disponibilidad",
    "+ Nueva cita",
    "Recargar",
    "Atender",
    "Editar",
    "Cancelar cita"
  ],
  "permisos": [
    "citas.forzar_horario",
    "citas.asignar_medico",
    "citas.ver",
    "medicos.ver",
    "citas.crear",
    "consultas.crear",
    "consultas.tomar_ajenas",
    "citas.editar",
    "citas.cancelar"
  ],
  "endpoints": [
    "/api/citas/selectores",
    "/api/medicos?activo=true",
    "/api/servicios",
    "/api/medicos/${form.doctor}/disponibilidad?${availabilityParams}",
    "/api/citas/${cita.id_cita}",
    "/api/citas",
    "/api/citas/${cita.id_cita}/cancelar",
    "/api/citas?${params}",
    "/api/medicos"
  ],
  "lineas": 120
}

## frontend/src/pages/Clinica.tsx
{
  "componentes": [
    "ClinicalFields",
    "RecordEditor",
    "PrescriptionEditor",
    "ProfessionalEditor",
    "ClinicalSummary",
    "ConsultationWorkspace",
    "OpenConsultation",
    "Clinica"
  ],
  "controles": [
    "textarea id={`${prefix}-${field.key}`} rows={3} maxLength={20000} value={values[field.key] || ''} required={field.required} disabled={disabled} onChange={event => onChan",
    "select id={`${prefix}-${field.key}`} value={values[field.key] || field.options?.[0]?.[0] || ''} required={field.required} disabled={disabled} onChange={event => onChan",
    "input id={`${prefix}-${field.key}`} type={field.type || 'text'} value={values[field.key] || ''} required={field.required} disabled={disabled} step={field.step} min={f",
    "form onSubmit={save}",
    "form onSubmit={save}",
    "select id={`rx-product-${index}`} value={item.id_producto || ''} onChange={event => { const p = catalog.data?.find(p => p.id_producto === event.target.value); setItems",
    "input type=\"checkbox\" checked={item.entregar === 'true'} disabled={mutation.pending} onChange={event => setItems(previous => previous.map((old, i) => i === index ? { ",
    "textarea id=\"rx-instructions\" rows={3} maxLength={20000} value={instructions} onChange={event => setInstructions(event.target.value)}",
    "form onSubmit={save}",
    "input id=\"clinical-license\" inputMode=\"numeric\" pattern=\"[0-9]{5,20}\" maxLength={20} value={license} disabled={!own || mutation.pending} onChange={event => setLicense",
    "textarea id=\"clinical-address\" maxLength={2000} rows={3} value={address} onChange={event => setAddress(event.target.value)} disabled={mutation.pending}",
    "form onSubmit={event => { event.preventDefault(); void write('save') }}",
    "select id=\"clinical-service\" value={service} onChange={event => setService(event.target.value)}",
    "form onSubmit={event => { event.preventDefault(); void write('finish') }}",
    "form onSubmit={event => { event.preventDefault(); void write('reopen') }}",
    "textarea id=\"clinical-reopen-reason\" value={reason} onChange={event => setReason(event.target.value)} maxLength={2000} required",
    "input id=\"clinical-search\" type=\"search\" value={search} onChange={event => setSearch(event.target.value)}"
  ],
  "acciones": [
    "Quitar medicamento",
    "+ Agregar medicamento",
    "Volver",
    "Datos profesionales",
    "Guardar consulta",
    "+ Registrar",
    "Editar",
    "{data.receta ? 'Editar receta' : '+ Registrar receta'}",
    "Registrar aplicación",
    "Agregar servicio",
    "{documentLabels[doc.tipo]} · revisión {doc.revision} · Descargar PDF",
    "Finalizar consulta",
    "Reabrir con motivo",
    "Volver",
    "{item.estado === 'en_consulta' ? 'Abrir consulta' : 'Iniciar consulta'}",
    "Abrir consulta"
  ],
  "permisos": [
    "medicamentos.ver",
    "configuracion.editar",
    "inventario.uso_clinico",
    "servicios.ver",
    "consultas.editar",
    "recetas.ver",
    "consultas.finalizar",
    "consultas.reabrir",
    "citas.ver",
    "consultas.ver",
    "consultas.crear",
    "consultas.tomar_ajenas"
  ],
  "endpoints": [
    "/api/clinica/consultas/${consultation}/registros/${section.kind}",
    "/api/inventario/medicamentos",
    "/api/clinica/consultas/${consultation}/registros/receta",
    "/api/clinica/medicos/${data.consulta.id_medico}/cedula",
    "/api/clinica/datos-profesionales",
    "/api/servicios",
    "/api/clinica/consultas/${data.consulta.id_consulta}",
    "/api/clinica/consultas/${data.consulta.id_consulta}/${action === ",
    "/api/clinica/documentos/${id}",
    "/api/clinica/consultas/${id}",
    "/api/citas${access.rol === ",
    "/api/clinica/consultas?mias=${access.rol === ",
    "/api/clinica/citas/${id}/iniciar"
  ],
  "lineas": 157
}

## frontend/src/pages/Dashboard.tsx
{
  "componentes": [
    "Dashboard"
  ],
  "controles": [],
  "acciones": [
    "Abrir agenda"
  ],
  "permisos": [
    "citas.ver"
  ],
  "endpoints": [],
  "lineas": 82
}

## frontend/src/pages/Duenos.css
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 605
}

## frontend/src/pages/Duenos.tsx
{
  "componentes": [
    "Duenos"
  ],
  "controles": [
    "input className=\"duenos-search\" type=\"text\" placeholder=\"Buscar propietario...\" value={busqueda} onChange={(e) => setBusqueda(e.target.value)}",
    "table className=\"duenos-table\"",
    "form onSubmit={guardarDueno}",
    "input type=\"text\" placeholder=\"Nombre completo\" value={nombre} onChange={(e) => setNombre(e.target.value)} required",
    "input type=\"text\" placeholder=\"664 000 0000\" value={telefono} onChange={(e) => setTelefono(e.target.value)}",
    "input type=\"email\" placeholder=\"correo@ejemplo.com\" value={correo} onChange={(e) => setCorreo(e.target.value)}",
    "textarea placeholder=\"Dirección del propietario\" value={direccion} onChange={(e) => setDireccion(e.target.value)}"
  ],
  "acciones": [
    "+ Nuevo propietario ",
    "+ Registrar primer propietario ",
    "Editar",
    "Eliminar ",
    "× ",
    "Cancelar ",
    " {guardando ? 'Guardando...' : duenoEditando ? 'Guardar cambios' : 'Guardar propietario'} ",
    "Cancelar ",
    " {eliminando ? 'Eliminando...' : 'Sí, eliminar'} "
  ],
  "permisos": [
    "propietarios.crear",
    "propietarios.editar",
    "propietarios.eliminar"
  ],
  "endpoints": [
    "/api/duenos",
    "/api/duenos/${duenoEditando.id_dueno}",
    "/api/duenos/${duenoEliminando.id_dueno}"
  ],
  "lineas": 491
}

## frontend/src/pages/Expediente.tsx
{
  "componentes": [
    "History",
    "Expediente"
  ],
  "controles": [
    "select id=\"history-patient\" value={patient} onChange={event => setPatient(event.target.value)}"
  ],
  "acciones": [
    "Abrir consulta relacionada",
    "Más recientes",
    "Más antiguas"
  ],
  "permisos": [
    "pacientes.ver"
  ],
  "endpoints": [
    "/api/clinica/pacientes/${patient}/expediente?limite=100&offset=${offset}",
    "/api/pacientes"
  ],
  "lineas": 25
}

## frontend/src/pages/Inventario.tsx
{
  "componentes": [
    "CatalogEditor",
    "StockMovementEditor",
    "OrderEditor",
    "Inventario"
  ],
  "controles": [
    "form onSubmit={save}",
    "select id={`inventory-${field.key}`} value={values[field.key]} onChange={event => setValues(old => ({ ...old, [field.key]: event.target.value }))}",
    "input id={`inventory-${field.key}`} type={field.type || 'text'} maxLength={field.key === 'nombre' ? kind === 'producto' ? 100 : 150 : 2000} required={field.required} ",
    "form onSubmit={save}",
    "select id=\"stock-product\" value={product} required onChange={event => changed(() => setProduct(event.target.value))}",
    "select id=\"stock-type\" value={type} onChange={event => changed(() => setType(event.target.value))}",
    "input id=\"stock-quantity\" type=\"number\" step=\"0.001\" min={type === 'ajuste' && !consultation ? undefined : 0.001} required value={quantity} onChange={event => changed",
    "input id=\"stock-lot\" maxLength={100} required={!!expiry} value={lot} onChange={event => changed(() => setLot(event.target.value))}",
    "input id=\"stock-expiry\" type=\"date\" value={expiry} onChange={event => changed(() => setExpiry(event.target.value))}",
    "input id=\"stock-reason\" required maxLength={2000} value={reason} onChange={event => changed(() => setReason(event.target.value))}",
    "form onSubmit={save}",
    "select id=\"order-supplier\" required value={supplier} onChange={event => setSupplier(event.target.value)}",
    "input id=\"order-reference\" maxLength={2000} value={reference} onChange={event => setReference(event.target.value)}",
    "select id={`order-product-${index}`} required value={item.id_producto} onChange={event => change(index, 'id_producto', event.target.value)}",
    "input id={`order-quantity-${index}`} type=\"number\" min=\"0.001\" step=\"0.001\" required value={item.cantidad} onChange={event => change(index, 'cantidad', event.target.v",
    "input id={`order-cost-${index}`} type=\"number\" min=\"0\" step=\"0.01\" required value={item.precio_unitario} onChange={event => change(index, 'precio_unitario', event.tar",
    "table className=\"users-table\"",
    "table className=\"users-table\""
  ],
  "acciones": [
    "Quitar",
    "Agregar producto",
    "Crear producto",
    "Registrar movimiento",
    "Preparar venta libre",
    "Crear proveedor",
    "Crear compra",
    "{label}",
    "Ver lotes",
    "Editar",
    "Editar proveedor",
    "Compras registradas",
    "Recepciones recientes",
    "{item.id_compra ? 'Recibir compra' : 'Confirmar entrega física'}"
  ],
  "permisos": [
    "compras.ver",
    "inventario.ver",
    "proveedores.ver",
    "venta_libre.ver",
    "inventario.movimientos",
    "inventario.crear",
    "inventario.ajustar",
    "venta_libre.preparar",
    "proveedores.crear",
    "compras.crear",
    "inventario.editar",
    "proveedores.editar"
  ],
  "endpoints": [
    "/api/inventario/productos",
    "/api/inventario/proveedores",
    "/api/inventario/compras",
    "/api/inventario/ventas",
    "/api/inventario/movimientos",
    "/api/inventario/venta_catalogo"
  ],
  "lineas": 95
}

## frontend/src/pages/InventoryLots.tsx
{
  "componentes": [
    "LotList",
    "RecentReceipts",
    "PurchaseReceiptEditor"
  ],
  "controles": [
    "select id=\"lot-status\" value={state} onChange={event => setState(event.target.value)}",
    "select id=\"lot-window\" value={days} onChange={event => setDays(event.target.value)}",
    "table className=\"users-table\"",
    "select id=\"receipt-window\" value={days} onChange={event => setDays(event.target.value)}",
    "table className=\"users-table\"",
    "form onSubmit={save}",
    "input id={`receipt-quantity-${index}`} type=\"number\" required min=\"0.001\" step=\"0.001\" value={l.cantidad} onChange={event => change(index, 'cantidad', event.target.va",
    "input id={`receipt-price-${index}`} type=\"number\" required min=\"0\" step=\"0.01\" value={l.precio_unitario} onChange={event => change(index, 'precio_unitario', event.tar",
    "input id={`receipt-lot-${index}`} maxLength={100} required={!!l.fecha_caducidad} value={l.numero_lote} onChange={event => change(index, 'numero_lote', event.target.va",
    "input id={`receipt-expiry-${index}`} type=\"date\" value={l.fecha_caducidad} onChange={event => change(index, 'fecha_caducidad', event.target.value)}",
    "input id=\"receipt-document-date\" type=\"date\" value={date} onChange={event => setDate(event.target.value)}",
    "input id=\"receipt-folio\" maxLength={2000} value={folio} onChange={event => setFolio(event.target.value)}",
    "input id=\"receipt-document-url\" type=\"url\" pattern=\"https://.*\" maxLength={2000} value={url} onChange={event => setUrl(event.target.value)}",
    "textarea id=\"receipt-notes\" maxLength={2000} value={notes} onChange={event => setNotes(event.target.value)}"
  ],
  "acciones": [
    "Dividir en otro lote",
    "Quitar línea"
  ],
  "permisos": [],
  "endpoints": [
    "/api/inventario/lotes?dias=${days}&estado=${state}${product ? ",
    "/api/inventario/recepciones?dias=${days}"
  ],
  "lineas": 34
}

## frontend/src/pages/login.css
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 301
}

## frontend/src/pages/login.tsx
{
  "componentes": [
    "Login"
  ],
  "controles": [
    "form onSubmit={handleLogin}",
    "input type=\"email\" placeholder=\"correo@ejemplo.com\" value={email} onChange={(e) => setEmail(e.target.value)} required",
    "input type=\"password\" placeholder=\"••••••••\" value={password} onChange={(e) => setPassword(e.target.value)} required"
  ],
  "acciones": [
    " {loading ? 'Iniciando sesión...' : 'Iniciar sesión'} "
  ],
  "permisos": [],
  "endpoints": [],
  "lineas": 137
}

## frontend/src/pages/Medicos.tsx
{
  "componentes": [
    "ScheduleDialog",
    "BlocksDialog",
    "AgendaDialog",
    "SpecialtiesDialog",
    "Medicos"
  ],
  "controles": [
    "form onSubmit={save}",
    "input type=\"time\" aria-label={`Inicio ${weekdays[day]} bloque ${index + 1}`} value={block.hora_inicio.slice(0, 5)} readOnly={!editable} onChange={event => update(inde",
    "input type=\"time\" aria-label={`Fin ${weekdays[day]} bloque ${index + 1}`} value={block.hora_fin.slice(0, 5)} readOnly={!editable} onChange={event => update(index, 'ho",
    "input type=\"checkbox\" checked={block.activo} onChange={event => update(index, 'activo', event.target.checked)}",
    "form onSubmit={event => void write(event, block.id_bloqueo)}",
    "form className=\"operations-inline-form\" onSubmit={event => void write(event)}",
    "input id=\"block-start\" type=\"datetime-local\" value={form.inicio} onChange={event => setForm(previous => ({ ...previous, inicio: event.target.value }))} required",
    "input id=\"block-end\" type=\"datetime-local\" value={form.fin} onChange={event => setForm(previous => ({ ...previous, fin: event.target.value }))} required",
    "select id=\"block-type\" value={form.tipo} onChange={event => setForm(previous => ({ ...previous, tipo: event.target.value }))}",
    "input id=\"block-reason\" maxLength={2000} value={form.motivo} onChange={event => setForm(previous => ({ ...previous, motivo: event.target.value }))}",
    "input id=\"agenda-date\" type=\"date\" value={date} onChange={event => setDate(event.target.value)}",
    "form className=\"operations-form-section\" onSubmit={save}",
    "input id=\"medical-specialty-name\" value={editor.nombre} maxLength={100} onChange={event => setEditor(previous => ({ ...previous, nombre: event.target.value }))} requi",
    "textarea id=\"medical-specialty-description\" rows={2} maxLength={2000} value={editor.descripcion} onChange={event => setEditor(previous => ({ ...previous, descripcion: ev",
    "input id=\"medical-search\" type=\"search\" value={query} onChange={event => setQuery(event.target.value)} placeholder=\"Nombre\"",
    "select id=\"medical-specialty\" value={specialty} onChange={event => setSpecialty(event.target.value)}",
    "table className=\"users-table\""
  ],
  "acciones": [
    "Quitar",
    "+ Agregar bloque",
    "Cerrar",
    "Confirmar",
    "Cancelar",
    "Eliminar",
    "{mutation.pending ? 'Guardando…' : 'Agregar bloqueo'}",
    "Cerrar",
    "Cerrar",
    "Editar",
    "Guardar especialidad",
    "Nueva especialidad",
    "Cerrar",
    "Especialidades",
    "Recargar",
    "Ver todos los médicos",
    "{can('horarios.administrar') ? 'Editar horario' : 'Ver horario'}",
    "Bloqueos",
    "Ver agenda"
  ],
  "permisos": [
    "horarios.administrar",
    "medicos.ver",
    "medicos.administrar",
    "horarios.ver",
    "citas.ver"
  ],
  "endpoints": [
    "/api/medicos/${medico.id}/horarios",
    "/api/medicos/${medico.id}/bloqueos",
    "/api/medicos/${medico.id}/bloqueos${remove ? ",
    "/api/citas?${params}",
    "/api/especialidades",
    "/api/especialidades${editor.id ? ",
    "/api/medicos?${params}"
  ],
  "lineas": 110
}

## frontend/src/pages/Operations.css
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 45
}

## frontend/src/pages/OrdenesRecepcion.tsx
{
  "componentes": [
    "PrescriptionDelivery",
    "OrdenesRecepcion"
  ],
  "controles": [],
  "acciones": [
    "Confirmar entrega física",
    "Revisar entregas",
    "Descargar orden PDF",
    "Marcar procesada"
  ],
  "permisos": [
    "inventario.entregar",
    "orden_recepcion.procesar"
  ],
  "endpoints": [
    "/api/inventario/entregas_receta?id_orden=${order}",
    "/api/clinica/ordenes",
    "/api/clinica/ordenes/${order.id_orden}/procesar",
    "/api/clinica/documentos/${order.id_documento}"
  ],
  "lineas": 44
}

## frontend/src/pages/Pacientes.css
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 15
}

## frontend/src/pages/Pacientes.tsx
{
  "componentes": [
    "Pacientes"
  ],
  "controles": [
    "input className=\"duenos-search\" type=\"search\" placeholder=\"Nombre, especie o propietario\" value={busqueda} onChange={event => setBusqueda(event.target.value)}",
    "table className=\"duenos-table\"",
    "form onSubmit={save}",
    "input id=\"patient-name\" required maxLength={100} value={form.nombre} onChange={event => field('nombre', event.target.value)}",
    "select id=\"patient-owner\" required value={form.id_dueno} onChange={event => field('id_dueno', event.target.value)}",
    "input id=\"patient-species\" maxLength={100} placeholder=\"Ej. Perro, gato\" value={form.especie} onChange={event => field('especie', event.target.value)}",
    "input id=\"patient-breed\" maxLength={100} value={form.raza} onChange={event => field('raza', event.target.value)}",
    "input id=\"patient-sex\" maxLength={50} placeholder=\"Ej. Hembra, macho, desconocido\" value={form.sexo} onChange={event => field('sexo', event.target.value)}",
    "input id=\"patient-birth\" type=\"date\" min=\"0001-01-01\" max={today()} value={form.fecha_nacimiento} onChange={event => field('fecha_nacimiento', event.target.value)}",
    "input id=\"patient-weight\" type=\"number\" min=\"0.001\" max=\"99999.999\" step=\"0.001\" value={form.peso_actual} onChange={event => field('peso_actual', event.target.value)}",
    "textarea id=\"patient-notes\" rows={3} maxLength={5000} value={form.observaciones} onChange={event => field('observaciones', event.target.value)}"
  ],
  "acciones": [
    "+ Nuevo paciente",
    "Ver expediente",
    "Editar",
    "Eliminar",
    "×",
    "Cancelar",
    "{pending ? 'Guardando…' : 'Guardar paciente'}",
    "Cancelar",
    "{pending ? 'Eliminando…' : 'Eliminar paciente'}"
  ],
  "permisos": [
    "pacientes.eliminar",
    "pacientes.crear",
    "expediente.ver",
    "pacientes.editar"
  ],
  "endpoints": [
    "/api/pacientes",
    "/api/pacientes/propietarios",
    "/api/pacientes/${editor.paciente.id_mascota}",
    "/api/pacientes/${eliminando.id_mascota}"
  ],
  "lineas": 186
}

## frontend/src/pages/Servicios.tsx
{
  "componentes": [
    "ServiceEditor",
    "DisableService",
    "Servicios"
  ],
  "controles": [
    "form onSubmit={save}",
    "input id=\"service-name\" data-initial-focus value={form.nombre} onChange={event => setForm(previous => ({ ...previous, nombre: event.target.value }))} maxLength={100} ",
    "input id=\"service-duration\" type=\"number\" min={1} max={1440} step={1} value={form.duracion} onChange={event => setForm(previous => ({ ...previous, duracion: event.tar",
    "input id=\"service-price\" data-initial-focus={priceOnly ? true : undefined} type=\"number\" min={0} max={99999999.99} step=\"0.01\" value={form.costo} disabled={!priceAllo",
    "select id=\"service-state\" value={form.activo ? 'active' : 'inactive'} onChange={event => setForm(previous => ({ ...previous, activo: event.target.value === 'active' })",
    "textarea id=\"service-description\" rows={3} maxLength={5000} value={form.descripcion} onChange={event => setForm(previous => ({ ...previous, descripcion: event.target.val",
    "form onSubmit={save}",
    "input id=\"service-search\" type=\"search\" value={query} onChange={event => setQuery(event.target.value)} placeholder=\"Nombre o descripción\"",
    "input type=\"checkbox\" checked={includeInactive} onChange={event => setIncludeInactive(event.target.checked)}",
    "table className=\"users-table\""
  ],
  "acciones": [
    "Reintentar especialidades",
    "+ Nuevo servicio",
    "Recargar",
    "Editar",
    "Cambiar precio",
    "Desactivar"
  ],
  "permisos": [
    "servicios.editar_precio",
    "servicios.ver",
    "servicios.crear",
    "servicios.editar",
    "servicios.eliminar"
  ],
  "endpoints": [
    "/api/especialidades",
    "/api/servicios/${servicio.id_servicio}",
    "/api/servicios"
  ],
  "lineas": 77
}

## frontend/src/pages/Tenants.css
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 59
}

## frontend/src/pages/Tenants.tsx
{
  "componentes": [
    "Tenants"
  ],
  "controles": [
    "form onSubmit={save} aria-busy={saving}",
    "input autoFocus id=\"tenant-name\" name=\"nombre\" value={nombre} onChange={e => setNombre(e.target.value)} maxLength={150} required",
    "input id=\"tenant-email\" name=\"adminEmail\" type=\"email\" autoComplete=\"off\" value={adminEmail} onChange={e => setAdminEmail(e.target.value)} maxLength={100} required",
    "input id=\"tenant-password\" name=\"adminPassword\" type=\"password\" autoComplete=\"new-password\" aria-describedby=\"tenant-password-help\" value={adminPassword} onChange={e ",
    "input id=\"tenant-phone\" name=\"telefono\" type=\"tel\" value={telefono} onChange={e => setTelefono(e.target.value)} maxLength={20}",
    "textarea id=\"tenant-address\" name=\"direccion\" value={direccion} onChange={e => setDireccion(e.target.value)} rows={2}",
    "table className=\"tenants-table\""
  ],
  "acciones": [
    "+ Nueva veterinaria",
    "Cancelar",
    "{saving ? 'Creando veterinaria…' : 'Crear veterinaria'}",
    "Recargar lista"
  ],
  "permisos": [],
  "endpoints": [
    "/api/tenants"
  ],
  "lineas": 161
}

## frontend/src/pages/Usuarios.css
{
  "componentes": [],
  "controles": [],
  "acciones": [],
  "permisos": [],
  "endpoints": [],
  "lineas": 138
}

## frontend/src/pages/Usuarios.tsx
{
  "componentes": [
    "useMutation",
    "UserDialog",
    "UserActionIcon",
    "PasswordFields",
    "EyeIcon",
    "UsuarioEditor",
    "PasswordDialog",
    "EstadoDialog",
    "PermisosDialog",
    "Usuarios"
  ],
  "controles": [
    "dialog ref={ref} className={`users-dialog${wide ? ' users-dialog-wide' : ''}`} aria-labelledby={titleId} aria-busy={pending} onCancel={event => { event.preventDefault(",
    "input id={`${prefix}-password`} type={showPassword ? 'text' : 'password'} autoComplete=\"new-password\" value={password} onChange={event => onPassword(event.target.valu",
    "input id={`${prefix}-confirmation`} type={showConfirmation ? 'text' : 'password'} autoComplete=\"new-password\" value={confirmation} onChange={event => onConfirmation(e",
    "form onSubmit={save}",
    "input id=\"user-name\" data-initial-focus value={form.nombre} onChange={event => setForm(previous => ({ ...previous, nombre: event.target.value }))} maxLength={100} req",
    "input id=\"user-email\" type=\"email\" autoComplete=\"off\" value={form.correo} onChange={event => setForm(previous => ({ ...previous, correo: event.target.value }))} maxLe",
    "input id=\"user-phone\" type=\"tel\" value={form.telefono} onChange={event => setForm(previous => ({ ...previous, telefono: event.target.value }))} maxLength={20}",
    "select id=\"user-role\" value={form.rol} onChange={event => changeRole(event.target.value as Role)} disabled={lockedRole} required",
    "select id=\"user-state\" value={form.activo ? 'active' : 'inactive'} onChange={event => setForm(previous => ({ ...previous, activo: event.target.value === 'active' }))} ",
    "input type=\"checkbox\" checked={selected.includes(especialidad.id_especialidad)} disabled={selected.length >= 50 && !selected.includes(especialidad.id_especialidad)} o",
    "input id=\"specialty-name\" value={specialtyName} onChange={event => setSpecialtyName(event.target.value)} maxLength={100}",
    "textarea id=\"specialty-description\" value={specialtyDescription} onChange={event => setSpecialtyDescription(event.target.value)} rows={2} maxLength={2000}",
    "form onSubmit={save}",
    "select id={`${prefix}-${permiso.clave}`} aria-label={`Modo de permiso: ${permiso.descripcion}`} value={personal ? draft[permiso.clave] ? 'allow' : 'deny' : 'inherit'} ",
    "input id=\"users-search\" type=\"search\" value={query} onChange={event => setQuery(event.target.value)} placeholder=\"Buscar usuario…\"",
    "table className=\"users-table\""
  ],
  "acciones": [
    "×",
    "<EyeIcon visible={showPassword} />",
    "<EyeIcon visible={showConfirmation} />",
    "+ Crear especialidad",
    "Reintentar",
    "Cancelar especialidad",
    "{specialtyMutation.pending ? 'Creando…' : 'Crear y seleccionar'}",
    "Cancelar",
    "{mutation.pending ? 'Guardando…' : usuario ? 'Guardar cambios' : 'Crear usuario'}",
    "Cancelar",
    "{mutation.pending ? 'Guardando…' : 'Cambiar contraseña'}",
    "Cancelar",
    "{mutation.pending ? 'Guardando…' : usuario.activo ? 'Desactivar usuario' : 'Reactivar usuario'}",
    "Reintentar",
    "Restaurar permisos del rol",
    "Cerrar",
    "{mutation.pending ? 'Guardando…' : 'Guardar permisos'}",
    "+ Nuevo usuario",
    "Recargar",
    "<span aria-hidden=\"true\">✎</span> Editar",
    "<UserActionIcon type=\"password\" /> Contraseña",
    "<UserActionIcon type=\"key\" /> Permisos",
    "{usuario.activo ? 'Desactivar' : 'Reactivar'}"
  ],
  "permisos": [
    "usuarios.ver",
    "usuarios.crear",
    "usuarios.editar",
    "usuarios.permisos",
    "usuarios.desactivar"
  ],
  "endpoints": [
    "/api/especialidades",
    "/api/usuarios/${usuario.id}",
    "/api/usuarios",
    "/api/usuarios/${usuario.id}/password",
    "/api/usuarios/${usuario.id}/estado",
    "/api/usuarios/${usuario.id}/permisos"
  ],
  "lineas": 586
}

## backend/routes/citas.routes.js
Rutas/guards: router.use(autenticarUsuario, loadClinicAccess)
router.get('/selectores', requireAnyPermission('citas.crear', 'citas.editar'), obtenerSelectoresCitas)
router.get('/', requirePermission('citas.ver'), obtenerCitas)
router.post('/', requirePermission('citas.crear'), guardarCita)
router.put('/:id', requirePermission('citas.editar'), guardarCita)
router.patch('/:id/cancelar', requirePermission('citas.cancelar'), cancelarCita)
RPC:
Tablas:

## backend/routes/clinical.routes.js
Rutas/guards: router.use(auth, loadClinicAccess)
router.get('/ordenes', requirePermission('orden_recepcion.ver'), c.orders)
router.post('/ordenes/:id/procesar', requirePermission('orden_recepcion.procesar'), c.processOrder)
router.get('/documentos/:id', requireAnyPermission('consultas.ver', 'tratamientos.ver', 'recetas.ver', 'orden_recepcion.ver'), c.document)
router.use(clinician)
router.get('/consultas', requirePermission('consultas.ver'), c.list)
router.post('/citas/:id/iniciar', requirePermission('consultas.crear'), c.start)
router.get('/consultas/:id', requirePermission('consultas.ver'), c.get)
router.put('/consultas/:id', requirePermission('consultas.editar'), c.save)
router.post('/consultas/:id/registros/:tipo', c.record)
router.post('/consultas/:id/servicios', requirePermission('consultas.editar'), c.addService)
router.post('/consultas/:id/finalizar', requirePermission('consultas.finalizar'), c.finish)
router.post('/consultas/:id/reabrir', requirePermission('consultas.reabrir'), c.reopen)
router.put('/medicos/:id/cedula', requireAnyPermission('consultas.editar', 'usuarios.editar'), c.license)
router.put('/datos-profesionales', requirePermission('configuracion.editar'), c.clinic)
router.get('/pacientes/:id/expediente', requirePermission('expediente.ver'), c.history)
RPC:
Tablas:

## backend/routes/duenos.routes.js
Rutas/guards: router.use(autenticarUsuario)
router.use(loadClinicAccess)
router.get('/', requirePermission('propietarios.ver'), obtenerDuenos)
router.post('/', requirePermission('propietarios.crear'), crearDueno)
router.put('/:id', requirePermission('propietarios.editar'), actualizarDueno)
router.delete('/:id', requirePermission('propietarios.eliminar'), eliminarDueno)
RPC:
Tablas:

## backend/routes/especialidades.routes.js
Rutas/guards: router.use(autenticarUsuario, loadClinicAccess)
router.get('/', requireAnyPermission('usuarios.ver', 'usuarios.crear', 'usuarios.editar', 'medicos.ver', 'medicos.administrar', 'servicios.ver', 'servicios.crear', 'servicios.editar'), obtenerEspecialidades)
router.post('/', requireAnyPermission('usuarios.crear', 'medicos.administrar'), guardarEspecialidad)
router.put('/:id', requireAnyPermission('usuarios.editar', 'medicos.administrar'), guardarEspecialidad)
RPC:
Tablas:

## backend/routes/inventory.routes.js
Rutas/guards: router.use(auth, loadClinicAccess)
router.get('/:operacion', controller.execute)
router.post('/:operacion', controller.execute)
RPC:
Tablas:

## backend/routes/medicos.routes.js
Rutas/guards: router.use(autenticarUsuario, loadClinicAccess)
router.get('/', requirePermission('medicos.ver'), obtenerMedicos)
router.get('/:id/horarios', requirePermission('horarios.ver'), obtenerHorarios)
router.put('/:id/horarios', requirePermission('horarios.administrar'), guardarHorarios)
router.get('/:id/bloqueos', requirePermission('horarios.ver'), obtenerBloqueos)
router.post('/:id/bloqueos', requirePermission('horarios.administrar'), crearBloqueo)
router.delete('/:id/bloqueos/:idBloqueo', requirePermission('horarios.administrar'), eliminarBloqueo)
router.get('/:id/disponibilidad', requireAnyPermission('horarios.ver', 'citas.crear', 'citas.editar'), obtenerDisponibilidad)
RPC:
Tablas:

## backend/routes/pacientes.routes.js
Rutas/guards: router.use(autenticarUsuario)
router.use(loadClinicAccess)
router.get('/propietarios', requireAnyPermission('pacientes.ver', 'pacientes.crear', 'pacientes.editar'), obtenerPropietariosPacientes)
router.get('/', requirePermission('pacientes.ver'), obtenerPacientes)
router.post('/', requirePermission('pacientes.crear'), crearPaciente)
router.put('/:id', requirePermission('pacientes.editar'), actualizarPaciente)
router.delete('/:id', requirePermission('pacientes.eliminar'), eliminarPaciente)
RPC:
Tablas:

## backend/routes/servicios.routes.js
Rutas/guards: router.use(autenticarUsuario, loadClinicAccess)
router.get('/', requirePermission('servicios.ver'), obtenerServicios)
router.post('/', requirePermission('servicios.crear'), guardarServicio)
router.put('/:id', requireAnyPermission('servicios.editar', 'servicios.editar_precio'), guardarServicio)
router.delete('/:id', requirePermission('servicios.eliminar'), eliminarServicio)
RPC:
Tablas:

## backend/routes/sesion.routes.js
Rutas/guards: router.get('/', autenticarUsuario, loadClinicAccess, async (req, res) => {
RPC:
Tablas: veterinaria

## backend/routes/tenants.routes.js
Rutas/guards: router.use(autenticarUsuario, exigirSuperAdmin)
router.get('/', obtenerTenants)
router.post('/', crearTenant)
RPC:
Tablas:

## backend/routes/usuarios.routes.js
Rutas/guards: router.use(autenticarUsuario, loadClinicAccess)
router.get('/', requirePermission('usuarios.ver'), obtenerUsuarios)
router.post('/', requirePermission('usuarios.crear'), crearUsuario)
router.put('/:id', requirePermission('usuarios.editar'), editarUsuario)
router.patch('/:id/estado', requirePermission('usuarios.desactivar'), cambiarEstado)
router.put('/:id/password', requirePermission('usuarios.editar'), cambiarPassword)
router.get('/:id/permisos', requirePermission('usuarios.permisos'), obtenerPermisos)
router.put('/:id/permisos', requirePermission('usuarios.permisos'), actualizarPermisos)
RPC:
Tablas:

## backend/controllers/citas.controller.js
Rutas/guards:
RPC: vettrack_citas, vettrack_selectores_citas, vettrack_guardar_cita, vettrack_cancelar_cita
Tablas:

## backend/controllers/clinical.controller.js
Rutas/guards:
RPC: vettrack_guardar_registro_clinico, vettrack_finalizar_consulta, vettrack_documento_clinico
Tablas:

## backend/controllers/duenos.controller.js
Rutas/guards:
RPC:
Tablas: dueno, perfilusuario

## backend/controllers/especialidades.controller.js
Rutas/guards:
RPC: vettrack_guardar_especialidad
Tablas: especialidad

## backend/controllers/inventory.controller.js
Rutas/guards:
RPC: vettrack_inventario
Tablas:

## backend/controllers/medicos.controller.js
Rutas/guards:
RPC: vettrack_medicos, vettrack_horarios, vettrack_guardar_horarios, vettrack_bloqueos, vettrack_guardar_bloqueo, vettrack_eliminar_bloqueo, vettrack_disponibilidad
Tablas:

## backend/controllers/operacion.shared.js
Rutas/guards:
RPC:
Tablas:

## backend/controllers/pacientes.controller.js
Rutas/guards:
RPC: vettrack_propietarios_pacientes
Tablas: mascota, dueno

## backend/controllers/servicios.controller.js
Rutas/guards:
RPC: vettrack_servicios, vettrack_guardar_servicio, vettrack_eliminar_servicio
Tablas:

## backend/controllers/tenants.controller.js
Rutas/guards:
RPC:
Tablas: veterinaria, perfilusuario

## backend/controllers/usuarios.controller.js
Rutas/guards:
RPC: vettrack_autorizar_usuario, vettrack_crear_usuario, vettrack_editar_usuario, vettrack_estado_usuario, vettrack_ver_permisos_usuario, vettrack_permisos_usuario
Tablas: permiso, especialidad, medico_especialidad, perfilusuario

## backend/controllers/usuarios.shared.js
Rutas/guards:
RPC:
Tablas:

## Catálogo real verificado
82 permisos, defaults admin 82, recepción 25, médico 36. Existen pagos.ver/crear, dashboard.ver, reportes.ver y configuracion.ver/editar; no se necesitan roles nuevos. Tablas pago y metododepago existen; pago no tiene Tenant/orden/snapshot todavía; métodos vacío. Se requiere migración incremental. Veterinaria real tiene nombre, dirección, teléfono, correo, horario, foto, descripción y valoración (esta última sólo lectura).
