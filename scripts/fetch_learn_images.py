#!/usr/bin/env python3
"""Fetch licensed, topic-relevant educational images from Wikimedia Commons."""
import json,re,time,html,unicodedata
from pathlib import Path
import requests
from PIL import Image
from io import BytesIO
ROOT=Path("."); OUT=ROOT/"assets"/"learn-trading"; OUT.mkdir(parents=True,exist_ok=True)
PAGE=(ROOT/"index.html").read_text(encoding="utf-8")
topics=[]; seen=set()
for m in re.finditer(r"\{id:'([^']+)',title:'([^']+)',cat:'([^']+)'",PAGE):
 tid,title,cat=m.groups()
 if tid not in seen: seen.add(tid); topics.append((tid,title,cat))
if len(topics)!=144: raise SystemExit(f"Safety stop: expected 144 unique topics, found {len(topics)}")
S=requests.Session(); S.headers.update({"User-Agent":"NabilFX-LearningLibrary/1.0 (educational image attribution)"})
STOP={"the","and","for","with","from","into","how","what","trading","trade","market","price","action","technical","analysis","strategy","basics","advanced","professional","concept","guide"}
def tokens(s): return {x for x in re.findall(r"[a-z0-9]+",unicodedata.normalize("NFKD",s.lower())) if len(x)>2 and x not in STOP}
manifest={}; used=set()
for idx,(tid,title,cat) in enumerate(topics,1):
 try:
  data=S.get("https://commons.wikimedia.org/w/api.php",params={"action":"query","format":"json","generator":"search","gsrsearch":f'intitle: "{title}"',"gsrnamespace":6,"gsrlimit":25,"prop":"imageinfo","iiprop":"url|size|extmetadata","iiurlwidth":1400},timeout=30).json()
  ranked=[]
  for p in (data.get("query") or {}).get("pages",{}).values():
   info=(p.get("imageinfo") or [{}])[0]; url=info.get("thumburl") or info.get("url","")
   if not url or info.get("width",0)<700 or url in used: continue
   meta=info.get("extmetadata",{}); lic=html.unescape(meta.get("LicenseShortName",{}).get("value",""))
   if not any(x in lic.lower() for x in ("cc0","cc by","public domain","cc-by","cc-by-sa")): continue
   score=len(tokens(title)&tokens(p.get("title","")))
   if score>=1: ranked.append((score,info,p,lic))
  ranked.sort(key=lambda x:(-x[0],-x[1].get("width",0)))
  if not ranked:
   manifest[tid]={"status":"no_verified_match","title":title}; print(f"[{idx}/144] NO VERIFIED MATCH: {title}",flush=True); continue
  score,info,p,lic=ranked[0]; url=info.get("thumburl") or info.get("url")
  res=S.get(url,timeout=45); res.raise_for_status()
  im=Image.open(BytesIO(res.content)); im.thumbnail((1800,1200)); dest=OUT/(tid+".jpg")
  if im.mode not in ("RGB","L"): im=im.convert("RGB")
  elif im.mode=="L": im=im.convert("RGB")
  im.save(dest,"JPEG",quality=88,optimize=True)
  used.add(url); meta=info.get("extmetadata",{})
  manifest[tid]={"status":"downloaded","title":title,"path":str(dest).replace("\\","/"),"source":info.get("descriptionurl",""),"license":lic,"artist":html.unescape(meta.get("Artist",{}).get("value","")),"credit":html.unescape(meta.get("Credit",{}).get("value","")),"width":info.get("width"),"height":info.get("height"),"match_score":score}
  print(f"[{idx}/144] OK: {title}",flush=True)
 except Exception as e:
  manifest[tid]={"status":"download_error","title":title,"error":str(e)[:200]}; print(f"[{idx}/144] ERROR: {title}: {e}",flush=True)
 time.sleep(.15)
(ROOT/"assets"/"learn-trading-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Finished: {sum(v['status']=='downloaded' for v in manifest.values())}/144 licensed images downloaded.")
