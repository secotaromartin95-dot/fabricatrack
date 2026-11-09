// ============================================================
//  FabriTrack - app.js
//  Control de fabricación con Login Correo/Contraseña y Firestore en tiempo real
// ============================================================

/* ---- CONFIGURACIÓN DE FIREBASE ---- */
const firebaseConfig = {
  apiKey: "AIzaSyC_u7PG7v7ZLELu7r5XKnCwMOs8_JA2Kgw",
  authDomain: "fabricatrack.firebaseapp.com",
  projectId: "fabricatrack",
  storageBucket: "fabricatrack.firebasestorage.app",
  messagingSenderId: "570345456005",
  appId: "1:570345456005:web:d7c68840548983b6dc44ec"
};

// Inicializar Firebase, Auth y Firestore
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// Persistencia offline de Firestore
try {
  db.enablePersistence({ synchronizeTabs: true }).catch(err => {
    console.warn('Persistencia Firestore info:', err.code);
  });
} catch (e) {
  console.warn('Persistencia Firestore no disponible', e);
}

/* ============================================================
   ADMINISTRADORES AUTORIZADOS (ACCESO EXCLUSIVO)
   ============================================================ */
const ADMIN_EMAILS = [
  "secotaro.martin95@gmail.com",
  "jonathanadmin5@gmail.com"
];

/* ---- ESTADO GLOBAL ---- */
let state = {
  currentUser: null,
  isAdmin: false,
  equipos: [],
  plantillas: [],
  currentEquipoId: null,
  currentView: 'dashboard',
  syncInitialized: false
};

/* ---- INICIALIZACIÓN ---- */
document.addEventListener('DOMContentLoaded', () => {
  updateDates();
  initAuthListener();

  // Registrar Service Worker para PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.log('SW error', e));
  }
});

function updateDates() {
  const now = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  const dateStr = now.toLocaleDateString('es-AR', opts);
  const el = document.getElementById('dashboard-date');
  if (el) el.textContent = dateStr;
  const rEl = document.getElementById('reporte-date');
  if (rEl) rEl.textContent = dateStr;
}

function updateSyncBadge(status, text) {
  const badge = document.getElementById('sync-status');
  const textEl = document.getElementById('sync-text');
  if (!badge || !textEl) return;
  badge.className = 'sync-badge ' + status;
  textEl.textContent = text;
}

/* ============================================================
   AUTENTICACIÓN CON CORREO Y CONTRASEÑA
   ============================================================ */
function initAuthListener() {
  auth.onAuthStateChanged(user => {
    const loginScreen = document.getElementById('login-screen');
    const appEl = document.getElementById('app');

    if (!user) {
      // Sin sesión
      state.currentUser = null;
      state.isAdmin = false;
      if (loginScreen) loginScreen.style.display = 'flex';
      if (appEl) appEl.style.display = 'none';
      return;
    }

    const email = (user.email || '').toLowerCase().trim();
    const isAuthorized = ADMIN_EMAILS.includes(email);

    if (!isAuthorized) {
      // Usuario autenticado pero NO autorizado en la lista de administradores
      auth.signOut();
      showLoginError(`El correo "${email}" no tiene permisos de administrador.`);
      if (loginScreen) loginScreen.style.display = 'flex';
      if (appEl) appEl.style.display = 'none';
      return;
    }

    // Usuario Administrador Autorizado
    state.currentUser = user;
    state.isAdmin = true;

    // Actualizar perfil en el menú lateral
    const initialEl = document.getElementById('user-avatar-initial');
    const nameEl = document.getElementById('user-name');
    if (initialEl) {
      initialEl.textContent = email.charAt(0).toUpperCase();
    }
    if (nameEl) {
      nameEl.textContent = email.split('@')[0];
    }

    // Mostrar la app
    if (loginScreen) loginScreen.style.display = 'none';
    if (appEl) appEl.style.display = 'block';

    showToast(`Sesión iniciada: ${email} 👑`);

    if (!state.syncInitialized) {
      state.syncInitialized = true;
      initRealtimeSync();
    } else {
      refreshCurrentView();
    }
  });
}

async function handleEmailLogin(event) {
  event.preventDefault();

  const emailInput = document.getElementById('login-email');
  const passInput = document.getElementById('login-password');
  const submitBtn = document.getElementById('btn-submit-login');
  const errEl = document.getElementById('login-error-msg');

  const email = emailInput.value.trim().toLowerCase();
  const password = passInput.value;

  errEl.style.display = 'none';

  // 1. Validar si el correo está en la lista de administradores
  if (!ADMIN_EMAILS.includes(email)) {
    showLoginError('Acceso denegado: Este correo no está autorizado como administrador.');
    return;
  }

  // 2. Validar longitud mínima de contraseña
  if (password.length < 6) {
    showLoginError('La contraseña debe tener al menos 6 caracteres.');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = 'Verificando...';

  try {
    // Intentar iniciar sesión
    await auth.signInWithEmailAndPassword(email, password);
  } catch (error) {
    console.warn('Auth error code:', error.code, error.message);

    // Si el usuario aún no existe en Firebase Authentication (primera vez que ingresa),
    // lo registramos automáticamente con la contraseña que escribió.
    if (error.code === 'auth/user-not-found' || error.code === 'auth/invalid-credential') {
      try {
        await auth.createUserWithEmailAndPassword(email, password);
        showToast('¡Cuenta configurada y activada con éxito! ✓');
        return;
      } catch (createErr) {
        if (createErr.code === 'auth/email-already-in-use') {
          showLoginError('Contraseña incorrecta. Por favor verificala.');
        } else if (createErr.code === 'auth/operation-not-allowed') {
          showLoginError('Debés habilitar "Correo electrónico/contraseña" en Firebase Console.');
        } else {
          showLoginError(getAuthErrorMessage(createErr));
        }
      }
    } else {
      showLoginError(getAuthErrorMessage(error));
    }
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Iniciar sesión';
  }
}

function showLoginError(msg) {
  const errEl = document.getElementById('login-error-msg');
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.style.display = 'block';
}

function getAuthErrorMessage(error) {
  switch (error.code) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Contraseña incorrecta. Revisala e intentá nuevamente.';
    case 'auth/user-not-found':
      return 'No se encontró un usuario con este correo.';
    case 'auth/weak-password':
      return 'La contraseña es muy débil. Usá al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'El formato de correo no es válido.';
    case 'auth/operation-not-allowed':
      return 'Habilitá "Correo electrónico/contraseña" en Firebase Console (pestaña Autenticación).';
    case 'auth/too-many-requests':
      return 'Demasiados intentos fallidos. Esperá unos minutos e intentá de nuevo.';
    case 'auth/network-request-failed':
      return 'Error de conexión. Verificá tu acceso a internet.';
    default:
      return error.message || 'Error al iniciar sesión.';
  }
}

function togglePasswordVisibility() {
  const passInput = document.getElementById('login-password');
  if (!passInput) return;
  passInput.type = (passInput.type === 'password') ? 'text' : 'password';
}

async function logout() {
  try {
    await auth.signOut();
    showToast('Sesión cerrada correctamente');
  } catch (err) {
    console.error('Error al cerrar sesión:', err);
  }
}

/* ============================================================
   SINCRONIZACIÓN EN TIEMPO REAL CON FIRESTORE
   ============================================================ */
function initRealtimeSync() {
  updateSyncBadge('syncing', 'Conectando...');

  // 1. Escuchar PLANTILLAS
  db.collection('plantillas').onSnapshot(snapshot => {
    const plantillas = [];
    snapshot.forEach(doc => {
      plantillas.push({ id: doc.id, ...doc.data() });
    });
    state.plantillas = plantillas;
    if (state.currentView === 'plantillas') renderPlantillas();
  }, err => {
    console.error('Error al escuchar plantillas:', err);
  });

  // 2. Escuchar EQUIPOS en tiempo real
  db.collection('equipos').onSnapshot(async snapshot => {
    const equipos = [];
    snapshot.forEach(doc => {
      equipos.push({ id: doc.id, ...doc.data() });
    });

    if (equipos.length === 0 && !state.initialLoaded) {
      state.initialLoaded = true;
      const yaInicializado = localStorage.getItem('fabricatrack_seeded_v1');
      if (!yaInicializado) {
        localStorage.setItem('fabricatrack_seeded_v1', 'true');
        updateSyncBadge('syncing', 'Cargando datos iniciales...');
        await seedInitialDataToFirestore();
        return;
      }
    }

    state.initialLoaded = true;
    state.equipos = equipos;
    updateSyncBadge('online', 'En vivo');

    refreshCurrentView();
  }, err => {
    console.error('Error al conectar con Firestore:', err);
    updateSyncBadge('offline', 'Sin conexión');
    const saved = localStorage.getItem('fabricatrack_cache');
    if (saved) {
      try {
        state.equipos = JSON.parse(saved);
        refreshCurrentView();
      } catch (e) {}
    }
  });
}

function refreshCurrentView() {
  try {
    localStorage.setItem('fabricatrack_cache', JSON.stringify(state.equipos));
  } catch (e) {}

  if (state.currentView === 'dashboard') {
    renderDashboard();
  } else if (state.currentView === 'equipos') {
    renderEquiposList();
  } else if (state.currentView === 'equipo-detalle') {
    renderEquipoDetalle();
  } else if (state.currentView === 'kpi') {
    renderKPI();
  } else if (state.currentView === 'reporte') {
    updateReportePreview();
  }
}

/* ---- OPERACIONES FIRESTORE ---- */
async function saveEquipoToCloud(equipo) {
  try {
    updateSyncBadge('syncing', 'Guardando...');
    const dataToSave = { ...equipo };
    delete dataToSave.id;
    await db.collection('equipos').doc(equipo.id).set(dataToSave);
    updateSyncBadge('online', 'En vivo');
    return true;
  } catch (err) {
    console.error('Error al guardar equipo en Firestore:', err);
    updateSyncBadge('offline', 'Error al guardar');
    showToast('⚠️ Error al sincronizar con la nube');
    return false;
  }
}

async function deleteEquipoFromCloud(equipoId) {
  try {
    updateSyncBadge('syncing', 'Eliminando...');
    await db.collection('equipos').doc(equipoId).delete();
    updateSyncBadge('online', 'En vivo');
    return true;
  } catch (err) {
    console.error('Error al eliminar equipo:', err);
    showToast('⚠️ No se pudo eliminar');
    return false;
  }
}

async function savePlantillaToCloud(plantilla) {
  try {
    const data = { ...plantilla };
    delete data.id;
    await db.collection('plantillas').doc(plantilla.id).set(data);
    return true;
  } catch (err) {
    console.error('Error al guardar plantilla:', err);
    return false;
  }
}

async function deletePlantillaFromCloud(plantillaId) {
  try {
    await db.collection('plantillas').doc(plantillaId).delete();
    return true;
  } catch (err) {
    console.error('Error al eliminar plantilla:', err);
    return false;
  }
}

/* ============================================================
   DATOS INICIALES (BASADOS EN TUS PARTES DIARIOS)
   ============================================================ */
async function seedInitialDataToFirestore() {
  localStorage.setItem('fabricatrack_seeded_v1', 'true');
  const hoy = todayStr();
  const ayer = offsetDate(hoy, -1);
  const en5 = offsetDate(hoy, 5);
  const en12 = offsetDate(hoy, 12);

  const plantillasDemo = [
    {
      id: 'pl-tanque-cisterna',
      nombre: 'Tanque Cisterna Estándar',
      descripcion: 'Procesos típicos de calderería, arenado y pintura',
      procesos: [
        { nombre: 'Fabricación de laterales/cuerpo', duracion: 3 },
        { nombre: 'Fabricación de fondos', duracion: 1.5 },
        { nombre: 'Arenado de fondos y rompeolas', duracion: 1 },
        { nombre: 'Armado y colocación de fondos', duracion: 2 },
        { nombre: 'Parar rompeolas', duracion: 1 },
        { nombre: 'Soldadura general de estanqueidad', duracion: 2.5 },
        { nombre: 'Fabricación de bocas y accesorios', duracion: 1.5 },
        { nombre: 'Arenado completo de tanque', duracion: 1 },
        { nombre: 'Enmasillar y preparación', duracion: 1 },
        { nombre: 'Primera mano de pintura', duracion: 0.5 },
        { nombre: 'Segunda / última mano de pintura', duracion: 0.5 },
        { nombre: 'Colocación de válvula de seguridad y accesorios', duracion: 1 },
        { nombre: 'Control final y detalles', duracion: 0.5 }
      ]
    },
    {
      id: 'pl-semirremolque',
      nombre: 'Semirremolque Cisterna Completo',
      descripcion: 'Chasis + Tanque + Accesorios viales',
      procesos: [
        { nombre: 'Fabricación y armado de chasis', duracion: 4 },
        { nombre: 'Soldar y bajar zapatos', duracion: 1 },
        { nombre: 'Arenado y pintura de chasis (1ra y 2da mano)', duracion: 2 },
        { nombre: 'Fabricación de tanque', duracion: 4 },
        { nombre: 'Arenado y pintura de tanque', duracion: 2 },
        { nombre: 'Terminar de armar conjunto tanque-chasis', duracion: 2 },
        { nombre: 'Apretar guardabarros', duracion: 0.5 },
        { nombre: 'Apretar barra y accesorios', duracion: 0.5 },
        { nombre: 'Armar porta auxilio (arenar y colocar)', duracion: 1 },
        { nombre: 'Terminar paragolpe', duracion: 1 },
        { nombre: 'Armar y colocar caja de kit de combustible', duracion: 1 },
        { nombre: 'Encartelar', duracion: 0.5 },
        { nombre: 'Control final y prueba', duracion: 0.5 }
      ]
    }
  ];

  for (const pl of plantillasDemo) {
    await savePlantillaToCloud(pl);
  }

  const equiposDemo = [
    {
      id: 'eq-herrera-16500-1',
      cliente: 'HERRERA',
      descripcion: '16500 Lts Nº 1',
      operario: 'Herrera',
      estado: 'en_produccion',
      fechaInicio: offsetDate(hoy, -8),
      fechaEntrega: en12,
      notas: 'Porta auxilio OK listo para colocar. Chasis OK.',
      procesos: [
        { id: uid(), nombre: 'Fabricación de chasis', estado: 'terminado', duracion: 3, fechaInicio: offsetDate(hoy, -8), fechaFin: offsetDate(hoy, -5), responsable: 'Herrera', notas: '' },
        { id: uid(), nombre: 'Apretar guardabarros', estado: 'terminado', duracion: 0.5, fechaInicio: ayer, fechaFin: ayer, responsable: 'Herrera', notas: '' },
        { id: uid(), nombre: 'Apretar barra', estado: 'terminado', duracion: 0.5, fechaInicio: ayer, fechaFin: ayer, responsable: 'Herrera', notas: '' },
        { id: uid(), nombre: 'Encartelar', estado: 'terminado', duracion: 0.5, fechaInicio: ayer, fechaFin: ayer, responsable: 'Herrera', notas: '' },
        { id: uid(), nombre: 'Terminar de armar', estado: 'en_proceso', duracion: 1.5, fechaInicio: hoy, fechaFin: null, responsable: 'Herrera', notas: 'En proceso de ensamble final' },
        { id: uid(), nombre: 'Porta auxilio arenar y colocar', estado: 'terminado', duracion: 1, fechaInicio: ayer, fechaFin: hoy, responsable: 'Herrera', notas: 'Listo para colocar' },
        { id: uid(), nombre: 'Control y prueba final', estado: 'pendiente', duracion: 0.5, fechaInicio: null, fechaFin: null, responsable: 'Herrera', notas: '' }
      ],
      fotos: [],
      historial: [
        { fecha: ayer, texto: 'Apretado de guardabarros y encartelado completo', tipo: 'proceso' },
        { fecha: hoy, texto: 'Porta auxilio listo para colocar. En proceso de terminar armado.', tipo: 'proceso' }
      ]
    },
    {
      id: 'eq-ponce-5000-1',
      cliente: 'PONCE',
      descripcion: '5000 Lts Nº 1',
      operario: 'Ponce',
      estado: 'en_produccion',
      fechaInicio: offsetDate(hoy, -5),
      fechaEntrega: en5,
      notas: 'Colocar válvula de seguridad OK. Bajada de zapatos en proceso.',
      procesos: [
        { id: uid(), nombre: 'Terminar paragolpe', estado: 'terminado', duracion: 1, fechaInicio: ayer, fechaFin: hoy, responsable: 'Ponce', notas: 'Completado' },
        { id: uid(), nombre: 'Soldar zapatos', estado: 'terminado', duracion: 0.5, fechaInicio: ayer, fechaFin: ayer, responsable: 'Ponce', notas: '' },
        { id: uid(), nombre: 'Colocar válvula de seguridad', estado: 'terminado', duracion: 0.5, fechaInicio: ayer, fechaFin: hoy, responsable: 'Ponce', notas: 'Válvula OK' },
        { id: uid(), nombre: 'Bajada de zapatos', estado: 'con_atraso', duracion: 0.5, fechaInicio: ayer, fechaFin: null, responsable: 'Ponce', notas: 'Presenta atraso en la bajada' },
        { id: uid(), nombre: 'Empezar a colocar accesorios', estado: 'en_proceso', duracion: 1, fechaInicio: hoy, fechaFin: null, responsable: 'Ponce', notas: '' },
        { id: uid(), nombre: 'Armar y colocar caja de kit de combustible', estado: 'pendiente', duracion: 1, fechaInicio: null, fechaFin: null, responsable: 'Ponce', notas: '' },
        { id: uid(), nombre: 'Ultimar detalles', estado: 'pendiente', duracion: 0.5, fechaInicio: null, fechaFin: null, responsable: 'Ponce', notas: '' }
      ],
      fotos: [],
      historial: [
        { fecha: ayer, texto: 'Comenzó soldadura de zapatos y paragolpe', tipo: 'proceso' },
        { fecha: hoy, texto: 'Válvula de seguridad colocada OK. Bajada de zapatos con demora.', tipo: 'proceso' }
      ]
    },
    {
      id: 'eq-tello-10000-1',
      cliente: 'TELLO',
      descripcion: '10000 Lts Nº 1',
      operario: 'Tello',
      estado: 'en_produccion',
      fechaInicio: offsetDate(hoy, -6),
      fechaEntrega: offsetDate(hoy, 8),
      notas: 'Esperando fondos y rompeolas que se encuentran en arenado para comenzar a armar.',
      procesos: [
        { id: uid(), nombre: 'Fabricación de laterales para CEOSA', estado: 'terminado', duracion: 1.5, fechaInicio: ayer, fechaFin: hoy, responsable: 'Tello', notas: 'Laterales OK' },
        { id: uid(), nombre: 'Fabricando bocas y accesorios', estado: 'terminado', duracion: 1, fechaInicio: ayer, fechaFin: hoy, responsable: 'Tello', notas: 'Accesorios OK' },
        { id: uid(), nombre: 'Arenado de fondos y rompeolas', estado: 'en_proceso', duracion: 1, fechaInicio: hoy, fechaFin: null, responsable: 'Tello', notas: 'En sector arenado' },
        { id: uid(), nombre: 'Terminar de colocar fondos', estado: 'pendiente', duracion: 1, fechaInicio: null, fechaFin: null, responsable: 'Tello', notas: 'Esperando fondos de arenado' },
        { id: uid(), nombre: 'Parar rompeolas', estado: 'pendiente', duracion: 1, fechaInicio: null, fechaFin: null, responsable: 'Tello', notas: '' }
      ],
      fotos: [],
      historial: [
        { fecha: hoy, texto: 'Bocas y accesorios terminados. Fondos en arenado.', tipo: 'proceso' }
      ]
    },
    {
      id: 'eq-cubillos-manfield',
      cliente: 'CUBILLOS',
      descripcion: 'Manfield',
      operario: 'Cubillos',
      estado: 'en_produccion',
      fechaInicio: offsetDate(hoy, -4),
      fechaEntrega: offsetDate(hoy, 6),
      notas: 'Fabricación de cunas OK. Colocación de bases OK.',
      procesos: [
        { id: uid(), nombre: 'Fabricación de cunas c/poncho', estado: 'terminado', duracion: 1.5, fechaInicio: ayer, fechaFin: hoy, responsable: 'Cubillos', notas: 'Cunas OK' },
        { id: uid(), nombre: 'Colocación de bases', estado: 'terminado', duracion: 1, fechaInicio: ayer, fechaFin: hoy, responsable: 'Cubillos', notas: 'Bases OK' },
        { id: uid(), nombre: 'Soldadura de unión', estado: 'en_proceso', duracion: 1, fechaInicio: hoy, fechaFin: null, responsable: 'Cubillos', notas: '' },
        { id: uid(), nombre: 'Pintura y terminación', estado: 'pendiente', duracion: 1, fechaInicio: null, fechaFin: null, responsable: 'Cubillos', notas: '' }
      ],
      fotos: [],
      historial: [
        { fecha: hoy, texto: 'Fabricación de cunas y colocación de bases completadas.', tipo: 'proceso' }
      ]
    }
  ];

  for (const eq of equiposDemo) {
    await saveEquipoToCloud(eq);
  }
}

/* ============================================================
   UTILIDADES
   ============================================================ */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function fmtDate(str) {
  if (!str) return '-';
  const d = new Date(str + 'T12:00:00');
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function diffDays(a, b) {
  const da = new Date(a + 'T12:00:00');
  const db = new Date(b + 'T12:00:00');
  return Math.round((db - da) / 86400000);
}

// Días laborables de taller (Lunes a Sábado, domingos no se trabaja)
function diffDiasLaborables(desde, hasta) {
  if (!desde || !hasta) return 0;
  const da = new Date(desde + 'T12:00:00');
  const db = new Date(hasta + 'T12:00:00');
  const inverso = db < da;
  let cursor = new Date(inverso ? db : da);
  const fin = new Date(inverso ? da : db);

  let laborables = 0;
  while (cursor < fin) {
    cursor.setDate(cursor.getDate() + 1);
    if (cursor.getDay() !== 0) { // 0 = Domingo
      laborables++;
    }
  }
  return inverso ? -laborables : laborables;
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, duration = 2500) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

function calcProgreso(equipo) {
  if (!equipo.procesos || equipo.procesos.length === 0) return 0;
  const terminados = equipo.procesos.filter(p => p.estado === 'terminado').length;
  return Math.round((terminados / equipo.procesos.length) * 100);
}

function calcDetalleTiempos(equipo) {
  const hoy = todayStr();
  const procesos = equipo.procesos || [];
  const diasRestantesCalendario = equipo.fechaEntrega ? diffDays(hoy, equipo.fechaEntrega) : null;
  const diasRestantesLaborables = equipo.fechaEntrega ? diffDiasLaborables(hoy, equipo.fechaEntrega) : null;
  
  // Suma de duraciones estimadas de los procesos que faltan terminar
  const diasTrabajoPendientes = Math.round(procesos
    .filter(p => p.estado !== 'terminado')
    .reduce((sum, p) => sum + (parseFloat(p.duracion) || 0), 0) * 10) / 10;
  const diasTrabajoTotal = Math.round(procesos.reduce((sum, p) => sum + (parseFloat(p.duracion) || 0), 0) * 10) / 10;
  const diasTrabajoTerminado = Math.round(procesos
    .filter(p => p.estado === 'terminado')
    .reduce((sum, p) => sum + (parseFloat(p.duracion) || 0), 0) * 10) / 10;
  
  const procesosConAtraso = procesos.filter(p => p.estado === 'con_atraso').map(p => p.nombre);

  // 1. Diagnóstico Automático Calculado (sobre días laborables sin domingos)
  let estadoCalculado = 'ok';
  let motivo = 'Dentro de los plazos estimados';

  if (procesosConAtraso.length > 0) {
    estadoCalculado = 'atrasado';
    motivo = `Atraso en: ${procesosConAtraso.slice(0, 2).join(', ')}`;
  } else if (diasRestantesLaborables !== null) {
    if (diasRestantesLaborables < 0) {
      estadoCalculado = 'atrasado';
      motivo = `Superó la fecha límite (${Math.abs(diasRestantesLaborables)}d laborables de retraso)`;
    } else if (diasTrabajoPendientes > diasRestantesLaborables) {
      estadoCalculado = 'atrasado';
      motivo = `Atrasado: faltan ${diasTrabajoPendientes}d de trabajo y solo quedan ${diasRestantesLaborables}d laborables (${diasRestantesCalendario}d corridos, sin domingos)`;
    } else if (diasTrabajoPendientes >= diasRestantesLaborables * 0.8 || diasRestantesLaborables <= 2) {
      estadoCalculado = 'riesgo';
      motivo = `Con lo justo: restan ${diasTrabajoPendientes}d de trabajo vs ${diasRestantesLaborables}d laborables disponibles`;
    } else {
      estadoCalculado = 'ok';
      motivo = `Buen ritmo: ${diasTrabajoPendientes}d de trabajo en ${diasRestantesLaborables}d laborables disponibles`;
    }
  } else {
    // Si no tiene fecha de entrega
    if (diasTrabajoPendientes > 0) {
      motivo = `Restan ${diasTrabajoPendientes}d de procesos (sin fecha fijada)`;
    } else {
      motivo = 'Todos los procesos terminados';
    }
  }

  // 2. Control Manual vs Automático
  const ritmoConfigurado = equipo.ritmoTiempo || 'auto';
  const esManual = ritmoConfigurado !== 'auto';
  const estadoFinal = esManual ? ritmoConfigurado : estadoCalculado;

  return {
    diasRestantesCalendario,
    diasRestantesLaborables,
    diasTrabajoPendientes,
    diasTrabajoTotal,
    diasTrabajoTerminado,
    procesosConAtraso,
    estadoCalculado,
    ritmoConfigurado,
    esManual,
    estadoFinal,
    motivo
  };
}

function calcEstadoEquipo(equipo) {
  if (equipo.estado === 'terminado') return 'terminado';
  if (equipo.estado === 'pausado') return 'pausado';
  const detalle = calcDetalleTiempos(equipo);
  return detalle.estadoFinal;
}

async function setRitmoTiempo(nuevoRitmo) {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq) return;

  eq.ritmoTiempo = nuevoRitmo;
  const textoRitmo = {
    auto: 'Cálculo automático',
    ok: '🟢 A tiempo',
    riesgo: '🟡 En riesgo',
    atrasado: '🔴 Atrasado'
  }[nuevoRitmo] || nuevoRitmo;

  addHistorial(eq, `Ritmo de entrega fijado a: ${textoRitmo}`, 'info');
  renderEquipoDetalle();
  showToast(`Ritmo de tiempos: ${textoRitmo} ✓`);
  await saveEquipoToCloud(eq);
}

function getEstadoBadge(estado) {
  const map = {
    en_produccion: '<span class="estado-badge badge-produccion">En producción</span>',
    terminado: '<span class="estado-badge badge-terminado">Terminado</span>',
    pausado: '<span class="estado-badge badge-pausado">Pausado</span>',
  };
  return map[estado] || '';
}

function getProcesoIcon(estado) {
  const icons = {
    terminado: '✅',
    en_proceso: '🔄',
    pendiente: '⬜',
    con_atraso: '⚠️'
  };
  return icons[estado] || '⬜';
}

/* ============================================================
   NAVEGACIÓN
   ============================================================ */
function navigate(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));

  const el = document.getElementById('view-' + view);
  if (el) el.classList.add('active');

  const link = document.querySelector(`.sidebar-link[onclick*="'${view}'"]`);
  if (link) link.classList.add('active');

  state.currentView = view;

  if (view === 'dashboard') {
    document.getElementById('nav-title-text').textContent = 'FabriTrack';
    renderDashboard();
  } else if (view === 'equipos') {
    document.getElementById('nav-title-text').textContent = 'Equipos';
    renderEquiposList();
  } else if (view === 'equipo-detalle') {
    renderEquipoDetalle();
  } else if (view === 'kpi') {
    document.getElementById('nav-title-text').textContent = 'KPIs';
    renderKPI();
  } else if (view === 'reporte') {
    document.getElementById('nav-title-text').textContent = 'Reporte Diario';
    updateReportePreview();
  } else if (view === 'plantillas') {
    document.getElementById('nav-title-text').textContent = 'Plantillas';
    renderPlantillas();
  } else if (view === 'backup') {
    document.getElementById('nav-title-text').textContent = 'Copia de Seguridad';
    renderBackupView();
  }

  window.scrollTo(0, 0);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function openModal(id) {
  document.getElementById(id).classList.add('open');
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function renderDashboard() {
  const activos = state.equipos.filter(e => e.estado === 'en_produccion' && !e.eliminado);
  const estadosList = activos.map(e => calcEstadoEquipo(e));

  document.getElementById('stat-total').textContent = activos.length;
  document.getElementById('stat-ok').textContent = estadosList.filter(s => s === 'ok').length;
  document.getElementById('stat-riesgo').textContent = estadosList.filter(s => s === 'riesgo').length;
  document.getElementById('stat-atrasado').textContent = estadosList.filter(s => s === 'atrasado').length;

  const grid = document.getElementById('dashboard-equipos-grid');
  if (activos.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🏭</div>
        <p>No hay equipos en producción actualmente.</p>
        <button class="btn btn-primary" onclick="showNewEquipoModal()">+ Crear primer equipo</button>
      </div>`;
    return;
  }
  grid.innerHTML = activos.map(e => renderEquipoCard(e)).join('');
}

function renderEquipoCard(equipo) {
  const prog = calcProgreso(equipo);
  const estClass = calcEstadoEquipo(equipo);
  const procesos = equipo.procesos || [];
  const enProceso = procesos.filter(p => p.estado === 'en_proceso').map(p => p.nombre);
  const atrasados = procesos.filter(p => p.estado === 'con_atraso').map(p => p.nombre);

  const detalleTiempos = calcDetalleTiempos(equipo);
  let diasStr = '';
  if (detalleTiempos.diasRestantesLaborables !== null) {
    if (detalleTiempos.diasRestantesLaborables < 0) diasStr = `⚠️ ${Math.abs(detalleTiempos.diasRestantesLaborables)}d laborables de atraso`;
    else if (detalleTiempos.diasRestantesLaborables === 0) diasStr = '⚠️ Entrega hoy';
    else diasStr = `📅 ${detalleTiempos.diasRestantesLaborables}d laborables (${detalleTiempos.diasRestantesCalendario}d corridos)`;
  }

  let ritmoBadge = '';
  if (equipo.estado !== 'terminado' && equipo.estado !== 'pausado' && !equipo.eliminado) {
    const ritmoIcon = { ok: '🟢 A tiempo', riesgo: '🟡 En riesgo', atrasado: '🔴 Atrasado' }[detalleTiempos.estadoFinal] || '🟢 A tiempo';
    const tagModo = detalleTiempos.esManual ? ' · Manual' : '';
    ritmoBadge = `<span class="ritmo-status-indicator ${detalleTiempos.estadoFinal}" style="font-size:11px;padding:2px 6px;">${ritmoIcon}${tagModo}</span>`;
  }

  return `
  <div class="equipo-card estado-${estClass}" onclick="openEquipoDetalle('${equipo.id}')">
    <div class="equipo-card-header">
      <div>
        <div class="equipo-card-cliente">${esc(equipo.cliente)}</div>
        <div class="equipo-card-nombre">${esc(equipo.descripcion)}</div>
        ${equipo.operario ? `<div class="equipo-card-operario">👷 ${esc(equipo.operario)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;">
          ${getEstadoBadge(equipo.estado)}
          ${ritmoBadge}
        </div>
        ${equipo.eliminado ? `
          <button class="btn btn-sm btn-outline" style="padding:4px 8px;font-size:12px;background:var(--white);" onclick="event.stopPropagation(); restaurarEquipo('${equipo.id}')" title="Restaurar a la lista activa">🔄 Restaurar</button>
          <button class="btn-icon danger" style="padding:4px 8px;font-size:13px;border:1px solid var(--gray-200);border-radius:6px;background:var(--white);" onclick="event.stopPropagation(); eliminarEquipoDirecto('${equipo.id}', '${esc(equipo.cliente)}')" title="Borrar definitivamente">❌</button>
        ` : `
          <button class="btn-icon danger" style="padding:4px 8px;font-size:13px;border:1px solid var(--gray-200);border-radius:6px;background:var(--white);" onclick="event.stopPropagation(); eliminarEquipoDirecto('${equipo.id}', '${esc(equipo.cliente)}')" title="Enviar a la papelera">🗑️</button>
        `}
      </div>
    </div>
    <div class="equipo-card-progress">
      <div class="progress-header">
        <span>${procesos.filter(p => p.estado === 'terminado').length}/${procesos.length} procesos</span>
        <span>${prog}%</span>
      </div>
      <div class="progress-bar-wrap">
        <div class="progress-bar-fill" style="width:${prog}%"></div>
      </div>
    </div>
    ${atrasados.length > 0 ? `<div class="meta-item" style="color:var(--danger);font-weight:600">⚠️ Atraso: ${esc(atrasados.slice(0, 2).join(', '))}</div>` : ''}
    ${enProceso.length > 0 ? `<div class="meta-item" style="color:#e65100">🔄 ${esc(enProceso.slice(0, 2).join(', '))}${enProceso.length > 2 ? '...' : ''}</div>` : ''}
    ${detalleTiempos.motivo && equipo.estado !== 'terminado' && !equipo.eliminado ? `<div class="meta-item" style="font-size:11px;color:var(--gray-600)">⏱️ ${esc(detalleTiempos.motivo)}</div>` : ''}
    <div class="equipo-card-meta">
      ${diasStr ? `<div class="meta-item">${diasStr}</div>` : ''}
      ${equipo.fechaInicio ? `<div class="meta-item">🗓️ Inicio: ${fmtDate(equipo.fechaInicio)}</div>` : ''}
      ${(equipo.fotos && equipo.fotos.length > 0) ? `<div class="meta-item">📷 ${equipo.fotos.length} fotos</div>` : ''}
    </div>
  </div>`;
}

/* ============================================================
   EQUIPOS (LISTA GENERAL)
   ============================================================ */
function renderEquiposList() {
  filterEquipos();
}

function filterEquipos() {
  const q = (document.getElementById('equipo-search')?.value || '').toLowerCase();
  const est = document.getElementById('equipo-filter-estado')?.value || '';

  let lista = state.equipos.filter(e => {
    if (est === 'eliminado') {
      return e.eliminado === true && (!q || e.cliente.toLowerCase().includes(q) || e.descripcion.toLowerCase().includes(q));
    }
    if (e.eliminado) return false;

    const matchQ = !q || e.cliente.toLowerCase().includes(q) || e.descripcion.toLowerCase().includes(q) || (e.operario || '').toLowerCase().includes(q);
    const matchEst = !est || e.estado === est;
    return matchQ && matchEst;
  });

  const container = document.getElementById('equipos-list');
  if (lista.length === 0) {
    const msgVacio = est === 'eliminado' ? 'La papelera de reciclaje está vacía.' : 'No se encontraron equipos con ese filtro.';
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>${msgVacio}</p></div>`;
    return;
  }
  container.innerHTML = lista.map(e => renderEquipoCard(e)).join('');
}

/* ============================================================
   DETALLE DE EQUIPO
   ============================================================ */
function openEquipoDetalle(id) {
  state.currentEquipoId = id;
  navigate('equipo-detalle');
}

function renderEquipoDetalle() {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq) { navigate('equipos'); return; }

  document.getElementById('nav-title-text').textContent = eq.cliente;

  document.getElementById('detalle-titulo').innerHTML = `
    <h2>${esc(eq.cliente)}</h2>
    <p>${esc(eq.descripcion)}</p>
  `;

  const detalleTiempos = calcDetalleTiempos(eq);
  let diasClass = '';
  let diasTexto = '-';
  if (detalleTiempos.diasRestantesLaborables !== null) {
    if (detalleTiempos.diasRestantesLaborables < 0) {
      diasClass = 'danger';
      diasTexto = `${Math.abs(detalleTiempos.diasRestantesLaborables)} días laborables ATRASADO`;
    } else if (detalleTiempos.diasRestantesLaborables === 0) {
      diasClass = 'warning';
      diasTexto = 'Entrega HOY';
    } else if (detalleTiempos.diasRestantesLaborables <= 2) {
      diasClass = 'warning';
      diasTexto = `${detalleTiempos.diasRestantesLaborables} días laborables restantes`;
    } else {
      diasTexto = `${detalleTiempos.diasRestantesLaborables} días laborables restantes`;
    }
  }

  const ritmoIconos = {
    ok: '🟢 A tiempo',
    riesgo: '🟡 En riesgo',
    atrasado: '🔴 Con atraso'
  };
  const ritmoTextoActual = ritmoIconos[detalleTiempos.estadoFinal] || '🟢 A tiempo';

  document.getElementById('detalle-info-card').innerHTML = `
    <div class="info-item">
      <span class="info-label">Cliente</span>
      <span class="info-value destacado">${esc(eq.cliente)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Equipo</span>
      <span class="info-value">${esc(eq.descripcion)}</span>
    </div>
    ${eq.operario ? `<div class="info-item"><span class="info-label">Operario</span><span class="info-value">${esc(eq.operario)}</span></div>` : ''}
    <div class="info-item">
      <span class="info-label">Estado</span>
      <span class="info-value">${getEstadoBadge(eq.estado)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Fecha de inicio</span>
      <span class="info-value">${fmtDate(eq.fechaInicio)}</span>
    </div>
    <div class="info-item">
      <span class="info-label">Entrega estimada</span>
      <span class="info-value">${fmtDate(eq.fechaEntrega)}</span>
    </div>
    ${detalleTiempos.diasRestantesLaborables !== null ? `<div class="info-item"><span class="info-label">Plazo de entrega</span><span class="info-value ${diasClass}">${diasTexto} (${detalleTiempos.diasRestantesCalendario}d corridos, sin domingos)</span></div>` : ''}
    ${eq.notas ? `<div class="info-item" style="flex-basis:100%"><span class="info-label">Observaciones</span><span class="info-value">${esc(eq.notas)}</span></div>` : ''}
    <div class="info-item ritmo-box" style="flex-basis:100%;margin-top:8px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
        <span class="info-label" style="font-weight:700;color:var(--gray-700)">⏱️ CUMPLIMIENTO Y RITMO DE TIEMPOS</span>
        <span class="ritmo-mode-badge ${detalleTiempos.esManual ? 'manual' : 'auto'}">
          ${detalleTiempos.esManual ? 'AJUSTE MANUAL' : 'CÁLCULO AUTOMÁTICO'}
        </span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;flex-wrap:wrap;">
        <span class="ritmo-status-indicator ${detalleTiempos.estadoFinal}">${ritmoTextoActual}</span>
        <span class="ritmo-motivo-text">${esc(detalleTiempos.motivo)}</span>
      </div>
      <div style="font-size:11px;color:var(--gray-600);margin-bottom:8px;">
        ${detalleTiempos.diasRestantesLaborables !== null ? `📅 Plazo: <b>${detalleTiempos.diasRestantesLaborables}d laborables</b> (${detalleTiempos.diasRestantesCalendario}d corridos, sin domingos) | ⏱️ Trabajo pendiente: <b>${detalleTiempos.diasTrabajoPendientes}d</b> en procesos` : `⏱️ Trabajo pendiente: <b>${detalleTiempos.diasTrabajoPendientes}d</b> en procesos (sin fecha fijada)`}
      </div>
      <div class="ritmo-selector">
        <span style="font-size:11px;font-weight:700;color:var(--gray-600);align-self:center;">Cambiar ritmo:</span>
        <button type="button" class="ritmo-pill ${detalleTiempos.ritmoConfigurado === 'auto' ? 'active-auto' : ''}" onclick="setRitmoTiempo('auto')" title="Calcula según días calendario y duración estimada de procesos pendientes">
          🤖 Automático
        </button>
        <button type="button" class="ritmo-pill ${detalleTiempos.ritmoConfigurado === 'ok' ? 'active-ok' : ''}" onclick="setRitmoTiempo('ok')" title="Forzar estado: Vamos bien con los tiempos">
          🟢 A tiempo
        </button>
        <button type="button" class="ritmo-pill ${detalleTiempos.ritmoConfigurado === 'riesgo' ? 'active-riesgo' : ''}" onclick="setRitmoTiempo('riesgo')" title="Forzar estado: Con lo justo / en riesgo">
          🟡 En riesgo
        </button>
        <button type="button" class="ritmo-pill ${detalleTiempos.ritmoConfigurado === 'atrasado' ? 'active-atrasado' : ''}" onclick="setRitmoTiempo('atrasado')" title="Forzar estado: Presenta atraso">
          🔴 Atrasado
        </button>
      </div>
    </div>
  `;

  const prog = calcProgreso(eq);
  document.getElementById('detalle-progreso-pct').textContent = prog + '%';
  document.getElementById('detalle-progreso-bar').style.width = prog + '%';

  // Botón y Banner de Finalización de Fabricación
  const btnFinalizar = document.getElementById('btn-finalizar-equipo');
  const bannerCompleto = document.getElementById('banner-equipo-completo');

  if (eq.estado === 'terminado') {
    if (btnFinalizar) {
      btnFinalizar.textContent = '🔄 Reabrir a Producción';
      btnFinalizar.className = 'btn btn-sm btn-outline';
    }
    if (bannerCompleto) bannerCompleto.style.display = 'none';
  } else {
    if (btnFinalizar) {
      btnFinalizar.textContent = '🏁 Finalizar Equipo';
      btnFinalizar.className = 'btn btn-sm btn-success';
    }
    if (bannerCompleto) {
      if (prog === 100) {
        bannerCompleto.style.display = 'flex';
        bannerCompleto.innerHTML = `
          <div class="banner-equipo-completo-texto">
            🎉 ¡Todos los subprocesos están terminados al 100%!
          </div>
          <button class="btn btn-sm btn-success" onclick="toggleFinalizarEquipo()">
            ✅ Pasar a Lista de Terminados
          </button>
        `;
      } else {
        bannerCompleto.style.display = 'none';
      }
    }
  }

  renderProcesos(eq);
  renderFotos(eq);
  renderHistorial(eq);
  renderKPIDetalle(eq);
}

async function toggleFinalizarEquipo() {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq) return;

  if (eq.estado !== 'terminado') {
    const confirmacion = confirm(`¿Finalizar la fabricación de "${eq.cliente} - ${eq.descripcion}"?\n\nEl equipo saldrá del Dashboard activo y pasará a la lista de "Terminados".`);
    if (!confirmacion) return;

    eq.estado = 'terminado';
    eq.fechaFinReal = todayStr();
    addHistorial(eq, `Fabricación finalizada con éxito. Pasado a lista de Terminados.`, 'creacion');
    showToast('¡Equipo finalizado! ✓ Pasó a la lista de Terminados');
  } else {
    const confirmacion = confirm(`¿Deseas reactivar este equipo y volverlo a poner "En producción"?`);
    if (!confirmacion) return;

    eq.estado = 'en_produccion';
    addHistorial(eq, `Equipo reactivado y devuelto a producción.`, 'creacion');
    showToast('Equipo devuelto a En producción ✓');
  }

  renderEquipoDetalle();
  await saveEquipoToCloud(eq);
}

async function eliminarEquipoActual() {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq) return;

  if (eq.eliminado) {
    const confDef = confirm(`¿ELIMINAR DEFINITIVAMENTE el equipo "${eq.cliente} - ${eq.descripcion}"?\n\nEsta acción borrará el equipo y sus procesos de forma permanente e irreversible.`);
    if (!confDef) return;
    showToast('Eliminando definitivamente...');
    const exito = await deleteEquipoFromCloud(eq.id);
    if (exito) {
      state.currentEquipoId = null;
      navigate('equipos');
      showToast('Equipo eliminado permanentemente ✓');
    }
    return;
  }

  const confirmacion = confirm(`¿Enviar el equipo "${eq.cliente} - ${eq.descripcion}" a la papelera de reciclaje?\n\nPodrás restaurarlo en cualquier momento desde el filtro "Papelera".`);
  if (!confirmacion) return;

  eq.eliminado = true;
  eq.fechaEliminacion = todayStr();
  addHistorial(eq, 'Equipo enviado a papelera de reciclaje', 'info');
  showToast('Equipo enviado a la papelera 🗑️');
  await saveEquipoToCloud(eq);
  state.currentEquipoId = null;
  navigate('equipos');
}

async function eliminarEquipoDesdeModal() {
  closeModal('modal-nuevo-equipo');
  await eliminarEquipoActual();
}

async function eliminarEquipoDirecto(id, cliente) {
  const eq = state.equipos.find(e => e.id === id);
  if (!eq) return;

  if (eq.eliminado) {
    const confDef = confirm(`¿ELIMINAR DEFINITIVAMENTE el equipo "${cliente}"?\n\nEsta acción borrará el equipo de la base de datos de forma irreversible.`);
    if (!confDef) return;
    showToast('Borrando definitivamente...');
    const exito = await deleteEquipoFromCloud(id);
    if (exito) {
      if (state.currentEquipoId === id) state.currentEquipoId = null;
      showToast(`Equipo "${cliente}" eliminado definitivamente ✓`);
    }
    return;
  }

  const confirmacion = confirm(`¿Enviar el equipo "${cliente}" a la papelera de reciclaje?\n\nPodrás restaurarlo en cualquier momento desde el filtro "Papelera".`);
  if (!confirmacion) return;

  eq.eliminado = true;
  eq.fechaEliminacion = todayStr();
  addHistorial(eq, 'Equipo enviado a papelera de reciclaje', 'info');
  showToast('Equipo enviado a la papelera 🗑️');
  await saveEquipoToCloud(eq);
}

async function restaurarEquipo(id) {
  const eq = state.equipos.find(e => e.id === id);
  if (!eq) return;

  eq.eliminado = false;
  delete eq.fechaEliminacion;
  addHistorial(eq, 'Equipo restaurado de la papelera a lista activa', 'info');
  showToast(`Equipo "${eq.cliente}" restaurado ✓`);
  await saveEquipoToCloud(eq);
  renderEquiposList();
}

function switchTab(tabName, btn) {
  document.querySelectorAll('#view-equipo-detalle .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('#view-equipo-detalle .tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + tabName)?.classList.add('active');
  if (btn) btn.classList.add('active');
}

/* ============================================================
   PROCESOS
   ============================================================ */
function renderProcesos(eq) {
  const container = document.getElementById('procesos-list');
  const procesos = eq.procesos || [];

  if (procesos.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Este equipo no tiene procesos asignados todavía.</p>
        <button class="btn btn-outline btn-sm" onclick="showAddProcesoModal()">+ Agregar el primero</button>
      </div>`;
    return;
  }

  container.innerHTML = procesos.map((proc, idx) => `
    <div class="proceso-item ${proc.estado}" id="proc-${proc.id}">
      <span class="proceso-estado-icon" onclick="cycleProcesoEstado('${proc.id}')" title="Hacé clic para cambiar estado">
        ${getProcesoIcon(proc.estado)}
      </span>
      <div class="proceso-info">
        <div class="proceso-nombre ${proc.estado === 'terminado' ? 'tachado' : ''}">${esc(proc.nombre)}</div>
        <div class="proceso-meta">
          ${proc.duracion ? `⏱ ${proc.duracion}d est.` : ''}
          ${proc.responsable ? ` · 👷 ${esc(proc.responsable)}` : ''}
          ${proc.fechaInicio ? ` · 📅 Ini: ${fmtDate(proc.fechaInicio)}` : ''}
          ${proc.estado === 'terminado' && proc.fechaFin ? ` → Fin: ${fmtDate(proc.fechaFin)}` : ''}
          ${proc.notas ? ` · 💬 ${esc(proc.notas)}` : ''}
        </div>
      </div>
      <div class="proceso-actions">
        <div class="proceso-order-btns">
          ${idx > 0 ? `<button class="btn-icon" onclick="moveProceso('${proc.id}', -1)" title="Subir">↑</button>` : '<span style="width:28px"></span>'}
          ${idx < procesos.length - 1 ? `<button class="btn-icon" onclick="moveProceso('${proc.id}', 1)" title="Bajar">↓</button>` : '<span style="width:28px"></span>'}
        </div>
        <button class="btn-icon" onclick="showEditProcesoModal('${proc.id}')" title="Editar">✏️</button>
        <button class="btn-icon danger" onclick="deleteProceso('${proc.id}')" title="Eliminar">🗑</button>
      </div>
    </div>
  `).join('');
}

async function cycleProcesoEstado(procId) {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  const proc = (eq?.procesos || []).find(p => p.id === procId);
  if (!proc) return;

  const cycle = ['pendiente', 'en_proceso', 'terminado', 'con_atraso'];
  const next = cycle[(cycle.indexOf(proc.estado) + 1) % cycle.length];
  const prev = proc.estado;
  proc.estado = next;

  const hoy = todayStr();
  if (next === 'en_proceso' && !proc.fechaInicio) proc.fechaInicio = hoy;
  if (next === 'terminado') {
    proc.fechaFin = hoy;
    if (!proc.fechaInicio) proc.fechaInicio = hoy;
  }
  if (next === 'pendiente') {
    proc.fechaInicio = null;
    proc.fechaFin = null;
  }

  addHistorial(eq, `Proceso "${proc.nombre}" cambió de ${prev} a ${next}`, 'proceso');

  renderEquipoDetalle();
  showToast(`Estado: ${next.replace('_', ' ')} ✓`);
  await saveEquipoToCloud(eq);
}

async function moveProceso(procId, dir) {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq || !eq.procesos) return;
  const idx = eq.procesos.findIndex(p => p.id === procId);
  if (idx < 0) return;
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= eq.procesos.length) return;

  [eq.procesos[idx], eq.procesos[newIdx]] = [eq.procesos[newIdx], eq.procesos[idx]];
  renderProcesos(eq);
  await saveEquipoToCloud(eq);
}

async function deleteProceso(procId) {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq) return;
  const proc = eq.procesos.find(p => p.id === procId);
  if (!proc) return;
  if (!confirm(`¿Eliminar el proceso "${proc.nombre}"?`)) return;

  eq.procesos = eq.procesos.filter(p => p.id !== procId);
  addHistorial(eq, `Proceso "${proc.nombre}" eliminado`, 'proceso');
  renderEquipoDetalle();
  showToast('Proceso eliminado');
  await saveEquipoToCloud(eq);
}

/* ---- MODAL AGREGAR PROCESO ---- */
function showAddProcesoModal() {
  document.getElementById('proc-nombre').value = '';
  document.getElementById('proc-duracion').value = '';
  document.getElementById('proc-responsable').value = '';
  document.getElementById('proc-notas').value = '';
  openModal('modal-add-proceso');
}

async function saveProceso() {
  const nombre = document.getElementById('proc-nombre').value.trim();
  if (!nombre) { showToast('Ingresá el nombre del proceso'); return; }

  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq) return;
  if (!eq.procesos) eq.procesos = [];

  const proc = {
    id: uid(),
    nombre,
    estado: 'pendiente',
    duracion: parseFloat(document.getElementById('proc-duracion').value) || 0,
    responsable: document.getElementById('proc-responsable').value.trim(),
    notas: document.getElementById('proc-notas').value.trim(),
    fechaInicio: null,
    fechaFin: null,
  };

  eq.procesos.push(proc);
  addHistorial(eq, `Proceso "${nombre}" agregado`, 'proceso');
  closeModal('modal-add-proceso');
  renderEquipoDetalle();
  showToast('Proceso agregado ✓');
  await saveEquipoToCloud(eq);
}

/* ---- MODAL EDITAR PROCESO ---- */
function showEditProcesoModal(procId) {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  const proc = (eq?.procesos || []).find(p => p.id === procId);
  if (!proc) return;

  document.getElementById('edit-proc-id').value = procId;
  document.getElementById('edit-proc-nombre').value = proc.nombre;
  document.getElementById('edit-proc-estado').value = proc.estado;
  document.getElementById('edit-proc-duracion').value = proc.duracion || '';
  document.getElementById('edit-proc-responsable').value = proc.responsable || '';
  document.getElementById('edit-proc-notas').value = proc.notas || '';
  document.getElementById('edit-proc-inicio').value = proc.fechaInicio || '';
  document.getElementById('edit-proc-fin').value = proc.fechaFin || '';
  toggleEditProcesoFechas();
  openModal('modal-edit-proceso');
}

function toggleEditProcesoFechas() {
  const estado = document.getElementById('edit-proc-estado').value;
  const fechasDiv = document.getElementById('edit-proc-fechas');
  const finGroup = document.getElementById('edit-proc-fin-group');
  fechasDiv.style.display = (estado !== 'pendiente') ? 'block' : 'none';
  finGroup.style.display = (estado === 'terminado') ? 'block' : 'none';
}

async function saveEditProceso() {
  const procId = document.getElementById('edit-proc-id').value;
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  const proc = (eq?.procesos || []).find(p => p.id === procId);
  if (!proc) return;

  proc.nombre = document.getElementById('edit-proc-nombre').value.trim() || proc.nombre;
  proc.estado = document.getElementById('edit-proc-estado').value;
  proc.duracion = parseFloat(document.getElementById('edit-proc-duracion').value) || 0;
  proc.responsable = document.getElementById('edit-proc-responsable').value.trim();
  proc.notas = document.getElementById('edit-proc-notas').value.trim();
  proc.fechaInicio = document.getElementById('edit-proc-inicio').value || null;
  proc.fechaFin = document.getElementById('edit-proc-fin').value || null;

  if (proc.estado === 'terminado' && !proc.fechaFin) proc.fechaFin = todayStr();
  if (proc.estado === 'en_proceso' && !proc.fechaInicio) proc.fechaInicio = todayStr();

  addHistorial(eq, `Proceso "${proc.nombre}" editado (${proc.estado})`, 'proceso');
  closeModal('modal-edit-proceso');
  renderEquipoDetalle();
  showToast('Proceso guardado ✓');
  await saveEquipoToCloud(eq);
}

/* ============================================================
   FOTOS DE PROGRESO
   ============================================================ */
function renderFotos(eq) {
  const grid = document.getElementById('fotos-grid');
  const fotos = eq.fotos || [];

  if (fotos.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><p>No hay fotos subidas para este equipo todavía.</p></div>`;
    return;
  }

  grid.innerHTML = fotos.map(f => `
    <div class="foto-thumb" onclick="openFotoModal('${f.id}')">
      <img src="${f.dataUrl}" alt="${esc(f.caption || 'Foto de avance')}">
      <div class="foto-thumb-date">${fmtDate(f.fecha)}</div>
      <button class="foto-del-btn" onclick="event.stopPropagation(); deleteFoto('${f.id}')" title="Eliminar foto">✕</button>
    </div>
  `).join('');
}

function compressImage(file, maxWidth = 900, quality = 0.72) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleFotoUpload(event) {
  const files = Array.from(event.target.files);
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq || files.length === 0) return;

  if (!eq.fotos) eq.fotos = [];

  showToast('Procesando y subiendo fotos...');

  for (const file of files) {
    try {
      const compressedDataUrl = await compressImage(file);
      eq.fotos.unshift({
        id: uid(),
        dataUrl: compressedDataUrl,
        fecha: todayStr(),
        caption: file.name.replace(/\.[^/.]+$/, "")
      });
    } catch (e) {
      console.error('Error al comprimir foto:', e);
    }
  }

  addHistorial(eq, `${files.length} foto(s) de progreso agregada(s)`, 'foto');
  renderFotos(eq);
  showToast(`${files.length} foto(s) guardada(s) y sincronizada(s) ✓`);
  await saveEquipoToCloud(eq);

  event.target.value = '';
}

async function deleteFoto(fotoId) {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq || !eq.fotos) return;
  if (!confirm('¿Eliminar esta foto?')) return;

  eq.fotos = eq.fotos.filter(f => f.id !== fotoId);
  renderFotos(eq);
  showToast('Foto eliminada');
  await saveEquipoToCloud(eq);
}

function openFotoModal(fotoId) {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  const foto = (eq?.fotos || []).find(f => f.id === fotoId);
  if (!foto) return;
  document.getElementById('modal-foto-img').src = foto.dataUrl;
  document.getElementById('modal-foto-caption').textContent = `${foto.caption || ''} — ${fmtDate(foto.fecha)}`;
  openModal('modal-foto');
}

/* ============================================================
   HISTORIAL
   ============================================================ */
function addHistorial(eq, texto, tipo = 'info') {
  if (!eq.historial) eq.historial = [];
  const now = new Date();
  const horaStr = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  const usuario = state.currentUser ? (state.currentUser.email || '').split('@')[0] : 'admin';
  eq.historial.unshift({
    timestamp: now.toISOString(),
    fecha: todayStr(),
    hora: horaStr,
    usuario: usuario,
    texto,
    tipo
  });
  if (eq.historial.length > 300) eq.historial.pop();
}

function renderHistorial(eq) {
  const container = document.getElementById('historial-list');
  const hist = eq.historial || [];
  if (hist.length === 0) {
    container.innerHTML = '<p style="color:#888;text-align:center;padding:20px">Sin actividad registrada aún.</p>';
    return;
  }
  const iconos = { creacion: '🔵', proceso: '⚙️', foto: '📷', info: '📌', reporte: '📋' };
  container.innerHTML = hist.map(h => `
    <div class="historial-item">
      <div class="historial-icon">${iconos[h.tipo] || '📌'}</div>
      <div class="historial-content">
        <div class="historial-texto">${esc(h.texto)}</div>
        <div class="historial-fecha">🗓️ ${fmtDate(h.fecha)}${h.hora ? ` a las ${h.hora}` : ''}${h.usuario ? ` · 👤 ${esc(h.usuario)}` : ''}</div>
      </div>
    </div>
  `).join('');
}

/* ============================================================
   KPIs DE FABRICACIÓN
   ============================================================ */
function renderKPIDetalle(eq) {
  const container = document.getElementById('kpi-detalle-content');
  container.innerHTML = buildKPIHTML(eq);
}

function buildKPIHTML(eq) {
  const hoy = todayStr();
  const procesos = eq.procesos || [];
  const totalProc = procesos.length;
  const diasDiff = eq.fechaInicio ? diffDays(eq.fechaInicio, hoy) : null;
  const diasFabricacion = diasDiff !== null ? Math.max(1, diasDiff + 1) : '-';
  const prog = calcProgreso(eq);
  const terminados = procesos.filter(p => p.estado === 'terminado').length;
  const enProceso = procesos.filter(p => p.estado === 'en_proceso').length;
  const pendientes = procesos.filter(p => p.estado === 'pendiente').length;
  const conAtraso = procesos.filter(p => p.estado === 'con_atraso').length;
  const durTotal = Math.round(procesos.reduce((s, p) => s + (parseFloat(p.duracion) || 0), 0) * 10) / 10;
  const durTerminada = Math.round(procesos.filter(p => p.estado === 'terminado').reduce((s, p) => s + (parseFloat(p.duracion) || 0), 0) * 10) / 10;

  const detalleTiempos = calcDetalleTiempos(eq);
  const ritmoClass = detalleTiempos.estadoFinal;
  const ritmoTextos = {
    ok: '🟢 A tiempo',
    riesgo: '🟡 En riesgo',
    atrasado: '🔴 Con atraso'
  };
  const ritmoBadge = ritmoTextos[ritmoClass] || '🟢 A tiempo';

  // Brecha de días (Plazo laborable disponible - Trabajo pendiente)
  const diasLabDisponibles = detalleTiempos.diasRestantesLaborables ?? 0;
  const brechaDias = Math.round((diasLabDisponibles - detalleTiempos.diasTrabajoPendientes) * 10) / 10;
  let brechaTexto = '-';
  let brechaClass = '';
  if (detalleTiempos.diasRestantesLaborables !== null) {
    if (brechaDias < 0) {
      brechaTexto = `${brechaDias}d`;
      brechaClass = 'danger';
    } else {
      brechaTexto = `+${brechaDias}d`;
      brechaClass = 'ok';
    }
  }

  // Gráfico 1: Balance de Barras (proporciones)
  const maxDias = Math.max(detalleTiempos.diasTrabajoPendientes, Math.max(0, diasLabDisponibles), 1);
  const pctTrabajo = Math.min(100, Math.max(10, Math.round((detalleTiempos.diasTrabajoPendientes / maxDias) * 100)));
  const pctPlazo = Math.min(100, Math.max(10, Math.round((Math.max(0, diasLabDisponibles) / maxDias) * 100)));

  // Gráfico 2: Donut Chart SVG (Circunferencia C = 2 * PI * 38 ≈ 238.76)
  const C = 238.76;
  const circuloBase = `<circle cx="50" cy="50" r="38" stroke="#f1f5f9" stroke-width="12" fill="transparent"></circle>`;
  let circulosSVG = circuloBase;

  if (totalProc > 0) {
    let offsetAcumulado = 0;
    const segmentos = [
      { len: (terminados / totalProc) * C, color: '#10b981' }, // verde
      { len: (enProceso / totalProc) * C, color: '#f59e0b' },  // naranja
      { len: (conAtraso / totalProc) * C, color: '#ef4444' },  // rojo
      { len: (pendientes / totalProc) * C, color: '#cbd5e1' }  // gris
    ];

    circulosSVG += segmentos
      .filter(s => s.len > 0)
      .map(s => {
        const tag = `<circle cx="50" cy="50" r="38" stroke="${s.color}" stroke-width="12" stroke-dasharray="${s.len.toFixed(1)} ${(C - s.len).toFixed(1)}" stroke-dashoffset="-${offsetAcumulado.toFixed(1)}" fill="transparent"></circle>`;
        offsetAcumulado += s.len;
        return tag;
      })
      .join('');
  }

  const procesosConDuracion = procesos.filter(p => p.estado === 'terminado' && p.fechaInicio && p.fechaFin);

  return `
  <div class="kpi-card">
    <h3>📊 Resumen General — ${esc(eq.cliente)} (${esc(eq.descripcion)})</h3>

    <!-- Alerta de ritmo -->
    <div class="kpi-alerta-box ${ritmoClass}">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <span style="font-weight:800;font-size:14px;">Ritmo de entrega: ${ritmoBadge} ${detalleTiempos.esManual ? '(Ajuste manual)' : ''}</span>
        ${detalleTiempos.diasRestantesLaborables !== null ? `<span style="font-size:12px;font-weight:800;">${detalleTiempos.diasRestantesLaborables >= 0 ? `${detalleTiempos.diasRestantesLaborables}d laborables restantes` : `${Math.abs(detalleTiempos.diasRestantesLaborables)}d laborables vencido`}</span>` : ''}
      </div>
      <div style="font-size:12px;margin-top:4px;">
        ${esc(detalleTiempos.motivo)}
      </div>
    </div>

    <!-- 4 Stats Cards -->
    <div class="kpi-stats-grid">
      <div class="kpi-stat-card">
        <div class="kpi-stat-icon blue">🗓️</div>
        <div class="kpi-stat-info">
          <span class="kpi-stat-label">Días en taller</span>
          <span class="kpi-stat-val">${diasFabricacion} <span style="font-size:12px;font-weight:600;color:var(--gray-500)">días</span></span>
        </div>
      </div>
      <div class="kpi-stat-card">
        <div class="kpi-stat-icon green">📊</div>
        <div class="kpi-stat-info">
          <span class="kpi-stat-label">Avance global</span>
          <span class="kpi-stat-val ${prog === 100 ? 'ok' : ''}">${prog}%</span>
        </div>
      </div>
      <div class="kpi-stat-card">
        <div class="kpi-stat-icon amber">🔄</div>
        <div class="kpi-stat-info">
          <span class="kpi-stat-label">Activos hoy</span>
          <span class="kpi-stat-val ${enProceso > 0 ? 'warning' : ''}">${enProceso} <span style="font-size:12px;font-weight:600;color:var(--gray-500)">en proc.</span></span>
        </div>
      </div>
      <div class="kpi-stat-card">
        <div class="kpi-stat-icon red">⚖️</div>
        <div class="kpi-stat-info">
          <span class="kpi-stat-label">Desfasaje</span>
          <span class="kpi-stat-val ${brechaClass}">${brechaTexto}</span>
        </div>
      </div>
    </div>

    <!-- Gráficos Split: Balance y Donut -->
    <div class="kpi-graficos-split">
      <!-- Balance de Tiempos -->
      <div class="kpi-subcard">
        <div>
          <div class="kpi-subcard-title">
            <span>⚖️ Balance de Tiempos</span>
            <span style="font-size:11px;font-weight:800;color:${brechaDias < 0 ? 'var(--danger)' : 'var(--success)'};">${brechaDias < 0 ? `Déficit: ${Math.abs(brechaDias)}d` : `Margen: +${brechaDias}d`}</span>
          </div>
          <div class="kpi-subcard-subtitle">Trabajo pendiente vs. plazo de taller disponible</div>
        </div>

        <div>
          <!-- Barra Trabajo -->
          <div class="balance-bar-group">
            <div class="balance-bar-header">
              <span style="color:#dc2626;">🔴 Trabajo pendiente necesario</span>
              <span style="color:#dc2626;font-weight:800;">${detalleTiempos.diasTrabajoPendientes} días</span>
            </div>
            <div class="balance-bar-track">
              <div class="balance-bar-fill trabajo" style="width:${pctTrabajo}%;">
                ${detalleTiempos.diasTrabajoPendientes}d
              </div>
            </div>
          </div>

          <!-- Barra Plazo -->
          <div class="balance-bar-group">
            <div class="balance-bar-header">
              <span style="color:#2563eb;">🔵 Plazo laborable (sin domingos)</span>
              <span style="color:#2563eb;font-weight:800;">${diasLabDisponibles} días</span>
            </div>
            <div class="balance-bar-track">
              <div class="balance-bar-fill plazo" style="width:${pctPlazo}%;">
                ${diasLabDisponibles}d
              </div>
            </div>
          </div>
        </div>

        <div style="font-size:11px;color:var(--gray-600);background:var(--gray-50);padding:8px 10px;border-radius:6px;border:1px solid var(--gray-200);margin-top:4px;">
          💡 <b>Diagnóstico:</b> ${detalleTiempos.diasTrabajoPendientes > diasLabDisponibles ? `La carga de procesos supera en <b>${Math.abs(brechaDias)} días</b> el tiempo disponible de taller.` : `Tenés un changüí de <b>${brechaDias} días</b> para imprevistos.`}
        </div>
      </div>

      <!-- Donut Chart -->
      <div class="kpi-subcard">
        <div>
          <div class="kpi-subcard-title">
            <span>🍩 Estados de Procesos</span>
            <span style="font-size:11px;font-weight:700;color:var(--gray-500);">${terminados}/${totalProc} listos</span>
          </div>
          <div class="kpi-subcard-subtitle">Distribución de los ${totalProc} subprocesos</div>
        </div>

        <div class="donut-container">
          <svg class="donut-svg" viewBox="0 0 100 100">
            ${circulosSVG}
          </svg>
          <div class="donut-center-text">
            <span class="donut-center-val">${prog}%</span>
            <span class="donut-center-lbl">Avance</span>
          </div>
        </div>

        <div class="donut-legend">
          <div class="donut-legend-item"><span class="donut-legend-dot" style="background:#10b981"></span><span>Listos: <b>${terminados}</b></span></div>
          <div class="donut-legend-item"><span class="donut-legend-dot" style="background:#f59e0b"></span><span>En proc: <b>${enProceso}</b></span></div>
          <div class="donut-legend-item"><span class="donut-legend-dot" style="background:#cbd5e1"></span><span>En cola: <b>${pendientes}</b></span></div>
          <div class="donut-legend-item"><span class="donut-legend-dot" style="background:#ef4444"></span><span>Atraso: <b>${conAtraso}</b></span></div>
        </div>
      </div>
    </div>

    <!-- Tabla de Desglose Numérico Completa -->
    <details style="margin-top:6px;background:var(--white);border:1px solid var(--gray-200);border-radius:8px;padding:8px 12px;">
      <summary style="font-size:12px;font-weight:700;color:var(--primary);cursor:pointer;user-select:none;">
        📋 Ver tabla numérica detallada completa
      </summary>
      <div style="margin-top:8px;">
        <div class="kpi-row"><span class="kpi-label">Días en fabricación (desde inicio)</span><span class="kpi-value">${diasFabricacion} ${diasFabricacion === 1 ? 'día' : 'días'}</span></div>
        <div class="kpi-row"><span class="kpi-label">Avance global</span><span class="kpi-value">${prog}%</span></div>
        <div class="kpi-row"><span class="kpi-label">Procesos terminados (OK)</span><span class="kpi-value ok">${terminados}</span></div>
        <div class="kpi-row"><span class="kpi-label">Procesos en proceso</span><span class="kpi-value warning">${enProceso}</span></div>
        <div class="kpi-row"><span class="kpi-label">Procesos pendientes</span><span class="kpi-value">${pendientes}</span></div>
        <div class="kpi-row"><span class="kpi-label">Procesos con atraso reportado</span><span class="kpi-value danger">${conAtraso}</span></div>
        <div class="kpi-row"><span class="kpi-label">Duración total estimada en procesos</span><span class="kpi-value">${durTotal} días</span></div>
        <div class="kpi-row"><span class="kpi-label">Días de procesos completados</span><span class="kpi-value ok">${durTerminada} días</span></div>
        <div class="kpi-row"><span class="kpi-label">Trabajo pendiente por realizar</span><span class="kpi-value ${detalleTiempos.diasTrabajoPendientes > diasLabDisponibles ? 'danger' : ''}">${detalleTiempos.diasTrabajoPendientes} días</span></div>
        ${eq.fechaEntrega ? `
          <div class="kpi-row">
            <span class="kpi-label">Días laborables disponibles (sin domingos)</span>
            <span class="kpi-value ${diasLabDisponibles < 0 || detalleTiempos.diasTrabajoPendientes > diasLabDisponibles ? 'danger' : (diasLabDisponibles <= 2 ? 'warning' : 'ok')}">${diasLabDisponibles} días laborables (${detalleTiempos.diasRestantesCalendario}d corridos)</span>
          </div>` : ''}
      </div>
    </details>
  </div>

  <!-- Subprocesos y Tiempos Estimados -->
  <div class="kpi-card">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid var(--gray-200);padding-bottom:8px;">
      <h3 style="margin-bottom:0;border-bottom:none;padding-bottom:0;">⏱ Estado y Duración por Subproceso</h3>
      <span style="font-size:12px;font-weight:700;color:var(--gray-600)">${totalProc} procesos · ${durTotal}d est.</span>
    </div>

    <div>
      ${procesos.map(p => {
        const durReal = (p.fechaInicio && p.fechaFin) ? Math.max(1, diffDiasLaborables(p.fechaInicio, p.fechaFin)) : null;
        const durEst = parseFloat(p.duracion) || 0;
        const textoEstado = {
          terminado: '✅ Completado',
          en_proceso: '🔄 En proceso en taller',
          pendiente: '⬜ En espera',
          con_atraso: '⚠️ Con atraso'
        }[p.estado] || p.estado;

        return `
        <div class="kpi-proc-item ${p.estado}">
          <div class="kpi-proc-left">
            <div class="kpi-proc-icon-wrap">${getProcesoIcon(p.estado)}</div>
            <div style="min-width:0">
              <div class="kpi-proc-title" title="${esc(p.nombre)}">${esc(p.nombre)}</div>
              <div class="kpi-proc-sub">${textoEstado}${p.responsable ? ` · 👷 ${esc(p.responsable)}` : ''}</div>
            </div>
          </div>
          <div class="kpi-proc-badge">
            ${durReal !== null ? `${durReal}d real` : (durEst ? `${durEst}d est.` : '-')}
          </div>
        </div>`;
      }).join('')}
    </div>
  </div>

  ${procesosConDuracion.length > 0 ? `
  <div class="kpi-card">
    <h3>📅 Tiempos Reales vs Estimados</h3>
    ${procesosConDuracion.map(p => {
      const real = Math.max(1, diffDiasLaborables(p.fechaInicio, p.fechaFin));
      const est = parseFloat(p.duracion) || 0;
      const diff = real - est;
      const cls = diff > 0 ? 'danger' : (diff < 0 ? 'ok' : '');
      return `<div class="kpi-row">
        <span class="kpi-label">${esc(p.nombre)}</span>
        <span class="kpi-value ${cls}">Real: ${real}d / Est: ${est}d ${diff > 0 ? `(+${diff}d atraso)` : diff < 0 ? `(${Math.abs(diff)}d antes)` : '✓ A tiempo'}</span>
      </div>`;
    }).join('')}
  </div>` : ''}
  `;
}

function renderKPI() {
  const container = document.getElementById('kpi-content');
  const activos = state.equipos.filter(e => e.estado === 'en_produccion' && !e.eliminado);

  if (activos.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No hay equipos activos en fabricación para calcular KPIs.</p></div>`;
    return;
  }

  container.innerHTML = activos.map(eq => `
    <div onclick="openEquipoDetalle('${eq.id}')" style="cursor:pointer">
      ${buildKPIHTML(eq)}
    </div>
  `).join('');
}

/* ============================================================
   CREAR Y EDITAR EQUIPO
   ============================================================ */
function showNewEquipoModal() {
  document.getElementById('modal-equipo-title').textContent = 'Nuevo Equipo';
  document.getElementById('equipo-edit-id').value = '';
  document.getElementById('eq-cliente').value = '';
  document.getElementById('eq-descripcion').value = '';
  document.getElementById('eq-fecha-inicio').value = todayStr();
  document.getElementById('eq-fecha-entrega').value = '';
  document.getElementById('eq-operario').value = '';
  document.getElementById('eq-notas').value = '';
  document.getElementById('div-select-plantilla').style.display = 'block';
  const divEstado = document.getElementById('div-equipo-estado');
  if (divEstado) divEstado.style.display = 'none';
  const btnDel = document.getElementById('btn-modal-eliminar-equipo');
  if (btnDel) btnDel.style.display = 'none';
  const selRitmo = document.getElementById('eq-ritmo');
  if (selRitmo) selRitmo.value = 'auto';
  document.getElementById('modal-procesos-lista').innerHTML = '';
  populatePlantillasSelect();
  openModal('modal-nuevo-equipo');
}

function editEquipo() {
  const eq = state.equipos.find(e => e.id === state.currentEquipoId);
  if (!eq) return;

  document.getElementById('modal-equipo-title').textContent = 'Editar Equipo';
  document.getElementById('equipo-edit-id').value = eq.id;
  document.getElementById('eq-cliente').value = eq.cliente;
  document.getElementById('eq-descripcion').value = eq.descripcion;
  document.getElementById('eq-fecha-inicio').value = eq.fechaInicio || '';
  document.getElementById('eq-fecha-entrega').value = eq.fechaEntrega || '';
  document.getElementById('eq-operario').value = eq.operario || '';
  document.getElementById('eq-notas').value = eq.notas || '';
  document.getElementById('div-select-plantilla').style.display = 'none';
  const divEstado = document.getElementById('div-equipo-estado');
  if (divEstado) divEstado.style.display = 'block';
  const selEstado = document.getElementById('eq-estado');
  if (selEstado) selEstado.value = eq.estado || 'en_produccion';
  const selRitmo = document.getElementById('eq-ritmo');
  if (selRitmo) selRitmo.value = eq.ritmoTiempo || 'auto';
  const btnDel = document.getElementById('btn-modal-eliminar-equipo');
  if (btnDel) btnDel.style.display = 'inline-flex';
  openModal('modal-nuevo-equipo');
}

function populatePlantillasSelect() {
  const sel = document.getElementById('eq-plantilla');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Seleccionar plantilla —</option>';
  state.plantillas.forEach(pl => {
    const opt = document.createElement('option');
    opt.value = pl.id;
    opt.textContent = `${pl.nombre} (${(pl.procesos || []).length} procesos)`;
    sel.appendChild(opt);
  });
}

function loadPlantillaInModal() {
  const plId = document.getElementById('eq-plantilla').value;
  const pl = state.plantillas.find(p => p.id === plId);
  const container = document.getElementById('modal-procesos-lista');
  container.innerHTML = '';
  if (!pl || !pl.procesos) return;
  pl.procesos.forEach(proc => addProcesoToModal(proc.nombre, proc.duracion));
}

function addProcesoToModal(nombre = '', duracion = '') {
  const container = document.getElementById('modal-procesos-lista');
  const row = document.createElement('div');
  row.className = 'modal-proceso-row';
  row.innerHTML = `
    <input type="text" placeholder="Nombre del proceso" value="${esc(nombre)}">
    <input type="number" class="dur-input" placeholder="días" value="${duracion}" min="0" step="0.5">
    <button type="button" onclick="this.parentElement.remove()" title="Quitar">✕</button>
  `;
  container.appendChild(row);
}

async function saveEquipo() {
  const cliente = document.getElementById('eq-cliente').value.trim();
  const descripcion = document.getElementById('eq-descripcion').value.trim();
  if (!cliente || !descripcion) { showToast('Completá cliente y descripción'); return; }

  const editId = document.getElementById('equipo-edit-id').value;

  if (editId) {
    const eq = state.equipos.find(e => e.id === editId);
    if (!eq) return;
    eq.cliente = cliente;
    eq.descripcion = descripcion;
    eq.fechaInicio = document.getElementById('eq-fecha-inicio').value || null;
    eq.fechaEntrega = document.getElementById('eq-fecha-entrega').value || null;
    eq.operario = document.getElementById('eq-operario').value.trim();
    eq.notas = document.getElementById('eq-notas').value.trim();

    const nuevoEstado = document.getElementById('eq-estado')?.value;
    if (nuevoEstado && nuevoEstado !== eq.estado) {
      eq.estado = nuevoEstado;
      if (nuevoEstado === 'terminado') eq.fechaFinReal = todayStr();
      addHistorial(eq, `Estado del equipo actualizado a ${nuevoEstado}`, 'info');
    } else {
      addHistorial(eq, 'Ficha del equipo editada', 'info');
    }

    const nuevoRitmo = document.getElementById('eq-ritmo')?.value || 'auto';
    if (nuevoRitmo !== eq.ritmoTiempo) {
      eq.ritmoTiempo = nuevoRitmo;
    }

    closeModal('modal-nuevo-equipo');
    renderEquipoDetalle();
    showToast('Equipo actualizado en la nube ✓');
    await saveEquipoToCloud(eq);
  } else {
    const procRows = document.querySelectorAll('#modal-procesos-lista .modal-proceso-row');
    const procesos = [];
    procRows.forEach(row => {
      const inputs = row.querySelectorAll('input');
      const nombre = inputs[0].value.trim();
      const dur = parseFloat(inputs[1].value) || 0;
      if (nombre) {
        procesos.push({
          id: uid(),
          nombre,
          duracion: dur,
          estado: 'pendiente',
          fechaInicio: null,
          fechaFin: null,
          responsable: '',
          notas: ''
        });
      }
    });

    const newId = uid();
    const eq = {
      id: newId,
      cliente,
      descripcion,
      operario: document.getElementById('eq-operario').value.trim(),
      fechaInicio: document.getElementById('eq-fecha-inicio').value || todayStr(),
      fechaEntrega: document.getElementById('eq-fecha-entrega').value || null,
      ritmoTiempo: document.getElementById('eq-ritmo')?.value || 'auto',
      notas: document.getElementById('eq-notas').value.trim(),
      estado: 'en_produccion',
      procesos,
      fotos: [],
      historial: [{ fecha: todayStr(), texto: 'Equipo creado en el sistema', tipo: 'creacion' }]
    };

    closeModal('modal-nuevo-equipo');
    state.currentEquipoId = newId;
    state.equipos.unshift(eq);
    navigate('equipo-detalle');
    showToast('Equipo guardado en Firestore ✓');
    await saveEquipoToCloud(eq);
  }
}

/* ============================================================
   REPORTE DIARIO DE WHATSAPP
   ============================================================ */
function updateReportePreview() {
  const tipo = document.querySelector('input[name="reporte-tipo"]:checked')?.value || 'inicio';
  const reporte = buildReporte(tipo);
  const previewEl = document.getElementById('reporte-preview');
  if (previewEl) previewEl.textContent = reporte;
}

function buildReporte(tipo) {
  const activos = state.equipos.filter(e => e.estado === 'en_produccion' && !e.eliminado);
  const hoy = new Date();
  const fechaStr = hoy.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hora = hoy.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  let lines = [];
  if (tipo === 'inicio') {
    lines.push(`*TAREAS DEL DIA* ☀️`);
    lines.push(`Fecha: ${fechaStr} - ${hora}`);
    lines.push(`---------------------------`);
    lines.push('');
  } else {
    lines.push(`*FIN DE JORNADA* 🌙`);
    lines.push(`Fecha: ${fechaStr} - ${hora}`);
    lines.push(`---------------------------`);
    lines.push('');
  }

  activos.forEach(eq => {
    const responsable = eq.operario ? ` (${eq.operario})` : '';
    lines.push(`*${eq.cliente.toUpperCase()}*${responsable}`);
    lines.push(`${eq.descripcion}`);

    const procesos = eq.procesos || [];

    if (tipo === 'inicio') {
      const enProceso = procesos.filter(p => p.estado === 'en_proceso');
      const atrasados = procesos.filter(p => p.estado === 'con_atraso');
      const pendientes = procesos.filter(p => p.estado === 'pendiente');

      if (atrasados.length > 0) {
        atrasados.forEach(p => lines.push(`-⚠️ [ATRASO] ${p.nombre}${p.notas ? ': ' + p.notas : ''}`));
      }
      if (enProceso.length > 0) {
        enProceso.forEach(p => lines.push(`-🔄 [PROCESO] ${p.nombre}`));
      }
      if (pendientes.length > 0) {
        pendientes.slice(0, 4).forEach(p => lines.push(`-${p.nombre}`));
      }
      if (atrasados.length === 0 && enProceso.length === 0 && pendientes.length === 0) {
        lines.push(`-Sin tareas pendientes asignadas`);
      }
    } else {
      const hoyStr = todayStr();
      const terminadosHoy = procesos.filter(p => p.estado === 'terminado' && (p.fechaFin === hoyStr || !p.fechaFin));
      const enProceso = procesos.filter(p => p.estado === 'en_proceso');
      const atrasados = procesos.filter(p => p.estado === 'con_atraso');

      terminadosHoy.forEach(p => lines.push(`-${p.nombre} OK`));
      enProceso.forEach(p => lines.push(`-${p.nombre} PROCESO`));
      atrasados.forEach(p => lines.push(`-${p.nombre} ATRASO${p.notas ? ' (' + p.notas + ')' : ''}`));

      if (terminadosHoy.length === 0 && enProceso.length === 0 && atrasados.length === 0) {
        lines.push(`-Sin novedades reportadas en el día`);
      }
    }

    const prog = calcProgreso(eq);
    lines.push(`Progreso: ${prog}%`);

    const detalleTiempos = calcDetalleTiempos(eq);
    const ritmoIcono = { ok: '🟢 A tiempo', riesgo: '🟡 En riesgo', atrasado: '🔴 Con atraso' }[detalleTiempos.estadoFinal] || '🟢 A tiempo';
    const tagModo = detalleTiempos.esManual ? ' (manual)' : '';
    lines.push(`Ritmo de entrega: ${ritmoIcono}${tagModo}`);
    if (detalleTiempos.motivo) {
      lines.push(`Situación: ${detalleTiempos.motivo}`);
    }

    if (eq.fechaEntrega) {
      const diasLab = detalleTiempos.diasRestantesLaborables !== null ? detalleTiempos.diasRestantesLaborables : diffDays(todayStr(), eq.fechaEntrega);
      const aviso = diasLab < 0 ? `⚠️ (${Math.abs(diasLab)} días laborables de atraso)` : `(${diasLab} días laborables restantes)`;
      lines.push(`Fecha estimada de entrega: ${fmtDate(eq.fechaEntrega)} ${aviso}`);
    }
    lines.push('');
  });

  return lines.join('\n');
}

function copyReporte() {
  const texto = document.getElementById('reporte-preview').textContent;
  navigator.clipboard.writeText(texto)
    .then(() => showToast('Reporte copiado al portapapeles 📋'))
    .catch(() => showToast('No se pudo copiar'));
}

function shareReporte() {
  const tipo = document.querySelector('input[name="reporte-tipo"]:checked')?.value || 'inicio';
  const texto = buildReporte(tipo);
  const encoded = encodeURIComponent(texto);
  window.open(`https://wa.me/?text=${encoded}`, '_blank');
}

function showReporteEquipoModal() {
  navigate('reporte');
  updateReportePreview();
}

/* ============================================================
   PLANTILLAS
   ============================================================ */
function renderPlantillas() {
  const container = document.getElementById('plantillas-list');
  if (state.plantillas.length === 0) {
    container.innerHTML = `<div class="empty-state"><p>No hay plantillas guardadas.</p><button class="btn btn-primary btn-sm" onclick="showNewPlantillaModal()">+ Crear primera plantilla</button></div>`;
    return;
  }
  container.innerHTML = state.plantillas.map(pl => `
    <div class="plantilla-card">
      <div class="plantilla-info">
        <div class="plantilla-nombre">${esc(pl.nombre)}</div>
        ${pl.descripcion ? `<div class="plantilla-desc">${esc(pl.descripcion)}</div>` : ''}
        <div class="plantilla-count">${(pl.procesos || []).length} procesos estándar</div>
      </div>
      <div class="plantilla-actions">
        <button class="btn btn-sm btn-outline" onclick="editPlantilla('${pl.id}')">✏️</button>
        <button class="btn btn-sm btn-outline" style="color:var(--danger);border-color:var(--danger)" onclick="deletePlantilla('${pl.id}')">🗑</button>
      </div>
    </div>
  `).join('');
}

function showNewPlantillaModal() {
  document.getElementById('modal-plantilla-title').textContent = 'Nueva Plantilla';
  document.getElementById('plantilla-edit-id').value = '';
  document.getElementById('pl-nombre').value = '';
  document.getElementById('pl-descripcion').value = '';
  document.getElementById('pl-procesos-lista').innerHTML = '';
  addProcesoToPlantilla('Fabricación inicial', 2);
  openModal('modal-plantilla');
}

function editPlantilla(plId) {
  const pl = state.plantillas.find(p => p.id === plId);
  if (!pl) return;
  document.getElementById('modal-plantilla-title').textContent = 'Editar Plantilla';
  document.getElementById('plantilla-edit-id').value = plId;
  document.getElementById('pl-nombre').value = pl.nombre;
  document.getElementById('pl-descripcion').value = pl.descripcion || '';
  const container = document.getElementById('pl-procesos-lista');
  container.innerHTML = '';
  (pl.procesos || []).forEach(p => addProcesoToPlantilla(p.nombre, p.duracion));
  openModal('modal-plantilla');
}

function addProcesoToPlantilla(nombre = '', duracion = '') {
  const container = document.getElementById('pl-procesos-lista');
  const row = document.createElement('div');
  row.className = 'modal-proceso-row';
  row.innerHTML = `
    <input type="text" placeholder="Nombre del proceso" value="${esc(nombre)}">
    <input type="number" class="dur-input" placeholder="días" value="${duracion}" min="0" step="0.5">
    <button type="button" onclick="this.parentElement.remove()" title="Quitar">✕</button>
  `;
  container.appendChild(row);
}

async function savePlantilla() {
  const nombre = document.getElementById('pl-nombre').value.trim();
  if (!nombre) { showToast('Ingresá el nombre de la plantilla'); return; }

  const rows = document.querySelectorAll('#pl-procesos-lista .modal-proceso-row');
  const procesos = [];
  rows.forEach(row => {
    const inputs = row.querySelectorAll('input');
    const n = inputs[0].value.trim();
    const d = parseFloat(inputs[1].value) || 0;
    if (n) procesos.push({ nombre: n, duracion: d });
  });

  const editId = document.getElementById('plantilla-edit-id').value;
  const plId = editId || ('pl-' + uid());
  const plantilla = {
    id: plId,
    nombre,
    descripcion: document.getElementById('pl-descripcion').value.trim(),
    procesos
  };

  closeModal('modal-plantilla');
  showToast('Plantilla guardada en Firestore ✓');
  await savePlantillaToCloud(plantilla);
}

async function deletePlantilla(plId) {
  const pl = state.plantillas.find(p => p.id === plId);
  if (!pl || !confirm(`¿Eliminar la plantilla "${pl.nombre}"?`)) return;
  showToast('Eliminando...');
  await deletePlantillaFromCloud(plId);
}

/* ============================================================
   COPIA DE SEGURIDAD Y EXPORTACIÓN
   ============================================================ */
function renderBackupView() {
  const elEq = document.getElementById('backup-total-equipos');
  const elPl = document.getElementById('backup-total-plantillas');
  const totalActivos = state.equipos.filter(e => !e.eliminado).length;
  const totalPapelera = state.equipos.filter(e => e.eliminado).length;
  if (elEq) elEq.textContent = `${totalActivos} activos / ${totalPapelera} en papelera (${state.equipos.length} total)`;
  if (elPl) elPl.textContent = `${state.plantillas.length} configuradas`;
}

function descargarBackupJSON() {
  const data = {
    app: "FabriTrack",
    version: "2.0",
    fechaBackup: new Date().toISOString(),
    totalEquipos: state.equipos.length,
    equipos: state.equipos,
    plantillas: state.plantillas
  };
  const str = JSON.stringify(data, null, 2);
  const blob = new Blob([str], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `FabriTrack_Backup_${todayStr()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Copia de seguridad descargada con éxito 💾');
}

function descargarEquiposExcel() {
  const equipos = state.equipos.filter(e => !e.eliminado);
  if (equipos.length === 0) {
    showToast('No hay equipos para exportar');
    return;
  }

  const cabeceras = [
    'Cliente',
    'Equipo / Descripción',
    'Operario Responsable',
    'Estado',
    'Ritmo de Entrega',
    'Fecha Inicio',
    'Fecha Entrega',
    'Progreso %',
    'Procesos Terminados',
    'Total Procesos',
    'Duración Total Est. (días)',
    'Notas'
  ];

  const filas = equipos.map(eq => {
    const prog = calcProgreso(eq);
    const detalleTiempos = calcDetalleTiempos(eq);
    const proc = eq.procesos || [];
    const term = proc.filter(p => p.estado === 'terminado').length;
    const durTotal = proc.reduce((s, p) => s + (parseFloat(p.duracion) || 0), 0);

    const limpiar = (txt) => `"${String(txt || '').replace(/"/g, '""')}"`;

    return [
      limpiar(eq.cliente),
      limpiar(eq.descripcion),
      limpiar(eq.operario),
      limpiar(eq.estado),
      limpiar(detalleTiempos.estadoFinal),
      limpiar(eq.fechaInicio),
      limpiar(eq.fechaEntrega),
      prog,
      term,
      proc.length,
      durTotal,
      limpiar(eq.notas)
    ].join(',');
  });

  const csvContent = '\uFEFF' + cabeceras.join(',') + '\n' + filas.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `FabriTrack_Equipos_${todayStr()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Planilla Excel (CSV) descargada ✓');
}

async function restaurarBackupJSON(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (!data.equipos || !Array.isArray(data.equipos)) {
        alert('El archivo seleccionado no tiene un formato válido de copia de seguridad de FabriTrack.');
        return;
      }

      const confirmar = confirm(`¿Restaurar copia de seguridad del archivo "${file.name}"?\n\nContiene ${data.equipos.length} equipos y ${(data.plantillas || []).length} plantillas.\nSe guardarán en Firestore.`);
      if (!confirmar) return;

      showToast('Restaurando datos en Firestore...');

      for (const eq of data.equipos) {
        await saveEquipoToCloud(eq);
      }

      if (data.plantillas && Array.isArray(data.plantillas)) {
        for (const pl of data.plantillas) {
          await savePlantillaToCloud(pl);
        }
      }

      showToast('¡Copia de seguridad restaurada con éxito! ✓');
      event.target.value = '';
      navigate('equipos');
    } catch (err) {
      console.error('Error al restaurar JSON:', err);
      alert('Error al leer o procesar el archivo JSON de respaldo.');
    }
  };
  reader.readAsText(file);
}
