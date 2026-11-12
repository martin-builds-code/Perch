"""Offline, pseudonymous sky comparisons from the bounded R04 evidence."""
import datetime
import json
import math
import os
import sys
from pathlib import Path

os.environ.setdefault('MPLCONFIGDIR', '/tmp/perch-r04-matplotlib')
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

source = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/perch-r04-live/observation.json')
out = Path(sys.argv[2] if len(sys.argv) > 2 else '/tmp/perch-r04-figures')
out.mkdir(parents=True, exist_ok=True)
evidence = json.loads(source.read_text())
frames = evidence['sky']['frames']
candidates = []
for frame in frames:
    result = frame['result']
    if not result['primary'] or result['primary'] == result['baselinePrimary']:
        continue
    rows = {row['ref']: row for row in result['ranked']}
    a, b = rows.get(result['primary']), rows.get(result['baselinePrimary'])
    spatial = {row['id']: row for row in frame['snapshot']['aircraft']}
    if not a or not b or a['ref'] not in spatial or b['ref'] not in spatial:
        continue
    if any(row['observation']['elevationDegrees'] is None for row in (a,b)):
        continue
    separation = abs(a['observation']['elevationDegrees'] - b['observation']['elevationDegrees'])
    candidates.append((separation, frame))

chosen, pairs = [], set()
for _, frame in sorted(candidates, key=lambda x: x[0], reverse=True):
    result = frame['result']
    pair = (result['primary'], result['baselinePrimary'])
    if pair in pairs or any(abs(frame['atMs']-v['atMs']) < 120000 for v in chosen):
        continue
    chosen.append(frame)
    pairs.add(pair)
    if len(chosen) == 3:
        break
chosen.sort(key=lambda f: f['atMs'])
if not chosen:
    raise SystemExit('No observed different-choice frames to illustrate; do not invent any.')

navy, ink, aqua, gold = '#081925', '#EAF0F6', '#3BD9CB', '#FFC43D'
plt.rcParams.update({'font.family':'DejaVu Sans','font.size':10,'text.color':ink,'axes.labelcolor':ink,'xtick.color':ink,'ytick.color':ink})
fig = plt.figure(figsize=(11, 3.8*len(chosen)), facecolor=navy)
grid = fig.add_gridspec(len(chosen), 2, width_ratios=[1,1.25], hspace=.3, wspace=.28)
case_records = []
for i, frame in enumerate(chosen):
    result = frame['result']
    rows = {r['ref']:r for r in result['ranked']}
    spatial = {r['id']:r for r in frame['snapshot']['aircraft']}
    ax = fig.add_subplot(grid[i,0], projection='polar', facecolor=navy)
    ax.set_theta_zero_location('N');ax.set_theta_direction(-1)
    ax.set_ylim(0,90)
    ax.set_xticks([0,math.pi/2,math.pi,3*math.pi/2],['N','E','S','W'])
    ax.set_yticks([30,60,90],['60°','30°','horizon'])
    ax.tick_params(labelsize=9)
    ax.grid(color='#476071',alpha=.55)
    ax.spines['polar'].set_color('#476071')
    for ref,row in rows.items():
        aircraft = spatial.get(ref)
        elevation = row['observation']['elevationDegrees']
        bearing = aircraft.get('bearingDegrees') if aircraft else None
        if bearing is None or elevation is None:
            continue
        selected = ref==result['primary'];old = ref==result['baselinePrimary']
        color = aqua if selected else gold if old else '#8C9AA3'
        size = 110 if selected or old else 30
        angle = math.radians(bearing)
        ax.scatter([angle],[90-elevation],s=size,c=color,edgecolors=navy,zorder=5)
        ax.annotate(ref,(angle,90-elevation),xytext=(6,6),textcoords='offset points',color=color,fontsize=9)
    text = fig.add_subplot(grid[i,1]);text.axis('off')
    stamp = datetime.datetime.fromtimestamp(frame['atMs']/1000,datetime.timezone.utc).strftime('%H:%M:%S UTC')
    text.text(0,1,f'Example {i+1} · {stamp}',fontsize=15,weight='bold',va='top')
    y=.83
    case = {'atMs':frame['atMs'],'r03':result['baselinePrimary'],'r04':result['primary'],'decision':result['decision']['reason'],'aircraft':[]}
    for label, ref, color in [('R03 selected',result['baselinePrimary'],gold),('R04 selected',result['primary'],aqua)]:
        row=rows[ref];o=row['observation']
        model=row.get('model') or row.get('typeCode') or 'Unidentified aircraft'
        text.text(0,y,f'{label}: {ref}',color=color,fontsize=12,weight='bold',va='top')
        text.text(0,y-.10,str(model)[:44],fontsize=12,va='top')
        text.text(0,y-.20,f"{row['distanceKm']:.1f} km horizontally · {o['elevationDegrees']:.1f}° estimated elevation",fontsize=10,va='top')
        eta='unavailable' if o['secondsToCpa'] is None else f"{o['secondsToCpa']:.0f} s"
        text.text(0,y-.29,f"{row['motion']} · estimated CPA time: {eta}",fontsize=10,va='top')
        case['aircraft'].append({'ref':ref,'model':model,'distanceKm':row['distanceKm'],'elevationDegrees':o['elevationDegrees'],'motion':row['motion'],'secondsToCpa':o['secondsToCpa']})
        y-=.44
    text.text(0,-.05,'No flight-plan or visibility verification is implied.',fontsize=9,color='#B4C5CF')
    case_records.append(case)

fig.suptitle('R04 live evidence: geometry explains different choices',fontsize=18,weight='bold',y=.99)
fig.text(.5,.015,'Same captured aircraft snapshots. Trial-local references; no location coordinates. Barometric/geometric and constant-motion estimates have uncertainty.',ha='center',fontsize=8,color='#B4C5CF')
fig.text(.5,.955,'Each sky plot: centre = directly overhead; outer circle = horizon',ha='center',fontsize=11,color='#B4C5CF')
fig.subplots_adjust(top=.92,bottom=.055)
fig.savefig(out/'sky-comparisons.png',dpi=130,facecolor=navy)
plt.close(fig)
(out/'sky-comparison-cases.json').write_text(json.dumps(case_records,indent=2)+'\n')
print(json.dumps({'cases':len(case_records),'output':str(out/'sky-comparisons.png')}))
