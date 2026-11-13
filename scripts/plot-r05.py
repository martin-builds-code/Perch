"""Plot bounded, pseudonymous R05 observations; no external network."""
import json,sys,pathlib,os
os.environ.setdefault("MPLCONFIGDIR", "/tmp/perch-r05-matplotlib")
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Patch
source=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2]);output.parent.mkdir(parents=True,exist_ok=True)
x=json.loads(source.read_text());start=x['startedAtMs'];end=x['observedUntilMs'];length=(end-start)/60000
starts=sorted(s['diagnostic']['upstreamStartedAtMs'] for s in x['apiSamples'] if (s.get('diagnostic') or {}).get('upstreamRequestsStarted')==1 and isinstance((s.get('diagnostic') or {}).get('upstreamStartedAtMs'),(int,float)))
times=sorted(set([start,end]+[v for t in starts for v in [t,t+300000] if start<=v<=end]))
rolling=[sum(t>v-300000 and t<=v for t in starts) for v in times]
fig,ax=plt.subplots(2,1,figsize=(10,5.8),sharex=True,gridspec_kw={'height_ratios':[3,1]})
fig.suptitle('R05 live trial — measured budget use and route display',fontsize=14)
ax[0].step([(t-start)/60000 for t in times],rolling,where='post',label='Observed starts in trailing five minutes',color='#166a91',linewidth=2)
ax[0].axhline(10,color='#be5c3c',linestyle='--',label='Application ceiling: 10')
ax[0].set(ylim=(-.3,11),ylabel='Upstream request starts')
ax[0].grid(alpha=.2);ax[0].legend(loc='upper right',fontsize=9)
colors={'recent':'#2b987e','historical':'#7c61a8','missing':'#d7b060','empty':'#d9dfe3'}
scenes=sorted([e for e in x.get('sky',{}).get('events',[]) if e['type']=='scene'],key=lambda e:e['atMs'])
for i,e in enumerate(scenes):
 a=max(start,e['atMs']);b=min(end,scenes[i+1]['atMs'] if i+1<len(scenes) else end)
 p=e.get('primary');state='empty' if not p else 'missing' if not p.get('complete') else 'historical' if p.get('historical') else 'recent'
 if b>a:ax[1].broken_barh([((a-start)/60000,(b-a)/60000)],(.1,.8),facecolors=colors[state],linewidth=0)
ax[1].set(xlim=(0,length),ylim=(0,1),yticks=[],xlabel='Minutes from observation start')
ax[1].legend(handles=[Patch(color=colors[k],label=t) for k,t in [('recent','Recent route'),('historical','Qualified historical route'),('missing','Primary without complete route'),('empty','No primary')]],loc='upper center',bbox_to_anchor=(.5,-.55),ncol=2,fontsize=9,frameon=False)
fig.text(.08,.025,'No aircraft identities or coordinates shown. Route presence is not independent flight-plan verification.',fontsize=8,color='#555555')
fig.tight_layout(rect=(0,.13,1,.94));fig.savefig(output);plt.close(fig)
print(str(output))
