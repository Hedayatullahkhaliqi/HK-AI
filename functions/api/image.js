const MAX_PROMPT_LENGTH=1200;
export async function onRequestPost({request,env}){
  try{
    if(!env.AI)return new Response(JSON.stringify({error:"سرویس ساخت تصویر در این پروژه فعال نیست."}),{status:503,headers:{"Content-Type":"application/json"}});
    const body=await request.json();
    const prompt=typeof body.prompt==="string"?body.prompt.trim():"";
    if(!prompt||prompt.length>MAX_PROMPT_LENGTH)return new Response(JSON.stringify({error:"توضیح تصویر خالی یا بیش از حد طولانی است."}),{status:400,headers:{"Content-Type":"application/json"}});
    const image=await env.AI.run("@cf/black-forest-labs/flux-1-schnell",{prompt,num_steps:4});
    return new Response(image,{headers:{"Content-Type":"image/png","Cache-Control":"no-store"}});
  }catch(error){
    return new Response(JSON.stringify({error:"ساخت تصویر انجام نشد: "+String(error?.message||error)}),{status:500,headers:{"Content-Type":"application/json"}});
  }
}
