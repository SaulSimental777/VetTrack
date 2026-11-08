# Manual de Superadmin — VetTrack

Fase 7, revisado el 8 de noviembre de 2026. Superadmin administra la plataforma mediante la marca actual de Auth `app_metadata.super_admin === true`. No es un rol de clínica ni recibe acceso rutinario a expedientes, consultas, diagnósticos, tratamientos o recetas.

## Acceso y navegación

Inicia sesión con tu correo y contraseña. El workspace global muestra Dashboard, Veterinarias, Soporte y Mi cuenta; Cerrar sesión está en la cabecera. En móvil usa Abrir navegación. Las rutas llevan `#`, por ejemplo `#/superadmin/dashboard`. Una ruta clínica no habilita atención médica desde esta cuenta.

## Dashboard

`/superadmin/dashboard` muestra Tenants activos/suspendidos, usuarios, administradores, Tenants recientes y tickets abiertos/en atención. Son métricas administrativas reales; no muestran contenido clínico. **Actualizar** actualiza los datos.

## Veterinarias

En `/superadmin/veterinarias`, busca por nombre, filtra Estado y usa **Ver detalle**. Anterior/Siguiente pagina de 25 en 25. **Nueva veterinaria** captura nombre, teléfono y dirección. **Crear administrador inicial** permite nombre, correo, teléfono y contraseña inicial confirmada. La contraseña requiere 8 caracteres, mayúscula, minúscula y número; cada campo dispone de ojo independiente. **Crear veterinaria** crea la clínica y, cuando se selecciona, su administrador. Si no se crea administrador inicial, agrégalo desde el detalle.

El detalle muestra estado, fecha de creación disponible, usuarios por rol, pacientes como conteo, última actividad de acceso calculable y Administradores de la clínica. Las clínicas antiguas sin fecha fiable indican Sin fecha histórica. El logo se muestra cuando existe; su configuración diaria corresponde al administrador de esa clínica.

- **Editar datos / Guardar cambios:** nombre, teléfono, dirección y correo general.
- **Suspender veterinaria:** escribe Motivo obligatorio y pulsa Confirmar suspensión. Conserva Auth y datos, registra auditoría y bloquea la operación normal. Los perfiles activos conservan Ayuda y soporte.
- **Reactivar veterinaria:** revisa el resumen y pulsa Confirmar reactivación.
- **+ Crear administrador:** registra nombre, correo, teléfono y contraseña confirmada; se vincula exclusivamente a esta clínica con rol admin.
- **Desactivar / Activar:** confirma el cambio de acceso del administrador. Se protege al último administrador activo y a cuentas Superadmin.
- **Restablecer acceso:** introduce y confirma una nueva contraseña y pulsa Actualizar contraseña. No muestra contraseñas existentes.
- **Volver a veterinarias:** regresa al listado.

No hay eliminación física de Tenants ni administración diaria global de médicos, recepcionistas, servicios o inventario.

## Soporte

`/superadmin/soporte` reúne tickets globales. Filtra por Veterinaria, Estado o Prioridad; **Recargar** actualiza y Anterior/Siguiente pagina el listado. **Ver ticket** presenta Tenant, usuario, rol, fecha, módulo, descripción, prioridad, estado e Historial del ticket.

Escribe una respuesta y pulsa **Enviar respuesta**. Puedes seleccionar o arrastrar un PDF, PNG o JPG/JPEG de hasta 10 MB; espera Archivo listo. **Ver archivo** abre el adjunto privado autorizado. No se introducen URLs técnicas.

**Guardar estado** aplica Abierto, En revisión, En proceso, Resuelto o Cerrado. **Marcar resuelto** facilita la resolución; **Cerrar ticket / Confirmar cierre** conserva el historial y bloquea nuevas respuestas. Los cambios se registran en el historial. El acceso entre clínicas se limita a este soporte global y a la información administrativa autorizada.

## Mi cuenta

`/superadmin/cuenta` muestra tu correo y permite **Cambiar mi contraseña**: Nueva contraseña y Confirmar nueva contraseña, con ojos independientes y coincidencia visual. **Guardar contraseña** se habilita con una contraseña válida y coincidente. Solo modifica tu propia cuenta y mantiene el acceso Superadmin.
