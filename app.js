/* CS EMPREITEIRA | Gestão de Ativos 1.0
   Frontend integrado ao Apps Script. Operações só são confirmadas pelo servidor.
*/
const API_URL = "https://script.google.com/macros/s/AKfycbySOPR_9Th0svtXpD4h1Luu4ajH05LwkOj0oXBFcmf_m7-LeAkkHD1x1Ifx6cL1_EDI/exec";
const DEVICE_KEY = "CSGA_DEVICE_ID";
const $ = id => document.getElementById(id);
const state = {adminToken:"", selectedEmployee:null, asset:null, scanner:null, scanTarget:""};
const makeId = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : (Date.now()+"-"+Math.random().toString(16).slice(2));
const deviceId = localStorage.getItem(DEVICE_KEY) || (()=>{const x="TAB-"+makeId();localStorage.setItem(DEVICE_KEY,x);return x;})();
const nowLocal = () => {const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`};
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function jsonp(params){
  return new Promise((resolve,reject)=>{
    const cb="csgacb_"+Math.random().toString(36).slice(2);
    const script=document.createElement("script");
    const timer=setTimeout(()=>{cleanup();reject(new Error("Tempo esgotado ao consultar o servidor."))},20000);
    function cleanup(){clearTimeout(timer);delete window[cb];script.remove()}
    window[cb]=data=>{cleanup();data&&data.ok===false?reject(new Error(data.message||"Falha no servidor.")):resolve(data)};
    const q=new URLSearchParams({...params,callback:cb});
    script.src=API_URL+"?"+q.toString();
    script.onerror=()=>{cleanup();reject(new Error("Não foi possível acessar o servidor."))};
    document.body.appendChild(script);
  });
}

/* POST via formulário/iframe evita depender de CORS em chamadas fetch cross-origin.
   O Apps Script responde com uma página que envia o resultado por postMessage. */
function postApi(payload){
  return new Promise((resolve,reject)=>{
    const frame=$("gasResponseFrame");
    const form=document.createElement("form");
    const requestId=(window.crypto&&crypto.randomUUID)?crypto.randomUUID():("REQ-"+Date.now()+"-"+Math.random().toString(16).slice(2));
    const body={...payload,requestId};
    form.method="POST";form.action=API_URL;form.target=frame.name;form.style.display="none";
    const input=document.createElement("input");input.type="hidden";input.name="payload";input.value=JSON.stringify(body);form.appendChild(input);
    const timer=setTimeout(()=>{window.removeEventListener("message",correlated);form.remove();reject(new Error("Tempo esgotado na operação central."))},25000);
    function correlated(ev){
      let data=ev.data;
      if(typeof data==="string"){try{data=JSON.parse(data)}catch(_){return}}
      if(!data||data.requestId!==requestId)return;
      clearTimeout(timer);window.removeEventListener("message",correlated);form.remove();
      if(data.ok)resolve(data);else reject(new Error(data.message||"Operação recusada pelo servidor."));
    }
    window.addEventListener("message",correlated);
    document.body.appendChild(form);form.submit();
  });
}

function setMsg(id,text,type=""){const el=$(id);el.textContent=text;el.className="message "+type}
async function loadDashboard(){
  try{
    const d=await jsonp({action:"bootstrap",deviceId});
    $("connection").textContent="Servidor conectado";
    $("frontName").textContent=d.device?.front||"Frente não configurada";
    $("frontWork").textContent=d.device?.work||"Aguardando configuração ADMIN";
    $("mTotal").textContent=d.metrics.total;
    $("mAvailable").textContent=d.metrics.available;
    $("mHeld").textContent=d.metrics.held;
    $("mUnavailable").textContent=d.metrics.unavailable;
    $("movementRows").innerHTML=d.latest.length?d.latest.map(m=>`<tr><td>${esc(m.date)}</td><td>${esc(m.assetCode)}</td><td>${esc(m.employeeName)}</td><td>${esc(labelType(m.type))}</td><td>${esc(m.status)}</td></tr>`).join(""):'<tr><td colspan="5">Nenhuma movimentação encontrada.</td></tr>';
  }catch(e){$("connection").textContent="Sem conexão";setMsg("operationMessage",e.message,"error")}
}
function labelType(t){return ({RETIRADA:"Retirada",DEVOLUCAO:"Devolução",TRANSFERENCIA_SAIDA:"Transferência — saída",TRANSFERENCIA_RECEBIMENTO:"Transferência — recebimento",AVARIA:"Avaria"})[t]||t}

async function searchEmployees(){
  const q=$("employeeSearch").value.trim();
  if(q.length<2){$("employeeResults").textContent="Digite pelo menos duas letras do nome.";return}
  try{
    const d=await jsonp({action:"searchEmployees",q});
    $("employeeResults").innerHTML=d.items.length?d.items.map(e=>`<div class="result-item"><strong>${esc(e.name)}</strong><button class="button secondary" data-key="${esc(e.key)}" data-name="${esc(e.name)}">Gerar QR Code</button></div>`).join(""):"Nenhum colaborador ativo encontrado.";
    $("employeeResults").querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>issueQr(b.dataset.key,b.dataset.name)));
  }catch(e){$("employeeResults").textContent=e.message}
}
async function issueQr(key,name){
  try{
    const d=await postApi({action:"issueEmployeeQr",employeeKey:key});
    $("employeeQrName").textContent=name;
    $("employeeQrImage").innerHTML="";
    if(!window.QRCode)throw new Error("Biblioteca de QR Code indisponível. Verifique a internet.");
    new QRCode($("employeeQrImage"),{text:d.qrValue,width:220,height:220,correctLevel:QRCode.CorrectLevel.M});
    $("employeeQrPanel").classList.remove("hidden");
    setTimeout(()=>{$("employeeQrPanel").scrollIntoView({behavior:"smooth",block:"center"})},100);
  }catch(e){$("employeeResults").textContent=e.message}
}

async function lookupAsset(){
  const code=$("assetCode").value.trim().toUpperCase();
  if(!code){setMsg("operationMessage","Leia ou informe o código do equipamento.","error");return}
  try{
    const d=await jsonp({action:"getAsset",code});
    state.asset=d.asset;
    $("assetCard").className="asset-card";
    $("assetCard").innerHTML=`<div class="eyebrow">EQUIPAMENTO IDENTIFICADO</div><div class="asset-code">${esc(d.asset.code)}</div><h3>${esc(d.asset.name)}</h3><p>Situação: <strong>${esc(d.asset.statusLabel)}</strong></p><p>Localização: ${esc(d.asset.location||"Não informada")}</p><p>Responsável: ${esc(d.asset.holderName||"Sem responsável")}</p>`;
  }catch(e){state.asset=null;$("assetCard").className="asset-card empty";$("assetCard").textContent=e.message}
}
async function registerMovement(){
  if(!navigator.onLine){setMsg("operationMessage","Sem internet. Por segurança, retirada/devolução não pode ser confirmada offline.","error");return}
  const assetCode=$("assetCode").value.trim().toUpperCase();
  const employeeQr=$("employeeQrToken").value.trim();
  const type=$("movementType").value;
  if(!assetCode||!employeeQr){setMsg("operationMessage","Leia o QR Code do equipamento e o QR Code pessoal do colaborador.","error");return}
  const payload={action:"registerMovement",assetCode,employeeQr,type,condition:$("returnCondition").value,destinationFront:$("destinationFront").value.trim(),deviceId,requestId:makeId()};
  $("submitMovement").disabled=true;
  try{
    const d=await postApi(payload);
    setMsg("operationMessage",d.message||"Movimentação confirmada pelo servidor.","success");
    $("employeeQrToken").value="";$("assetCode").value="";$("destinationFront").value="";
    state.asset=null;$("assetCard").className="asset-card empty";$("assetCard").textContent="Movimentação registrada. Leia o próximo equipamento.";
    await loadDashboard();
  }catch(e){setMsg("operationMessage",e.message,"error")}
  finally{$("submitMovement").disabled=false}
}

async function startScan(target){
  if(!window.Html5Qrcode){setMsg("operationMessage","Leitor QR não carregado. Use a entrada manual ou verifique a internet.","error");return}
  stopScan();
  const id=target==="asset"?"cameraAsset":"cameraEmployee";
  const el=$(id);el.classList.add("active");
  const scanner=new Html5Qrcode(id);
  state.scanner=scanner;state.scanTarget=target;
  try{
    await scanner.start({facingMode:"environment"},{fps:10,qrbox:{width:230,height:230}},async text=>{
      stopScan();
      if(target==="asset"){$("assetCode").value=text.trim().toUpperCase();await lookupAsset()}
      else $("employeeQrToken").value=text.trim();
    });
    $(target==="asset"?"stopAssetScan":"stopEmployeeScan").classList.remove("hidden");
  }catch(e){el.classList.remove("active");setMsg("operationMessage","Não foi possível abrir a câmera. Verifique a permissão e use HTTPS.","error")}
}
async function stopScan(){
  if(state.scanner){try{if(state.scanner.isScanning)await state.scanner.stop();await state.scanner.clear()}catch(_){}state.scanner=null}
  ["cameraAsset","cameraEmployee"].forEach(id=>$(id).classList.remove("active"));
  $("stopAssetScan").classList.add("hidden");$("stopEmployeeScan").classList.add("hidden");
}

function showAdminLogin(){$("adminModal").classList.remove("hidden");$("adminPassword").value="";$("adminPassword").focus()}
async function adminLogin(){
  const password=$("adminPassword").value;
  if(!password){setMsg("adminLoginMessage","Informe a senha ADMIN.","error");return}
  try{
    const d=await postApi({action:"adminLogin",password,deviceId});
    state.adminToken=d.token;$("adminModal").classList.add("hidden");$("adminPanel").classList.remove("hidden");
    $("adminLoginBtn").classList.add("hidden");
    if(d.device){$("adminDevice").value=d.device.name||"";$("adminWork").value=d.device.work||"";$("adminFront").value=d.device.front||"";$("adminWarehouse").value=d.device.warehouse||""}
    setMsg("adminMessage","Acesso ADMIN autorizado.","success");
  }catch(e){setMsg("adminLoginMessage",e.message,"error")}
}
async function adminPost(action,extra={}){if(!state.adminToken)throw new Error("Sessão ADMIN encerrada. Entre novamente.");return postApi({action,adminToken:state.adminToken,deviceId,...extra})}
async function saveFront(){
  try{const d=await adminPost("saveDevice",{deviceName:$("adminDevice").value.trim(),work:$("adminWork").value.trim(),front:$("adminFront").value.trim(),warehouse:$("adminWarehouse").value.trim()});setMsg("adminMessage",d.message,"success");await loadDashboard()}
  catch(e){setMsg("adminMessage",e.message,"error")}
}
async function addAsset(){
  try{const d=await adminPost("addAsset",{code:$("newAssetCode").value.trim().toUpperCase(),name:$("newAssetName").value.trim(),category:$("newAssetCategory").value.trim(),location:$("newAssetLocation").value.trim()});setMsg("adminMessage",d.message,"success");["newAssetCode","newAssetName","newAssetCategory","newAssetLocation"].forEach(id=>$(id).value="");await loadDashboard()}
  catch(e){setMsg("adminMessage",e.message,"error")}
}
async function loadAdminEmployees(){
  try{
    const d=await adminPost("adminEmployees");
    $("adminEmployeeRows").innerHTML=d.items.map(e=>`<tr><td>${esc(e.name)}</td><td>${esc(e.matricula)}</td><td>${esc(e.qrStatus==="ATIVO"?"Emitido":"Não emitido")}</td><td>${esc(e.status)}</td><td><div class="button-row"><button class="button secondary" data-key="${esc(e.key)}" data-action="${e.qrStatus==="ATIVO"?"BLOCK":"ACTIVATE"}">${e.qrStatus==="ATIVO"?"Bloquear":"Ativar"}</button><button class="button secondary" data-key="${esc(e.key)}" data-action="REISSUE">Reemitir</button></div></td></tr>`).join("");
    $("adminEmployeeRows").querySelectorAll("button").forEach(b=>b.addEventListener("click",async()=>{try{if(b.dataset.action==="REISSUE"){const r=await adminPost("reissueEmployeeQr",{employeeKey:b.dataset.key});setMsg("adminMessage",r.message,"success");}else{await adminPost("setEmployeeQrStatus",{employeeKey:b.dataset.key,qrStatus:b.dataset.action==="BLOCK"?"BLOQUEADO":"ATIVO"});}await loadAdminEmployees()}catch(e){setMsg("adminMessage",e.message,"error")}}));
  }catch(e){setMsg("adminMessage",e.message,"error")}
}
async function generateReport(){
  const start=$("reportStart").value,end=$("reportEnd").value,type=$("reportType").value;
  if(!start||!end||start>end){setMsg("reportMessage","Informe um intervalo válido.","error");return}
  try{
    const d=await jsonp({action:"report",start,end,type});
    const rows=d.movements.map(m=>`<tr><td>${esc(m.date)}</td><td>${esc(m.assetCode)}</td><td>${esc(m.employeeName)}</td><td>${esc(labelType(m.type))}</td><td>${esc(m.front)}</td><td>${esc(m.status)}</td></tr>`).join("");
    const pending=d.pending.map(p=>`<tr><td>${esc(p.assetCode)}</td><td>${esc(p.employeeName)}</td><td>${esc(p.front)}</td><td>EM POSSE</td></tr>`).join("");
    const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>CS Empreiteira - Relatório de Ativos</title><style>
      body{font-family:Arial,sans-serif;color:#172b3a;margin:24px}h1,h2{color:#173b57}table{width:100%;border-collapse:collapse;margin:12px 0 24px}th,td{border:1px solid #ccd5dc;padding:7px;text-align:left;font-size:11px}th{background:#173b57;color:#fff}.meta{font-size:12px;color:#526575}@media print{body{margin:12mm}}
      </style></head><body><h1>CS EMPREITEIRA</h1><h2>Relatório de Gestão de Ativos</h2><p class="meta">Período: ${esc(start)} a ${esc(end)} · Emitido: ${esc(new Date().toLocaleString("pt-BR"))}</p>
      ${type!=="pendentes"?`<h2>Movimentações do período</h2><table><thead><tr><th>Data/hora</th><th>Equipamento</th><th>Colaborador</th><th>Operação</th><th>Frente</th><th>Situação</th></tr></thead><tbody>${rows||'<tr><td colspan="6">Nenhuma movimentação no período.</td></tr>'}</tbody></table>`:""}
      ${type==="todos"||type==="pendentes"?`<h2>Pendências atuais de devolução</h2><table><thead><tr><th>Equipamento</th><th>Colaborador</th><th>Frente</th><th>Situação</th></tr></thead><tbody>${pending||'<tr><td colspan="4">Nenhuma pendência.</td></tr>'}</tbody></table>`:""}
      <p class="meta">Relatório operacional consolidado pelo servidor central. Matrículas não são exibidas.</p><script>window.onload=()=>window.print();<\/script></body></html>`;
    const w=window.open("","_blank");if(!w)throw new Error("Permita pop-ups para gerar o PDF.");w.document.open();w.document.write(html);w.document.close();
    setMsg("reportMessage","Relatório central preparado. Na impressão, escolha Salvar como PDF.","success");
  }catch(e){setMsg("reportMessage",e.message,"error")}
}

$("searchEmployeeBtn").onclick=searchEmployees;
$("employeeSearch").addEventListener("keydown",e=>{if(e.key==="Enter")searchEmployees()});
$("closeEmployeeQr").onclick=()=>$("employeeQrPanel").classList.add("hidden");
$("scanAssetBtn").onclick=()=>startScan("asset");$("scanEmployeeBtn").onclick=()=>startScan("employee");
$("stopAssetScan").onclick=stopScan;$("stopEmployeeScan").onclick=stopScan;
$("assetCode").addEventListener("change",lookupAsset);$("submitMovement").onclick=registerMovement;
$("movementType").onchange=()=>{$("conditionWrap").classList.toggle("hidden",!["DEVOLUCAO","AVARIA"].includes($("movementType").value));$("destinationWrap").classList.toggle("hidden",$("movementType").value!=="TRANSFERENCIA_SAIDA")};
$("generateReportBtn").onclick=generateReport;$("refreshBtn").onclick=loadDashboard;
$("adminLoginBtn").onclick=showAdminLogin;$("adminCancel").onclick=()=>$("adminModal").classList.add("hidden");$("adminSubmit").onclick=adminLogin;
$("adminLogoutBtn").onclick=()=>{state.adminToken="";$("adminPanel").classList.add("hidden");$("adminLoginBtn").classList.remove("hidden")};
$("saveFrontBtn").onclick=saveFront;$("addAssetBtn").onclick=addAsset;$("loadEmployeesAdmin").onclick=loadAdminEmployees;
$("reportStart").value=nowLocal();$("reportEnd").value=nowLocal();
window.addEventListener("online",loadDashboard);
window.addEventListener("beforeunload",stopScan);
if("serviceWorker" in navigator)navigator.serviceWorker.register("./sw.js").catch(()=>{});
loadDashboard();
