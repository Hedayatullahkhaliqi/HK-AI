const ALLOWED_ORIGINS = new Set(["https://hk-ai.pages.dev","https://feature-chat-image-generatio.hk-ai.pages.dev","capacitor://localhost","https://localhost","http://localhost"]);
const BODY_LIMITS = {"/api/chat":11*1024*1024,"/api/image":11*1024*1024,"/api/transcribe":16*1024*1024,"/api/tts":64*1024};
function isAllowedOrigin(origin){return ALLOWED_ORIGINS.has(origin);}
function secure(h){h.set("X-Content-Type-Options","nosniff");h.set("Referrer-Policy","no-referrer");h.set("X-Frame-Options","DENY");h.set("Permissions-Policy","camera=(), geolocation=(), payment=()");h.set("Cache-Control","no-store");return h;}
function reply(data,status,cors){const h=new Headers(cors);h.set("Content-Type","application/json; charset=utf-8");secure(h);return new Response(JSON.stringify(data),{status,headers:h});}
export async function onRequest({request,env,next}){
 const url=new URL(request.url); if(!url.pathname.startsWith("/api/")) return next();
 const origin=request.headers.get("Origin");
 if(origin&&!isAllowedOrigin(origin)) return reply({error:"Origin not allowed"},403);
 const cors=new Headers();
 if(origin){cors.set("Access-Control-Allow-Origin",origin);cors.set("Vary","Origin");}
 cors.set("Access-Control-Allow-Methods","POST, OPTIONS");cors.set("Access-Control-Allow-Headers","Content-Type");cors.set("Access-Control-Max-Age","86400");
 if(request.method==="OPTIONS"){secure(cors);return new Response(null,{status:204,headers:cors});}
 if(request.method!=="POST"){cors.set("Allow","POST, OPTIONS");return reply({error:"Method not allowed"},405,cors);}
 const max=BODY_LIMITS[url.pathname];if(!max)return reply({error:"Not found"},404,cors);
 const contentLength=request.headers.get("Content-Length");
 if(contentLength!==null){
   const size=Number(contentLength);
   if(!Number.isSafeInteger(size)||size<0)return reply({error:"Invalid Content-Length header."},400,cors);
   if(size>max)return reply({error:"Request body too large."},413,cors);
 }
 if(!request.headers.get("Content-Type")?.toLowerCase().includes("application/json"))return reply({error:"Content-Type must be application/json"},415,cors);
 // Fail closed: never bypass rate limiting when the Durable Object binding is unavailable.
 if(!env.HK_RATE_LIMITER){
   console.error("HK rate limit: Durable Object binding missing");
   return reply({error:"The Durable Object rate limiter is not configured for this environment.",code:"RATE_LIMITER_BINDING_MISSING"},503,cors);
 }
 const ip=request.headers.get("CF-Connecting-IP");
 if(!ip){
   return reply({error:"The request could not be security-validated."},503,cors);
 }
 const maxRequests=url.pathname==="/api/image"?5:30;
 let result;
 try{
   const id=env.HK_RATE_LIMITER.idFromName(url.pathname+":"+ip);
   const limiter=env.HK_RATE_LIMITER.get(id);
   const limiterResponse=await limiter.fetch("https://hk-ai-rate-limiter/check",{
     method:"POST",
     headers:{"Content-Type":"application/json"},
     body:JSON.stringify({limit:maxRequests,windowMs:60000})
   });
   if(!limiterResponse.ok){
     console.error("HK rate limit: Durable Object returned an error");
     return reply({error:"The rate limiter is temporarily unavailable.",code:"RATE_LIMITER_UNAVAILABLE"},503,cors);
   }
   result=await limiterResponse.json();
 }catch(error){
   console.error("HK rate limit: Durable Object request failed");
   return reply({error:"The rate limiter is temporarily unavailable.",code:"RATE_LIMITER_UNAVAILABLE"},503,cors);
 }
 if(!result||typeof result.allowed!=="boolean"){
   console.error("HK rate limit: invalid Durable Object response");
   return reply({error:"The rate limiter returned an invalid response.",code:"RATE_LIMITER_INVALID_RESPONSE"},503,cors);
 }
 if(!result.allowed){
   const retryMs=Number.isSafeInteger(result.retryAfterMs)?Math.max(1,Math.min(result.retryAfterMs,60000)):60000;
   const retrySeconds=Math.ceil(retryMs/1000);
   cors.set("Retry-After",String(retrySeconds));
   return reply({error:"Too many requests. Please try again later."},429,cors);
 }
 const response=await next();const headers=new Headers(response.headers);for(const [k,v] of cors)headers.set(k,v);secure(headers);
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
