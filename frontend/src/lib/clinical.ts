export type ClinicalKind = 'diagnostico' | 'tratamiento' | 'vacuna' | 'desparasitacion' | 'estudio'
export type ClinicalRow = Record<string, string | number | boolean | null>
export interface ClinicalDocument { id_documento: string; id_consulta: string; revision: number; tipo: string; creado_en: string }
export interface Consultation extends ClinicalRow {
  id_consulta: string; id_cita: string; id_medico: string; id_mascota: string; estado: string; revision: number
}
export interface Prescription { id_receta?: string; indicaciones: string | null; detalles: ClinicalRow[] }
export interface ClinicalBundle {
  consulta: Consultation
  contexto: { clinica: { nombre: string; direccion: string | null; telefono: string | null }; paciente: { nombre: string; especie: string | null; raza: string | null; peso: number | null }; propietario: { nombre: string }; medico: { id: string; nombre: string; cedula_profesional: string | null } }
  diagnosticos?: ClinicalRow[]; tratamientos?: ClinicalRow[]; vacunas?: ClinicalRow[]; desparasitaciones?: ClinicalRow[]; estudios?: ClinicalRow[]
  receta?: Prescription | null
  servicios: { id_servicio: string; nombre: string; precio_aplicado: number; duracion_aplicada: number }[]
  documentos: ClinicalDocument[]
  documentos_pendientes?: boolean
}
export interface ClosureOrder {
  id_orden: string; id_consulta: string; id_documento: string | null; estado: string; revision: number; creado_en: string
  contenido: { paciente: { nombre: string }; propietario: { nombre: string }; medico: { nombre: string }; servicios: { nombre: string; precio_aplicado: number }[]; productos: { nombre: string; cantidad: number }[]; proxima_cita: string | null; observaciones_administrativas: string | null }
}
export interface ClinicalField { key: string; label: string; type?: 'text' | 'textarea' | 'number' | 'date' | 'select'; required?: boolean; options?: [string, string][]; max?: number; step?: string }
export const clinicalSections: { kind: ClinicalKind; key: 'diagnosticos' | 'tratamientos' | 'vacunas' | 'desparasitaciones' | 'estudios'; module: string; label: string; fields: ClinicalField[] }[] = [
  { kind: 'diagnostico', key: 'diagnosticos', module: 'diagnosticos', label: 'Diagnósticos', fields: [{ key: 'tipo', label: 'Tipo', type: 'select', options: [['presuntivo', 'Presuntivo'], ['definitivo', 'Definitivo']], required: true }, { key: 'descripcion', label: 'Diagnóstico', type: 'textarea', required: true }] },
  { kind: 'tratamiento', key: 'tratamientos', module: 'tratamientos', label: 'Tratamientos', fields: [{ key: 'descripcion', label: 'Tratamiento', type: 'textarea', required: true }, { key: 'indicaciones', label: 'Indicaciones', type: 'textarea' }, { key: 'duracion', label: 'Duración' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }] },
  { kind: 'vacuna', key: 'vacunas', module: 'vacunas', label: 'Vacunas', fields: [{ key: 'nombre', label: 'Vacuna', required: true }, { key: 'laboratorio', label: 'Laboratorio' }, { key: 'lote', label: 'Lote' }, { key: 'fecha_aplicacion', label: 'Fecha de aplicación', type: 'date', required: true }, { key: 'proxima_aplicacion', label: 'Próxima aplicación', type: 'date' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }] },
  { kind: 'desparasitacion', key: 'desparasitaciones', module: 'desparasitacion', label: 'Desparasitación', fields: [{ key: 'producto', label: 'Producto', required: true }, { key: 'dosis', label: 'Dosis', required: true }, { key: 'peso', label: 'Peso (kg)', type: 'number', step: '0.001' }, { key: 'fecha', label: 'Fecha', type: 'date', required: true }, { key: 'proxima_fecha', label: 'Próxima aplicación', type: 'date' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }] },
  { kind: 'estudio', key: 'estudios', module: 'estudios', label: 'Estudios', fields: [{ key: 'tipo', label: 'Tipo', type: 'select', required: true, options: [['radiografia', 'Radiografía'], ['ultrasonido', 'Ultrasonido'], ['laboratorio', 'Laboratorio'], ['otro', 'Otro']] }, { key: 'nombre', label: 'Nombre', required: true }, { key: 'resultado', label: 'Resultado', type: 'textarea' }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }, { key: 'fecha', label: 'Fecha', type: 'date', required: true }] },
]
export const coreFields: ClinicalField[] = [
  { key: 'motivo_consulta', label: 'Motivo de consulta', type: 'textarea', required: true }, { key: 'anamnesis', label: 'Anamnesis', type: 'textarea' }, { key: 'exploracion_fisica', label: 'Exploración física', type: 'textarea' },
  { key: 'temperatura', label: 'Temperatura (°C)', type: 'number', step: '0.01', max: 69.99 }, { key: 'frecuencia_cardiaca', label: 'Frecuencia cardiaca', type: 'number', step: '1', max: 500 }, { key: 'frecuencia_respiratoria', label: 'Frecuencia respiratoria', type: 'number', step: '1', max: 400 },
  { key: 'mucosas', label: 'Mucosas' }, { key: 'trc', label: 'TRC' }, { key: 'peso', label: 'Peso (kg)', type: 'number', step: '0.001', max: 99999 }, { key: 'observaciones', label: 'Observaciones', type: 'textarea' }, { key: 'pronostico', label: 'Pronóstico', type: 'textarea' }, { key: 'indicaciones', label: 'Indicaciones generales', type: 'textarea' },
  { key: 'proxima_cita', label: 'Próxima cita sugerida', type: 'date' }, { key: 'observaciones_administrativas', label: 'Observaciones administrativas para recepción', type: 'textarea' },
]
export const medicationFields: ClinicalField[] = [
  { key: 'nombre_medicamento', label: 'Medicamento', required: true }, { key: 'principio_activo', label: 'Principio activo' }, { key: 'concentracion', label: 'Concentración' }, { key: 'presentacion', label: 'Presentación' },
  { key: 'dosis', label: 'Dosis', required: true }, { key: 'frecuencia', label: 'Frecuencia', required: true }, { key: 'duracion', label: 'Duración', required: true }, { key: 'via_administracion', label: 'Vía de administración', required: true },
  { key: 'cantidad', label: 'Cantidad', type: 'number', step: '0.001', required: true }, { key: 'grupo_prescripcion', label: 'Grupo de prescripción', type: 'select', required: true, options: [['no_clasificado', 'Sin clasificar'], ['I', 'Grupo I · cuantificada autorizada'], ['II', 'Grupo II · receta simple'], ['III', 'Grupo III · libre venta']] },
  { key: 'tiempo_retiro', label: 'Tiempo de retiro cuando aplique' }, { key: 'indicaciones', label: 'Indicaciones', type: 'textarea' },
]
export const documentLabels: Record<string, string> = { nota_consulta: 'Nota de Consulta Veterinaria', plan_tratamiento: 'Plan de Tratamiento', orden_recepcion: 'Orden de Cierre a Recepción', receta_simple: 'Receta Médica Veterinaria Simple' }
