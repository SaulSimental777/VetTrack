# Rediseño UI de VetTrack

## Fase 8 — Recuperación visual selectiva para revisión

Revisado el 25 de noviembre de 2026. Base: `main` en `1a22a7d`; el rediseño rechazado sigue sin integrar, en la rama local `feature/fase-8-global-uiux`. No se crea commit, push ni merge antes de aprobación visual explícita.

- **Descartado (A):** sustituciones globales de colores y estilos crema del rediseño rechazado. Se recuperan selectivamente los ocho CSS originales de `1a22a7d` después de revisar sus diffs exclusivamente visuales: App, design-system, Duenos, Operations, Pacientes, Tenants, Usuarios y login. Sin reset, revert de commits ni restauración de lógica TSX.
- **Recuperado:** módulos administrativos y clínicos con paleta verde/neutra anterior, tarjetas blancas, encabezados y filas compactos. Se conservan todas las columnas, filtros, acciones, modales y detalles. Incluye Propietarios, Pacientes, Citas, Consultas, Expediente, Órdenes de recepción, Médicos, Horarios, Servicios, Inventario, Proveedores, Compras, Pagos, Reportes, Configuración, Usuarios, Permisos, Ayuda y soporte y Superadmin.
- **Conservado (B):** sidebar organizado, logo/nombre de clínica, usuario/rol/logout, ausencia de barra superior y responsive útil. `global-ui.css` contiene únicamente shell, ajustes de densidad y protección de tablas/diálogos; no aplica la paleta de Inicio a otros módulos.
- El workspace no contiene barra superior horizontal. Logo real y nombre de clínica arriba del sidebar; inicial de respaldo si no hay imagen o falla. Usuario, rol y cierre de sesión abajo. El menú tiene scroll independiente del pie de sesión. El contenido empieza directamente con cada módulo.
- Desktop desde 1024 px: sidebar de 244 px. Tablet entre 768 y 1023 px: 72 px con iconos, nombres accesibles y títulos. Móvil: botón flotante y drawer con backdrop, Escape, foco contenido en navegación abierta y retorno al activador. El menú cerrado no recibe foco. Se respeta reducción de movimiento.
- **Conservado (C):** Dashboard pasa a llamarse Inicio exclusivamente en la presentación; `/dashboard`, `dashboard.ver`, claves y contratos siguen vigentes. Permisos conserva sus nombres humanos por módulo; se agregan solo etiquetas de presentación para Permisos de usuario, Venta preparada y Especialidades médicas. Valores, herencia, overrides y protecciones no cambian. Los accesos rápidos mantienen los editores y validaciones existentes.
- **Inicio compacto:** la paleta aprobada queda dentro de `.home-page` en `Inicio.css`. Mantiene saludo, fecha, acciones, cuatro métricas autorizadas y Revisar. Flujo del día muestra máximo dos filas de 68 px por categoría y enlace al listado completo; sin listas largas ni scroll interno. Conserva altura aproximadamente estable entre cero y cien registros.
- **Totales reales:** Por atender cuenta todas las citas del día en estados atendibles del listado existente, sin recortar antes de contar. Por cobrar cuenta todos los pendientes existentes. En consulta usa el agregado `Consultas en curso` de `/api/operacion/dashboard`, independiente del tamaño del listado clínico. Cuando no puede consultarse un total, muestra “—”, no un cero inventado. Los errores se distinguen de vacíos. No se crean endpoints ni agregados nuevos.
- Las tablas conservan ancho mínimo y scroll dentro del contenedor, sin comprimir roles o estados letra por letra. Los diálogos permanecen dentro del viewport; Permisos mantiene encabezado estable, scroll interno y grupos de módulo.

### Validación reproducible

`cd frontend`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:ui`; desde la raíz, `git diff --check`.

La suite usa Chrome local con Auth/API/Storage simulados y bloquea tráfico externo. No usa credenciales ni modifica Supabase. Cubre regresiones de agenda, servicios, horarios, atención clínica/documentos, inventario, compras, pagos, reportes, propietarios/pacientes, usuarios/permisos, soporte, logos y administración global. `global-ui.cjs` verifica admin, recepción, médico y Superadmin en 1920×1080, 1536×864, 1366×768, 1280×720, 1024×768, 820×1180, 768×1024 y 390×844. Prueba 0, 1, 2, 3, 5, 10, 20 y 100 casos por bloque, contadores completos, máximo dos filas, altura estable y ausencia de scroll interno; simula además listado clínico limitado a cinco filas con total superior.

Genera capturas desktop de Inicio, Propietarios, Pacientes, Citas, Consultas, Expediente, Inventario, Compras, Usuarios, Permisos, Configuración y Superadmin; también Inicio, Usuarios y Permisos en móvil, más drawers y accesos de Inicio. Inicio con cinco y veinte casos se captura en 1920×1080, 1366×768 y 1024×768; Usuarios también en tablet de 820 px. Cada ejecución imprime el directorio temporal de capturas para revisión visual. Son datos de prueba, nunca producción.

No se modifican backend, contratos API, permisos internos, reglas de negocio, RLS, migraciones ni datos remotos. No requiere nuevas pruebas de backend.

### Estado para revisión local

Lint, build, las seis suites browser y `git diff --check`: correctos. La recuperación visual agrega 436 controles de layout, roles y cantidades. La validación usa datos simulados; no sustituye la aprobación visual del usuario.

Rama: `feature/fase-8-global-uiux`. HEAD y main permanecen en `1a22a7d05c1da800e53d95eb1e2a5de961437dbc`. Índice sin archivos preparados; working tree con 15 archivos modificados y tres nuevos. Sin commit, push, merge ni escrituras remotas durante esta recuperación.

Archivos locales frente a main (incluyen las mejoras conservadas del trabajo anterior):

```text
docs/MANUAL_ADMINISTRADOR.md
docs/MANUAL_MEDICO.md
docs/MANUAL_RECEPCIONISTA.md
docs/MANUAL_SUPERADMIN.md
docs/MATRIZ_PANTALLAS_PERMISOS.md
docs/UI_REDESIGN_NOTES.md
frontend/package.json
frontend/src/App.tsx
frontend/src/pages/Citas.tsx
frontend/src/pages/Dashboard.tsx
frontend/src/pages/Pacientes.tsx
frontend/src/pages/Platform.tsx
frontend/src/pages/Usuarios.tsx
frontend/tests/final-ux-ui.cjs
frontend/tests/platform-ui.cjs
frontend/src/global-ui.css (nuevo)
frontend/src/pages/Inicio.css (nuevo)
frontend/tests/global-ui.cjs (nuevo)
```

## Fase 6 — Base anterior

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
