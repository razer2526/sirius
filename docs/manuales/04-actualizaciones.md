# Sirius · Registro de actualizaciones

**Laboratorio y Clínica Bosques Polanco**
Manuales de referencia: versión 1.0 · octubre de 2026

> Los tres manuales (usuario estándar, administrador y desarrollador) **no se modifican** después de publicarse: son la versión 1.0. Todo cambio posterior se anota **aquí**, con fecha, a quién afecta y qué hay que hacer, si algo. Lo más reciente va primero.

> **Cómo leer cada entrada.** *Afecta a:* quién nota el cambio. *Acción:* lo único que hay que hacer (casi siempre, nada). *Manual:* dónde aparece la versión anterior, para que sepas qué texto quedó superado.

---

## Índice

1. [8 de octubre de 2026 · Seguridad y pruebas automáticas](#8-de-octubre-de-2026--seguridad-y-pruebas-automáticas)
2. [8 de octubre de 2026 · Correcciones de la revisión](#8-de-octubre-de-2026--correcciones-de-la-revisión)
3. [Cómo se agrega una entrada nueva](#cómo-se-agrega-una-entrada-nueva)

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
