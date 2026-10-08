# Sirius · Registro de actualizaciones

**Laboratorio y Clínica Bosques Polanco**
Manuales de referencia: versión 1.0 · octubre de 2026

> Los tres manuales (usuario estándar, administrador y desarrollador) **no se modifican** después de publicarse: son la versión 1.0. Todo cambio posterior se anota **aquí**, con fecha, a quién afecta y qué hay que hacer, si algo. Lo más reciente va primero.

> **Cómo leer cada entrada.** *Afecta a:* quién nota el cambio. *Acción:* lo único que hay que hacer (casi siempre, nada). *Manual:* dónde aparece la versión anterior, para que sepas qué texto quedó superado.

---

## Índice

1. [9 de octubre de 2026 · Calendario: semana por defecto y citas de solo lectura](#9-de-octubre-de-2026--calendario-semana-por-defecto-y-citas-de-solo-lectura)
2. [9 de octubre de 2026 · Membretador: datos del paciente desde su ficha](#9-de-octubre-de-2026--membretador-datos-del-paciente-desde-su-ficha)
3. [9 de octubre de 2026 · Membretador: crear plantillas de estudio](#9-de-octubre-de-2026--membretador-crear-plantillas-de-estudio)
4. [8 de octubre de 2026 · Calendario: sincronización con Google](#8-de-octubre-de-2026--calendario-sincronización-con-google)
5. [8 de octubre de 2026 · Tablet: la app ya se puede girar](#8-de-octubre-de-2026--tablet-la-app-ya-se-puede-girar)
6. [8 de octubre de 2026 · Seguridad y pruebas automáticas](#8-de-octubre-de-2026--seguridad-y-pruebas-automáticas)
7. [8 de octubre de 2026 · Correcciones de la revisión](#8-de-octubre-de-2026--correcciones-de-la-revisión)
8. [Cómo se agrega una entrada nueva](#cómo-se-agrega-una-entrada-nueva)

---

## 9 de octubre de 2026 · Membretador: crear plantillas de estudio

Función nueva (PR 76). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### «Crear plantilla» dentro del Membretador

- **Qué cambió:** en **Apps → Membretador → Análisis clínicos** hay un botón nuevo, **Crear plantilla** (en la lista de órdenes y en la pantalla «¿Qué estudios vas a membretar?»). Abre un asistente que pregunta:
  1. el **nombre del estudio**;
  2. la **técnica** (se aplica a todas las determinaciones; se puede cambiar en cada una);
  3. las **determinaciones**: nombre, unidad y sus **valores de referencia**, con filas para distinto sexo, edad o condición, o un texto (por ejemplo «Negativo»). También se pueden agregar determinaciones que **ya existen en el catálogo** buscándolas.
- Al guardar, la plantilla queda **seleccionada** y se continúa con la orden. El reporte sale con **el mismo formato de siempre** (técnica bajo cada determinación, resultado, unidad y referencias del paciente).
- **Quién puede usarlo:** quien tenga el **privilegio de Membretador** (el administrador lo tiene siempre). Antes, las plantillas solo se creaban en Admin Tools (solo administradores).
- **Qué no hace:** nunca sobrescribe. Un **nombre de plantilla repetido se rechaza**, y una determinación que **ya existe** en el catálogo (mismo nombre y unidad) se usa tal cual, sin cambiar sus referencias, y el asistente avisa cuáles fueron. Para corregir referencias ya guardadas se sigue usando **Admin Tools → Plantillas de Estudios**.
- **Consejo:** si los valores cambian por sexo, usa una fila **Femenino** y otra **Masculino**, sin «Ambos sexos»: «Ambos sexos» se muestra también a mujeres y a hombres, y el asistente avisa si se mezclan.
- **Afecta a:** quien membreta análisis clínicos.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 14.1 (Membretador); administrador, apartado 8 (Plantillas de Estudios).

---

## 9 de octubre de 2026 · Calendario: semana por defecto y citas de solo lectura

Mejora (PR 78). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### El Calendario se abre en la vista de semana

- **Qué cambió:** al entrar a **Calendario** ya no se abre el mes, sino la **semana actual**: ahí se leen completas las citas del día (el mes muestra solo 4 por día y recorta el resto). **Día** y **Mes** siguen a un clic en el selector de arriba, y **Hoy** vuelve a la fecha actual en la vista que estés usando.
- **Afecta a:** todos los que usan el Calendario.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 12 (Calendario): la captura principal muestra el mes, que ya no es la vista inicial.

### Las citas se abren en solo lectura; para cambiarlas hay que pulsar «Editar»

- **Qué cambió:** al pulsar una cita (en Día, Semana o Mes) se abre una **tarjeta de detalle** con título, estado, fecha y hora, servicio, responsable, ubicación, paciente, invitados y notas, **sin campos editables**. Abajo hay dos botones: **Cerrar** y **Editar**.
  - **Editar** abre el formulario de siempre (con **Guardar** y **Cancelar cita**). Cancelar una cita **solo** se puede desde ahí, después de pulsar Editar.
  - Quien no pueda editar la cita (no es la persona responsable ni administra el calendario) solo ve **Cerrar**, con un aviso.
  - Las citas que vienen de **Google Calendar** muestran un recordatorio: si se editan en Sirius, el cambio también se envía a Google.
- **Por qué:** abrir una cita para mirarla ya no puede modificarla ni cancelarla por un descuido.
- **Afecta a:** todos los que usan el Calendario. **Crear** una cita nueva (botón **Nueva cita** o el **+** de un día) funciona igual que antes.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 12.1: la captura «Detalle de una cita» muestra el formulario editable, que ahora se abre solo tras pulsar Editar.

---

## 9 de octubre de 2026 · Membretador: datos del paciente desde su ficha

Mejora (PR 77). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### Subir la ficha de identificación en las órdenes de análisis clínicos

- **Qué cambió:** en **Apps → Membretador → Análisis clínicos → Nueva orden** hay una tarjeta **Datos del paciente** con el botón **Subir ficha (PDF)**. Al subir la ficha de identificación del paciente (la que genera Admisión), Sirius llena solo: **nombre, sexo, edad, fecha de nacimiento y teléfono**; y, si estaban vacíos, el **folio**, el **médico solicitante** y la **toma de muestra**. Todo sigue editable, y el llenado **manual** funciona igual que antes.
- **Referencias al paciente:** con el sexo y la edad que trae la ficha, los **valores de referencia** de las determinaciones de las plantillas se ajustan al paciente (por ejemplo, hemoglobina de mujer o de hombre). Las referencias que tú hayas editado a mano **no se tocan**. Lo que ya habías escrito en los demás campos del formulario se conserva.
- **Cuándo usarlo:** antes o después de subir el PDF del laboratorio. Los datos del paciente que traiga ese PDF y los de la ficha se combinan: la ficha completa lo que el PDF no trae (teléfono, fecha de nacimiento…).
- **Afecta a:** quien membreta análisis clínicos.
- **Acción:** ninguna.
- **Manual:** estándar, apartado 14.1 (Membretador).

---

## 8 de octubre de 2026 · Calendario: sincronización con Google

Rediseño de la sincronización Google → Sirius (PR 74). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### Se acabaron los avisos repetidos del calendario

- **Qué pasaba:** Sirius pedía a Google «lo que cambió desde la última vez». Con un calendario que tiene un **evento diario desde hace años**, cualquier cambio a esa serie devolvía **miles de eventos** (todos los del pasado y los del futuro lejano), y cada uno mandaba su propio aviso a todo el equipo. Además, la fecha de modificación de cada evento se guardaba en un formato que MySQL alteraba, así que **todo parecía modificado en cada revisión** (cada 5 minutos) y los avisos se repetían.
- **Qué cambió:**
  - Sirius revisa en cada corrida solo una **ventana de eventos: de un mes atrás a seis meses adelante**, y compara cada evento con lo que ya tiene. Lo que ya está al día **no se reprocesa ni avisa**. Los eventos de fuera de la ventana **no se importan** (los diarios de hace años ya no estorban) y los que van entrando a la ventana con el paso de los días aparecen solos.
  - La **primera sincronización** (o la que sigue a reconectar la cuenta) importa **en silencio**, sin avisar por cada evento.
  - Cuando hay cambios, se avisan **juntos**: hasta 3 por separado; si son más, **un solo aviso-resumen** («12 cambios desde Google Calendar: …»).
  - La bitácora anota un renglón por corrida («Google Calendar: N nuevas, …») en vez de uno por evento.
- **Afecta a:** todos los que reciben avisos del calendario.
- **Acción:** ninguna. Los avisos que ya llegaron siguen en la campana: puedes marcarlos como leídos. Si en la base ya se importaron eventos de años pasados, **no se borran solos**: avísanos y los limpiamos.
- **Manual:** administrador, apartado 5 (API → Google Calendar); estándar, apartado 12 (Calendario).

### Eventos de Google que no aparecían en el calendario de Sirius

- **Qué cambió:** (1) los eventos de **todo el día** se ignoraban; ahora se importan de 00:00 a 23:59. (2) Un evento que **Sirius** creó en Google y cuyo identificador no se alcanzó a guardar ahora se **vuelve a enlazar** con la cita original, en vez de volver como duplicado. (3) Si un evento falla al importarse, **ya no detiene** a los demás ni deja la sincronización a medias.
- **Afecta a:** quien usa Google Calendar junto con Sirius.
- **Acción:** ninguna; los eventos aparecen en la siguiente sincronización (máximo 5 minutos). Si algo sigue sin aparecer, abre una vez `https://sirius-bpm.com/cron_calendar_sync.php?key=<cron_key>`: la respuesta indica cuántos eventos se importaron, cuántos tuvieron error y cuál fue el primer error.
- **Manual:** administrador, apartado 5.

---

## 8 de octubre de 2026 · Tablet: la app ya se puede girar

Corrección del bloqueo de orientación (PR 75). No hay cambios de esquema: **no hace falta correr `setup.php`**.

### La aplicación instalada ya no se bloquea en vertical

- **Qué pasaba:** la configuración de la aplicación instalada (el manifest) pedía orientación vertical fija, así que en una **tablet** Sirius se abría siempre en vertical y no se podía usar en horizontal aunque se girara el equipo.
- **Qué cambió:** ahora permite cualquier orientación. En horizontal (1024 píxeles o más de ancho) se ve el menú lateral fijo, igual que en una computadora; en vertical, el menú se oculta tras el botón de las tres rayas.
- **Afecta a:** quien usa Sirius **instalada** como aplicación en Android (tablet o teléfono). En el navegador normal nunca hubo bloqueo.
- **Acción:** Android actualiza la aplicación instalada por su cuenta, pero puede tardar **hasta un día**. Para verlo de inmediato: **desinstalar la aplicación de la tablet y volver a instalarla** desde el navegador (Configuración → Instalar la app). También hay que tener activado el giro automático de la tablet.
- **Manual:** estándar, apartados 3.3 (Sirius en el teléfono) y 16.

---

## 8 de octubre de 2026 · Seguridad y pruebas automáticas

Endurecimiento de seguridad y pruebas automáticas (PR 71 y 72). **Exige correr una vez la actualización de la base de datos** al desplegarlo, porque agrega la tabla `login_attempts`. Esa actualización **ya no se hace con `?key=` en la dirección**: ver la segunda entrada.

### Respaldos cifrados con contraseña

- **Qué cambió:** al exportar un respaldo aparece **«Proteger con contraseña (recomendado)»**, activado por defecto. El archivo se cifra (AES-256) con una contraseña de **mínimo 10 caracteres**. Al importarlo, Sirius pide esa contraseña antes de mostrar el contenido. Sin contraseña (opción desmarcada, con confirmación) el archivo sigue saliendo como antes.
- **Afecta a:** administradores en **Admin Tools → Backup**. Los respaldos anteriores sin cifrar se siguen pudiendo importar.
- **Acción:** usa contraseña al exportar y **guárdala en un lugar seguro: si se pierde, el respaldo no se puede recuperar**. Conviene no guardarla junto al archivo.
- **Por qué:** el respaldo incluye las llaves de IA, correo y WhatsApp y los hashes de contraseña de los usuarios.
- **Manual:** administrador, apartado 12; desarrollador, apartados 8.6 y 16.

### Actualizar la base de datos: ahora es un formulario, no una dirección con clave

- **Qué cambió:** `install/setup.php?key=…` **ya no funciona**. Ahora se abre `https://sirius-bpm.com/install/setup.php`, se escribe la clave de instalación en el campo y se pulsa **Aplicar**. La clave viaja por POST y **ya no queda en los registros de acceso ni en el historial del navegador**. Tras 5 claves incorrectas hay una espera de 10 minutos.
- **Afecta a:** quien aplique actualizaciones de base de datos (administrador/desarrollador).
- **Acción:** **hacerlo una vez después de este despliegue** (crea la tabla `login_attempts`); si no se hace, todo sigue funcionando, solo que el freno por IP del inicio de sesión no se activa. Si guardaste el enlace con `?key=`, bórralo de tus favoritos.
- **Manual:** administrador, apartados 20.2 y 21; desarrollador, apartado 12.3.

### Inicio de sesión: freno también por IP

- **Qué cambió:** además del freno por sesión (5 fallos → 5 minutos), ahora una **misma IP** que acumula 20 inicios de sesión fallidos en 15 minutos queda bloqueada temporalmente, con el mensaje «Demasiados intentos desde esta red».
- **Afecta a:** quien intente adivinar contraseñas abriendo sesiones nuevas. El personal de la clínica no lo nota: sale por una misma IP, y el límite es holgado a propósito.
- **Acción:** ninguna. Si alguien del equipo se ve bloqueado, esperar 15 minutos.
- **Manual:** desarrollador, apartados 6 y 16.

### La conexión siempre es segura (HTTPS)

- **Qué cambió:** entrar por `http://` redirige automáticamente a `https://`. Estaba comentado en la configuración del servidor.
- **Afecta a:** todos, sin notarlo. Enlaces y favoritos antiguos con `http://` siguen funcionando.
- **Acción:** ninguna. Si algún día el sitio no abre y el navegador dice «demasiadas redirecciones», avisa al desarrollador.
- **Manual:** administrador, apartado 19; desarrollador, apartado 16.

### El nombre de la clínica sale de la configuración

- **Qué cambió:** la pantalla de inicio de sesión y el nombre de la aplicación instalada muestran el nombre capturado al instalar (**settings → clinic_name**) y no uno fijo en el código. Para esta clínica no cambia lo que se ve en el login. El nombre de la aplicación instalada pasa a ser «Sirius — Laboratorio y Clínica Bosques Polanco».
- **Afecta a:** todos, apenas.
- **Acción:** ninguna. En dispositivos donde Sirius ya está instalada, el nombre bajo el icono puede tardar en actualizarse o requerir reinstalarla.
- **Manual:** desarrollador, hallazgo 5 del apartado 17.

### Política de seguridad de contenido (CSP), en modo de observación

- **Qué cambió:** el servidor ahora manda una política que describe de dónde puede cargar cosas la aplicación (solo lo propio, el mapa de Cobertura —Leaflet y OpenStreetMap— y nada más; **sin scripts en línea**). Por ahora es **solo de observación**: no bloquea nada, solo registra en el log de errores del servidor (líneas que empiezan con `CSP:`) lo que habría bloqueado.
- **Afecta a:** nadie lo nota. En una revisión de 40 pantallas (incluido el mapa) no hubo ningún reporte.
- **Acción:** ninguna por ahora. Pasados unos días, si en **cPanel → Errores** no aparecen líneas `CSP:` legítimas, se activa el modo estricto (cambio de una palabra en `.htaccess`).
- **Por qué:** limita el daño si algún día se cuela texto malicioso en una pantalla.
- **Manual:** desarrollador, apartado 16 (falta de CSP queda superado).

### Pruebas automáticas

- **Qué cambió:** hay 18 pruebas unitarias/estructurales y 13 de integración (`tests/`), que GitHub corre en cada pull request. Cubren permisos, vacaciones y antigüedad, respaldo cifrado, el freno de login, el esquema, el precaché del service worker y el ciclo completo de login, CSRF y permisos.
- **Afecta a:** desarrolladores. No cambia nada para los usuarios.
- **Acción:** antes de abrir un PR, `tools\php\php.exe tests\run.php` y `tools\php\php.exe tests\api_smoke.php`.
un.php` y `tools\php\php.exe testspi_smoke.php`.
- **Manual:** desarrollador, apartado 13 («No hay pruebas automatizadas» queda superado) y hallazgo 7 del apartado 17.

---

## 8 de octubre de 2026 · Correcciones de la revisión

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
