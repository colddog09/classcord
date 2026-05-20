// Vercel 빌드 시 환경 변수로 firebase-config.js 자동 생성
const fs = require('fs');

const config = {
  apiKey:            process.env.FIREBASE_API_KEY            || '',
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN        || '',
  databaseURL:       process.env.FIREBASE_DATABASE_URL       || '',
  projectId:         process.env.FIREBASE_PROJECT_ID         || '',
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET     || '',
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID|| '',
  appId:             process.env.FIREBASE_APP_ID             || '',
  measurementId:     process.env.FIREBASE_MEASUREMENT_ID     || '',
};

const content = `window.FIREBASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`;
fs.writeFileSync('firebase-config.js', content);
console.log('firebase-config.js 생성 완료');
