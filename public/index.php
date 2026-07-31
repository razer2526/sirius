<?php
require_once __DIR__ . '/includes/auth.php';

session_boot();
if (!current_user()) {
    header('Location: login.php');
    exit;
}
?>
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#4f46e5">
<title>Sirius</title>
<link rel="icon" href="assets/img/icons/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="assets/img/icons/icon-192.png">
<link rel="manifest" href="manifest.webmanifest">
<link rel="stylesheet" href="assets/fonts/fonts.css">
<link rel="stylesheet" href="assets/css/app.css">
</head>
<body class="h-screen overflow-hidden bg-slate-100 font-sans text-slate-800 antialiased">

<div id="app" class="flex h-full">
  <!-- Overlay para sidebar off-canvas (tablet/móvil) -->
  <div id="sidebar-overlay" class="fixed inset-0 z-30 hidden bg-slate-900/50 lg:hidden"></div>

  <!-- Sidebar -->
  <aside id="sidebar"
         class="fixed inset-y-0 left-0 z-40 flex w-64 -translate-x-full flex-col bg-slate-900 text-slate-300 transition-transform duration-200 lg:static lg:translate-x-0">
    <div class="flex h-16 shrink-0 items-center gap-3 px-5">
      <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600">
        <svg viewBox="0 0 24 24" class="h-5 w-5 text-white" fill="currentColor"><path d="M12 1l2.4 6.9L21 9l-5.2 4.4L17.5 21 12 17.2 6.5 21l1.7-7.6L3 9l6.6-1.1z"/></svg>
      </div>
      <span class="sidebar-label text-lg font-bold tracking-tight text-white">Sirius</span>
    </div>
    <nav id="sidebar-nav" class="flex-1 overflow-y-auto px-3 py-4"></nav>
    <div class="shrink-0 border-t border-slate-800 p-3">
      <a href="logout.php" class="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-slate-800 hover:text-white">
        <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
        <span class="sidebar-label">Cerrar sesión</span>
      </a>
    </div>
  </aside>

  <!-- Área principal -->
  <div class="flex min-w-0 flex-1 flex-col">
    <header class="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 sm:px-6">
      <button id="btn-sidebar" type="button" aria-label="Menú"
              class="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">
        <svg viewBox="0 0 24 24" class="h-6 w-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <h2 id="topbar-title" class="min-w-0 truncate text-lg font-semibold text-slate-900">Dashboard</h2>
      <div class="ml-auto flex items-center gap-3">
        <div class="hidden text-right sm:block">
          <p id="topbar-user" class="text-sm font-semibold text-slate-900"></p>
          <p id="topbar-role" class="text-xs text-slate-500"></p>
        </div>
        <div id="topbar-avatar" class="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700"></div>
      </div>
    </header>

    <!-- pb-24: deja aire al final para que la burbuja del asistente no tape los botones -->
    <main id="module-root" class="min-w-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-6 sm:pb-24"></main>
  </div>
</div>

<!-- Burbuja del asistente IA (persistente entre módulos) -->
<div id="assistant-root"></div>

<!-- Contenedor de toasts y modales -->
<div id="toast-root" class="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4"></div>
<div id="modal-root"></div>

<script type="module" src="assets/js/app.js"></script>
</body>
</html>
