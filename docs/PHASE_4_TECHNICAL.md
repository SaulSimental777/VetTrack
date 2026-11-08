# Fase 4 — consulta y expediente

Base de main al cerrar Fase 3: `ebf84c588c66e58c230341002c6999f023a848e3`.

Migración local: `20261107044154_clinical_consultations_records.sql`.
Aplicada con autorización en `yugbrcyrztwksiewzuvy`, versión registrada
`20261107051935`. No se modificaron migraciones ya aplicadas.

## Seguridad del backend

Ambas dependencias vulnerables eran transitivas de Express. Se actualizó Express
de 5.2.1 a 5.3.0 dentro de la misma versión mayor y se resolvió el lockfile por
los rangos compatibles del padre: body-parser 2.4.0, proxy-addr 2.0.8.
También quedó corregido qs. `npm install`, `npm audit` y `npm ls` confirmaron
0 vulnerabilidades. Sin `--force` ni `overrides`. PDFKit está fijado en 0.20.2.

## Modelo y permisos

- Consulta única por cita; inicio idempotente y estados automáticos de cita.
- Diagnósticos y recetas legacy conservados; nuevos registros ligados a consulta.
- Tratamientos, receta con múltiples medicamentos, vacunas, desparasitación y estudios.
- Expediente longitudinal paginado, incluyendo observaciones y diagnósticos legacy.
- Servicios adicionales usan `cita_servicio` con precio y duración aplicados.
  Añadir un servicio clínico no reprograma silenciosamente la cita original.
- Médico asignado o permiso explícito `consultas.tomar_ajenas` para escribir.
- Recepción queda excluida de lectura/escritura clínica incluso con un permiso
  clínico concedido por error; sólo recibe el cierre administrativo necesario.
- Reapertura autorizada requiere motivo y nueva revisión; no se permite si la
  orden ya fue procesada. Los snapshots de documentos anteriores no cambian.
- Catálogo: 69 permisos; defaults admin 69, médico 34, recepcionista 21.
- Nuevas tablas con RLS, `anon` sin acceso y escrituras mediante RPC protegidas.
  Wrappers públicos INVOKER; helpers privados con autorización y search_path vacío.

## Documentos

Al finalizar, la base guarda snapshots inmutables por consulta, revisión y tipo;
el backend genera automáticamente PDFs con PDFKit. Las descargas autenticadas
reconstruyen el documento desde su snapshot, sin necesitar almacenamiento de
archivos local ni un bucket público. Si se interrumpe el renderizado, la consulta
permanece finalizada y se puede reintentar la descarga sin duplicar órdenes.

Se generan Nota de Consulta, Plan de Tratamiento y Orden de Cierre. La receta
simple se genera cuando hay medicamentos clasificados en II/III, cédula del MVZ,
domicilio profesional y especie del paciente. Grupo I o sin clasificar bloquea
la receta simple; los demás documentos siguen disponibles. No se inventan
folios SENASICA ni firmas legales. Se deja espacio para firma del MVZ.

La clasificación se registra por el profesional, no se infiere a partir del
nombre del medicamento. Referencias consultadas:
[Reglamento de la Ley Federal de Sanidad Animal](https://sidof.segob.gob.mx/notas/docFuente/5248926),
[SENASICA: recetas cuantificadas](https://www.gob.mx/senasica/acciones-y-programas/recetas-medicas-cuantificadas-por-parte-de-medicos-veterinarios-435033).

## Validación

- Backend 230/230 pruebas, incluidas autenticación, roles, HTTP y PDFs reales.
- Lint y build de frontend aprobados.
- Humo de navegador: consulta asignada, edición clínica, receta múltiple,
  aviso Grupo I, servicio adicional, finalización, cuatro PDFs, expediente,
  privacidad y procesamiento de recepción.
- PostgreSQL 17 local: suite clínica dos veces con rollback, regresiones de
  usuarios/permisos, aislamiento y citas; legacy preservado y sin residuos.
- Supabase real: esas mismas cuatro suites con BEGIN/ROLLBACK, sin fixtures.
- Antes/después: perfiles 8, pacientes 4, citas 2, servicios 2, diagnóstico legacy
  1, recetas 0, productos 0; sin consultas productivas de prueba. Huellas de los
  datos previos y metadata de Superadmin conservadas.
- Advisors sin ERROR: avisos de esquema GraphQL autenticado 17→25, FK sin índice
  detectado 27→22, índices sin uso observado 9→23. Persisten dos avisos de políticas
  permisivas, dos de RLS sin políticas en tablas cerradas y protección de
  contraseñas filtradas desactivada. No se cambian asuntos ajenos automáticamente.

Fase 5 vincula opcionalmente receta con producto. Recetar no equivale a dispensar.
