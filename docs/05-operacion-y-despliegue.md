# 05 · Operación y despliegue

Cómo se construye, se despliega y se actualiza Sirius en producción — y qué decisiones existen solo por el hosting.

---

## El build de CSS: Tailwind v4 sin Node

**No hay `package.json` ni dependencia de Node.** Tailwind v4 corre desde el binario standalone versionado en `tools/tailwindcss.exe`.

`build.bat`:

```bat
tools\tailwindcss.exe -i src\tailwind.css -o "%TEMP%\sirius-app.css" --minify %*
copy /y "%TEMP%\sirius-app.css" "public\assets\css\app.css"
```

El rodeo por `%TEMP%` existe porque **el binario falla al escribir en rutas con espacios** (y la carpeta del proyecto está bajo `C:\Users\Alan RodGar\`). El `%*` reenvía banderas como `--watch`.

`src/tailwind.css` son cuatro cosas:

1. `@import "tailwindcss";`
2. **`@source "../public";`** — la directiva de detección de contenido de v4. Escanea todo el árbol de `public/` (PHP, JS y JSON) buscando nombres de clase. **Ese es todo el config: no existe `tailwind.config.js`.**
3. `@theme { --font-sans: "Inter", … }` — Inter autohospedada en `assets/fonts/`, no Google Fonts.
4. Variables CSS para los temas por usuario: `:root` define `--theme-sidebar-bg`, `--theme-accent`, `--theme-accent-soft`; ocho bloques `[data-theme="…"]` los sobrescriben.

**`public/assets/css/app.css` está versionado en git.** El servidor nunca compila nada.

> ⚠️ Consecuencia diaria: **hay que correr `build.bat` después de agregar cualquier clase de Tailwind nueva**, o la clase simplemente no existe en producción. Y por el escaneo literal, toda clase debe aparecer como cadena completa en el código (ver patrón 15 en [04](04-patrones-reusables.md)).

---

## El pipeline de despliegue

Tres piezas encadenadas.

### 1 · GitHub Actions — `.github/workflows/deploy.yml`

Se dispara con push a `main` o manualmente. Dos pasos:

**a) Versionar el service worker** — el mecanismo de invalidación de caché:

```bash
SHA=$(git rev-parse --short HEAD)
sed -i "s/sirius-shell-[^']*/sirius-shell-$SHA/" public/sw.js
printf '%s' "$SHA" > public/BUILD_VERSION
git commit -m "chore: versiona sw.js ($SHA) [skip ci]" && git push
```

El nombre del caché **es** la versión, y se deriva del SHA del commit. El resultado se commitea de vuelta a `main` con `[skip ci]` para no entrar en bucle.

**b) Disparar el pull en cPanel** con `pinkasey/cpanel-deploy-action`, usando secretos de repositorio (`CPANEL_HOSTNAME`, `CPANEL_REPOSITORY_ROOT`, `CPANEL_USERNAME`, `CPANEL_TOKEN`).

### 2 · cPanel — `.cpanel.yml`

Corre en el servidor después del pull:

```yaml
deployment:
  tasks:
    - /bin/rsync -a --exclude=".git" public/ /home4/alanrod2/sirius-bpm.com/
```

**El despliegue es literalmente un rsync de `public/` al docroot.** `config.php` y `uploads/*` están en `.gitignore`, así que sobreviven.

Por eso `docs/` (esta carpeta), `src/`, `tools/` y `data/` **nunca llegan al servidor**: viven fuera de `public/`.

### 3 · Migraciones: a mano, por URL

**El pipeline no corre migraciones.** Después de un despliegue que cambia el esquema, un humano tiene que visitar:

```
https://sirius-bpm.com/install/setup.php?key=<install_key>
```

`setup.php` compara la clave con `hash_equals` contra `app_config()['install_key']`, y si pasa, imprime en texto plano la bitácora de `sirius_install_schema()`. Todo es idempotente y no destructivo.

> ⚠️ **Este es el punto más débil de toda la plataforma.** La clave es el único control: no hay sesión, ni usuario, ni límite de intentos, ni lista de IPs. Y viaja en la query string, así que **queda escrita en los logs de acceso del servidor**. En un producto comercial esto tiene que ser un comando autenticado o parte del propio pipeline, nunca una URL con secreto.

---

## Primera instalación — `install/index.php`

Un asistente visual estilo WordPress. Se autobloquea creando `install/.installed`. Usa un nonce en sesión.

Recoge nombre del negocio, credenciales de MySQL y la cuenta de administrador; prueba la conexión con PDO; **escribe `includes/config.php`** escapando `\` y `'`; genera `install_key` y `cron_key` aleatorios; corre el esquema completo y siembra el admin; y muestra las dos claves generadas **una sola vez**.

Es un patrón sólido para instalaciones auto-hospedadas. Para un SaaS multi-inquilino no aplica: el alta de un cliente nuevo tiene que ser un proceso del sistema, no un formulario que llena el cliente.

---

## PWA y service worker

### `public/sw.js` — worker clásico (no módulo)

```js
const CACHE = 'sirius-shell-93d833b';   // el CI reescribe el SHA en cada despliegue
```

**`SHELL` es una lista de precaché explícita mantenida a mano** (~44 entradas: `offline.html`, el CSS, las fuentes, los iconos, cada archivo JS del núcleo, **cada módulo**, los catálogos JSON).

> ⚠️ Agregar un módulo significa **acordarse de agregarlo aquí**. Es un paso manual fácil de olvidar y sin ninguna red de seguridad. En el producto nuevo debería generarse.

**Estrategia de fetch en tres niveles:**

1. **Red directa, sin tocar caché** para todo lo cruzado de origen, todo lo que contenga `/api/`, `/install/`, `/uploads/`, y una lista hard-codeada de endpoints PHP. La razón está comentada en el archivo: **los datos clínicos nunca se cachean.**
2. **Navegaciones**: red primero, y si falla, `offline.html`.
3. **Todo lo demás**: caché primero con `{ignoreSearch: true}`, con la red como respaldo.

**Sin `skipWaiting()` en la instalación.** Un service worker nuevo se queda esperando hasta que la página le manda `{type:'SKIP_WAITING'}` — lo hace el botón "Buscar actualizaciones" en Configuración. **Al usuario nunca se le actualiza la app a media sesión.** Buena decisión, vale la pena conservarla.

**Push sin payload, a propósito**: el servidor manda una notificación vacía para no tener que implementar el cifrado del RFC 8291. Al recibirla, el worker consulta `api/index.php?r=push/pending` con `credentials:'same-origin'` (montándose en la cookie de sesión) y muestra una notificación por pendiente.

### Dos canales de actualización independientes

Además del ciclo del service worker, existe `public/version.php`: un endpoint público de cuatro líneas que devuelve `{"version": <BUILD_VERSION>}`. `modules/configuracion.js` lo consulta con `cache:'no-store'` y lo compara contra `<meta name="app-version">` del HTML.

Así la interfaz puede avisar "hay una versión nueva" **sin depender del ciclo de vida del service worker**, que es notoriamente difícil de razonar.

### `public/manifest.php` — manifest dinámico

Servido desde PHP como `application/manifest+json` para que los iconos sigan al branding subido, con respaldo a los iconos por defecto.

> ⚠️ El `name` y la `description` tienen "Bosques Polanco" hard-codeado, en vez de leer `settings.clinic_name` — que **sí existe** en la base y nunca se usa. Lo mismo pasa en `login.php` y en `index.php`. Conectar esos tres a la configuración sería el cambio de mayor palanca para des-clinificar la app tal como está.

---

## Seguridad a nivel de archivos

| Archivo | Qué hace |
|---|---|
| `public/includes/.htaccess` | `Require all denied` — `config.php` y las credenciales no se pueden pedir por HTTP |
| `public/uploads/*/.htaccess` | Lo mismo por carpeta de subidas; todo se sirve por scripts PHP con verificación |
| `public/.htaccess` | `Options -Indexes`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin`, tipos MIME para `.webmanifest` y `.woff2` |
| `public/.user.ini` | `upload_max_filesize 26M`, `post_max_size 30M`, `session.gc_maxlifetime 14400` (4 h) |
| `.gitignore` | excluye `tools/`, `data/`, `config.php`, `.installed`, y el contenido de `uploads/*` conservando sus `.htaccess` |

> ⚠️ Dos huecos: **el bloque que fuerza HTTPS está comentado** en `public/.htaccess`, y **no hay cabecera CSP** en ningún lado. Los dos son obligatorios en un producto comercial.

---

## Restricciones heredadas del hosting compartido

Esta sección importa más de lo que parece. Varias decisiones de Sirius **no son preferencias de diseño: son consecuencias** de que el servidor es cPanel compartido, sin shell, sin Composer y sin Node.

| Decisión | Por qué existe | ¿Se puede relajar? |
|---|---|---|
| Ruteo por `?r=recurso/acción` | No depender de `mod_rewrite` | **Sí** — con control del servidor, rutas limpias |
| FPDF y PHPMailer copiados a mano | No hay Composer | **Sí** — Composer normal |
| Un `require` por handler como autoloader | Sin Composer no hay PSR-4 | **Sí** |
| Tailwind compilado localmente, CSS versionado | No hay Node en el servidor | **Sí** — build en CI |
| Binarios versionados en `tools/` | No hay forma de instalar nada | **Sí** |
| Cliente HTTP con cURL opcional | cURL puede no estar compilado | **Sí**, si controlas el runtime |
| `.user.ini` en vez de `php.ini` | Sin acceso a la config global | **Sí** |
| Migraciones por visita a una URL | No hay shell para correr un comando | **Sí — y hay que hacerlo** |
| Despliegue por rsync de una carpeta | Es lo que ofrece cPanel | **Sí** — contenedores, releases atómicos |

**Pero la forma que produjeron sí vale la pena conservarla**: un núcleo de ~1,400 líneas, un registro declarativo de módulos, una sola tabla de rutas, una función con nombre por convención por recurso, y un `render()` por pantalla. Eso no es una limitación del hosting — es buen diseño que sobrevive al cambio de infraestructura.

La distinción a tener clara al construir el producto nuevo: **relaja las restricciones técnicas, conserva la forma.**

Sigue con [06 · El producto nuevo](06-producto-nuevo.md).
