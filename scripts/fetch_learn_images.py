#!/usr/bin/env python3
"""Download curated topic-matched image results into local Learn Trading assets. Includes indicators, FX fundamentals, risk, testing, patterns, ICT models, order-flow and candlestick, forex fundamentals, backtesting, risk and market mechanics and Wyckoff, volatility, psychology, statistical, order-flow, indicator and session models and ICT entry model lessons."""
import json
from pathlib import Path
from io import BytesIO
from concurrent.futures import ThreadPoolExecutor,as_completed
import requests
from PIL import Image
ROOT=Path("."); OUT=ROOT/"assets"/"learn-trading"; OUT.mkdir(parents=True,exist_ok=True)
sources=json.loads((ROOT/"assets"/"learn-image-sources.json").read_text(encoding="utf-8"))
existing_path=ROOT/"assets"/"learn-trading-manifest.json"
manifest=json.loads(existing_path.read_text(encoding="utf-8")) if existing_path.exists() else {}
session=requests.Session()
session.headers.update({"User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36"})
def download(item):
 tid,(url,page,title)=item
 try:
  r=session.get(url,timeout=25); r.raise_for_status()
  if len(r.content)<12000 or len(r.content)>12000000: raise ValueError("Image file size outside safe range")
  im=Image.open(BytesIO(r.content)); im.load()
  if im.width<420 or im.height<220: raise ValueError("Image dimensions too small")
  im.thumbnail((1800,1200))
  if im.mode!="RGB": im=im.convert("RGB")
  dest=OUT/(tid+".jpg"); im.save(dest,"JPEG",quality=90,optimize=True)
  return tid,{"status":"downloaded","title":title,"path":str(dest).replace("\\","/"),"source_page":page,"original_image":url,"width":im.width,"height":im.height}
 except Exception as e:
  return tid,{"status":"download_error","title":title,"source_page":page,"error":str(e)[:240]}
with ThreadPoolExecutor(max_workers=6) as pool:
 fs=[pool.submit(download,x) for x in sources.items()]
 for n,f in enumerate(as_completed(fs),1):
  tid,result=f.result(); manifest[tid]=result
  print(f"[{n}/{len(sources)}] {result['status']}: {result['title']}",flush=True)
(ROOT/"assets"/"learn-trading-manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
print("Downloaded local topic images:",sum(x["status"]=="downloaded" for x in manifest.values()),"/",len(sources))
