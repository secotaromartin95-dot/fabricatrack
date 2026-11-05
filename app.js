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
  
  // Suma de duraciones estimadas de los procesos que faltan terminar
  const diasTrabajoPendientes = procesos
    .filter(p => p.estado !== 'terminado')
    .reduce((sum, p) => sum + (parseFloat(p.duracion) || 0), 0);
  const diasTrabajoTotal = procesos.reduce((sum, p) => sum + (parseFloat(p.duracion) || 0), 0);
  const diasTrabajoTerminado = procesos
    .filter(p => p.estado === 'terminado')
    .reduce((sum, p) => sum + (parseFloat(p.duracion) || 0), 0);
  
  const procesosConAtraso = procesos.filter(p => p.estado === 'con_atraso').map(p => p.nombre);

  // 1. Diagnóstico Automático Calculado
  let estadoCalculado = 'ok';
  let motivo = 'Dentro de los plazos estimados';

  if (procesosConAtraso.length > 0) {
    estadoCalculado = 'atrasado';
    motivo = `Atraso en: ${procesosConAtraso.slice(0, 2).join(', ')}`;
  } else if (diasRestantesCalendario !== null) {
    if (diasRestantesCalendario < 0) {
      estadoCalculado = 'atrasado';
      motivo = `Superó la fecha límite (${Math.abs(diasRestantesCalendario)}d de retraso)`;
    } else if (diasTrabajoPendientes > diasRestantesCalendario) {
      estadoCalculado = 'atrasado';
      motivo = `Faltan ${diasTrabajoPendientes}d de procesos y solo quedan ${diasRestantesCalendario}d para entrega`;
    } else if (diasTrabajoPendientes >= diasRestantesCalendario * 0.8 || diasRestantesCalendario <= 2) {
      estadoCalculado = 'riesgo';
      motivo = `Con lo justo: restan ${diasTrabajoPendientes}d de procesos vs ${diasRestantesCalendario}d de plazo`;
    } else {
      estadoCalculado = 'ok';
      motivo = `Buen ritmo: ${diasTrabajoPendientes}d de trabajo en ${diasRestantesCalendario}d disponibles`;
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
  const activos = state.equipos.filter(e => e.estado === 'en_produccion');
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
  const diasRestantes = equipo.fechaEntrega ? diffDays(todayStr(), equipo.fechaEntrega) : null;

  let diasStr = '';
  if (diasRestantes !== null) {
    if (diasRestantes < 0) diasStr = `⚠️ ${Math.abs(diasRestantes)}d de atraso`;
    else if (diasRestantes === 0) diasStr = '⚠️ Entrega hoy';
    else diasStr = `📅 Entrega en ${diasRestantes}d`;
  }

  const detalleTiempos = calcDetalleTiempos(equipo);
  let ritmoBadge = '';
  if (equipo.estado !== 'terminado' && equipo.estado !== 'pausado') {
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
        <button class="btn-icon danger" style="padding:4px 8px;font-size:13px;border:1px solid var(--gray-200);border-radius:6px;background:var(--white);" onclick="event.stopPropagation(); eliminarEquipoDirecto('${equipo.id}', '${esc(equipo.cliente)}')" title="Eliminar este equipo">🗑️</button>
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
    ${detalleTiempos.motivo && equipo.estado !== 'terminado' ? `<div class="meta-item" style="font-size:11px;color:var(--gray-600)">⏱️ ${esc(detalleTiempos.motivo)}</div>` : ''}
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
    const matchQ = !q || e.cliente.toLowerCase().includes(q) || e.descripcion.toLowerCase().includes(q) || (e.operario || '').toLowerCase().includes(q);
    const matchEst = !est || e.estado === est;
    return matchQ && matchEst;
  });

  const container = document.getElementById('equipos-list');
  if (lista.length === 0) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">🔍</div><p>No se encontraron equipos con ese filtro.</p></div>`;
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

  const hoy = todayStr();
  const diasRestantes = eq.fechaEntrega ? diffDays(hoy, eq.fechaEntrega) : null;
  let diasClass = '';
  let diasTexto = '-';
  if (diasRestantes !== null) {
    if (diasRestantes < 0) { diasClass = 'danger'; diasTexto = `${Math.abs(diasRestantes)} días ATRASADO`; }
    else if (diasRestantes === 0) { diasClass = 'warning'; diasTexto = 'Entrega HOY'; }
    else if (diasRestantes <= 2) { diasClass = 'warning'; diasTexto = `${diasRestantes} días restantes`; }
    else { diasTexto = `${diasRestantes} días restantes`; }
  }

  const detalleTiempos = calcDetalleTiempos(eq);
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
    ${diasRestantes !== null ? `<div class="info-item"><span class="info-label">Plazo</span><span class="info-value ${diasClass}">${diasTexto}</span></div>` : ''}
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
        ${detalleTiempos.diasRestantesCalendario !== null ? `📅 Plazo: <b>${detalleTiempos.diasRestantesCalendario}d</b> restantes | ⏱️ Trabajo pendiente: <b>${detalleTiempos.diasTrabajoPendientes}d</b> en procesos` : `⏱️ Trabajo pendiente: <b>${detalleTiempos.diasTrabajoPendientes}d</b> en procesos (sin fecha fijada)`}
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

  const confirmacion = confirm(`¿Estás seguro de que deseas ELIMINAR permanentemente el equipo "${eq.cliente} - ${eq.descripcion}"?\n\nEsta acción borrará el equipo y sus procesos de la base de datos.`);
  if (!confirmacion) return;

  const idParaEliminar = eq.id;
  const clienteNombre = eq.cliente;
  showToast('Eliminando equipo...');

  const exito = await deleteEquipoFromCloud(idParaEliminar);
  if (exito) {
    state.currentEquipoId = null;
    navigate('equipos');
    showToast(`Equipo "${clienteNombre}" eliminado con éxito ✓`);
  }
}

async function eliminarEquipoDesdeModal() {
  closeModal('modal-nuevo-equipo');
  await eliminarEquipoActual();
}

async function eliminarEquipoDirecto(id, cliente) {
  const confirmacion = confirm(`¿Estás seguro de que deseas ELIMINAR permanentemente el equipo "${cliente}"?\n\nEsta acción borrará el equipo y sus procesos de la base de datos.`);
  if (!confirmacion) return;

  showToast('Eliminando equipo...');
  const exito = await deleteEquipoFromCloud(id);
  if (exito) {
    if (state.currentEquipoId === id) state.currentEquipoId = null;
    showToast(`Equipo "${cliente}" eliminado ✓`);
  }
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
  eq.historial.unshift({ fecha: todayStr(), texto, tipo });
  if (eq.historial.length > 50) eq.historial.pop();
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
        <div class="historial-fecha">${fmtDate(h.fecha)}</div>
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
  const diasFabricacion = eq.fechaInicio ? Math.max(0, diffDays(eq.fechaInicio, hoy)) : '-';
  const prog = calcProgreso(eq);
  const terminados = procesos.filter(p => p.estado === 'terminado').length;
  const enProceso = procesos.filter(p => p.estado === 'en_proceso').length;
  const pendientes = procesos.filter(p => p.estado === 'pendiente').length;
  const conAtraso = procesos.filter(p => p.estado === 'con_atraso').length;
  const durTotal = procesos.reduce((s, p) => s + (p.duracion || 0), 0);
  const durTerminada = procesos.filter(p => p.estado === 'terminado').reduce((s, p) => s + (p.duracion || 0), 0);

  const procesosConDuracion = procesos.filter(p => p.estado === 'terminado' && p.fechaInicio && p.fechaFin);

  return `
  <div class="kpi-card">
    <h3>📊 Resumen General — ${esc(eq.cliente)} (${esc(eq.descripcion)})</h3>
    <div class="kpi-row"><span class="kpi-label">Días transcurridos desde inicio</span><span class="kpi-value">${diasFabricacion} días</span></div>
    <div class="kpi-row"><span class="kpi-label">Avance global</span><span class="kpi-value">${prog}%</span></div>
    <div class="kpi-row"><span class="kpi-label">Procesos terminados (OK)</span><span class="kpi-value ok">${terminados}</span></div>
    <div class="kpi-row"><span class="kpi-label">Procesos en proceso</span><span class="kpi-value warning">${enProceso}</span></div>
    <div class="kpi-row"><span class="kpi-label">Procesos pendientes</span><span class="kpi-value">${pendientes}</span></div>
    <div class="kpi-row"><span class="kpi-label">Procesos con atraso</span><span class="kpi-value danger">${conAtraso}</span></div>
    <div class="kpi-row"><span class="kpi-label">Suma de duraciones estimadas</span><span class="kpi-value">${durTotal} días</span></div>
    <div class="kpi-row"><span class="kpi-label">Días completados</span><span class="kpi-value ok">${durTerminada} días</span></div>
    ${eq.fechaEntrega ? `
      <div class="kpi-row">
        <span class="kpi-label">Plazo restante</span>
        <span class="kpi-value ${diffDays(hoy, eq.fechaEntrega) < 0 ? 'danger' : ''}">${diffDays(hoy, eq.fechaEntrega)} días</span>
      </div>` : ''}
  </div>

  <div class="kpi-card">
    <h3>⏱ Estado y Duración por Subproceso</h3>
    <div class="kpi-proceso-bar">
      ${procesos.map(p => {
        const durReal = (p.fechaInicio && p.fechaFin) ? diffDays(p.fechaInicio, p.fechaFin) : null;
        const barra = Math.min(100, (p.duracion / (durTotal || 1)) * 100);
        return `
        <div class="kpi-proceso-row">
          <span class="kpi-proceso-nombre" title="${esc(p.nombre)}">${esc(p.nombre)}</span>
          <div class="kpi-proceso-barra">
            <div class="kpi-proceso-fill fill-${p.estado}" style="width:${barra || 20}%"></div>
          </div>
          <span class="kpi-proceso-dias">${getProcesoIcon(p.estado)} ${durReal !== null ? durReal + 'd' : (p.duracion ? p.duracion + 'd' : '-')}</span>
        </div>`;
      }).join('')}
    </div>
  </div>

  ${procesosConDuracion.length > 0 ? `
  <div class="kpi-card">
    <h3>📅 Tiempos Reales vs Estimados</h3>
    ${procesosConDuracion.map(p => {
      const real = diffDays(p.fechaInicio, p.fechaFin);
      const est = p.duracion || 0;
      const diff = real - est;
      const cls = diff > 0 ? 'danger' : (diff < 0 ? 'ok' : '');
      return `<div class="kpi-row">
        <span class="kpi-label">${esc(p.nombre)}</span>
        <span class="kpi-value ${cls}">Real: ${real}d / Est: ${est}d ${diff > 0 ? `(+${diff}d atraso)` : diff < 0 ? `(${diff}d antes)` : '✓ A tiempo'}</span>
      </div>`;
    }).join('')}
  </div>` : ''}
  `;
}

function renderKPI() {
  const container = document.getElementById('kpi-content');
  const activos = state.equipos.filter(e => e.estado === 'en_produccion');

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
  const activos = state.equipos.filter(e => e.estado === 'en_produccion');
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
      const dias = diffDays(todayStr(), eq.fechaEntrega);
      const aviso = dias < 0 ? `⚠️ (${Math.abs(dias)} días de atraso)` : `(${dias} días para entrega)`;
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
