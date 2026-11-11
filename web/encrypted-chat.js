import { decryptDocument, encryptDocument, documentId, proveAccess } from './encrypted-crypto.js';

export function encryptedConversations(ui, options) {
  const {h,btn,panel,tr,raw}=ui;
  const root=h('div',{class:'stack'}),list=h('div',{class:'rows'}),history=h('div',{class:'stack-sm'}),status=h('p',{role:'status',class:'muted'});
  const agent=h('select',{'aria-label':tr('Agente della conversazione')},options.agents.filter(a=>/^(ollama|orcarouter)\//.test(a.model||options.defaultModel||'')).map(a=>h('option',{value:a.id,selected:new URLSearchParams(location.hash.split('?')[1]||'').get('agent')===a.id},raw(a.name))));
  const title=h('input',{type:'text',maxlength:200,'aria-label':tr('Titolo della conversazione'),placeholder:tr('Titolo della conversazione')});
  const input=h('textarea',{rows:4,'aria-label':tr('Messaggio cifrato'),placeholder:tr('Scrivi un messaggio privato…')});
  let selected=null,messages=[],running=null,busy=false,generation=0,activeAgent='';
  const prove=intent=>{const s=options.state();return proveAccess(options.api,options.folder,s.bundle,s.method,intent)};
  const cancel=btn('Revoca sessione',{cls:'ghost danger',onclick:async()=>{if(!running)return;try{await options.api(`/api/encrypted/requests/${running}`,{method:'DELETE'});status.textContent=tr('Sessione revocata.')}catch(e){status.textContent=tr(e.message)}}});cancel.hidden=true;
  const clear=()=>{generation++;if(running)options.api(`/api/encrypted/requests/${running}`,{method:'DELETE'}).catch(()=>{});running=null;busy=false;selected=null;messages=[];input.value='';title.value='';history.replaceChildren();list.replaceChildren();cancel.hidden=true;send.disabled=false};
  const drawHistory=()=>history.replaceChildren(...messages.map(m=>h('article',{class:'panel stack-sm'},h('strong',{},m.role==='user'?tr('Tu'):tr('Agente')),h('pre',{class:'encrypted-file-preview'},raw(m.content)),m.reasoning?h('details',{},h('summary',{},'Ragionamento'),h('pre',{class:'encrypted-file-preview'},raw(m.reasoning))):null)));
  const save=async()=>{const s=options.state(),id=selected?.id||documentId(),base=selected?.version||0;const value=JSON.stringify({format:'conversation-v1',title:title.value||tr('Conversazione privata'),agent:activeAgent||agent.value,messages});if(new TextEncoder().encode(value).length>1024*1024||messages.length>200)throw Error('La conversazione ha raggiunto il limite: crea una nuova conversazione.');selected=await options.api(`/api/encrypted/folders/${options.folder}/documents`,{method:'POST',body:{id,base,kind:'chat',envelope:await encryptDocument(s.publicKey,value,`cora:${options.folder}:${id}:${base+1}`),proof:await prove(`write:${id}:${base}`)}})};
  const open=async doc=>{if(busy)return;const epoch=generation;const value=JSON.parse(await decryptDocument(options.state().bundle,doc.envelope,`cora:${options.folder}:${doc.id}:${doc.version}`));if(epoch!==generation)return;selected=doc;messages=value.messages;activeAgent=value.agent;title.value=value.title;agent.value=value.agent;agent.disabled=true;drawHistory();await refresh()};
  const refresh=async()=>{
    const epoch=generation,s=options.state();if(!s.bundle)return;
    const data=await options.api(`/api/encrypted/folders/${options.folder}`);if(epoch!==generation)return;
    const rows=[];
    for(const doc of data.documents.filter(d=>d.kind==='chat')){const value=JSON.parse(await decryptDocument(s.bundle,doc.envelope,`cora:${options.folder}:${doc.id}:${doc.version}`));if(epoch!==generation)return;rows.push(h('div',{class:'row-item'},h('span',{class:'grow'},raw(value.title)),btn('Apri conversazione',{disabled:busy,onclick:()=>open(doc).catch(e=>{status.textContent=tr(e.message)})})))}
    list.replaceChildren(...rows);
    const recovery=data.requests.filter(r=>r.operation==='chat'&&r.document===selected?.id&&r.result&&!messages.some(m=>m.request===r.id));
    for(const request of recovery)list.append(h('div',{class:'row-item'},h('span',{class:'grow'},'Risposta cifrata da recuperare'),btn('Recupera risposta',{disabled:!data.canWrite||busy,onclick:async()=>{try{const epoch=generation;const result=JSON.parse(await decryptDocument(options.state().bundle,request.result,`cora:${options.folder}:session:${request.session}`));if(epoch!==generation)return;if(request.version!==selected.version)throw Error('La conversazione è cambiata. Apri il risultato dal registro Accessi.');messages.push({role:'assistant',content:result.answer,reasoning:result.reasoning,request:request.id});await save();drawHistory();await refresh()}catch(e){status.textContent=tr(e.message)}}})));
    send.disabled=!data.canWrite||busy||!agent.value;fresh.disabled=!data.canWrite||busy;
  };
  const fresh=btn('Nuova conversazione',{icon:'plus',onclick:()=>{if(busy)return;selected=null;messages=[];activeAgent='';agent.disabled=false;input.value='';title.value='';history.replaceChildren();status.textContent=''}});
  const send=btn('Invia e autorizza temporaneamente',{cls:'primary',icon:'key',onclick:async()=>{
    const epoch=generation;let request;
    if(busy||!input.value.trim())return;
    busy=true;
    send.disabled=true;fresh.disabled=true;agent.disabled=true;
    try{
      if(messages.length > 198) throw Error('La conversazione ha raggiunto il limite: crea una nuova conversazione.');
      const s=options.state();activeAgent=activeAgent||agent.value;messages.push({role:'user',content:input.value});await save();if(epoch!==generation)return;input.value='';drawHistory();
      request=await options.api(`/api/encrypted/folders/${options.folder}/requests`,{method:'POST',body:{agent:activeAgent,document:selected.id,version:selected.version,operation:'chat'}});
      if(epoch!==generation){await options.api(`/api/encrypted/requests/${request.id}`,{method:'DELETE'});return}running=request.id;cancel.hidden=false;status.textContent=tr('Sessione privata in corso. Puoi revocarla; il contenuto non passa in chat.');
      const response=await options.api(`/api/encrypted/requests/${request.id}/approve`,{method:'POST',body:{content:JSON.stringify({format:'conversation-v1',messages}),instruction:'Continue the encrypted conversation.',proof:await prove(`approve:${request.id}`)}});
      if(epoch!==generation)return;
      const result=JSON.parse(await decryptDocument(s.bundle,response.result,`cora:${options.folder}:session:${request.session}`));if(epoch!==generation)return;
      messages.push({role:'assistant',content:result.answer,reasoning:result.reasoning,request:request.id});await save();drawHistory();status.textContent=tr('Risposta e ragionamento salvati cifrati.');
    }catch(e){if(epoch===generation)status.textContent=tr(e.message)}
    finally{if(epoch===generation){running=null;busy=false;cancel.hidden=true;await refresh().catch(e=>{status.textContent=tr(e.message)});}}
  }});
  root.append(panel({icon:'lock',title:'Conversazioni cifrate',hint:'Messaggi, risposte e ragionamento restano cifrati. Ogni invio autorizza temporaneamente worker e modello a leggere la conversazione. Nessuno strumento, memoria o invio sui canali. Solo modelli Ollama e OrcaRouter; massimo 1 MiB e 200 messaggi per conversazione.'},list,fresh,title,agent,history,input,h('div',{class:'row'},send,cancel),status));
  return {element:root,clear,refresh};
}

export async function encryptedChatLauncher(ui, agent) {
  const {h,btn,panel,api,tr,raw}=ui;
  const data=await api('/api/encrypted/folders');
  const select=h('select',{'aria-label':tr('Cartella per la conversazione')},data.folders.map(f=>h('option',{value:f.id},raw(f.title))));
  return panel({icon:'lock',title:'Chat cifrata',hint:'Scegli una cartella cifrata e sbloccala per aprire le conversazioni. Il contenuto resta nel pannello; non viene inviato su Discord, Slack o Telegram.'},select,h('div',{class:'row'},btn('Apri conversazioni cifrate',{disabled:!data.folders.length,onclick:()=>{location.hash=`#/artefatti/${select.value}/conversazioni?agent=${agent.id}`}}),btn('Crea cartella cifrata',{href:'#/artefatti?new=1&encrypt=1',icon:'plus'}),btn('Storico ordinario',{href:`#/agent/${agent.id}/chat/storico`,cls:'ghost'})));
}
