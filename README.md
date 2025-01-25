# AI Image Generator

A Next.js application that generates images using AI models through Hugging Face's API. Features include:

- User authentication with Firebase
- Image generation with multiple AI models
- Image history for authenticated users
- Responsive and modern UI

## Features

- Google Sign-in authentication
- Two AI models:
  - OpenJourney for general image generation
  - Stable Diffusion for anime-style images
- Image history with Firebase storage
- Real-time status updates
- Rate limiting handling

## Technologies Used

- Next.js 14
- Firebase Authentication
- Firebase Firestore
- Hugging Face API
- Tailwind CSS

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Set up environment variables in `.env.local`
4. Run the development server: `npm run dev`
5. Open [http://localhost:3000](http://localhost:3000)
