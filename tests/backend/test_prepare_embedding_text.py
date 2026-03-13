import pytest

from backend.config import Config
from backend.crawler.llm_index_generator import LLMIndexGenerator
from tests.backend.base import initialise  # noqa: F401 — required for Config to load test settings


@pytest.fixture(scope="module")
def gen(initialise):  # noqa: F811
    return LLMIndexGenerator(Config(), None)


@pytest.mark.parametrize("input_text, expected", [
    # No brackets — unchanged
    ("शुद्ध आत्मा हो", "शुद्ध आत्मा हो"),

    # Single bracket stripped, spacing normalized
    ("शुद्ध [śuddha] आत्मा", "शुद्ध आत्मा"),

    # Multiple brackets stripped
    ("गाथा [gāthā] एक [prathama] है", "गाथा एक है"),

    # Bracket at start
    ("[atha] प्रारंभ होता है", "प्रारंभ होता है"),

    # Bracket at end
    ("समाप्त होता है [iti]", "समाप्त होता है"),

    # Only bracket content — returns empty string
    ("[केवल संस्कृत]", ""),

    # Round and curly brackets are untouched
    ("(गोल) और {घुंघरू}", "(गोल) और {घुंघरू}"),

    # Newline outside brackets → collapsed to single space
    ("पहली पंक्ति\nदूसरी पंक्ति", "पहली पंक्ति दूसरी पंक्ति"),

    # Bracket spanning a newline (re.DOTALL)
    ("पहले [प्राकृत\nपाठ] बाद", "पहले बाद"),

    # Adjacent brackets collapse to a single space
    ("[foo][bar] अंत", "अंत"),

    # Extra internal whitespace normalized
    ("शब्द   [टीका]   अर्थ", "शब्द अर्थ"),

    # Realistic: Hindi gatharth with Prakrit gloss
    (
        "आत्मा शुद्ध है [अप्पा सुद्धो] इसलिए मोक्ष संभव है [मोक्खो संभवो]",
        "आत्मा शुद्ध है इसलिए मोक्ष संभव है"
    ),
])
def test_prepare_embedding_text(gen, input_text, expected):
    assert gen._prepare_embedding_text(input_text) == expected


def test_prepare_embedding_text_gatharth(gen):
    """Full gatharth paragraph with Sanskrit/Prakrit glosses on every term."""
    input_text = (
        "गाथार्थ:—[अज्ञानमोहितमतिः] जिसकी मति अज्ञानसे मोहित है और\n"
        "[बहुभावसंयुक्तः] जो मोह, राग, द्वेष आदि अनेक भावोंसे युक्त है ऐसा [जीव:] जीव\n"
        "[भणति] कहता है कि [इदं] यह [बद्धम् तथा च अबद्धं] शरीरादिक बद्ध तथा धनधान्यादिक अबद्ध "
        "[पुद्गलं द्रव्यम्] पुद्गलद्रव्य [मम] मेरा है। आचार्य कहते हैं कि— "
        "[सर्वज्ञज्ञानदृष्टः] सर्वज्ञके ज्ञान द्वारा देखा गया जो [नित्यम्] सदा "
        "[उपयोगलक्षणः] उपयोगलक्षणवाला [जीवः] जीव है [सः] वह [पुद्गलद्रव्यीभूतः] पुद्गलद्रव्यरूप "
        "[कथं] कैसे हो सकता है [यत्] जिससे कि [भणसि] तू कहता है कि [इदं मम] यह पुद्गलद्रव्य मेरा है? "
        "[यदि] यदि [सः] जीवद्रव्य [पुद्गलद्रव्यीभूतः] पुद्गलद्रव्यरूप हो जाय और "
        "[इतरत्] पुद्गलद्रव्य [जीवत्वम्] जीवत्वको [आगतम्] प्राप्त करे "
        "[तत्] तो [वक्तुं शकः] तू कह सकता है [यत्] कि [इदं पुद्गलं द्रव्यम्] यह पुद्गलद्रव्य "
        "[मम] मेरा है। (किन्तु ऐसा तो नहीं होता।)"
    )
    expected = (
        "गाथार्थ:— जिसकी मति अज्ञानसे मोहित है और "
        "जो मोह, राग, द्वेष आदि अनेक भावोंसे युक्त है ऐसा जीव "
        "कहता है कि यह शरीरादिक बद्ध तथा धनधान्यादिक अबद्ध पुद्गलद्रव्य मेरा है। "
        "आचार्य कहते हैं कि— सर्वज्ञके ज्ञान द्वारा देखा गया जो सदा "
        "उपयोगलक्षणवाला जीव है वह पुद्गलद्रव्यरूप "
        "कैसे हो सकता है जिससे कि तू कहता है कि यह पुद्गलद्रव्य मेरा है? "
        "यदि जीवद्रव्य पुद्गलद्रव्यरूप हो जाय और "
        "पुद्गलद्रव्य जीवत्वको प्राप्त करे "
        "तो तू कह सकता है कि यह पुद्गलद्रव्य "
        "मेरा है। (किन्तु ऐसा तो नहीं होता।)"
    )
    assert gen._prepare_embedding_text(input_text) == expected