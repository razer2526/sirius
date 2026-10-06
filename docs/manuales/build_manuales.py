# -*- coding: utf-8 -*-
"""
Genera los PDF de los manuales a partir de los Markdown de esta carpeta.

Requisitos (solo para regenerar los PDF; el proyecto en sí no depende de Python):
    pip install markdown
    Microsoft Edge o Google Chrome instalado (se usa su impresión a PDF, sin cabeceras).

Uso (desde esta carpeta):
    python build_manuales.py            # los tres manuales
    python build_manuales.py 02         # solo el que empiece con 02

Salida: <nombre>.pdf junto a cada .md. Las imágenes viven en img/.
"""
import html
import os
import re
import subprocess
import sys
import tempfile

import markdown

HERE = os.path.dirname(os.path.abspath(__file__))

MANUALES = [
    ('01-manual-usuario-estandar', 'Manual de usuario estándar',
     'Cómo trabajar en Sirius todos los días: admisión, expedientes, tareas, inventario, agenda y mensajes.'),
    ('02-manual-usuario-administrador', 'Manual de usuario administrador',
     'Usuarios y permisos, empleados, conexiones externas, membretes, catálogos, respaldos y rutina de administración.'),
    ('03-manual-desarrollador', 'Manual del desarrollador',
     'Arquitectura, entorno, base de datos, frontend, PWA, despliegue, recetas para extender el sistema y trampas conocidas.'),
]

BROWSERS = [
    r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
    r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
]


def slugify(value, sep):
    """Mismo criterio que GitHub (conserva acentos), para que los enlaces del índice funcionen."""
    value = re.sub(r'[^\w\- ]', '', value.lower()).strip()
    return value.replace(' ', sep)


def find_browser():
    for p in BROWSERS:
        if os.path.exists(p):
            return p
    sys.exit('No se encontró Edge ni Chrome.')


def render_body(md_text):
    lines = md_text.split('\n')
    title = lines[0].lstrip('# ').strip()
    # Quita el título y las dos líneas de clínica/versión: van en la portada.
    rest = '\n'.join(lines[1:]).lstrip('\n')
    m = re.match(r'\*\*(.+?)\*\*\s*\n(Versión[^\n]*)\n', rest)
    clinic, version = (m.group(1), m.group(2)) if m else ('', '')
    if m:
        rest = rest[m.end():]
    # La leyenda en cursiva pegada a una imagen pasa a su propio párrafo (en GitHub se ve igual).
    rest = re.sub(r'(!\[[^\n]*\]\([^)\n]*\))\n(\*)', r'\1\n\n\2', rest)
    body = markdown.markdown(
        rest,
        extensions=['tables', 'toc', 'attr_list', 'fenced_code', 'sane_lists'],
        extension_configs={'toc': {'slugify': slugify}},
    )
    return title, clinic, version, body


def build_html(stem, title, tagline):
    with open(os.path.join(HERE, stem + '.md'), encoding='utf-8') as f:
        _, clinic, version, body = render_body(f.read())
    with open(os.path.join(HERE, 'manuales.css'), encoding='utf-8') as f:
        css = f.read()
    # Rutas de imagen absolutas para que Edge las encuentre desde el HTML temporal.
    img_base = 'file:///' + os.path.join(HERE, 'img').replace('\\', '/') + '/'
    body = body.replace('src="img/', 'src="' + img_base)
    cover = f'''
<section class="cover">
  <div class="cover-brand">Sirius</div>
  <h1>{html.escape(title)}</h1>
  <p class="cover-tag">{html.escape(tagline)}</p>
  <div class="cover-foot">
    <strong>{html.escape(clinic)}</strong><br>{html.escape(version)}
  </div>
</section>'''
    return f'''<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>Sirius · {html.escape(title)}</title><style>{css}</style></head>
<body>{cover}<main>{body}</main></body></html>'''


def main():
    only = sys.argv[1] if len(sys.argv) > 1 else None
    browser = find_browser()
    for stem, title, tagline in MANUALES:
        if only and not stem.startswith(only):
            continue
        page = build_html(stem, title, tagline)
        tmp = os.path.join(tempfile.gettempdir(), stem + '.html')
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(page)
        pdf = os.path.join(HERE, stem + '.pdf')
        subprocess.run([
            browser, '--headless=new', '--disable-gpu', '--no-pdf-header-footer',
            '--allow-file-access-from-files', '--virtual-time-budget=20000',
            '--print-to-pdf=' + pdf, 'file:///' + tmp.replace('\\', '/'),
        ], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f'{stem}.pdf  {os.path.getsize(pdf) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
