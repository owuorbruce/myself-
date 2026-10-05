import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { mkdtemp, stat, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { ChatGPTRuntime, ChatGPTError, verifyIdentity, fileStore, consumeResponse } from '../server/chatgpt-auth.mjs';
import { createChatGPTRouter, validateInput } from '../server/chatgpt-router.mjs';
import { flashcardsFromAnswer } from '../src/ai-response.mjs';
const AUTH='https://auth.openai.com', API='https://api.openai.com/v1', NOW=1800000000000;
const {privateKey, publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const key={...publicKey.export({format:'jwk'}),kid:'test-key',alg:'RS256',use:'sig'};
const token=(claims={})=>{
 const h=Buffer.from(JSON.stringify({alg:'RS256',kid:key.kid})).toString('base64url');
 const p=Buffer.from(JSON.stringify({iss:AUTH,aud:'client-one',sub:'user-one',nonce:'nonce',exp:NOW/1000+3600,email:'test@example.com',...claims})).toString('base64url');
 return `${h}.${p}.${sign('sha256',Buffer.from(`${h}.${p}`),privateKey).toString('base64url')}`;
};
const json=(data,status=200)=>Response.json(data,{status});
const event=(data)=>`data: ${JSON.stringify(data)}\r\n\r\n`;
const completed=()=>event({type:'response.completed',response:{status:'completed'}});
const stream=(text,chunkSize=17,keepOpen=false)=>{
 const bytes=new TextEncoder().encode(text);let offset=0;
 return new Response(new ReadableStream({pull(c){if(offset<bytes.length){c.enqueue(bytes.slice(offset,offset+=chunkSize));}else if(!keepOpen)c.close();}}));
};
function harness(){
 let saved=null, runtime;const calls=[];const h={calls,client:'client-one',subject:'user-one',scope:'openid chatgpt.tokens.use.direct',clock:NOW,refreshCount:0,exchangeError:false};
 const store={read:async()=>structuredClone(saved),write:async(data)=>{saved=structuredClone(data);},get value(){return saved;}};h.store=store;
 const fetcher=async(url,init={})=>{
  calls.push({url,init});
  if(url.endsWith('/openid-configuration'))return json({issuer:AUTH,jwks_uri:AUTH+'/keys',revocation_endpoint:AUTH+'/revoke'});
  if(url===AUTH+'/keys')return json({keys:[key]});
  if(url.endsWith('/oauth/token')){
   const params=new URLSearchParams(init.body);
   assert.equal(params.get('resource'),API);assert.equal(params.has('client_secret'),false);
   if(params.get('grant_type')==='refresh_token'){
    h.refreshCount++; assert.equal(params.get('refresh_token'),h.refreshCount===1?'refresh-one':'refresh-two');assert.equal(params.has('scope'),false);
    return json({access_token:'access-two',refresh_token:'refresh-two',token_type:'Bearer',expires_in:3600,scope:h.scope});
   }
   assert.equal(store.value.accounts.at(-1).clientId,h.client,'issued registration saved before exchange');
   assert.equal(params.get('redirect_uri'),'http://127.0.0.1:4173/auth/callback');
   assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'),h.auth.searchParams.get('code_challenge'));
   if(h.exchangeError)return json({error:{code:'invalid_grant'}},400);
   return json({access_token:'access-one',refresh_token:'refresh-one',id_token:token({aud:h.client,sub:h.subject,nonce:h.auth.searchParams.get('nonce')}),token_type:'Bearer',expires_in:3600,scope:h.scope});
  }
  if(url===AUTH+'/revoke')return new Response(null,{status:h.revokeStatus||200});
  if(url===API+'/models')return json({models:[{slug:'available',display_name:'Available',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hidden'}]});
  if(url===API+'/responses')return stream(event({type:'response.output_text.delta',delta:'Hello 🌍'})+completed());
  throw new Error('Unexpected URL '+url);
 };
 runtime=new ChatGPTRuntime({store,fetch:fetcher,now:()=>h.clock});h.runtime=runtime;
 h.begin=async(options)=>{const ticket=await runtime.begin('http://127.0.0.1:4173/auth/callback',options);h.auth=new URL(runtime.authorize(ticket));return ticket;};
 h.finish=()=>runtime.finish('http://127.0.0.1:4173/auth/callback?'+new URLSearchParams({state:h.auth.searchParams.get('state'),code:'code',client_id:h.client}));
 h.connect=async()=>{await h.begin();return h.finish();};return h;
}
test('identity verifies signed JWT and rejects invalid nonce, audience, issuer, expiry, signature and azp',()=>{
 const opts={clientId:'client-one',nonce:'nonce',now:NOW};assert.equal(verifyIdentity(token(),[key],opts).subject,'user-one');
 for(const claims of [{nonce:'wrong'},{aud:'wrong'},{iss:'https://evil.test'},{exp:NOW/1000},{aud:['client-one','other'],azp:'other'}])assert.throws(()=>verifyIdentity(token(claims),[key],opts),{code:'invalid_identity'});
 assert.throws(()=>verifyIdentity(token().slice(0,-10)+'invalidxxx',[key],opts),{code:'invalid_identity'});
 assert.throws(()=>verifyIdentity(token(),[],opts),{code:'invalid_identity'});
});
test('first sign-in uses PKCE, stable host, one-use ticket and state; status never exposes credentials',async()=>{
 const h=harness();await h.connect();const p=h.auth.searchParams;
 assert.equal(p.get('client_id'),'dynamic_agent_client');assert.equal(p.get('agent_name_hint'),'Slate');assert.equal(p.get('code_challenge_method'),'S256');assert.equal(p.get('resource'),API);
 assert.match(p.get('ext_agent_host_id'),/^urn:uuid:/);assert.equal((await h.runtime.status()).planEnabled,true);
 const publicStatus=JSON.stringify(await h.runtime.status());for(const secret of ['access-one','refresh-one',h.store.value.accounts[0].idToken,h.store.value.hostId])assert.equal(publicStatus.includes(secret),false);
 await assert.rejects(h.finish(),{code:'invalid_state'});
 const first=h.auth;const ticket=await h.begin();assert.equal(h.auth.searchParams.get('client_id'),'client-one');assert.equal(h.auth.searchParams.has('agent_name_hint'),false);
 assert.equal(h.auth.searchParams.get('ext_agent_host_id'),first.searchParams.get('ext_agent_host_id'));assert.notEqual(h.auth.searchParams.get('state'),first.searchParams.get('state'));assert.throws(()=>h.runtime.authorize(ticket));
 const restarted=new ChatGPTRuntime({store:h.store});assert.equal((await restarted.status()).connected,true);assert.equal(restarted.data.hostId,h.store.value.hostId);
});
test('unknown state is rejected before exchange and does not consume valid pending sign-in',async()=>{
 const h=harness();await h.begin();await assert.rejects(h.runtime.finish('http://127.0.0.1:4173/auth/callback?state=wrong&code=code&client_id=evil'),{code:'invalid_state'});
 assert.equal(h.calls.length,0);await h.finish();
});
test('issued client ID survives failed code exchange and is reused on retry',async()=>{
 const h=harness();h.exchangeError=true;await h.begin();await assert.rejects(h.finish(),{code:'invalid_grant'});assert.equal(h.store.value.pendingClientId,'client-one');
 h.exchangeError=false;await h.begin();assert.equal(h.auth.searchParams.get('client_id'),'client-one');await h.finish();assert.equal(h.store.value.accounts.length,1);
});
test('returning sign-in cannot replace a registration with another identity or client ID',async()=>{
 const h=harness();await h.connect();h.subject='other-user';await h.begin();await assert.rejects(h.finish(),{code:'account_mismatch'});assert.equal(h.store.value.accounts[0].subject,'user-one');
 h.client='client-other';await h.begin();await assert.rejects(h.finish(),{code:'invalid_client'});assert.equal(h.store.value.accounts.length,1);
});
test('actual grant scope controls permission and identity-only sign-in cannot call inference',async()=>{
 const h=harness();h.scope='openid profile email';await h.connect();assert.equal((await h.runtime.status()).planEnabled,false);
 await assert.rejects(h.runtime.models(),{code:'plan_permission_required'});assert.equal(h.calls.some(x=>x.url.startsWith(API)),false);
});
test('concurrent refreshes rotate one credential set and persist the resulting scope',async()=>{
 const h=harness();await h.connect();h.clock+=3600000;const tokens=await Promise.all([h.runtime.access('client-one'),h.runtime.access('client-one'),h.runtime.access('client-one')]);
 assert.deepEqual(tokens,['access-two','access-two','access-two']);assert.equal(h.refreshCount,1);assert.equal(h.store.value.accounts[0].refreshToken,'refresh-two');
 h.clock+=3600000;h.scope='openid';await assert.rejects(h.runtime.access('client-one'),{code:'plan_permission_required'});assert.equal((await h.runtime.status()).planEnabled,false);
});
test('models are filtered by account catalog and inference uses the public documented request fields',async()=>{
 const h=harness();await h.connect();assert.deepEqual(await h.runtime.models(),[{id:'available',name:'Available'}]);
 await assert.rejects(h.runtime.respond({model:'hidden',input:[]},()=>{}),{code:'invalid_model'});
 let output='';const answer=await h.runtime.respond({model:'available',input:[{role:'user',content:'My notes'}]},d=>output+=d);
 assert.equal(answer,'Hello 🌍');assert.equal(answer,output);
 const req=h.calls.find(x=>x.url===API+'/responses');assert.equal(req.init.headers.Authorization,'Bearer access-one');
 assert.deepEqual(Object.keys(JSON.parse(req.init.body)).sort(),['input','instructions','model','store','stream']);assert.equal(JSON.parse(req.init.body).store,false);
});
test('account switching keeps separate credentials and sign-out retains registration with confirmed revocation',async()=>{
 const h=harness();await h.connect();h.client='client-two';h.subject='user-two';await h.begin({newAccount:true});await h.finish();assert.equal(h.store.value.accounts.length,2);
 await h.runtime.select('client-one');assert.equal(h.store.value.active,'client-one');const result=await h.runtime.signOut();assert.equal(result.revoked,true);assert.equal(result.connected,false);
 assert.equal(h.store.value.accounts[0].clientId,'client-one');assert.equal(h.store.value.accounts[0].accessToken,undefined);assert.equal(h.store.value.accounts[1].accessToken,'access-one');
 const revoke=new URLSearchParams(h.calls.find(x=>x.url===AUTH+'/revoke').init.body);assert.equal(revoke.get('token'),'refresh-one');assert.equal(revoke.get('client_id'),'client-one');
 await h.begin();assert.equal(h.auth.searchParams.get('client_id'),'client-one');
});
test('failed revocation retries and reports that only local sign-out was confirmed',async()=>{
 const h=harness();await h.connect();h.revokeStatus=503;const result=await h.runtime.signOut();assert.equal(result.revoked,false);assert.match(result.error,/revocation couldn't be confirmed/);assert.equal(h.calls.filter(x=>x.url===AUTH+'/revoke').length,2);assert.equal(h.store.value.accounts[0].refreshToken,undefined);
});
test('credential file is atomic with owner-only Unix permissions and no temporary files left',async(t)=>{
 const dir=await mkdtemp(join(tmpdir(),'slate-auth-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=fileStore(dir);assert.equal(await store.read(),null);
 await store.write({version:1,fake:'test'});await store.write({version:2,fake:'updated'});assert.deepEqual(await store.read(),{version:2,fake:'updated'});assert.deepEqual(await readdir(dir),['accounts.json']);
 if(process.platform!=='win32'){assert.equal((await stat(dir)).mode&0o777,0o700);assert.equal((await stat(join(dir,'accounts.json'))).mode&0o777,0o600);}
});
test('SSE handles split UTF-8/CRLF and returns at completion even if the upstream stays open',async()=>{
 let text='';const result=await consumeResponse(stream(event({type:'response.output_text.delta',delta:'Café 🌍'})+completed(),1,true),d=>text+=d,AbortSignal.timeout(2000));assert.equal(result,'Café 🌍');assert.equal(result,text);
});
test('partial, malformed, failed, incomplete and empty streams never complete successfully',async()=>{
 const delta=event({type:'response.output_text.delta',delta:'partial'});
 for(const [text,code] of [[delta,'interrupted_response'],['data: invalid\n\n','invalid_stream'],[delta+event({type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}),'subscription_sharing_usage_limit_exceeded'],[delta+event({type:'response.incomplete'}),'incomplete_response'],[completed(),'empty_response']])await assert.rejects(consumeResponse(stream(text),()=>{}),{code});
 const aborter=new AbortController();aborter.abort();await assert.rejects(consumeResponse(stream(delta),()=>{},aborter.signal),{code:'cancelled'});
});
test('completed refusal text is displayed and is still treated as a completed answer',async()=>{
 const text=event({type:'response.completed',response:{status:'completed',output:[{content:[{type:'refusal',refusal:'Cannot help with that.'}]}]}});assert.equal(await consumeResponse(stream(text),()=>{}),'Cannot help with that.');
});
test('inference input strips unknown fields and rejects system messages and excessive context',()=>{
 assert.deepEqual(validateInput({model:'available',store:true,input:[{role:'user',content:'hello',unexpected:true}]}),{model:'available',input:[{role:'user',content:'hello'}]});
 for(const input of [[{role:'system',content:'hello'}],[{role:'user',content:''}],[]])assert.throws(()=>validateInput({model:'available',input}));
 assert.throws(()=>validateInput({model:'available',input:[{role:'user',content:'a'.repeat(200001)}]}),{code:'context_too_large'});
});
test('HTTP helper enforces loopback Host, Origin, CSRF, JSON and emits no completed event on failure',async(t)=>{
 const runtime={status:async()=>({available:true,connected:true}),models:async()=>[],begin:async()=> 'one-use-ticket',authorize:()=>AUTH+'/api/accounts/authorize',finish:async()=>{throw new ChatGPTError('<script>unsafe</script>');},respond:async(_,delta)=>{delta('partial');throw new ChatGPTError('Usage reached','subscription_sharing_usage_limit_exceeded');}};
 const route=createChatGPTRouter({runtime});const server=http.createServer(async(req,res)=>{if(!await route(req,res)){res.writeHead(404);res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));const url=`http://127.0.0.1:${server.address().port}`;
 const session=await fetch(url+'/api/chatgpt/session');const token=(await session.json()).requestToken;assert.equal(session.headers.get('cache-control'),'no-store');
 const hostStatus=await new Promise((resolve,reject)=>{http.get(url+'/api/chatgpt/session',{headers:{Host:'evil.test'}},res=>{res.resume();resolve(res.statusCode);}).on('error',reject);});assert.equal(hostStatus,403);
 for(const headers of [{Origin:'null'},{Origin:'https://evil.test'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await fetch(url+'/api/chatgpt/session',{headers})).status,403,JSON.stringify(headers));
 assert.equal((await fetch(url+'/api/chatgpt/models')).status,403);assert.equal((await fetch(url+'/api/chatgpt/models',{headers:{'X-Slate-Token':'é'.repeat(token.length)}})).status,403);
 const headers={'X-Slate-Token':token,'Content-Type':'application/json',Origin:url};
 assert.equal((await fetch(url+'/api/chatgpt/sign-in',{method:'POST',headers:{'X-Slate-Token':token},body:'{}'})).status,415);
 const start=await (await fetch(url+'/api/chatgpt/sign-in',{method:'POST',headers,body:'{}'})).json();assert.equal(start.url,'/api/chatgpt/authorize?ticket=one-use-ticket');
 const redirect=await fetch(url+start.url,{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(redirect.headers.get('location'),AUTH+'/api/accounts/authorize');
 const reply=await fetch(url+'/api/chatgpt/respond',{method:'POST',headers,body:JSON.stringify({model:'available',input:[{role:'user',content:'notes'}]})});const lines=(await reply.text()).trim().split('\n').map(JSON.parse);assert.deepEqual(lines.map(x=>x.type),['delta','error']);
 const callback=await fetch(url+'/auth/callback?state=bad');assert.equal(callback.status,400);const html=await callback.text();assert.equal(html.includes('<script>unsafe'),false);assert.equal(html.includes('&lt;script&gt;'),true);assert.match(callback.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('flashcard replies accept bounded JSON only and never execute embedded text',()=>{
 assert.deepEqual(flashcardsFromAnswer('```json\n[{"question":" Q ","answer":" A "}]\n```'),[{question:'Q',answer:'A'}]);
 for(const input of ['not JSON','[]','[{"question":"x","answer":1}]','[{"question":"","answer":"a"}]',JSON.stringify(Array.from({length:201},()=>({question:'q',answer:'a'})))])assert.throws(()=>flashcardsFromAnswer(input));
});
