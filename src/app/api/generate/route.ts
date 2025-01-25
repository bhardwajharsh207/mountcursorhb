import { NextResponse } from 'next/server';

// Simple in-memory rate limiting
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5;
const MAX_RETRIES = 3;
const RETRY_DELAY = 2000; // 2 seconds

const requestLog: { [key: string]: number[] } = {};

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const userRequests = requestLog[userId] || [];
  requestLog[userId] = userRequests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  if (requestLog[userId].length >= MAX_REQUESTS_PER_WINDOW) return true;
  requestLog[userId] = [...requestLog[userId], now];
  return false;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateImageWithRetry(modelId: string, prompt: string, API_KEY: string, retryCount = 0): Promise<ArrayBuffer> {
  try {
    const isOpenJourney = modelId.includes('openjourney');
    console.log(`Attempting to generate image with ${isOpenJourney ? 'OpenJourney' : 'Waifu'} model (${modelId})`);
    console.log(`Attempt ${retryCount + 1} of ${MAX_RETRIES + 1}`);
    console.log(`Using prompt: ${prompt}`);
    
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${modelId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: prompt,
          parameters: modelId.includes('waifu') ? {
            negative_prompt: "lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry",
            num_inference_steps: 30,
            guidance_scale: 11,
            width: 512,
            height: 512,
            seed: Math.floor(Math.random() * 1000000)
          } : {
            negative_prompt: "blurry, bad quality, worst quality, jpeg artifacts, text, watermark, nsfw, nude, low quality",
            num_inference_steps: 20,
            guidance_scale: 7.0,
            width: 512,
            height: 512,
            seed: Math.floor(Math.random() * 1000000)
          }
        }),
      }
    );

    console.log(`Response status: ${response.status} (${response.statusText})`);

    if (response.status === 503 && retryCount < MAX_RETRIES) {
      console.log(`${isOpenJourney ? 'OpenJourney' : 'Waifu'} model warming up, waiting ${RETRY_DELAY}ms before retry`);
      await sleep(RETRY_DELAY);
      return generateImageWithRetry(modelId, prompt, API_KEY, retryCount + 1);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`API Error for ${isOpenJourney ? 'OpenJourney' : 'Waifu'} model:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorText,
        modelId,
        retryCount
      });
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }

    console.log(`Successfully received response from ${isOpenJourney ? 'OpenJourney' : 'Waifu'} model`);
    return await response.arrayBuffer();
  } catch (error: any) {
    const isOpenJourney = modelId.includes('openjourney');
    console.error(`Error in ${isOpenJourney ? 'OpenJourney' : 'Waifu'} model:`, {
      error: error.message || String(error),
      stack: error.stack || 'No stack trace',
      modelId,
      retryCount,
      prompt
    });

    if (retryCount < MAX_RETRIES) {
      console.log(`Error occurred with ${isOpenJourney ? 'OpenJourney' : 'Waifu'} model, retry ${retryCount + 1}/${MAX_RETRIES}`);
      await sleep(RETRY_DELAY);
      return generateImageWithRetry(modelId, prompt, API_KEY, retryCount + 1);
    }
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const { prompt, model } = await request.json();
    console.log(`Received request for ${model} model with prompt: ${prompt}`);

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const API_KEY = process.env.HUGGINGFACE_API_KEY;
    if (!API_KEY) {
      console.error('Hugging Face API key not configured');
      return NextResponse.json(
        { error: 'Hugging Face API key not configured' },
        { status: 500 }
      );
    }

    // Use IP as user identifier for rate limiting
    const userId = request.headers.get('x-forwarded-for') || 'anonymous';
    if (isRateLimited(userId)) {
      console.log(`Rate limit exceeded for user ${userId}`);
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait 1 minute before trying again.' },
        { status: 429 }
      );
    }

    // Select the appropriate model and prompt
    const modelId = model === 'waifu' 
      ? 'hakurei/waifu-diffusion'  // Original waifu-diffusion model
      : 'prompthero/openjourney-v4';  // Keep OpenJourney as is

    const enhancedPrompt = model === 'waifu'
      ? `masterpiece, best quality, ultra-detailed, illustration, ${prompt}, anime style`
      : `${prompt}, high quality, masterpiece, highly detailed, realistic`;

    console.log(`Using model: ${modelId} with enhanced prompt: ${enhancedPrompt}`);

    try {
      const imageBuffer = await generateImageWithRetry(modelId, enhancedPrompt, API_KEY);
      console.log(`Successfully generated image with ${model} model`);
      const base64Image = Buffer.from(imageBuffer).toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;
      return NextResponse.json({ output: dataUrl });
    } catch (error: any) {
      console.error(`Error generating image with ${model} model:`, {
        error: error.message || String(error),
        stack: error.stack || 'No stack trace',
        modelId,
        prompt: enhancedPrompt
      });
      
      if (error.message?.includes('429')) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait a minute and try again.' },
          { status: 429 }
        );
      }

      if (error.message?.includes('503')) {
        return NextResponse.json(
          { error: 'Model is currently loading. Please try again in a few seconds.' },
          { status: 503 }
        );
      }

      return NextResponse.json(
        { error: `Failed to generate image: ${error.message || 'Unknown error'}` },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Error in API route:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred. Please try again.' },
      { status: 500 }
    );
  }
} 