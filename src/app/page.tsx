'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useRouter } from 'next/navigation';
import { db } from '@/lib/firebase';
import { collection, addDoc, query, where, orderBy, getDocs } from 'firebase/firestore';
import Image from 'next/image';

type Model = 'openjourney' | 'waifu';

interface GeneratedImage {
  id: string;
  imageUrl: string;
  prompt: string;
  model: Model;
  createdAt: Date;
}

export default function HomePage() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [prompt, setPrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedModel, setSelectedModel] = useState<Model>('openjourney');
  const [userImages, setUserImages] = useState<GeneratedImage[]>([]);
  const [loadingTime, setLoadingTime] = useState<number | null>(null);

  const loadUserImages = useCallback(async () => {
    if (!user) return;
    
    try {
      const imagesRef = collection(db, 'images');
      const q = query(
        imagesRef,
        where('userId', '==', user.uid),
        orderBy('createdAt', 'desc')
      );
      
      const querySnapshot = await getDocs(q);
      const images = querySnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as GeneratedImage[];
      
      setUserImages(images);
    } catch (error) {
      console.error('Error loading images:', error);
    }
  }, [user]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (loadingTime !== null && loadingTime > 0) {
      timer = setInterval(() => {
        setLoadingTime(prev => prev !== null ? prev - 1 : null);
      }, 1000);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [loadingTime]);

  useEffect(() => {
    if (!user) {
      router.push('/login');
      return;
    }
    loadUserImages();
  }, [user, router, loadUserImages]);

  const generateImage = async () => {
    try {
      setLoading(true);
      setError('');
      setLoadingTime(null);
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt, model: selectedModel }),
      });
      const data = await response.json();
      
      if (data.error) {
        if (data.error.startsWith('Model is currently loading')) {
          const match = data.error.match(/MODEL_LOADING:(\d+)/);
          if (match) {
            setLoadingTime(parseInt(match[1]));
          }
        }
        setError(data.error.replace('MODEL_LOADING:', ''));
        return;
      }

      setImageUrl(data.output);

      // Save to Firestore
      if (user) {
        await addDoc(collection(db, 'images'), {
          userId: user.uid,
          imageUrl: data.output,
          prompt,
          model: selectedModel,
          createdAt: new Date(),
        });
        loadUserImages(); // Reload images
      }
    } catch (error) {
      console.error('Error:', error);
      setError('Failed to generate image. Please try again.');
    } finally {
      if (loadingTime === null) {
        setLoading(false);
      }
    }
  };

  return (
    <main className="min-h-screen bg-gradient-to-b from-white to-gray-100">
      <div className="w-full max-w-6xl mx-auto p-8">
        <div className="flex justify-between items-center mb-8">
          <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-600">
            AI Image Generator
          </h1>
          <button
            onClick={() => signOut()}
            className="px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
          >
            Sign Out
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Generator Section */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Model
              </label>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setSelectedModel('openjourney')}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    selectedModel === 'openjourney'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold">OpenJourney</div>
                  <div className="text-sm text-gray-500">Midjourney-style images</div>
                </button>
                <button
                  onClick={() => setSelectedModel('waifu')}
                  className={`p-4 rounded-xl border-2 transition-all ${
                    selectedModel === 'waifu'
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="font-semibold">Waifu Diffusion</div>
                  <div className="text-sm text-gray-500">Anime-style artwork</div>
                </button>
              </div>
            </div>

            <div className="space-y-4">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter your image prompt..."
                className="w-full p-4 border border-gray-200 rounded-xl text-gray-800 placeholder-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 transition-all"
              />
              
              <button
                onClick={generateImage}
                disabled={loading || !prompt}
                className="w-full p-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-xl disabled:opacity-50 hover:from-blue-600 hover:to-blue-700 transition-all font-medium"
              >
                {loading ? (
                  loadingTime !== null ? (
                    `Model warming up... ${loadingTime}s remaining`
                  ) : (
                    'Generating...'
                  )
                ) : (
                  'Generate Image'
                )}
              </button>

              {error && (
                <div className="text-red-500 bg-red-50 p-4 rounded-xl border border-red-100">
                  {error}
                </div>
              )}

              {imageUrl && (
                <div className="mt-8">
                  <Image 
                    src={imageUrl} 
                    alt="Generated" 
                    width={512}
                    height={512}
                    className="w-full rounded-xl shadow-lg"
                  />
                </div>
              )}
            </div>
          </div>

          {/* History Section */}
          <div className="bg-white rounded-2xl shadow-xl p-8">
            <h2 className="text-2xl font-bold mb-6">My Generated Images</h2>
            <div className="grid grid-cols-2 gap-4">
              {userImages.map((image) => (
                <div key={image.id} className="relative group">
                  <Image
                    src={image.imageUrl}
                    alt={image.prompt}
                    width={512}
                    height={512}
                    className="w-full h-48 object-cover rounded-lg shadow-md"
                  />
                  <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-50 transition-all rounded-lg flex items-center justify-center">
                    <p className="text-white text-sm p-2 opacity-0 group-hover:opacity-100 transition-all text-center">
                      {image.prompt}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
