// V4 : énergie déclarée par aliment, indépendante des macros.
export const round=(n,d=0)=>n===null||n===undefined||!Number.isFinite(Number(n))?null:Number(Number(n).toFixed(d));
export function nutrition(lines,foods){
 const total={p:0,c:0,f:0,kcal:0},missing=[];
 for(const line of lines){
  const food=foods.find(f=>f.id===line.id);
  if(!food)throw Error('Aliment inconnu : '+line.id);
  if(!Number.isFinite(line.g)||line.g<0)throw Error('Quantité invalide.');
  for(const k of ['p','c','f'])total[k]+=Number(food[k]||0)*line.g/100;
  if(line.g>0){if(food.kcal===null||food.kcal===undefined||!Number.isFinite(Number(food.kcal)))missing.push(food.id);else total.kcal+=Number(food.kcal)*line.g/100;}
 }
 return {...total,kcal:missing.length?null:total.kcal,missingEnergy:missing};
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
 return {kcal,p,c,f,bmr:round(bmr),maintenance:round(maintenance)};
}
export const mealShares={breakfast:.25,lunch:.35,dinner:.30,snack:.10};
export function mealTarget(daily,slot){
 const share=mealShares[slot]??mealShares.lunch;
 return Object.fromEntries(['kcal','p','c','f'].map(k=>[k,round(daily[k]*share,1)]));
}
export function feasible(recipe,stock){return recipe.lines.every(l=>stock.has(l.id));}
export function portionStep(food,scale){return scale?(food.scaleStep||(food.unit==='pièce'?food.grams:food.grams<=5?1:5)):food.grams*food.step;}
// Le mode de mesure est un affichage. Le changer ne modifie jamais les grammes stockés.
export function formatQuantity(g,food,scale){
 if(scale)return {value:round(g,1),unit:'g',amount:`${round(g,1)} g`,step:portionStep(food,true)};
 const plurals={'cuillère à soupe':'cuillères à soupe','cuillère à café':'cuillères à café','demi-cuillère à café':'demi-cuillères à café','verre 200 ml':'verres de 200 ml','boîte égouttée':'boîtes égouttées','petite pièce':'petites pièces','petite poignée':'petites poignées','petite pomme':'petites pommes','petite poire':'petites poires','banane moyenne':'bananes moyennes','demi-mangue':'demi-mangues','demi-bloc':'demi-blocs','blanc d’œuf':'blancs d’œufs','bol en cubes':'bols en cubes','dose de référence':'doses de référence','cuillère à soupe émiettée':'cuillères à soupe émiettées'};
 const value=round(g/food.grams,2),unit=value>1?(food.unitPlural||plurals[food.unit]||(food.unit.endsWith('s')?food.unit:food.unit+'s')):food.unit;
 const display=value.toLocaleString('fr-FR',{maximumFractionDigits:2});
 return {value,unit,amount:`≈ ${display} ${unit}`,step:food.step};
}
export function quantize(lines,foods,scale){
 return lines.map(l=>{const food=foods.find(f=>f.id===l.id);return {...l,...formatQuantity(l.g,food,scale)};});
}
export function portion(lines,foods){
 return {lines:lines.map(l=>({id:l.id,g:Number(l.g)})),n:nutrition(lines,foods)};
}
export const stockKey=(profileId,foodId)=>`${profileId}:${foodId}`;
export function profileStock(foods,items,profileId){
 const initialized=items.some(x=>x.kind==='stock'&&x.key===stockKey(profileId,'__initialized'));
 const basics=['water','salt','pepperblack','oil'];
 return new Set(foods.filter(f=>{
  const own=items.find(x=>x.kind==='stock'&&x.key===stockKey(profileId,f.id));
  if(own)return own.payload.selected===true;
  if(initialized)return false;
  const legacy=items.find(x=>x.kind==='stock'&&x.key===f.id);
  return legacy?legacy.payload.selected===true:basics.includes(f.id);
 }).map(f=>f.id));
}
export function isoDate(date=new Date()){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;}
export function weekDates(date){
 const d=new Date(date+'T12:00:00');d.setDate(d.getDate()-(d.getDay()+6)%7);
 return Array.from({length:7},(_,i)=>{const day=new Date(d);day.setDate(d.getDate()+i);return isoDate(day);});
}

// Les unités naturelles restent pratiques avec une balance. Le choix explicite prévaut.
export function useGrams(food,scale,override){
 if(!scale)return false;
 if(override)return override==='g';
 return !/(pièce|tranche|pot|boîte|dose|banane|pomme|poire|blanc d’œuf)/i.test(food.unit||'');
}
export function restoredPortion(reference,saved){
 return reference.map(l=>({id:l.id,g:saved?.find(x=>x.id===l.id&&Number.isFinite(x.g)&&x.g>=0)?.g??l.g}));
}
export function shoppingNeeds(meals,items,profileId,from,to){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Vérifie la période de courses.');
 const sums=new Map();
 for(const item of meals){const m=item.payload||item;
  if(m.status==='consumed'||m.date<from||m.date>to||(m.kitchenProfile||m.profile)!==profileId)continue;
  for(const l of m.lines||[]){if(l.id==='water')continue;if(!Number.isFinite(l.g)||l.g<0)throw Error('Quantité de planning invalide.');sums.set(l.id,(sums.get(l.id)||0)+l.g);}
 }
 return [...sums].map(([id,requiredG])=>{
  const own=items.find(x=>x.kind==='stock'&&x.key===stockKey(profileId,id))?.payload;
  const known=!own?.selected||(own.quantityG!==null&&own.quantityG!==undefined&&Number.isFinite(own.quantityG)&&own.quantityG>=0);
  const availableG=known?(own?.selected?own.quantityG:0):null;
  return {id,requiredG,availableG,toBuyG:known?Math.max(0,round(requiredG-availableG,2)):null,updatedAt:own?.quantityUpdatedAt||null};
 });
}
