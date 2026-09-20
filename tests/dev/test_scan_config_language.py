import pytest

from backend.common.scan_config import effective_language


@pytest.mark.parametrize("scan_config,merged,expected", [
    ({"language": "gu"}, {"language": "hi"}, "gu"),          # scan_config wins over config.json
    ({}, {"language": "gu"}, "gu"),                          # falls back to config.json
    ({"language": ""}, {"language": "gu+hi"}, "gu+hi"),      # an empty value doesn't count as set
    ({}, {}, "hi"),                                          # default
    (None, None, "hi"),
])
def test_effective_language_precedence(scan_config, merged, expected):
    assert effective_language(scan_config, merged) == expected
