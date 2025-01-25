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
    console.log(`[Attempt ${retryCount + 1}/${MAX_RETRIES + 1}] Generating image with ${modelId}`);
    console.log(`Prompt: "${prompt}"`);
    
    const parameters = modelId.includes('waifu') ? {
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
    };

    console.log('Request parameters:', JSON.stringify(parameters, null, 2));
    
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
          parameters
        }),
      }
    );

    console.log(`Response status: ${response.status} (${response.statusText})`);
    
    // Try to get response body for better error logging
    const responseBody = await response.text();
    console.log('Response body:', responseBody);

    // Check if the response is JSON
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(responseBody);
      if (jsonResponse.error) {
        throw new Error(`API Error: ${jsonResponse.error}`);
      }
    } catch (e) {
      // If it's not JSON, it might be the image data
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}, body: ${responseBody}`);
      }
    }

    if (response.status === 503 && retryCount < MAX_RETRIES) {
      console.log('Model is warming up, will retry');
      if (retryCount === 0) {
        throw new Error('MODEL_LOADING:20');
      }
      await sleep(RETRY_DELAY);
      return generateImageWithRetry(modelId, prompt, API_KEY, retryCount + 1);
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}, body: ${responseBody}`);
    }

    // Convert response back to ArrayBuffer if it was successful
    if (typeof responseBody === 'string' && !responseBody.startsWith('{')) {
      return Buffer.from(responseBody, 'binary');
    }

    throw new Error('Invalid response format from API');
  } catch (error: any) {
    console.error('Generation error:', {
      message: error.message,
      stack: error.stack,
      modelId,
      retryCount,
      prompt
    });

    if (error.message === 'MODEL_LOADING:20') {
      throw error;
    }

    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying after error (${retryCount + 1}/${MAX_RETRIES})`);
      await sleep(RETRY_DELAY);
      return generateImageWithRetry(modelId, prompt, API_KEY, retryCount + 1);
    }
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const { prompt, model } = await request.json();
    console.log(`New request - Model: ${model}, Prompt: "${prompt}"`);

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const API_KEY = process.env.HUGGINGFACE_API_KEY;
    if (!API_KEY) {
      console.error('Missing API key');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    const userId = request.headers.get('x-forwarded-for') || 'anonymous';
    if (isRateLimited(userId)) {
      console.log(`Rate limit exceeded for ${userId}`);
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait 1 minute.' },
        { status: 429 }
      );
    }

    const modelId = model === 'waifu' 
      ? 'hakurei/waifu-diffusion'
      : 'prompthero/openjourney-v4';

    const enhancedPrompt = model === 'waifu'
      ? `masterpiece, best quality, ultra-detailed, illustration, ${prompt}, anime style`
      : `${prompt}, high quality, masterpiece, highly detailed, realistic`;

    console.log(`Selected model: ${modelId}`);
    console.log(`Enhanced prompt: "${enhancedPrompt}"`);

    try {
      const imageBuffer = await generateImageWithRetry(modelId, enhancedPrompt, API_KEY);
      console.log('Successfully generated image');
      const base64Image = Buffer.from(imageBuffer).toString('base64');
      return NextResponse.json({ output: `data:image/jpeg;base64,${base64Image}` });
    } catch (error: any) {
      console.error('Generation failed:', {
        error: error.message,
        stack: error.stack,
        modelId
      });

      if (error.message === 'MODEL_LOADING:20') {
        return NextResponse.json(
          { error: 'Model is currently loading. Please wait 20 seconds.' },
          { status: 503 }
        );
      }

      if (error.message?.includes('429')) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait a minute.' },
          { status: 429 }
        );
      }

      return NextResponse.json(
        { error: `Failed to generate image: ${error.message}` },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Request processing error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
} 