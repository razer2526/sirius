# 01 · Arquitectura

Cómo está construido Sirius, capa por capa, con los contratos exactos de cada una.

**Stack:** PHP 8 + PDO · SPA de JavaScript vanilla con módulos ES nativos · Tailwind v4 (binario standalone) · MySQL en producción, SQLite en desarrollo.

**Dependencias: cero.** Sin Composer, sin framework de PHP, sin bundler, sin librerías de JS, sin CDN. Hasta las tipografías están autohospedadas. Las dos únicas librerías de terceros (FPDF y PHPMailer) están copiadas dentro de `public/vendor/` a mano.

---

## El principio que ordena todo

El núcleo son **1,382 líneas**. Todo lo demás son módulos encima.

| Capa | Archivos | Líneas |
|---|---|---|
| Núcleo JS | `app.js` + `router.js` + `api.js` + `ui.js` | 796 |
| Núcleo PHP | `db` + `auth` + `permissions` + `csrf` + `response` + `log` + `api/index.php` | 586 |

Agregar un módulo cuesta **tres archivos y cero cambios al núcleo**:

1. Una entrada en el arreglo de `public/includes/modules.php`
2. Un archivo `public/assets/js/modules/<clave>.js` que exporte `render(root, ctx)`
3. Un `public/api/handlers/<recurso>.php` que defina `handle_<recurso>($action)`, más una línea en la tabla `$routes` de `public/api/index.php`

El sidebar, la matriz de permisos, el ruteo, el título de la pantalla y el resaltado del menú salen solos del registro.

---

## Estructura de carpetas

```
/                        raíz del repo — NO es la raíz web
├─ public/               espejo 1:1 de public_html; la app desplegable completa
│  ├─ index.php          shell de la SPA (esqueleto HTML + sidebar + topbar)
│  ├─ login.php          formulario POST clásico, fuera de la SPA
│  ├─ manifest.php       manifest de PWA generado en PHP (sigue el branding)
│  ├─ sw.js              service worker
│  ├─ BUILD_VERSION      SHA corto del commit, lo escribe el CI
│  ├─ api/
│  │  ├─ index.php       front controller JSON (33 rutas)
│  │  └─ handlers/       32 archivos, uno por recurso
│  ├─ includes/          capa PHP compartida (31 archivos)
│  ├─ install/
│  │  ├─ index.php       asistente visual de primera instalación
│  │  ├─ schema.php      todo el esquema + migraciones + seeds (~1,730 líneas)
│  │  └─ setup.php       runner de migraciones por URL (?key=)
│  ├─ assets/js/         núcleo SPA + widgets compartidos + modules/ (23 archivos)
│  ├─ uploads/           contenido de usuario, bloqueado por .htaccess
│  └─ vendor/            FPDF y PHPMailer copiados a mano
├─ src/tailwind.css      única entrada de CSS
├─ tools/                solo desarrollo: PHP portable, tailwindcss.exe (gitignored)
├─ docs/                 esta carpeta (no se despliega)
└─ .github/workflows/    deploy.yml
```

---

## Capa 1 · Configuración — `includes/db.php`

```php
function app_config(): array          // require de config.php, memoizado
function db(): PDO                    // singleton
function db_driver(): string          // 'mysql' | 'sqlite'
function sql_full_name(string $alias = ''): string
```

`app_config()` hace `require` de `includes/config.php`, que **devuelve un arreglo literal de PHP**, y lo memoiza en un `static`. No hay `.env`, ni constantes, ni `getenv()`. Un solo lugar.

`config.php` está en `.gitignore`; lo genera el asistente de instalación con `file_put_contents`. `config.sample.php` es la plantilla versionada.

Claves del contrato de configuración:

| Clave | Para qué |
|---|---|
| `db.driver` | `'mysql'` (producción) o `'sqlite'` (desarrollo) |
| `db.host` / `db.name` / `db.user` / `db.pass` | partes del DSN de MySQL |
| `db.sqlite_path` | ruta del archivo, por defecto `<raíz>/data/sirius.sqlite` |
| `app_env` | `'dev'` muestra errores y filtra mensajes de excepción en las respuestas de la API; `'prod'` oculta ambos |
| `install_key` | secreto compartido que protege `install/setup.php?key=` |
| `cron_key` | secreto compartido para los scripts de cron invocados por HTTP |
| `ca_bundle` | ruta opcional a `cacert.pem` para TLS saliente (lo necesita el PHP portable de desarrollo) |

**Doble motor.** `db()` distingue dos ramas: para SQLite crea el directorio si falta y activa `PRAGMA foreign_keys = ON` y `PRAGMA journal_mode = WAL`; para MySQL arma el DSN con `charset=utf8mb4`. Las dos comparten `ERRMODE_EXCEPTION`, `FETCH_ASSOC` y — importante — **`EMULATE_PREPARES => false`**.

Las diferencias entre motores están contenidas en solo tres lugares: `sql_full_name()`, el esquema (dos diccionarios paralelos, ver [02](02-modelo-de-datos.md)) y `includes/backup.php`.

**No hay ORM ni query builder.** Cada handler escribe SQL preparado a mano contra `db()`.

> ⚠️ `sql_full_name()` tiene hard-codeadas las columnas `first_name / paternal_surname / maternal_surname` — convención de nombres mexicana, colada dentro de un helper del núcleo. Es una fuga de dominio, no un patrón a copiar.

---

## Capa 2 · Sesión y autenticación — `includes/auth.php`

```php
const REMEMBER_COOKIE = 'SIRIUS_REMEMBER';
const REMEMBER_DAYS   = 30;

function session_boot(): void
function current_user(): ?array
function attempt_login(string $username, string $password): array   // ['ok'=>bool, 'error'|'user']
function remember_login(int $userId): void
function attempt_remember_login(): bool
function remember_forget(): void
function do_logout(): void
```

Esta capa es **100% libre de dominio**. Se rescata tal cual.

**`session_boot()`** es idempotente. Nombre de sesión `SIRIUSSESSID`, cookie `httponly`, `samesite=Lax`, y `secure` detectado de `$_SERVER['HTTPS']`. El GC de sesión se sube a 4 horas en `public/.user.ini` porque los formularios largos de captura no hacen llamadas al servidor mientras se llenan.

**`current_user()`** se memoiza por petición usando `false` como centinela de "todavía no calculado", para poder cachear también el `null`. Si no hay `$_SESSION['user_id']`, **primero intenta `attempt_remember_login()`** antes de rendirse — por eso todos los puntos de entrada obtienen remember-me gratis con solo llamar `session_boot(); current_user();`. Reconsulta `users` en cada petición filtrando por `is_active = 1`, así que desactivar a alguien mata sus sesiones vivas.

**Remember-me: esquema selector/validador**, bien hecho y vale la pena copiarlo:

- La cookie vale `"<selector>.<validador>"`; selector de 12 bytes aleatorios, validador de 32.
- La base guarda el `selector` (único) y el **sha256 del validador**, nunca el validador.
- Se busca por selector y se compara con `hash_equals`.
- **Rotación en cada uso**: el token usado se borra y se emite uno nuevo.
- **Detección de robo**: si el selector existe pero el hash no coincide, se borran **todos** los tokens de ese usuario y se limpia la cookie.
- Los tokens vencidos se purgan de forma oportunista en cada `remember_login()`, sin necesidad de cron.

`session_regenerate_id(true)` tanto al iniciar sesión con contraseña como al restaurar por cookie.

> ⚠️ El freno de fuerza bruta es **solo de sesión** (`login_fails` / `login_last_fail` en `$_SESSION`, 5 intentos y 5 minutos de bloqueo). Se salta tirando la cookie de sesión. En un producto comercial esto tiene que vivir en la base o en un almacén compartido, indexado por IP y por usuario.

---

## Capa 3 · Autorización — `includes/permissions.php`

Este es uno de los diseños más rescatables del sistema.

```php
function modules_registry(): array
const ALWAYS_AVAILABLE_MODULES = ['configuracion'];
function user_permission_rows(int $userId): array      // module_key => flags[]
function is_admin_role(?array $user): bool
function user_can(string $moduleKey): bool
function user_can_for(array $user, string $moduleKey): bool
function user_flag(string $moduleKey, string $flag): bool
function user_flag_for(array $user, string $moduleKey, string $flag): bool
function user_modules(): array
```

### Roles

Tres, como ENUM en `users.role`: `estandar`, `administrador`, `developper`. `is_admin_role()` devuelve `true` para los dos últimos — en el código son idénticos, `developper` es solo una etiqueta.

### El registro de módulos — `includes/modules.php`

Un `return [...]` puro, `clave_de_módulo => definición`, memoizado. Campos de la definición:

| Campo | Significado |
|---|---|
| `label` | texto del sidebar y del topbar |
| `icon` | clave dentro de `ICONS` en `ui.js` |
| `phase` | solo documentación, no se usa en tiempo de ejecución |
| `flags` | `clave => descripción humana` — privilegios extra activables por usuario |
| `mode_flags` | subconjunto de `flags` que los administradores **NO** heredan (ver abajo) |
| `group` | `'admin_tools'` lo agrupa en una sección aparte del sidebar |
| `hidden` | alcanzable por URL y con permiso verificado, pero no listado en el sidebar |

Hoy hay **22 módulos** registrados.

### El modelo de dos niveles

`user_permissions` tiene PK `(user_id, module_key)` y una columna `flags` JSON.

- **La sola existencia de la fila otorga el módulo.**
- **El objeto JSON dentro de `flags` otorga los privilegios extra**: `{"manage":true,"delete":true}`.

`user_can_for()`:
1. Si el módulo está en `ALWAYS_AVAILABLE_MODULES` **o** el usuario es admin → concedido, pero igual pasa por `isset(modules_registry()[$moduleKey])`, así que una clave inexistente nunca se concede.
2. Si no → `array_key_exists($moduleKey, user_permission_rows($id))`.

### `mode_flags`: la excepción al "el admin puede todo"

Este es el detalle no obvio y es una idea genuinamente buena:

```php
$isMode = in_array($flag, modules_registry()[$moduleKey]['mode_flags'] ?? [], true);
if (is_admin_role($user) && !$isMode) return true;
return !empty($rows[$moduleKey][$flag]);
```

Un flag normal **amplía** capacidades, así que el admin lo hereda. Un `mode_flag` **sustituye la interfaz por una recortada** — el caso real es `admision.wizard`, que cambia el formulario completo de ~46 campos por un asistente de una pregunta por pantalla, pensado para los recolectores a domicilio. Si el admin lo heredara por rol, quedaría atrapado en la interfaz simplificada sin forma de volver.

La lección general: **distinguir permisos que suman de permisos que restan**. La herencia por rol solo aplica a los que suman.

### Dos capas de autorización, no una

La verificación del router es gruesa: "¿tienes el módulo X?". Los handlers **vuelven a verificar** por acción con `is_admin_role()` o `user_flag()`. Más de 20 handlers lo hacen. Por ejemplo `papelera.php` exige `is_admin_role()` aunque el permiso de módulo ya haya pasado, porque listar la papelera expone datos de otros usuarios.

Regla: **el permiso de módulo abre la puerta, el handler decide qué se puede hacer adentro.**

> ⚠️ En este archivo también viven `find_open_episode()`, `require_episode_visible()` y `patient_is_visible()` — seguridad a nivel de fila para los módulos clínicos. Están aquí porque los handlers se cargan uno por petición y varios las necesitan. Es una fuga de dominio dentro del núcleo de permisos.

---

## Capa 4 · Primitivas transversales

### `includes/csrf.php`

```php
function csrf_token(): string   // crea $_SESSION['csrf_token'] = bin2hex(random_bytes(32))
function csrf_verify(): bool    // hash_equals contra HTTP_X_CSRF_TOKEN ?? $_POST['_csrf']
```

Un token por sesión, nunca rota. Dos transportes: cabecera `X-CSRF-Token` (la SPA) o campo `_csrf` (formularios clásicos como el login).

### `includes/response.php`

```php
function json_headers(): void
function json_ok($data = null): void                          // {"ok":true,"data":…} y exit
function json_error(string $message, int $code = 400): void   // {"ok":false,"error":…} y exit
function request_body(): array                                // json_decode de php://input
```

**Las dos terminan el request con `exit`.** Ese es todo el modelo de control de flujo: los handlers no devuelven valores, terminan la petición. Todo sale con `JSON_UNESCAPED_UNICODE` y `Cache-Control: no-store`.

### `includes/log.php`

```php
function log_activity(
    string $moduleKey,
    string $action,
    ?string $detail = null,
    ?string $entityType = null,
    ?int $entityId = null,
    ?array $userOverride = null
): void
```

Inserta en `activity_log`. Detalles de diseño que importan:

- **Desnormaliza `username` junto al `user_id`**, para que el registro sobreviva al borrado del usuario.
- `detail` se trunca a 500 caracteres con `mb_substr`.
- **Todo el cuerpo va dentro de try/catch → `error_log()`**: la auditoría nunca debe romper la operación que está registrando.
- `$userOverride` existe para contextos sin sesión — crons, y el propio login (que registra antes de que el usuario de sesión exista).

---

## Capa 5 · Papelera genérica — `includes/trash.php`

Un bote de reciclaje **basado en snapshots y agnóstico de tabla**. Nada se marca como borrado en la tabla original: las filas se borran físicamente y su contenido completo se guarda como JSON en `trash_items`.

```php
function trash_archive(
    string $entityType, int $entityId, array $row,
    ?array $assignees, ?array $completions,
    string $summary, array $me, ?int $relatedTrashId = null
): int

function trash_insert_exact(PDO $pdo, string $table, array $columns, array $row): void
function trash_restore_row(array $trashRow): void
function trash_purge_file_binary(array $snapshotRow): void
```

**El punto de extensión son listas blancas de columnas**, una constante por tipo de entidad:

```
TRASH_TASK_COLUMNS · TRASH_PROJECT_COLUMNS · TRASH_RESULT_COLUMNS
TRASH_BOARD_COLUMNS · TRASH_FILE_COLUMNS · TRASH_FOLDER_COLUMNS
```

Agregar una entidad = una constante + un `case` en `trash_restore_row()` + una llamada a `trash_archive()` en el punto de borrado.

**Forma del snapshot:** `{"row": {...}, "assignees": [...]?, "completions": [...]?}`. Las tablas laterales (asignados de tarea, historial de completado de recurrentes) se capturan dentro del mismo snapshot, así sobreviven las relaciones muchos-a-muchos.

**Cascadas con `related_trash_id`** (auto-referencia): borrar un proyecto archiva primero el proyecto y luego cada tarea suya apuntando al id de papelera del padre. Restaurar el proyecto restaura sus hijos y borra esas filas hijas de la papelera. Las carpetas hacen lo mismo **recursivamente**.

**Sanado de referencias colgantes** — el detalle que hace seguras las restauraciones parciales: si al restaurar una tarea su `project_id` ya no existe, el campo se pone en `NULL` y la fila se restaura en la raíz, en vez de fallar.

**Los binarios de archivos se quedan en disco mientras están archivados** y solo se borran al purgar definitivamente.

> ⚠️ `trash_insert_exact()` **reinserta la llave primaria original**. Con AUTO_INCREMENT eso puede chocar si otra fila tomó ese id mientras tanto. El propio archivo lo reconoce en un comentario. En el producto nuevo hay que reservar los ids o aceptar re-asignarlos.

---

## Capa 6 · IA — `includes/ai.php`

Cliente multi-proveedor. **Todas las llamadas salen del servidor**, así que las llaves nunca llegan al navegador.

```php
const AI_PROVIDERS = ['gemini' => …, 'openai' => …, 'claude' => …];

function ai_config(bool $refresh = false): array
function ai_save(array $values): array
function ai_is_ready(): bool
function ai_generate(
    array $history, string $systemPrompt = '', ?string $modelOverride = null,
    int $maxTokens = 1200, array $tools = [], ?array $image = null
): string
```

**La configuración no vive en `config.php`** sino como un blob JSON en la tabla `settings` con `skey='ai'`. `ai_config()` mezcla los valores guardados sobre los predeterminados con caché estático, y usa `array_intersect_key` contra los defaults como lista blanca de lo que un blob guardado puede contener.

`ai_save()` trata **una `api_key` vacía como "no cambiar"**, para que la interfaz pueda mostrar el campo enmascarado.

`ai_generate()` normaliza un historial neutral (`['role'=>'user'|'assistant','text'=>…]`) y luego cada proveedor arma su propio payload. Los tres normalizan la truncadura y devuelven un texto amable cuando el filtro de contenido bloquea, en vez de lanzar excepción.

El transporte prefiere cURL pero **cae a `stream_context_create` si cURL no está compilado** — defensa contra hosting compartido. Traduce los errores 60/77 de cURL a un mensaje accionable sobre certificados raíz.

> ⚠️ **El tool-calling solo está implementado para Gemini** (bucle de máximo 4 rondas). Con OpenAI o Claude activos, pasar `$tools` simplemente se ignora en silencio. Es una degradación intencional pero es una trampa: cuando Marketing necesitó IA accionable, se resolvió pidiéndole al modelo texto con un formato de líneas fijo y parseándolo con regex, en vez de portar el tool-calling. Funciona con cualquier proveedor, pero es un parche.

---

## Capa 7 · Front controller — `public/api/index.php`

**Toda** llamada a la API es `api/index.php?r=<recurso>/<acción>`. Sin reescritura de rutas, sin depender de `mod_rewrite`: funciona en cualquier hosting.

La **tabla de rutas** es un arreglo literal, `recurso => [archivo, clave_de_módulo|null]`. Hoy tiene **33 entradas**. Un `null` significa "cualquier usuario autenticado, sin permiso de módulo" (`auth`, `assistant`, `push`).

El mapeo **no es 1:1**: un módulo puede tener varios handlers (`apps` es dueño de `documents`, `labs`, `quotes`, `commissions`, `coverage`) y un handler puede servir dos recursos con permisos distintos (`cobertura.php` define `handle_cobertura` para Admin Tools y `handle_coverage` para Apps).

### El pipeline

Cada paso falla rápido con `json_error()` y termina:

1. Parsear `$_GET['r']`; recurso desconocido o acción vacía → **404**
2. `current_user()` → **401**
3. Si el método no es GET, `csrf_verify()` → **403**
4. `user_can($moduleKey)` si no es `null` → **403**
5. `require` del handler y llamada a **`handle_<recurso>(string $action): void`**
6. Si el handler regresa sin haber terminado la petición → **404 "Acción no válida"** (la red de seguridad para una acción no reconocida)

La distinción lectura/escritura es puramente por método HTTP: **toda escritura es POST** y por lo tanto lleva CSRF.

**Manejo de errores:** dos catch, `PDOException` y `Throwable`. Los dos hacen `error_log()` del mensaje real y solo lo devuelven al cliente si `app_env === 'dev'`; en producción devuelven un genérico con HTTP 500.

### Contrato del handler

- Exactamente una función `handle_<recurso>(string $action)`, casi siempre un `switch` grande.
- Puede hacer `require_once` de los includes que necesite — como solo se carga un handler por petición, eso hace las veces de autoloader.
- Declara sus constantes de módulo arriba del archivo (`const TASK_PRIORITIES = [...]`), seguro por la misma razón.

---

## Capa 8 · La SPA

### `assets/js/api.js` — el cliente (45 líneas)

```js
export function setCsrf(token)
export const apiGet  = (route, params) => Promise<data>
export const apiPost = (route, body)   => Promise<data>
```

Detalles que importan:

- `cache: 'no-store'` en todas las peticiones.
- **HTTP 401 → redirección dura a `login.php`.** Por eso los módulos pueden hacer `catch {}` y simplemente rendirse.
- `json.ok === false` → lanza un `Error` con `.message` y `.code`.
- En éxito **desenvuelve y devuelve `json.data`**, así que quien llama nunca ve el sobre `{ok, data}`.
- `setCsrf()` guarda el token en el módulo **y** lo espeja en `window.__siriusCsrf`, porque las subidas con `FormData` no pasan por `request()` y ponen la cabecera a mano.

### `assets/js/router.js` — router por hash (61 líneas)

```js
export function initRouter(state)
export function navigate(route)
export function currentModuleKey()
```

- Formato `#/<módulo>[/arg1/arg2…]`; hash vacío → `dashboard`.
- **Consciente de permisos**: busca la clave en `appState.modules` (la lista calculada por el servidor). Desconocido o prohibido → cae al primer módulo disponible; si el usuario no tiene ninguno, muestra un panel de "pide acceso a un administrador".
- **La carga del módulo es un `import()` dinámico nativo**: `await import('./modules/' + moduleKey + '.js')` y luego `m.render(root, {...appState, args, navigate})`. Sin bundler, sin import map.

**El contrato del módulo es una sola exportación:**

```js
export async function render(root, ctx)
// ctx = { user, modules, registry, features, activeModule, args, navigate }
```

`args` es el resto de la ruta: `#/apps/membretador/hematologia` → `args = ['membretador','hematologia']`. Las sub-vistas son simplemente un `if (args[0] === 'x')` arriba de `render()`.

### `assets/js/app.js` — arranque (411 líneas)

Un solo objeto `state = {user, modules, registry, features, activeModule}`.

Secuencia de `boot()`: capturar el evento de instalación de PWA (**antes** del boot, para no perderlo) → `apiGet('auth/session')` → `setCsrf` + poblar estado → topbar → sidebar → menús → `initAssistant(state)` → `initRouter(state)` → registrar service worker → keep-alive → campana de notificaciones.

Mecanismos notables:

- **`keepSessionAlive()`** — pinguea `auth/session` cada 5 minutos para que un formulario largo no pierda la sesión.
- **En localhost desregistra activamente los service workers** salvo que la URL traiga `?sw=1`, para que desarrollo nunca pelee con el caché.
- **La campana** consolida notificaciones push y de WhatsApp, sondea cada 20 s, y suena un acorde de dos tonos **generado con Web Audio** (sin archivo de audio) solo cuando el contador *sube*.
- **`lockDesktopScroll()`** — el shell es `h-screen overflow-hidden` y solo `#module-root` hace scroll.

El shell de `index.php` **no manda ningún dato de usuario en el HTML**: `app.js` lo pide todo a `auth/session`.

### `assets/js/ui.js` — el kit compartido (279 líneas)

20 exportaciones. Este archivo es el que más se rescata.

| Exportación | Qué es |
|---|---|
| `ICONS` | registro de iconos: nombre → markup SVG interno (estilo Feather, 24×24, con trazo) |
| `icon(name, cls)` | envuelve `ICONS[name]` en un `<svg>`; **cae a `'folder'`** si el nombre no existe |
| `escapeHtml(str)` | escapa `& < > " '`; se usa antes de cualquier interpolación |
| `mdLite(str)` | markdown mínimo → HTML para las respuestas de IA. **Escapa primero**, así el modelo no puede inyectar HTML |
| `toast(msg, type)` | banner efímero en `#toast-root`; `success` / `error` / `info`; usa `textContent` |
| `modal({title, content, actions, size})` | crea un modal y devuelve `{close, el}`. `actions` = `[{label, primary?, danger?, onClick(close, btn)}]` |
| `confirmDialog(title, msg, opts)` | confirmación basada en promesa, encima de `modal()` |
| `isUserBusy()` | `true` si hay un modal abierto o el foco está en un campo editable |
| `inputCls` / `labelCls` | cadenas de clases canónicas para inputs y etiquetas |
| `field(def, value)` | renderiza un control etiquetado desde una definición declarativa |
| `formValues(formEl)` | cosecha todo `[name]` descendiente a un objeto plano |
| `fmtDate` / `fmtDateTime` / `fmtRelative` | formateo de fechas en español |
| `calcAge(birthDate)` | edad en años con corrección de mes/día |
| `spinner()` | HTML del spinner centrado |
| `debounce(fn, ms)` | debounce de flanco de salida |
| `recurrenceText` / `fullName` | ⚠️ **específicas de clínica**, no se rescatan |

Un helper privado que vale la pena copiar: `parseLocal(str)` normaliza `'YYYY-MM-DD HH:MM:SS'` y le agrega `T00:00:00` a las fechas sin hora, para que una fecha suelta se interprete como **medianoche local** y no UTC.

**Filosofía de la interfaz:** plantillas de cadena con `escapeHtml`, `innerHTML =` para intercambiar vistas completas, y listeners re-atados después de cada render. Sin DOM virtual, sin reactividad, sin componentes.

---

## Qué se rescata de esta capa

| Se rescata tal cual | Se rescata con cambios | No se rescata |
|---|---|---|
| `auth.php` completo (remember-me incluido) | `permissions.php` — sacar las funciones clínicas | `sql_full_name()` |
| `csrf.php`, `response.php`, `log.php` | `trash.php` — arreglar la colisión de llaves primarias | `recurrenceText()`, `fullName()` |
| El pipeline de `api/index.php` | `ai.php` — portar tool-calling a los tres proveedores | Los defaults médicos de `ai.php` |
| `router.js`, `api.js`, casi todo `ui.js` | El freno de fuerza bruta → moverlo a la base | Los iconos médicos de `ICONS` |
| La idea del registro de módulos | | |

Sigue con [02 · Modelo de datos](02-modelo-de-datos.md) o salta a [06 · El producto nuevo](06-producto-nuevo.md).
