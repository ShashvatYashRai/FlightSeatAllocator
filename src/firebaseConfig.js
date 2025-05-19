// Import the functions you need from the SDKs
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore"; // ✅ Add this

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyC8Uu4-s-wAET5AKvQSw4fEFShFokkdJ34",
  authDomain: "flight-seat-allocator.firebaseapp.com",
  projectId: "flight-seat-allocator",
  storageBucket: "flight-seat-allocator.firebasestorage.app",
  messagingSenderId: "708235761526",
  appId: "1:708235761526:web:1ff3705c2cd452e527cc57",
  measurementId: "G-40DLZWGFQ1"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const db = getFirestore(app); // ✅ Add this

export { db }; // ✅ Export this so you can use it in your component
