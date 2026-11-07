# Fase 3: operación de clínica y citas

Rama: `feature/fase-3-operacion-citas`. Base aprobada de Fase 2:
`9a70d81ca399dc4f75ecdb4143c4b47a69f26eda`.

## Aplicación y validación realizadas

`migrations/20261107025139_clinic_operations_appointments.sql` es incremental,
transaccional y fue aplicada, con autorización, al proyecto
`yugbrcyrztwksiewzuvy`. Supabase registró la versión `20261107033338`
(`clinic_operations_appointments`), el 7 de noviembre de 2026 a las 03:33:38 UTC.
El archivo local conserva su nombre y su SQL aprobado, SHA-256:
`f31f0ada67d19eae2c26da1b322cb579232040bb2a22554b2359599b1344d342`.
No modifica las migraciones anteriores, Superadmin ni `experto`.

Conteos antes/después: veterinarias 7/7, perfiles 8/8, propietarios 10/10,
pacientes 4/4, citas 1/1, servicios 1/1 y `experto` 0/0. Las huellas de perfiles,
veterinarias, propietarios, pacientes y metadata de Superadmin permanecieron
iguales. Las suites reales conservaron esos datos tras sus rollbacks.

La migración conserva `cita.fecha`, `cita.id_servicio` y el estado anterior en
`estado_legacy`. Copia la asociación histórica a `cita_servicio`. Como antes no
existía precio histórico, esa copia toma el costo actual del catálogo; no puede
reconstruir el precio original. Los precios y duraciones de nuevas reservas
quedan guardados por servicio y no cambian al actualizar el catálogo.

Los servicios existentes reciben duración inicial de 30 minutos, costo nulo
equivale a cero y estado activo. Revisar esos valores antes de operar. Las citas
históricas conservan médico nulo: no se inventa una asignación. Estados históricos
desconocidos, relaciones inválidas y referencias entre clínicas hacen fallar
la transacción para revisión; no se corrigen silenciosamente.

Una cita histórica puede conservar un propietario distinto del propietario
actual del paciente si ambos pertenecen a la misma clínica. No se reescribe
ningún propietario, ni se agrega una FK que obligue a mantenerlos iguales.
Las nuevas operaciones de reserva siguen exigiendo el propietario actual.
La cita histórica real conservó IDs, fecha y servicio; el estado original quedó
en `estado_legacy`, sin médico inventado. Su asociación migrada registra precio
500 y duración 30 minutos.

## Tiempo y concurrencia

La zona explícita de esta fase es `America/Tijuana`, incluyendo horario de verano.
`fecha` histórica se interpreta en esa zona; las nuevas fechas usan `timestamptz`
y la API exige ISO 8601 con zona. Los horarios semanales son horas locales y
usan domingo=0 a sábado=6. Las franjas disponibles avanzan cada 15 minutos y
consideran la duración total solicitada, los bloques semanales, ausencias y
citas activas. Las franjas se calculan al consultar y se revalidan al reservar.
Si se habilitan clínicas en otras zonas, debe agregarse una zona por clínica
antes de utilizarlas fuera de Tijuana.

`citas.forzar_horario` permite una excepción al horario semanal. Nunca omite
ausencias ni reservas simultáneas. Las operaciones de escritura toman el mismo
bloqueo transaccional de clínica utilizado en Fase 2: esto serializa reservas,
cambios de horarios y cambios de membresía. Las escrituras directas por REST
están revocadas; las RPC validan el permiso funcional y derivan el Tenant.
El costo de esta sencillez es serializar escrituras de una misma clínica.

Un bloqueo nuevo que afecte citas activas se rechaza: reprogramarlas primero.
Cambiar horarios semanales no cancela ni modifica citas previamente reservadas.
Los servicios se desactivan, no se borran físicamente.

## Permisos y etiquetas

Se agregan siete claves: `medicos.ver`, `medicos.administrar`,
`servicios.crear`, `servicios.editar`, `servicios.eliminar`,
`servicios.editar_precio` y `citas.forzar_horario`.
Los demás permisos de citas/horarios/servicios ya existían. El catálogo pasa de
45 a 52. Defaults: administrador 52, recepcionista 19 y médico 20. Los overrides
existentes se conservan. `servicios.administrar` queda por compatibilidad del
catálogo anterior; las nuevas acciones usan los permisos específicos.

Los médicos son perfiles de rol `medico`, con cero o más especialidades.
Las especialidades sugeridas de un servicio sólo filtran y recomiendan.
Siempre se puede elegir “Ver todos los médicos”; una diferencia de especialidad
jamás impide reservar. Las nuevas RPC devuelven datos de operación necesarios,
sin datos de Supabase Auth. Los selectores de citas entregan únicamente IDs,
nombres y la relación paciente-propietario a quienes pueden crear/editar citas.

## Validación local

```powershell
node supabase/tests/run-clinic-operations-local.cjs
node supabase/tests/run-users-roles-local.cjs
cd backend
npm.cmd test
cd ../frontend
npm.cmd run lint
npm.cmd run build
npm.cmd run test:ui
cd ..
git diff --check
```

El harness levanta PostgreSQL 17 temporal, reproduce una base previa verificada,
aplica Fase 2 y Fase 3 localmente, ejecuta `tests/clinic_operations.sql` con
`BEGIN`/`ROLLBACK` y verifica concurrencia. No usa `.env` ni conexiones remotas.
`PG_BIN` puede indicar otra instalación de PostgreSQL 17.
La prueba de navegador usa Chrome y datos ficticios de Auth/API; `CHROME_BIN`
puede indicar el ejecutable. No reserva citas ni cambia precios en Supabase.
La interpretación de horas ambiguas al volver al horario de invierno coincide
con PostgreSQL (ocurrencia en horario estándar); disponibilidad y reserva usan
los mismos límites absolutos.

También se ejecutaron satisfactoriamente en Supabase real, como transacciones
con `BEGIN`/`ROLLBACK`, `tests/clinic_operations_remote.sql` (incluye cambio de
propietario histórico), `tests/users_roles_permissions.sql` y
`tests/tenant_isolation.sql`. Las fixtures usan UUID aleatorios y clínicas
aisladas; ninguna modifica usuarios ni registros productivos existentes.
Las regresiones admiten Fase 2 y Fase 3 y verifican las matrices exactas de
permisos y los grants correspondientes. Backend: 216/216 pruebas; lint y build
aprobados. Las pruebas de navegador usan exclusivamente Auth/API ficticias.

## Advisors después de aplicar (sin correcciones automáticas)

No aparecieron hallazgos con nivel ERROR. Los avisos no son resultados de las
aserciones SQL; se conservan aquí para revisión y seguimiento.

- Seguridad: 5 nuevos WARN de
  [visibilidad de esquema GraphQL para authenticated](https://supabase.com/docs/guides/database/database-linter?lint=0027_pg_graphql_authenticated_table_exposed),
  correspondientes a las cuatro tablas nuevas y `servicio`. RLS está habilitado
  y las pruebas de permisos, aislamiento y denegación a `anon` pasaron.
  Preexistían 12 avisos de esta clase, 2 INFO de RLS sin políticas en tablas
  cerradas y 1 WARN de protección contra contraseñas filtradas desactivada.
- Rendimiento: 2 nuevos WARN de
  [políticas permisivas múltiples](https://supabase.com/docs/guides/database/database-linter?lint=0006_multiple_permissive_policies)
  en `especialidad` y `medico_especialidad`. Mantienen las condiciones de Tenant
  y permisos de los dos módulos; el aviso señala su coste de evaluación.
- Rendimiento: 6 nuevos INFO de
  [FK sin índice de cobertura detectado](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys)
  y 6 nuevos INFO de
  [índices sin uso observado](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).
  Antes había 25/4 avisos de estas clases; después, 27/9. Desaparecieron 4/1
  hallazgos anteriores, respectivamente. No se eliminan índices recién creados
  ni se modifica la migración aplicada para silenciar estos avisos.

## Preparación de Fase 4 (sin implementar)

Flujo pendiente: Consulta → Diagnóstico → Tratamiento → Receta → Expediente →
Finalizar consulta → generación de cuatro documentos: Nota de Consulta
Veterinaria, Plan de Tratamiento, Orden de Cierre a Recepción y Receta Médica
Veterinaria Simple cuando corresponda. `cita_servicio` admite nuevos servicios
durante la consulta sin reescribir los precios ya aplicados.

Requisito proporcionado para la siguiente fase en México: Grupo I requiere
receta médica cuantificada con folio autorizado y no usa la receta simple;
Grupo II usa receta simple; Grupo III es libre venta. La siguiente fase deberá
validar los requisitos vigentes antes de implementar recetas. Esta fase no
implementa consulta clínica, diagnóstico nuevo, tratamiento, recetas ni PDFs.
