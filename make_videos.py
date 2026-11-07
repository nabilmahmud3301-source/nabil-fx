from PIL import Image, ImageDraw, ImageFont
import math, os, subprocess
W,H=640,360
OUT='/mnt/data/card_video_work/videos'
os.makedirs(OUT,exist_ok=True)
try: font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'; bold_path='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
except: font_path=bold_path=None
def font(sz,b=False): return ImageFont.truetype(bold_path if b else font_path,sz)
BG=(7,10,17); PANEL=(16,22,33); LINE=(37,48,64); WHITE=(231,238,248); MUTED=(130,147,169); RED=(241,69,91); GREEN=(58,213,155); BLUE=(81,157,255); GOLD=(246,187,80)
def base(title,sub='NABIL FX WORKSPACE'):
 im=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(im)
 d.rectangle((0,0,W,43),fill=(12,17,27)); d.text((20,13),sub,font=font(12,True),fill=WHITE); d.ellipse((584,15,595,26),fill=GREEN); d.text((604,13),'LIVE',font=font(10,True),fill=MUTED)
 d.text((22,60),title,font=font(21,True),fill=WHITE); d.line((22,94,618,94),fill=LINE,width=1)
 return im,d
def rounded(d,box,fill,outline=None,r=8): d.rounded_rectangle(box,radius=r,fill=fill,outline=outline)
def txt(d,xy,s,size=11,color=WHITE,b=False): d.text(xy,s,font=font(size,b),fill=color)
def make_frame(kind,t):
 if kind=='journal':
  im,d=base('Trade Journal','NABIL FX  /  JOURNAL')
  for i,(label,val,col) in enumerate([('TOTAL TRADES','24',BLUE),('WIN RATE','62.5%',GREEN),('AVG R:R','1 : 2.1',GOLD)]):
   x=22+i*202; rounded(d,(x,108,x+188,159),PANEL,LINE); txt(d,(x+12,118),label,9,MUTED,True); txt(d,(x+12,136),val,16,col,True)
  rounded(d,(22,174,618,333),PANEL,LINE)
  txt(d,(38,187),'RECENT ENTRIES',10,MUTED,True)
  for i,row in enumerate([('EUR/USD','London sweep','BUY','+2.0R'),('GBP/USD','MSS + FVG','SELL','+1.4R'),('EUR/USD','POI retest','BUY','—')]):
   y=218+i*35
   if i==int((t*2)%3): rounded(d,(34,y-5,606,y+24),(25,35,48))
   txt(d,(43,y),row[0],11,WHITE,True); txt(d,(155,y),row[1],10,MUTED); txt(d,(370,y),row[2],10,GREEN if row[2]=='BUY' else RED,True); txt(d,(515,y),row[3],11,GREEN if '+' in row[3] else MUTED,True)
  if t>1.5: rounded(d,(405,278,588,316),(20,47,42),GREEN); txt(d,(418,289),'ENTRY SAVED ✓',11,GREEN,True)
 elif kind=='backtest':
  im,d=base('Strategy Backtest','NABIL FX  /  BACKTEST ENGINE')
  rounded(d,(22,108,618,332),PANEL,LINE); txt(d,(38,121),'EUR/USD  ·  LONDON SESSION',10,MUTED,True)
  # animated equity curve
  pts=[]
  for i in range(31):
   x=42+i*18
   y=278-(i*3.6 + math.sin(i*.85+t*2)*13 + (math.sin(i*1.9)*5))
   if i>int(t*8): y=280-math.sin(i*.4)*3
   pts.append((x,y))
  d.line(pts,fill=BLUE,width=3)
  for x,y in pts[::3]: d.ellipse((x-3,y-3,x+3,y+3),fill=BLUE)
  txt(d,(42,300),'TRADES  126',10,MUTED,True); txt(d,(190,300),'WIN RATE  58.7%',10,GREEN,True); txt(d,(380,300),'PROFIT FACTOR  1.84',10,GOLD,True)
  rounded(d,(438,137,589,181),(21,44,39),GREEN); txt(d,(451,146),'TEST RUNNING',10,GREEN,True); txt(d,(451,161),f'{min(100,int(t/3*100)):02d}% COMPLETE',9,WHITE)
 elif kind=='analysis':
  im,d=base('Market Analysis','NABIL FX  /  CHART ANALYSIS')
  rounded(d,(22,108,618,332),PANEL,LINE); txt(d,(38,120),'EUR/USD  ·  5M',10,MUTED,True)
  # grid
  for y in [155,195,235,275]: d.line((38,y,601,y),fill=LINE)
  for x in range(48,600,32): d.line((x,145,x,285),fill=(25,34,47))
  vals=[210,202,218,190,197,176,185,160,172,153,164,145,158,135,147,128,142,118,130,110,123,99,112,92]
  for i,v in enumerate(vals):
   x=48+i*23; center=v+math.sin(i+t*2)*3; up=center-12-(i%3)*3; low=center+14+(i%4)*2
   col=GREEN if i%4 in (1,2) else RED
   d.line((x,up,x,low),fill=col,width=2); d.rectangle((x-5,center-7,x+5,center+7),fill=col)
  ylevel=183; d.line((38,ylevel,600,ylevel),fill=GOLD,width=2); rounded(d,(455,165,590,182),(48,39,22),GOLD); txt(d,(463,168),'POI / LIQUIDITY',8,GOLD,True)
  rounded(d,(38,294,596,320),(19,28,41)); txt(d,(50,302),'BIAS: BULLISH',10,GREEN,True); txt(d,(218,302),'SWEEP ✓',10,GOLD,True); txt(d,(345,302),'MSS CONFIRMATION',10,BLUE,True)
 elif kind=='growth':
  im,d=base('Performance Growth','NABIL FX  /  PERFORMANCE')
  for i,(lab,val,col) in enumerate([('EQUITY GROWTH','+18.6%',GREEN),('RULE FOLLOWING','92%',BLUE),('DRAWDOWN','-4.2%',GOLD)]):
   x=22+i*202; rounded(d,(x,108,x+188,160),PANEL,LINE); txt(d,(x+12,118),lab,9,MUTED,True); txt(d,(x+12,136),val,17,col,True)
  rounded(d,(22,174,618,332),PANEL,LINE); txt(d,(38,187),'CONSISTENCY OVER TIME',10,MUTED,True)
  bars=[35,48,43,61,57,73,68,85,79,101,96,115,109,129,124,139]
  for i,h in enumerate(bars):
   x=47+i*33; h2=int(h*(.55+.45*min(1,t/2)))
   rounded(d,(x,307-h2,x+17,307),(25,50,48) if i<len(bars)-1 else (28,105,78),None,3)
  if t>1: rounded(d,(420,202,584,241),(20,47,42),GREEN); txt(d,(434,211),'NEW BEST STREAK',9,GREEN,True); txt(d,(434,225),'12 TRADES',12,WHITE,True)
 return im
for kind,num in [('journal','01'),('backtest','02'),('analysis','03'),('growth','04')]:
 raw=f'/tmp/nabil-{kind}.mp4'
 cmd=['ffmpeg','-y','-loglevel','error','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r','15','-i','-','-an','-c:v','libx264','-preset','ultrafast','-crf','26','-pix_fmt','yuv420p','-movflags','+faststart','-t','3.2',raw]
 p=subprocess.Popen(cmd,stdin=subprocess.PIPE)
 try:
  for i in range(48):
   t=i/15
   p.stdin.write(make_frame(kind,t).tobytes())
 finally:
  p.stdin.close(); p.wait()
 os.replace(raw,os.path.join(OUT,f'motion-{num}.mp4'))
 print(kind,os.path.getsize(os.path.join(OUT,f'motion-{num}.mp4')))
