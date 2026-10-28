"""Private worker: existing Bili credential stays here; no token in returned data."""
import asyncio, json, os, pathlib, re, sys
from urllib.parse import urlparse
HOME=pathlib.Path.home()/'.dsh'/'bili-duty'
os.environ.setdefault('HF_HOME',str(HOME/'.hf-cache'))
os.environ.setdefault('HF_HUB_DISABLE_XET','1')
sys.stdout.reconfigure(encoding='utf-8')
async def metadata(bvid):
    if not re.fullmatch(r'BV[0-9A-Za-z]{10}',bvid):raise ValueError('Invalid BV')
    from bilibili_api import video, Credential
    c=json.loads((HOME/'bili_credential.json').read_text(encoding='utf-8'))
    v=video.Video(bvid=bvid,credential=Credential(**{k:c[k] for k in ['sessdata','bili_jct','buvid3','dedeuserid'] if c.get(k)}))
    info=await v.get_info()
    snapshot,play=await asyncio.gather(v.get_video_snapshot(json_index=True,pvideo=False),v.get_download_url(page_index=0),return_exceptions=True)
    out={'duration':info.get('duration',0),'pages':len(info.get('pages',[])),'snapshot':{},'errors':{}}
    if isinstance(snapshot,Exception):out['errors']['snapshot']='B站预览帧暂不可用'
    else:out['snapshot']={k:snapshot.get(k) for k in ['image','index','img_x_len','img_y_len','img_x_size','img_y_size']}
    if isinstance(play,Exception):out['errors']['stream']='B站播放源暂不可用'
    else:
        dash=play.get('dash') or {}
        for key in ['audio','video']:
            streams=sorted(dash.get(key) or [],key=lambda s: (abs((s.get('height') or 480)-720),s.get('bandwidth',0)) if key=='video' else (0,s.get('bandwidth',0)))
            for stream in streams:
                candidates=[stream.get('baseUrl') or stream.get('base_url')]+(stream.get('backupUrl') or stream.get('backup_url') or [])
                for candidate in candidates:
                    if not candidate:continue
                    u=urlparse(candidate)
                    if u.scheme in ['http','https'] and u.port in [None,80,443] and re.search(r'\.(bilivideo\.com|bilivideo\.cn|hdslb\.com)$',u.hostname or ''):
                        out[key+'Url']=candidate;break
                if out.get(key+'Url'):break
        if not out.get('videoUrl') and play.get('durl'):out['videoUrl']=play['durl'][0].get('url')
    return out
def asr(audio):
    from faster_whisper import WhisperModel
    model=WhisperModel('small',device='cpu',compute_type='int8',cpu_threads=2,num_workers=1,local_files_only=True)
    segments,info=model.transcribe(audio,language=None,vad_filter=True,beam_size=1)
    result=[{'from':round(s.start,2),'to':round(s.end,2),'text':s.text.strip()} for s in segments]
    return {'source':'local-whisper-asr','language':info.language,'segments':result,'text':' '.join(s['text'] for s in result)}
try:
    result=asr(sys.argv[2]) if sys.argv[1]=='asr' else asyncio.run(asyncio.wait_for(metadata(sys.argv[2]),30))
    print(json.dumps(result,ensure_ascii=False))
except Exception as e:
    # Upstream exception strings may embed signed URLs. Return only the type.
    print(json.dumps({'error':type(e).__name__}));sys.exit(1)
