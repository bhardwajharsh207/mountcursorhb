import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyBCSfR7Mg_f1xb44MmVFPwRm5OdfcIOuFg",
  authDomain: "hello1-2dab2.firebaseapp.com",
  projectId: "hello1-2dab2",
  storageBucket: "hello1-2dab2.firebasestorage.app",
  messagingSenderId: "502802299292",
  appId: "1:502802299292:web:9294e471cde40395cc3059"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app); 