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

interface GenerationError {
  status: number;
  error: any;
}

async function generateImageWithRetry(
  modelId: string,
  prompt: string,
  API_KEY: string,
  retryCount = 0
): Promise<ArrayBuffer> {
  try {
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
          parameters: {
            negative_prompt: "blurry, bad quality, worst quality, jpeg artifacts, text, watermark, nsfw, nude, low quality",
            num_inference_steps: 25,
            guidance_scale: 7.5,
            width: 512,
            height: 512,
            seed: Math.floor(Math.random() * 1000000)
          }
        }),
      }
    );

    if (response.ok) {
      return await response.arrayBuffer();
    }

    const errorData = await response.json().catch(() => ({}));
    console.log(`API Response for ${modelId}:`, { status: response.status, error: errorData });
    
    if (response.status === 503 && retryCount < MAX_RETRIES) {
      console.log(`Model warming up, retry ${retryCount + 1} of ${MAX_RETRIES}`);
      await sleep(RETRY_DELAY);
      return generateImageWithRetry(modelId, prompt, API_KEY, retryCount + 1);
    }

    throw new Error(JSON.stringify({ status: response.status, error: errorData }));
  } catch (error) {
    console.error(`Error with model ${modelId}:`, error);
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const { prompt, model } = await request.json();

    if (!prompt) {
      return NextResponse.json({ error: 'Prompt is required' }, { status: 400 });
    }

    const API_KEY = process.env.HUGGINGFACE_API_KEY;
    if (!API_KEY) {
      return NextResponse.json(
        { error: 'Hugging Face API key not configured' },
        { status: 500 }
      );
    }

    // Use IP as user identifier for rate limiting
    const userId = request.headers.get('x-forwarded-for') || 'anonymous';
    if (isRateLimited(userId)) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please wait 1 minute before trying again.' },
        { status: 429 }
      );
    }

    // Select the appropriate model and prompt
    const modelId = model === 'waifu'
      ? 'Linaqruf/anything-v3.0'  // Changed to a more reliable anime model
      : 'dreamlike-art/dreamlike-diffusion-1.0';  // Changed to a more reliable general model

    const enhancedPrompt = model === 'waifu'
      ? `masterpiece, best quality, anime style, ${prompt}, highly detailed anime artwork`
      : `${prompt}, masterpiece, best quality, highly detailed, sharp focus, dramatic`;

    try {
      const imageBuffer = await generateImageWithRetry(modelId, enhancedPrompt, API_KEY);
      const base64Image = Buffer.from(imageBuffer).toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;
      return NextResponse.json({ output: dataUrl });
    } catch (error) {
      console.error('Generation error:', error);
      
      try {
        const errorData = JSON.parse((error as Error).message) as GenerationError;
        if (errorData.status === 429) {
          return NextResponse.json(
            { error: 'Too many requests. Please wait a minute and try again.' },
            { status: 429 }
          );
        }
      } catch (e) {
        // Parsing error, fall through to default error
      }

      return NextResponse.json(
        { error: 'Failed to generate image. Please try again.' },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Request error:', error);
    return NextResponse.json(
      { error: 'Failed to process request. Please try again.' },
      { status: 500 }
    );
  }
} 