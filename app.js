import {CONFIG} from './config.js';
import {FOODS,RECIPES} from './data.js';
import {nutrition,targets,mealTarget,adapt,feasible,round,isoDate,weekDates} from './engine.js';
const $=s=>document.querySelector(s), e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=u=>{try{const x=new URL(u);return x.protocol==='https:'?x.href:'';}catch{return '';}};
const app=$('#app'), modal=$('#modal');
let db,session,members=[],rows=[],foods=[],recipes=[],stock=new Set(),route='ideas',active='',search='',foodSearch='',filters=new Set(),detail=null,polling=false,editing=false;
let day=isoDate(),slot='lunch',timer,refreshBusy=false;
const labels={breakfast:'Petit déjeuner',lunch:'Déjeuner',dinner:'Dîner',snack:'Collation'};
const num=(fd,k)=>Number(fd.get(k)||0);
const list=kind=>rows.filter(x=>x.kind===kind);
const row=(kind,key)=>rows.find(x=>x.kind===kind&&x.key===key);
const payload=(kind,key)=>row(kind,key)?.payload;
const name=id=>payload('profile',id)?.name||members.find(m=>m.user_id===id)?.display_name||'Profil';
const profile=id=>payload('profile',id);
function daily(id=active){try{return targets(profile(id)||{});}catch{return null;}}
function toast(text){$('#toast').textContent=text;$('#toast').style.display='block';clearTimeout(timer);timer=setTimeout(()=>$('#toast').style.display='none',5000);}
function fail(err){console.error(err);toast(err.message||'Une erreur est survenue.');}
function assertOnline(){if(!navigator.onLine)throw Error('Connexion nécessaire : aucune modification hors ligne n’est enregistrée.');}
function checked(result){if(result.error)throw result.error;return result.data;}
async function reload(){
 if(refreshBusy)return;refreshBusy=true;
 try{
  const [a,b]=await Promise.all([db.from('fuel_members').select('*').eq('space_id',CONFIG.space),db.from('fuel_items').select('*').eq('space_id',CONFIG.space)]);
  members=checked(a)||[];rows=checked(b)||[];
  if(!members.length)throw Error('Cet utilisateur n’a pas accès à Fuel me. Vérifie les deux emails du script SQL.');
  if(!members.some(m=>m.user_id===active))active=session.user.id;
  if(!members.some(m=>m.user_id===active))active=members[0].user_id;
  localStorage.setItem('fuel-profile',active);
  foods=merge(FOODS,list('food'));recipes=merge(RECIPES,list('recipe')).filter(r=>!r.hidden);
  const basics=['water','salt','pepperblack','oil'];
  stock=new Set(foods.filter(f=>payload('stock',f.id)?.selected??basics.includes(f.id)).map(f=>f.id));
 }finally{refreshBusy=false;}
}
function merge(base,overrides){const m=new Map(base.map(x=>[x.id,x]));overrides.forEach(x=>m.set(x.key,{...x.payload,id:x.key}));return [...m.values()];}
async function save(kind,key,data){
 assertOnline();const old=row(kind,key);let result;
 if(old){result=await db.from('fuel_items').update({payload:data,rev:old.rev+1}).eq('space_id',CONFIG.space).eq('kind',kind).eq('key',key).eq('rev',old.rev).select();}
 else{result=await db.from('fuel_items').insert({space_id:CONFIG.space,kind,key,payload:data}).select();}
 if(result.error?.code==='23505'){await reload();throw Error('Modifié sur un autre appareil. Réessaie après actualisation.');}
 const changed=checked(result);
 if(!changed?.length){await reload();throw Error('Modification concurrente : actualise avant de réessayer.');}
 rows=rows.filter(x=>!(x.kind===kind&&x.key===key)).concat(changed);
}
async function remove(kind,key){
 const old=row(kind,key);if(!old)return;assertOnline();
 const r=checked(await db.from('fuel_items').delete().eq('space_id',CONFIG.space).eq('kind',kind).eq('key',key).eq('rev',old.rev).select());
 if(!r?.length){await reload();throw Error('Cette donnée a changé. Actualise et réessaie.');}
 rows=rows.filter(x=>!(x.kind===kind&&x.key===key));
}
function targetForm(t,prefix='',manual=false){
 return `<div class="row"><label>Calories (kcal)<input name="${prefix}kcal" type="number" min="${manual?1:100}" max="2500" step="1" value="${round(t.kcal)}" required></label><label>Protéines (g)<input name="${prefix}p" type="number" min="${manual?0:1}" max="250" step="1" value="${round(t.p)}" required></label></div><div class="row"><label>Glucides (g)<input name="${prefix}c" type="number" min="0" max="400" step="1" value="${round(t.c)}" required></label><label>Lipides (g)<input name="${prefix}f" type="number" min="0" max="150" step="1" value="${round(t.f)}" required></label></div>`;
}
function readTarget(fd,prefix='',manual=false){
 const t=Object.fromEntries(['kcal','p','c','f'].map(k=>[k,num(fd,prefix+k)]));
 if(t.kcal<(manual?1:100)||t.kcal>2500||(!manual&&t.p<=0)||['kcal','p','c','f'].some(k=>!Number.isFinite(t[k])||t[k]<0))throw Error('Cible de repas invalide.');
 if(Math.abs(t.p*4+t.c*4+t.f*9-t.kcal)>t.kcal*.05)throw Error('Les calories de tes macros doivent correspondre à ta cible à ±5 %.');
 return t;
}
function macros(n){return `<div class="nutri"><div><strong>${round(n.kcal)}</strong>kcal</div><div><strong>${round(n.p,1)} g</strong>protéines</div><div><strong>${round(n.c,1)} g</strong>glucides</div><div><strong>${round(n.f,1)} g</strong>lipides</div></div>`;}
function open(html){editing=true;modal.innerHTML=`<button class="close quiet" data-action="close" aria-label="Fermer">✕</button>${html}`;if(!modal.open)modal.showModal();}
function close(){modal.close();editing=false;detail=null;}
modal.addEventListener('close',()=>{editing=false;detail=null;});
function shell(){
 $('#account').innerHTML=`<span class="email">${e(session.user.email)}</span> <button class="quiet" data-action="refresh" aria-label="Actualiser">↻</button><button class="quiet" data-action="logout">Sortir</button>`;
 $('#nav').innerHTML=[['ideas','✦','Idées'],['pantry','◫','Aliments'],['favorites','♡','Favoris'],['planner','▦','Planning'],['profiles','◉','Profils']].map(([r,icon,n])=>`<button data-action="route" data-route="${r}" class="${route===r?'active':''}" ${route===r?'aria-current="page"':''}><span>${icon}</span>${n}</button>`).join('');
}
function profileSelect(){return `<label>Pour qui ?<select id="active-profile">${members.map(m=>`<option value="${m.user_id}" ${active===m.user_id?'selected':''}>${e(name(m.user_id))}</option>`).join('')}</select></label>`;}
function render(){
 if(!session)return login();shell();
 if(route==='pantry')return pantry();if(route==='profiles')return profiles();if(route==='planner')return planner();
 ideas();
}
function login(){
 $('#nav').innerHTML='';$('#account').innerHTML='';
 app.innerHTML=`<div class="narrow"><div class="hero"><span class="eyebrow">Mange bien. Bouge bien.</span><h1>Ton énergie<br>commence ici.</h1><p>Les bons plats, avec ce que tu as déjà.</p></div><form id="login" class="panel"><h2>Bienvenue chez toi</h2><label>Email<input type="email" name="email" autocomplete="username" required></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" required></label><button class="primary">Se connecter</button><small>Accès réservé à vos deux comptes. Mot de passe oublié : réinitialisation depuis le tableau de bord Supabase par le propriétaire.</small></form></div>`;
}
function ideas(){
 const fav=route==='favorites', t=daily();
 app.innerHTML=`<section class="hero"><span class="eyebrow">${fav?'Tes valeurs sûres':'Fuel your everyday'}</span><h1>${fav?'À refaire, sans hésiter.':'Qu’est-ce qu’on mange ?'}</h1><p>Des plats simples, une place pour les protéines, et les ingrédients que tu as.</p></section><section class="toolbar"><div class="row">${profileSelect()}<label>Rechercher un plat<input id="recipe-search" value="${e(search)}" placeholder="Poulet, wrap, brocoli…" type="search"></label><button class="fixed" data-action="new-recipe">＋ Mon plat</button></div>${!t?'<div class="notice">Complète ton profil pour adapter tes portions. Les valeurs affichées sont celles des portions de référence.</div>':''}<div class="chips">${[['protein','Priorité protéines'],['veg','Avec légumes'],['quick','20 min maximum'],['nooven','Sans four']].map(([id,n])=>`<button class="chip ${filters.has(id)?'active':''}" data-action="filter" data-id="${id}" aria-pressed="${filters.has(id)}">${n}</button>`).join('')}<button class="chip accent" data-action="random">✦ Surprends-moi</button></div><p class="muted" style="margin:0">${fav?'Les favoris restent visibles même si un ingrédient manque.':'Uniquement les plats dont tous les ingrédients sont dans tes aliments disponibles.'}</p></section><div id="cards" class="grid"></div>`;
 cards();
}
function shown(){
 const q=search.toLocaleLowerCase('fr');
 return recipes.filter(r=>{
  const n=nutrition(r.lines,foods);
  return (route==='favorites'?!!payload('favorite',active+'_'+r.id)?.yes:feasible(r,stock))&&
   (!q||r.name.toLocaleLowerCase('fr').includes(q)||r.lines.some(l=>foods.find(f=>f.id===l.id)?.name.toLocaleLowerCase('fr').includes(q)))&&
   (!filters.has('protein')||n.p>=25)&&(!filters.has('veg')||r.lines.some(l=>foods.find(f=>f.id===l.id)?.category==='Légumes'))&&
   (!filters.has('quick')||r.prep+r.cook<=20)&&(!filters.has('nooven')||!r.equipment.includes('four'));
 });
}
function cards(){
 const rs=shown();$('#cards').innerHTML=rs.length?rs.map(r=>{
  const n=nutrition(r.lines,foods),fav=payload('favorite',active+'_'+r.id)?.yes;
  return `<article class="card">${safeURL(r.photo)?`<img src="${e(safeURL(r.photo))}" alt="Photo d’ambiance pour ${e(r.name)}" ${r.photoPath?`data-photo="${e(r.photoPath)}"`:""} loading="lazy" referrerpolicy="no-referrer">`:'<div class="empty">✦ Ton prochain bon plat</div>'}<div class="card-body"><div class="row"><small>${r.prep+r.cook} min · ${e(r.equipment)}</small><button class="quiet fixed" data-action="favorite" data-id="${r.id}" aria-label="${fav?'Retirer des':'Ajouter aux'} favoris">${fav?'♥':'♡'}</button></div><h3>${e(r.name)}</h3>${n.p>=25?'<span class="badge">Priorité protéines</span>':''}${!feasible(r,stock)?'<span class="badge">Ingrédients manquants</span>':''}<small>${round(n.kcal)} kcal · ${round(n.p)} g protéines<br>Portion de référence · estimations</small><button class="open primary" data-action="detail" data-id="${r.id}">Choisir mes portions →</button></div></article>`;
 }).join(''):'<div class="empty"><h3>On compose ton prochain repas ?</h3><p>Ajoute tes aliments disponibles, retire un filtre ou crée ton propre plat.</p><button data-action="route" data-route="pantry">Choisir mes aliments</button></div>';
 $('#cards').querySelectorAll('img').forEach(img=>{img.onerror=()=>{img.hidden=true;};if(img.dataset.photo)db.storage.from('fuel-me-photos').createSignedUrl(img.dataset.photo,3600).then(result=>{if(img.isConnected&&!result.error)img.src=result.data.signedUrl;});});
}
function pantry(){
 app.innerHTML=`<h1>Ce que tu as.</h1><p class="muted">Une sélection partagée, conservée entre vos visites. Eau, sel, poivre et huile sont présélectionnés, mais restent modifiables.</p><div class="row section"><label>Chercher un aliment<input id="food-search" type="search" value="${e(foodSearch)}" placeholder="Riz, tomates, tofu…"></label><button class="fixed" data-action="new-food">＋ Aliment</button><button class="fixed" data-action="clear-stock">Tout effacer</button></div><div id="food-list"></div><hr class="divider"><button data-action="food-editor">Gérer les valeurs et mesures des aliments</button><p class="muted">Les conserves sont pesées égouttées. Riz et pâtes : secs. Viandes et légumes : crus, sauf mention contraire.</p>`;
 foodList();
}
function foodList(){
 const fs=foods.filter(f=>f.name.toLocaleLowerCase('fr').includes(foodSearch.toLocaleLowerCase('fr')));
 $('#food-list').innerHTML=[...new Set(fs.map(f=>f.category))].map(c=>`<section class="section"><h3>${e(c)}</h3><div class="chips">${fs.filter(f=>f.category===c).map(f=>`<button class="chip ${stock.has(f.id)?'active':''}" data-action="stock" data-id="${f.id}" aria-pressed="${stock.has(f.id)}">${stock.has(f.id)?'✓ ':''}${e(f.name)}</button>`).join('')}</div></section>`).join('')||'<p>Aucun aliment. Tu peux l’ajouter.</p>';
}
function profiles(){
 app.innerHTML=`<h1>À chacun son énergie.</h1><p>Vos profils sont visibles et modifiables par vous deux.</p><div class="row section">${profileSelect()}<button class="fixed" data-action="profile-edit">Modifier ce profil</button></div><div id="profile-summary"></div>`;
 const t=daily(),p=profile(active);
 $('#profile-summary').innerHTML=!t?'<div class="empty">Complète ton profil pour obtenir une estimation et personnaliser tes repas.</div>':`<div class="panel"><h2>${e(name(active))}</h2><p>${e(p.height)} cm · ${e(p.weight)} kg · ${p.scale?'Avec balance':'Sans balance : mesures approximatives'}</p>${macros(t)}<p class="muted">Entretien estimé : ${t.maintenance} kcal/j · Métabolisme au repos : ${t.bmr} kcal/j.</p><p class="muted">Activité globale, sport compris : ${p.activity}. Séances déclarées : ${e(p.sessions)} × ${e(p.duration)} min/semaine (information de suivi, non ajoutée une seconde fois au calcul).</p><p class="notice">Point de départ estimé, à ajuster avec l’évolution du poids et de l’énergie sur plusieurs semaines. Les portions et besoins ne constituent pas une prescription médicale.</p><h3>Répartition proposée</h3>${Object.entries(labels).map(([k,n])=>`<p>${n} : ${mealTarget(t,k).kcal} kcal · ${mealTarget(t,k).p} g protéines</p>`).join('')}</div>`;
}
function profileEditor(){
 const p=profile(active)||{name:name(active),sex:'f',age:'',height:'',weight:'',activity:1.4,deficit:15,sessions:0,duration:0,scale:true};
 open(`<h2>Ton profil</h2><form id="profile-form"><label>Prénom<input name="name" value="${e(p.name)}" maxlength="50" required></label><div class="row"><label>Âge<input name="age" type="number" min="18" max="100" value="${e(p.age)}" required></label><label>Sexe pour l’équation<select name="sex"><option value="f" ${p.sex==='f'?'selected':''}>Féminin</option><option value="m" ${p.sex==='m'?'selected':''}>Masculin</option></select></label></div><div class="row"><label>Taille (cm)<input name="height" type="number" min="120" max="230" step=".1" value="${e(p.height)}" required></label><label>Poids (kg)<input name="weight" type="number" min="35" max="250" step=".1" value="${e(p.weight)}" required></label></div><label>Objectif de poids facultatif (kg)<input name="goalWeight" type="number" min="35" max="250" step=".1" value="${e(p.goalWeight||'')}"></label><label>Activité totale habituelle, sport compris<select name="activity">${[[1.4,'Peu actif : journée surtout assise'],[1.6,'Modérément actif : marche et sport réguliers'],[1.8,'Actif : beaucoup de mouvement et sport'],[2,'Très actif : travail physique et entraînement soutenu']].map(([v,n])=>`<option value="${v}" ${Number(p.activity)===v?'selected':''}>${n}</option>`).join('')}</select></label><div class="row"><label>Séances / semaine<input type="number" name="sessions" min="0" max="14" value="${p.sessions}"></label><label>Minutes / séance<input type="number" name="duration" min="0" max="300" value="${p.duration}"></label></div><label>Déficit choisi (%)<input name="deficit" type="number" min="0" max="20" value="${p.deficit}" required></label><p class="muted">15 % est un réglage initial de l’application, pas une recommandation individuelle. Ajustement manuel possible.</p><label class="check"><input type="checkbox" name="scale" ${p.scale?'checked':''}>J’ai une balance de cuisine</label><label class="check"><input type="checkbox" name="adultEligible" ${p.adultEligible?'checked':''} required>Je suis adulte, hors grossesse/allaitement ; je peux utiliser un objectif de perte de poids sans restriction médicale connue.</label><details><summary>Personnaliser mes objectifs journaliers</summary><p class="muted">Laisse vide pour le calcul automatique : protéines 1,8 g/kg, lipides 0,8 g/kg et glucides restants. Si tu renseignes les quatre valeurs, elles doivent être cohérentes à ±5 %.</p>${['manualKcal','manualP','manualC','manualF'].map((k,i)=>`<label>${['Calories (kcal)','Protéines (g)','Glucides (g)','Lipides (g)'][i]}<input name="${k}" type="number" min="1" max="${i===0?6000:1000}" value="${e(p[k]||'')}"></label>`).join('')}</details><button class="primary">Enregistrer et calculer</button></form>`);
}
function currentTarget(r,id=active){const t=daily(id);return t?mealTarget(t,slot):nutrition(r.lines,foods);}
function recipeDetail(rid,options={}){
 const r=recipes.find(r=>r.id===rid);if(!r)return;
 detail={rid,couple:options.couple||false,t:options.t||currentTarget(r),t2:options.t2||null};
 const others=members.filter(m=>m.user_id!==active),other=others[0]?.user_id;
 const t2=detail.t2||currentTarget(r,other);detail.t2=t2;
 const missing=r.lines.filter(l=>!stock.has(l.id)).map(l=>foods.find(f=>f.id===l.id).name);
 open(`<h2>${e(r.name)}</h2>${safeURL(r.photo)?`<img class="cover" src="${e(safeURL(r.photo))}" alt="Photo d’ambiance" referrerpolicy="no-referrer"><small>${e(r.photoCredit)}</small>`:''}<p>Préparation ${r.prep} min · Cuisson ${r.cook} min · ${e(r.equipment)}</p>${missing.length?`<p class="notice">Il manque : ${e(missing.join(', '))}. Tu peux quand même prévoir ce plat pour plus tard.</p>`:''}${!daily()?'<p class="notice">Profil incomplet : cible initiale = portion de référence. Complète ton profil pour personnaliser tes besoins.</p>':''}<form id="portion-form"><h3>La cible de ${e(name(active))}</h3>${targetForm(detail.t)}${other?`<label class="check"><input type="checkbox" id="couple" ${detail.couple?'checked':''}>Préparer aussi une portion pour ${e(name(other))}</label>${detail.couple?`<h3>La cible de ${e(name(other))}</h3>${targetForm(t2,'second_')}`:''}`:''}<button class="primary">Adapter les quantités</button></form><div id="portion-result"></div><hr class="divider"><form id="plan-form"><div class="row"><label>Jour<input type="date" name="date" value="${day}" required></label><label>Repas<select name="slot">${Object.entries(labels).map(([k,n])=>`<option value="${k}" ${k===slot?'selected':''}>${n}</option>`).join('')}</select></label></div><button class="accent" style="margin-top:14px">Ajouter au planning</button></form><p class="muted">Aucune consommation automatique : les aliments restent sélectionnés.</p><div class="row"><button data-action="edit-recipe" data-id="${rid}">Modifier ce plat</button>${row('recipe',rid)?`<button data-action="delete-recipe" data-id="${rid}">${RECIPES.some(x=>x.id===rid)?'Restaurer le plat initial':'Supprimer ce plat'}</button>`:''}<label>Remplacer la photo<input id="photo-file" type="file" accept="image/*"></label></div>`);
 updatePortions();
 if(r.photoPath)db.storage.from('fuel-me-photos').createSignedUrl(r.photoPath,3600).then(result=>{if(detail?.rid===rid&&!result.error){const img=modal.querySelector('.cover');if(img)img.src=result.data.signedUrl;}});
 modal.querySelectorAll('img').forEach(img=>img.onerror=()=>img.hidden=true);
}
function updatePortions(){
 const r=recipes.find(r=>r.id===detail.rid),users=[active];if(detail.couple)users.push(members.find(m=>m.user_id!==active).user_id);
 detail.results=users.map((id,i)=>({id,...adapt(r,foods,i?detail.t2:detail.t,profile(id)?.scale??true)}));
 $('#portion-result').innerHTML=detail.results.map((a,i)=>`<section><h3>Portion de ${e(name(a.id))}</h3>${macros(a.n)}<p class="${a.ok?'muted':'notice'}">${a.ok?'Objectifs approchés dans les tolérances.':'Meilleure proposition trouvée dans les limites de portions de cette recette ; objectifs non atteints.'}<br>Écarts : ${round(a.delta.kcal)} kcal · P ${round(a.delta.p,1)} g · G ${round(a.delta.c,1)} g · L ${round(a.delta.f,1)} g.</p>${!(profile(a.id)?.scale??true)?'<p class="muted">Sans balance : mesures ménagères approximatives, valeurs recalculées après arrondi. Calibre les mesures selon tes produits.</p>':''}<ul class="ingredients">${a.lines.map(l=>`<li><span>${e(foods.find(f=>f.id===l.id).name)}</span><span>${e(l.amount)}</span></li>`).join('')}</ul></section>`).join('');
 if(users.length===2){
  const totals=new Map();detail.results.forEach(a=>a.lines.forEach(l=>totals.set(l.id,(totals.get(l.id)||0)+l.g)));
  $('#portion-result').innerHTML+=`<div class="panel"><h3>À préparer pour vous deux</h3><ul class="ingredients">${[...totals].map(([id,g])=>`<li><span>${e(foods.find(f=>f.id===id).name)}</span><span>${round(g)} g au total</span></li>`).join('')}</ul><small>Si vous n’avez pas de balance, additionne les mesures indiquées dans vos deux portions.</small></div>`;
 }
}
function planner(){
 const dates=weekDates(day),entries=list('meal').filter(x=>x.payload.profile===active),t=daily();
 const consumed=entries.filter(x=>x.payload.date===day&&x.payload.status==='consumed').reduce((s,x)=>{for(const k of ['kcal','p','c','f'])s[k]+=x.payload.n[k];return s;},{kcal:0,p:0,c:0,f:0});
 app.innerHTML=`<h1>Ta semaine, bien nourrie.</h1><div class="row section">${profileSelect()}<label>Jour sélectionné<input id="plan-day" type="date" value="${day}"></label><label>Repas pour les prochaines idées<select id="meal-slot">${Object.entries(labels).map(([k,n])=>`<option value="${k}" ${k===slot?'selected':''}>${n}</option>`).join('')}</select></label></div><div class="panel"><h3>Consommé le ${e(new Date(day+'T12:00:00').toLocaleDateString('fr-FR'))}</h3>${macros(consumed)}${t?`<p>Reste sur l’objectif : <strong>${round(t.kcal-consumed.kcal)} kcal</strong> · P ${round(t.p-consumed.p)} g · G ${round(t.c-consumed.c)} g · L ${round(t.f-consumed.f)} g.</p>`:'<p>Complète ton profil pour voir le restant journalier.</p>'}<small>Un nombre négatif indique un dépassement. Les repas prévus ne sont pas comptés comme consommés.</small><div class="row section"><button data-action="manual-meal">＋ Petit déjeuner, collation ou repas extérieur</button><button data-action="catalog">Parcourir tous les plats</button></div></div><div class="week section">${dates.map(d=>`<article class="panel day"><h3>${e(new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'short'}))}</h3>${entries.filter(x=>x.payload.date===d).sort((a,b)=>Object.keys(labels).indexOf(a.payload.slot)-Object.keys(labels).indexOf(b.payload.slot)).map(x=>`<div class="entry"><span class="eyebrow">${labels[x.payload.slot]} · ${x.payload.status==='consumed'?'Consommé':'Prévu'}</span><p><strong>${e(x.payload.name)}</strong></p><small>${round(x.payload.n.kcal)} kcal · ${round(x.payload.n.p)} g protéines</small><div class="row"><button class="quiet" data-action="meal-show" data-id="${x.key}">Portion</button><button class="quiet" data-action="meal-toggle" data-id="${x.key}">${x.payload.status==='consumed'?'Annuler':'✓ Consommé'}</button><button class="quiet danger" data-action="meal-delete" data-id="${x.key}" aria-label="Supprimer ce repas">✕</button></div></div>`).join('')||'<p class="muted">Une page blanche pour tes envies.</p>'}</article>`).join('')}</div>`;
}
function catalogResults(q){$('#catalog-results').innerHTML=recipes.filter(r=>r.name.toLocaleLowerCase('fr').includes(q.toLocaleLowerCase('fr'))).map(r=>`<button data-action="detail" data-id="${r.id}">${e(r.name)} · ${r.prep+r.cook} min ${feasible(r,stock)?'✓':'· ingrédients à prévoir'}</button>`).join('')||'<p>Aucun plat trouvé.</p>';}
function manualMeal(){
 open(`<h2>Ajouter un repas</h2><form id="manual-form"><label>Nom<input name="name" maxlength="100" required placeholder="Petit déjeuner…"></label><div class="row"><label>Date<input type="date" name="date" value="${day}" required></label><label>Moment<select name="slot">${Object.entries(labels).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></label></div>${targetForm({kcal:400,p:25,c:45,f:13},'',true)}<label class="check"><input type="checkbox" name="consumed" checked>Déjà consommé</label><button class="primary">Enregistrer</button></form>`);
}
function foodEditor(id){
 const f=foods.find(f=>f.id===id)||{id:'',name:'',kcal:0,p:0,c:0,f:0,grams:100,step:.5,unit:'portion',category:'Autres',source:'Étiquette personnelle'};
 open(`<h2>${id?'Modifier':'Ajouter'} un aliment</h2>${!id?`<label>Ou modifier un aliment existant<select id="food-edit-select"><option value="">Nouveau…</option>${foods.map(x=>`<option value="${x.id}">${e(x.name)}</option>`).join('')}</select></label>`:''}<form id="food-form" data-id="${e(f.id)}"><label>Nom et état (cru, cuit, égoutté…)<input name="name" value="${e(f.name)}" maxlength="100" required></label><label>Catégorie<select name="category">${[...new Set(foods.map(x=>x.category).concat('Autres'))].map(c=>`<option ${c===f.category?'selected':''}>${e(c)}</option>`).join('')}</select></label><p>Valeurs pour <strong>100 g</strong> : copie celles de ton étiquette.</p>${['kcal','p','c','f'].map((k,i)=>`<label>${['kcal','Protéines (g)','Glucides (g)','Lipides (g)'][i]}<input type="number" name="${k}" min="0" max="${i===0?1000:100}" step=".1" value="${f[k]}" required></label>`).join('')}<label>Nom d’une mesure sans balance<input name="unit" value="${e(f.unit)}" placeholder="cuillère à soupe, tranche, pièce…" required maxlength="50"></label><div class="row"><label>Grammes par mesure<input name="grams" type="number" min=".1" max="2000" step=".1" value="${f.grams}" required></label><label>Pas de mesure<select name="step">${[.25,.5,1].map(v=>`<option value="${v}" ${Number(f.step)===v?'selected':''}>${v===.25?'Quart':v===.5?'Demi':'Entier'}</option>`).join('')}</select></label></div><small>Utilise exactement « pièce » pour les œufs et wraps indivisibles. Ils seront arrondis à l’entier même avec balance.</small><label>Source / marque<input name="source" value="${e(f.source)}" maxlength="200" required></label><button class="primary">Enregistrer</button></form>`);
}
let draftLines=[];
function recipeEditor(id){
 const r=recipes.find(r=>r.id===id)||{id:'',name:'',prep:10,cook:15,equipment:'Plaques',lines:[],photo:'',photoCredit:''};
 draftLines=r.lines.map(l=>({...l}));
 open(`<h2>${id?'Modifier':'Créer'} ton plat</h2><form id="recipe-form" data-id="${r.id}"><label>Nom<input name="name" maxlength="100" value="${e(r.name)}" required></label><div class="row"><label>Préparation (min)<input name="prep" type="number" min="0" max="180" value="${r.prep}" required></label><label>Cuisson (min)<input name="cook" type="number" min="0" max="300" value="${r.cook}" required></label></div><label>Équipement<select name="equipment">${['Plaques','Sans cuisson','Petit four','Plaques + micro-ondes','Plaques + mixeur'].map(v=>`<option ${r.equipment===v?'selected':''}>${v}</option>`).join('')}</select></label><p>Quantités de référence pour <strong>une personne</strong>. Ajoute aussi l’huile, le beurre, les sauces et accompagnements. Eau de cuisson et pincées de sel/poivre peuvent être omises.</p><div id="draft-lines"></div><button type="button" data-action="add-line">＋ Ingrédient</button><label>URL d’une photo HTTPS (facultatif)<input name="photo" type="url" value="${e(r.photo)}"></label><label>Crédit photo<input name="photoCredit" value="${e(r.photoCredit)}" maxlength="200"></label><small>Tu peux aussi enregistrer puis importer une photo depuis ton téléphone.</small><button class="primary">Enregistrer le plat</button></form>`);renderDraft();
}
function renderDraft(){
 $('#draft-lines').innerHTML=draftLines.map((l,i)=>`<div class="ingredient-line section"><label><span class="sr">Aliment</span><select class="draft-food" data-index="${i}">${foods.map(f=>`<option value="${f.id}" ${l.id===f.id?'selected':''}>${e(f.name)}</option>`).join('')}</select></label><label>Grammes<input class="draft-g" data-index="${i}" type="number" min=".1" max="2000" step=".1" value="${l.g}" required></label><button type="button" data-action="remove-line" data-index="${i}" aria-label="Retirer cet ingrédient">✕</button></div>`).join('');
}
async function uploadPhoto(file){
 if(!file)return;assertOnline();if(file.size>20*1024*1024)throw Error('Photo trop volumineuse (20 Mo maximum avant compression).');
 const rid=detail.rid,r=recipes.find(r=>r.id===rid);
 const url=URL.createObjectURL(file);let blob;
 try{
  const img=new Image();img.src=url;await img.decode();const factor=Math.min(1,1200/Math.max(img.width,img.height));
  const canvas=document.createElement('canvas');canvas.width=Math.round(img.width*factor);canvas.height=Math.round(img.height*factor);canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.82));
 }catch{throw Error('Photo illisible. Exporte-la en JPEG/PNG depuis Photos puis réessaie.');}finally{URL.revokeObjectURL(url);}
 if(!blob||blob.size>5*1024*1024)throw Error('Impossible de compresser cette photo sous 5 Mo.');
 const path=CONFIG.space+'/'+crypto.randomUUID()+'.jpg';
 checked(await db.storage.from('fuel-me-photos').upload(path,blob,{contentType:'image/jpeg',upsert:false}));
 try{await save('recipe',rid,{...r,photoPath:path,photoCredit:'Votre photo personnelle',photo:r.photo||'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=900'});}
 catch(err){await db.storage.from('fuel-me-photos').remove([path]);throw err;}
 if(r.photoPath)await db.storage.from('fuel-me-photos').remove([r.photoPath]);
 await reload();recipeDetail(rid);toast('Photo enregistrée.');
}
// Actions déléguées ; tous les contenus saisis sont échappés avant insertion HTML.
document.addEventListener('click',async ev=>{
 const b=ev.target.closest('[data-action]');if(!b||b.disabled)return;
 const a=b.dataset.action,id=b.dataset.id;
 try{
  b.disabled=true;
  if(a==='close')close();
  else if(a==='route'){route=b.dataset.route;render();window.scrollTo({top:0});}
  else if(a==='refresh'){await reload();render();toast('Données actualisées.');}
  else if(a==='logout'){checked(await db.auth.signOut({scope:'local'}));session=null;members=[];rows=[];foods=[];recipes=[];stock.clear();close();render();}
  else if(a==='filter'){filters.has(id)?filters.delete(id):filters.add(id);ideas();}
  else if(a==='random'){const rs=shown();if(!rs.length)toast('Aucun plat disponible avec cette sélection.');else recipeDetail(rs[Math.floor(Math.random()*rs.length)].id);}
  else if(a==='detail')recipeDetail(id);
  else if(a==='favorite'){await save('favorite',active+'_'+id,{yes:!payload('favorite',active+'_'+id)?.yes});cards();}
  else if(a==='stock'){await save('stock',id,{selected:!stock.has(id)});await reload();foodList();}
  else if(a==='clear-stock'){
   if(!confirm('Effacer la sélection partagée, basiques compris ?'))return;
   const changes=foods.map(f=>{const old=row('stock',f.id);return {space_id:CONFIG.space,kind:'stock',key:f.id,payload:{selected:false},rev:(old?.rev||0)+1};});
   // Action globale explicite : le dernier effacement l’emporte sur la sélection.
   assertOnline();checked(await db.from('fuel_items').upsert(changes));await reload();pantry();
  }
  else if(a==='profile-edit')profileEditor();
  else if(a==='new-food'||a==='food-editor')foodEditor();
  else if(a==='new-recipe')recipeEditor();
  else if(a==='edit-recipe')recipeEditor(id);
  else if(a==='delete-recipe'){
   if(!confirm('Supprimer ce plat personnel ou restaurer la version initiale ? Les repas déjà planifiés restent conservés.'))return;
   const oldPhoto=payload('recipe',id)?.photoPath;await remove('recipe',id);if(oldPhoto)checked(await db.storage.from('fuel-me-photos').remove([oldPhoto]));close();await reload();render();
  }
  else if(a==='add-line'){draftLines.push({id:foods[0].id,g:100});renderDraft();}
  else if(a==='remove-line'){draftLines.splice(Number(b.dataset.index),1);renderDraft();}
  else if(a==='catalog'){open('<h2>Choisir un plat pour plus tard</h2><p>Tout le catalogue est accessible pour planifier, même si des ingrédients manquent.</p><label>Rechercher<input id="catalog-search" type="search" placeholder="Nom du plat…"></label><div id="catalog-results" class="stack section"></div>');catalogResults('');}
  else if(a==='manual-meal')manualMeal();
  else if(a==='meal-toggle'){const p=payload('meal',id);await save('meal',id,{...p,status:p.status==='consumed'?'planned':'consumed'});planner();}
  else if(a==='meal-delete'){if(confirm('Supprimer ce repas du planning ?')){await remove('meal',id);planner();}}
  else if(a==='meal-show'){
   const p=payload('meal',id);open(`<h2>${e(p.name)}</h2><p>${e(name(p.profile))} · ${e(p.date)} · ${labels[p.slot]}</p>${macros(p.n)}<ul class="ingredients">${(p.lines||[]).map(l=>`<li><span>${e(l.name)}</span><span>${e(l.amount)}</span></li>`).join('')}</ul><small>Portion figée au moment de la planification. Les modifications ultérieures d’aliments ou de recettes ne changent pas cet historique.</small>`);
  }
 }catch(err){fail(err);}finally{if(b.isConnected)b.disabled=false;}
});
document.addEventListener('input',ev=>{
 const t=ev.target;
 if(t.id==='recipe-search'){search=t.value;cards();}
 if(t.id==='food-search'){foodSearch=t.value;foodList();}
 if(t.id==='catalog-search')catalogResults(t.value);
 if(t.classList.contains('draft-g'))draftLines[Number(t.dataset.index)].g=Number(t.value);
});
document.addEventListener('change',async ev=>{
 const t=ev.target;
 try{
  if(t.id==='active-profile'){active=t.value;localStorage.setItem('fuel-profile',active);render();}
  if(t.id==='plan-day'){day=t.value||isoDate();planner();}
  if(t.id==='meal-slot'){slot=t.value;planner();}
  if(t.id==='food-edit-select'&&t.value)foodEditor(t.value);
  if(t.classList.contains('draft-food'))draftLines[Number(t.dataset.index)].id=t.value;
  if(t.id==='couple'){
   const fd=new FormData($('#portion-form'));detail.t=readTarget(fd);recipeDetail(detail.rid,{...detail,couple:t.checked});
  }
  if(t.id==='photo-file'){t.disabled=true;await uploadPhoto(t.files[0]);}
 }catch(err){fail(err);if(t.id==='photo-file')t.disabled=false;}
});
document.addEventListener('submit',async ev=>{
 ev.preventDefault();const form=ev.target,fd=new FormData(form),button=form.querySelector('button[type="submit"],button.primary,button.accent');
 try{
  if(button)button.disabled=true;
  if(form.id==='login'){
   const result=await db.auth.signInWithPassword({email:String(fd.get('email')).trim(),password:String(fd.get('password'))});
   session=checked(result).session;active=localStorage.getItem('fuel-profile')||session.user.id;await reload();render();
  }
  else if(form.id==='profile-form'){
   const p={name:String(fd.get('name')).trim(),sex:fd.get('sex'),scale:fd.has('scale'),adultEligible:fd.has('adultEligible')};
   for(const k of ['age','height','weight','goalWeight','activity','sessions','duration','deficit','manualKcal','manualP','manualC','manualF'])p[k]=num(fd,k);
   targets(p);await save('profile',active,p);close();render();toast('Profil et objectifs enregistrés.');
  }
  else if(form.id==='portion-form'){detail.t=readTarget(fd);if(detail.couple)detail.t2=readTarget(fd,'second_');updatePortions();}
  else if(form.id==='plan-form'){
   const portionFd=new FormData($('#portion-form'));detail.t=readTarget(portionFd);if(detail.couple)detail.t2=readTarget(portionFd,'second_');updatePortions();
   const r=recipes.find(r=>r.id===detail.rid);
   const inserts=detail.results.map(a=>({space_id:CONFIG.space,kind:'meal',key:crypto.randomUUID(),payload:{profile:a.id,date:fd.get('date'),slot:fd.get('slot'),name:r.name,recipe:r.id,status:'planned',n:a.n,lines:a.lines.map(l=>({...l,name:foods.find(f=>f.id===l.id).name}))}}));
   assertOnline();checked(await db.from('fuel_items').insert(inserts));close();await reload();route='planner';day=String(fd.get('date'));render();toast('Repas ajouté au planning.');
  }
  else if(form.id==='manual-form'){
   const n=readTarget(fd,'',true);await save('meal',crypto.randomUUID(),{profile:active,date:fd.get('date'),slot:fd.get('slot'),name:String(fd.get('name')).trim(),status:fd.has('consumed')?'consumed':'planned',n,lines:[]});close();planner();
  }
  else if(form.id==='food-form'){
   const f={id:form.dataset.id||'f_'+crypto.randomUUID(),name:String(fd.get('name')).trim(),category:fd.get('category'),unit:String(fd.get('unit')).trim(),source:String(fd.get('source')).trim()};
   for(const k of ['kcal','p','c','f','grams','step'])f[k]=num(fd,k);
   if(!f.name||f.grams<=0||f.step<=0||[f.kcal,f.p,f.c,f.f].some(v=>v<0||!Number.isFinite(v)))throw Error('Valeurs alimentaires invalides.');
   await save('food',f.id,f);close();await reload();render();toast('Aliment enregistré.');
  }
  else if(form.id==='recipe-form'){
   if(!draftLines.length||draftLines.some(l=>l.g<=0||!Number.isFinite(l.g)))throw Error('Ajoute au moins un ingrédient avec une quantité valide.');
   if(new Set(draftLines.map(l=>l.id)).size!==draftLines.length)throw Error('Chaque aliment ne doit apparaître qu’une fois.');
   const id=form.dataset.id||'custom_'+crypto.randomUUID(),old=recipes.find(r=>r.id===id),photo=String(fd.get('photo')||'');
   if(photo&&!safeURL(photo))throw Error('La photo doit utiliser une URL HTTPS.');
   const r={id,name:String(fd.get('name')).trim(),prep:num(fd,'prep'),cook:num(fd,'cook'),equipment:fd.get('equipment'),lines:draftLines.map(l=>({...l})),photo:photo||'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=75',photoCredit:String(fd.get('photoCredit')||'Photo d’ambiance Unsplash — ne représente pas nécessairement ce plat'),...(old?.photoPath?{photoPath:old.photoPath}:{})};
   await save('recipe',id,r);close();await reload();render();toast('Plat enregistré. Il apparaîtra dès que ses ingrédients seront disponibles.');
  }
 }catch(err){fail(err);}finally{if(button?.isConnected)button.disabled=false;}
});
async function start(){
 try{
  if(CONFIG.url.includes('TON-PROJET')||CONFIG.key.includes('TA_CLE'))throw Error('Renseigne config.js avec l’URL et la clé publique Supabase, puis recharge.');
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  db=createClient(CONFIG.url,CONFIG.key,{auth:{storageKey:'fuel-me-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  session=checked(await db.auth.getSession()).session;active=localStorage.getItem('fuel-profile')||session?.user.id||'';
  if(session)await reload();render();
  db.auth.onAuthStateChange((event,s)=>{session=s;if(event==='SIGNED_OUT'){rows=[];members=[];foods=[];recipes=[];stock.clear();close();render();}});
  setInterval(async()=>{if(session&&!editing&&!polling&&document.visibilityState==='visible'&&navigator.onLine){polling=true;try{await reload();if(route==='ideas'||route==='favorites')cards();else if(route==='pantry')foodList();else if(!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))render();}catch(err){console.warn(err.message);}finally{polling=false;}}},15000);
  window.addEventListener('focus',()=>{if(session&&!editing)reload().catch(fail);});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
 }catch(err){app.innerHTML=`<div class="panel narrow"><h2>Un réglage à terminer</h2><p>${e(err.message)}</p><p>Consulte le guide puis recharge la page.</p></div>`;}
}
start();
