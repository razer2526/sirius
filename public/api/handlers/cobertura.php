<?php
/**
 * Handler de Cobertura: dos recursos en un solo archivo, con permisos distintos
 * (mismo criterio que commissions.php/vinculacion.php, que también comparten
 * dominio pero se exponen por separado):
 *
 *   handle_cobertura() — Admin Tools > Cobertura: administra las ~140 zonas
 *   (estado+municipio) y su bandera de cobertura. Requiere el módulo 'cobertura'.
 *
 *   handle_coverage() — Apps > Cobertura: solo busca un código postal y regresa
 *   su(s) colonia(s) + la cobertura de su zona. Requiere el módulo 'apps' con
 *   la bandera 'cobertura', igual que Comisiones con 'apps'/'comisiones'.
 *
 * Cobertura es de 3 estados, no un booleano: cobertura completa (verde),
 * "costo extra"/área extendida (amarillo, cuando no hay cobertura completa
 * pero sí se puede atender) y sin cobertura (rojo). Se guarda como dos campos
 * — has_coverage + extra_cost — en vez de un enum, porque así es exactamente
 * como se ve en pantalla: un switch (cobertura completa) y, solo cuando ese
 * switch está apagado, un checkbox aparte ("Área extendida").
 *
 * En postal_codes esto es una EXCEPCIÓN sobre lo que su municipio ya dice:
 * coverage_override/extra_cost viajan siempre juntos (los dos NULL = hereda
 * del municipio, los dos explícitos = excepción propia de ese código postal).
 * Si un cambio hace que la excepción vuelva a coincidir con lo que el
 * municipio ya daría, se borra la excepción en vez de dejarla guardada
 * (si no, la etiqueta "Excepción" se quedaría pegada para siempre).
 */

require_once __DIR__ . '/../../install/schema.php';

/** Cobertura + costo extra efectivos de un código postal ahora mismo (excepción propia, o heredado de su zona). */
function cobertura_effective_postal_state(int $id): ?array
{
    $st = db()->prepare(
        'SELECT pc.coverage_override, pc.extra_cost AS pc_extra_cost,
                z.has_coverage, z.extra_cost AS z_extra_cost
         FROM postal_codes pc LEFT JOIN coverage_zones z ON z.id = pc.zone_id
         WHERE pc.id = ?'
    );
    $st->execute([$id]);
    $row = $st->fetch();
    if (!$row) {
        return null;
    }
    $hasCoverage = $row['coverage_override'] !== null ? (bool)$row['coverage_override'] : (bool)$row['has_coverage'];
    $extraCost = $row['coverage_override'] !== null ? (bool)$row['pc_extra_cost'] : (bool)$row['z_extra_cost'];
    return ['has_coverage' => $hasCoverage, 'extra_cost' => $extraCost, 'zone_has_coverage' => (bool)$row['has_coverage'], 'zone_extra_cost' => (bool)$row['z_extra_cost']];
}

/** Aplica un nuevo estado a un CP: si coincide con lo que su zona ya daría, borra la excepción; si no, la guarda. */
function cobertura_apply_postal_state(int $id, bool $coverage, bool $extraCost, array $current): array
{
    $matchesZone = $coverage === $current['zone_has_coverage'] && $extraCost === $current['zone_extra_cost'];
    if ($matchesZone) {
        db()->prepare('UPDATE postal_codes SET coverage_override = NULL, extra_cost = NULL WHERE id = ?')->execute([$id]);
        return ['coverage_override' => null, 'has_coverage' => $coverage, 'extra_cost' => $extraCost];
    }
    db()->prepare('UPDATE postal_codes SET coverage_override = ?, extra_cost = ? WHERE id = ?')
        ->execute([$coverage ? 1 : 0, $extraCost ? 1 : 0, $id]);
    return ['coverage_override' => $coverage, 'has_coverage' => $coverage, 'extra_cost' => $extraCost];
}

function handle_cobertura(string $action): void
{
    $me = current_user();
    if (!is_admin_role($me)) {
        json_error('No tienes acceso a Cobertura', 403);
    }

    switch ($action) {
        case 'zones_list': {
            $rows = db()->query(
                'SELECT z.id, z.estado, z.municipio, z.has_coverage, z.extra_cost, z.latitude, z.longitude,
                        (SELECT COUNT(*) FROM postal_codes pc WHERE pc.zone_id = z.id) AS postal_count
                 FROM coverage_zones z ORDER BY z.estado, z.municipio'
            )->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['has_coverage'] = (bool)$r['has_coverage'];
                $r['extra_cost'] = (bool)$r['extra_cost'];
                $r['latitude'] = $r['latitude'] !== null ? (float)$r['latitude'] : null;
                $r['longitude'] = $r['longitude'] !== null ? (float)$r['longitude'] : null;
                $r['postal_count'] = (int)$r['postal_count'];
            }
            unset($r);
            json_ok(['zones' => $rows]);
        }

        /** Prende/apaga la cobertura completa de un municipio. Al prenderla se apaga "costo extra" (no aplican juntas). */
        case 'zones_toggle': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $st = db()->prepare('SELECT id, has_coverage, extra_cost FROM coverage_zones WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_error('Zona no encontrada', 404);
            }
            $newValue = $row['has_coverage'] ? 0 : 1;
            // Cobertura completa apaga "costo extra" (no aplican juntas); al
            // apagarla, lo que ya tuviera de costo extra se queda igual.
            $newExtraCost = $newValue ? 0 : (int)$row['extra_cost'];
            db()->prepare('UPDATE coverage_zones SET has_coverage = ?, extra_cost = ? WHERE id = ?')
                ->execute([$newValue, $newExtraCost, $id]);
            log_activity('cobertura', 'zone_toggle', ($newValue ? 'Activó' : 'Desactivó') . " cobertura en zona #$id", 'coverage_zone', $id);
            json_ok(['has_coverage' => (bool)$newValue, 'extra_cost' => (bool)$newExtraCost]);
        }

        /** Pone/quita "costo extra" (área extendida) en un municipio — solo tiene sentido sin cobertura completa. */
        case 'zones_set_extra_cost': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $extraCost = !empty($b['extra_cost']);
            $st = db()->prepare('SELECT has_coverage FROM coverage_zones WHERE id = ?');
            $st->execute([$id]);
            $row = $st->fetch();
            if (!$row) {
                json_error('Zona no encontrada', 404);
            }
            if ($row['has_coverage']) {
                json_error('Esta zona ya tiene cobertura completa', 422);
            }
            db()->prepare('UPDATE coverage_zones SET extra_cost = ? WHERE id = ?')->execute([$extraCost ? 1 : 0, $id]);
            log_activity('cobertura', 'zone_extra_cost', ($extraCost ? 'Marcó' : 'Quitó') . " área extendida en zona #$id", 'coverage_zone', $id);
            json_ok(['extra_cost' => $extraCost]);
        }

        /** Códigos postales de un municipio/alcaldía, con su cobertura efectiva (override propio o heredada de la zona). */
        case 'postal_list': {
            $zoneId = (int)($_GET['zone_id'] ?? 0);
            $st = db()->prepare('SELECT id, cp, colonias, coverage_override, extra_cost FROM postal_codes WHERE zone_id = ? ORDER BY cp');
            $st->execute([$zoneId]);
            $rows = $st->fetchAll();
            foreach ($rows as &$r) {
                $r['id'] = (int)$r['id'];
                $r['colonias'] = json_decode((string)$r['colonias'], true) ?: [];
                $r['coverage_override'] = $r['coverage_override'] !== null ? (bool)$r['coverage_override'] : null;
                $r['extra_cost'] = $r['extra_cost'] !== null ? (bool)$r['extra_cost'] : null;
            }
            unset($r);
            json_ok(['postal_codes' => $rows]);
        }

        /**
         * Prende/apaga la cobertura completa de UN código postal — para
         * municipios/alcaldías tan grandes que no se cubren completos. Si el
         * resultado coincide con lo que el municipio ya daría, la excepción se
         * borra sola (ver cobertura_apply_postal_state).
         */
        case 'postal_toggle': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $current = cobertura_effective_postal_state($id);
            if (!$current) {
                json_error('Código postal no encontrado', 404);
            }
            $newCoverage = !$current['has_coverage'];
            $newExtra = $newCoverage ? false : $current['extra_cost'];
            $result = cobertura_apply_postal_state($id, $newCoverage, $newExtra, $current);
            log_activity('cobertura', 'postal_toggle', ($newCoverage ? 'Activó' : 'Desactivó') . " cobertura en CP #$id", 'postal_code', $id);
            json_ok($result);
        }

        /** Pone/quita "costo extra" (área extendida) en un código postal — solo aplica sin cobertura completa. */
        case 'postal_set_extra_cost': {
            $b = request_body();
            $id = (int)($b['id'] ?? 0);
            $extraCost = !empty($b['extra_cost']);
            $current = cobertura_effective_postal_state($id);
            if (!$current) {
                json_error('Código postal no encontrado', 404);
            }
            if ($current['has_coverage']) {
                json_error('Este código postal ya tiene cobertura completa', 422);
            }
            $result = cobertura_apply_postal_state($id, false, $extraCost, $current);
            log_activity('cobertura', 'postal_extra_cost', ($extraCost ? 'Marcó' : 'Quitó') . " área extendida en CP #$id", 'postal_code', $id);
            json_ok($result);
        }

        /** Vuelve a correr el import del catálogo semilla — no toca has_coverage/extra_cost ya configurados. */
        case 'reimport': {
            $pdo = db();
            $log = sirius_seed_cobertura($pdo);
            log_activity('cobertura', 'reimport', 'Reimportó el catálogo de códigos postales');
            json_ok(['log' => $log]);
        }
    }
}

function handle_coverage(string $action): void
{
    $me = current_user();
    if (!(is_admin_role($me) || user_flag('apps', 'cobertura'))) {
        json_error('No tienes acceso a Cobertura', 403);
    }

    switch ($action) {
        /** Busca un código postal y regresa sus colonias + la cobertura efectiva de su zona. */
        case 'lookup': {
            $cp = preg_replace('/\D/', '', (string)($_GET['cp'] ?? ''));
            if (strlen($cp) !== 5) {
                json_error('Escribe un código postal de 5 dígitos', 422);
            }
            $st = db()->prepare(
                'SELECT pc.cp, pc.estado, pc.municipio, pc.colonias, pc.coverage_override, pc.extra_cost AS pc_extra_cost,
                        z.has_coverage, z.extra_cost AS z_extra_cost, z.latitude, z.longitude
                 FROM postal_codes pc
                 LEFT JOIN coverage_zones z ON z.id = pc.zone_id
                 WHERE pc.cp = ?'
            );
            $st->execute([$cp]);
            $row = $st->fetch();
            if (!$row) {
                json_error('No encontramos ese código postal en el catálogo de CDMX / Área Metropolitana', 404);
            }
            // El código postal manda si tiene una excepción propia; si no, hereda
            // la cobertura de su municipio/alcaldía.
            $hasCoverage = $row['coverage_override'] !== null ? (bool)$row['coverage_override'] : (bool)$row['has_coverage'];
            $extraCost = $row['coverage_override'] !== null ? (bool)$row['pc_extra_cost'] : (bool)$row['z_extra_cost'];
            json_ok([
                'cp'           => $row['cp'],
                'estado'       => $row['estado'],
                'municipio'    => $row['municipio'],
                'colonias'     => json_decode((string)$row['colonias'], true) ?: [],
                'has_coverage' => $hasCoverage,
                'extra_cost'   => $hasCoverage ? false : $extraCost,
                'latitude'     => $row['latitude'] !== null ? (float)$row['latitude'] : null,
                'longitude'    => $row['longitude'] !== null ? (float)$row['longitude'] : null,
            ]);
        }
    }
}
