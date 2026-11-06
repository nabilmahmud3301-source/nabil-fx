#!/usr/bin/env python3
"""Download topic-specific educational trading images from Bing Images (Creative Commons filter)."""
import json,re,html,unicodedata,threading
from pathlib import Path
from urllib.parse import quote
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor,as_completed
import requests
from PIL import Image
ROOT=Path("."); OUT=ROOT/"assets"/"learn-trading"; OUT.mkdir(parents=True,exist_ok=True)
for f in OUT.glob("*.jpg"): f.unlink()
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
def norm(s):
 return re.sub(r"[^a-z0-9]+"," ",unicodedata.normalize("NFKD",s.lower())).strip()
lock=threading.Lock(); used=set()
def search(session,q):
 url="https://www.bing.com/images/search?q="+quote(q)+"&qft=%2Bfilterui%3Alicense-L2_L3&form=IRFLTR"
 r=session.get(url,timeout=20); r.raise_for_status(); page=html.unescape(r.text)
 found=[]
 # Bing's image cards store the full source in murl, with the page URL in purl.
 for m in re.finditer(r'"murl"\s*:\s*"((?:\\.|[^"\\])*)"',page):
  u=m.group(1).replace("\\/","/")
  try: u=json.loads('"'+u+'"')
  except Exception: pass
  if u.startswith("http") and not any(x in u.lower() for x in ["bing.com","microsoft.com","gstatic.com"]):
   found.append(u)
 # alternate escaped markup representation
 if not found:
  for m in re.finditer(r'murl(?:&quot;|\\?")\s*:\s*(?:&quot;|\\?")([^"&]+)',page):
   u=html.unescape(m.group(1)).replace("\\/","/")
   if u.startswith("http"): found.append(u)
 return list(dict.fromkeys(found))
def fetch(topic):
 tid,title,cat=topic
 s=requests.Session(); s.headers.update({"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"})
 queries=[f'"{title}" forex trading chart',f'"{title}" technical analysis trading example',f'{title} trading education annotated chart']
 candidates=[]
 try:
  for q in queries:
   candidates=search(s,q)
   if candidates: break
  for u in candidates[:12]:
   with lock:
    if u in used: continue
   try:
    r=s.get(u,timeout=18); r.raise_for_status()
    if len(r.content)<18000 or len(r.content)>10_000_000: continue
    im=Image.open(BytesIO(r.content)); im.load()
    if im.width<480 or im.height<230: continue
    im.thumbnail((1600,1000))
    if im.mode!="RGB": im=im.convert("RGB")
    dest=OUT/(tid+".jpg"); im.save(dest,"JPEG",quality=88,optimize=True)
    with lock: used.add(u)
    return tid,{"status":"downloaded","title":title,"path":str(dest),"source_url":u,"search_query":q,"width":im.width,"height":im.height}
   except Exception: continue
  return tid,{"status":"no_image","title":title,"queries":queries,"search_results":len(candidates)}
 except Exception as e: return tid,{"status":"error","title":title,"error":str(e)[:200]}
manifest={}
with ThreadPoolExecutor(max_workers=5) as pool:
 fs=[pool.submit(fetch,t) for t in topics]
 for i,f in enumerate(as_completed(fs),1):
  tid,x=f.result(); manifest[tid]=x
  print(f"[{i}/144] {x['status']}: {x['title']}",flush=True)
(ROOT/"assets"/"learn-trading-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("Downloaded",sum(x["status"]=="downloaded" for x in manifest.values()),"of 144")
