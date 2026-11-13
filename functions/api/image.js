const MAX_PROMPT_LENGTH=1200;
const MAX_IMAGE_LENGTH=8*1024*1024;
const MAX_REFERENCE_IMAGES=4;
const IMAGE_PROMPT_MODEL="@cf/zai-org/glm-4.7-flash";
const IMAGE_MODEL="@cf/black-forest-labs/flux-2-klein-4b";

function json(data,status=200){
  return new Response(JSON.stringify(data),{
    status,
    headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
  });
}

async function prepareImagePrompt(env,userPrompt){
  try{
    const result=await env.AI.run(IMAGE_PROMPT_MODEL,{
      messages:[
        {
          role:"system",
          content:"You are an expert image-prompt writer. Rewrite the user's description as a clear, visually precise English prompt for FLUX.2. Preserve the exact requested subject, number of subjects, setting, action, identity, clothing, composition, and important details. Never replace the subject or invent major objects, people, animals, buildings, or scenery. Improve clarity, camera framing, lighting, materials, texture, and visual coherence only where consistent with the request. If the user asks to edit a reference image, explicitly preserve all unmentioned details and change only what they requested. Return only the improved prompt, without explanations, quotes, headings, or markdown."
        },
        {role:"user",content:userPrompt}
      ],
      max_tokens:550,
      temperature:0.1,
      chat_template_kwargs:{enable_thinking:false}
    });

    let prompt="";
    if(typeof result==="string")prompt=result;
    else if(typeof result?.response==="string")prompt=result.response;
    else if(typeof result?.output_text==="string")prompt=result.output_text;
    else if(typeof result?.text==="string")prompt=result.text;
    else if(typeof result?.choices?.[0]?.message?.content==="string")prompt=result.choices[0].message.content;

    prompt=String(prompt||"").trim()
      .replace(/^\x60{3}[^\n]*\n?/,"")
      .replace(/\x60{3}$/,"")
      .replace(/^["']|["']$/g,"")
      .trim();

    if(!prompt||prompt.length>2400)return userPrompt;
    return prompt;
  }catch(error){
    console.error("HK image prompt preparation failed; using original prompt.");
    return userPrompt;
  }
}

function decodeImage(dataUri){
  const match=dataUri.match(/^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if(!match)throw new Error("Unsupported reference image. Use JPG, PNG, or WebP.");
  const binary=atob(match[2]);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
  const subtype=match[1].toLowerCase();
  return new Blob([bytes],{type:"image/"+(subtype==="jpg"?"jpeg":subtype)});
}

function imageResponse(result){
  if(result instanceof Response){
    const headers=new Headers(result.headers);
    headers.set("Content-Type",headers.get("Content-Type")||"image/png");
    headers.set("Cache-Control","no-store");
    return new Response(result.body,{status:result.status,headers});
  }
  if(result instanceof ReadableStream){
    return new Response(result,{headers:{"Content-Type":"image/png","Cache-Control":"no-store"}});
  }
  if(result instanceof ArrayBuffer||ArrayBuffer.isView(result)){
    return new Response(result,{headers:{"Content-Type":"image/png","Cache-Control":"no-store"}});
  }
  if(typeof result?.image==="string"){
    const base64=result.image.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/,"");
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))throw new Error("The image model returned invalid image data.");
    const binary=atob(base64);
    const bytes=new Uint8Array(binary.length);
    for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);
    return new Response(bytes,{headers:{"Content-Type":"image/png","Cache-Control":"no-store"}});
  }
  throw new Error("The image model did not return a usable result.");
}

const ASPECT_RATIOS={
  square:[1024,1024],
  portrait:[832,1024],
  vertical:[576,1024],
  landscape:[1024,768],
  widescreen:[1024,576]
};

const STYLE_PRESETS={
  auto:"",
  photorealistic:"Photorealistic photography, natural details, realistic materials and lifelike lighting.",
  cinematic:"Cinematic composition, dramatic but natural lighting, rich atmosphere, professional film still.",
  digital:"High-quality digital illustration, refined shapes, clean details and balanced colors.",
  "3d":"Premium 3D render, realistic materials, detailed textures, professional studio lighting.",
  anime:"Beautiful anime-inspired illustration, expressive clean linework and carefully composed colors.",
  watercolor:"Traditional watercolor painting, delicate pigment textures, soft natural color transitions.",
  fantasy:"Elegant fantasy concept art, atmospheric depth, intricate environmental details and magical realism.",
  product:"Professional commercial product photography, clean composition, precise materials and controlled studio lighting."
};

export async function onRequestPost({request,env}){
  try{
    if(!env.AI)return json({error:"Image generation and editing are not enabled for this project."},503);
    const body=await request.json();
    const prompt=typeof body.prompt==="string"?body.prompt.trim():"";

    if(!prompt||prompt.length>MAX_PROMPT_LENGTH){
      return json({error:"The image prompt is empty or too long."},400);
    }

    if(body.action==="enhance"){
      const enhanced=await prepareImagePrompt(env,prompt);
      return json({prompt:enhanced});
    }

    let references=[];
    if(Array.isArray(body.images))references=body.images;
    else if(typeof body.image==="string"&&body.image)references=[body.image];

    if(references.length>MAX_REFERENCE_IMAGES){
      return json({error:"You can use up to four reference images."},400);
    }

    for(const item of references){
      if(typeof item!=="string"||item.length>MAX_IMAGE_LENGTH){
        return json({error:"A reference image is too large. Please choose a smaller image."},413);
      }
      if(!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(item)){
        return json({error:"A reference image format is not supported. Use JPG, PNG, or WebP."},400);
      }
    }

    const ratio=ASPECT_RATIOS[body.aspectRatio]||ASPECT_RATIOS.square;
    const style=STYLE_PRESETS[body.style]!==undefined?STYLE_PRESETS[body.style]:"";
    const guidance=Number.isFinite(Number(body.guidance))
      ?Math.min(10,Math.max(1,Number(body.guidance))):3.5;

    let imagePrompt=await prepareImagePrompt(env,prompt);
    if(style)imagePrompt=imagePrompt+" "+style;

    const form=new FormData();
    form.append("prompt",imagePrompt);
    form.append("width",String(ratio[0]));
    form.append("height",String(ratio[1]));
    form.append("guidance",String(guidance));

    references.forEach((dataUri,index)=>{
      form.append("input_image_"+index,decodeImage(dataUri),"reference-"+(index+1)+".jpg");
    });

    const serialized=new Response(form);
    const result=await env.AI.run(IMAGE_MODEL,{
      multipart:{
        body:serialized.body,
        contentType:serialized.headers.get("content-type")
      }
    });

    return imageResponse(result);
  }catch(error){
    console.error("HK image operation failed:",error);
    return json({error:"The image operation failed. Please try again later."},500);
  }
}
