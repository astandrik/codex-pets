"""Replace selected atlas rows without reprocessing any accepted pixels."""
from PIL import Image


def selected_rows(job):
    rows = job['rows']
    continuation = job.get('continuation')
    if continuation:
        names = continuation['compositionStages']
        allowed = {'idle','running','running-left','running-right','waving','jumping','waiting','failed','review','look-0-157','look-180-337'}
        if len(names) != len(set(names)) or not set(names) <= allowed:
            raise ValueError('invalid composition plan')
        selected = [row for row in rows if row['name'] in names]
        if len(selected) != len(names):
            raise ValueError('missing planned row')
        return selected
    revision = job.get('animationRevision')
    if not revision:
        return rows
    names = revision['selectedStates']
    allowed = {'idle', 'running', 'running-left', 'running-right', 'waving', 'jumping', 'waiting', 'failed', 'review'}
    if not names or len(set(names)) != len(names) or not set(names) <= allowed:
        raise ValueError('invalid selected animations')
    result = [row for row in rows if row['name'] in names]
    if len(result) != len(names):
        raise ValueError('missing selected animations')
    return result


def compose_revision(root, rows, manifest, max_row=8):
    with Image.open(root/'revision-source.webp') as image:
        image.load()
        if image.size != (1536, 2288):
            raise ValueError('invalid source atlas dimensions')
        atlas = image.convert('RGBA')
    records = manifest['rows']
    if len(records) != len(rows) or {row['state'] for row in records} != {row['name'] for row in rows}:
        raise ValueError('unexpected extracted states')
    run = (root/'run').resolve()
    for row in rows:
        record = next(item for item in records if item['state'] == row['name'])
        if record['frames'] != row['frames'] or len(record['files']) != row['frames']:
            raise ValueError('wrong frame count')
        y = row['row'] * 208
        if type(row['row']) is not int or not 0 <= row['row'] <= max_row:
            raise ValueError('invalid animation row')
        atlas.paste((0, 0, 0, 0), (0, y, 1536, y + 208))
        for column, relative in enumerate(record['files']):
            path = (run/relative).resolve()
            if not path.is_relative_to(run/'frames'):
                raise ValueError('invalid extracted frame path')
            with Image.open(path) as image:
                image.load()
                if image.size != (192, 208):
                    raise ValueError('invalid frame dimensions')
                frame = image.convert('RGBA')
                if frame.getbbox() is None:
                    raise ValueError('empty frame')
                # No alpha mask: transparent new pixels must erase the old silhouette.
                atlas.paste(frame, (column * 192, y))
    atlas.save(run/'sprite-sheet-alpha.png')
