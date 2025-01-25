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
          wait_for_model: true
        }),
      }
    );

    if (response.ok) {
      return await response.arrayBuffer();
    }

    const errorData = await response.json().catch(() => ({}));
    console.log(`API Response for ${modelId}:`, { status: response.status, error: errorData });
    
    if ((response.status === 503 || errorData.error?.includes('loading')) && retryCount < MAX_RETRIES) {
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

    // Using a single, reliable model for both types
    const modelId = 'SG161222/Realistic_Vision_V5.1_noVAE';

    // Prepare the prompt based on the model type
    const enhancedPrompt = model === 'waifu'
      ? `anime artwork, anime style, ${prompt}, best quality, masterpiece`
      : `${prompt}, best quality, masterpiece, realistic`;

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
            inputs: enhancedPrompt,
            options: {
              wait_for_model: true,
              use_cache: false
            }
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        console.error('API Error:', {
          status: response.status,
          error
        });
        throw new Error(JSON.stringify({ status: response.status, error }));
      }

      const imageBuffer = await response.arrayBuffer();
      const base64Image = Buffer.from(imageBuffer).toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;
      
      return NextResponse.json({ output: dataUrl });
    } catch (error) {
      console.error('Generation error:', error);
      return NextResponse.json(
        { error: 'Failed to generate image. The service might be busy, please try again in a minute.' },
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