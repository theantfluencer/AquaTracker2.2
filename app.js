(() => {
"use strict";

const VERSION = "2.2";
const DB_KEY = "aquatracker22";
const PHOTO_DB = "aquatracker_photos";
const TYPE_META = {
  cleaning:{label:"Reinigung",icon:"🧽"},
  filter:{label:"Filterreinigung",icon:"🧰"},
  analysis:{label:"Wasseranalyse",icon:"🧪"},
  dosing:{label:"Düngung",icon:"🌿"},
  note:{label:"Notiz",icon:"📝"}
};
const ANALYSIS_FIELDS = [
  ["ph","pH"],["kh","KH"],["gh","GH"],["no2","NO₂"],["no3","NO₃"],["po4","PO₄"],
  ["fe","Fe"],["conductivity","Leitfähigkeit (µS/cm)"],["ppm","ppm"],
  ["temperature","Temperatur (°C)"],["co2","CO₂ (mg/l)"],["custom","Eigener Wert"]
];
const DEFAULT_PRODUCTS = [
  ["den-v30","Dennerle Plant System V30","Pflanzenpflege","pump","ml"],
  ["den-s7","Dennerle Plant System S7","Pflanzenpflege","pump","ml"],
  ["den-e15","Dennerle Plant System E15","Pflanzenpflege","tablet","Tabletten"],
  ["den-enz","Dennerle Plant Care Pro Daily","Pflanzenpflege","ml","ml"],
  ["den-active","Dennerle Plant Active Enzymes","Enzyme","ml","ml"],
  ["den-elixir","Dennerle Aqua Elixir","Wasseraufbereitung","ml","ml"],
  ["den-clear","Dennerle Clear Water Elixir","Wasserpflege","ml","ml"],
  ["den-bacto","Dennerle Bacto Elixier FB7","Bakterien","ml","ml"],
  ["den-remover","Dennerle Algae Remover","Algenpflege","ml","ml"],
  ["den-mineral","Dennerle Osmose Remineral+","Mineralsalz","g","g"]
].map(([id,name,category,doseMode,unit])=>({
  id,name,category,doseMode,unit,used:false,tracked:false,packageSize:0,currentAmount:0,pumpMl:1,
  custom:false,createdAt:Date.now()
}));

let state = loadState();
let currentView = "dashboard";
let currentMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let installPrompt = null;
let stagedPhotos = [];

function defaultState(){
  return {
    version:VERSION,
    aquariums:[],
    events:[],
    products:DEFAULT_PRODUCTS,
    analysisFields:["ph","kh","gh","no2","no3","po4","temperature"],
    sortMode:"custom",
    customOrder:[],
    selectedAquariumId:null
  };
}
function loadState(){
  try{
    const parsed=JSON.parse(localStorage.getItem(DB_KEY)||"null");
    if(!parsed) return defaultState();
    const base=defaultState();
    return {...base,...parsed,products:mergeProducts(parsed.products||[])};
  }catch(e){console.error(e);return defaultState();}
}
function mergeProducts(existing){
  const map=new Map(existing.map(p=>[p.id,p]));
  DEFAULT_PRODUCTS.forEach(p=>{if(!map.has(p.id))map.set(p.id,p)});
  return [...map.values()];
}
function save(){
  localStorage.setItem(DB_KEY,JSON.stringify(state));
}
const uid=(p="id")=>`${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
const todayISO=()=>localISO(new Date());
function localISO(d){
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
}
function formatDate(iso){
  if(!iso)return "–";
  const [y,m,d]=iso.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString("de-DE");
}
function parseLocal(iso){const [y,m,d]=iso.split("-").map(Number);return new Date(y,m-1,d)}
function daysBetween(a,b){return Math.round((parseLocal(b)-parseLocal(a))/86400000)}
function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function aquariumById(id){return state.aquariums.find(a=>a.id===id)}
function productById(id){return state.products.find(p=>p.id===id)}
function eventsForAquarium(id){return state.events.filter(e=>e.aquariumId===id)}
function toast(msg){
  const el=document.getElementById("toast");el.textContent=msg;el.classList.add("show");
  clearTimeout(toast.t);toast.t=setTimeout(()=>el.classList.remove("show"),2300)
}

function openPhotoDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(PHOTO_DB,1);
    req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains("photos"))req.result.createObjectStore("photos",{keyPath:"id"})};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });
}
async function putPhoto(photo){
  const db=await openPhotoDB();await new Promise((res,rej)=>{const tx=db.transaction("photos","readwrite");tx.objectStore("photos").put(photo);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
}
async function getPhoto(id){
  const db=await openPhotoDB();return new Promise((res,rej)=>{const r=db.transaction("photos").objectStore("photos").get(id);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)});
}
async function deletePhoto(id){
  const db=await openPhotoDB();return new Promise((res,rej)=>{const tx=db.transaction("photos","readwrite");tx.objectStore("photos").delete(id);tx.oncomplete=res;tx.onerror=()=>rej(tx.error)});
}
async function fileToPhoto(file,name){
  const dataUrl=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(r.error);r.readAsDataURL(file)});
  return {id:uid("photo"),name:name||file.name||"Foto",dataUrl,createdAt:Date.now()};
}

function navigate(view){
  currentView=view;
  document.querySelectorAll(".view").forEach(v=>v.classList.toggle("active",v.id===`view-${view}`));
  document.querySelectorAll(".bottom-nav button").forEach(b=>b.classList.toggle("active",b.dataset.nav===view));
  document.getElementById("quickActions").classList.toggle("hidden",view!=="dashboard"||!state.aquariums.length);
  render();
  window.scrollTo({top:0,behavior:"smooth"});
}
function render(){
  if(currentView==="dashboard")renderDashboard();
  if(currentView==="calendar")renderCalendar();
  if(currentView==="history")renderHistory();
  if(currentView==="products")renderProducts();
  if(currentView==="settings")renderSettings();
  updateHistoryFilter();
}

function aquariumHealth(a){
  const tasks=a.tasks||[];
  if(!tasks.length)return {score:100,status:"good",label:"Kein Pflegeplan",icon:"🐠"};
  const today=todayISO();
  let penalty=0, dueSoon=false, overdue=0;
  tasks.filter(t=>t.enabled!==false).forEach(t=>{
    const last=latestEventDate(a.id,t.type);
    const base=last||a.createdDate||today;
    const due=new Date(parseLocal(base));due.setDate(due.getDate()+Number(t.interval||7));
    const diff=daysBetween(today,localISO(due));
    if(diff<0){overdue++;penalty+=Math.min(35,Math.abs(diff)*4+12)}
    else if(diff<=2){dueSoon=true;penalty+=5}
  });
  const score=Math.max(0,100-penalty);
  if(overdue>=2||score<45)return {score,status:"critical",label:"Mehrere Aufgaben überfällig",icon:"🐡"};
  if(overdue)return {score,status:"late",label:"Pflege überfällig",icon:"🐟"};
  if(dueSoon)return {score,status:"soon",label:"Pflege bald fällig",icon:"🐠"};
  return {score,status:"good",label:"Alles im Plan",icon:"🐠"};
}
function latestEventDate(aid,type){
  return state.events.filter(e=>e.aquariumId===aid&&e.type===type).sort((a,b)=>b.date.localeCompare(a.date))[0]?.date||null;
}
function nextDue(a){
  const rows=(a.tasks||[]).filter(t=>t.enabled!==false).map(t=>{
    const base=latestEventDate(a.id,t.type)||a.createdDate||todayISO();
    const d=new Date(parseLocal(base));d.setDate(d.getDate()+Number(t.interval||7));
    return {...t,due:localISO(d)}
  }).sort((x,y)=>x.due.localeCompare(y.due));
  return rows[0]||null;
}
function sortedAquariums(){
  const arr=[...state.aquariums];
  if(state.sortMode==="name")return arr.sort((a,b)=>a.name.localeCompare(b.name,"de"));
  if(state.sortMode==="volume")return arr.sort((a,b)=>(b.volume||0)-(a.volume||0));
  if(state.sortMode==="health")return arr.sort((a,b)=>aquariumHealth(a).score-aquariumHealth(b).score);
  if(state.sortMode==="created")return arr.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0));
  if(state.sortMode==="due")return arr.sort((a,b)=>(nextDue(a)?.due||"9999").localeCompare(nextDue(b)?.due||"9999"));
  return arr.sort((a,b)=>{
    const ai=state.customOrder.indexOf(a.id),bi=state.customOrder.indexOf(b.id);
    return (ai<0?9999:ai)-(bi<0?9999:bi)
  });
}
async function renderDashboard(){
  const list=sortedAquariums();
  const overdue=list.filter(a=>["late","critical"].includes(aquariumHealth(a).status)).length;
  document.getElementById("dashboardSummary").innerHTML=`
    <div class="summary-card"><strong>${list.length}</strong><span>Aquarien</span></div>
    <div class="summary-card"><strong>${state.events.length}</strong><span>Ereignisse</span></div>
    <div class="summary-card"><strong>${overdue}</strong><span>Überfällig</span></div>`;
  const el=document.getElementById("aquariumList");
  el.innerHTML=list.map(a=>{
    const h=aquariumHealth(a),due=nextDue(a);
    const dueText=due?(daysBetween(todayISO(),due.due)<0?`${TYPE_META[due.type]?.label||"Aufgabe"} seit ${Math.abs(daysBetween(todayISO(),due.due))} Tagen überfällig`:
      daysBetween(todayISO(),due.due)===0?`${TYPE_META[due.type]?.label||"Aufgabe"} heute`:
      `${TYPE_META[due.type]?.label||"Aufgabe"} in ${daysBetween(todayISO(),due.due)} Tagen`):"Kein Pflegeplan";
    return `<article class="aquarium-card" draggable="${state.sortMode==="custom"}" data-id="${a.id}">
      <div class="aquarium-photo" data-photo="${a.coverPhotoId||""}">${a.coverPhotoId?"":"🌊"}</div>
      <div data-action="open-aquarium" data-id="${a.id}">
        <h3>${esc(a.name)}</h3><div class="meta">${a.volume||"–"} Liter${a.location?` · ${esc(a.location)}`:""}</div>
        <div class="health health-${h.status}"><span class="health-icon">${h.icon}</span><span>${h.score}% · ${h.label}</span></div>
        <div class="meta">${esc(dueText)}</div>
      </div>
      <div class="card-actions">
        <button class="icon-btn" data-action="edit-aquarium" data-id="${a.id}" title="Bearbeiten">✏️</button>
        <button class="icon-btn drag-handle" title="Verschieben">☰</button>
      </div>
    </article>`
  }).join("");
  for(const node of el.querySelectorAll("[data-photo]")){
    const id=node.dataset.photo;if(id){const p=await getPhoto(id);if(p)node.innerHTML=`<img src="${p.dataUrl}" alt="${esc(p.name)}" style="width:100%;height:100%;object-fit:cover;border-radius:inherit">`}
  }
  setupDragDrop();
  renderInventoryPreview();
}
function setupDragDrop(){
  if(state.sortMode!=="custom")return;
  let dragged=null;
  document.querySelectorAll(".aquarium-card").forEach(card=>{
    card.addEventListener("dragstart",()=>{dragged=card;card.style.opacity=".5"});
    card.addEventListener("dragend",()=>{card.style.opacity="";dragged=null});
    card.addEventListener("dragover",e=>{e.preventDefault();if(!dragged||dragged===card)return;
      const box=card.getBoundingClientRect();const after=e.clientY>box.top+box.height/2;
      card.parentNode.insertBefore(dragged,after?card.nextSibling:card);
    });
    card.addEventListener("drop",()=>{
      state.customOrder=[...document.querySelectorAll(".aquarium-card")].map(x=>x.dataset.id);save();toast("Reihenfolge gespeichert")
    });
  });
}
function renderInventoryPreview(){
  const products=state.products.filter(p=>p.tracked);
  document.getElementById("inventoryPreview").innerHTML=products.length?products.map(inventoryCard).join(""):`<div class="panel muted">Noch kein Produktbestand aktiviert.</div>`;
}
function inventoryCard(p){
  const pct=p.packageSize>0?Math.max(0,Math.min(100,p.currentAmount/p.packageSize*100)):0;
  const avg=averageUsage(p.id);const weeks=avg>0?Math.floor(p.currentAmount/avg):null;
  return `<article class="inventory-card">
    <div class="inventory-top"><h3>${esc(p.name)}</h3><strong>${Math.round(pct)}%</strong></div>
    <div class="progress"><span style="width:${pct}%"></span></div>
    <div class="inventory-stats"><span>${fmtNum(p.currentAmount)} / ${fmtNum(p.packageSize)} ${esc(p.unit)}</span><span>${weeks===null?"–":weeks+" Wochen"}</span></div>
  </article>`
}
function averageUsage(pid){
  const since=Date.now()-8*7*86400000;
  const total=state.events.filter(e=>parseLocal(e.date).getTime()>=since).reduce((sum,e)=>sum+(e.products||[]).filter(x=>x.productId===pid).reduce((s,x)=>s+Number(x.inventoryAmount||0),0),0);
  return total/8;
}
function fmtNum(n){return Number(n||0).toLocaleString("de-DE",{maximumFractionDigits:2})}

function renderCalendar(){
  const y=currentMonth.getFullYear(),m=currentMonth.getMonth();
  document.getElementById("calendarTitle").textContent=currentMonth.toLocaleDateString("de-DE",{month:"long",year:"numeric"});
  const first=new Date(y,m,1),start=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate();
  const prevDays=new Date(y,m,0).getDate();
  let html=["Mo","Di","Mi","Do","Fr","Sa","So"].map(x=>`<div class="weekday">${x}</div>`).join("");
  for(let i=0;i<42;i++){
    let d,inside=true;
    if(i<start){d=new Date(y,m-1,prevDays-start+i+1);inside=false}
    else if(i>=start+days){d=new Date(y,m+1,i-start-days+1);inside=false}
    else d=new Date(y,m,i-start+1);
    const iso=localISO(d),evs=state.events.filter(e=>e.date===iso);
    html+=`<button class="day ${inside?"":"outside"} ${iso===todayISO()?"today":""}" data-date="${iso}">
      <span class="day-number">${d.getDate()}</span><span class="day-icons">${evs.slice(0,4).map(e=>TYPE_META[e.type]?.icon||"•").join("")}</span>
    </button>`;
  }
  document.getElementById("calendarGrid").innerHTML=html;
  const monthPrefix=`${y}-${String(m+1).padStart(2,"0")}`;
  const evs=state.events.filter(e=>e.date.startsWith(monthPrefix)).sort((a,b)=>b.date.localeCompare(a.date));
  renderEventList(document.getElementById("calendarEvents"),evs);
}
function renderHistory(){
  const filter=document.getElementById("historyFilter").value||"all";
  let evs=[...state.events].sort((a,b)=>(b.date+b.time).localeCompare(a.date+a.time));
  if(filter!=="all")evs=evs.filter(e=>e.aquariumId===filter);
  renderEventList(document.getElementById("historyList"),evs);
}
function renderEventList(el,evs){
  el.innerHTML=evs.length?evs.map(e=>{
    const a=aquariumById(e.aquariumId),m=TYPE_META[e.type]||TYPE_META.note;
    const photoMark=(e.photoIds||[]).length?` · 📷 ${(e.photoIds||[]).length}`:"";
    return `<article class="event-card" data-action="open-event" data-id="${e.id}">
      <div class="event-icon">${m.icon}</div><div><h3>${m.label}</h3>
      <p>${esc(a?.name||"Gelöschtes Aquarium")} · ${formatDate(e.date)}${e.time?" · "+esc(e.time):""}${photoMark}</p></div>
      <button class="icon-btn" data-action="edit-event" data-id="${e.id}" title="Bearbeiten">✏️</button>
    </article>`
  }).join(""):`<div class="panel muted">Keine Ereignisse vorhanden.</div>`;
}
function updateHistoryFilter(){
  const sel=document.getElementById("historyFilter");if(!sel)return;
  const value=sel.value;sel.innerHTML=`<option value="all">Alle Aquarien</option>`+state.aquariums.map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join("");
  if([...sel.options].some(o=>o.value===value))sel.value=value;
}

function renderProducts(){
  document.getElementById("productList").innerHTML=state.products.map(p=>`
    <article class="product-card">
      <div><h3>${esc(p.name)}</h3><p>${esc(p.category)} · Dosierung: ${esc(p.doseMode==="pump"?"Hübe":p.unit)}</p>
      <div class="switches">
        <label class="toggle-label"><input type="checkbox" data-product-toggle="used" data-id="${p.id}" ${p.used?"checked":""}> ☑ Verwendet</label>
        <label class="toggle-label"><input type="checkbox" data-product-toggle="tracked" data-id="${p.id}" ${p.tracked?"checked":""}> 🧴 Bestand</label>
      </div></div>
      <button class="icon-btn" data-action="edit-product" data-id="${p.id}">✏️</button>
    </article>`).join("");
}
function renderSettings(){
  document.getElementById("analysisSettings").innerHTML=ANALYSIS_FIELDS.map(([id,label])=>`
    <label class="check-item"><input type="checkbox" data-analysis="${id}" ${state.analysisFields.includes(id)?"checked":""}>${label}</label>`).join("");
  document.getElementById("sortMode").value=state.sortMode;
}

function showModal(title,body,actions){
  stagedPhotos=[];
  document.getElementById("modalTitle").textContent=title;
  document.getElementById("modalBody").innerHTML=body;
  document.getElementById("modalActions").innerHTML=actions;
  document.getElementById("modal").showModal();
}
function closeModal(){document.getElementById("modal").close()}
function photoPickerHTML(existing=[]){
  return `<div class="field full"><label>Fotos</label>
    <div class="photo-picker">
      <label class="ghost">📷 Kamera<input hidden class="photo-input" type="file" accept="image/*" capture="environment" multiple></label>
      <label class="ghost">🖼️ Galerie<input hidden class="photo-input" type="file" accept="image/*" multiple></label>
    </div><div id="photoPreview" class="photo-preview"></div>
    <input type="hidden" id="existingPhotoIds" value="${existing.join(",")}">
  </div>`;
}
async function bindPhotoPicker(existing=[]){
  stagedPhotos=[];
  for(const id of existing){const p=await getPhoto(id);if(p)stagedPhotos.push({...p,existing:true})}
  renderPhotoPreview();
  document.querySelectorAll(".photo-input").forEach(inp=>inp.addEventListener("change",async()=>{
    const files=[...inp.files].slice(0,10-stagedPhotos.length);
    for(const f of files)stagedPhotos.push(await fileToPhoto(f));
    renderPhotoPreview();
  }));
}
function renderPhotoPreview(){
  const el=document.getElementById("photoPreview");if(!el)return;
  el.innerHTML=stagedPhotos.map((p,i)=>`<div class="photo-tile">
    <img src="${p.dataUrl}" alt=""><input data-photo-name="${i}" value="${esc(p.name)}" placeholder="Foto benennen">
    <button type="button" class="danger small" data-remove-photo="${i}">Entfernen</button></div>`).join("");
}
async function persistStagedPhotos(){
  const ids=[];
  for(let i=0;i<stagedPhotos.length;i++){
    const input=document.querySelector(`[data-photo-name="${i}"]`);
    stagedPhotos[i].name=input?.value.trim()||`Foto ${i+1}`;
    await putPhoto(stagedPhotos[i]);ids.push(stagedPhotos[i].id);
  }
  return ids;
}

function aquariumForm(a={}){
  const tasks=a.tasks||[
    {type:"cleaning",interval:7,enabled:true},
    {type:"filter",interval:42,enabled:true},
    {type:"analysis",interval:14,enabled:true}
  ];
  return `<div class="form-grid">
    <div class="field"><label>Name *</label><input id="aqName" value="${esc(a.name||"")}" required></div>
    <div class="field"><label>Volumen in Liter</label><input id="aqVolume" type="number" min="0" step="1" value="${a.volume||""}"></div>
    <div class="field"><label>Standort</label><input id="aqLocation" value="${esc(a.location||"")}"></div>
    <div class="field"><label>Angelegt am</label><input id="aqCreatedDate" type="date" value="${a.createdDate||todayISO()}"></div>
    <div class="field full"><label>Notizen</label><textarea id="aqNotes" rows="3">${esc(a.notes||"")}</textarea></div>
    ${photoPickerHTML(a.photoIds||[])}
    <div class="field full"><label>Pflegeplan</label><div class="task-list">
      ${tasks.map(t=>`<div class="task-row">
        <label class="toggle-label"><input type="checkbox" data-task-enabled="${t.type}" ${t.enabled!==false?"checked":""}>${TYPE_META[t.type].icon} ${TYPE_META[t.type].label}</label>
        <div class="field"><label>Alle X Tage</label><input type="number" min="1" data-task-interval="${t.type}" value="${t.interval||7}"></div>
        <span></span>
      </div>`).join("")}
    </div></div>
  </div>`;
}
async function openAquariumForm(id=null){
  const a=id?aquariumById(id):null;
  showModal(a?"Aquarium bearbeiten":"Neues Aquarium",aquariumForm(a||{}),
    `${a?`<button type="button" class="danger" data-action="delete-aquarium" data-id="${a.id}">Aquarium löschen</button>`:""}
     <button type="button" class="ghost" data-action="cancel-modal">Abbrechen</button>
     <button type="button" class="primary" data-action="save-aquarium" data-id="${a?.id||""}">Speichern</button>`);
  await bindPhotoPicker(a?.photoIds||[]);
}
async function saveAquarium(id){
  const name=document.getElementById("aqName").value.trim();if(!name)return toast("Bitte einen Namen eingeben.");
  const old=id?aquariumById(id):null;
  const oldPhotoIds=old?.photoIds||[];
  const photoIds=await persistStagedPhotos();
  for(const pid of oldPhotoIds.filter(x=>!photoIds.includes(x)))await deletePhoto(pid);
  const tasks=["cleaning","filter","analysis"].map(type=>({
    type,enabled:document.querySelector(`[data-task-enabled="${type}"]`).checked,
    interval:Number(document.querySelector(`[data-task-interval="${type}"]`).value)||7
  }));
  const obj={...(old||{}),id:id||uid("aq"),name,volume:Number(document.getElementById("aqVolume").value)||0,
    location:document.getElementById("aqLocation").value.trim(),createdDate:document.getElementById("aqCreatedDate").value||todayISO(),
    notes:document.getElementById("aqNotes").value.trim(),photoIds,coverPhotoId:photoIds[0]||null,tasks,createdAt:old?.createdAt||Date.now()};
  if(old)Object.assign(old,obj);else{state.aquariums.push(obj);state.customOrder.push(obj.id);state.selectedAquariumId=obj.id}
  save();closeModal();render();toast("Aquarium gespeichert");
}
async function deleteAquarium(id){
  const a=aquariumById(id);if(!a)return;
  if(!confirm(`Aquarium „${a.name}“ mit allen Ereignissen löschen?`))return;
  for(const pid of a.photoIds||[])await deletePhoto(pid);
  const evs=state.events.filter(e=>e.aquariumId===id);
  for(const e of evs){reverseInventory(e);for(const pid of e.photoIds||[])await deletePhoto(pid)}
  state.aquariums=state.aquariums.filter(x=>x.id!==id);state.events=state.events.filter(e=>e.aquariumId!==id);
  state.customOrder=state.customOrder.filter(x=>x!==id);save();closeModal();render();toast("Aquarium gelöscht");
}
function openAquariumDetails(id){
  const a=aquariumById(id);if(!a)return;state.selectedAquariumId=id;save();
  const h=aquariumHealth(a),evs=eventsForAquarium(id).sort((x,y)=>bkey(y).localeCompare(bkey(x))).slice(0,5);
  showModal(a.name,`<div class="panel"><div class="health health-${h.status}"><span class="health-icon">${h.icon}</span><strong>${h.score}% · ${h.label}</strong></div>
    <p class="muted">${a.volume||"–"} Liter${a.location?` · ${esc(a.location)}`:""}</p><p>${esc(a.notes||"")}</p></div>
    <div class="section-head"><h2>Letzte Ereignisse</h2></div><div class="history-list">${evs.map(e=>`<button type="button" class="ghost" data-action="edit-event" data-id="${e.id}">${TYPE_META[e.type].icon} ${TYPE_META[e.type].label} · ${formatDate(e.date)}</button>`).join("")||'<p class="muted">Noch keine Ereignisse.</p>'}</div>`,
    `<button type="button" class="ghost" data-action="edit-aquarium" data-id="${id}">✏️ Bearbeiten</button>
     <button type="button" class="primary" data-action="new-event" data-type="cleaning" data-aquarium="${id}">＋ Ereignis</button>`);
}
const bkey=e=>(e.date||"")+(e.time||"");

function eventForm(type="cleaning",e={}){
  const usedProducts=state.products.filter(p=>p.used);
  const analysis=state.analysisFields;
  return `<div class="form-grid">
    <div class="field"><label>Aquarium *</label><select id="evAquarium" class="select">${state.aquariums.map(a=>`<option value="${a.id}" ${(e.aquariumId||state.selectedAquariumId)===a.id?"selected":""}>${esc(a.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Art</label><select id="evType" class="select">${Object.entries(TYPE_META).map(([id,m])=>`<option value="${id}" ${type===id?"selected":""}>${m.icon} ${m.label}</option>`).join("")}</select></div>
    <div class="field"><label>Datum</label><input id="evDate" type="date" value="${e.date||todayISO()}"></div>
    <div class="field"><label>Uhrzeit</label><input id="evTime" type="time" value="${e.time||new Date().toTimeString().slice(0,5)}"></div>
    <div class="field" id="waterField"><label>Wasserwechsel (Liter)</label><input id="evWater" type="number" min="0" step="1" value="${e.waterLiters||""}"></div>
    <div class="field full"><label>Notizen</label><textarea id="evNotes" rows="3">${esc(e.notes||"")}</textarea></div>
    <div class="field full" id="analysisBlock"><label>Wasserwerte</label><div class="check-grid">
      ${analysis.map(id=>{const label=ANALYSIS_FIELDS.find(x=>x[0]===id)?.[1]||id;return `<div class="field"><label>${label}</label><input data-analysis-value="${id}" value="${esc(e.analysis?.[id]||"")}"></div>`}).join("")}
    </div></div>
    <div class="field full" id="productsBlock"><label>Produkte und Dosierung</label>
      ${usedProducts.length?usedProducts.map(p=>{
        const old=(e.products||[]).find(x=>x.productId===p.id);
        const mode=p.doseMode==="pump"?"Hübe":p.unit;
        return `<div class="product-dose-row"><div><strong>${esc(p.name)}</strong><div class="muted">${esc(mode)}${p.doseMode==="pump"?` · 1 Hub = ${fmtNum(p.pumpMl)} ml`:""}</div></div>
          <input type="number" min="0" step="0.01" data-dose="${p.id}" value="${old?.dose||""}" placeholder="${esc(mode)}"></div>`
      }).join(""):`<p class="muted">In „Produkte“ noch keine verwendeten Produkte aktiviert.</p>`}
    </div>
    ${photoPickerHTML(e.photoIds||[])}
  </div>`;
}
async function openEventForm(type="cleaning",id=null,aid=null){
  const e=id?state.events.find(x=>x.id===id):null;
  if(aid)state.selectedAquariumId=aid;
  showModal(e?"Ereignis bearbeiten":"Neues Ereignis",eventForm(e?.type||type,e||{}),
    `${e?`<button type="button" class="danger" data-action="delete-event" data-id="${e.id}">Löschen</button>`:""}
     <button type="button" class="ghost" data-action="cancel-modal">Abbrechen</button>
     <button type="button" class="primary" data-action="save-event" data-id="${e?.id||""}">Speichern</button>`);
  await bindPhotoPicker(e?.photoIds||[]);
  updateEventSections();
  document.getElementById("evType").addEventListener("change",updateEventSections);
}
function updateEventSections(){
  const t=document.getElementById("evType")?.value;
  document.getElementById("analysisBlock")?.classList.toggle("hidden",t!=="analysis");
  document.getElementById("productsBlock")?.classList.toggle("hidden",!["cleaning","dosing"].includes(t));
  document.getElementById("waterField")?.classList.toggle("hidden",t!=="cleaning");
}
function doseToInventory(p,dose){
  if(p.doseMode==="pump")return Number(dose||0)*Number(p.pumpMl||0);
  return Number(dose||0);
}
async function saveEvent(id){
  const old=id?state.events.find(x=>x.id===id):null;
  if(old)reverseInventory(old);
  const photoIds=await persistStagedPhotos();
  if(old)for(const pid of (old.photoIds||[]).filter(x=>!photoIds.includes(x)))await deletePhoto(pid);
  const products=[...document.querySelectorAll("[data-dose]")].map(inp=>{
    const p=productById(inp.dataset.dose),dose=Number(inp.value)||0;
    return {productId:p.id,dose,inventoryAmount:doseToInventory(p,dose)}
  }).filter(x=>x.dose>0);
  const analysis={};document.querySelectorAll("[data-analysis-value]").forEach(inp=>{if(inp.value.trim())analysis[inp.dataset.analysisValue]=inp.value.trim()});
  const obj={...(old||{}),id:id||uid("ev"),aquariumId:document.getElementById("evAquarium").value,
    type:document.getElementById("evType").value,date:document.getElementById("evDate").value||todayISO(),
    time:document.getElementById("evTime").value,waterLiters:Number(document.getElementById("evWater")?.value)||0,
    notes:document.getElementById("evNotes").value.trim(),analysis,products,photoIds,createdAt:old?.createdAt||Date.now()};
  applyInventory(obj);
  if(old)Object.assign(old,obj);else state.events.push(obj);
  state.selectedAquariumId=obj.aquariumId;save();closeModal();render();toast("Ereignis gespeichert");
}
function applyInventory(e){
  (e.products||[]).forEach(x=>{const p=productById(x.productId);if(p?.tracked)p.currentAmount=Math.max(0,Number(p.currentAmount||0)-Number(x.inventoryAmount||0))});
}
function reverseInventory(e){
  (e.products||[]).forEach(x=>{const p=productById(x.productId);if(p?.tracked)p.currentAmount=Number(p.currentAmount||0)+Number(x.inventoryAmount||0)});
}
async function deleteEvent(id){
  const e=state.events.find(x=>x.id===id);if(!e||!confirm("Dieses Ereignis löschen?"))return;
  reverseInventory(e);for(const pid of e.photoIds||[])await deletePhoto(pid);
  state.events=state.events.filter(x=>x.id!==id);save();closeModal();render();toast("Ereignis gelöscht");
}
async function openEventDetails(id){
  const e=state.events.find(x=>x.id===id);if(!e)return;
  const a=aquariumById(e.aquariumId),m=TYPE_META[e.type];
  const productRows=(e.products||[]).map(x=>{const p=productById(x.productId);return `<li>${esc(p?.name||"Produkt")}: ${fmtNum(x.dose)} ${p?.doseMode==="pump"?"Hübe":esc(p?.unit||"")}</li>`}).join("");
  const analysisRows=Object.entries(e.analysis||{}).map(([k,v])=>`<li>${esc(ANALYSIS_FIELDS.find(x=>x[0]===k)?.[1]||k)}: ${esc(v)}</li>`).join("");
  const photos=[];
  for(const pid of e.photoIds||[]){const p=await getPhoto(pid);if(p)photos.push(p)}
  showModal(`${m.icon} ${m.label}`,`<div class="panel"><p><strong>${esc(a?.name||"")}</strong><br>${formatDate(e.date)}${e.time?` · ${esc(e.time)}`:""}</p>
    ${e.waterLiters?`<p>Wasserwechsel: <strong>${fmtNum(e.waterLiters)} Liter</strong></p>`:""}
    ${e.notes?`<p>${esc(e.notes)}</p>`:""}${productRows?`<h3>Produkte</h3><ul>${productRows}</ul>`:""}${analysisRows?`<h3>Wasserwerte</h3><ul>${analysisRows}</ul>`:""}</div>
    ${photos.length?`<div class="photo-preview">${photos.map(p=>`<figure class="photo-tile"><img src="${p.dataUrl}" alt="${esc(p.name)}"><figcaption>${esc(p.name)}</figcaption></figure>`).join("")}</div>`:""}`,
    `<button type="button" class="primary" data-action="edit-event" data-id="${id}">✏️ Bearbeiten</button>`);
}

function productForm(p={}){
  return `<div class="form-grid">
    <div class="field full"><label>Produktname *</label><input id="prName" value="${esc(p.name||"")}"></div>
    <div class="field"><label>Kategorie</label><input id="prCategory" value="${esc(p.category||"")}"></div>
    <div class="field"><label>Dosierungseinheit</label><select id="prMode" class="select">
      <option value="ml" ${p.doseMode==="ml"?"selected":""}>ml</option><option value="pump" ${p.doseMode==="pump"?"selected":""}>Hübe</option>
      <option value="tablet" ${p.doseMode==="tablet"?"selected":""}>Tabletten</option><option value="g" ${p.doseMode==="g"?"selected":""}>g</option>
      <option value="spoon" ${p.doseMode==="spoon"?"selected":""}>Messlöffel</option></select></div>
    <div class="field"><label>Bestandseinheit</label><input id="prUnit" value="${esc(p.unit||"ml")}"></div>
    <div class="field"><label>Packungs-/Flaschengröße</label><input id="prSize" type="number" min="0" step="0.01" value="${p.packageSize||""}"></div>
    <div class="field"><label>Aktueller Inhalt</label><input id="prCurrent" type="number" min="0" step="0.01" value="${p.currentAmount||""}"></div>
    <div class="field"><label>ml je Hub</label><input id="prPump" type="number" min="0" step="0.01" value="${p.pumpMl||1}"></div>
    <div class="field full"><label class="toggle-label"><input id="prUsed" type="checkbox" ${p.used?"checked":""}>☑ Bei Reinigung verwenden</label></div>
    <div class="field full"><label class="toggle-label"><input id="prTracked" type="checkbox" ${p.tracked?"checked":""}>🧴 Bestand verfolgen</label></div>
  </div>`;
}
function openProductForm(id=null){
  const p=id?productById(id):null;
  showModal(p?"Produkt bearbeiten":"Eigenes Produkt",productForm(p||{}),
    `${p?.custom?`<button type="button" class="danger" data-action="delete-product" data-id="${p.id}">Löschen</button>`:""}
     <button type="button" class="ghost" data-action="cancel-modal">Abbrechen</button><button type="button" class="primary" data-action="save-product" data-id="${p?.id||""}">Speichern</button>`);
}
function saveProduct(id){
  const name=document.getElementById("prName").value.trim();if(!name)return toast("Produktname fehlt.");
  const p=id?productById(id):null,mode=document.getElementById("prMode").value;
  const obj={...(p||{}),id:id||uid("pr"),name,category:document.getElementById("prCategory").value.trim(),
    doseMode:mode,unit:document.getElementById("prUnit").value.trim()||(mode==="g"?"g":"ml"),
    packageSize:Number(document.getElementById("prSize").value)||0,currentAmount:Number(document.getElementById("prCurrent").value)||0,
    pumpMl:Number(document.getElementById("prPump").value)||1,used:document.getElementById("prUsed").checked,
    tracked:document.getElementById("prTracked").checked,custom:p?.custom??true,createdAt:p?.createdAt||Date.now()};
  if(p)Object.assign(p,obj);else state.products.push(obj);save();closeModal();render();toast("Produkt gespeichert");
}
function deleteProduct(id){
  const p=productById(id);if(!p?.custom||!confirm("Eigenes Produkt löschen?"))return;
  state.products=state.products.filter(x=>x.id!==id);save();closeModal();render();toast("Produkt gelöscht");
}

function openSortDialog(){
  showModal("Aquarien sortieren",`<p class="muted">Benutzerdefiniert ermöglicht Drag & Drop direkt im Dashboard.</p>
    <select id="modalSort" class="select">${document.getElementById("sortMode").innerHTML}</select>`,
    `<button type="button" class="ghost" data-action="cancel-modal">Abbrechen</button><button type="button" class="primary" data-action="apply-sort">Übernehmen</button>`);
  document.getElementById("modalSort").value=state.sortMode;
}
function exportData(){
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`AquaTracker-Backup-${todayISO()}.json`;a.click();URL.revokeObjectURL(a.href);
}
async function importData(file){
  try{const parsed=JSON.parse(await file.text());if(!parsed.aquariums||!parsed.events)throw new Error();
    state={...defaultState(),...parsed,products:mergeProducts(parsed.products||[])};save();render();toast("Daten importiert");
  }catch{toast("Ungültige Sicherungsdatei")}
}

document.addEventListener("click",async e=>{
  const nav=e.target.closest("[data-nav]");if(nav){navigate(nav.dataset.nav);return}
  const btn=e.target.closest("[data-action]");if(!btn)return;
  const a=btn.dataset.action,id=btn.dataset.id;
  if(a==="new-aquarium")openAquariumForm();
  if(a==="edit-aquarium"){closeModal();openAquariumForm(id)}
  if(a==="save-aquarium")await saveAquarium(id);
  if(a==="delete-aquarium")await deleteAquarium(id);
  if(a==="open-aquarium")openAquariumDetails(id);
  if(a==="new-event"){closeModal();openEventForm(btn.dataset.type||"cleaning",null,btn.dataset.aquarium)}
  if(a==="edit-event"){closeModal();openEventForm("cleaning",id)}
  if(a==="open-event")openEventDetails(id);
  if(a==="save-event")await saveEvent(id);
  if(a==="delete-event")await deleteEvent(id);
  if(a==="new-product")openProductForm();
  if(a==="edit-product")openProductForm(id);
  if(a==="save-product")saveProduct(id);
  if(a==="delete-product")deleteProduct(id);
  if(a==="cancel-modal")closeModal();
  if(a==="sort-aquariums")openSortDialog();
  if(a==="apply-sort"){state.sortMode=document.getElementById("modalSort").value;save();closeModal();render()}
  if(a==="export-data")exportData();
  if(a==="reset-data"&&confirm("Wirklich alle AquaTracker-Daten löschen?")){localStorage.removeItem(DB_KEY);indexedDB.deleteDatabase(PHOTO_DB);state=defaultState();save();render();toast("Daten gelöscht")}
  if(a==="open-shop")window.open("https://www.dennerle.com/","_blank","noopener");
});
document.addEventListener("click",e=>{
  const r=e.target.closest("[data-remove-photo]");if(r){stagedPhotos.splice(Number(r.dataset.removePhoto),1);renderPhotoPreview()}
});
document.addEventListener("change",e=>{
  if(e.target.matches("[data-product-toggle]")){const p=productById(e.target.dataset.id);p[e.target.dataset.productToggle]=e.target.checked;save();render()}
  if(e.target.matches("[data-analysis]")){const id=e.target.dataset.analysis;state.analysisFields=e.target.checked?[...new Set([...state.analysisFields,id])]:state.analysisFields.filter(x=>x!==id);save()}
  if(e.target.id==="sortMode"){state.sortMode=e.target.value;save();render()}
  if(e.target.id==="historyFilter")renderHistory();
  if(e.target.id==="importFile"&&e.target.files[0])importData(e.target.files[0]);
});
document.getElementById("prevMonth").onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()-1,1);renderCalendar()};
document.getElementById("nextMonth").onclick=()=>{currentMonth=new Date(currentMonth.getFullYear(),currentMonth.getMonth()+1,1);renderCalendar()};
document.getElementById("todayMonth").onclick=()=>{currentMonth=new Date(new Date().getFullYear(),new Date().getMonth(),1);renderCalendar()};
document.getElementById("calendarGrid").addEventListener("click",e=>{
  const day=e.target.closest("[data-date]");if(!day)return;
  const evs=state.events.filter(x=>x.date===day.dataset.date).sort((a,b)=>b.time.localeCompare(a.time));
  renderEventList(document.getElementById("calendarEvents"),evs);
});
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();installPrompt=e;document.getElementById("installBtn").classList.remove("hidden")});
document.getElementById("installBtn").onclick=async()=>{if(installPrompt){installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;document.getElementById("installBtn").classList.add("hidden")}};
if("serviceWorker" in navigator)window.addEventListener("load",()=>navigator.serviceWorker.register("./service-worker.js").catch(console.error));

save();navigate("dashboard");
})();