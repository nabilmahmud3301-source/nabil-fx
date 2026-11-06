#!/usr/bin/env python3
"""Download one Creative-Commons-filtered, topic-matched image per Learn Trading lesson."""
import json,re,time,html,unicodedata
from pathlib import Path
from urllib.parse import urlparse
from io import BytesIO
import requests
from bs4 import BeautifulSoup
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
S=requests.Session(); S.headers.update({"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36"})
def toks(x): return {v for v in re.findall(r"[a-z0-9]+",unicodedata.normalize("NFKD",x.lower())) if len(v)>2}
manifest={}; used=set()
for idx,(tid,title,cat) in enumerate(topics,1):
 try:
  q=f'"{title}" forex trading chart technical analysis example'
  page=S.get("https://www.bing.com/images/search",params={"q":q,"qft":"+filterui:license-L2_L3_L4_L5_L6","form":"IRFLTR","first":"1"},timeout=30)
  page.raise_for_status(); soup=BeautifulSoup(page.text,"html.parser")
  terms=toks(title); ranked=[]
  for node in soup.select("a.iusc"):
   try: meta=json.loads(node.get("m","{}"))
   except Exception: continue
   image_url=meta.get("murl",""); page_url=meta.get("purl","")
   caption=html.unescape((meta.get("t","")+" "+meta.get("desc","")))
   if not image_url.startswith("https://") or image_url in used: continue
   score=len(terms & toks(caption))
   # Reject unrelated stock photos: at least one distinctive topic word must appear in result metadata.
   if score<1: continue
   ranked.append((score,meta,image_url,page_url,caption))
  ranked.sort(key=lambda x:-x[0])
  saved=False
  for score,meta,url,page_url,caption in ranked[:8]:
   try:
    res=S.get(url,timeout=25,headers={"Referer":"https://www.bing.com/"}); res.raise_for_status()
    im=Image.open(BytesIO(res.content)); im.load()
    if im.width<650 or im.height<350: continue
    im.thumbnail((1800,1200))
    if im.mode!="RGB": im=im.convert("RGB")
    dest=OUT/(tid+".jpg"); im.save(dest,"JPEG",quality=88,optimize=True)
    used.add(url); manifest[tid]={"status":"downloaded","title":title,"path":str(dest).replace("\\","/"),"image_title":html.unescape(meta.get("t","")),"image_description":html.unescape(meta.get("desc","")),"source_page":page_url,"image_source":url,"license_filter":"Bing Images Creative Commons filter (L2-L6)","width":im.width,"height":im.height,"relevance_score":score}
    saved=True; break
   except Exception: continue
  if not saved: manifest[tid]={"status":"no_verified_match","title":title,"query":q}
  print(f"[{idx}/144] {'OK' if saved else 'NO MATCH'}: {title}",flush=True)
 except Exception as e:
  manifest[tid]={"status":"download_error","title":title,"error":str(e)[:200]}
  print(f"[{idx}/144] ERROR: {title}: {e}",flush=True)
 time.sleep(.35)
(ROOT/"assets"/"learn-trading-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print(f"Finished: {sum(v['status']=='downloaded' for v in manifest.values())}/144 images downloaded.")
