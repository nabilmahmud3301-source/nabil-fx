#!/usr/bin/env python3
"""Download openly licensed, topic-relevant images from Openverse into local assets."""
import json,re,time,html,unicodedata,threading
from pathlib import Path
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor,as_completed
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
def toks(x): return {v for v in re.findall(r"[a-z0-9]+",unicodedata.normalize("NFKD",x.lower())) if len(v)>2}
used=set(); lock=threading.Lock()
def fetch_one(topic):
 tid,title,cat=topic; session=requests.Session()
 session.headers.update({"User-Agent":"NabilFX-LearningLibrary/1.0 (openly licensed image curation)"})
 query=f"{title} forex trading chart technical analysis"
 try:
  resp=session.get("https://api.openverse.org/v1/images/",params={"q":query,"license":"cc0,by,by-sa","license_type":"commercial","extension":"jpg,png,webp","size":"large","page_size":12,"filter_dead":"true"},timeout=12)
  resp.raise_for_status(); results=resp.json().get("results",[])
  terms=toks(title); ranked=[]
  for item in results:
   caption=html.unescape((item.get("title") or "")+" "+ " ".join(t.get("name","") for t in item.get("tags",[])))
   score=len(terms & toks(caption)); url=item.get("url","")
   if score<1 or not url.startswith("https://") or item.get("license") not in ("cc0","by","by-sa"): continue
   with lock:
    if url in used: continue
   ranked.append((score,item,url))
  ranked.sort(key=lambda x:(-x[0],-(x[1].get("width") or 0)))
  for score,item,url in ranked[:3]:
   try:
    res=session.get(url,timeout=12); res.raise_for_status()
    im=Image.open(BytesIO(res.content)); im.load()
    if im.width<650 or im.height<300: continue
    im.thumbnail((1800,1200))
    if im.mode!="RGB": im=im.convert("RGB")
    dest=OUT/(tid+".jpg"); im.save(dest,"JPEG",quality=88,optimize=True)
    with lock: used.add(url)
    return tid,{"status":"downloaded","title":title,"path":str(dest).replace("\\","/"),"image_title":item.get("title"),"creator":item.get("creator"),"source_page":item.get("foreign_landing_url"),"image_source":url,"license":item.get("license"),"license_version":item.get("license_version"),"license_url":item.get("license_url"),"attribution":item.get("attribution"),"width":item.get("width"),"height":item.get("height"),"relevance_score":score}
   except Exception: continue
  return tid,{"status":"no_verified_match","title":title,"query":query}
 except Exception as e:
  return tid,{"status":"download_error","title":title,"error":str(e)[:200]}
manifest={}
with ThreadPoolExecutor(max_workers=4) as pool:
 futures=[pool.submit(fetch_one,t) for t in topics]
 for n,f in enumerate(as_completed(futures),1):
  tid,result=f.result(); manifest[tid]=result
  print(f"[{n}/144] {result['status']}: {result['title']}",flush=True)
(ROOT/"assets"/"learn-trading-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Finished: {sum(v['status']=='downloaded' for v in manifest.values())}/144 openly licensed images downloaded.")
