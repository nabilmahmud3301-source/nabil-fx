#!/usr/bin/env python3
"""Find topic-specific Creative Commons images through Google Images and store local copies."""
import json,re,html,unicodedata,threading,time
from pathlib import Path
from urllib.parse import quote,unquote
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor,as_completed
import requests
from PIL import Image
ROOT=Path("."); OUT=ROOT/"assets"/"learn-trading"; OUT.mkdir(parents=True,exist_ok=True)
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
def tokens(s):
 return {x for x in re.findall(r"[a-z0-9]+",unicodedata.normalize("NFKD",s.lower())) if len(x)>2}
used=set(); lock=threading.Lock()
def search_google(session,query):
 url="https://www.google.com/search?tbm=isch&tbs=il:cl&safe=active&q="+quote(query)
 r=session.get(url,timeout=18); r.raise_for_status(); body=r.text
 found=[]
 # Google image result objects expose original image URLs in the "ou" field.
 for m in re.finditer(r'"ou"\s*:\s*"([^"]+)"',body):
  start=max(0,m.start()-1800); end=min(len(body),m.end()+800)
  context=html.unescape(body[start:end]).replace("\\u003d","=").replace("\\u0026","&")
  u=html.unescape(m.group(1)).replace("\\u003d","=").replace("\\u0026","&")
  u=u.replace("\\/","/")
  if u.startswith("http") and not any(x in u.lower() for x in ["google.com","gstatic.com","googleusercontent.com","youtube.com"]):
   found.append((context,u))
 return found
def fetch_one(topic):
 tid,title,cat=topic
 session=requests.Session(); session.headers.update({"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"})
 queries=[f"{title} forex trading chart educational example",f"{title} technical analysis annotated chart"]
 terms=tokens(title)
 candidates=[]
 try:
  for q in queries:
   for ctx,u in search_google(session,q):
    score=len(terms & tokens(ctx))
    if score>=1:
     with lock:
      if u not in used: candidates.append((score,u,q))
   if candidates: break
  candidates.sort(key=lambda x:-x[0])
  for score,u,q in candidates[:5]:
   try:
    res=session.get(u,timeout=18); res.raise_for_status()
    if len(res.content)>12_000_000: continue
    im=Image.open(BytesIO(res.content)); im.load()
    if im.width<600 or im.height<280: continue
    im.thumbnail((1800,1200))
    if im.mode!="RGB": im=im.convert("RGB")
    dest=OUT/(tid+".jpg"); im.save(dest,"JPEG",quality=88,optimize=True)
    with lock: used.add(u)
    return tid,{"status":"downloaded","title":title,"path":str(dest),"source_url":u,"search_query":q,"width":im.width,"height":im.height,"search_filter":"Google Images Creative Commons"}
   except Exception: continue
  return tid,{"status":"no_verified_image","title":title,"queries":queries}
 except Exception as e:
  return tid,{"status":"search_error","title":title,"error":str(e)[:180]}
manifest={}
with ThreadPoolExecutor(max_workers=3) as pool:
 futures=[pool.submit(fetch_one,t) for t in topics]
 for n,f in enumerate(as_completed(futures),1):
  tid,item=f.result(); manifest[tid]=item
  print(f"[{n}/144] {item['status']}: {item['title']}",flush=True)
(ROOT/"assets"/"learn-trading-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
total=sum(x["status"]=="downloaded" for x in manifest.values())
print(f"Finished: {total}/144 local images downloaded from Creative Commons-filtered image search.")
