"""Acwyre's territory map: layers are read by name, sector codes are tidied
the UK way, and a postcode finds its sector. A tiny made-up map stands in
for the real file (placeholder figures only)."""
import io
import sys
import zipfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from core.territory import parse_territory_file, postcode_to_sector, sector_code, summary  # noqa: E402

SQUARE = '{"type": "Polygon", "coordinates": [[[-1.10, 53.50], [-1.00, 53.50], [-1.00, 53.55], [-1.10, 53.55], [-1.10, 53.50]]]}'


def _sector(code, weeks):
    return ('{"type": "Feature", "geometry": ' + SQUARE + ', "properties": {"sector": "' + code + '", "name": "' + code +
            '", "households": 3000, "last_worked": "20-Apr-25", "sales": 4, "weeks_since_last_worked": "' + str(weeks) +
            '", "office": "Example"}}')


HTML = (
    'var feature_group_a = L.featureGroup({});\n'
    'var feature_group_b = L.featureGroup({});\n'
    'var feature_group_c = L.featureGroup({});\n'
    'var feature_group_d = L.featureGroup({});\n'
    'var feature_group_hover = L.featureGroup({});\n'
    'geo_json_1_add({"type": "FeatureCollection", "features": [' + _sector("DN69", 76) + ', ' + _sector("BB120", 5) + ']});\n'
    'geo_json_1.addTo(feature_group_a);\n'
    'geo_json_2_add({"type": "FeatureCollection", "features": [' + _sector("NE126", 3) + ']});\n'
    'geo_json_2.addTo(feature_group_b);\n'
    'geo_json_3_add({"type": "FeatureCollection", "features": [{"type": "Feature", "id": 7, "geometry": ' + SQUARE + ', "properties": {}}]});\n'
    'geo_json_3.addTo(feature_group_c);\n'
    'geo_json_9_add({"type": "FeatureCollection", "features": [' + _sector("DN69", 76) + ']});\n'
    'geo_json_9.addTo(feature_group_hover);\n'
    'var cm1 = L.circleMarker(\n [53.52, -1.05],\n {"fillColor": "#228B22", "radius": 4}\n ).addTo(feature_group_d);\n'
    'var layer_control = {"base_layers": {}, "overlays": {"Active Territory": feature_group_a, '
    '"Priority Territory": feature_group_b, "Example New Builds": feature_group_c, "Sales": feature_group_d}};\n'
)


def test_codes_and_postcodes_are_tidied():
    assert [sector_code(c) for c in ("DN69", "BB120", "S445", "dn6 9")] == ["DN6 9", "BB12 0", "S44 5", "DN6 9"]
    assert [postcode_to_sector(p) for p in ("dn6 9ab", "DN69AB", "S44 5")] == ["DN6 9", "DN6 9", "S44 5"]


def test_a_zipped_map_is_read_by_layer_name():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("Example_Territory.html", HTML)
    p = parse_territory_file("Example_Territory.zip", buf.getvalue())
    by = {s["code"]: s for s in p["sectors"]}
    assert set(by) == {"DN6 9", "BB12 0", "NE12 6"}                # the unnamed hover copy is skipped
    assert by["DN6 9"]["kind"] == "active" and by["NE12 6"]["kind"] == "priority"
    assert (by["DN6 9"]["last_worked"], by["DN6 9"]["weeks_since"], by["DN6 9"]["households"]) == ("2025-04-20", 76, 3000)
    assert by["DN6 9"]["bbox"] == {"s": 53.5, "w": -1.1, "n": 53.55, "e": -1.0}
    assert summary(p) == {"sectors": 3, "by_kind": {"active": 2, "priority": 1}, "zones": 1, "dots": {"sale": 1},
                          "offices": [], "layers": {"Active Territory": 2, "Priority Territory": 1, "Example New Builds": 1, "Sales": 1}}
    assert p["zones"][0]["kind"] == "new_build"
