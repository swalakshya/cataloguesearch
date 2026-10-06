"""Compile the pinned embedding translator against this image's ML Commons jars."""
import hashlib
from pathlib import Path
import subprocess

root = Path('/usr/share/opensearch')
source = Path(__file__).with_name('ONNXSentenceTransformerTextEmbeddingTranslator.java.upstream')
assert 'version=3.6.0.0' in (root / 'plugins/opensearch-ml/plugin-descriptor.properties').read_text()
original = source.read_text()
assert hashlib.sha256(source.read_bytes()).hexdigest() == 'cff07c26723d6144b3025a5b2502cb401f2c735052d714bcc513a9d7ae96baa1'
old = 'tokenizer = HuggingFaceTokenizer.builder().optPadding(true).optTokenizerPath(path.resolve("tokenizer.json")).build();'
new = '''HuggingFaceTokenizer.Builder builder = HuggingFaceTokenizer.builder()
            .optPadding(true).optTokenizerPath(path.resolve("tokenizer.json")).optMaxLength(1024);
        // DJL otherwise clamps tokenizer.json's limit to its default of 512.
        builder.configure(Map.of("modelMaxLength", 1024));
        tokenizer = builder.build();'''
assert original.count(old) == 1, 'Upstream tokenizer initialization changed'
work = Path('/tmp/embedding-patch')
work.mkdir()
java = work / 'ONNXSentenceTransformerTextEmbeddingTranslator.java'
java.write_text(original.replace(old, new))
classes = work / 'classes'
subprocess.run([str(root / 'jdk/bin/javac'), '--release', '21', '-proc:none',
                '-cp', f'{root}/lib/*:{root}/plugins/opensearch-ml/*',
                '-d', str(classes), str(java)], check=True)
jar = root / 'plugins/opensearch-ml/opensearch-ml-algorithms-3.6.0.0.jar'
subprocess.run([str(root / 'jdk/bin/jar'), '--update', '--file', str(jar),
                '-C', str(classes), 'org'], check=True)
