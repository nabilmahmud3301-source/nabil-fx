#!/usr/bin/env python3
"""Download openly licensed, topic-relevant images from Openverse into local assets."""
import json,re,time,html,unicodedata
from pathlib import Path
from io import BytesIO
import requests
from PIL import Image
ROOT=Path("."); OUT=ROOT/"assets"/"learn-trading"; OUT.mkdir(parents=True,exist_ok=True)
for old in OUT.glob("*.jpg"): old.unlink()
PAGE=(ROOT/"index.html").read_text(encoding="utf-8")
topics=[]; seen=set()
for m in re.finditer(r"\{id:'([^']+)',title:'([^']+)',cat:'([^']+)'",PAGE):
 tid,title,cat=m.groups()
 if tid not in seen: seen.add(tid); topics.append((tid,title,cat))
for array_name,next_name in [("extraTopics","advancedTopics"),("advancedTopics","specialistTopics"),("specialistTopics","const categories")]:
 a=PAGE.find("const "+array_name+"="); b=PAGE.find("const "+next_name+"=",a+1) if next_name!="const categories" else PAGE.find("const categories",a+1)
 if a>=0 and b>a:
  for m in re.finditer(r"\['([^']+)','([^']+)','([^']+)'",PAGE[a:b]):
   tid,title,cat=m.groups()
   if tid not in seen: seen.add(tid); topics.append((tid,title,cat))
if len(topics)<144: raise SystemExit(f"Expected 144 lessons, found {len(topics)}")
topics=topics[:144]
S=requests.Session(); S.headers.update({"User-Agent":"NabilFX-LearningLibrary/1.0 (openly licensed image curation)"})
def toks(x): return {v for v in re.findall(r"[a-z0-9]+",unicodedata.normalize("NFKD",x.lower())) if len(v)>2}
manifest={}; used=set()
for idx,(tid,title,cat) in enumerate(topics,1):
 try:
  query=f"{title} forex trading chart technical analysis"
  resp=S.get("https://api.openverse.org/v1/images/",params={"q":query,"license":"cc0,by,by-sa","license_type":"commercial","extension":"jpg,png,webp","size":"large","page_size":20,"filter_dead":"true"},timeout=30)
  resp.raise_for_status(); results=resp.json().get("results",[])
  terms=toks(title); ranked=[]
  for item in results:
   caption=html.unescape((item.get("title") or "")+" "+ " ".join(t.get("name","") for t in item.get("tags",[])))
   score=len(terms & toks(caption))
   url=item.get("url","")
   if score<1 or not url.startswith("https://") or url in used: continue
   if item.get("license") not in ("cc0","by","by-sa"): continue
   ranked.append((score,item,url,caption))
  ranked.sort(key=lambda x:(-x[0],-(x[1].get("width") or 0)))
  saved=False
  for score,item,url,caption in ranked[:8]:
   try:
    res=S.get(url,timeout=30); res.raise_for_status()
    im=Image.open(BytesIO(res.content)); im.load()
    if im.width<650 or im.height<300: continue
    im.thumbnail((1800,1200))
    if im.mode!="RGB": im=im.convert("RGB")
    dest=OUT/(tid+".jpg"); im.save(dest,"JPEG",quality=88,optimize=True)
    used.add(url)
    manifest[tid]={"status":"downloaded","title":title,"path":str(dest).replace("\\","/"),"image_title":item.get("title"),"creator":item.get("creator"),"source_page":item.get("foreign_landing_url"),"image_source":url,"license":item.get("license"),"license_version":item.get("license_version"),"license_url":item.get("license_url"),"attribution":item.get("attribution"),"width":item.get("width"),"height":item.get("height"),"relevance_score":score}
    saved=True; break
   except Exception: continue
  if not saved: manifest[tid]={"status":"no_verified_match","title":title,"query":query}
  print(f"[{idx}/144] {'OK' if saved else 'NO MATCH'}: {title}",flush=True)
 except Exception as e:
  manifest[tid]={"status":"download_error","title":title,"error":str(e)[:200]}
  print(f"[{idx}/144] ERROR: {title}: {e}",flush=True)
 time.sleep(.25)
(ROOT/"assets"/"learn-trading-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Finished: {sum(v['status']=='downloaded' for v in manifest.values())}/144 openly licensed images downloaded.")
