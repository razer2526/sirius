# Sirius · Registro de actualizaciones

**Laboratorio y Clínica Bosques Polanco**
Manuales de referencia: versión 1.0 · octubre de 2026

> Los tres manuales (usuario estándar, administrador y desarrollador) **no se modifican** después de publicarse: son la versión 1.0. Todo cambio posterior se anota **aquí**, con fecha, a quién afecta y qué hay que hacer, si algo. Lo más reciente va primero.

> **Cómo leer cada entrada.** *Afecta a:* quién nota el cambio. *Acción:* lo único que hay que hacer (casi siempre, nada). *Manual:* dónde aparece la versión anterior, para que sepas qué texto quedó superado.

---

## Índice

1. [8 de octubre de 2026](#8-de-octubre-de-2026)
2. [Cómo se agrega una entrada nueva](#cómo-se-agrega-una-entrada-nueva)

---

## 8 de octubre de 2026

Correcciones que salen de la revisión del código hecha para los manuales (PR 70). No hay cambios de esquema de base de datos: **no hace falta correr `install/setup.php`**.

### Cobertura, Papelera y la silueta corporal ahora funcionan sin conexión

- **Qué cambió:** cuatro archivos de la interfaz no estaban en el precaché del service worker (`body_silhouette.js`, `coverage_map.js`, `modules/cobertura.js` y `modules/papelera.js`). Ya están.
- **Afecta a:** quien usa Sirius instalado como aplicación y se queda sin conexión: antes, esas pantallas no abrían; ahora sí cargan (los datos siguen requiriendo conexión).
- **Acción:** en cada dispositivo, **Configuración → Buscar actualizaciones** (la app nunca se actualiza sola a media sesión).
- **Manual:** desarrollador, apartado 10.1 y hallazgo 1 del apartado 17.

### Plantillas de Estudios: un rango sin sexo ya no da error

- **Qué cambió:** al guardar una plantilla de estudio, si un rango de referencia traía el sexo vacío, el guardado fallaba con un error del servidor. Ahora ese rango se toma como **«Ambos» (A)**, igual que cuando no se indica el sexo.
- **Afecta a:** administradores que editan o importan plantillas y valores de referencia. No se había observado el fallo en la práctica; era un caso latente.
- **Acción:** ninguna.
- **Manual:** desarrollador, hallazgo 4 del apartado 17 y la fila de «sex NOT NULL» del apartado 15.

### Membretes: los textos de ejemplo del responsable sanitario son genéricos

- **Qué cambió:** los campos del responsable sanitario mostraban, en gris, un nombre y una cédula de aspecto real como ejemplo. Ahora dicen «Dr. Nombre Apellido Apellido» y «Ced. Prof. 0000000».
- **Afecta a:** administradores en **Admin Tools → Membretes**. Es solo una pista visual: **no cambia ningún PDF ni lo ya capturado**.
- **Acción:** ninguna. Confirma que la firma de cada área tenga **sus propios datos reales** capturados.
- **Manual:** administrador, apartado 6; desarrollador, hallazgo 2 del apartado 17.

### WhatsApp: Configuración ya no trae un Business ID precargado

- **Qué cambió:** el campo **Business ID** venía con un número fijo en el código. Ahora viene vacío por defecto. Ese dato solo se muestra en la pantalla; **no se usa en las llamadas a WhatsApp**, así que el envío y la recepción de mensajes no se afectan.
- **Afecta a:** administradores en **Admin Tools → WhatsApp: Configuración → Credenciales**.
- **Acción:** si nunca habías guardado la configuración de WhatsApp y el campo aparece vacío, **escribe el Business ID de tu cuenta de Meta** y pulsa **Guardar**. Si ya lo habías guardado, se conserva.
- **Manual:** administrador, apartado 11; desarrollador, hallazgo 3 del apartado 17.

---

## Cómo se agrega una entrada nueva

Cada cambio que el usuario o el administrador pueda notar se anota en este archivo en el mismo PR que lo introduce, **arriba** de las entradas anteriores:

1. Un `##` con la fecha («9 de octubre de 2026») y, debajo, una línea con el PR y si exige correr `install/setup.php`.
2. Un `###` por cambio, con las cuatro viñetas: **Qué cambió**, **Afecta a**, **Acción**, **Manual**.
3. Actualizar el índice.
4. Regenerar el PDF: `python docs/manuales/build_manuales.py 04`.

Los manuales 01–03 solo se reescriben cuando se publique una **versión nueva completa** (2.0), no por cada cambio.
