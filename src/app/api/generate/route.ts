import { NextResponse } from 'next/server';

// Simple in-memory rate limiting
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5; // Increased to 5 requests per minute

const requestLog: { [key: string]: number[] } = {};

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const userRequests = requestLog[userId] || [];
  
  // Clean up old requests
  requestLog[userId] = userRequests.filter(timestamp => 
    now - timestamp < RATE_LIMIT_WINDOW
  );

  // Check if user has exceeded rate limit
  if (requestLog[userId].length >= MAX_REQUESTS_PER_WINDOW) {
    return true;
  }

  // Log new request
  requestLog[userId] = [...requestLog[userId], now];
  return false;
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

    // Select the appropriate model based on user choice
    const modelId = model === 'waifu' 
      ? 'stabilityai/stable-diffusion-xl-base-1.0'  // Using SDXL for better quality and rate limits
      : 'stabilityai/stable-diffusion-2-1';  // Using SD 2.1 for better rate limits

    // Generate the image
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${modelId}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: model === 'waifu' 
            ? `anime artwork, anime style art, high quality anime, ${prompt}, masterpiece, highly detailed`
            : `${prompt}, high quality, masterpiece, highly detailed`,
          parameters: {
            negative_prompt: "blurry, bad quality, worst quality, jpeg artifacts, text, watermark, nsfw, nude, low quality",
            num_inference_steps: 20,  // Reduced for faster generation
            guidance_scale: 7.0,
            width: 512,
            height: 512,
            seed: Math.floor(Math.random() * 1000000)  // Random seed for variety
          }
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('API Error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      
      if (response.status === 503) {
        return NextResponse.json(
          { error: 'Model is warming up, please try again in a few seconds' },
          { status: 503 }
        );
      }

      if (response.status === 429) {
        return NextResponse.json(
          { error: 'Too many requests. Please wait a minute and try again.' },
          { status: 429 }
        );
      }

      if (response.status === 413) {
        return NextResponse.json(
          { error: 'Prompt is too long. Please try a shorter prompt.' },
          { status: 413 }
        );
      }

      throw new Error(`Hugging Face API error: ${response.statusText}`);
    }

    // Convert the binary image to base64
    const imageBuffer = await response.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    return NextResponse.json({ output: dataUrl });
  } catch (error) {
    console.error('Error generating image:', error);
    return NextResponse.json(
      { error: 'Failed to generate image. Please try again in a few seconds.' },
      { status: 500 }
    );
  }
} 