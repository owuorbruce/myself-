import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/chatgpt.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const client=await import('data:text/javascript;base64,'+Buffer.from(javascript).toString('base64'));
const session={available:true,connected:true,planEnabled:true,requestToken:'csrf',accounts:[],active:'one',pending:false,error:'',account:'Test'};
function mock(t,fetcher,popup={opener:{},location:{},close(){}}){
 const prior={fetch:globalThis.fetch,window:globalThis.window,location:globalThis.location};
 globalThis.location={href:'http://localhost:4173/',origin:'http://localhost:4173',hostname:'localhost'};globalThis.window={open:()=>popup};globalThis.fetch=fetcher;
 t.after(()=>{for(const [name,value] of Object.entries(prior))if(value===undefined)delete globalThis[name];else globalThis[name]=value;});return popup;
}
test('client keeps request token in memory, sanitizes session and opens only a same-origin sign-in ticket',async(t)=>{
 const calls=[];const popup=mock(t,async(url,init)=>{calls.push({url:url.href,init});return Response.json(url.href.endsWith('/session')?session:{url:'/api/chatgpt/authorize?ticket=one'});});
 const result=await client.chatGPTSession();assert.equal('requestToken' in result,false);await client.signInChatGPT();assert.equal(popup.opener,null);assert.equal(popup.location.href,'http://localhost:4173/api/chatgpt/authorize?ticket=one');
 const signin=calls.find(x=>x.url.endsWith('/sign-in'));assert.equal(signin.init.headers['X-Slate-Token'],'csrf');assert.equal(signin.init.cache,'no-store');
});
test('blocked popup never starts an authorization attempt',async(t)=>{
 let called=false;mock(t,async()=>{called=true;},null);await assert.rejects(client.signInChatGPT(),/blocked/);assert.equal(called,false);
});
test('external sign-in links are rejected and the blank popup is closed',async(t)=>{
 let closed=false;const popup={location:{},close(){closed=true;}};mock(t,async(url)=>Response.json(url.href.endsWith('/session')?session:{url:'https://evil.test/token'}),popup);
 await assert.rejects(client.signInChatGPT(),/Invalid sign-in link/);assert.equal(closed,true);assert.equal(popup.location.href,undefined);
});
test('client accepts complete replies and rejects a partial answer with a usage error',async(t)=>{
 let fail=false;mock(t,async(url)=>{
  if(url.href.endsWith('/session'))return Response.json(session);
  const events=[{type:'delta',text:'Hello 🌍'},fail?{type:'error',error:'Plan usage reached'}:{type:'completed',text:'Hello 🌍'}];
  return new Response(events.map(x=>JSON.stringify(x)+'\n').join(''));
 });const seen=[];const signal=new AbortController().signal;
 assert.equal(await client.askChatGPT('model',[{role:'user',content:'notes'}],x=>seen.push(x),signal),'Hello 🌍');assert.deepEqual(seen,['Hello 🌍','Hello 🌍']);
 fail=true;await assert.rejects(client.askChatGPT('model',[{role:'user',content:'notes'}],()=>{},signal),/Plan usage reached/);
});
test('client treats EOF without completion as an error and requires actual plan permission',async(t)=>{
 let granted=true,calls=0;mock(t,async(url)=>{if(url.href.endsWith('/session'))return Response.json({...session,planEnabled:granted});calls++;return new Response('{"type":"delta","text":"partial"}\n');});
 const signal=new AbortController().signal;await assert.rejects(client.askChatGPT('model',[{role:'user',content:'notes'}],()=>{},signal),/didn't finish/);
 granted=false;await assert.rejects(client.askChatGPT('model',[{role:'user',content:'notes'}],()=>{},signal),/allow plan usage/);assert.equal(calls,1);
});
test('offline navigation never intercepts sign-in authorization or callback',async()=>{
 const serviceworker=await readFile(new URL('../dist/sw.js',import.meta.url),'utf8');assert.match(serviceworker,/denylist/);assert.match(serviceworker,/\\\/api\\\//);assert.match(serviceworker,/\\\/auth\\\//);
});
test('desktop sign-in opens the system-browser bridge without creating a renderer popup',async(t)=>{
 let popup=false,opened='';mock(t,async(url)=>Response.json(url.href.endsWith('/session')?session:{url:'/api/chatgpt/authorize?ticket=one'}));
 globalThis.window={open:()=>{popup=true;},slateDesktop:{openSignIn:async url=>{opened=url;}}};
 await client.signInChatGPT();assert.equal(popup,false);assert.equal(opened,'http://localhost:4173/api/chatgpt/authorize?ticket=one');
});
