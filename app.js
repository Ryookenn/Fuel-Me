import {CONFIG} from './config.js';
import {FOODS,RECIPES} from './data.js';
import {nutrition,targets,mealTarget,adapt,feasible,round,isoDate,weekDates,energy,evaluatePortion,portionStep} from './engine.js';
const $=s=>document.querySelector(s), e=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeURL=u=>{try{const x=new URL(u);return x.protocol==='https:'?x.href:'';}catch{return '';}};
const app=$('#app'), modal=$('#modal');
let db,session,members=[],rows=[],foods=[],recipes=[],stock=new Set(),route='ideas',active='',search='',foodSearch='',filters=new Set(),detail=null,polling=false,editing=false;
let day=isoDate(),slot='lunch',timer,refreshBusy=false,lastFocus=null;
let dataSignature='',lastChanged=true;
const signedPhotos=new Map();
const labels={breakfast:'Petit déjeuner',lunch:'Déjeuner',dinner:'Dîner',snack:'Collation'};
const num=(fd,k)=>Number(fd.get(k)||0);
const list=kind=>rows.filter(x=>x.kind===kind);
const row=(kind,key)=>rows.find(x=>x.kind===kind&&x.key===key);
const payload=(kind,key)=>row(kind,key)?.payload;
const name=id=>payload('profile',id)?.name||members.find(m=>m.user_id===id)?.display_name||'Profil';
const profile=id=>payload('profile',id);
function daily(id=active){try{return targets(profile(id)||{});}catch{return null;}}
function toast(text){
 clearTimeout(timer);
 if(modal.open){
  if(!modal.querySelector('.dialog-feedback'))modal.insertAdjacentHTML('beforeend','<div class="dialog-feedback" role="status" aria-live="polite"></div>');
  const message=modal.querySelector('.dialog-feedback');message.textContent=text;message.hidden=false;
  timer=setTimeout(()=>{if(message.isConnected)message.hidden=true;},5500);
 }else{$('#toast').textContent=text;$('#toast').style.display='block';timer=setTimeout(()=>$('#toast').style.display='none',5000);}
}
function fail(err){console.error(err);toast(err.message||'Une erreur est survenue.');}
function assertOnline(){if(!navigator.onLine)throw Error('Connexion nécessaire : aucune modification hors ligne n’est enregistrée.');}
function checked(result){if(result.error)throw result.error;return result.data;}
async function reload(){
 if(refreshBusy)return;refreshBusy=true;
 try{
  const [a,b]=await Promise.all([db.from('fuel_members').select('*').eq('space_id',CONFIG.space),db.from('fuel_items').select('*').eq('space_id',CONFIG.space)]);
  const nextMembers=checked(a)||[],nextRows=checked(b)||[];
  const signature=JSON.stringify([nextMembers,nextRows]);lastChanged=signature!==dataSignature;dataSignature=signature;
  members=nextMembers;rows=nextRows.map(x=>x.kind==='meal'&&x.payload.n?{...x,payload:{...x.payload,n:{...x.payload.n,kcal:energy(x.payload.n)}}}:x);
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

const iconPaths={
 spark:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
 pantry:'<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M5 10h14M8 6v1M8 14v3"/>',
 heart:'<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
 calendar:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h2M14 15h2"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
 arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 check:'<path d="m5 12 4 4L19 6"/>',
 close:'<path d="m6 6 12 12M6 18 18 6"/>',
 refresh:'<path d="M20 7v5h-5M4 17v-5h5M6.1 7a7 7 0 0 1 11.6-2L20 8M4 16l2.3 3A7 7 0 0 0 18 17"/>',
 logout:'<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m6-15 5 7-5 7m-8-7h13"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 leaf:'<path d="M20 3C10 2 3 6 4 14c1 8 13 9 16-11ZM4 20l10-10"/>',
 flame:'<path d="M12 3c0 6-5 6-5 10a5 5 0 0 0 10 0c0-2-1-4-2-5 0 3-2 3-2 3 1-5-1-8-1-8Z"/>',
 chevron:'<path d="m9 6 6 6-6 6"/>',
 minus:'<path d="M5 12h14"/>',
 scale:'<path d="M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2Z"/><path d="M8 9a5 5 0 0 1 8 0m-4 3 2-3"/>',
 dish:'<path d="M3 15h18M5 15a7 7 0 0 1 14 0M12 5v3M3 19h18"/>'
};
const icon=(id,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[id]||iconPaths.spark}</svg>`;
const signed=n=>`${n>0?'+':''}${round(n,1)}`;
function macroReference(t){return `<div class="energy-reference">${icon('flame')}<div><span>Repère énergétique du repas</span><strong>${round(t.kcal)} <small>kcal</small></strong></div><span class="reference-note">Calculé depuis ton profil.<br>Il ne pilote pas les portions.</span></div>`;}
function derivedOutput(t,label='Énergie calculée à partir des macros',id=''){
 return `<div class="derived-energy"><span>${icon('flame')}${label}</span><output ${id?`id="${id}"`:''}>${round(energy(t))} <small>kcal</small></output></div>`;
}
function hydratePhotos(root){
 root.querySelectorAll('img').forEach(img=>{
  img.onerror=()=>{img.hidden=true;};const path=img.dataset.photo;if(!path)return;
  const cached=signedPhotos.get(path);if(cached&&cached.until>Date.now()){img.src=cached.url;return;}
  db.storage.from('fuel-me-photos').createSignedUrl(path,3600).then(r=>{if(!r.error){signedPhotos.set(path,{url:r.data.signedUrl,until:Date.now()+3300000});if(img.isConnected)img.src=r.data.signedUrl;}});
 });
}

function targetForm(t,prefix='',manual=false){
 return `<div class="macro-inputs">${[['p','Protéines','P'],['c','Glucides','G'],['f','Lipides','L']].map(([k,n,letter])=>`<label class="macro-field macro-${k}"><span><i>${letter}</i>${n}</span><div class="input-unit"><input name="${prefix+k}" type="number" inputmode="decimal" min="0" max="${manual==='food'?100:1500}" step=".1" value="${round(t[k],1)}" required><span>g</span></div></label>`).join('')}</div>${derivedOutput(t,manual==='food'?'Énergie calculée pour 100 g':manual?'Calories du repas · calcul automatique':'Énergie correspondant aux macros choisies')}`;
}

function readTarget(fd,prefix='',manual=false){
 const t=Object.fromEntries(['p','c','f'].map(k=>[k,num(fd,prefix+k)]));
 if(['p','c','f'].some(k=>!Number.isFinite(t[k])||t[k]<0||t[k]>1500)||t.p+t.c+t.f<=0)
  throw Error('Renseigne des macros positives ou nulles, avec au moins une valeur supérieure à zéro.');
 return {...t,kcal:energy(t)};
}

function macros(n){return `<div class="nutri"><div class="metric metric-energy"><span>${icon('flame')}Énergie</span><strong>${round(n.kcal)}<small> kcal</small></strong></div>${[['p','Protéines'],['c','Glucides'],['f','Lipides']].map(([k,label])=>`<div class="metric metric-${k}"><span><i class="macro-dot"></i>${label}</span><strong>${round(n[k],1)}<small> g</small></strong></div>`).join('')}</div>`;}

function open(html){
 if(!modal.open)lastFocus=document.activeElement;
 editing=true;modal.innerHTML=`<button type="button" class="close icon-button" data-action="close" aria-label="Fermer">${icon('close')}</button><div class="modal-content">${html}</div>`;
 if(!modal.open)modal.showModal();modal.scrollTop=0;
}

function close(){modal.close();editing=false;detail=null;}
modal.addEventListener('close',()=>{editing=false;detail=null;lastFocus?.focus?.();});
modal.addEventListener('click',ev=>{if(ev.target===modal){const r=modal.getBoundingClientRect();if(ev.clientX<r.left||ev.clientX>r.right||ev.clientY<r.top||ev.clientY>r.bottom)close();}});

function shell(){
 document.body.dataset.auth='yes';
 const current={ideas:'À la carte',pantry:'Mes aliments',favorites:'Mes favoris',planner:'Mon planning',profiles:'Nos profils'}[route];
 $('#account').innerHTML=`<span class="connection-status"><i></i>Synchronisé</span><button class="icon-button" data-action="refresh" aria-label="Actualiser" title="Actualiser">${icon('refresh')}</button><button class="account-avatar" data-action="route" data-route="profiles" aria-label="Ouvrir les profils">${e(name(active).slice(0,1).toUpperCase())}</button><button class="icon-button logout-button" data-action="logout" aria-label="Se déconnecter" title="Se déconnecter">${icon('logout')}</button>`;
 $('#page-context').textContent=current;
 const t=daily();
 $('#nav').innerHTML=`<a class="nav-brand" href="#" data-action="route" data-route="ideas">Fuel me<span>●</span></a><span class="nav-caption">TON QUOTIDIEN</span><div class="nav-links">${[['ideas','spark','Idées'],['pantry','pantry','Aliments'],['favorites','heart','Favoris'],['planner','calendar','Planning'],['profiles','user','Profils']].map(([r,i,n])=>`<button data-action="route" data-route="${r}" class="nav-link ${route===r?'active':''}" ${route===r?'aria-current="page"':''}><span class="nav-icon">${icon(i)}</span><span class="nav-label">${n}</span>${icon('chevron','nav-chevron')}</button>`).join('')}</div><div class="nav-bottom"><div class="nav-profile"><span class="account-avatar">${e(name(active).slice(0,1).toUpperCase())}</span><div><strong>${e(name(active))}</strong><small>${t?round(t.kcal)+' kcal · repère / jour':'Ton énergie, à ton rythme'}</small></div></div><span class="nav-footnote">Un peu de préparation.<br>Beaucoup de bonnes habitudes.</span></div>`;
}

function profileSelect(){return `<label class="profile-select"><span>Le profil</span><select id="active-profile">${members.map(m=>`<option value="${m.user_id}" ${active===m.user_id?'selected':''}>${e(name(m.user_id))}</option>`).join('')}</select></label>`;}

function render(){
 if(!session)return login();shell();
 if(route==='pantry')return pantry();if(route==='profiles')return profiles();if(route==='planner')return planner();
 ideas();
}
function login(){
 document.body.dataset.auth='no';$('#nav').innerHTML='';$('#account').innerHTML='';$('#page-context').textContent='';
 app.innerHTML=`<section class="login-layout"><div class="login-story"><span class="eyebrow">BIEN MANGER. SE SENTIR BIEN.</span><h1>Le plein<br>de bonnes<br><em>habitudes.</em></h1><p>Des idées à ton goût. Des portions pour toi.<br>Et le plaisir de cuisiner ce que tu as déjà.</p><div class="login-signature">${icon('leaf')} Simple, savoureux, à ton rythme.</div></div><div class="login-form-wrap"><form id="login" class="panel"><span class="eyebrow">TON ESPACE PARTAGÉ</span><h2>Content de te retrouver.</h2><p class="muted">Connecte-toi pour retrouver tes envies.</p><label>Email<input type="email" name="email" autocomplete="username" placeholder="toi@exemple.fr" required></label><label>Mot de passe<input name="password" type="password" autocomplete="current-password" placeholder="Ton mot de passe" required></label><button class="primary">Entrer dans Fuel me ${icon('arrow')}</button><small class="login-help">Vos deux comptes, un espace commun.<br>Pour réinitialiser un mot de passe, passe par le propriétaire du projet Supabase.</small></form></div></section>`;
}

function ideas(){
 const fav=route==='favorites',t=daily();
 app.innerHTML=`<section class="hero"><div class="hero-copy"><span class="eyebrow">${fav?'LES ENVIES QUI RESTENT':'LA BONNE ÉNERGIE, CHAQUE JOUR'}</span><h1>${fav?'Tes valeurs sûres.<br><em>Toujours une bonne idée.</em>':'De bonnes idées.<br><em>Avec ce que tu as.</em>'}</h1><p>${fav?'Retrouve les plats que tu aimes, et adapte-les à ta journée.':'Moins de « qu’est-ce qu’on mange ? ».<br>Plus de plats simples, savoureux et faits pour toi.'}</p><div class="hero-pills"><span>${icon('pantry')}${stock.size} aliments disponibles</span><span>${icon('leaf')}Le quotidien, bien nourri</span></div></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="orbit orbit-two"></div><div class="plate"><div class="plate-inner"><span class="plate-leaf leaf-one"></span><span class="plate-leaf leaf-two"></span><span class="plate-leaf leaf-three"></span><span class="plate-grain grain-one"></span><span class="plate-grain grain-two"></span><span class="plate-grain grain-three"></span><span class="plate-tomato"></span><span class="plate-protein"></span></div></div><div class="art-label">${icon('spark')}À ton goût. À ton rythme.</div></div></section><section class="toolbar"><div class="browse-controls">${profileSelect()}<label class="search-field"><span>Trouver ton prochain plat</span><input id="recipe-search" value="${e(search)}" placeholder="Un plat, un ingrédient, une envie…" type="search"></label><button class="secondary" data-action="new-recipe">${icon('plus')}Mon plat</button></div>${!t?`<div class="inline-callout">${icon('user')}<span>Complète ton profil pour des portions adaptées à toi.</span><button class="text-button" data-action="route" data-route="profiles">C’est parti ${icon('arrow')}</button></div>`:''}<div class="filter-bar"><div class="chips">${[['protein','Priorité protéines'],['veg','Avec légumes'],['quick','20 min max'],['nooven','Sans four']].map(([id,n])=>`<button class="chip ${filters.has(id)?'active':''}" data-action="filter" data-id="${id}" aria-pressed="${filters.has(id)}">${filters.has(id)?icon('check'):''}${n}</button>`).join('')}</div><button class="accent surprise" data-action="random">${icon('spark')}Surprends-moi</button></div></section><section class="results-heading"><div><span class="eyebrow">${fav?'TA SÉLECTION':'À LA CARTE'}</span><h2>${fav?'À refaire sans hésiter':'À cuisiner aujourd’hui'} <span id="results-count"></span></h2></div><p>${fav?'Tes favoris, même quand il manque un ingrédient.':'Tous les ingrédients sont dans ta sélection.'}</p></section><div id="cards" class="grid"></div>`;
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
 const rs=shown();if($('#results-count'))$('#results-count').textContent=rs.length;
 $('#cards').innerHTML=rs.length?rs.map(r=>{
  const n=nutrition(r.lines,foods),fav=payload('favorite',active+'_'+r.id)?.yes;
  return `<article class="card"><div class="card-visual">${safeURL(r.photo)?`<img src="${e(safeURL(r.photo))}" alt="Photo d’ambiance pour ${e(r.name)}" ${r.photoPath?`data-photo="${e(r.photoPath)}"`:''} loading="lazy" referrerpolicy="no-referrer">`:`<div class="card-placeholder">${icon('dish')}</div>`}<button class="favorite-button ${fav?'is-favorite':''}" data-action="favorite" data-id="${r.id}" aria-pressed="${!!fav}" aria-label="${fav?'Retirer des':'Ajouter aux'} favoris">${icon('heart')}</button><span class="time-tag">${icon('clock')}${r.prep+r.cook} min</span></div><div class="card-body"><div class="card-kicker">${e(r.equipment)}${n.p>=25?'<span>• Protéiné</span>':''}</div><h3>${e(r.name)}</h3>${!feasible(r,stock)?'<span class="badge">Ingrédients à prévoir</span>':''}<div class="card-nutrition"><strong>${round(n.kcal)} <span>kcal</span></strong><span><b>${round(n.p)}</b> g protéines</span></div><div class="card-macros"><span><i class="dot dot-p"></i>P ${round(n.p)} g</span><span><i class="dot dot-c"></i>G ${round(n.c)} g</span><span><i class="dot dot-f"></i>L ${round(n.f)} g</span></div><button class="open primary" data-action="detail" data-id="${r.id}">Composer ma portion ${icon('arrow')}</button><small class="reference-caption">Portion de référence · valeurs estimées</small></div></article>`;
 }).join(''):`<div class="empty"><div class="empty-icon">${icon('dish')}</div><span class="eyebrow">ON COMMENCE PAR L’ESSENTIEL</span><h3>Ton prochain bon plat<br>commence ici.</h3><p>Choisis les aliments que tu as chez toi.<br>On s’occupe de trouver les idées.</p><button class="primary" data-action="route" data-route="pantry">${icon('plus')}Choisir mes aliments</button></div>`;
 hydratePhotos($('#cards'));
}

function pantry(){
 app.innerHTML=`<section class="page-heading"><span class="eyebrow">DANS TES PLACARDS</span><h1>Un peu de tout.<br><em>Plein de possibilités.</em></h1><p class="muted">Sélectionne ce que tu as. Vos aliments sont partagés et conservés.</p></section><div class="pantry-controls"><label class="search-field"><span>Rechercher un aliment</span><input id="food-search" type="search" value="${e(foodSearch)}" placeholder="Riz, tomates, tofu…"></label><button class="primary" data-action="new-food">${icon('plus')}Un aliment</button><button class="text-button danger" data-action="clear-stock">Tout effacer</button></div><div class="pantry-count"><span id="stock-count">${stock.size} aliments sélectionnés</span><small>Un clic pour ajouter, un clic pour retirer.</small></div><div id="food-list"></div><div class="panel pantry-settings"><div>${icon('scale')}<strong>Des repères qui te ressemblent</strong><p class="muted">Vérifie les macros et les mesures selon tes produits.</p></div><button class="secondary" data-action="food-editor">Gérer mes aliments ${icon('arrow')}</button></div><p class="muted footnote">Eau, sel, poivre et huile restent modifiables. Conserves égouttées, pâtes et riz secs, viandes et légumes crus sauf mention contraire.</p>`;
 foodList();
}

function foodList(){
 const fs=foods.filter(f=>f.name.toLocaleLowerCase('fr').includes(foodSearch.toLocaleLowerCase('fr')));
 if($('#stock-count'))$('#stock-count').textContent=`${stock.size} aliments sélectionnés`;
 $('#food-list').innerHTML=[...new Set(fs.map(f=>f.category))].map(c=>`<section class="food-category"><div class="category-heading"><h3>${e(c)}</h3><span>${fs.filter(f=>f.category===c&&stock.has(f.id)).length} sélectionné(s)</span></div><div class="food-options">${fs.filter(f=>f.category===c).map(f=>`<button class="food-option ${stock.has(f.id)?'active':''}" data-action="stock" data-id="${f.id}" aria-pressed="${stock.has(f.id)}"><span>${e(f.name)}</span><i class="food-check">${icon('check')}</i></button>`).join('')}</div></section>`).join('')||'<div class="empty"><h3>Pas encore dans tes placards ?</h3><p>Ajoute cet aliment pour enrichir votre catalogue.</p><button data-action="new-food">Ajouter un aliment</button></div>';
}

function profiles(){
 app.innerHTML=`<section class="page-heading"><span class="eyebrow">À CHACUN SON ÉNERGIE</span><h1>Ton rythme.<br><em>Tes repères.</em></h1><p class="muted">Vos profils sont partagés. Chaque objectif garde son indépendance.</p></section><div class="profile-toolbar">${profileSelect()}<button class="primary" data-action="profile-edit">Ajuster mon profil ${icon('arrow')}</button></div><div id="profile-summary"></div><div class="profile-actions"><button class="text-button" data-action="logout">${icon('logout')}Se déconnecter</button></div>`;
 const t=daily(),p=profile(active);
 $('#profile-summary').innerHTML=!t?`<div class="empty"><div class="empty-icon">${icon('user')}</div><h3>Faisons connaissance.</h3><p>Quelques informations pour estimer tes repères<br>et composer des portions qui te correspondent.</p><button class="primary" data-action="profile-edit">Compléter mon profil ${icon('arrow')}</button></div>`:`<div class="profile-layout"><section class="panel profile-overview"><div class="profile-title"><span class="large-avatar">${e(name(active).slice(0,1))}</span><div><span class="eyebrow">TES REPÈRES QUOTIDIENS</span><h2>${e(name(active))}</h2><p>${e(p.height)} cm · ${e(p.weight)} kg <span class="badge">${p.scale?'Avec balance':'Sans balance'}</span></p></div></div>${macros(t)}<div class="independent-note">${icon('spark')}<div><strong>Des repères indépendants.</strong><p>Calories : dépense estimée et déficit. Chaque macro : son propre repère. Aucune valeur n’est ajustée pour compenser une autre.</p></div></div><div class="energy-comparison"><div><small>Repère énergétique</small><strong>${t.kcal} kcal</strong></div><div><small>Énergie des repères macros</small><strong>${round(t.macroKcal)} kcal</strong></div></div><p class="muted footnote">Les deux peuvent différer. Pour tes repas, tu choisis les macros ; l’énergie découle des ingrédients et de leurs quantités.</p><details class="calculation-details"><summary>Comprendre mes repères</summary><p>Repos : ${t.bmr} kcal/j · Entretien estimé : ${t.maintenance} kcal/j · Déficit : ${e(p.deficit??15)} %.</p><p>Activité globale : ${e(p.activity)}, sport compris. ${e(p.sessions||0)} séance(s) de ${e(p.duration||0)} min/semaine, sans ajout calorique automatique.</p><p>Les valeurs sont des estimations de départ, à individualiser selon ton évolution et ton entraînement. Elles ne constituent pas des besoins « idéaux » universels.</p></details></section><aside class="panel meal-breakdown"><span class="eyebrow">LA JOURNÉE EN QUATRE TEMPS</span><h3>À ton rythme.</h3>${Object.entries(labels).map(([k,n])=>{const m=mealTarget(t,k);return `<div class="meal-share"><div><strong>${n}</strong><span>${m.kcal} kcal · repère</span></div><small>P ${m.p} g · G ${m.c} g · L ${m.f} g</small></div>`;}).join('')}<p class="muted footnote">Une proposition de répartition. Les macros restent ajustables dans chaque plat.</p></aside></div>`;
}

function profileEditor(){
 const p=profile(active)||{name:name(active),sex:'f',age:'',height:'',weight:'',activity:1.4,deficit:15,sessions:0,duration:0,scale:true};
 open(`<span class="eyebrow">FAIT POUR TOI</span><h2>Ton profil, ton énergie.</h2><p class="muted">Des repères personnalisés, sans rééquilibrage automatique entre les macros.</p><form id="profile-form"><label>Prénom<input name="name" value="${e(p.name)}" maxlength="50" required></label><div class="form-grid"><label>Âge<input name="age" type="number" inputmode="numeric" min="18" max="100" value="${e(p.age)}" required></label><label>Sexe pour l’équation<select name="sex"><option value="f" ${p.sex==='f'?'selected':''}>Féminin</option><option value="m" ${p.sex==='m'?'selected':''}>Masculin</option></select></label><label>Taille (cm)<input name="height" type="number" inputmode="decimal" min="120" max="230" step=".1" value="${e(p.height)}" required></label><label>Poids (kg)<input name="weight" type="number" inputmode="decimal" min="35" max="250" step=".1" value="${e(p.weight)}" required></label></div><label>Objectif de poids facultatif (kg)<input name="goalWeight" type="number" inputmode="decimal" min="35" max="250" step=".1" value="${e(p.goalWeight||'')}"></label><label>Activité habituelle, sport compris<select name="activity">${[[1.4,'Peu actif · journée surtout assise'],[1.6,'Modérément actif · marche et sport réguliers'],[1.8,'Actif · beaucoup de mouvement et sport'],[2,'Très actif · travail physique et entraînement soutenu']].map(([v,n])=>`<option value="${v}" ${Number(p.activity)===v?'selected':''}>${n}</option>`).join('')}</select></label><div class="form-grid"><label>Séances / semaine<input type="number" name="sessions" min="0" max="14" value="${p.sessions||0}"></label><label>Minutes / séance<input type="number" name="duration" min="0" max="300" value="${p.duration||0}"></label></div><label>Déficit choisi (%)<input name="deficit" type="number" min="0" max="20" value="${p.deficit??15}" required><small>Le repère calorique en découle automatiquement. 15 % est un réglage de départ, pas une prescription.</small></label><div class="toggle-card"><div>${icon('scale')}<span><strong>J’ai une balance de cuisine</strong><small>Sinon, on utilise des mesures ménagères.</small></span></div><label class="switch"><input type="checkbox" name="scale" ${p.scale?'checked':''}><span aria-hidden="true"></span><span class="sr">J’ai une balance de cuisine</span></label></div><section class="form-section"><h3>Trois macros. Trois repères.</h3><p class="muted">Chaque quantité se calcule à partir du poids, indépendamment des calories et des autres macros.</p><div class="macro-inputs">${[['proteinRatio','Protéines',1.8,'p'],['carbRatio','Glucides',3,'c'],['fatRatio','Lipides',.8,'f']].map(([k,n,v,macro])=>`<label class="macro-field macro-${macro}"><span>${n}</span><div class="input-unit"><input name="${k}" type="number" inputmode="decimal" min=".1" max="10" step=".1" value="${p[k]??v}" required><span>g/kg</span></div></label>`).join('')}</div><small class="muted">Réglages initiaux : P 1,8 · G 3 · L 0,8 g/kg. À ajuster selon tes besoins et ton entraînement.</small></section><details class="calculation-details"><summary>Définir une macro précise en g/j</summary><p class="muted">Facultatif : la valeur remplace uniquement son propre repère. Laisse vide pour utiliser le coefficient g/kg.</p><div class="macro-inputs">${[['manualP','Protéines'],['manualC','Glucides'],['manualF','Lipides']].map(([k,n])=>`<label>${n} (g/j)<input name="${k}" type="number" min="1" max="1500" step=".1" value="${e(p[k]||'')}"></label>`).join('')}</div></details><label class="check eligibility"><input type="checkbox" name="adultEligible" ${p.adultEligible?'checked':''} required><span>Je suis adulte, hors grossesse/allaitement, sans restriction médicale connue pour cet objectif.</span></label><button class="primary">Enregistrer mes repères ${icon('check')}</button></form>`);
}

function currentTarget(r,id=active){const t=daily(id);return t?mealTarget(t,slot):nutrition(r.lines,foods);}
function recipeDetail(rid,options={}){
 const r=recipes.find(r=>r.id===rid);if(!r)return;
 const normalized=t=>({...t,...Object.fromEntries(['p','c','f'].map(k=>[k,round(t[k],1)]))});
 detail={rid,couple:options.couple||false,t:normalized(options.t||currentTarget(r)),t2:options.t2?normalized(options.t2):null};
 const other=members.find(m=>m.user_id!==active)?.user_id;
 detail.t2=detail.t2||normalized(currentTarget(r,other));
 const missing=r.lines.filter(l=>!stock.has(l.id)).map(l=>foods.find(f=>f.id===l.id).name);
 open(`<span class="eyebrow">TON ASSIETTE, À TA MESURE</span><h2 class="recipe-title">${e(r.name)}</h2><div class="recipe-meta"><span>${icon('clock')}Préparation ${r.prep} min</span><span>${icon('flame')}Cuisson ${r.cook} min</span><span>${icon('dish')}${e(r.equipment)}</span></div>${safeURL(r.photo)?`<img class="cover" src="${e(safeURL(r.photo))}" ${r.photoPath?`data-photo="${e(r.photoPath)}"`:''} alt="Photo d’ambiance" referrerpolicy="no-referrer"><small class="photo-credit">${e(r.photoCredit)}</small>`:''}${missing.length?`<p class="notice">À prévoir : ${e(missing.join(', '))}. Tu peux préparer ce plat pour un autre jour.</p>`:''}${!daily()?'<p class="notice">Complète ton profil pour obtenir tes repères. En attendant, on part de la portion de référence.</p>':''}<section class="portion-builder"><form id="portion-form"><div class="section-title"><div><span class="eyebrow">COMPOSE TA PORTION</span><h3>Pour ${e(name(active))}</h3></div><span class="badge">${profile(active)?.scale===false?'Sans balance':'Avec balance'}</span></div>${daily()?macroReference(currentTarget(r)):''}${targetForm(detail.t)}${other?`<div class="toggle-card"><div>${icon('dish')}<span><strong>À table, tous les deux</strong><small>Une portion personnalisée pour ${e(name(other))}.</small></span></div><label class="switch"><input type="checkbox" id="couple" ${detail.couple?'checked':''}><span aria-hidden="true"></span><span class="sr">Préparer une deuxième portion</span></label></div>${detail.couple?`<h3>Pour ${e(name(other))}</h3>${daily(other)?macroReference(currentTarget(r,other)):''}${targetForm(detail.t2,'second_')}`:''}`:''}<button class="primary">${icon('spark')}Adapter aux macros choisies</button><small class="muted footnote">Les calories sont calculées après l’ajustement des quantités. Aucune macro n’est modifiée pour atteindre un total calorique.</small></form></section><div id="portion-result" aria-live="polite"></div><section class="plan-section"><span class="eyebrow">UNE ENVIE BIEN ORGANISÉE</span><h3>On le prévoit pour quand ?</h3><form id="plan-form"><div class="form-grid"><label>Jour<input type="date" name="date" value="${day}" required></label><label>Repas<select name="slot">${Object.entries(labels).map(([k,n])=>`<option value="${k}" ${k===slot?'selected':''}>${n}</option>`).join('')}</select></label></div><button class="accent">${icon('calendar')}Ajouter au planning</button></form></section><details class="recipe-tools"><summary>Personnaliser ce plat</summary><div class="stack"><button class="secondary" data-action="edit-recipe" data-id="${rid}">Modifier les ingrédients</button><label class="upload-button">${icon('plus')}Choisir une photo<input id="photo-file" type="file" accept="image/*"></label>${row('recipe',rid)?`<button class="text-button danger" data-action="delete-recipe" data-id="${rid}">${RECIPES.some(x=>x.id===rid)?'Restaurer le plat initial':'Supprimer ce plat'}</button>`:''}</div></details>`);
 updatePortions();hydratePhotos(modal);
}

function updatePortions(){
 const r=recipes.find(r=>r.id===detail.rid),users=[active];if(detail.couple)users.push(members.find(m=>m.user_id!==active).user_id);
 detail.results=users.map((id,i)=>({id,...adapt(r,foods,i?detail.t2:detail.t,profile(id)?.scale??true)}));
 renderPortions();
}
function renderPortions(){
 $('#portion-result').innerHTML=detail.results.map(a=>`<section class="portion-card"><div class="section-title"><div><span class="eyebrow">TA PORTION AJUSTÉE</span><h3>${e(name(a.id))}, c’est prêt.</h3></div><span class="status-pill ${a.ok?'is-good':''}">${a.ok?icon('check')+ 'Macros approchées':'À ajuster'}</span></div>${macros(a.n)}<div class="macro-gaps">${[['p','Protéines'],['c','Glucides'],['f','Lipides']].map(([k,n])=>`<span class="gap-${k}">${n} <strong>${signed(a.delta[k])} g</strong></span>`).join('')}</div><p class="muted footnote">${a.ok?'Écarts dans les tolérances affichées.':'Cette composition et les portions réalistes ne permettent pas d’atteindre toutes les cibles. Ajuste les quantités ou choisis un autre plat.'}</p>${profile(a.id)?.scale===false?'<p class="footnote">Sans balance : les mesures et les valeurs restent approximatives.</p>':''}<ul class="ingredients">${a.lines.map(l=>{const food=foods.find(f=>f.id===l.id);return `<li><div class="ingredient-copy"><strong>${e(food.name)}</strong><small>${e(l.amount)}</small></div><div class="quantity-control"><button type="button" data-action="portion-step" data-profile="${a.id}" data-food="${l.id}" data-direction="-1" aria-label="Réduire ${e(food.name)}">${icon('minus')}</button><span>${round(l.g,1)}<small>g</small></span><button type="button" data-action="portion-step" data-profile="${a.id}" data-food="${l.id}" data-direction="1" aria-label="Augmenter ${e(food.name)}">${icon('plus')}</button></div></li>`;}).join('')}</ul><small class="muted footnote">Ajuste avec + / − : les calories et les macros suivent immédiatement les quantités. Pour recalculer toute la portion, utilise « Adapter aux macros choisies ».</small></section>`).join('');
 if(detail.results.length===2){
  const totals=new Map();detail.results.forEach(a=>a.lines.forEach(l=>totals.set(l.id,(totals.get(l.id)||0)+l.g)));
  $('#portion-result').innerHTML+=`<section class="panel combined-portions"><span class="eyebrow">POUR VOUS DEUX</span><h3>Une préparation. Deux portions.</h3><ul class="ingredients">${[...totals].map(([id,g])=>`<li><span>${e(foods.find(f=>f.id===id).name)}</span><strong>${round(g,1)} g</strong></li>`).join('')}</ul><small class="muted footnote">Sans balance, additionne les mesures de vos deux portions.</small></section>`;
 }
}

function planner(){
 const dates=weekDates(day),entries=list('meal').filter(x=>x.payload.profile===active),t=daily();
 const consumed=entries.filter(x=>x.payload.date===day&&x.payload.status==='consumed').reduce((s,x)=>{for(const k of ['kcal','p','c','f'])s[k]+=x.payload.n[k];return s;},{kcal:0,p:0,c:0,f:0});
 app.innerHTML=`<section class="page-heading"><span class="eyebrow">DE LA PLACE POUR TES ENVIES</span><h1>Ta semaine.<br><em>Bien nourrie.</em></h1><p class="muted">Un peu d’organisation, beaucoup de sérénité.</p></section><div class="planner-controls">${profileSelect()}<label>Jour sélectionné<input id="plan-day" type="date" value="${day}"></label><label>Repas à préparer<select id="meal-slot">${Object.entries(labels).map(([k,n])=>`<option value="${k}" ${k===slot?'selected':''}>${n}</option>`).join('')}</select></label></div><section class="panel daily-summary"><div class="section-title"><div><span class="eyebrow">TA JOURNÉE EN UN REGARD</span><h3>${e(new Date(day+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'}))}</h3></div><span class="badge">Consommé uniquement</span></div>${macros(consumed)}${t?`<div class="daily-progress">${[['kcal','Énergie','kcal'],['p','Protéines','g'],['c','Glucides','g'],['f','Lipides','g']].map(([k,n,u])=>`<div class="progress-item progress-${k}"><div><span>${n}</span><strong>${round(consumed[k])} / ${round(t[k])} ${u}</strong></div><progress value="${Math.min(consumed[k],t[k])}" max="${t[k]}" aria-label="${n} consommés"></progress><small>${t[k]-consumed[k]>=0?'Reste '+round(t[k]-consumed[k]):'Dépassé de '+round(consumed[k]-t[k])} ${u}</small></div>`).join('')}</div>`:'<p class="muted">Complète ton profil pour voir tes repères journaliers.</p>'}<div class="summary-actions"><button class="primary" data-action="catalog">${icon('dish')}Choisir un plat</button><button class="secondary" data-action="manual-meal">${icon('plus')}Autre repas ou collation</button></div></section><div class="week-heading"><h2>Cette semaine</h2><div class="week-navigation"><button class="icon-button" data-action="week" data-direction="-1" aria-label="Semaine précédente">${icon('chevron','rotate')}</button><span>${e(new Date(dates[0]+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}))} — ${e(new Date(dates[6]+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}))}</span><button class="icon-button" data-action="week" data-direction="1" aria-label="Semaine suivante">${icon('chevron')}</button></div></div><div class="week">${dates.map(d=>`<article class="day ${d===day?'day-selected':''}"><div class="day-heading"><span>${e(new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{weekday:'long'}))}</span><strong>${e(new Date(d+'T12:00:00').toLocaleDateString('fr-FR',{day:'numeric',month:'short'}))}</strong></div>${entries.filter(x=>x.payload.date===d).sort((a,b)=>Object.keys(labels).indexOf(a.payload.slot)-Object.keys(labels).indexOf(b.payload.slot)).map(x=>`<div class="entry ${x.payload.status==='consumed'?'entry-consumed':''}"><span class="eyebrow">${labels[x.payload.slot]}</span><p><strong>${e(x.payload.name)}</strong></p><small>${round(x.payload.n.kcal)} kcal · ${round(x.payload.n.p)} g protéines</small><div class="entry-actions"><button class="text-button" data-action="meal-show" data-id="${x.key}">Ma portion</button><button class="consume-button ${x.payload.status==='consumed'?'is-consumed':''}" data-action="meal-toggle" data-id="${x.key}">${icon('check')}${x.payload.status==='consumed'?'Consommé':'Valider'}</button><button class="icon-button danger" data-action="meal-delete" data-id="${x.key}" aria-label="Supprimer ce repas">${icon('close')}</button></div></div>`).join('')||`<div class="day-empty">${icon('plus')}À toi de composer.</div>`}</article>`).join('')}</div>`;
}

function catalogResults(q){$('#catalog-results').innerHTML=recipes.filter(r=>r.name.toLocaleLowerCase('fr').includes(q.toLocaleLowerCase('fr'))).map(r=>`<button data-action="detail" data-id="${r.id}">${e(r.name)} · ${r.prep+r.cook} min ${feasible(r,stock)?'✓':'· ingrédients à prévoir'}</button>`).join('')||'<p>Aucun plat trouvé.</p>';}
function manualMeal(){
 open(`<span class="eyebrow">CHAQUE REPAS COMPTE</span><h2>Et le reste de ta journée ?</h2><p class="muted">Renseigne les macros de ton repas. Les calories se calculent automatiquement.</p><form id="manual-form"><label>Nom<input name="name" maxlength="100" required placeholder="Petit déjeuner, collation…"></label><div class="form-grid"><label>Date<input type="date" name="date" value="${day}" required></label><label>Moment<select name="slot">${Object.entries(labels).map(([k,n])=>`<option value="${k}">${n}</option>`).join('')}</select></label></div>${targetForm({p:25,c:45,f:13},'',true)}<label class="check"><input type="checkbox" name="consumed" checked>Déjà consommé</label><button class="primary">Enregistrer mon repas ${icon('check')}</button></form>`);
}

function foodEditor(id){
 const f=foods.find(f=>f.id===id)||{id:'',name:'',p:0,c:0,f:0,grams:100,step:.5,unit:'portion',category:'Autres',source:'Étiquette personnelle'};
 open(`<span class="eyebrow">TON CATALOGUE, À TA MAIN</span><h2>${id?'Ajuster':'Ajouter'} un aliment.</h2>${!id?`<label>Ou modifier un aliment existant<select id="food-edit-select"><option value="">Un nouvel aliment…</option>${foods.map(x=>`<option value="${x.id}">${e(x.name)}</option>`).join('')}</select></label>`:''}<form id="food-form" data-id="${e(f.id)}"><label>Nom et état<input name="name" value="${e(f.name)}" placeholder="Riz sec, lentilles cuites…" maxlength="100" required></label><label>Catégorie<select name="category">${[...new Set(foods.map(x=>x.category).concat('Autres'))].map(c=>`<option ${c===f.category?'selected':''}>${e(c)}</option>`).join('')}</select></label><div class="form-section"><h3>Les macros pour 100 g.</h3><p class="muted">Recopie les protéines, glucides et lipides de ton étiquette.</p>${targetForm(f,'','food')}<small class="muted">Convention simplifiée : 4 kcal/g pour protéines et glucides, 9 pour lipides. Fibres et arrondis peuvent expliquer un écart avec l’étiquette.</small></div><label>Nom d’une mesure sans balance<input name="unit" value="${e(f.unit)}" placeholder="cuillère à soupe, tranche, pièce…" required maxlength="50"></label><div class="form-grid"><label>Grammes par mesure<input name="grams" type="number" min=".1" max="2000" step=".1" value="${f.grams}" required></label><label>Pas de mesure<select name="step">${[.25,.5,1].map(v=>`<option value="${v}" ${Number(f.step)===v?'selected':''}>${v===.25?'Quart':v===.5?'Demi':'Entier'}</option>`).join('')}</select></label></div><small class="muted">Utilise « pièce » pour un aliment indivisible comme l’œuf ou le wrap.</small><label>Source / marque<input name="source" value="${e(f.source)}" maxlength="200" required></label><button class="primary">Enregistrer cet aliment ${icon('check')}</button></form>`);
}

let draftLines=[];
function recipeEditor(id){
 const r=recipes.find(r=>r.id===id)||{id:'',name:'',prep:10,cook:15,equipment:'Plaques',lines:[],photo:'',photoCredit:''};
 draftLines=r.lines.map(l=>({...l}));
 open(`<h2>${id?'Modifier':'Créer'} ton plat</h2><form id="recipe-form" data-id="${r.id}"><label>Nom<input name="name" maxlength="100" value="${e(r.name)}" required></label><div class="row"><label>Préparation (min)<input name="prep" type="number" min="0" max="180" value="${r.prep}" required></label><label>Cuisson (min)<input name="cook" type="number" min="0" max="300" value="${r.cook}" required></label></div><label>Équipement<select name="equipment">${['Plaques','Sans cuisson','Petit four','Plaques + micro-ondes','Plaques + mixeur'].map(v=>`<option ${r.equipment===v?'selected':''}>${v}</option>`).join('')}</select></label><p>Quantités de référence pour <strong>une personne</strong>. Ajoute aussi l’huile, le beurre, les sauces et accompagnements. Eau de cuisson et pincées de sel/poivre peuvent être omises.</p><div id="draft-lines"></div><div id="draft-nutrition"></div><button type="button" data-action="add-line">＋ Ingrédient</button><label>URL d’une photo HTTPS (facultatif)<input name="photo" type="url" value="${e(r.photo)}"></label><label>Crédit photo<input name="photoCredit" value="${e(r.photoCredit)}" maxlength="200"></label><small>Tu peux aussi enregistrer puis importer une photo depuis ton téléphone.</small><button class="primary">Enregistrer le plat</button></form>`);renderDraft();
}
function renderDraft(){
 $('#draft-lines').innerHTML=draftLines.map((l,i)=>`<div class="ingredient-line section"><label><span class="sr">Aliment</span><select class="draft-food" data-index="${i}">${foods.map(f=>`<option value="${f.id}" ${l.id===f.id?'selected':''}>${e(f.name)}</option>`).join('')}</select></label><label>Grammes<input class="draft-g" data-index="${i}" type="number" min=".1" max="2000" step=".1" value="${l.g}" required></label><button type="button" data-action="remove-line" data-index="${i}" aria-label="Retirer cet ingrédient">✕</button></div>`).join('');
 refreshDraftNutrition();
}
function refreshDraftNutrition(){if($('#draft-nutrition'))$('#draft-nutrition').innerHTML=draftLines.length?macros(nutrition(draftLines.filter(l=>Number.isFinite(l.g)&&l.g>0),foods)):'<p class="muted">Les valeurs de la portion apparaîtront ici.</p>';}
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
 if(b.tagName==='A')ev.preventDefault();
 const asyncAction=['refresh','logout','favorite','stock','clear-stock','delete-recipe','meal-toggle','meal-delete'].includes(a);
 try{
  if(asyncAction){b.disabled=true;b.setAttribute('aria-busy','true');}
  if(a==='close')close();
  else if(a==='route'){route=b.dataset.route;render();window.scrollTo({top:0});}
  else if(a==='refresh'){await reload();render();toast('Données actualisées.');}
  else if(a==='logout'){checked(await db.auth.signOut({scope:'local'}));session=null;members=[];rows=[];foods=[];recipes=[];stock.clear();close();render();}
  else if(a==='filter'){filters.has(id)?filters.delete(id):filters.add(id);ideas();}
  else if(a==='random'){const rs=shown();if(!rs.length)toast('Aucun plat disponible avec cette sélection.');else recipeDetail(rs[Math.floor(Math.random()*rs.length)].id);}
  else if(a==='detail')recipeDetail(id);
  else if(a==='week'){const date=new Date(day+'T12:00:00');date.setDate(date.getDate()+7*Number(b.dataset.direction));day=isoDate(date);planner();}
  else if(a==='portion-step'){
   const idx=detail.results.findIndex(r=>r.id===b.dataset.profile),result=detail.results[idx],food=foods.find(f=>f.id===b.dataset.food);
   const scale=profile(result.id)?.scale??true,step=portionStep(food,scale);
   const lines=result.lines.map(l=>l.id===food.id?{...l,g:Math.min(2000,Math.max(step,round(l.g+Number(b.dataset.direction)*step,2)))}:l);
   detail.results[idx]={id:result.id,...evaluatePortion(lines,foods,idx?detail.t2:detail.t,scale)};renderPortions();
  }
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
   const p=payload('meal',id);open(`<h2>${e(p.name)}</h2><p>${e(name(p.profile))} · ${e(p.date)} · ${labels[p.slot]}</p>${macros(p.n)}<ul class="ingredients">${(p.lines||[]).map(l=>`<li><span>${e(l.name)}</span><span>${e(l.amount)}</span></li>`).join('')}</ul><small>Macros et quantités enregistrées lors de la planification. L’énergie est calculée à partir de ces macros (4/4/9), sans modifier les quantités historiques.</small>`);
  }
 }catch(err){fail(err);}finally{if(b.isConnected){b.disabled=false;b.removeAttribute('aria-busy');}}
});
document.addEventListener('input',ev=>{
 const t=ev.target;
 const form=t.closest?.('form');
 if(form&&['portion-form','manual-form','food-form'].includes(form.id)){
  const fd=new FormData(form);
  form.querySelectorAll('.derived-energy output').forEach((out,i)=>{const prefix=i?'second_':'';out.innerHTML=`${round(energy(Object.fromEntries(['p','c','f'].map(k=>[k,num(fd,prefix+k)]))))} <small>kcal</small>`;});
 }
 if(t.id==='recipe-search'){search=t.value;cards();}
 if(t.id==='food-search'){foodSearch=t.value;foodList();}
 if(t.id==='catalog-search')catalogResults(t.value);
 if(t.classList.contains('draft-g')){draftLines[Number(t.dataset.index)].g=Number(t.value);refreshDraftNutrition();}
});
document.addEventListener('change',async ev=>{
 const t=ev.target;
 try{
  if(t.id==='active-profile'){active=t.value;localStorage.setItem('fuel-profile',active);render();}
  if(t.id==='plan-day'){day=t.value||isoDate();planner();}
  if(t.id==='meal-slot'){slot=t.value;planner();}
  if(t.id==='food-edit-select'&&t.value)foodEditor(t.value);
  if(t.classList.contains('draft-food')){draftLines[Number(t.dataset.index)].id=t.value;refreshDraftNutrition();}
  if(t.id==='couple'){
   const fd=new FormData($('#portion-form'));detail.t=readTarget(fd);if(detail.couple)detail.t2=readTarget(fd,'second_');recipeDetail(detail.rid,{...detail,couple:t.checked});
  }
  if(t.id==='photo-file'){t.disabled=true;await uploadPhoto(t.files[0]);}
 }catch(err){fail(err);if(t.id==='photo-file')t.disabled=false;}
});
document.addEventListener('submit',async ev=>{
 ev.preventDefault();const form=ev.target,fd=new FormData(form),button=form.querySelector('button[type="submit"],button.primary,button.accent');
 try{
  if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
  if(form.id==='login'){
   const result=await db.auth.signInWithPassword({email:String(fd.get('email')).trim(),password:String(fd.get('password'))});
   session=checked(result).session;active=localStorage.getItem('fuel-profile')||session.user.id;await reload();render();
  }
  else if(form.id==='profile-form'){
   const p={name:String(fd.get('name')).trim(),sex:fd.get('sex'),scale:fd.has('scale'),adultEligible:fd.has('adultEligible')};
   for(const k of ['age','height','weight','goalWeight','activity','sessions','duration','deficit','manualP','manualC','manualF'])p[k]=num(fd,k);
   for(const [k,v]of [['proteinRatio',1.8],['carbRatio',3],['fatRatio',.8]])p[k]=fd.get(k)?num(fd,k):v;
   targets(p);await save('profile',active,p);close();render();toast('Profil et objectifs enregistrés.');
  }
  else if(form.id==='portion-form'){detail.t=readTarget(fd);if(detail.couple)detail.t2=readTarget(fd,'second_');updatePortions();}
  else if(form.id==='plan-form'){
   const portionFd=new FormData($('#portion-form')),nextT=readTarget(portionFd),nextT2=detail.couple?readTarget(portionFd,'second_'):null;
   const same=(a,b)=>['p','c','f'].every(k=>round(Number(a[k]),1)===round(Number(b[k]),1));
   if(!same(nextT,detail.t)||(detail.couple&&!same(nextT2,detail.t2)))throw Error('Clique sur « Adapter aux macros choisies » pour appliquer tes nouvelles cibles avant de planifier.');
   const r=recipes.find(r=>r.id===detail.rid);
   const inserts=detail.results.map(a=>({space_id:CONFIG.space,kind:'meal',key:crypto.randomUUID(),payload:{profile:a.id,date:fd.get('date'),slot:fd.get('slot'),name:r.name,recipe:r.id,status:'planned',nutritionVersion:2,n:a.n,targets:a.id===active?detail.t:detail.t2,lines:a.lines.map(l=>({...l,name:foods.find(f=>f.id===l.id).name}))}}));
   assertOnline();checked(await db.from('fuel_items').insert(inserts));close();await reload();route='planner';day=String(fd.get('date'));render();toast('Repas ajouté au planning.');
  }
  else if(form.id==='manual-form'){
   const n=readTarget(fd,'',true);await save('meal',crypto.randomUUID(),{profile:active,date:fd.get('date'),slot:fd.get('slot'),name:String(fd.get('name')).trim(),status:fd.has('consumed')?'consumed':'planned',nutritionVersion:2,n,lines:[]});close();planner();
  }
  else if(form.id==='food-form'){
   const f={id:form.dataset.id||'f_'+crypto.randomUUID(),name:String(fd.get('name')).trim(),category:fd.get('category'),unit:String(fd.get('unit')).trim(),source:String(fd.get('source')).trim()};
   for(const k of ['p','c','f','grams','step'])f[k]=num(fd,k);
   if(!f.name||f.grams<=0||f.step<=0||[f.p,f.c,f.f].some(v=>v<0||v>100||!Number.isFinite(v))||f.p+f.c+f.f>101)throw Error('Valeurs alimentaires invalides.');
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
 }catch(err){fail(err);}finally{if(button?.isConnected){button.disabled=false;button.removeAttribute('aria-busy');}}
});
async function start(){
 try{
  if(CONFIG.url.includes('TON-PROJET')||CONFIG.key.includes('TA_CLE'))throw Error('Renseigne config.js avec l’URL et la clé publique Supabase, puis recharge.');
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  const projectURL=new URL(CONFIG.url.trim());
  if(!projectURL.hostname.endsWith('.supabase.co')||projectURL.protocol!=='https:')throw Error('Dans config.js, utilise l’URL HTTPS du projet Supabase, pas celle du tableau de bord.');
  db=createClient(projectURL.origin,CONFIG.key.trim(),{auth:{storageKey:'fuel-me-auth',persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  session=checked(await db.auth.getSession()).session;active=localStorage.getItem('fuel-profile')||session?.user.id||'';
  if(session)await reload();render();
  db.auth.onAuthStateChange((event,s)=>{session=s;if(event==='SIGNED_OUT'){rows=[];members=[];foods=[];recipes=[];stock.clear();close();render();}});
  setInterval(async()=>{if(session&&!editing&&!polling&&document.visibilityState==='visible'&&navigator.onLine){polling=true;try{await reload();if(!lastChanged)return;if(route==='ideas'||route==='favorites')cards();else if(route==='pantry')foodList();else if(!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName))render();}catch(err){console.warn(err.message);}finally{polling=false;}}},15000);
  window.addEventListener('focus',()=>{if(session&&!editing)reload().catch(fail);});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(console.warn);
 }catch(err){app.innerHTML=`<div class="panel narrow"><h2>Un réglage à terminer</h2><p>${e(err.message)}</p><p>Consulte le guide puis recharge la page.</p></div>`;}
}
start();

document.addEventListener('pointerdown',ev=>{
 const b=ev.target.closest('button');if(!b||b.disabled||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const rect=b.getBoundingClientRect(),ripple=document.createElement('span');ripple.className='ripple';ripple.style.left=(ev.clientX-rect.left)+'px';ripple.style.top=(ev.clientY-rect.top)+'px';
 b.append(ripple);setTimeout(()=>ripple.remove(),550);
});
