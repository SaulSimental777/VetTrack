# Rediseño UI de Fase 6

Aplicado después de Fases 3–5B en `feature/fase-6-final-ux`. La inspección previa está en [PHASE_6_INSPECTION.md](PHASE_6_INSPECTION.md).

- Un sistema visual VetTrack para todas las pantallas.
- Formularios complejos por pasos: propietario/paciente, servicios, veterinario/disponibilidad y resumen.
- Un solo autocomplete/search-select por entidad, sin duplicar buscar y seleccionar. Aplicar a propietarios, pacientes, veterinarios, servicios, medicamentos, productos y proveedores.
- Duraciones humanas: 30 min, 1 h 30 min, 2 h, 20 h 3 min; almacenamiento en minutos.
- Estados automáticos cuando sea posible, sin listas extensas para recepción.
- Especialidades como etiquetas/recomendaciones; nunca bloquean citas.
- Resumen antes de operaciones importantes.
- Acciones reales: Guardar cita, Finalizar consulta, Guardar receta y Registrar pago. Se conservan las descargas clínicas existentes.

Implementación: `design-system.css`, `SearchableSelect`, `StatusBadge`, `Icon` y `ConfirmProvider`, sobre los módulos existentes. Consulta los manuales finales de [Administrador](MANUAL_ADMINISTRADOR.md), [Recepcionista](MANUAL_RECEPCIONISTA.md), [Médico](MANUAL_MEDICO.md) y la [matriz](MATRIZ_PANTALLAS_PERMISOS.md).
