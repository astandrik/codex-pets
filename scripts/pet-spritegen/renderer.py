"""Pinned sprite-gen bridge. Paid calls are one-shot; stdout is metadata only."""
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
from uuid import uuid4
from pathlib import Path
from urllib.parse import urlsplit
from PIL import Image, ImageDraw
from http_diagnostics import PREFIX, read_http_diagnostic

MODEL = 'gpt-image-2.5-sunburst'
PROVIDER_ERROR_CODES = frozenset(json.loads((Path(__file__).resolve().parents[2] / 'src/lib/pets/generation/provider-error-codes.json').read_text()))
class RenderError(Exception):
    def __init__(self, code, provider_failure=None, failure_diagnostic=None, cli_cause=None, error_details=None):
        super().__init__(code)
        self.provider_failure = provider_failure
        self.failure_diagnostic = failure_diagnostic
        self.cli_cause = cli_cause
        self.error_details = error_details

def failure_diagnostic(boundary, reason, started=None, **measurements):
    result = {'boundary': boundary, 'reason': reason}
    if started is not None: result['elapsedMs'] = min(600000, max(0, round((time.monotonic()-started)*1000)))
    for key, value in measurements.items():
        if key == 'usageAvailable' and isinstance(value, bool): result[key] = value
        if key in ('width', 'height') and type(value) is int and 0 <= value <= 32768: result[key] = value
        if key == 'exitCode' and type(value) is int and -255 <= value <= 255: result[key] = value
    return result

def provider_failure(stderr):
    # sprite-gen 2.44.0 defines this prefix contract before any private response body.
    match = re.search(r"^openai-gen: (?:credential OPENAI_API_KEY rejected|image request failed|refused by the provider's content policy) \(HTTP ([45]\d{2})\)(?: code=([A-Za-z0-9_.:-]{1,64}))?(?: moderation_stage=(input|output|unknown))?(?=;|:|$)", stderr, re.MULTILINE)
    if not match: return None
    result = {'httpStatus': int(match.group(1))}
    if match.group(2): result['code'] = match.group(2) if match.group(2) in PROVIDER_ERROR_CODES else 'unrecognized'
    if match.group(3): result['moderationStage'] = match.group(3)
    return result

def proxy_environment(value):
    parsed = urlsplit(value)
    if parsed.scheme != 'http' or parsed.hostname not in ('172.17.0.1', 'host.docker.internal') or parsed.port not in (18089, 18090) or parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment:
        raise ValueError('proxy_not_configured')
    return {'HTTP_PROXY': value, 'HTTPS_PROXY': value, 'NO_PROXY': 'localhost,127.0.0.1'}

def safe_usage(report):
    usage = report.get('extra', {}).get('usage', {})
    details = usage.get('input_tokens_details', {})
    values = [details.get('text_tokens'), details.get('image_tokens'), usage.get('output_tokens')]
    if not all(isinstance(value, int) and value >= 0 for value in values): return None
    text, image, output = values
    return {'textInputTokens': text, 'imageInputTokens': image, 'outputTokens': output,
            'costUsd': (text*5 + image*8 + output*30) / 1_000_000}

def run_tool(root, args):
    # No shell, retry wrapper, facing-vision call, or alternate provider.
    started = time.monotonic()
    code = 'outcome_unknown' if args[0] == 'gen' else 'invalid_sprite_extraction'
    boundary = 'provider_cli' if args[0] == 'gen' else 'renderer_process'
    cause_path = root / ('cli-cause-' + uuid4().hex + '.json')
    cause = None
    details = None
    http = None
    try:
        result = subprocess.run([sys.executable, str(Path(__file__).with_name('cli_runner.py')), str(cause_path), *args], cwd=root,
                                capture_output=True, text=True, timeout=220)
    except subprocess.TimeoutExpired:
        raise RenderError(code, failure_diagnostic=failure_diagnostic(boundary,'process_timeout',started)) from None
    except OSError:
        raise RenderError(code, failure_diagnostic=failure_diagnostic(boundary,'process_spawn',started)) from None
    finally:
        try:
            if cause_path.is_file() and cause_path.stat().st_size <= 16384:
                payload = json.loads(cause_path.read_text())
                if isinstance(payload,dict):
                    cause = payload.get('cause')
                    details = payload.get('details')
                    http = read_http_diagnostic(payload.get('httpDiagnostic'))
        except (OSError, ValueError):
            pass
        if http is not None:
            try: print(PREFIX + json.dumps(http), file=sys.stderr)
            except OSError: pass
        for path in (cause_path, cause_path.with_name(cause_path.name + '.tmp')):
            try: path.unlink(missing_ok=True)
            except OSError: pass
    if result.returncode:
        failure = failure_diagnostic(boundary,'process_exit',started,exitCode=result.returncode)
        if args[0] == 'gen':
            diagnostic = provider_failure(result.stderr)
            status = diagnostic['httpStatus'] if diagnostic else 0
            if 400 <= status < 500 and status != 408:
                raise RenderError('provider_rate_limited' if status == 429 else 'provider_rejected', diagnostic, failure, cause, details)
            raise RenderError('outcome_unknown', diagnostic, failure, cause, details)
        raise RenderError('invalid_sprite_extraction', failure_diagnostic=failure, cli_cause=cause, error_details=details)
    return result.stdout

def row_prompt(job, row):
    name = row['name']; action = row['action']
    if name == 'running':
        action = 'FOCUSED TASK PROCESSING / THINKING while stationary. Stable lower body; small deliberate hand/paw motion, concentrated pupils, blink and modest head tilt. No walking, stepping, running or hopping.'
    if name.startswith('look-'):
        start = 0 if name == 'look-0-157' else 8
        names = ['up','up-right','up-right','up-right','right','down-right','down-right','down-right','down','down-left','down-left','down-left','left','up-left','up-left','up-left']
        action = 'Gaze-only still poses in exact left-to-right order: ' + ', '.join(f'{i*22.5:g} degrees {names[i]}' for i in range(start,start+8)) + '. Same front-facing body and both eyes visible. Move the dark pupils WITHIN pale eye whites; follow the relative pupil positions of image3. Body stays still; these are gaze directions, not camera angles. Do not draw the diagram or labels.'
    return ('Generate one horizontal strip. Image1 fixes character identity; image2 is a layout guide only.\n'
            f'Character brief (style only): {json.dumps(job["prompt"], ensure_ascii=False)}\nAction: {action}\n'
            f'Exactly {row["frames"]} complete full-body poses evenly spaced in one row across a1536x512PNG. '
            'Preserve anatomy, proportions, colors and materials. Keep every appendage inside its slot with generous gaps. '
            'Background pure flat magenta #FF00FF; no magenta on the character, shadows, floor, text, borders, detached effects or added props. '
            'Never render guide lines or change the requested pose count.')

def gaze_guide(path, start):
    image = Image.new('RGB', (1536,208), (246,246,246)); draw=ImageDraw.Draw(image)
    for column in range(8):
        theta = math.radians((start+column)*22.5); vx=math.sin(theta); vy=-math.cos(theta)
        cx=column*192+96; cy=85
        draw.ellipse((cx-62,cy-53,cx+62,cy+53), fill=(208,222,214), outline=(50,60,50), width=2)
        for ex in (cx-25,cx+25):
            draw.ellipse((ex-18,cy-17,ex+18,cy+17), fill='white', outline=(80,80,80))
            px=ex+vx*10; py=cy+vy*10
            draw.ellipse((px-8,py-8,px+8,py+8), fill=(211,149,41))
            draw.ellipse((px-3,py-5,px+3,py+5), fill=(12,20,20))
        ax=cx; ay=170; bx=ax+vx*25; by=ay+vy*25
        draw.line((ax,ay,bx,by), fill=(190,40,40), width=3)
        for sign in (-1,1): draw.line((bx,by,bx-vx*8+sign*(-vy)*5,by-vy*8+sign*vx*5), fill=(190,40,40), width=3)
    image.save(path)

def prepare(root, job):
    run=root/'run'
    if (run/'sprite-request.json').exists(): return
    request={'states': {row['name']: {'frames': row['frames'], 'fps': 6, 'loop': not row['name'].startswith('look-'), 'action': row['action']} for row in job['rows']},
             'style': job['prompt'], 'fit': {'pixel_unfake': False, 'align_x': 'bbox-center', 'align_y': 'center', 'ground_frames': False, 'segmentation': 'components'}}
    (root/'request.json').write_text(json.dumps(request))
    run_tool(root, ['prepare', '--out-dir',str(run),'--character-id','generated-pet','--base-image',str(root/'base.png'),
                    '--cell-width','192','--cell-height','208','--safe-margin','12','--chroma-key','#FF00FF','--request',str(root/'request.json')])
    for label, start in [('look-0-157',0),('look-180-337',8)]: gaze_guide(root/(label+'-guide.png'),start)

def generate(root, job, name):
    refs=[]
    if name=='base':
        prompt=('Create exactly one original desktop pet reference. Entire compact character with all appendages inside generous empty margins, calm three-quarter-front view, clearly visible movable pupils inside eye whites. '
                'Pure flat magenta #FF00FF background, no magenta on the character, no floor/shadow/text/labels/scenery. Character/style brief only: '+json.dumps(job['prompt'], ensure_ascii=False))
    else:
        if not (root/'run/sprite-request.json').is_file(): raise RenderError('invalid_sprite_extraction')
        from sprite_gen.spec.layout import guide_rel
        request=json.loads((root/'run/sprite-request.json').read_text())
        row=next((row for row in job['rows'] if row['name']==name),None)
        if not row: raise RenderError('invalid_stage')
        prompt=row_prompt(job,row)
        refs=[root/'base.png',root/'run'/guide_rel(request,name)]
        if name.startswith('look-'): refs.append(root/(name+'-guide.png'))
    if any(not ref.is_file() for ref in refs): raise RenderError('invalid_sprite_extraction')
    prompt_file=root/(name+'.prompt.txt'); prompt_file.write_text(prompt)
    out=root/(name+'.png'); report=root/(name+'.provider-report.json')
    args=['gen','--provider','openai','--model',MODEL,'--quality','high','--aspect-ratio','1:1' if name=='base' else '3:1',
          '--facing','preserve','--facing-fix','none','--workdir',str(root/(name+'-work')),'--prompt-file',str(prompt_file),'--out',str(out),'--report',str(report)]
    for ref in refs: args.extend(['--ref',str(ref)])
    started=time.monotonic(); run_tool(root,args)
    try: details=json.loads(report.read_text())
    except FileNotFoundError:
        raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_report','missing_file',started)) from None
    except (json.JSONDecodeError, UnicodeError):
        raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_report','invalid_json',started)) from None
    except OSError:
        raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_report','io_error',started)) from None
    if not isinstance(details, dict):
        raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_report','invalid_schema',started))
    if details.get('provider')!='openai' or details.get('model')!=MODEL:
        raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_report','invalid_identity',started))
    try: usage=safe_usage(details)
    except (AttributeError, TypeError):
        raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_report','invalid_schema',started)) from None
    try:
        with Image.open(out) as image:
            image.load()
            if image.size != ((1024,1024) if name=='base' else (1536,512)):
                raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_image','unexpected_dimensions',started,width=image.width,height=image.height,usageAvailable=usage is not None))
    except FileNotFoundError:
        raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_image','missing_file',started,usageAvailable=usage is not None)) from None
    except OSError:
        raise RenderError('outcome_unknown', failure_diagnostic=failure_diagnostic('provider_image','invalid_image',started,usageAvailable=usage is not None)) from None
    return {'generationMs': round((time.monotonic()-started)*1000), 'usage': usage}

def compose(root,job):
    prepare(root,job)
    from sprite_gen.spec.layout import raw_rel
    run=root/'run'; request=json.loads((run/'sprite-request.json').read_text())
    for row in job['rows']:
        target=run/raw_rel(request,row['name']); target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(root/(row['name']+'.png'),target)
    (run/'extract-failure.json').unlink(missing_ok=True)
    try:
        run_tool(root,['extract','--run-dir',str(run)])
    except RenderError as error:
        diagnostic = error.failure_diagnostic or {}
        if (str(error) != 'invalid_sprite_extraction' or diagnostic.get('boundary') != 'renderer_process'
                or diagnostic.get('reason') != 'process_exit' or diagnostic.get('exitCode') != 1):
            raise
        from extraction_fallback import recover_failed_strips
        if not recover_failed_strips(run, job['rows']):
            raise
        # Re-run only local extraction, once. Provider stages and saved originals
        # are untouched; the ordinary manifest and package checks still apply.
        run_tool(root,['extract','--run-dir',str(run)])
    manifest=json.loads((run/'frames/frames-manifest.json').read_text())
    if not manifest.get('ok') or manifest.get('errors') or manifest.get('warnings'): raise RenderError('invalid_sprite_extraction')
    if len(manifest['rows'])!=11 or sum(row['frames'] for row in manifest['rows'])!=73: raise RenderError('missing_animation_frame')
    run_tool(root,['compose-atlas','--run-dir',str(run)])
    return {'ok':True}

def main():
    os.umask(0o077)
    root=Path(sys.argv[1]).resolve(); action=sys.argv[2]
    try:
        job=json.loads((root/'job.json').read_text())
        if action=='generate':
            os.environ.update(proxy_environment(os.environ.get('PET_GENERATION_PROXY_URL','')))
            result=generate(root,job,sys.argv[3])
        elif action=='prepare': prepare(root,job); result={'ok':True}
        elif action=='compose': result=compose(root,job)
        else: raise RenderError('invalid_stage')
        print(json.dumps(result))
    except BaseException as error:
        code=str(error) if isinstance(error,RenderError) else 'outcome_unknown' if action=='generate' else 'invalid_sprite_extraction'
        diagnostic = error.provider_failure if isinstance(error, RenderError) else None
        failure = error.failure_diagnostic if isinstance(error, RenderError) else None
        failure = failure or failure_diagnostic('renderer_process','unclassified')
        cause = error.cli_cause if isinstance(error, RenderError) else None
        details = error.error_details if isinstance(error, RenderError) else None
        print(json.dumps({'error':code, 'failureDiagnostic':failure, **({'cliCause':cause} if cause else {}), **({'errorDetails':details} if details else {}), **({'providerFailure': diagnostic} if diagnostic else {})})); sys.exit(1)

if __name__=='__main__': main()
