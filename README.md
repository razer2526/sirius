# Proyecto Sirius — Fase 1

Sistema de gestión modular para el **Laboratorio y Clínica Bosques Polanco**.

Incluye: login con roles y permisos por módulo, Dashboard, **Admisión** con las
fichas oficiales de cada servicio (Laboratorio, Control de peso, Fisioterapia,
Podología) con firma digital y cálculos automáticos, **Expedientes** (detalle,
consultas subsecuentes por ficha de sesión, exportar PDF), **Tareas** (proyectos,
subtareas, asignación, prioridades y tareas frecuentes diarias/semanales),
**Membretador** (estudios membretados en PDF: FilmArray GI), **Membretes**
(encabezado, pie, marca de agua y firma del responsable sanitario),
**Usuarios** (Admin Tools) con matriz de permisos, bitácora de actividad,
asistente IA (stub, Gemini en fase futura) y PWA instalable en Android.

## Stack

- **Backend**: PHP 8 + PDO (MySQL en producción, SQLite en desarrollo). Sin Composer, sin dependencias.
- **Frontend**: SPA en JavaScript vanilla (módulos ES) + Tailwind CSS v4 (binario standalone, build local).
- **Deploy**: copiar `public/` a `public_html` por FTP/cPanel. Sin build en el servidor.

## Estructura

```
public/            ← espejo 1:1 de public_html
  index.php        Shell de la SPA (sidebar + escritorio + burbuja IA)
  login.php        Inicio de sesión
  print.php        Expediente imprimible (exportar PDF desde el navegador)
  api/index.php    Front controller de la API JSON (?r=recurso/accion)
  api/handlers/    Un handler por recurso
  includes/        Config, DB, auth, permisos, CSRF, bitácora, registro de módulos,
                   membretes, plantillas de documentos, generación de PDF, lector de PDF
  install/index.php   Asistente visual de instalación (escribe config.php, crea tablas, siembra el Admin)
  install/schema.php  Definición de tablas + migraciones (compartida por el asistente y setup.php)
  install/setup.php   Aplica el esquema por clave (?key=) — se usa en cada actualización
  documento.php    Entrega el PDF de un estudio (verifica sesión y permisos)
  cotizacion.php   Entrega el PDF de una cotización (se genera al vuelo, no se archiva)
  uploads/         Imágenes de membrete y PDFs archivados (requiere permiso de escritura)
  vendor/fpdf/     Librería FPDF para generar los PDF (sin Composer)
  assets/js/modules/ Un archivo por módulo de la SPA
src/tailwind.css   Fuente del build de CSS
build.bat          Compila Tailwind → public/assets/css/app.css
package.bat        Empaqueta public/ en sirius-deploy.zip para subir a producción
zip_deploy.ps1      Helper de package.bat (arma el zip con rutas '/', no backslash)
tools/             PHP portable + Tailwind CLI (solo desarrollo, NO subir al servidor)
data/              Base SQLite de desarrollo (NO subir al servidor)
```

## Desarrollo local (Windows)

No necesitas instalar nada: `tools/` ya trae PHP portable y Tailwind.

```bat
rem 1. Compilar CSS (agrega --watch mientras desarrollas)
build.bat

rem 2. Levantar el servidor de desarrollo
tools\php\php.exe -S localhost:8080 -t public

rem 3. Instalar la base de datos (una sola vez)
rem    Abrir: http://localhost:8080/install/setup.php?key=sirius-dev
```

Entrar en `http://localhost:8080` con **Admin / 08135038**.

En desarrollo se usa SQLite (`data/sirius.sqlite`) — configurado en
`public/includes/config.php` con `driver => 'sqlite'`.

## Deploy a HostGator (producción)

Sirius trae un asistente visual de instalación (como el "5-minute install" de
WordPress): tú solo subes el zip y llenas un formulario; él escribe
`config.php`, crea las tablas y siembra el administrador con las credenciales
que elijas. No hace falta editar ningún archivo a mano.

### Primera instalación

1. **Empacar**: correr `package.bat` en Windows (usa PowerShell + .NET, sin
   dependencias extra). Genera `sirius-deploy.zip` en la raíz del proyecto —
   ya excluye `tools/`, `data/`, `includes/config.php` y el contenido de
   `uploads/` (el sitio nuevo empieza limpio).
2. **Base de datos**: en cPanel → Bases de datos MySQL, crear la BD, un
   usuario y asignarlo con "todos los privilegios". Anota host/nombre/usuario
   (cPanel los muestra ahí mismo).
3. **Subir**: cPanel → Administrador de archivos → subir `sirius-deploy.zip`
   dentro de `public_html` (o la subcarpeta/subdominio que uses) → clic
   derecho → Extraer.
4. **Instalar**: visitar `https://tudominio.com/install/` y llenar el
   formulario (datos de la BD del paso 2 + usuario y contraseña del
   administrador que tú quieras). Al terminar, guarda la clave de instalación
   que se muestra una sola vez.
5. Activar SSL (incluido en HostGator) y descomentar el bloque HTTPS en
   `public/.htaccess`.
6. Iniciar sesión y crear los usuarios del equipo.

El asistente se autobloquea después de instalar (`install/.installed`) para
que no se pueda volver a correr por accidente.

### Actualizaciones posteriores

1. Correr `package.bat` de nuevo con los cambios y subir el zip, extrayéndolo
   **sobre** la instalación existente (no vuelve a tocar `config.php`, que no
   viaja en el zip).
2. Si el cambio agrega tablas o columnas nuevas, visitar
   `https://tudominio.com/install/setup.php?key=TU_CLAVE_DE_INSTALACION`
   (la clave quedó guardada en `includes/config.php` del servidor). Es
   idempotente: nunca borra datos, solo aplica lo que falte.
3. Si el cambio toca JS/CSS/Service Worker: subir la versión del caché en
   `sw.js` (`sirius-shell-v18` → `v19`, …) para que el PWA no sirva versiones
   viejas desde caché.

## Apps (Membretador y Cotizador)

El módulo **Apps** del sidebar agrupa las herramientas y navega por niveles:

```
Apps → Membretador → Análisis clínicos      → catálogo de estudios y rangos propio
                   → Biología Molecular     → FilmArray GI · FilmArray Resp · C. Difficile
                   → Documentos             → (pendiente)
     → Cotizador                            → catálogo propio en Admin Tools → Catálogo de Estudios
```

El **Cotizador** separa las dos responsabilidades: cualquier empleado con el
flag `cotizador` arma cotizaciones en Apps → Cotizador (buscador de estudios,
cantidad, % de descuento, PDF con el mismo membrete); solo Admin Tools →
Catálogo de Estudios administra el catálogo en sí (crear/editar/eliminar,
exportar/importar en JSON o CSV con mapeo de columnas). Las cotizaciones
guardan una copia (nombre/precio/cantidad) de cada partida, así que borrar un
estudio del catálogo nunca corrompe una cotización ya emitida.

Las categorías y los estudios se definen en `public/assets/js/doc_templates.json`
(`categories` para los grids, `templates` con los paneles y analitos de cada
estudio). Ese archivo es la única fuente de verdad: alimenta los switches de la
interfaz y la validación en el servidor, así que **agregar un panel nuevo de
biología molecular no requiere tocar código**, solo añadir su entrada. Los
estudios con `"coming_soon": true` aparecen en el grid como "Próximamente" y no
pueden emitir documentos.

Los PDF se generan con FPDF aplicando el membrete configurado en Admin Tools >
Membretes (encabezado, pie, marca de agua con opacidad y firma del responsable
sanitario). Como FPDF no admite transparencia, las imágenes PNG con canal alfa
se aplanan sobre blanco automáticamente y se cachean en `uploads/membretes/cache/`.

Al capturar un estudio se pueden traer los datos del paciente de dos formas:
seleccionándolo de Admisión/Laboratorio, o subiendo el PDF de su ficha de
identificación (se extrae el texto y se reconocen los campos). Todos los campos
quedan editables por si el reconocimiento falla.

## Agregar un módulo (Fase 2+)

1. Registrar el módulo en `public/includes/modules.php` (key, label, icon, flags).
2. Crear `public/assets/js/modules/<key>.js` exportando `render(root, ctx)`.
3. Si necesita API: crear `public/api/handlers/<recurso>.php` y registrar la ruta en `public/api/index.php`.
4. Agregar el JS a la lista de precache en `sw.js`.

El sidebar, el router, los permisos y la matriz de Usuarios lo recogen automáticamente.

## Seguridad

- Sesiones PHP con cookies HttpOnly/SameSite, `session_regenerate_id` al iniciar sesión.
- CSRF por token (`X-CSRF-Token`) en toda escritura.
- PDO prepared statements en el 100% de las consultas.
- Permisos verificados en servidor por módulo y por rol (doble chequeo en acciones de admin).
- `includes/` bloqueado por `.htaccess`; el service worker jamás cachea `/api/` ni datos clínicos.
- Borrado de pacientes = borrado lógico (`is_deleted`), la información clínica no se destruye.
