// V2 : l’énergie des aliments et repas est dérivée des macros (convention 4/4/9).
// Les objectifs de profil sont indépendants ; aucune macro n’est un « reste ».
export const round=(n,d=0)=>Number(n.toFixed(d));
export const energy=n=>4*Number(n.p||0)+4*Number(n.c||0)+9*Number(n.f||0);
export function nutrition(lines,foods){
 const total={p:0,c:0,f:0};
 for(const line of lines){
  const food=foods.find(f=>f.id===line.id);
  if(!food)throw Error('Aliment inconnu : '+line.id);
  if(!Number.isFinite(line.g)||line.g<0)throw Error('Quantité invalide.');
  for(const k of ['p','c','f'])total[k]+=Number(food[k]||0)*line.g/100;
 }
 return {...total,kcal:energy(total)};
}
export function targets(profile){
 const {age,height,weight,sex,activity,deficit=15}=profile;
 if(!profile.adultEligible||![age,height,weight].every(v=>Number.isFinite(Number(v)))||age<18||age>100||height<120||height>230||weight<35||weight>250)
  throw Error('Complète ton profil adulte pour calculer tes repères.');
 if(weight/(height/100)**2<18.5||(profile.goalWeight&&profile.goalWeight/(height/100)**2<18.5))
  throw Error('Un avis individualisé est nécessaire pour un poids actuel ou cible sous un IMC de 18,5.');
 if(!['m','f'].includes(sex)||![1.4,1.6,1.8,2].includes(Number(activity))||!Number.isFinite(Number(deficit))||deficit<0||deficit>20)
  throw Error('Vérifie l’activité et le déficit (0 à 20 %).');
 const bmr=10*weight+6.25*height-5*age+(sex==='m'?5:-161),maintenance=bmr*activity;
 // Les anciens manualKcal sont ignorés. La cible énergétique reste calculée.
 const kcal=Math.round(maintenance*(1-deficit/100));
 if(kcal<1200||kcal>6000)throw Error('Repère énergétique hors du domaine de cette version (1 200–6 000 kcal).');
 const coefficient=(key,fallback)=>{
  const value=profile[key]===undefined||profile[key]===null||profile[key]===''?fallback:Number(profile[key]);
  if(!Number.isFinite(value)||value<=0||value>10)throw Error('Vérifie les coefficients de macros.');return value;
 };
 const own=(key,ratio)=>{
  const value=profile[key];
  if(value===undefined||value===null||value===''||Number(value)===0)return round(weight*ratio,1);
  const n=Number(value);if(!Number.isFinite(n)||n<0||n>1500)throw Error('Repère de macro invalide.');return n;
 };
 const p=own('manualP',coefficient('proteinRatio',1.8));
 const c=own('manualC',coefficient('carbRatio',3));
 const f=own('manualF',coefficient('fatRatio',.8));
 // Changer p, c ou f ne modifie jamais les deux autres ni kcal.
 return {kcal,p,c,f,macroKcal:energy({p,c,f}),bmr:round(bmr),maintenance:round(maintenance)};
}
export const mealShares={breakfast:.25,lunch:.35,dinner:.30,snack:.10};
export function mealTarget(daily,slot){
 const share=mealShares[slot]??mealShares.lunch;
 return Object.fromEntries(['kcal','p','c','f'].map(k=>[k,round(daily[k]*share,1)]));
}
export function feasible(recipe,stock){return recipe.lines.every(l=>stock.has(l.id));}
export function portionStep(food,scale){return scale?(food.unit==='pièce'?food.grams:food.id==='oil'?1:5):food.grams*food.step;}
export function quantize(lines,foods,scale){
 return lines.map(line=>{
  const food=foods.find(f=>f.id===line.id),step=portionStep(food,scale);
  const g=round(Math.max(step,Math.round(line.g/step)*step),2);
  const piece=food.unit==='pièce';
  const amount=scale&&!piece?`${round(g,1)} g`:`≈ ${round(g/food.grams,2)} ${food.unit}${g/food.grams>1?'s':''} (${round(g,1)} g estimés)`;
  return {...line,g,amount};
 });
}
export function evaluatePortion(lines,foods,target,scale=true){
 const actualLines=quantize(lines,foods,scale),n=nutrition(actualLines,foods);
 const delta=Object.fromEntries(['p','c','f'].map(k=>[k,n[k]-target[k]]));
 const ok=Math.abs(delta.p)<=Math.max(3,target.p*.1)&&Math.abs(delta.c)<=Math.max(3,target.c*.1)&&Math.abs(delta.f)<=Math.max(2,target.f*.1);
 return {lines:actualLines,n,delta,ok};
}
export function adapt(recipe,foods,target,scale=true){
 if(!recipe.lines.length)throw Error('Ajoute au moins un ingrédient au plat.');
 if(['p','c','f'].some(k=>!Number.isFinite(target[k])||target[k]<0)||target.p+target.c+target.f<=0)
  throw Error('Renseigne au moins une cible de macro positive.');
 const base=recipe.lines.map(l=>({...l})),baseN=nutrition(base,foods);
 const ratios=['p','c','f'].filter(k=>baseN[k]>0&&target[k]>0).map(k=>target[k]/baseN[k]).sort((a,b)=>a-b);
 const factor=Math.max(.35,Math.min(2.5,ratios[Math.floor(ratios.length/2)]||1));
 const bounds=base.map(l=>[Math.max(.1,l.g*.35),l.g*2.5]);
 let best=base.map(l=>({...l,g:l.g*factor}));
 const score=ls=>{
  const n=nutrition(ls,foods);
  return ((n.p-target.p)/Math.max(8,target.p))**2+((n.c-target.c)/Math.max(12,target.c))**2+((n.f-target.f)/Math.max(6,target.f))**2+
   .001*ls.reduce((s,l,i)=>s+(l.g/(base[i].g*factor)-1)**2,0);
 };
 // Aucun terme calorique : changer une cible kcal historique n’influence pas le résultat.
 let value=score(best);
 for(const step of [.3,.12,.05,.02,.008])for(let pass=0;pass<24;pass++){
  let changed=false;
  for(let i=0;i<best.length;i++)for(const sign of [-1,1]){
   const trial=best.map(l=>({...l}));trial[i].g=Math.max(bounds[i][0],Math.min(bounds[i][1],trial[i].g+sign*base[i].g*step));
   const s=score(trial);if(s<value){best=trial;value=s;changed=true;}
  }
  if(!changed)break;
 }
 best=quantize(best,foods,scale);value=score(best);
 // Raffinement sur les quantités réalisables : les macros affichées suivent les arrondis.
 for(let pass=0;pass<12;pass++){
  let changed=false;
  for(let i=0;i<best.length;i++)for(const sign of [-1,1]){
   const step=portionStep(foods.find(f=>f.id===best[i].id),scale),g=round(best[i].g+sign*step,2);
   if(g<Math.max(step,bounds[i][0]-step/2)||g>bounds[i][1]+step/2)continue;
   const trial=best.map(l=>({...l}));trial[i].g=g;const s=score(trial);
   if(s<value-1e-9){best=trial;value=s;changed=true;}
  }
  if(!changed)break;
 }
 return evaluatePortion(best,foods,target,scale);
}
export function isoDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function weekDates(date){
 const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);
 return Array.from({length:7},(_,i)=>{const day=new Date(d);day.setDate(d.getDate()+i);return isoDate(day);});
}
