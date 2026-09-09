# 04 · Patrones reusables

Los 23 patrones transversales de Sirius, cada uno con el archivo donde mejor se ve.

**Este es el documento más valioso de la carpeta.** No son ideas de pizarrón: son decisiones que llevan meses corriendo en producción, con sus casos borde ya descubiertos y resueltos. Un producto nuevo que las adopte arranca con años de depuración regalados.

Se citan archivos y nombres de función, no números de línea — los números se mueven, los nombres no.

---

## Arquitectura

### 1 · Shell dirigido por un registro

Un solo arreglo de PHP maneja el sidebar, el agrupamiento, las filas de la matriz de permisos, el gate de la API y el ruteo. **Agregar un módulo jamás toca el núcleo.**

`includes/modules.php` → `permissions.php::user_modules()` → `app.js::renderSidebar()` → `router.js`

La clave es que el servidor calcula la lista de módulos visibles y el cliente solo la pinta. El frontend nunca decide permisos.

### 2 · Router por hash con `import()` dinámico y args como ruta

`#/módulo/a/b/c` → `import('./modules/módulo.js')` → `render(root, {...state, args:['a','b','c'], navigate})`.

Las sub-vistas son simplemente un `if (args[0] === 'x')` al inicio de `render()`. Sin bundler, sin build, sin framework, sin import map: el navegador resuelve los módulos ES relativos solo.

*Mejor ejemplo:* `router.js`; consumidores `modules/apps.js` (cuatro niveles de profundidad), `modules/api.js`, `modules/vinculacion.js`.

### 3 · Permisos de dos niveles con `mode_flags` como escape

Módulo (existe la fila) + flags (JSON dentro de la fila). El admin hereda todo **excepto** los flags que *recortan* la interfaz en lugar de ampliarla.

El frontend lee los mismos flags de `ctx.modules.find(m => m.key===…)?.flags` y **el backend los vuelve a verificar** con `user_flag()`. Nunca se confía en el cliente.

*Ver:* `permissions.php`, el idiom `myFlags()` en `modules/expedientes.js` y `modules/apps.js`, la matriz en `modules/usuarios.js`.

Explicado a fondo en [01](01-arquitectura.md).

### 4 · Un solo front controller con CSRF general en escrituras

`?r=recurso/acción`. El CSRF se verifica para cualquier método distinto de GET **antes de siquiera cargar el handler**. Los errores de base y los `Throwable` se capturan al centro, con enmascarado según `app_env`.

*Ver:* `api/index.php`, y del lado del cliente `assets/js/api.js`.

Lo elegante: como toda escritura es POST y toda lectura es GET, la protección CSRF no requiere que ningún handler se acuerde de nada.

---

## Modelo de datos y acceso

### 5 · Modelo de visibilidad: `NULL` significa "de todos"

`assigned_user_id IS NULL` = general, lo ve cualquiera. Con valor = solo su dueño. Un flag `manage` (o el rol admin) ve todo.

Repetido idéntico en cuatro dominios: `handlers/appointments.php`, `handlers/tasks.php`, `handlers/whatsapp.php`, `handlers/board.php`.

Que se repita cuatro veces es justamente la señal: **en el producto nuevo esto debe ser un helper compartido**, no una convención copiada a mano.

### 6 · Alcance privado/compartido con dueño

`scope` ENUM(`private`,`public`) + `owner_id`. En privado el dueño manda; en público cualquiera agrega pero solo el autor (o quien tenga `manage`) edita y borra.

*Ver:* `board_items`, `files`, `file_folders`; handlers `board.php` y `archivos.php`.

### 7 · Papelera polimórfica basada en snapshots

Los módulos nunca borran en duro para usuarios estándar: llaman a `includes/trash.php` con un `entity_type`, y un solo módulo de administración restaura o purga. El snapshot JSON incluye las tablas laterales, y `related_trash_id` agrupa cascadas.

*Ver:* `includes/trash.php`, `handlers/papelera.php`, y los puntos de llamada en `tasks.php`, `board.php`, `archivos.php`.

Detalles finos que ya están resueltos: sanado de referencias colgantes al restaurar, y los binarios que se quedan en disco mientras están archivados.

### 8 · Idempotencia de escrituras con UUID del cliente

El cliente genera un `crypto.randomUUID()`, lo guarda junto al registro en la cola offline y lo manda al servidor, donde una restricción UNIQUE lo rechaza si llega repetido.

*Ver:* `episodes.client_uuid`, `assets/js/outbox.js`, `handlers/episodes.php`.

Es la forma correcta de hacer reintentables las escrituras. **Cópialo entero.**

### 9 · Almacén de configuración llave/valor con blobs JSON

Una sola tabla `settings` (`skey` PK, `svalue` TEXT) guarda la configuración de IA, el branding, WhatsApp y el nombre del negocio, cada una como un blob JSON. Sin una tabla por cosa.

Al leer se hace merge profundo sobre los valores por defecto y se filtra con `array_intersect_key` contra esos defaults, que funciona como lista blanca de lo que un blob guardado puede contener.

*Ver:* tabla `settings`, `includes/ai.php::ai_config()`, `includes/branding.php`.

---

## Interfaz

### 10 · Primitivas de modal, confirmación y aviso

Un solo `modal({title, content, actions, size})` que devuelve `{close, el}`; `confirmDialog()` es una promesa encima de él; los avisos se autodesvanecen desde `#toast-root`. Hoja inferior en móvil, tarjeta centrada en escritorio.

*Ver:* `assets/js/ui.js`.

Detalle ganado a golpes: el `z-index` va inline en 9999 porque los z-index dinámicos del pizarrón superan el `z-50` de Tailwind.

### 11 · Campos declarativos → HTML → valores

Arreglos de definición (`{key, label, type, options, required, span}`) renderizados por `field()` y cosechados por `formValues(formEl)`.

*Ver:* `ui.js` (`field`, `formValues`, `inputCls`, `labelCls`).

### 12 · Motor de formularios dirigido por JSON

La versión a gran escala del anterior, y **una de las dos piezas clave de la estrategia multi-giro**: las secciones y campos de un formulario de captura se definen en un archivo JSON, no en código.

`assets/js/services_catalog.json` (92 KB de definiciones) → `assets/js/forms.js` (`sectionsHtml` / `initSections` / `fillSections` / `collectSections`) → validado del lado del servidor por `includes/services.php`.

Agregar un tipo de servicio nuevo con sus propios campos **no requiere tocar código**. Ver [06](06-producto-nuevo.md) para por qué esto importa tanto.

### 13 · Sondeo con guardia de ocupado

`const POLL_MS = 20000` (10 s en WhatsApp) + `isUserBusy()`, que suprime el refresco mientras hay un modal abierto o el foco está en un campo editable — así un repintado de fondo nunca se come el texto a medio escribir.

Los temporizadores además **se autocancelan** verificando si su nodo ancla sigue en el DOM, porque el router no tiene hook de desmontaje.

*Ver:* `ui.js::isUserBusy()`, `modules/dashboard.js`, `modules/pizarron.js` (que agrega su propia bandera `boardBusy` para el arrastre, que no pasa por ningún elemento enfocable).

### 14 · Búsqueda y autoguardado con debounce

Un `debounce(fn, ms=300)` de siete líneas usado tanto para filtros de lista como para autoguardar notas.

*Ver:* `ui.js::debounce`; filtros en `modules/catalogo_estudios.js` y `modules/log.js`; autoguardado en `modules/pizarron.js`.

### 15 · Diccionarios de color con clases literales completas

Un mapa `{clave: {bg, ring, header, swatch}}` para que el contraste se resuelva una sola vez y no se puedan producir combinaciones ilegibles.

**La razón técnica está comentada en el código:** Tailwind v4 escanea el código fuente buscando cadenas de clase *completas*. `bg-${color}-500` es invisible para el escáner y sale sin estilo. Por eso los mapas son explícitos.

*Canónico:* `modules/pizarron.js::PALETTE`; reusado en `modules/marketing.js`, `modules/whatsapp_config.js`, `modules/tareas.js`.

**Regla general para cualquier CSS con escaneo de fuente: toda clase debe existir como cadena literal completa en algún archivo.**

### 16 · Rejilla de tarjetas → drill-down

Una pantalla de aterrizaje con tarjetas grandes de icono que llevan a sub-vistas. Idéntica en cuatro módulos.

*Ver:* `modules/api.js::renderGrid()`, `modules/backup.js::renderGrid()`, `modules/apps.js`, la rejilla de servicios de `modules/admision.js`.

### 17 · Lista con filtros, paginación y selección múltiple

Estado a nivel de módulo (`filters`, `listState`, `selected = new Set()`) declarado **fuera** de `render()` para que sobreviva a los repintados parciales, con endpoints masivos del lado del servidor.

*Más limpio:* `modules/catalogo_estudios.js`. *Más completo:* `modules/archivos.js` (`bulk_delete`, `bulk_move`, `bulk_copy`).

### 18 · Tematización por usuario sin recompilar CSS

El color de acento se guarda por usuario en la base y se aplica con variables CSS bajo `[data-theme]`, más clases semánticas (`sidebar-link-active`) en vez de `bg-indigo-600` fijo.

**La razón es la misma del patrón 15:** Tailwind solo puede generar utilidades para clases que ve en tiempo de compilación, así que un color elegido en tiempo de ejecución **no puede ser una clase de Tailwind** — tiene que ser una variable CSS.

*Ver:* `src/tailwind.css` (bloques `[data-theme]`), `modules/configuracion.js::THEMES`, `handlers/branding.php::save_theme`, y `index.php` que pone `<html data-theme="…">`.

---

## Integraciones y seguridad

### 19 · La tríada `get` / `save` / `test` para integraciones con secretos

Todo servicio externo se configura igual: se obtiene la config (**la llave nunca se devuelve al navegador, solo un booleano de "existe"**), se guarda (**una llave vacía significa "no cambiar"**, para poder mostrar el campo enmascarado), y hay un botón explícito de probar conexión que cierra el ciclo.

La verificación de rol vive **dentro del handler** cuando el módulo dueño no está restringido por rol.

*Ver:* `handlers/ai.php`, `handlers/mail.php`, `handlers/calendar.php`, `handlers/whatsapp_config.php`.

### 20 · Uploads detrás de guardianes de PHP

Nada bajo `uploads/` es alcanzable por web (`.htaccess` con `Require all denied`). Cada binario se sirve por un script chico que valida sesión y permiso, y luego hace `readfile()`.

*Ver:* `public/archivo.php`, `public/whatsapp_media.php`, `public/marketing_asset.php`, `public/documento.php`.

El patrón por archivo: nombre aleatorio en disco (`stored_name`), nombre real en la base, y `X-Content-Type-Options: nosniff` al servir.

### 21 · La IA como un solo servicio compartido

Un `ai_generate()` multi-proveedor reusado por la burbuja de asistente, la redacción de marketing, la extracción de comisiones y la propuesta de plantillas. **La llave nunca sale del servidor.**

*Ver:* `includes/ai.php`, `includes/assistant_tools.php`; consumidores `handlers/assistant.php`, `handlers/marketing.php`, `handlers/commissions.php`.

La lección: **una capa de IA, muchos consumidores.** No una integración por funcionalidad.

---

## Offline y ciclo de vida

### 22 · Captura offline con cola de salida

Una cola en IndexedDB que acepta un envío con la red caída y lo vacía después **por el mismo endpoint que el camino en línea** — explícitamente "no hay una segunda forma de crear admisiones que mantener".

*Ver:* `assets/js/outbox.js` (`outboxEnqueue`/`outboxCount`/`outboxFlush`), consumidor `modules/wizard_admision.js`, y el Background Sync en `public/sw.js`.

Dos detalles críticos: el `client_uuid` del patrón 8 hace idempotente el reintento, y el service worker **pide un token CSRF fresco** antes de reintentar (el token vive en la sesión del servidor, no en ninguna variable que el worker pudiera heredar).

⚠️ La lógica de IndexedDB está **duplicada** entre `outbox.js` y `sw.js`, porque un worker clásico no puede importar el módulo ES de la página. Hay que mantener los dos esquemas idénticos a mano. En el producto nuevo: usar un service worker de tipo módulo y compartir el código.

### 23 · Keep-alive de sesión para formularios largos

Un ping a `auth/session` cada 5 minutos, para que un formulario de 46 campos no muera a media captura.

*Ver:* `app.js::keepSessionAlive()`.

Suena trivial y evita una clase entera de reportes de "se perdió todo lo que escribí".

---

## Cómo se ven todos juntos

Una pantalla típica de Sirius combina, sin darse cuenta, ocho de estos patrones:

```
Módulo registrado (1) → router carga el JS (2) → verifica flags (3)
  → render() pinta lista con filtros y selección (17)
  → búsqueda con debounce (14) → colores del diccionario (15)
  → editar abre un modal (10) con campos declarativos (11)
  → guardar hace POST con CSRF (4) → el handler revalida permisos (3)
  → borrar manda a la papelera (7) → se registra en auditoría
  → un sondeo con guardia de ocupado refresca de fondo (13)
```

Ninguna de esas piezas sabe de la otra. Eso es lo que hace que un módulo nuevo cueste tres archivos.

Sigue con [05 · Operación y despliegue](05-operacion-y-despliegue.md).
