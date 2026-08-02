/* global firebase */
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCsw-JRWgGXIaGaT6FaJgA6NOiBfQUE6Oo',
  appId: '1:609090307246:web:e8913be047531501bad93f',
  messagingSenderId: '609090307246',
  projectId: 'bulka-bonus',
  authDomain: 'bulka-bonus.firebaseapp.com',
  storageBucket: 'bulka-bonus.firebasestorage.app',
});

// Initializing Messaging is enough for notification payloads: the Firebase
// service worker displays them and honours webpush.fcmOptions.link.
firebase.messaging();
