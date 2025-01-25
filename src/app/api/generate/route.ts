import { NextResponse } from 'next/server';

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

    // Select the appropriate model based on user choice
    const modelId = model === 'waifu' 
      ? 'CompVis/stable-diffusion-v1-4'  // Using a more stable model for anime-style images
      : 'prompthero/openjourney-v4';

    // First, check if the model is ready
    const statusResponse = await fetch(
      `https://api-inference.huggingface.co/models/${modelId}`,
      {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
        },
      }
    );

    const statusData = await statusResponse.json();
    if (statusData.error === 'Model is currently loading') {
      return NextResponse.json(
        { error: 'Model is warming up, please try again in a few seconds' },
        { status: 503 }
      );
    }

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
            ? `anime style, high quality, masterpiece, ${prompt}`  // Enhance prompt for anime style
            : prompt,
          parameters: {
            negative_prompt: "blurry, bad quality, worst quality, jpeg artifacts, text, watermark",
            num_inference_steps: 50,  // Increased steps for better quality
            guidance_scale: 7.5,
            width: 512,
            height: 512
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
          { error: 'Too many requests. Please wait a minute before trying again.' },
          { status: 429 }
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