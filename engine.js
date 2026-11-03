// Toutes les masses de calcul sont en grammes de partie comestible.
export const round = (n,d=0) => Number(n.toFixed(d));
export function nutrition(lines, foods) {
  return lines.reduce((s,l)=>{
    const f=foods.find(f=>f.id===l.id); if(!f) throw Error('Aliment inconnu : '+l.id);
    for(const k of ['kcal','p','c','f']) s[k]+=(f[k]||0)*l.g/100;
    return s;
  },{kcal:0,p:0,c:0,f:0});
}
export function targets(profile) {
  const {age,height,weight,sex,activity,deficit=15}=profile;
  if(!profile.adultEligible || age<18 || age>100 || height<120 || height>230 || weight<35 || weight>250)
    throw Error('Complète un profil adulte valide. Le calcul de sèche ne convient pas à la grossesse ou à l’allaitement.');
  if(weight/(height/100)**2<18.5 || (profile.goalWeight && profile.goalWeight/(height/100)**2<18.5))
    throw Error('Cette V1 ne propose pas de sèche pour un poids actuel ou cible sous un IMC de 18,5. Demande un avis individualisé.');
  if(!['m','f'].includes(sex)||![1.4,1.6,1.8,2].includes(Number(activity))||!Number.isFinite(Number(deficit))||deficit<0||deficit>20)throw Error('Paramètres de calcul invalides.');
  const bmr=10*weight+6.25*height-5*age+(sex==='m'?5:-161);
  const maintenance=bmr*activity; // activité globale, sport déjà compris : pas de double comptage
  const kcal=profile.manualKcal || Math.round(maintenance*(1-deficit/100));
  if(kcal<1200 || kcal>6000) throw Error('Objectif hors du domaine de cette V1 (1 200–6 000 kcal). Ce seuil n’est pas une validation médicale.');
  const p=profile.manualP || round(weight*1.8);
  const f=profile.manualF || round(weight*0.8);
  const c=profile.manualC || round((kcal-4*p-9*f)/4);
  if(c<0 || p<=0 || f<=0) throw Error('Calories insuffisantes pour les macros saisies.');
  if(Math.abs(4*p+4*c+9*f-kcal)>kcal*.05) throw Error('Tes macros et calories diffèrent de plus de 5 %. Ajuste-les.');
  return {kcal,p,c,f,bmr:round(bmr),maintenance:round(maintenance)};
}
export const mealShares={breakfast:.25,lunch:.35,dinner:.30,snack:.10};
export function mealTarget(daily,slot){return Object.fromEntries(['kcal','p','c','f'].map(k=>[k,round(daily[k]*mealShares[slot])]));}
export function feasible(recipe, stock){return recipe.lines.every(l=>stock.has(l.id));}
// Pas balance : portions réalisables AVANT de recalculer les valeurs nutritionnelles.
export function quantize(lines,foods,scale){
  return lines.map(l=>{
    const food=foods.find(f=>f.id===l.id);
    const step=scale ? (food.unit==='pièce'?food.grams:food.id==='oil'?1:5) : food.grams*food.step;
    const g=Math.max(step,Math.round(l.g/step)*step);
    const amount=scale && food.unit!=='pièce' ? `${round(g)} g` : `≈ ${round(g/food.grams,2)} ${food.unit}${g/food.grams>1?'s':''} (${round(g)} g estimés)`;
    return {...l,g,amount};
  });
}
export function adapt(recipe,foods,target,scale=true){
  if(!recipe.lines.length) throw Error('Recette vide');
  const base=recipe.lines.map(l=>({...l}));
  const baseN=nutrition(base,foods);
  const factor=Math.max(.35,Math.min(2.5,target.kcal/baseN.kcal));
  let best=base.map(l=>({...l,g:l.g*factor}));
  const bounds=base.map(l=>[Math.max(1,l.g*.35),l.g*2.5]);
  const score=ls=>{
    const n=nutrition(ls,foods);
    return 5*((n.kcal-target.kcal)/target.kcal)**2+4*((n.p-target.p)/Math.max(10,target.p))**2+
      ((n.c-target.c)/Math.max(15,target.c))**2+((n.f-target.f)/Math.max(8,target.f))**2+
      .003*ls.reduce((s,l,i)=>s+(l.g/(base[i].g*factor)-1)**2,0);
  };
  let value=score(best);
  for(const step of [.25,.1,.04,.015]) for(let pass=0;pass<18;pass++){
    let changed=false;
    for(let i=0;i<best.length;i++) for(const sign of [-1,1]){
      const trial=best.map(l=>({...l}));
      trial[i].g=Math.max(bounds[i][0],Math.min(bounds[i][1],trial[i].g+sign*base[i].g*step));
      const s=score(trial); if(s<value){best=trial;value=s;changed=true;}
    }
    if(!changed) break;
  }
  const lines=quantize(best,foods,scale), n=nutrition(lines,foods);
  const delta=Object.fromEntries(['kcal','p','c','f'].map(k=>[k,n[k]-target[k]]));
  const ok=Math.abs(delta.kcal)<=target.kcal*.05 && Math.abs(delta.p)<=Math.max(5,target.p*.1) &&
    Math.abs(delta.c)<=Math.max(5,target.c*.15) && Math.abs(delta.f)<=Math.max(3,target.f*.15);
  return {lines,n,delta,ok};
}
export function isoDate(date=new Date()){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
export function weekDates(date){
  const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);
  return Array.from({length:7},(_,i)=>{const day=new Date(d);day.setDate(d.getDate()+i);return isoDate(day);});
}
