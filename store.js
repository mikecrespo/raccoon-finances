/*
 * store.js — capa de datos de Raccoon Finances.
 *
 * Responsable de:
 *   - guardar el estado en este dispositivo (localStorage), siempre;
 *   - si Firebase está configurado: iniciar sesión, escuchar cambios en la nube
 *     y subir los cambios (Firestore encola solo lo que hagas sin conexión y lo
 *     sincroniza al reconectar);
 *   - avisar a la app del estado de la sincronización.
 *
 * La app (app.js) nunca habla con Firebase directamente: solo usa RaccoonStore.
 */
(function () {
  "use strict";

  var LOCAL_KEY = 'raccoonFinanzasLocal_v1';      // misma llave que usaba el artifact
  var DEVICE_KEY = 'raccoon_device_id';

  var cfg = window.RACCOON_FIREBASE_CONFIG || null;

  function cfgLooksReal(c) {
    if (!c) return false;
    var k = String(c.apiKey || '');
    var p = String(c.projectId || '');
    return k && p && k.indexOf('PON_AQUI') === -1 && p.indexOf('PON_AQUI') === -1;
  }

  var CLOUD = (typeof firebase !== 'undefined') && cfgLooksReal(cfg);

  var cb = {};                 // callbacks pasados a init()
  var db = null;
  var docRef = null;
  var unsub = null;
  var currentUser = null;
  var seedState = null;

  function readLocal() {
    try {
      var r = localStorage.getItem(LOCAL_KEY);
      return r ? JSON.parse(r) : null;
    } catch (e) { return null; }
  }
  function writeLocal(state) {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(state)); return true; }
    catch (e) { return false; }
  }
  function deviceId() {
    try {
      var v = localStorage.getItem(DEVICE_KEY);
      if (!v) { v = Math.random().toString(36).slice(2, 10); localStorage.setItem(DEVICE_KEY, v); }
      return v;
    } catch (e) { return 'unknown'; }
  }
  function status(code) { if (cb.onStatus) cb.onStatus(code); }

  var API = {

    mode: function () { return CLOUD ? 'cloud' : 'local'; },

    init: function (opts) {
      cb = opts || {};
      seedState = opts && opts.seed ? opts.seed : null;

      // 1) pintar de inmediato lo que haya en este dispositivo
      var local = readLocal();
      if (local && cb.onData) cb.onData(local, { source: 'local' });

      // 2) modo solo-local (Firebase aún sin configurar)
      if (!CLOUD) {
        if (!local && seedState && cb.onData) cb.onData(seedState, { source: 'seed' });
        status('local-only');
        return;
      }

      // 3) modo nube
      try { firebase.initializeApp(cfg); } catch (e) { /* ya inicializado */ }
      try {
        firebase.firestore().enablePersistence({ synchronizeTabs: true })['catch'](function () { /* ignora */ });
      } catch (e) { /* navegador sin soporte: seguimos sin caché de Firestore */ }
      db = firebase.firestore();

      window.addEventListener('online', function () { status('pending'); });
      window.addEventListener('offline', function () { status('offline'); });

      firebase.auth().onAuthStateChanged(function (user) {
        currentUser = user || null;

        if (!user) {
          if (unsub) { unsub(); unsub = null; }
          docRef = null;
          status('signed-out');
          if (cb.onAuthNeeded) cb.onAuthNeeded();
          return;
        }

        if (cb.onReady) cb.onReady(user);
        docRef = db.collection('users').doc(user.uid).collection('data').doc('state');

        if (unsub) unsub();
        unsub = docRef.onSnapshot({ includeMetadataChanges: true },
          function (snap) {
            if (!snap.exists) {
              // primera vez con esta cuenta: sube lo que tengamos (local o semilla)
              var base = readLocal() || seedState;
              if (base) {
                API.save(base);
                if (cb.onData) cb.onData(base, { source: 'seed' });
              }
              status(navigator.onLine ? 'synced' : 'offline');
              return;
            }
            var data = snap.data() && snap.data().state;
            if (data) {
              writeLocal(data);
              if (cb.onData) cb.onData(data, { source: snap.metadata.fromCache ? 'cache' : 'server' });
            }
            status(
              snap.metadata.hasPendingWrites ? 'pending'
                : snap.metadata.fromCache ? 'offline'
                : 'synced'
            );
          },
          function () { status('error'); }
        );
      });
    },

    // Guarda el estado: siempre local; y en la nube si hay sesión.
    save: function (state) {
      var okLocal = writeLocal(state);

      if (CLOUD && currentUser && docRef) {
        status('pending');
        docRef.set({
          state: state,
          ultimaActualizacion: state.ultimaActualizacion || new Date().toISOString(),
          _device: deviceId()
        }).then(function () {
          status(navigator.onLine ? 'synced' : 'offline');
        })['catch'](function () {
          // sin conexión Firestore lo deja en cola; esto es solo el aviso visual
          status('offline');
        });
        return;
      }

      if (CLOUD && !currentUser) { status('signed-out'); return; }
      status(okLocal ? 'local-only' : 'nosave');
    },

    signIn: function (email, pw) {
      return firebase.auth().signInWithEmailAndPassword(email, pw);
    },
    signUp: function (email, pw) {
      return firebase.auth().createUserWithEmailAndPassword(email, pw);
    },
    signOut: function () {
      return firebase.auth().signOut();
    },
    resetPassword: function (email) {
      return firebase.auth().sendPasswordResetEmail(email);
    }
  };

  window.RaccoonStore = API;
})();
