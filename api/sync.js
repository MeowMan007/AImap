const admin = require('firebase-admin');

// Initialize Firebase Admin SDK once (prevent multiple initializations)
if (!admin.apps.length) {
  try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase Admin initialized successfully.");
    } else {
      console.warn("FIREBASE_SERVICE_ACCOUNT environment variable is not defined.");
    }
  } catch (error) {
    console.error("Firebase Admin initialization error:", error);
  }
}

module.exports = async (req, res) => {
  // CORS setup for local testing and requests from different origins
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method === 'GET') {
    return res.status(200).json({
      googleClientId: process.env.GOOGLE_CLIENT_ID || null
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { credential, completedCards } = req.body;

  if (!credential) {
    return res.status(400).json({ error: 'Missing credential token' });
  }

  try {
    const googleClient = process.env.GOOGLE_CLIENT_ID;
    if (!googleClient) {
      return res.status(500).json({ error: 'GOOGLE_CLIENT_ID environment variable is missing on server.' });
    }

    // 1. Verify Google ID token using Google Token Info API
    const tokenInfoUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
    const tokenResponse = await fetch(tokenInfoUrl);
    if (!tokenResponse.ok) {
      return res.status(401).json({ error: 'Invalid Google credential token' });
    }

    const tokenInfo = await tokenResponse.json();

    // 2. Validate that the token was generated for our client ID
    if (tokenInfo.aud !== googleClient) {
      return res.status(401).json({ error: 'Audience mismatch: verification failed' });
    }

    const userId = tokenInfo.sub; // Unique stable Google user ID
    
    // Check if Firebase Admin is initialized
    if (!admin.apps.length) {
      return res.status(500).json({ error: 'Firebase Admin SDK is not configured on backend.' });
    }

    const db = admin.firestore();
    const docRef = db.collection('users').doc(userId);

    // 3. Save or load action
    if (Array.isArray(completedCards)) {
      // Save Action
      await docRef.set({
        ai_roadmap_completed: completedCards,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return res.status(200).json({
        success: true,
        message: 'Progress successfully saved to cloud.',
        completedCards
      });
    } else {
      // Load Action
      const doc = await docRef.get();
      if (!doc.exists) {
        return res.status(200).json({
          success: true,
          message: 'New user profile registered on cloud.',
          completedCards: []
        });
      }

      const data = doc.data();
      const savedCards = data.ai_roadmap_completed || [];
      return res.status(200).json({
        success: true,
        message: 'Progress successfully loaded from cloud.',
        completedCards: savedCards
      });
    }

  } catch (error) {
    console.error("Sync API Handler error:", error);
    return res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
};
