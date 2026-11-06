#!/usr/bin/env python3
"""Curate topic-matched chart illustrations; reject generic/unrelated image hits."""
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
STOP=set("the and for with from into your how what why forex trading technical analysis chart example price guide strategy basics".split())
def words(s): return {x for x in re.findall(r"[a-z0-9]+",unicodedata.normalize("NFKD",s.lower())) if len(x)>2 and x not in STOP}
lock=threading.Lock(); used=set()
def search(session,q,title):
 url="https://www.bing.com/images/search?q="+quote(q)+"&qft=%2Bfilterui%3Alicense-L2_L3&form=IRFLTR"
 r=session.get(url,timeout=20); r.raise_for_status(); page=html.unescape(r.text)
 hits=[]
 for m in re.finditer(r'"murl"\s*:\s*"((?:\\.|[^"\\])*)"',page):
  u=m.group(1).replace("\\/","/")
  try: u=json.loads('"'+u+'"')
  except Exception: pass
  if not u.startswith("http") or any(x in u.lower() for x in ["bing.com","microsoft.com","gstatic.com"]): continue
  context=page[max(0,m.start()-2200):min(len(page),m.end()+600)]
  labels=[]
  for pattern in [r'"t"\s*:\s*"([^"]{3,220})"',r'"desc"\s*:\s*"([^"]{3,400})"',r'"alt"\s*:\s*"([^"]{3,220})"']:
   labels += [html.unescape(x.replace("\\u003c","<").replace("\\u003e",">")) for x in re.findall(pattern,context)]
  caption=" ".join(labels)
  key=words(title); cap=words(caption)
  # Require the result's own caption/title to contain the actual concept, not just the search query.
  required=key
  score=len(required & cap)
  min_score=1 if len(required)<=1 else (2 if len(required)<=3 else 2)
  if score<min_score: continue
  if any(x in u.lower() for x in ["snopes.com","gettyimages.com","istockphoto.com","shutterstock.com","pinterest.com","etsy.com","amazon.com","party-expert","ign.com","wwd.com","liverpoolecho","reddit.com","mediaproxy"]): continue
  hits.append((score,u,caption))
 hits.sort(key=lambda x:-x[0])
 return hits
def fetch(topic):
 tid,title,cat=topic
 s=requests.Session(); s.headers.update({"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"})
 queries=[f'"{title}" forex trading chart',f'"{title}" technical analysis diagram',f'{title} trading chart education']
 try:
  candidates=[]
  for q in queries:
   candidates=search(s,q,title)
   if candidates: break
  for score,u,caption in candidates[:10]:
   with lock:
    if u in used: continue
   try:
    r=s.get(u,timeout=18); r.raise_for_status()
    if len(r.content)<15000 or len(r.content)>10_000_000: continue
    im=Image.open(BytesIO(r.content)); im.load()
    if im.width<480 or im.height<230: continue
    im.thumbnail((1600,1000))
    if im.mode!="RGB": im=im.convert("RGB")
    dest=OUT/(tid+".jpg"); im.save(dest,"JPEG",quality=88,optimize=True)
    with lock: used.add(u)
    return tid,{"status":"downloaded","title":title,"path":str(dest),"source_url":u,"caption":caption[:350],"relevance":score,"width":im.width,"height":im.height}
   except Exception: continue
  return tid,{"status":"no_verified_match","title":title,"candidate_count":len(candidates)}
 except Exception as e: return tid,{"status":"search_error","title":title,"error":str(e)[:180]}
manifest={}
with ThreadPoolExecutor(max_workers=5) as pool:
 fs=[pool.submit(fetch,t) for t in topics]
 for i,f in enumerate(as_completed(fs),1):
  tid,x=f.result(); manifest[tid]=x
  print(f"[{i}/144] {x['status']}: {x['title']}",flush=True)
(ROOT/"assets"/"learn-trading-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("Verified topic-matched images:",sum(x["status"]=="downloaded" for x in manifest.values()),"/144")
