#!/usr/bin/env python3
"""Create short/long ONNX references for the bundled 1024/512-token policy."""
import argparse
import json
from pathlib import Path
import tempfile
import zipfile


def prepare_fixtures(directory):
    import numpy as np
    import onnxruntime as ort
    from tokenizers import Tokenizer

    embedding = directory.name == 'bge-m3'
    limit = 1024 if embedding else 512
    short = ['आत्मा चेतन है।', 'આત્મા ચેતન છે.', 'What is the nature of the soul?']
    units = [
        'सम्यग्दर्शन सम्यग्ज्ञान और सम्यक् चारित्र मोक्ष का मार्ग हैं। आत्मा और कर्म का संबंध समझाइए। ',
        'સમ્યગ્દર્શન સમ્યગ્જ્ઞાન અને સમ્યક્ ચારિત્ર મોક્ષનો માર્ગ છે. આત્મા અને કર્મનો સંબંધ સમજાવો. ',
    ]
    with tempfile.TemporaryDirectory(prefix='bge-fixtures-') as temp:
        work = Path(temp)
        with zipfile.ZipFile(directory / 'model.zip') as archive:
            archive.extractall(work)
        tokenizer = Tokenizer.from_file(str(work / 'tokenizer.json'))
        tokenizer.no_truncation()
        tokenizer.no_padding()
        texts = list(short)
        for unit in units:
            for target in ([480, 768, 1180] if embedding else [700]):
                text = unit
                while len(tokenizer.encode(text).ids) < target:
                    text += unit
                # Different information at the tail helps detect premature truncation.
                text += 'अहिंसा और अपरिग्रह की साधना का महत्व बताइए।'
                texts.append(text)
        query = short[0]
        raw_lengths = [len(tokenizer.encode(text).ids) if embedding else
                       len(tokenizer.encode(query, text).ids) for text in texts]
        tokenizer.enable_truncation(max_length=limit)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 2
        options.inter_op_num_threads = 1
        session = ort.InferenceSession(str(work / 'model.onnx'), sess_options=options,
                                       providers=['CPUExecutionProvider'])
        fixtures = []
        for text, raw_length in zip(texts, raw_lengths):
            encoded = tokenizer.encode(text) if embedding else tokenizer.encode(query, text)
            ids = np.array([encoded.ids], dtype=np.int64)
            feed = {'input_ids': ids, 'attention_mask': np.array([encoded.attention_mask], dtype=np.int64)}
            if not embedding:
                feed['token_type_ids'] = np.zeros_like(ids)
            actual = session.run(None, feed)[0]
            if embedding:
                actual = actual[:, 0, :]
                actual /= np.linalg.norm(actual, axis=-1, keepdims=True)
            fixtures.append({'text': text, 'text_pair': None if embedding else query,
                             'raw_tokens': raw_length, 'input_tokens': len(encoded.ids),
                             'context_limit': limit, 'expected': actual.reshape(-1).tolist()})
            print(f'{directory.name}: {raw_length} tokens -> {len(encoded.ids)} validated', flush=True)
        (directory / 'fixture.json').write_text(json.dumps(fixtures, ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--models-dir', type=Path, default=Path('models/opensearch'))
    args = parser.parse_args()
    for slug in ('bge-m3', 'bge-reranker-base'):
        prepare_fixtures(args.models_dir / slug)


if __name__ == '__main__':
    main()
