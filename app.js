/* CS Empreiteira - Gestão de Ativos 1.0
   Front-end inicial. Persistência local via IndexedDB.
   Integração com Apps Script: configurar API_URL e autenticação antes da produção. */
const API_URL = ""; // Cole aqui a URL /exec do Web App Apps Script após implantação.
const DB_NAME = "CS_Gestao_Ativos_1_0";
const DB_VERSION = 1;
let db, selectedAsset = null, stream = null, detector = null;
const $ = id => document.getElementById(id);
const nowISO = () => new Date().toISOString();
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

function openDB(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const d=req.result;
      if(!d.objectStoreNames.contains("assets")) d.createObjectStore("assets",{keyPath:"code"});
      if(!d.objectStoreNames.contains("movements")) d.createObjectStore("movements",{keyPath:"operationId"});
      if(!d.objectStoreNames.contains("settings")) d.createObjectStore("settings",{keyPath:"key"});
    };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
function store(name,mode="readonly"){return db.transaction(name,mode).objectStore(name)}
function put(name,value){return new Promise((res,rej)=>{const r=store(name,"readwrite").put(value);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function get(name,key){return new Promise((res,rej)=>{const r=store(name).get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
function all(name){return new Promise((res,rej)=>{const r=store(name).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error)})}
async function seed(){
  const existing=await all("assets"); if(existing.length) return;
  const demo=[
    {code:"EQP00001",name:"Furadeira de impacto",location:"Almoxarifado Central",status:"DISPONIVEL",holder:""},
    {code:"EQP00002",name:"Esmerilhadeira",location:"Frente 301",status:"EM_POSSE",holder:"10018"},
    {code:"EQP00003",name:"Martelete",location:"Almoxarifado Central",status:"MANUTENCAO",holder:""}
  ];
  for(const a of demo) await put("assets",a);
  await put("settings",{key:"front",name:"Frente 301",work:"CS Empreiteira",device:"Tablet Almoxarifado A",adminConfigured:false});
}
async function render(){
  const assets=await all("assets"), movements=(await all("movements")).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $("mTotal").textContent=assets.length;
  $("mAvailable").textContent=assets.filter(a=>a.status==="DISPONIVEL").length;
  $("mHeld").textContent=assets.filter(a=>a.status==="EM_POSSE").length;
  $("mMaintenance").textContent=assets.filter(a=>a.status==="MANUTENCAO").length;
  const cfg=await get("settings","front");
  $("frontName").textContent=cfg?.name||"Frente não configurada";
  $("frontWork").textContent=cfg?.work||"CS Empreiteira";
  $("movementRows").innerHTML=movements.length?movements.slice(0,15).map(m=>`<tr><td>${new Date(m.createdAt).toLocaleString("pt-BR")}</td><td>${escapeHTML(m.assetCode)}</td><td>${escapeHTML(m.type)}</td><td>${escapeHTML(m.employeeCode)}</td><td>${escapeHTML(m.front)}</td><td>${m.syncStatus==="SYNCED"?"Sincronizado":"Pendente"}</td></tr>`).join(""):'<tr><td colspan="6" class="muted">Nenhuma movimentação neste dispositivo.</td></tr>';
  $("pendingCount").textContent=`${movements.filter(m=>m.syncStatus!=="SYNCED").length} pendentes`;
  $("connection").textContent=navigator.onLine?"Conectado":"Offline";
}
function escapeHTML(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
async function lookup(){
  const code=$("assetCode").value.trim().toUpperCase(), a=await get("assets",code);
  selectedAsset=a||null;
  if(!a){$("assetCard").className="asset-card empty";$("assetCard").innerHTML='<div class="empty-icon">⚠</div><h3>Equipamento não encontrado</h3><p>Verifique o código ou sincronize o cadastro.</p>';return}
  const st=a.status==="DISPONIVEL"?'<span class="status">DISPONÍVEL</span>':a.status==="EM_POSSE"?'<span class="status held">EM POSSE</span>':'<span class="status maintenance">MANUTENÇÃO</span>';
  $("assetCard").className="asset-card";
  $("assetCard").innerHTML=`<div class="eyebrow">EQUIPAMENTO IDENTIFICADO</div><div class="asset-code">${escapeHTML(a.code)}</div><h3>${escapeHTML(a.name)}</h3>${st}<p>Localização: ${escapeHTML(a.location||"Não informada")}</p><p>${a.holder?`Matrícula em posse: ${escapeHTML(a.holder)}`:"Sem responsável vinculado"}</p>`;
}
function message(text,type=""){ $("operationMessage").textContent=text; $("operationMessage").className=`message ${type}`; }
async function submitMovement(){
  if(!selectedAsset){message("Leia ou consulte um equipamento antes de registrar.","error");return}
  const employee=$("employeeCode").value.trim(), type=$("movementType").value, condition=$("returnCondition").value;
  if(!employee){message("Informe a matrícula do colaborador.","error");return}
  const cfg=await get("settings","front");
  if(!cfg?.name){message("Frente ativa não configurada pelo ADMIN neste tablet.","error");return}
  const a=await get("assets",selectedAsset.code);
  if(type==="RETIRADA"&&a.status!=="DISPONIVEL"){message("Retirada bloqueada: equipamento não está disponível neste cadastro local. Validação central obrigatória para confirmação.","error");return}
  if(type==="DEVOLUCAO"&&(a.status!=="EM_POSSE"||a.holder!==employee)){message("Devolução bloqueada: matrícula não corresponde à posse local registrada.","error");return}
  if(type==="TRANSFERENCIA_SAIDA"&&a.status!=="DISPONIVEL"){message("Transferência de saída exige equipamento disponível ou fluxo de encerramento da posse.","error");return}
  if(type==="TRANSFERENCIA_RECEBIMENTO"&&!$("destinationFront").value){message("Selecione a frente de destino.","error");return}
  const operationId=uuid(), movement={operationId,assetCode:a.code,type,employeeCode:employee,front:cfg.name,work:cfg.work,device:cfg.device,createdAt:nowISO(),syncStatus:"PENDING",condition:type==="DEVOLUCAO"?condition:"",destinationFront:$("destinationFront").value||""};
  await put("movements",movement);
  if(type==="RETIRADA") await put("assets",{...a,status:"EM_POSSE",holder:employee});
  if(type==="DEVOLUCAO") await put("assets",{...a,status:condition==="BOM"?"DISPONIVEL":"MANUTENCAO",holder:""});
  if(type==="AVARIA") await put("assets",{...a,status:"MANUTENCAO"});
  selectedAsset=await get("assets",a.code); await render(); await lookup();
  message(`Apontamento gravado localmente. ID da operação: ${operationId}. Aguardando validação/sincronização central.`, "success");
  syncPending();
}
async function syncPending(){
  if(!navigator.onLine||!API_URL) return;
  // A integração autenticada do backend deve ser habilitada antes de produção.
  // Não marcar como sincronizado sem confirmação explícita do servidor.
}
async function startCamera(){
  if(!("BarcodeDetector" in window)){message("Este navegador não oferece BarcodeDetector. Use a entrada manual do código ou integre uma biblioteca QR local.","error");return}
  try{
    detector=new BarcodeDetector({formats:["qr_code"]});
    stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment"}});
    $("camera").srcObject=stream; $("camera").hidden=false; await $("camera").play();
    $("startScan").disabled=true;$("stopScan").disabled=false;
    const tick=async()=>{if(!stream)return;try{const codes=await detector.detect($("camera"));if(codes.length){$("assetCode").value=String(codes[0].rawValue).trim().toUpperCase();stopCamera();await lookup();}}catch(e){} if(stream)requestAnimationFrame(tick)};
    tick();
  }catch(e){message("Não foi possível abrir a câmera. Verifique a permissão do navegador e use HTTPS.","error")}
}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}$("camera").hidden=true;$("startScan").disabled=false;$("stopScan").disabled=true}
function adminLogin(){
  // Demonstração local apenas. Substituir por autenticação real validada no servidor.
  const pass=prompt("Senha ADMIN de demonstração:");
  if(pass==="CSADMIN-ALTERAR"){ $("adminPanel").classList.remove("hidden"); $("adminLoginBtn").classList.add("hidden"); }
  else if(pass!==null) alert("Acesso não autorizado.");
}
async function saveFront(){
  const cfg={key:"front",name:$("adminFront").value,work:$("adminWork").value.trim()||"CS Empreiteira",device:$("adminDevice").value.trim()||"Tablet sem nome",adminConfigured:true,updatedAt:nowISO()};
  await put("settings",cfg); await render(); alert("Frente salva localmente neste tablet. Na versão de produção, o servidor deverá validar e distribuir a autorização.");
}
async function addAsset(){
  const code=$("newAssetCode").value.trim().toUpperCase(),name=$("newAssetName").value.trim(),location=$("newAssetLocation").value.trim();
  if(!/^EQP\d{5,}$/.test(code)||!name){alert("Informe um código como EQP00001 e uma descrição.");return}
  if(await get("assets",code)){alert("Código já cadastrado neste tablet.");return}
  await put("assets",{code,name,location,status:"DISPONIVEL",holder:""}); await render(); alert("Equipamento adicionado ao cadastro local de demonstração.");
}
$("lookupBtn").onclick=lookup;$("assetCode").addEventListener("keydown",e=>{if(e.key==="Enter")lookup()});
$("submitMovement").onclick=submitMovement;$("startScan").onclick=startCamera;$("stopScan").onclick=stopCamera;
$("adminLoginBtn").onclick=adminLogin;$("adminLogoutBtn").onclick=()=>{$("adminPanel").classList.add("hidden");$("adminLoginBtn").classList.remove("hidden")};
$("saveFrontBtn").onclick=saveFront;$("addAssetBtn").onclick=addAsset;
$("movementType").onchange=()=>{$("conditionWrap").classList.toggle("hidden",$("movementType").value!=="DEVOLUCAO");$("destinationWrap").classList.toggle("hidden",$("movementType").value!=="TRANSFERENCIA_RECEBIMENTO")};
window.addEventListener("online",()=>{render();syncPending()});window.addEventListener("offline",render);
(async()=>{db=await openDB();await seed();await render();if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});})();
