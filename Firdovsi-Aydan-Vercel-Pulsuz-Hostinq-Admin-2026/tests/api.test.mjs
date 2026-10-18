import assert from 'node:assert/strict';
import handler from '../api/site.js';

process.env.UPSTASH_REDIS_REST_URL = 'https://test-db.upstash.io';
process.env.UPSTASH_REDIS_REST_TOKEN = 'FAKE-NEVER-USE-IN-PRODUCTION';
process.env.ADMIN_SETUP_KEY = 'long-private-install-code-only-for-test';
const db = new Map();
const hash = new Map();
let commands=0;
function execute([op,key,...args]) {
  commands++;
  switch (op) {
    case 'GET': return db.has(key) ? db.get(key) : null;
    case 'SET': {
      const [value,modifier] = args;
      if (args.includes('NX') && db.has(key)) return null;
      db.set(key,value);return 'OK';
    }
    case 'DEL': {const present=db.has(key);db.delete(key);return present?1:0;}
    case 'INCR': {const next=(db.get(key)||0)+1;db.set(key,next);return next;}
    case 'EXPIRE':return db.has(key)?1:0;
    case 'HLEN':return hash.get(key)?.size||0;
    case 'HSET': {const [id,value]=args;const map=hash.get(key)||new Map();const isNew=!map.has(id);map.set(id,value);hash.set(key,map);return isNew?1:0;}
    case 'HGET':return hash.get(key)?.get(args[0])||null;
    case 'HDEL':return hash.get(key)?.delete(args[0])?1:0;
    case 'HGETALL':return Array.from(hash.get(key)||new Map()).flat();
    default:throw new Error('Unsupported mock '+op);
  }
}
globalThis.fetch=async(url,opts)=>{
  assert.ok(url.startsWith('https://test-db.upstash.io'));
  assert.equal(opts.headers.Authorization,'Bearer FAKE-NEVER-USE-IN-PRODUCTION');
  const payload=JSON.parse(opts.body);
  const data=url.endsWith('/pipeline')?payload.map(c=>({result:execute(c)})):{result:execute(payload)};
  return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
};
async function call({method='GET',action='',body={},cookies='',csrf='',origin='https://wedding.example'}={}){
  const headers={host:'wedding.example',origin,cookie:cookies,'content-type':'application/json','x-csrf-token':csrf};
  const req={method,query:{action},body,headers};
  const res={statusCode:200,headers:{},setHeader(k,v){this.headers[k.toLowerCase()]=v;},end(str){this.data=JSON.parse(str);}};
  await handler(req,res);
  return {status:res.statusCode,data:res.data,cookie:res.headers['set-cookie']};
}
function post(action,body={},auth={}){return call({method:'POST',body:{action,...body},...auth});}
let response=await call({action:'status'});
assert.deepEqual([response.status,response.data.initialized,response.data.admin],[200,false,false]);
response=await post('setup',{installCode:'wrong-install-code',password:'very-long-password'});
assert.equal(response.status,401);
response=await post('setup',{installCode:process.env.ADMIN_SETUP_KEY,password:'very-long-password'});
assert.equal(response.status,200);
let auth={cookies:response.cookie.split(';')[0],csrf:response.data.csrf};
assert.ok(auth.cookies.startsWith('firdovsi_admin_session='));
assert.ok(response.cookie.includes('HttpOnly')&&response.cookie.includes('SameSite=Strict')&&response.cookie.includes('Secure'));
response=await post('setup',{installCode:process.env.ADMIN_SETUP_KEY,password:'new-password-is-unsafe'});
assert.equal(response.status,409);
response=await call({action:'status',...auth});
assert.equal(response.data.initialized,true);
assert.equal(response.data.admin,true);
response=await post('add',{rows:[{name:'Əli Məmmədov',tableNo:9},{name:'Aydan Əliyeva',tableNo:21,arrived:true}]},{cookies:auth.cookies,csrf:'BAD-TOKEN'});
assert.equal(response.status,403);
response=await post('add',{rows:[{name:'Əli Məmmədov',tableNo:9}]},{cookies:auth.cookies,csrf:auth.csrf,origin:'https://evil.example'});
assert.equal(response.status,403);
response=await post('add',{rows:[{name:'Əli Məmmədov',tableNo:9},{name:'Aydan Əliyeva',tableNo:21,arrived:true}]},auth);
assert.equal(response.status,200);
response=await call({action:'guests',...auth});
assert.equal(response.status,200);assert.equal(response.data.guests.length,2);
assert.equal(response.data.guests.find(g=>g.name==='Aydan Əliyeva').arrived,true);
const id=response.data.guests.find(g=>g.name==='Əli Məmmədov').id;
response=await call({action:'guests',origin:'https://wedding.example',cookies:'',csrf:'',method:'GET'});
assert.equal(response.data.guests.length,0);
response=await call({action:'guests',origin:'https://wedding.example',cookies:'',csrf:'',method:'GET',body:{}});
assert.equal(response.data.guests.length,0);
response=await post('edit',{id,name:'Əli Məmmədov',tableNo:30},auth);
assert.equal(response.status,200);
response=await post('arrived',{id,value:true},auth);
assert.equal(response.status,200);
response=await call({action:'guests',...auth});
assert.equal(response.data.guests.find(g=>g.id===id).tableNo,30);
assert.equal(response.data.guests.find(g=>g.id===id).arrived,true);
response=await post('delete',{id},auth);
assert.equal(response.status,200);
response=await post('logout',{},auth);
assert.equal(response.status,200);
response=await call({action:'status',...auth});
assert.equal(response.data.admin,false);
response=await post('login',{password:'not-my-password'});
assert.equal(response.status,401);
response=await post('login',{password:'very-long-password'});
assert.equal(response.status,200);
assert.ok(response.data.csrf);
console.log(`PASSED: admin setup, one-time password, cookie+CSRF, origins, create, edit, arrival, delete, logout, login, ${commands} mocked Redis commands`);
