'use strict';
let setupLastStage = null, setupGroupsLoaded = false, setupProtectId = null;
let setupPreferredSource = null, setupSourceRequest = 0;
let setupChannelApplied = '', channelIntents = {};
let setupLastContext = null;
let setupLabelKey = '';
if (typeof window !== 'undefined') window.addEventListener('message',event=>{
  const selected=event.data;
  if (event.origin!==window.location.origin || event.source!==window.parent || selected?.type!=='bff-telegram-source' ||
      !Number.isSafeInteger(selected.id) || !Number.isSafeInteger(selected.accountId) || !Number.isSafeInteger(selected.request) || selected.request<=setupSourceRequest ||
      (setupPreferredSource && selected.request<=setupPreferredSource.request)) return;
  setupPreferredSource={id:selected.id,accountId:selected.accountId,request:selected.request};
  if (state?.connection) render();
});
const setupLabels = {disconnected:'Desconectado',saved:'Sessão salva',code:'Aguardando código',password:'Verificação em duas etapas',connected:'Conta conectada',qr:'Aguardando leitura do QR Code',qr_error:'QR Code encerrado'};
function setupPair() { return {source_id:Number($('setup-source').value),target_id:Number($('setup-target').value)}; }
function updateCredentialFields() {
  const saved = $('use-saved-credentials').checked && !!state?.connection?.credentials_saved;
  $('api-fields').hidden = saved;
  for (const id of ['api-id','api-hash']) { $(id).disabled=saved; $(id).required=!saved; }
}
function channelIntent(action, fingerprint) {
  if (channelIntents[action]?.fingerprint!==fingerprint)
    channelIntents[action]={fingerprint,id:crypto.randomUUID()};
  return channelIntents[action].id;
}
function renderChannelSetup(blocked) {
  const connection=state.connection, connected=connection.state==='connected';
  const setup=connection.channel_setup || {}, creation=setup.creation, test=setup.test, channel=setup.channel;
  const creationPending=!!creation && ['pending','uncertain'].includes(creation.status);
  const testPending=!!test && ['pending','uncertain'].includes(test.status);
  $('channel-setup').hidden=!connected || !connection.enabled;
  $('create-channel-form').hidden=!!channel || creationPending;
  $('channel-title').disabled=blocked || creationPending;
  $('create-channel').disabled=blocked || creationPending || !!channel;
  $('channel-create-status').hidden=!creation;
  $('channel-create-status').textContent=creation?.message || (creationPending?'Confira o Telegram antes de repetir a criação.':'');
  $('channel-created').hidden=!channel;
  $('channel-created-name').textContent=channel?.name || '';
  $('test-channel-form').hidden=!channel;
  $('channel-test-user').disabled=blocked || testPending;
  $('test-channel').disabled=blocked || testPending || !channel;
  $('channel-test-status').hidden=!test;
  $('channel-test-status').textContent=test?.message || (testPending?'A inclusão ainda não foi confirmada. Confira no Telegram antes de repetir.':'');
  if (creation?.status==='failed' && channelIntents.create?.id===creation.requestId) delete channelIntents.create;
  if (test && !testPending && channelIntents.test?.id===test.requestId) delete channelIntents.test;
  if (!connected) {setupChannelApplied='';channelIntents={};}
  if (channel && creation?.status==='confirmed') {
    const key=`${connection.account?.id}:${creation.requestId}`;
    if (setupChannelApplied!==key && connection.groups.some(g=>g.id===channel.id)) {
      $('setup-target').value=String(channel.id);
      setupChannelApplied=key;
    }
  }
}
function renderSetup(active) {
  const connection=state.connection;
  if (!connection) return;
  if (setupLastContext !== connection.context_id) {
    if (setupLastContext!==null && setupPreferredSource) {
      setupSourceRequest=Math.max(setupSourceRequest,setupPreferredSource.request);
      setupPreferredSource=null;
    }
    setupLastContext=connection.context_id;
    setupLastStage=null; setupGroupsLoaded=false; setupChannelApplied=''; channelIntents={};
    for (const id of ['api-hash','api-id','telegram-phone','telegram-code','telegram-password','search']) $(id).value='';
    $('connection-details').open=false;
  }
  const stage=connection.state, connected=stage==='connected', blocked=busy||active;
  const accounts=connection.accounts || [], accountLocked=blocked || connection.accounts_locked;
  const selectedProfile=accounts.find(profile=>profile.active), profileLabel=selectedProfile?.label || 'sua conta';
  setHTML('telegram-account-list',accounts.map(profile=>`<div class="telegram-account-card" data-active="${profile.active?'true':'false'}"><div><strong>${escapeHTML(profile.label)}</strong><small>${profile.account?'Nome exibido no Telegram: '+escapeHTML(profile.account.name || 'Sem nome'):'Aguardando conexão'}${profile.account?.username?' · @'+escapeHTML(profile.account.username):''}</small><small>${escapeHTML(profile.active?'Conta selecionada':profile.state==='connected'?'Sessão salva':setupLabels[profile.state] || 'Conectar conta')}</small></div><button type="button" class="secondary" data-telegram-account="${escapeHTML(profile.id)}" ${profile.active || accountLocked?'disabled':''}>${profile.active?'Em uso':'Usar conta'}</button></div>`).join(''));
  const labelKey=JSON.stringify([selectedProfile?.id,selectedProfile?.label]);
  if (setupLabelKey!==labelKey) { $('selected-account-label').value=selectedProfile?.label || ''; setupLabelKey=labelKey; }
  $('edit-account-form').hidden=!selectedProfile;
  $('selected-account-label').disabled=accountLocked || !connection.enabled;
  $('rename-telegram-account').disabled=accountLocked || !connection.enabled;
  $('add-telegram-account').disabled=accountLocked || !connection.enabled;
  $('account-label').disabled=accountLocked;
  $('account-switch-hint').textContent=connection.accounts_locked?'Conclua ou cancele a conexão ou a operação em andamento antes de trocar de conta.':'As sessões continuam salvas ao trocar. As listas de participantes pertencem à conta que as consultou.';
  if (setupPreferredSource && ((setupLastStage==='connected' && !connected) ||
      (connected && connection.account?.id!==setupPreferredSource.accountId))) {
    setupSourceRequest=setupPreferredSource.request;
    setupPreferredSource=null;
  }
  $('connection-badge').textContent=setupLabels[stage] || 'Desconectado';
  $('connection-badge').className='pill '+(connected?'good':stage==='disconnected'?'':'warn');
  const summaries={disconnected:`Conecte o Telegram de ${profileLabel} por QR Code ou código para carregar os grupos.`,saved:`A sessão de ${profileLabel} está salva no app. Confirme a conexão para continuar.`,code:`Digite o código recebido na conta com final ${connection.phone_hint}.`,password:'Sua conta solicita a senha de verificação em duas etapas.',connected:`${profileLabel}${connection.account?.username?' · @'+connection.account.username:''} — conexão protegida no app.`,qr:`Escaneie o QR Code com o Telegram de ${profileLabel} e confirme a conexão.`,qr_error:'A conexão por QR Code não foi concluída. Você pode tentar novamente ou cancelar.'};
  $('connection-summary').textContent=summaries[stage] || summaries.disconnected;
  const needsAppSetup=connection.enabled&&stage==='disconnected'&&!connection.credentials_saved;
  $('app-setup-guide').hidden=!needsAppSetup;
  $('connection-form-summary').textContent=needsAppSetup?'Já tenho as chaves — conectar Telegram':'Conectar minha conta';
  if(needsAppSetup) $('connection-summary').textContent='Antes do primeiro QR Code, conclua a configuração do aplicativo BFF no Telegram. Veja o passo a passo abaixo.';
  $('connection-details').hidden=!connection.enabled||stage!=='disconnected';
  $('saved-session').hidden=stage!=='saved';
  $('qr-connection').hidden=!['qr','qr_error'].includes(stage);
  const qr=connection.qr, qrValid=stage==='qr' && qr?.image && qr.expires_at>Date.now()/1000;
  $('qr-image').hidden=!qrValid;
  if(qrValid) {if($('qr-image').getAttribute('src')!==qr.image)$('qr-image').src=qr.image;}
  else $('qr-image').removeAttribute('src');
  $('qr-status').textContent=stage==='qr_error'?connection.qr_error:qrValid?`Conectando ${profileLabel}. Confirme no celular dessa conta. Este código expira em ${new Date(qr.expires_at*1000).toLocaleTimeString('pt-BR')}.`:`Preparando QR Code para ${profileLabel}…`;
  $('retry-qr').hidden=stage!=='qr_error';
  $('code-form').hidden=stage!=='code'; $('password-form').hidden=stage!=='password';
  $('connected-actions').hidden=!connected;
  $('group-setup').hidden=!connected||!connection.groups.length;
  $('saved-credentials-label').hidden=!connection.credentials_saved;
  if (stage!==setupLastStage) {
    if (stage!=='disconnected') { $('api-hash').value=''; $('api-id').value=''; $('telegram-phone').value=''; }
    $('telegram-code').value=''; $('telegram-password').value='';
    if (stage==='disconnected') $('use-saved-credentials').checked=connection.credentials_saved;
    if (stage!=='connected') {setupGroupsLoaded=false;}
    setupLastStage=stage;
  }
  updateCredentialFields();
  const waiting=connection.retry_at>Date.now()/1000;
  $('connection-error').hidden=!connection.vault_error&&!waiting;
  $('connection-error').textContent=waiting?`O Telegram pediu uma espera até ${new Date(connection.retry_at*1000).toLocaleString('pt-BR')}. Não será solicitado outro código automaticamente.`:'Não foi possível abrir as credenciais salvas. Faça uma nova conexão no app.';
  for (const id of ['start-qr','retry-qr','send-code','restore-session','verify-code','verify-password','load-groups','disconnect-account','check-privacy','confirm-protect']) $(id).disabled=blocked||waiting||!connection.enabled;
  for (const button of document.querySelectorAll('.cancel-connection')) button.disabled=busy;
  $('setup-source').disabled=blocked; $('setup-target').disabled=blocked;
  syncOptions('setup-source',connection.groups.filter(g=>g.kind!=='channel'));
  syncOptions('setup-target',connection.groups.filter(g=>g.can_invite).map(g=>({...g,name:g.name+(g.kind==='channel'?' · canal':'')+(g.private?' · privado':' · público')})));
  if (!setupGroupsLoaded && connection.groups.length && (connection.configured||connection.saved_setup)) {
    const saved=connection.saved_setup;
    $('setup-source').value=String((connection.configured?state.sources:saved.sources)[0]?.id || '');
    $('setup-target').value=String((connection.configured?state.targets:saved.targets)[0]?.id || '');
    setupGroupsLoaded=true;
  }
  if (connected && setupPreferredSource && connection.groups.some(g=>g.id===setupPreferredSource.id)) {
    if (connection.groups.find(g=>g.id===setupPreferredSource.id).kind!=='channel') $('setup-source').value=String(setupPreferredSource.id);
    setupSourceRequest=setupPreferredSource.request;
    setupPreferredSource=null;
  }
  renderChannelSetup(blocked || waiting);
  const selected=setupPair(), privacy=connection.privacy?.group_id===selected.target_id?connection.privacy:null;
  if (privacy) {
    const rows=privacy.kind==='channel'
      ? [['Canal privado',privacy.private],['Publicação pela administração',true]]
      : [['Grupo privado',privacy.private],['Lista de membros oculta',privacy.members_hidden],['Salvamento de conteúdo restrito',privacy.content_protected]];
    setHTML('privacy-report',`<h3>${escapeHTML(privacy.name)}</h3><ul class="privacy-list">${rows.map(([label,value])=>`<li><span>${label}</span><span class="pill ${value?'good':'warn'}">${value?'Ativado':'Pendente'}</span></li>`).join('')}</ul>${(privacy.notes||[]).map(n=>`<p class="privacy-warning">${escapeHTML(n)}</p>`).join('')}<p class="hint">Conferido em ${escapeHTML(new Date(privacy.checked_at*1000).toLocaleString('pt-BR'))}.</p>`);
  } else setHTML('privacy-report','<p>Confira o destino antes de ativar a conexão real.</p>');
  $('open-protect').disabled=blocked||!privacy||!privacy.owner;
  $('activate-live').disabled=blocked||waiting||!privacy?.private||!selected.source_id||!selected.target_id||selected.source_id===selected.target_id;
  $('live-config-hint').textContent=!privacy?'Confira a privacidade do destino.':!privacy.private?'A comunidade precisa ser privada.':selected.source_id===selected.target_id?'Escolha uma origem diferente do destino.':'';
}
async function setupAction(action, body={}) { return request('/api/connection/'+action,body); }
$('telegram-account-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-telegram-account]');
  if (!button || button.disabled) return;
  const id=button.dataset.telegramAccount;
  act(async()=>{await setupAction('accounts/switch',{id});notice('Conta selecionada. Os grupos e participantes desta conta foram carregados.');});
});
$('edit-account-form').addEventListener('submit',event=>{
  event.preventDefault();
  if (busy || !$('selected-account-label').reportValidity()) return;
  const id=state.connection.active_account_id, label=$('selected-account-label').value.trim();
  act(async()=>{await setupAction('accounts/rename',{id,label});notice(`Conta identificada como ${label}.`);});
});
$('add-account-form').addEventListener('submit',event=>{
  event.preventDefault();
  if (busy || !$('account-label').reportValidity()) return;
  const label=$('account-label').value.trim();
  act(async()=>{
    const created=await setupAction('accounts/add',{label});
    await refresh();
    if (state.connection.active_account_id!==created.id || state.connection.context_id!==created.context_id || state.connection.state!=='disconnected')
      throw new Error('A conta selecionada mudou em outra janela. Confira a conta antes de gerar o QR Code.');
    if (state.connection.credentials_saved) {
      await setupAction('qr',{use_saved:true});
      notice(`Escaneie o QR Code com o Telegram de ${label}.`);
    } else {
      $('connection-details').open=true;
      notice(`Conta ${label} preparada. Conecte o Telegram abaixo.`);
    }
  });
});
$('create-channel-form').addEventListener('submit',event=>{
  event.preventDefault();
  if (busy || state?.connection?.state!=='connected' || !$('channel-title').reportValidity()) return;
  const title=$('channel-title').value.trim(), account=state.connection.account?.id;
  const body={title,requestId:channelIntent('create',`${account}:${title}`)};
  act(async()=>{const result=await setupAction('channel/create',body);notice(result.creation?.message || 'Canal privado confirmado no Telegram.');});
});
$('test-channel-form').addEventListener('submit',event=>{
  event.preventDefault();
  const channel=state?.connection?.channel_setup?.channel;
  if (busy || state?.connection?.state!=='connected' || !channel || !$('channel-test-user').reportValidity()) return;
  const username=$('channel-test-user').value.trim(), account=state.connection.account?.id;
  const body={target_id:channel.id,username,requestId:channelIntent('test',`${account}:${channel.id}:${username.toLowerCase()}`)};
  act(async()=>{const result=await setupAction('channel/test',body);notice(result.message || 'Confira o resultado do teste.',!['added','already'].includes(result.state));});
});
$('use-saved-credentials').addEventListener('change',updateCredentialFields);
$('start-qr').addEventListener('click',()=>{const body={use_saved:$('use-saved-credentials').checked};if(!body.use_saved){if(!$('api-id').reportValidity()||!$('api-hash').reportValidity())return;body.api_id=Number($('api-id').value);body.api_hash=$('api-hash').value.trim();}act(async()=>{try{await setupAction('qr',body);notice('Escaneie e confirme o QR Code no Telegram do celular.');}finally{$('api-hash').value='';}});});
$('retry-qr').addEventListener('click',()=>act(()=>setupAction('qr',{use_pending:true})));
$('connect-form').addEventListener('submit',event=>{event.preventDefault();const body={phone:$('telegram-phone').value.trim(),use_saved:$('use-saved-credentials').checked};if(!body.use_saved){body.api_id=Number($('api-id').value);body.api_hash=$('api-hash').value.trim();}act(async()=>{try{await setupAction('start',body);notice('Confira a próxima etapa da conexão.');}finally{$('api-hash').value='';}});});
$('code-form').addEventListener('submit',event=>{event.preventDefault();const body={code:$('telegram-code').value.trim()};$('telegram-code').value='';act(()=>setupAction('code',body));});
$('password-form').addEventListener('submit',event=>{event.preventDefault();const body={password:$('telegram-password').value};$('telegram-password').value='';act(()=>setupAction('password',body));});
for(const button of document.querySelectorAll('.cancel-connection'))button.addEventListener('click',()=>act(()=>setupAction('cancel')));
$('restore-session').addEventListener('click',()=>act(()=>setupAction('restore')));
$('disconnect-account').addEventListener('click',()=>act(async()=>{await setupAction('disconnect');notice('Sessão do Telegram encerrada. Reconecte sua conta para continuar.');}));
$('load-groups').addEventListener('click',()=>act(async()=>{const r=await setupAction('groups');notice(r.groups.length?`${r.groups.length} grupo(s) carregado(s). Escolha origem e destino abaixo.`:'Nenhum grupo disponível. Confira a conta conectada e as permissões no Telegram.');}));
$('setup-target').addEventListener('change',()=>render()); $('setup-source').addEventListener('change',()=>render());
$('check-privacy').addEventListener('click',()=>{const body={group_id:setupPair().target_id};act(()=>setupAction('privacy',body));});
$('open-protect').addEventListener('click',()=>{setupProtectId=setupPair().target_id;$('protect-group-name').textContent=state.connection.groups.find(g=>g.id===setupProtectId)?.name || '';$('protect-dialog').showModal();});
$('close-protect').addEventListener('click',()=>$('protect-dialog').close());
$('confirm-protect').addEventListener('click',()=>{const body={group_id:setupProtectId};act(async()=>{try{await setupAction('protect',body);notice('Proteções conferidas. Veja os itens ativados e pendentes.');}finally{$('protect-dialog').close();}});});
$('activate-live').addEventListener('click',()=>{const body=setupPair();act(async()=>{await setupAction('configure',body);notice('Grupos salvos. Consulte a origem e selecione os participantes.');});});
