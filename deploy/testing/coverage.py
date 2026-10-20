"""Normalize source coverage without averaging percentages across files."""
def summarize(files):
    result = {}
    for metric in ('lines', 'branches'):
        total = sum(f[metric]['total'] for f in files)
        covered = sum(f[metric]['covered'] for f in files)
        result[metric] = dict(total=total, covered=covered, pct=round(100 * covered / total, 2) if total else None)
    return result


def python_coverage(payload):
    files = []
    for path, value in payload.get('files', {}).items():
        s = value['summary']
        files.append(dict(path=path, lines=dict(total=s['num_statements'], covered=s['covered_lines']),
                          branches=dict(total=s.get('num_branches', 0), covered=s.get('covered_branches', 0)),
                          missing_lines=value.get('missing_lines', []),
                          tests=sorted({c.split('|')[0].split('::')[0] for cs in value.get('contexts', {}).values() for c in cs if c})))
    return dict(files=files, totals=summarize(files), attribution=True)


def istanbul_coverage(payload, root):
    from pathlib import Path
    files = []
    for path, value in payload.items():
        lines = {}
        for key, count in value['s'].items():
            line = value['statementMap'][key]['start']['line']
            lines[line] = max(count, lines.get(line, 0))
        counts = [c for values in value.get('b', {}).values() for c in values]
        files.append(dict(path=str(Path(path).relative_to(root)),
                          lines=dict(total=len(lines), covered=sum(c > 0 for c in lines.values())),
                          branches=dict(total=len(counts), covered=sum(c > 0 for c in counts)),
                          missing_lines=sorted(l for l, c in lines.items() if not c), tests=[]))
    return dict(files=files, totals=summarize(files), attribution=False)


def node_coverage(payload, root):
    from pathlib import Path
    files = []
    for value in payload.get('files', []):
        files.append(dict(path=str(Path(value['path']).relative_to(root)),
                          lines=dict(total=value['totalLineCount'], covered=value['coveredLineCount']),
                          branches=dict(total=value['totalBranchCount'], covered=value['coveredBranchCount']),
                          missing_lines=[v['line'] for v in value['lines'] if not v['count']], tests=[]))
    return dict(files=files, totals=summarize(files), attribution=False)
