'use strict';
let setupLastStage = null, setupParticipantsLoaded = false, setupProtectId = null;
const setupLabels = {disconnected:'Desconectado',saved:'Sessão salva',code:'Aguardando código',password:'Verificação em duas etapas',connected:'Conta conectada',qr:'Aguardando leitura do QR Code',qr_error:'QR Code encerrado'};
function setupPair() { return {source_id:Number($('setup-source').value),target_id:Number($('setup-target').value)}; }
function updateCredentialFields() {
  const saved = $('use-saved-credentials').checked && !!state?.connection?.credentials_saved;
  $('api-fields').hidden = saved;
  for (const id of ['api-id','api-hash']) { $(id).disabled=saved; $(id).required=!saved; }
}
function renderSetup(active) {
  const connection=state.connection;
  if (!connection) return;
  const stage=connection.state, connected=stage==='connected', blocked=busy||active;
  $('connection-badge').textContent=setupLabels[stage] || 'Desconectado';
  $('connection-badge').className='pill '+(connected?'good':stage==='disconnected'?'':'warn');
  const summaries={disconnected:'Conecte por QR Code ou código para carregar seus grupos e preparar uma comunidade privada.',saved:'Sua sessão está salva no app. Confirme a conexão para continuar.',code:`Digite o código recebido na conta com final ${connection.phone_hint}.`,password:'Sua conta solicita a senha de verificação em duas etapas.',connected:`${connection.account?.name || 'Conta conectada'}${connection.account?.username?' · @'+connection.account.username:''} — conexão protegida no app.`,qr:'Escaneie o QR Code pelo Telegram do seu celular e confirme a conexão.',qr_error:'A conexão por QR Code não foi concluída. Você pode tentar novamente ou cancelar.'};
  $('connection-summary').textContent=summaries[stage] || summaries.disconnected;
  $('connection-details').hidden=!connection.enabled||stage!=='disconnected';
  $('saved-session').hidden=stage!=='saved';
  $('qr-connection').hidden=!['qr','qr_error'].includes(stage);
  const qr=connection.qr, qrValid=stage==='qr' && qr?.image && qr.expires_at>Date.now()/1000;
  $('qr-image').hidden=!qrValid;
  if(qrValid) {if($('qr-image').getAttribute('src')!==qr.image)$('qr-image').src=qr.image;}
  else $('qr-image').removeAttribute('src');
  $('qr-status').textContent=stage==='qr_error'?connection.qr_error:qrValid?`Aguardando confirmação no celular. Este código expira em ${new Date(qr.expires_at*1000).toLocaleTimeString('pt-BR')}.`:'Preparando ou atualizando QR Code…';
  $('retry-qr').hidden=stage!=='qr_error';
  $('code-form').hidden=stage!=='code'; $('password-form').hidden=stage!=='password';
  $('connected-actions').hidden=!connected;
  $('group-setup').hidden=!connected||!connection.groups.length;
  $('saved-credentials-label').hidden=!connection.credentials_saved;
  if (stage!==setupLastStage) {
    if (stage!=='disconnected') { $('api-hash').value=''; $('api-id').value=''; $('telegram-phone').value=''; }
    $('telegram-code').value=''; $('telegram-password').value='';
    if (stage==='disconnected') $('use-saved-credentials').checked=connection.credentials_saved;
    if (stage!=='connected') {setupParticipantsLoaded=false;$('setup-participants').value='';}
    setupLastStage=stage;
  }
  updateCredentialFields();
  const waiting=connection.retry_at>Date.now()/1000;
  $('connection-error').hidden=!connection.vault_error&&!waiting;
  $('connection-error').textContent=waiting?`O Telegram pediu uma espera até ${new Date(connection.retry_at*1000).toLocaleString('pt-BR')}. Não será solicitado outro código automaticamente.`:'Não foi possível abrir as credenciais salvas. Faça uma nova conexão no app.';
  for (const id of ['start-qr','retry-qr','send-code','restore-session','verify-code','verify-password','load-groups','disconnect-account','check-privacy','confirm-protect']) $(id).disabled=blocked||waiting||!connection.enabled;
  for (const button of document.querySelectorAll('.cancel-connection')) button.disabled=busy;
  $('setup-source').disabled=blocked; $('setup-target').disabled=blocked; $('setup-participants').disabled=blocked;
  syncOptions('setup-source',connection.groups);
  syncOptions('setup-target',connection.groups.filter(g=>g.can_invite).map(g=>({...g,name:g.name+(g.private?' · privado':' · público')})));
  if (!setupParticipantsLoaded && connection.groups.length && (connection.configured||connection.saved_setup)) {
    const saved=connection.saved_setup;
    $('setup-participants').value=(connection.configured?connection.authorized_user_ids:saved.authorized_user_ids).join('\n');
    $('setup-source').value=String((connection.configured?state.sources:saved.sources)[0]?.id || '');
    $('setup-target').value=String((connection.configured?state.targets:saved.targets)[0]?.id || '');
    setupParticipantsLoaded=true;
  }
  const selected=setupPair(), privacy=connection.privacy?.group_id===selected.target_id?connection.privacy:null;
  if (privacy) {
    const rows=[['Grupo privado',privacy.private],['Lista de membros oculta',privacy.members_hidden],['Salvamento de conteúdo restrito',privacy.content_protected]];
    setHTML('privacy-report',`<h3>${escapeHTML(privacy.name)}</h3><ul class="privacy-list">${rows.map(([label,value])=>`<li><span>${label}</span><span class="pill ${value?'good':'warn'}">${value?'Ativado':'Pendente'}</span></li>`).join('')}</ul>${(privacy.notes||[]).map(n=>`<p class="privacy-warning">${escapeHTML(n)}</p>`).join('')}<p class="hint">Conferido em ${escapeHTML(new Date(privacy.checked_at*1000).toLocaleString('pt-BR'))}.</p>`);
  } else setHTML('privacy-report','<p>Confira o destino antes de ativar a conexão real.</p>');
  $('open-protect').disabled=blocked||!privacy||!privacy.owner;
  $('activate-live').disabled=blocked||waiting||!privacy?.private||!$('setup-participants').value.trim()||!selected.source_id||!selected.target_id||selected.source_id===selected.target_id;
  $('live-config-hint').textContent=!privacy?'Confira a privacidade do destino.':!privacy.private?'A comunidade precisa ser privada.':selected.source_id===selected.target_id?'Escolha uma origem diferente do destino.':'';
}
async function setupAction(action, body={}) { return request('/api/connection/'+action,body); }
$('use-saved-credentials').addEventListener('change',updateCredentialFields);
$('start-qr').addEventListener('click',()=>{const body={use_saved:$('use-saved-credentials').checked};if(!body.use_saved){if(!$('api-id').reportValidity()||!$('api-hash').reportValidity())return;body.api_id=Number($('api-id').value);body.api_hash=$('api-hash').value.trim();}act(async()=>{try{await setupAction('qr',body);notice('Escaneie e confirme o QR Code no Telegram do celular.');}finally{$('api-hash').value='';}});});
$('retry-qr').addEventListener('click',()=>act(()=>setupAction('qr',{use_pending:true})));
$('connect-form').addEventListener('submit',event=>{event.preventDefault();const body={phone:$('telegram-phone').value.trim(),use_saved:$('use-saved-credentials').checked};if(!body.use_saved){body.api_id=Number($('api-id').value);body.api_hash=$('api-hash').value.trim();}act(async()=>{try{await setupAction('start',body);notice('Confira a próxima etapa da conexão.');}finally{$('api-hash').value='';}});});
$('code-form').addEventListener('submit',event=>{event.preventDefault();const body={code:$('telegram-code').value.trim()};$('telegram-code').value='';act(()=>setupAction('code',body));});
$('password-form').addEventListener('submit',event=>{event.preventDefault();const body={password:$('telegram-password').value};$('telegram-password').value='';act(()=>setupAction('password',body));});
for(const button of document.querySelectorAll('.cancel-connection'))button.addEventListener('click',()=>act(()=>setupAction('cancel')));
$('restore-session').addEventListener('click',()=>act(()=>setupAction('restore')));
$('disconnect-account').addEventListener('click',()=>act(async()=>{await setupAction('disconnect');notice('Sessão do Telegram encerrada. Reconecte sua conta para continuar.');}));
$('load-groups').addEventListener('click',()=>act(async()=>{const r=await setupAction('groups');notice(r.groups.length?`${r.groups.length} grupo(s) administrado(s) carregado(s). Escolha origem e destino abaixo.`:'Nenhum grupo administrado disponível. Confira a conta conectada e as permissões no Telegram.');}));
$('setup-target').addEventListener('change',()=>render()); $('setup-source').addEventListener('change',()=>render()); $('setup-participants').addEventListener('input',()=>render());
$('check-privacy').addEventListener('click',()=>{const body={group_id:setupPair().target_id};act(()=>setupAction('privacy',body));});
$('open-protect').addEventListener('click',()=>{setupProtectId=setupPair().target_id;$('protect-group-name').textContent=state.connection.groups.find(g=>g.id===setupProtectId)?.name || '';$('protect-dialog').showModal();});
$('close-protect').addEventListener('click',()=>$('protect-dialog').close());
$('confirm-protect').addEventListener('click',()=>{const body={group_id:setupProtectId};act(async()=>{try{await setupAction('protect',body);notice('Proteções conferidas. Veja os itens ativados e pendentes.');}finally{$('protect-dialog').close();}});});
$('activate-live').addEventListener('click',()=>{const body={...setupPair(),participants:$('setup-participants').value};act(async()=>{await setupAction('configure',body);notice('Conexão real ativada. Consulte os participantes e registre as autorizações antes de iniciar inclusões.');});});
