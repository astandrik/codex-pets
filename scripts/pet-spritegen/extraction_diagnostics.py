"""Parse only bounded state/frame/count facts; never expose raw CLI output."""
import json
import re

STATES = {"idle", "running", "running-left", "running-right", "waving", "jumping", "waiting", "failed", "review", "look-0-157", "look-180-337"}
MAX_REPORT_BYTES = 131072

def read_extraction_report(path):
    try:
        with path.open('rb') as source:
            content = source.read(MAX_REPORT_BYTES + 1)
        if len(content) > MAX_REPORT_BYTES:
            return None
        report = json.loads(content)
    except (OSError, ValueError):
        return None
    return report if isinstance(report, dict) else None


def extraction_issues(run):
    return issues_from_report(read_extraction_report(run / 'extract-failure.json'))


def issues_from_report(report):
    if not isinstance(report, dict):
        return []
    try:
        if len(json.dumps(report, ensure_ascii=False).encode('utf-8')) > MAX_REPORT_BYTES:
            return []
    except (TypeError, ValueError, UnicodeError):
        return []
    errors = report.get('errors', [])
    warnings = report.get('warnings', [])
    result = []
    for line in ((errors if isinstance(errors, list) else []) + (warnings if isinstance(warnings, list) else []))[:200]:
        if not isinstance(line, str) or len(line) > 1000 or ': ' not in line:
            continue
        state, detail = line.split(': ', 1)
        if state not in STATES:
            continue
        frame = re.match(r'frame (\d{1,2}) ', detail)
        if frame and int(frame[1]) > 7:
            continue
        issue = {'state': state, **({'frame': int(frame[1])} if frame else {})}
        sparse = re.match(r'frame \d+ is empty or too sparse \((\d+) pixels < (\d+),', detail)
        count = re.fullmatch(r'could not extract (\d+) sprite components', detail)
        chroma = re.fullmatch(r'frame \d+ has (\d+) chroma-adjacent pixels', detail)
        edge = re.fullmatch(r'frame \d+ has (\d+) non-transparent edge pixels', detail)
        size = re.fullmatch(r'frame \d+ is much (smaller|larger) than median \((\d+) vs (\d+)\)', detail)
        if sparse:
            issue.update(kind='sparse', actual=int(sparse[1]), expected=int(sparse[2]))
        elif count:
            issue.update(kind='components', expected=int(count[1]))
        elif chroma or edge:
            issue.update(kind='chroma' if chroma else 'edge', actual=int((chroma or edge)[1]))
        elif size:
            actual, median = int(size[2]), int(size[3])
            if median <= 0 or (size[1] == 'smaller' and actual >= median) or (size[1] == 'larger' and actual <= median):
                continue
            issue.update(kind='invalid', actual=actual, expected=median)
        else:
            continue
        if any(v > 25_000_000 for v in issue.values() if type(v) is int):
            continue
        if issue not in result:
            result.append(issue)
        if len(result) == 100:
            break
    return result
