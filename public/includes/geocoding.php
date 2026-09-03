<?php
/**
 * Geocodificación de municipios/alcaldías vía Nominatim (OpenStreetMap), gratis
 * y sin llave. Se usa SOLO para ubicar las ~140 zonas de Cobertura una vez cada
 * una (el resultado se cachea en coverage_zones.latitude/longitude) — nunca para
 * geocodificar códigos postales en volumen, que violaría la política de uso
 * de Nominatim (prohíbe geocodificación masiva; recomienda su propio dump de
 * datos para eso). Un identificador de contacto en el User-Agent también es
 * requisito de esa política.
 */

/**
 * Busca un municipio/alcaldía por nombre + estado; null si no se encontró o
 * falló la llamada.
 *
 * Usa el parámetro de texto libre `q` en vez de los estructurados
 * (city/state/country): verificado contra la API real que la mayoría de los
 * municipios del Estado de México solo existen en OSM como límite
 * administrativo (addresstype "county"), no como "city", así que el parámetro
 * estructurado `city=` no los encuentra aunque el municipio sí esté mapeado.
 * También se quitan los acentos de la consulta — con acentos, Nominatim no
 * encontraba varios municipios (probado caso por caso) aunque el resultado sí
 * los trajera acentuados de vuelta.
 */
function geocode_place(string $municipio, string $estado): ?array
{
    $fold = static function (string $s): string {
        $map = [
            'á' => 'a', 'é' => 'e', 'í' => 'i', 'ó' => 'o', 'ú' => 'u', 'ü' => 'u', 'ñ' => 'n',
            'Á' => 'A', 'É' => 'E', 'Í' => 'I', 'Ó' => 'O', 'Ú' => 'U', 'Ü' => 'U', 'Ñ' => 'N',
        ];
        return strtr($s, $map);
    };
    $q = $fold($municipio) . ', ' . $fold($estado) . ', Mexico';
    $params = http_build_query(['q' => $q, 'format' => 'jsonv2', 'limit' => 1]);
    $url = 'https://nominatim.openstreetmap.org/search?' . $params;

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => ['User-Agent: Sirius-BosquesPolanco/1.0 (contacto@bosquespolanco.com)'],
    ]);
    $ca = (string)(app_config()['ca_bundle'] ?? '');
    if ($ca !== '' && is_file($ca)) {
        curl_setopt($ch, CURLOPT_CAINFO, $ca);
    }
    $raw = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false || $code !== 200) {
        return null;
    }
    $data = json_decode($raw, true);
    if (!is_array($data) || !isset($data[0]['lat'], $data[0]['lon'])) {
        return null;
    }
    return ['lat' => (float)$data[0]['lat'], 'lng' => (float)$data[0]['lon']];
}
