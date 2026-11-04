'use strict';
const $ = (id) => document.getElementById(id);
const escapeHTML = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state = null, busy = false, refreshGeneration = 0, disconnected = false;
const rendered = new Map();
function setHTML(id, html) {
  if (rendered.get(id) !== html) { $(id).innerHTML = html; rendered.set(id, html); }
}
function participants() {
  const {source_id, target_id} = pair();
  const confirmed = new Set(state.confirmed.filter(r=>r.target_id===target_id).map(r=>r.user_id));
  const contacts = state.contacts.filter(p=>p.source_id===source_id);
  const selected = contacts.filter(p=>p.selected && p.can_use!==false && !confirmed.has(p.user_id));
  return {contacts, confirmed, selected, ready:selected};
}
const labels = {queued:'Na fila',running:'Em andamento',paused:'Pausado',paused_restriction:'Aguardando liberação',restricted:'Restrição registrada',completed:'Concluído',cancelled:'Cancelado',interrupted:'Interrompido no reinício',failed:'Interrompido por falha',waiting:'Aguardando',in_progress:'Verificando',added:'Adicionado',already:'Já participava',privacy:'Recusado por privacidade',error:'Falha',uncertain:'Conferir no Telegram',revoked:'Fora da seleção',excluded_admin:'Administrador excluído',not_in_source:'Fora da origem',flood_wait:'Espera solicitada',permission:'Permissão necessária',auth_required:'Reconectar conta'};
const activeStates = ['queued','running','paused','paused_restriction'];
function pill(value) { const type = ['added','already','completed'].includes(value) ? 'good' : ['privacy','failed','restricted','error','uncertain'].includes(value) ? 'bad' : 'warn'; return `<span class="pill ${type}">${escapeHTML(labels[value] || value)}</span>`; }
function notice(message, error = false) { $('notice').hidden = false; $('notice').textContent = message; $('notice').className = error ? 'error' : ''; }
function pair() { return {source_id:Number($('source').value),target_id:Number($('target').value)}; }
function syncOptions(id, groups) {
  const selected = $(id).value;
  const html = groups.map(g=>`<option value="${g.id}">${escapeHTML(g.name)}</option>`).join('');
  if ($(id).dataset.options!==html) {
    $(id).innerHTML = html;
    $(id).dataset.options = html;
    if (groups.some(g=>String(g.id)===selected)) $(id).value=selected;
  }
}
async function request(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(()=>controller.abort(),35000);
  try {
    const response = await fetch(path.replace(/^\/api\//,'/api/telegram/'), {signal:controller.signal,...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state?.csrf_token || '', 'X-Telegram-Context':state?.connection?.context_id || ''},body:JSON.stringify(body)})});
    if(response.redirected&&new URL(response.url).pathname==='/login'){window.top.location.assign('/login?callbackUrl='+encodeURIComponent('/areas/growth/papeis/telegram'));throw new Error('Entre novamente no app BFF Fitness.');}
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a operação.');
    return data;
  } catch (error) {
    if (error.name==='AbortError') throw new Error('A operação demorou demais. Confira o resultado antes de repetir.');
    throw error;
  } finally { clearTimeout(timeout); }
}
async function act(fn) {
  if (busy) return;
  busy = true; render();
  let recorded = false;
  try { await fn(); recorded = true; await refresh(); }
  catch (error) {
    let refreshed = false;
    try { await refresh(); refreshed = true; } catch {}
    notice(recorded ? (refreshed ? 'Ação registrada. Painel atualizado.' : 'Ação registrada. Aguarde a reconexão do painel antes de repetir.') : error.message, !recorded);
  }
  finally { busy = false; render(); }
}
async function refresh() {
  const generation = ++refreshGeneration;
  let next;
  try { next = await request('/api/state'); }
  catch (error) { if (generation===refreshGeneration) disconnected = true; throw error; }
  if (generation!==refreshGeneration) return;
  const previousJob = state?.jobs[0];
  state = next;
  for (const [id, groups] of [['source',state.sources],['target',state.targets]]) {
    syncOptions(id,groups);
  }
  const job = state.jobs[0];
  if (disconnected) { notice('Conexão com o painel restabelecida.'); disconnected = false; }
  else if (job && (!previousJob || previousJob.id!==job.id || previousJob.state!==job.state) &&
           ['completed','cancelled','interrupted','failed','restricted'].includes(job.state)) {
    notice(job.message,['failed','restricted'].includes(job.state));
  }
  render();
}
function render() {
  if (!state) return;
  const {source_id, target_id} = pair();
  const {contacts, confirmed, ready, selected} = participants();
  const job = state.jobs[0];
  const active = state.jobs.some(j=>activeStates.includes(j.state));
  const limited = state.limits.restricted || state.limits.not_before>Date.now()/1000;
  $('export-contacts').href='/api/telegram/export/contacts.csv?account_context='+encodeURIComponent(state.connection?.context_id || '');
  $('mode').textContent = state.connection?.operation_notice ? 'TELEGRAM PAUSADO' : state.connection?.state==='connected' ? 'TELEGRAM CONECTADO' : 'CONECTE SUA CONTA';
  $('mode-help').textContent = state.mode==='demo' ? 'Dados fictícios para conhecer o fluxo. Conecte sua conta acima para escolher seus grupos reais.' : 'Conexão real com sua comunidade privada. Consulte a origem e escolha os participantes.';
  $('count-total').textContent = contacts.length;
  $('count-ready').textContent = ready.length;
  const results = job ? state.results.filter(r=>r.job_id===job.id) : [];
  $('count-added').textContent = job?.added || 0;
  $('count-existing').textContent = job?.already || 0;
  $('collect').disabled = busy || active || limited || !!state.connection?.operation_notice || !state.connection?.configured || !source_id || !target_id;
  $('start').disabled = busy || disconnected || active || limited || !!state.connection?.operation_notice || !ready.length || ready.length!==selected.length;
  $('select-ready').disabled = busy || active || !contacts.some(p=>p.can_use!==false);
  $('source').disabled = busy || active; $('target').disabled = busy || active;
  if (state.limits.restricted) $('mode-help').textContent += ' Restrição registrada: revise a situação da conta antes de continuar.';
  else if (limited) $('mode-help').textContent += ` Espera em vigor até ${new Date(state.limits.not_before*1000).toLocaleString('pt-BR')}.`;
  $('selection-label').textContent = `${selected.length} selecionado(s) · ${ready.length} pronto(s) para o destino escolhido.`;
  const query = $('search').value.toLocaleLowerCase('pt-BR');
  const shown = contacts.filter(p=>`${p.name} ${p.username} ${p.user_id}`.toLocaleLowerCase('pt-BR').includes(query));
  setHTML('contacts',shown.map(p=>{
    const last = state.last_results.find(r=>r.user_id===p.user_id && r.target_id===target_id);
    return `<tr><td><input type="checkbox" data-select="${p.user_id}" aria-label="Selecionar ${escapeHTML(p.name)}" ${p.selected&&p.can_use!==false&&!confirmed.has(p.user_id)?'checked':''} ${busy||active||p.can_use===false||confirmed.has(p.user_id)?'disabled':''}></td><td><b>${escapeHTML(p.name || 'Sem nome')}</b><small>${p.username?'@'+escapeHTML(p.username)+' · ':''}${p.user_id}</small></td><td>${last?pill(last.state):confirmed.has(p.user_id)?'<span class="pill good">Confirmado anteriormente</span>':p.can_use===false?'<span class="pill warn">Consulte a origem novamente</span>':'<span class="pill">Ainda não processado</span>'}</td></tr>`;
  }).join('') || `<tr><td colspan="3" class="empty">${contacts.length?'Nenhum participante encontrado na busca.':'Clique em “Consultar participantes” para começar.'}</td></tr>`);
  setHTML('job-actions',job ? (['queued','running'].includes(job.state)?'<button class="secondary" data-control="pause">Pausar</button>':['paused','paused_restriction'].includes(job.state)?'<button class="secondary" data-control="resume">Retomar restantes</button>':'')+(activeStates.includes(job.state)?'<button class="danger" data-control="cancel">Cancelar</button>':'') : '');
  for(const button of document.querySelectorAll('[data-control="resume"]')) button.disabled=!!state.connection?.operation_notice;
  const jobAccount=typeof job?.accountId==='number' ? state.connection?.accounts?.find(profile=>profile.account?.id===job.accountId) : undefined;
  setHTML('job-summary',job ? `${pill(job.state)} <b>${job.processed} de ${job.total} processado(s)</b> · ${job.success} participação(ões) confirmada(s) · ${job.failed} ocorrência(s)${jobAccount?`<p class="hint">Conta da operação: ${escapeHTML(jobAccount.label)}</p>`:''}<div class="progress"><progress max="${job.total}" value="${job.processed}" aria-label="Progresso da operação"></progress></div><span>${escapeHTML(job.message)}</span>${job.not_before>Date.now()/1000?`<p class="hint">Retomada disponível após ${escapeHTML(new Date(job.not_before*1000).toLocaleString('pt-BR'))}. A fila não retoma sozinha.</p>`:''}` : 'Sua próxima operação aparecerá aqui.');
  setHTML('results',results.map(r=>`<tr><td>${escapeHTML(r.name)}<small>${r.user_id}</small></td><td>${pill(r.state)}</td><td>${escapeHTML(r.message)}</td></tr>`).join(''));
  if (typeof renderSetup==='function') renderSetup(active);
  if (typeof renderDiscovery==='function') renderDiscovery(active,limited);
}
$('collect').addEventListener('click',()=>act(async()=>{const r=await request('/api/collect',pair());notice(`${r.received} participante(s) encontrado(s). Revise a lista abaixo.`);}));
$('source').addEventListener('change',render); $('target').addEventListener('change',render); $('search').addEventListener('input',render);
$('contacts').addEventListener('change',event=>{if(event.target.dataset.select) { const body={user_id:Number(event.target.dataset.select),selected:event.target.checked,source_id:pair().source_id}; act(()=>request('/api/selection',body)); }});
$('select-ready').addEventListener('click',()=>{const body=pair();act(async()=>{const result=await request('/api/selection/bulk',body);notice(`${result.selected} participante(s) selecionado(s).`);});});
$('start').addEventListener('click',()=>{const body={...pair(),user_ids:participants().ready.map(p=>p.user_id)};act(async()=>{await request('/api/jobs',body);notice('Operação iniciada. Acompanhe cada resultado abaixo.');});});
$('job-actions').addEventListener('click',event=>{if(event.target.dataset.control)act(()=>request('/api/control',{job_id:state.jobs[0].id,action:event.target.dataset.control}));});
async function poll() {
  try { if(!busy) await refresh(); }
  catch(error) { notice(error.message,true); }
  finally { setTimeout(poll,document.hidden?15000:3000); }
}
poll();
