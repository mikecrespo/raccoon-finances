(function(){
  "use strict";

  /* ============================================================
   *  Raccoon Finances — lógica de la app
   *  El guardado y la sincronización viven en store.js (RaccoonStore).
   * ============================================================ */

  /* ---------- datos iniciales ---------- */
  /* Se dejó vacío a propósito: los datos reales viven en la nube (Firestore) y en
     cada dispositivo. Al iniciar sesión, la app baja tus datos de la nube. Este
     "seed" solo se usaría en un dispositivo nuevo sin nada guardado y sin sesión. */
  var SEED_STATE = null;

  /* ---------- estado ---------- */
  var CATEGORIAS_DEFAULT = [
    'Súper / Despensa', 'Restaurantes / Antojos', 'Transporte', 'Servicios / Casa',
    'Suscripciones', 'Salud', 'Personal / Cuidado', 'Entretenimiento / Salidas',
    'Regalos / Detalles', 'Otros'
  ];
  var TITULOS_DEFAULT = {
    cuentaBancaria: 'Cuenta bancaria',
    fondos: 'Fondos',
    metasAhorro: 'Metas de ahorro',
    inversiones: 'Inversiones',
    deudasPagar: 'Deudas por pagar',
    deudasCobrar: 'Deudas por cobrar'
  };
  function estadoVacio(){
    return {
      ingresos: [], gastos: [], pendientes: [], metas: [],
      fondoEmergencia: { montoObjetivo: 0, montoActual: 0, aportes: [], fechaObjetivo: '' },
      fondosAdicionales: [],
      inversiones: [], decisiones: [],
      movimientos: [],
      categorias: CATEGORIAS_DEFAULT.slice(),
      titulos: {},
      cuentaBancaria: { apartado: 0, saldoPrincipal: 0, pisoSaldoPrincipal: 3000 },
      historialMensual: {},
      ultimaActualizacion: ""
    };
  }
  function normalizarEstado(){
    state.cuentaBancaria = Object.assign({ apartado: 0, saldoPrincipal: 0, pisoSaldoPrincipal: 3000 }, state.cuentaBancaria || {});
    state.fondoEmergencia = Object.assign({ montoObjetivo: 0, montoActual: 0, aportes: [], fechaObjetivo: '' }, state.fondoEmergencia || {});
    if (!Array.isArray(state.fondosAdicionales)) state.fondosAdicionales = [];
    state.fondosAdicionales.forEach(function(f){ if (!Array.isArray(f.aportes)) f.aportes = []; if (f.montoActual == null) f.montoActual = 0; if (f.montoObjetivo == null) f.montoObjetivo = 0; if (f.fechaObjetivo == null) f.fechaObjetivo = ''; });
    if (!state.historialMensual || typeof state.historialMensual !== 'object') state.historialMensual = {};
    if (!Array.isArray(state.ingresos)) state.ingresos = [];
    if (!Array.isArray(state.gastos)) state.gastos = [];
    if (!Array.isArray(state.pendientes)) state.pendientes = [];
    if (!Array.isArray(state.metas)) state.metas = [];
    if (!Array.isArray(state.inversiones)) state.inversiones = [];
    if (!Array.isArray(state.decisiones)) state.decisiones = [];
    if (!Array.isArray(state.movimientos)) state.movimientos = [];
    if (!Array.isArray(state.categorias) || !state.categorias.length) state.categorias = CATEGORIAS_DEFAULT.slice();
    if (!state.titulos || typeof state.titulos !== 'object') state.titulos = {};
    state.metas.forEach(function(m){ if (!Array.isArray(m.aportes)) m.aportes = []; if (m.fechaObjetivo == null) m.fechaObjetivo = ''; });
    state.pendientes.forEach(function(p){
      if (!Array.isArray(p.pagos)) p.pagos = [];
      if (p.tipo !== 'pagar' && p.tipo !== 'cobrar') p.tipo = 'pagar';
      if (p.motivo == null) p.motivo = '';
      if (p.quien == null) p.quien = '';
    });
    state.inversiones.forEach(function(i){ if (i.tasaInteres == null) i.tasaInteres = 0; if (!Array.isArray(i.reinversiones)) i.reinversiones = []; if (i.fechaObjetivo == null) i.fechaObjetivo = ''; });
    state.movimientos.forEach(function(g){ if (g.motivo == null) g.motivo = ''; if (g.categoria == null) g.categoria = 'Otros'; if (!g.fecha) g.fecha = hoyISO(); if (g.monto == null) g.monto = 0; });
  }
  function tituloDe(key){ return (state.titulos && state.titulos[key]) || TITULOS_DEFAULT[key]; }

  var state = estadoVacio();
  var dataLoaded = false;

  var TAB_KEY = 'raccoon_activeTab';
  var activeTab = 'resumen';
  try { activeTab = localStorage.getItem(TAB_KEY) || 'resumen'; } catch (e) { /* */ }

  /* ---------- utilidades ---------- */
  function uid(){ return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function fmt(n){
    n = Number(n) || 0;
    return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n);
  }
  function fechaCorta(iso){
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
  }
  function hoyISO(){ return new Date().toISOString().slice(0, 10); }
  function ahoraHM(){
    var d = new Date();
    var pad = function(n){ return String(n).padStart(2, '0'); };
    return pad(d.getHours()) + '' + pad(d.getMinutes());
  }
  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function montoMensual(item){
    return item.frecuencia === 'quincenal' ? Number(item.monto) * 2 : Number(item.monto);
  }
  /* color de cualquier avance: rojo mientras progresa, verde al completarse */
  function pctColor(pct){ return (Number(pct) >= 100) ? 'var(--good)' : 'var(--tile-red)'; }

  var MESES_CORTO = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  function mesLegible(ym){
    var p = String(ym).split('-');
    var m = parseInt(p[1], 10) - 1;
    return (MESES_CORTO[m] || '?') + ' ' + p[0];
  }
  function fechaLarga(iso){
    if (!iso) return '';
    var d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  /* texto "faltan X meses" / "atrasada" para una fecha objetivo */
  function faltanTexto(fechaObjetivo, completo){
    if (!fechaObjetivo) return '';
    var d = new Date(fechaObjetivo + 'T00:00:00');
    if (isNaN(d)) return '';
    var hoy = new Date(hoyISO() + 'T00:00:00');
    var meses = (d.getFullYear() - hoy.getFullYear()) * 12 + (d.getMonth() - hoy.getMonth());
    var etiqueta = 'meta: ' + fechaLarga(fechaObjetivo);
    if (completo) return etiqueta;
    if (d < hoy) return etiqueta + ' · atrasada';
    if (meses <= 0) return etiqueta + ' · este mes';
    return etiqueta + ' · faltan ' + meses + (meses === 1 ? ' mes' : ' meses');
  }

  var PENCIL_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';

  /* modal de solo lectura (historial de pagos/aportes) */
  function openInfoModal(title, bodyHtml){
    var overlay = document.getElementById('modal-overlay');
    var box = document.getElementById('modal-box');
    box.innerHTML = '<h3>' + escapeHtml(title) + '</h3>' + bodyHtml +
      '<div class="modal-actions"><button class="save" id="modal-close">Cerrar</button></div>';
    overlay.classList.remove('hidden');
    document.getElementById('modal-close').onclick = closeModal;
    overlay.onclick = function(e){ if (e.target === overlay) closeModal(); };
  }

  /* celebración: mapache bailando ~3 s */
  function celebrate(msg){
    var el = document.getElementById('celebrate');
    if (!el) return;
    document.getElementById('celebrate-text').textContent = msg || '¡Lo lograste!';
    el.classList.remove('hidden');
    clearTimeout(celebrate._h);
    celebrate._h = setTimeout(function(){ el.classList.add('hidden'); }, 3000);
    el.onclick = function(){ clearTimeout(celebrate._h); el.classList.add('hidden'); };
  }
  function toast(msg){
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._h);
    toast._h = setTimeout(function(){ t.classList.remove('show'); }, 2600);
  }

  /* ---------- cálculos ---------- */
  function resumen(){
    var ingresoMensual = state.ingresos.reduce(function(s, i){ return s + montoMensual(i); }, 0);
    var gastoMensual = state.gastos.reduce(function(s, g){ return s + montoMensual(g); }, 0);
    var disponible = ingresoMensual - gastoMensual;
    var totalPendientes = state.pendientes.filter(function(p){ return !p.resuelto && p.tipo !== 'cobrar'; })
      .reduce(function(s, p){ return s + Number(p.saldoActual); }, 0);
    var totalMetas = state.metas.reduce(function(s, m){ return s + Number(m.montoActual); }, 0);
    var totalInversiones = state.inversiones.reduce(function(s, i){ return s + Number(i.montoActual); }, 0);
    var fondoObjetivo = Number(state.fondoEmergencia.montoObjetivo) || 0;
    var fondoActual = Number(state.fondoEmergencia.montoActual) || 0;
    var fondoPct = fondoObjetivo > 0 ? Math.min(100, fondoActual / fondoObjetivo * 100) : 0;
    return { ingresoMensual: ingresoMensual, gastoMensual: gastoMensual, disponible: disponible,
      totalPendientes: totalPendientes, totalMetas: totalMetas, totalInversiones: totalInversiones,
      fondoPct: fondoPct, fondoObjetivo: fondoObjetivo, fondoActual: fondoActual };
  }

  function evaluarCompra(nombre, monto){
    var r = resumen();
    var fondoCompleto = r.fondoObjetivo > 0 && r.fondoActual >= r.fondoObjetivo;
    var veredicto, color, detalle;
    if (r.disponible <= 0) {
      veredicto = 'Todavía no'; color = 'bad';
      detalle = 'Tus gastos fijos igualan o superan tus ingresos este mes — no hay margen libre para esto.';
    } else if (monto <= r.disponible * 0.3 && fondoCompleto) {
      veredicto = 'Adelante'; color = 'good';
      detalle = 'Tu fondo de emergencia está completo y esto usa ' + Math.round(monto / r.disponible * 100) + '% de tu disponible del mes.';
    } else if (monto <= r.disponible) {
      veredicto = 'Con cautela'; color = 'warn';
      detalle = fondoCompleto
        ? 'Cabe en tu disponible mensual (' + Math.round(monto / r.disponible * 100) + '%), pero es una porción grande — revisa si compite con otra meta activa.'
        : 'Cabe en tu disponible, pero tu fondo de emergencia va en ' + Math.round(r.fondoPct) + '% — esto retrasará completarlo.';
    } else {
      veredicto = 'Todavía no'; color = 'bad';
      var meses = Math.ceil(monto / r.disponible);
      detalle = 'Supera tu disponible mensual (' + fmt(r.disponible) + '). Ahorrando todo tu disponible, te tomaría ~' + meses + (meses === 1 ? ' mes' : ' meses') + '.';
    }
    return { veredicto: veredicto, color: color, detalle: detalle };
  }

  /* ---------- modal genérico ---------- */
  function openModal(title, fields, initial, onSave, opts){
    opts = opts || {};
    var overlay = document.getElementById('modal-overlay');
    var box = document.getElementById('modal-box');
    var html = '<h3>' + escapeHtml(title) + '</h3>';
    fields.forEach(function(f){
      var val = initial && initial[f.key] != null ? initial[f.key] : (f.type === 'number' ? '' : '');
      html += '<div class="field"><label for="f-' + f.key + '">' + escapeHtml(f.label) + '</label>';
      if (f.type === 'select') {
        html += '<select id="f-' + f.key + '">';
        f.options.forEach(function(o){
          html += '<option value="' + escapeHtml(o.value) + '"' + (o.value === val ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
        });
        html += '</select>';
      } else if (f.type === 'textarea') {
        html += '<textarea id="f-' + f.key + '" rows="8" placeholder="' + escapeHtml(f.placeholder || '') + '">' + escapeHtml(val) + '</textarea>';
      } else {
        html += '<input id="f-' + f.key + '" type="' + f.type + '"' +
          (f.step ? ' step="' + f.step + '"' : '') + (f.min != null ? ' min="' + f.min + '"' : '') +
          ' value="' + escapeHtml(val) + '" placeholder="' + escapeHtml(f.placeholder || '') + '">';
      }
      html += '</div>';
    });
    html += '<div class="modal-actions"><button class="cancel" id="modal-cancel">Cancelar</button><button class="save" id="modal-save">' + (opts.saveLabel || 'Guardar') + '</button></div>';
    box.innerHTML = html;
    overlay.classList.remove('hidden');
    document.getElementById('modal-cancel').onclick = closeModal;
    overlay.onclick = function(e){ if (e.target === overlay) closeModal(); };
    document.getElementById('modal-save').onclick = function(){
      var out = {};
      var ok = true;
      fields.forEach(function(f){
        var el = document.getElementById('f-' + f.key);
        var v = el.value;
        if (f.type === 'number') {
          v = parseFloat(v);
          if (isNaN(v) || (f.min != null && v < f.min)) ok = false;
        } else if (f.required !== false && !v) {
          ok = false;
        }
        out[f.key] = v;
      });
      if (!ok) { toast('Revisa los campos — falta algo.'); return; }
      closeModal();
      onSave(out);
    };
    // En pantallas táctiles NO enfocamos solos: el teclado solo aparece si tú tocas un campo.
    var esTactil = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (!esTactil) {
      setTimeout(function(){ var first = box.querySelector('input,select'); if (first) first.focus(); }, 30);
    }
  }
  function closeModal(){ document.getElementById('modal-overlay').classList.add('hidden'); }

  /* ---------- historial mensual ---------- */
  function actualizarHistorialMensual(){
    var mes = hoyISO().slice(0, 7);
    var r = resumen();
    var ahorro = 0;
    (state.fondoEmergencia.aportes || []).forEach(function(a){
      if (a.fecha && a.fecha.slice(0, 7) === mes) ahorro += Number(a.monto) || 0;
    });
    state.metas.forEach(function(m){
      (m.aportes || []).forEach(function(a){
        if (a.fecha && a.fecha.slice(0, 7) === mes) ahorro += Number(a.monto) || 0;
      });
    });
    state.historialMensual[mes] = { ingreso: r.ingresoMensual, gasto: r.gastoMensual, ahorro: ahorro };
  }

  /* ---------- guardado ---------- */
  function persist(){
    state.ultimaActualizacion = new Date().toISOString();
    actualizarHistorialMensual();
    renderAll();
    RaccoonStore.save(state);
  }

  /* Llega estado nuevo: al arrancar (copia local), o desde la nube (otro equipo). */
  function applyIncomingState(incoming, meta){
    if (!incoming || typeof incoming !== 'object') return;
    var localT = Date.parse(state.ultimaActualizacion || '') || 0;
    var remoteT = Date.parse(incoming.ultimaActualizacion || '') || 0;
    // si ya cargamos algo y lo que llega es MÁS VIEJO que nuestra edición local, lo ignoramos
    if (dataLoaded && remoteT && remoteT < localT) return;
    state = Object.assign(estadoVacio(), incoming);
    normalizarEstado();
    dataLoaded = true;
    actualizarHistorialMensual();
    renderAll();
    if (meta && meta.source === 'seed') RaccoonStore.save(state);
  }

  /* ---------- acciones: ingresos y gastos ---------- */
  function nuevoIngreso(){
    openModal('Nuevo ingreso', [
      { key: 'nombre', label: 'Nombre', type: 'text', placeholder: 'Sueldo, freelance…' },
      { key: 'monto', label: 'Monto', type: 'number', step: '1', min: 0 },
      { key: 'frecuencia', label: 'Frecuencia', type: 'select', options: [
        { value: 'mensual', label: 'Mensual' }, { value: 'quincenal', label: 'Quincenal' }] }
    ], { frecuencia: 'mensual' }, function(v){
      state.ingresos.push({ id: uid(), nombre: v.nombre.trim().toUpperCase(), monto: v.monto, frecuencia: v.frecuencia });
      persist(); toast('Ingreso agregado.');
    });
  }
  function editarIngreso(id){
    var it = state.ingresos.find(function(x){ return x.id === id; });
    if (!it) return;
    openModal('Editar ingreso', [
      { key: 'nombre', label: 'Nombre', type: 'text' },
      { key: 'monto', label: 'Monto', type: 'number', step: '1', min: 0 },
      { key: 'frecuencia', label: 'Frecuencia', type: 'select', options: [
        { value: 'mensual', label: 'Mensual' }, { value: 'quincenal', label: 'Quincenal' }] }
    ], it, function(v){
      it.nombre = v.nombre.trim().toUpperCase(); it.monto = v.monto; it.frecuencia = v.frecuencia;
      persist(); toast('Ingreso actualizado.');
    });
  }
  function eliminarIngreso(id){
    state.ingresos = state.ingresos.filter(function(x){ return x.id !== id; });
    persist(); toast('Ingreso eliminado.');
  }

  function nuevoGasto(){
    openModal('Nuevo gasto', [
      { key: 'nombre', label: 'Nombre', type: 'text', placeholder: 'Renta, comida…' },
      { key: 'categoria', label: 'Categoría', type: 'text', placeholder: 'Vivienda, comida…' },
      { key: 'monto', label: 'Monto', type: 'number', step: '1', min: 0 },
      { key: 'frecuencia', label: 'Frecuencia', type: 'select', options: [
        { value: 'mensual', label: 'Mensual' }, { value: 'quincenal', label: 'Quincenal' }] }
    ], { frecuencia: 'mensual' }, function(v){
      state.gastos.push({ id: uid(), nombre: v.nombre.trim().toUpperCase(), categoria: v.categoria.trim().toUpperCase() || 'OTROS', monto: v.monto, frecuencia: v.frecuencia });
      persist(); toast('Gasto agregado.');
    });
  }
  function editarGasto(id){
    var it = state.gastos.find(function(x){ return x.id === id; });
    if (!it) return;
    openModal('Editar gasto', [
      { key: 'nombre', label: 'Nombre', type: 'text' },
      { key: 'categoria', label: 'Categoría', type: 'text' },
      { key: 'monto', label: 'Monto', type: 'number', step: '1', min: 0 },
      { key: 'frecuencia', label: 'Frecuencia', type: 'select', options: [
        { value: 'mensual', label: 'Mensual' }, { value: 'quincenal', label: 'Quincenal' }] }
    ], it, function(v){
      it.nombre = v.nombre.trim().toUpperCase(); it.categoria = v.categoria.trim().toUpperCase() || 'OTROS';
      it.monto = v.monto; it.frecuencia = v.frecuencia;
      persist(); toast('Gasto actualizado.');
    });
  }
  function eliminarGasto(id){
    state.gastos = state.gastos.filter(function(x){ return x.id !== id; });
    persist(); toast('Gasto eliminado.');
  }

  /* ---------- acciones: pendientes ---------- */
  function nuevoPendiente(tipoDefault){
    openModal(tipoDefault === 'cobrar' ? 'Nueva deuda por cobrar' : 'Nueva deuda por pagar', [
      { key: 'tipo', label: 'Tipo', type: 'select', options: [
        { value: 'pagar', label: 'Por pagar (yo debo)' }, { value: 'cobrar', label: 'Por cobrar (me deben)' }] },
      { key: 'nombre', label: 'Nombre', type: 'text', placeholder: 'Deuda, compra a meses…' },
      { key: 'quien', label: 'A quién / de quién', type: 'text', placeholder: 'Nombre de la persona o negocio', required: false },
      { key: 'motivo', label: 'Motivo (opcional)', type: 'text', placeholder: 'Préstamo, compra a meses…', required: false },
      { key: 'saldoActual', label: 'Monto', type: 'number', step: '1', min: 0 },
      { key: 'fechaLimite', label: 'Fecha límite (opcional)', type: 'date', required: false }
    ], { tipo: tipoDefault === 'cobrar' ? 'cobrar' : 'pagar' }, function(v){
      state.pendientes.push({ id: uid(), nombre: v.nombre.trim().toUpperCase(), tipo: v.tipo,
        quien: (v.quien || '').trim(), motivo: (v.motivo || '').trim(), montoOriginal: v.saldoActual,
        saldoActual: v.saldoActual, fechaLimite: v.fechaLimite || '', resuelto: false, fechaResuelto: '', pagos: [] });
      persist(); toast('Deuda agregada.');
    });
  }
  function aportarPendiente(id){
    var it = state.pendientes.find(function(x){ return x.id === id; });
    if (!it) return;
    var esCobrar = it.tipo === 'cobrar';
    var yaResuelto = !!it.resuelto;
    openModal('Aportar a "' + it.nombre + '"', [
      { key: 'monto', label: esCobrar ? 'Monto que te pagaron' : 'Monto del aporte', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      it.saldoActual = Math.max(0, Number(it.saldoActual) - v.monto);
      if (!Array.isArray(it.pagos)) it.pagos = [];
      it.pagos.push({ fecha: hoyISO(), monto: v.monto });
      if (it.saldoActual === 0) { it.resuelto = true; it.fechaResuelto = hoyISO(); }
      persist();
      if (it.resuelto && !yaResuelto) celebrate(esCobrar ? '¡Cobrado por completo!' : '¡Deuda saldada!');
      else toast('Aporte registrado.');
    }, { saveLabel: 'Aportar' });
  }
  function editarPendiente(id){
    var it = state.pendientes.find(function(x){ return x.id === id; });
    if (!it) return;
    openModal('Editar deuda', [
      { key: 'tipo', label: 'Tipo', type: 'select', options: [
        { value: 'pagar', label: 'Por pagar (yo debo)' }, { value: 'cobrar', label: 'Por cobrar (me deben)' }] },
      { key: 'nombre', label: 'Nombre', type: 'text' },
      { key: 'quien', label: 'A quién / de quién', type: 'text', required: false },
      { key: 'motivo', label: 'Motivo (opcional)', type: 'text', required: false },
      { key: 'montoOriginal', label: 'Monto original', type: 'number', step: '1', min: 0 },
      { key: 'saldoActual', label: 'Saldo actual (lo que falta)', type: 'number', step: '1', min: 0 },
      { key: 'fechaLimite', label: 'Fecha límite (opcional)', type: 'date', required: false }
    ], { tipo: it.tipo, nombre: it.nombre, quien: it.quien, motivo: it.motivo,
         montoOriginal: it.montoOriginal, saldoActual: it.saldoActual, fechaLimite: it.fechaLimite || '' }, function(v){
      it.tipo = v.tipo;
      it.nombre = v.nombre.trim().toUpperCase();
      it.quien = (v.quien || '').trim();
      it.motivo = (v.motivo || '').trim();
      it.montoOriginal = v.montoOriginal;
      it.saldoActual = v.saldoActual;
      it.fechaLimite = v.fechaLimite || '';
      it.resuelto = Number(it.saldoActual) <= 0;
      it.fechaResuelto = it.resuelto ? (it.fechaResuelto || hoyISO()) : '';
      persist(); toast('Deuda actualizada.');
    });
  }
  function historialPendiente(id){
    var it = state.pendientes.find(function(x){ return x.id === id; });
    if (!it) return;
    var pagos = (it.pagos || []).slice().sort(function(a, b){ return a.fecha < b.fecha ? 1 : -1; });
    var body;
    if (!pagos.length) {
      body = '<div class="empty-state">Aún no hay ' + (it.tipo === 'cobrar' ? 'pagos recibidos' : 'pagos hechos') + '.</div>';
    } else {
      var total = pagos.reduce(function(s, p){ return s + Number(p.monto); }, 0);
      body = '<div class="hist-list">' + pagos.map(function(p){
        return '<div class="hist-row"><span>' + escapeHtml(fechaLarga(p.fecha)) + '</span><span class="num">' + fmt(p.monto) + '</span></div>';
      }).join('') + '</div><div class="hist-total"><span>Total</span><span class="num">' + fmt(total) + '</span></div>';
    }
    openInfoModal((it.tipo === 'cobrar' ? 'Pagos recibidos · ' : 'Pagos hechos · ') + it.nombre, body);
  }
  function eliminarPendiente(id){
    state.pendientes = state.pendientes.filter(function(x){ return x.id !== id; });
    persist(); toast('Pendiente eliminado.');
  }

  /* ---------- acciones: metas, fondo, inversiones ---------- */
  function nuevaMeta(){
    openModal('Nueva meta de ahorro', [
      { key: 'nombre', label: 'Nombre', type: 'text', placeholder: 'Pasaporte, telescopio…' },
      { key: 'montoObjetivo', label: 'Monto objetivo', type: 'number', step: '1', min: 1 },
      { key: 'fechaObjetivo', label: 'Fecha objetivo (opcional)', type: 'date', required: false }
    ], {}, function(v){
      state.metas.push({ id: uid(), nombre: v.nombre.trim().toUpperCase(), montoObjetivo: v.montoObjetivo,
        montoActual: 0, completada: false, aportes: [], fechaObjetivo: v.fechaObjetivo || '' });
      persist(); toast('Meta creada.');
    });
  }
  function aportarMeta(id){
    var it = state.metas.find(function(x){ return x.id === id; });
    if (!it) return;
    var yaEstaba = !!it.completada;
    openModal('Aportar a "' + it.nombre + '"', [
      { key: 'monto', label: 'Monto del aporte', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      it.montoActual = Number(it.montoActual) + v.monto;
      if (!Array.isArray(it.aportes)) it.aportes = [];
      it.aportes.push({ fecha: hoyISO(), monto: v.monto });
      if (it.montoActual >= it.montoObjetivo) it.completada = true;
      persist();
      if (it.completada && !yaEstaba) celebrate('¡Meta completada! ' + it.nombre);
      else toast('Aporte registrado.');
    }, { saveLabel: 'Aportar' });
  }
  function editarMeta(id){
    var it = state.metas.find(function(x){ return x.id === id; });
    if (!it) return;
    openModal('Editar meta', [
      { key: 'nombre', label: 'Nombre', type: 'text' },
      { key: 'montoObjetivo', label: 'Monto objetivo', type: 'number', step: '1', min: 1 },
      { key: 'montoActual', label: 'Monto actual (ahorrado)', type: 'number', step: '1', min: 0 },
      { key: 'fechaObjetivo', label: 'Fecha objetivo (opcional)', type: 'date', required: false }
    ], { nombre: it.nombre, montoObjetivo: it.montoObjetivo, montoActual: it.montoActual, fechaObjetivo: it.fechaObjetivo || '' }, function(v){
      it.nombre = v.nombre.trim().toUpperCase();
      it.montoObjetivo = v.montoObjetivo;
      it.montoActual = v.montoActual;
      it.fechaObjetivo = v.fechaObjetivo || '';
      it.completada = it.montoObjetivo > 0 && it.montoActual >= it.montoObjetivo;
      persist(); toast('Meta actualizada.');
    });
  }
  function historialMeta(id){
    var it = state.metas.find(function(x){ return x.id === id; });
    if (!it) return;
    openInfoModal('Aportes · ' + it.nombre, listaMovsHtml(it.aportes));
  }
  function eliminarMeta(id){
    state.metas = state.metas.filter(function(x){ return x.id !== id; });
    persist(); toast('Meta eliminada.');
  }

  /* lista simple de {fecha, monto} para los modales de historial */
  function listaMovsHtml(items){
    var arr = (items || []).slice().sort(function(a, b){ return a.fecha < b.fecha ? 1 : -1; });
    if (!arr.length) return '<div class="empty-state">Aún no hay aportes.</div>';
    var total = arr.reduce(function(s, p){ return s + Number(p.monto); }, 0);
    return '<div class="hist-list">' + arr.map(function(p){
      return '<div class="hist-row"><span>' + escapeHtml(fechaLarga(p.fecha)) + '</span><span class="num">' + fmt(p.monto) + '</span></div>';
    }).join('') + '</div><div class="hist-total"><span>Total</span><span class="num">' + fmt(total) + '</span></div>';
  }

  function editarFondoSeguridad(){
    openModal('Editar fondo de seguridad', [
      { key: 'montoObjetivo', label: 'Monto objetivo', type: 'number', step: '1', min: 0 },
      { key: 'montoActual', label: 'Monto actual', type: 'number', step: '1', min: 0 },
      { key: 'fechaObjetivo', label: 'Fecha objetivo (opcional)', type: 'date', required: false }
    ], { montoObjetivo: state.fondoEmergencia.montoObjetivo, montoActual: state.fondoEmergencia.montoActual, fechaObjetivo: state.fondoEmergencia.fechaObjetivo || '' }, function(v){
      state.fondoEmergencia.montoObjetivo = v.montoObjetivo;
      state.fondoEmergencia.montoActual = v.montoActual;
      state.fondoEmergencia.fechaObjetivo = v.fechaObjetivo || '';
      persist(); toast('Fondo de seguridad actualizado.');
    });
  }

  /* ---------- acciones: cuenta bancaria (apartado) ---------- */
  function ajustarApartado(){
    openModal('Ajustar apartado', [
      { key: 'monto', label: 'Total actual en tu apartado', type: 'number', step: '1', min: 0 }
    ], { monto: state.cuentaBancaria.apartado }, function(v){
      state.cuentaBancaria.apartado = v.monto;
      persist(); toast('Apartado actualizado.');
    }, { saveLabel: 'Actualizar' });
  }
  function retirarApartado(){
    openModal('Retirar del apartado', [
      { key: 'monto', label: 'Monto a retirar', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      var disponible = Number(state.cuentaBancaria.apartado);
      var retirado = Math.min(v.monto, disponible);
      state.cuentaBancaria.apartado = Math.round((disponible - retirado) * 100) / 100;
      persist();
      toast(retirado < v.monto ? ('Solo había ' + fmt(disponible) + ' — se retiró eso.') : 'Retiro registrado.');
    }, { saveLabel: 'Retirar' });
  }
  function aportarFondo(){
    var yaCompleto = state.fondoEmergencia.montoObjetivo > 0 && Number(state.fondoEmergencia.montoActual) >= state.fondoEmergencia.montoObjetivo;
    openModal('Aportar al fondo de seguridad', [
      { key: 'monto', label: 'Monto del aporte', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      state.fondoEmergencia.montoActual = Number(state.fondoEmergencia.montoActual) + v.monto;
      state.fondoEmergencia.aportes.push({ fecha: hoyISO(), monto: v.monto });
      var completoAhora = state.fondoEmergencia.montoObjetivo > 0 && state.fondoEmergencia.montoActual >= state.fondoEmergencia.montoObjetivo;
      persist();
      if (completoAhora && !yaCompleto) celebrate('¡Fondo de seguridad completo!');
      else toast('Aporte registrado.');
    }, { saveLabel: 'Aportar' });
  }
  function retirarFondo(){
    openModal('Retirar del fondo de seguridad', [
      { key: 'monto', label: 'Monto a retirar', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      var disponible = Number(state.fondoEmergencia.montoActual);
      var retirado = Math.min(v.monto, disponible);
      state.fondoEmergencia.montoActual = Math.round((disponible - retirado) * 100) / 100;
      persist();
      toast(retirado < v.monto ? ('Solo había ' + fmt(disponible) + ' — se retiró eso.') : 'Retiro registrado.');
    }, { saveLabel: 'Retirar' });
  }

  function nuevoFondoAdicional(){
    openModal('Nuevo fondo', [
      { key: 'nombre', label: 'Nombre', type: 'text', placeholder: 'Colchón médico, fondo del carro…' },
      { key: 'montoActual', label: 'Monto inicial', type: 'number', step: '1', min: 0 },
      { key: 'montoObjetivo', label: 'Monto objetivo (opcional, 0 = sin objetivo)', type: 'number', step: '1', min: 0 },
      { key: 'fechaObjetivo', label: 'Fecha objetivo (opcional)', type: 'date', required: false }
    ], { montoActual: 0, montoObjetivo: 0 }, function(v){
      state.fondosAdicionales.push({ id: uid(), nombre: v.nombre.trim(), montoActual: v.montoActual, montoObjetivo: v.montoObjetivo, aportes: [], fechaObjetivo: v.fechaObjetivo || '' });
      persist(); toast('Fondo agregado.');
    });
  }
  function aportarFondoAdicional(id){
    var f = state.fondosAdicionales.find(function(x){ return x.id === id; });
    if (!f) return;
    var yaCompleto = f.montoObjetivo > 0 && Number(f.montoActual) >= f.montoObjetivo;
    openModal('Aportar a "' + f.nombre + '"', [
      { key: 'monto', label: 'Monto del aporte', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      f.montoActual = Math.round((Number(f.montoActual) + v.monto) * 100) / 100;
      f.aportes.push({ fecha: hoyISO(), monto: v.monto });
      var completoAhora = f.montoObjetivo > 0 && f.montoActual >= f.montoObjetivo;
      persist();
      if (completoAhora && !yaCompleto) celebrate('¡Fondo completo! ' + f.nombre);
      else toast('Aporte registrado.');
    }, { saveLabel: 'Aportar' });
  }
  function historialFondoAdicional(id){
    var f = state.fondosAdicionales.find(function(x){ return x.id === id; });
    if (!f) return;
    openInfoModal('Aportes · ' + f.nombre, listaMovsHtml(f.aportes));
  }
  function retirarFondoAdicional(id){
    var f = state.fondosAdicionales.find(function(x){ return x.id === id; });
    if (!f) return;
    openModal('Retirar de "' + f.nombre + '"', [
      { key: 'monto', label: 'Monto a retirar', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      var disponible = Number(f.montoActual);
      var retirado = Math.min(v.monto, disponible);
      f.montoActual = Math.round((disponible - retirado) * 100) / 100;
      persist();
      toast(retirado < v.monto ? ('Solo había ' + fmt(disponible) + ' — se retiró eso.') : 'Retiro registrado.');
    }, { saveLabel: 'Retirar' });
  }
  function editarFondoAdicional(id){
    var f = state.fondosAdicionales.find(function(x){ return x.id === id; });
    if (!f) return;
    openModal('Editar fondo', [
      { key: 'nombre', label: 'Nombre', type: 'text' },
      { key: 'montoActual', label: 'Monto actual', type: 'number', step: '1', min: 0 },
      { key: 'montoObjetivo', label: 'Monto objetivo (0 = sin objetivo)', type: 'number', step: '1', min: 0 },
      { key: 'fechaObjetivo', label: 'Fecha objetivo (opcional)', type: 'date', required: false }
    ], { nombre: f.nombre, montoActual: f.montoActual, montoObjetivo: f.montoObjetivo, fechaObjetivo: f.fechaObjetivo || '' }, function(v){
      f.nombre = v.nombre.trim();
      f.montoActual = v.montoActual;
      f.montoObjetivo = v.montoObjetivo;
      f.fechaObjetivo = v.fechaObjetivo || '';
      persist(); toast('Fondo actualizado.');
    });
  }
  function eliminarFondoAdicional(id){
    state.fondosAdicionales = state.fondosAdicionales.filter(function(x){ return x.id !== id; });
    persist(); toast('Fondo eliminado.');
  }

  function nuevaInversion(){
    openModal('Nueva inversión', [
      { key: 'nombre', label: 'Nombre', type: 'text', placeholder: 'CETES, fondo indexado…' },
      { key: 'montoActual', label: 'Monto actual', type: 'number', step: '1', min: 0 },
      { key: 'tasaInteres', label: 'Tasa de interés anual (%)', type: 'number', step: '0.01', min: 0 },
      { key: 'fechaObjetivo', label: 'Fecha objetivo (opcional)', type: 'date', required: false }
    ], { montoActual: 0, tasaInteres: 0 }, function(v){
      state.inversiones.push({ id: uid(), nombre: v.nombre.trim().toUpperCase(), montoActual: v.montoActual,
        tasaInteres: v.tasaInteres, reinversiones: [], fechaObjetivo: v.fechaObjetivo || '' });
      persist(); toast('Inversión agregada.');
    });
  }
  function editarInversion(id){
    var it = state.inversiones.find(function(x){ return x.id === id; });
    if (!it) return;
    openModal('Editar inversión', [
      { key: 'nombre', label: 'Nombre', type: 'text' },
      { key: 'montoActual', label: 'Monto actual', type: 'number', step: '1', min: 0 },
      { key: 'tasaInteres', label: 'Tasa de interés anual (%)', type: 'number', step: '0.01', min: 0 },
      { key: 'fechaObjetivo', label: 'Fecha objetivo (opcional)', type: 'date', required: false }
    ], { nombre: it.nombre, montoActual: it.montoActual, tasaInteres: it.tasaInteres || 0, fechaObjetivo: it.fechaObjetivo || '' }, function(v){
      it.nombre = v.nombre.trim().toUpperCase();
      it.montoActual = v.montoActual;
      it.tasaInteres = v.tasaInteres;
      it.fechaObjetivo = v.fechaObjetivo || '';
      persist(); toast('Inversión actualizada.');
    });
  }
  function reinvertirInversion(id){
    var it = state.inversiones.find(function(x){ return x.id === id; });
    if (!it) return;
    var tasa = Number(it.tasaInteres) || 0;
    var rendimiento = Math.round(Number(it.montoActual) * (tasa / 100) * 100) / 100;
    if (rendimiento <= 0) return;
    openModal('Reinvertir en "' + it.nombre + '"', [
      { key: 'monto', label: 'Monto a reinvertir', type: 'number', step: '1', min: 0.01 }
    ], { monto: rendimiento }, function(v){
      it.montoActual = Math.round((Number(it.montoActual) + v.monto) * 100) / 100;
      if (!Array.isArray(it.reinversiones)) it.reinversiones = [];
      it.reinversiones.push({ fecha: hoyISO(), monto: v.monto });
      persist(); toast('Reinversión registrada — nuevo monto: ' + fmt(it.montoActual));
    }, { saveLabel: 'Reinvertir' });
  }
  function eliminarInversion(id){
    state.inversiones = state.inversiones.filter(function(x){ return x.id !== id; });
    persist(); toast('Inversión eliminada.');
  }
  function historialInversion(id){
    var it = state.inversiones.find(function(x){ return x.id === id; });
    if (!it) return;
    openInfoModal('Reinversiones · ' + it.nombre, listaMovsHtml(it.reinversiones));
  }

  /* ---------- acciones: registro de gastos (movimientos) ---------- */
  function camposMovimiento(){
    return [
      { key: 'monto', label: 'Monto', type: 'number', step: '1', min: 0.01 },
      { key: 'categoria', label: 'Categoría', type: 'select', options: state.categorias.map(function(c){ return { value: c, label: c }; }) },
      { key: 'motivo', label: 'Motivo', type: 'text', placeholder: 'En qué lo gastaste', required: false },
      { key: 'fecha', label: 'Fecha', type: 'date' }
    ];
  }
  function nuevoMovimiento(){
    openModal('Registrar gasto', camposMovimiento(),
      { fecha: hoyISO(), categoria: state.categorias[0] }, function(v){
        state.movimientos.push({ id: uid(), fecha: v.fecha || hoyISO(), monto: v.monto,
          categoria: v.categoria, motivo: (v.motivo || '').trim() });
        persist(); toast('Gasto registrado.');
      }, { saveLabel: 'Guardar' });
  }
  function editarMovimiento(id){
    var g = state.movimientos.find(function(x){ return x.id === id; });
    if (!g) return;
    openModal('Editar gasto', camposMovimiento(),
      { monto: g.monto, categoria: g.categoria, motivo: g.motivo, fecha: g.fecha }, function(v){
        g.monto = v.monto; g.categoria = v.categoria;
        g.motivo = (v.motivo || '').trim(); g.fecha = v.fecha || g.fecha;
        persist(); toast('Gasto actualizado.');
      });
  }
  function eliminarMovimiento(id){
    state.movimientos = state.movimientos.filter(function(x){ return x.id !== id; });
    persist(); toast('Gasto eliminado.');
  }
  function gestionarCategorias(){
    openModal('Categorías', [
      { key: 'lista', label: 'Una categoría por renglón', type: 'textarea', required: false }
    ], { lista: state.categorias.join('\n') }, function(v){
      var arr = String(v.lista || '').split('\n').map(function(s){ return s.trim(); }).filter(Boolean);
      // sin duplicados, respetando el orden
      var vistos = {}, limpio = [];
      arr.forEach(function(c){ var k = c.toLowerCase(); if (!vistos[k]) { vistos[k] = 1; limpio.push(c); } });
      if (!limpio.length) limpio = CATEGORIAS_DEFAULT.slice();
      state.categorias = limpio;
      persist(); toast('Categorías actualizadas.');
    });
  }

  /* lápiz para editar un elemento (meta, fondo, deuda, inversión) junto a su nombre */
  function h4Pencil(act, id){
    return ' <button class="h4-edit" data-act="' + act + '"' + (id ? ' data-id="' + id + '"' : '') +
      ' title="Editar" aria-label="Editar">' + PENCIL_SVG + '</button>';
  }

  /* ---------- exportar CSV (todo, por bloques) ---------- */
  function exportCSV(){
    function esc(s){ s = String(s == null ? '' : s); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
    function bloque(titulo, headers, rows){
      var out = titulo + '\n' + headers.join(',') + '\n';
      rows.forEach(function(r){ out += r.map(esc).join(',') + '\n'; });
      return out + '\n';
    }
    var csv = '﻿';
    csv += bloque('GASTOS REGISTRADOS', ['fecha', 'categoria', 'motivo', 'monto'],
      state.movimientos.slice().sort(function(a, b){ return a.fecha < b.fecha ? 1 : -1; }).map(function(g){ return [g.fecha, g.categoria, g.motivo, g.monto]; }));
    csv += bloque('INGRESOS', ['nombre', 'monto', 'frecuencia'],
      state.ingresos.map(function(i){ return [i.nombre, i.monto, i.frecuencia]; }));
    csv += bloque('GASTOS FIJOS', ['nombre', 'categoria', 'monto', 'frecuencia'],
      state.gastos.map(function(g){ return [g.nombre, g.categoria, g.monto, g.frecuencia]; }));
    csv += bloque('DEUDAS', ['tipo', 'nombre', 'quien', 'motivo', 'monto original', 'saldo', 'fecha limite', 'resuelto'],
      state.pendientes.map(function(p){ return [p.tipo, p.nombre, p.quien, p.motivo, p.montoOriginal, p.saldoActual, p.fechaLimite, p.resuelto ? 'sí' : 'no']; }));
    csv += bloque('METAS', ['nombre', 'objetivo', 'actual', 'completada', 'fecha objetivo'],
      state.metas.map(function(m){ return [m.nombre, m.montoObjetivo, m.montoActual, m.completada ? 'sí' : 'no', m.fechaObjetivo || '']; }));
    var fondos = [['Fondo de seguridad', state.fondoEmergencia.montoObjetivo, state.fondoEmergencia.montoActual, state.fondoEmergencia.fechaObjetivo || '']]
      .concat(state.fondosAdicionales.map(function(f){ return [f.nombre, f.montoObjetivo, f.montoActual, f.fechaObjetivo || '']; }));
    csv += bloque('FONDOS', ['nombre', 'objetivo', 'actual', 'fecha objetivo'], fondos);
    csv += bloque('INVERSIONES', ['nombre', 'monto', 'tasa anual %', 'fecha objetivo'],
      state.inversiones.map(function(i){ return [i.nombre, i.montoActual, i.tasaInteres, i.fechaObjetivo || '']; }));

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'raccoon-finances-' + hoyISO() + '_' + ahoraHM() + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    toast('CSV exportado.');
  }

  /* ---------- acciones: decisión de compra ---------- */
  function evaluarYRegistrar(nombre, monto){
    var r = evaluarCompra(nombre, monto);
    state.decisiones.unshift({ id: uid(), fecha: hoyISO(), nombre: nombre.trim().toUpperCase(), monto: monto,
      veredicto: r.veredicto, color: r.color, detalle: r.detalle });
    if (state.decisiones.length > 30) state.decisiones.length = 30;
    persist();
  }
  function eliminarDecision(id){
    state.decisiones = state.decisiones.filter(function(x){ return x.id !== id; });
    persist();
  }

  /* ---------- render: franja de resumen y pie ---------- */
  /* datos de la "Cuenta bancaria" (apartado) — compartidos por la franja de arriba y la pestaña Metas */
  function calcCuenta(){
    var cb = state.cuentaBancaria || {};
    var apartado = Number(cb.apartado) || 0;
    var dedicadoAMetas = state.metas.reduce(function(s, m){ return s + (Number(m.montoActual) || 0); }, 0);
    var dedicadoAFondoSeguridad = Number(state.fondoEmergencia.montoActual) || 0;
    var dedicadoAFondosAdicionales = state.fondosAdicionales.reduce(function(s, f){ return s + (Number(f.montoActual) || 0); }, 0);
    var dedicadoAFondos = dedicadoAFondoSeguridad + dedicadoAFondosAdicionales;
    var disponibleReal = apartado - (dedicadoAMetas + dedicadoAFondos);
    return {
      apartado: apartado, dedicadoAMetas: dedicadoAMetas,
      dedicadoAFondoSeguridad: dedicadoAFondoSeguridad, dedicadoAFondosAdicionales: dedicadoAFondosAdicionales,
      dedicadoAFondos: dedicadoAFondos, disponibleReal: disponibleReal
    };
  }

  function renderStatStrip(){
    var c = calcCuenta();
    var html = '';
    html += '<div class="stat-tile tile-apartado"><div class="label">Apartado</div><div class="value num">' + fmt(c.apartado) + '</div></div>';
    html += '<div class="stat-tile tile-disponible"><div class="label">Disponible real</div><div class="value num">' + fmt(c.disponibleReal) + '</div><div class="sub">apartado menos metas y fondos</div></div>';
    document.getElementById('stat-strip').innerHTML = html;
  }
  function renderFooter(){
    var when = state.ultimaActualizacion
      ? new Date(state.ultimaActualizacion).toLocaleString('es-MX', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'aún no guardado';
    document.getElementById('foot').textContent = 'Última actualización: ' + when;
  }
  function renderTabs(){
    var btns = document.querySelectorAll('#tabs button');
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle('active', btns[i].dataset.tab === activeTab);
    var views = document.querySelectorAll('section.view');
    for (var j = 0; j < views.length; j++) views[j].classList.toggle('active', views[j].id === 'view-' + activeTab);
    var fab = document.getElementById('fab-gasto');
    if (fab) fab.classList.toggle('hidden', activeTab !== 'resumen');
  }
  /* ---------- render: resumen ---------- */
  function ringSvg(pct, color){
    pct = Math.max(0, Math.min(100, pct));
    if (!color) color = pctColor(pct);
    var r = 46, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return '<svg width="104" height="104" viewBox="0 0 104 104">' +
      '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="10"></circle>' +
      '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="10" ' +
      'stroke-linecap="round" stroke-dasharray="' + c + '" stroke-dashoffset="' + off + '"></circle></svg>';
  }
  function renderResumen(){
    var r = resumen();
    var out = '';

    if (!state.ingresos.length && !state.gastos.length) {
      out += '<div class="card"><div class="empty-state">Empieza por registrar tus ingresos y gastos fijos en la pestaña "Ingresos y gastos" — de ahí sale todo lo demás.</div></div>';
    }

    // barra de avance: roja mientras progresa, verde al completarse
    function barFill(pct){
      pct = Math.max(0, Math.min(100, pct));
      return 'width:' + pct + '%;background:' + pctColor(pct);
    }

    // ---- Deudas: barras de avance porcentual ----
    function pctSaldado(p){
      var orig = Number(p.montoOriginal) || Number(p.saldoActual) || 1;
      return Math.max(0, Math.min(100, (1 - Number(p.saldoActual) / orig) * 100));
    }
    function barraDeuda(p, marcaAtraso){
      var pct = pctSaldado(p);
      var overdue = marcaAtraso && p.fechaLimite && p.fechaLimite < hoyISO();
      return '<div class="bar-row"><span class="bar-label">' + escapeHtml(p.nombre) + '</span>' +
        '<span class="bar-track"><span class="bar-fill" style="' + barFill(pct) + '"></span></span>' +
        '<span class="bar-value num"' + (overdue ? ' style="color:var(--warn)"' : '') + '>' + Math.round(pct) + '%</span></div>';
    }
    var deudasActivas = state.pendientes.filter(function(p){ return !p.resuelto && p.tipo !== 'cobrar'; })
      .sort(function(a, b){ return (a.fechaLimite || '9999') < (b.fechaLimite || '9999') ? -1 : 1; });
    var cobrosActivos = state.pendientes.filter(function(p){ return !p.resuelto && p.tipo === 'cobrar'; });
    var totalDeuda = deudasActivas.reduce(function(s, p){ return s + Number(p.saldoActual); }, 0);
    out += '<div class="card"><div class="card-head"><h3>Deudas</h3>' + (deudasActivas.length ? '<span class="meta num">' + fmt(totalDeuda) + ' por pagar</span>' : '') + '</div>';
    if (!deudasActivas.length && !cobrosActivos.length) {
      out += '<div class="empty-state">No tienes deudas activas. 🎉</div>';
    } else {
      if (deudasActivas.length) {
        out += '<div class="group-label">Por pagar · cuánto llevas pagado</div>';
        deudasActivas.forEach(function(p){ out += barraDeuda(p, true); });
      }
      if (cobrosActivos.length) {
        out += '<div class="group-label">Te deben · cuánto te han pagado</div>';
        cobrosActivos.forEach(function(p){ out += barraDeuda(p, false); });
      }
    }
    out += '</div>';

    // ---- Ahorros: TODAS las metas (completas incluidas), con barra de avance ----
    var metasFalta = state.metas.filter(function(m){ return !m.completada; })
      .reduce(function(s, m){ return s + Math.max(0, Number(m.montoObjetivo) - Number(m.montoActual)); }, 0);
    var metasOrden = state.metas.slice().sort(function(a, b){
      if (!!a.completada !== !!b.completada) return a.completada ? 1 : -1;
      var pa = a.montoObjetivo > 0 ? a.montoActual / a.montoObjetivo : 0;
      var pb = b.montoObjetivo > 0 ? b.montoActual / b.montoObjetivo : 0;
      return pb - pa;
    });
    out += '<div class="card"><div class="card-head"><h3>Ahorros</h3>' + (metasFalta > 0 ? '<span class="meta">falta <span class="num">' + fmt(metasFalta) + '</span></span>' : '') + '</div>';
    if (!metasOrden.length) { out += '<div class="empty-state">Aún no tienes metas de ahorro.</div>'; }
    else {
      metasOrden.forEach(function(m){
        var pct = m.montoObjetivo > 0 ? Math.min(100, m.montoActual / m.montoObjetivo * 100) : (m.completada ? 100 : 0);
        if (m.completada) pct = 100;
        out += '<div class="bar-row"><span class="bar-label">' + escapeHtml(m.nombre) + (m.completada ? ' ✓' : '') + '</span>' +
          '<span class="bar-track"><span class="bar-fill" style="' + barFill(pct) + '"></span></span>' +
          '<span class="bar-value num">' + Math.round(pct) + '%</span></div>';
      });
    }
    out += '</div>';
    var totalFondosAdicionales = state.fondosAdicionales.reduce(function(s, f){ return s + (Number(f.montoActual) || 0); }, 0);
    var totalFondosSeguridad = r.fondoActual + totalFondosAdicionales;
    out += '<div class="card"><div class="card-head"><h3>Fondos</h3>' + (totalFondosAdicionales > 0 ? '<span class="meta num">' + fmt(totalFondosSeguridad) + ' total</span>' : '') + '</div>';
    out += '<div class="goal-grid"><div class="goal-card' + (r.fondoObjetivo > 0 && r.fondoActual >= r.fondoObjetivo ? ' completada' : '') + '">' +
      '<h4>Fondo de seguridad</h4><div class="ring-wrap">' + ringSvg(r.fondoPct) + '<div class="ring-center">' + Math.round(r.fondoPct) + '%</div></div>' +
      '<div class="goal-amounts">' + fmt(r.fondoActual) + ' de ' + fmt(r.fondoObjetivo) + '</div>' +
      '</div></div>';
    if (totalFondosAdicionales > 0) {
      out += '<div class="mini-stats"><div class="stat-tile"><div class="label">En fondos adicionales</div><div class="value num">' + fmt(totalFondosAdicionales) + '</div><div class="sub">' + state.fondosAdicionales.length + (state.fondosAdicionales.length === 1 ? ' fondo' : ' fondos') + '</div></div></div>';
    }
    out += '</div>';
    var totalRendimiento = state.inversiones.reduce(function(s, i){ return s + Number(i.montoActual) * ((Number(i.tasaInteres) || 0) / 100); }, 0);
    out += '<div class="card"><div class="card-head"><h3>Inversión</h3></div>';
    if (!state.inversiones.length) { out += '<div class="empty-state">Sin inversiones registradas.</div>'; }
    else {
      out += '<div class="mini-stats">' +
        '<div class="stat-tile"><div class="label">Total invertido</div><div class="value num">' + fmt(r.totalInversiones) + '</div></div>' +
        '<div class="stat-tile good"><div class="label">Rendimiento anual est.</div><div class="value num">' + fmt(totalRendimiento) + '</div></div>' +
        '</div>';
    }
    out += '</div>';

    // ---- Este mes (al final del resumen) ----
    out += '<div class="card"><div class="card-head"><h3>Este mes</h3></div><div class="mini-stats">' +
      '<div class="stat-tile"><div class="label">Ingreso mensual</div><div class="value num">' + fmt(r.ingresoMensual) + '</div></div>' +
      '<div class="stat-tile"><div class="label">Gasto mensual</div><div class="value num">' + fmt(r.gastoMensual) + '</div></div>' +
      '<div class="stat-tile ' + (r.disponible >= 0 ? 'good' : 'warn') + '"><div class="label">Disponible</div><div class="value num">' + fmt(r.disponible) + '</div></div>' +
      '<div class="stat-tile"><div class="label">Fondo de seguridad</div><div class="value num">' + Math.round(r.fondoPct) + '%</div><div class="sub">' + (r.fondoObjetivo > 0 ? (fmt(r.fondoActual) + ' de ' + fmt(r.fondoObjetivo)) : 'sin objetivo aún') + '</div></div>' +
      '</div></div>';

    document.getElementById('view-resumen').innerHTML = out;
  }

  /* ---------- render: ingresos y gastos ---------- */
  function renderFlujo(){
    var totalIngresos = state.ingresos.reduce(function(s, i){ return s + montoMensual(i); }, 0);
    var totalGastos = state.gastos.reduce(function(s, g){ return s + montoMensual(g); }, 0);

    var out = '<div class="card"><div class="card-head"><h3>Ingresos</h3><button class="add-btn accent" id="btn-add-ingreso">+ Ingreso</button></div>';
    out += '<div class="mini-stats"><div class="stat-tile good"><div class="label">Total ingresos (mensual)</div><div class="value num">' + fmt(totalIngresos) + '</div></div></div>';
    if (!state.ingresos.length) { out += '<div class="empty-state">Sin ingresos registrados.</div>'; }
    else {
      out += '<div class="table-scroll"><table><thead><tr><th>Nombre</th><th>Frecuencia</th><th class="num">Monto</th><th></th></tr></thead><tbody>';
      state.ingresos.forEach(function(i){
        out += '<tr><td>' + escapeHtml(i.nombre) + '</td><td><span class="pill ' + i.frecuencia + '">' + i.frecuencia + '</span></td>' +
          '<td class="num num">' + fmt(i.monto) + '</td><td><div class="row-actions">' +
          '<button class="icon-btn" data-act="edit-ingreso" data-id="' + i.id + '">Editar</button>' +
          '<button class="icon-btn danger" data-act="del-ingreso" data-id="' + i.id + '">Eliminar</button></div></td></tr>';
      });
      out += '</tbody></table></div>';
    }
    out += '</div>';

    out += '<div class="card"><div class="card-head"><h3>Gastos fijos</h3><button class="add-btn accent" id="btn-add-gasto">+ Gasto</button></div>';
    out += '<div class="mini-stats"><div class="stat-tile warn"><div class="label">Total gastos (mensual)</div><div class="value num">' + fmt(totalGastos) + '</div></div></div>';
    if (!state.gastos.length) { out += '<div class="empty-state">Sin gastos registrados.</div>'; }
    else {
      out += '<div class="table-scroll"><table><thead><tr><th>Nombre</th><th>Categoría</th><th>Frecuencia</th><th class="num">Monto</th><th></th></tr></thead><tbody>';
      state.gastos.forEach(function(g){
        out += '<tr><td>' + escapeHtml(g.nombre) + '</td><td>' + escapeHtml(g.categoria) + '</td><td><span class="pill ' + g.frecuencia + '">' + g.frecuencia + '</span></td>' +
          '<td class="num">' + fmt(g.monto) + '</td><td><div class="row-actions">' +
          '<button class="icon-btn" data-act="edit-gasto" data-id="' + g.id + '">Editar</button>' +
          '<button class="icon-btn danger" data-act="del-gasto" data-id="' + g.id + '">Eliminar</button></div></td></tr>';
      });
      out += '</tbody></table></div>';
    }
    out += '</div>';
    document.getElementById('view-flujo').innerHTML = out;
    document.getElementById('btn-add-ingreso').onclick = nuevoIngreso;
    document.getElementById('btn-add-gasto').onclick = nuevoGasto;
  }

  /* ---------- render: pendientes ---------- */
  var mostrarResueltos = false;
  function deudaCardHtml(p){
    var pct = Math.round((1 - p.saldoActual / (p.montoOriginal || p.saldoActual || 1)) * 100);
    var overdue = p.fechaLimite && p.fechaLimite < hoyISO();
    var sub = [];
    if (p.quien) sub.push((p.tipo === 'cobrar' ? 'De: ' : 'A: ') + escapeHtml(p.quien));
    if (p.motivo) sub.push(escapeHtml(p.motivo));
    return '<div class="pending-card"><div class="pending-top"><h4>' + escapeHtml(p.nombre) + h4Pencil('edit-pendiente', p.id) + '</h4>' +
      (p.fechaLimite ? '<span class="pending-due' + (overdue ? '' : ' ok') + '">' + (overdue ? 'venció ' : 'vence ') + fechaCorta(p.fechaLimite) + '</span>' : '') + '</div>' +
      (sub.length ? '<div class="pending-sub" style="font-size:12.5px;color:var(--ink-soft);margin-bottom:6px;">' + sub.join(' · ') + '</div>' : '') +
      '<div class="bar-row" style="margin-bottom:0"><span class="bar-track"><span class="bar-fill" style="width:' + pct + '%;background:' + pctColor(pct) + '"></span></span>' +
      '<span class="bar-value num">' + fmt(p.saldoActual) + ' / ' + fmt(p.montoOriginal) + '</span></div>' +
      '<div class="pending-actions">' +
      '<button class="icon-btn" data-act="aportar-pendiente" data-id="' + p.id + '">Aportar</button>' +
      '<button class="icon-btn" data-act="hist-pendiente" data-id="' + p.id + '">Historial</button>' +
      '<button class="icon-btn danger" data-act="del-pendiente" data-id="' + p.id + '">Eliminar</button></div></div>';
  }
  function renderPendientes(){
    var activos = state.pendientes.filter(function(p){ return !p.resuelto; });
    var resueltos = state.pendientes.filter(function(p){ return p.resuelto; });
    var porPagar = activos.filter(function(p){ return p.tipo !== 'cobrar'; });
    var porCobrar = activos.filter(function(p){ return p.tipo === 'cobrar'; });
    var totalPagar = porPagar.reduce(function(s, p){ return s + Number(p.saldoActual); }, 0);
    var totalCobrar = porCobrar.reduce(function(s, p){ return s + Number(p.saldoActual); }, 0);

    var out = '<div class="card"><div class="card-head">' + '<h3>' + escapeHtml(tituloDe('deudasPagar')) + '</h3>' + '<button class="add-btn accent" id="btn-add-pendiente-pagar">+ Deuda</button></div>';
    if (porPagar.length) {
      out += '<div class="mini-stats"><div class="stat-tile warn"><div class="label">Total por pagar</div><div class="value num">' + fmt(totalPagar) + '</div></div></div>';
    }
    if (!porPagar.length) { out += '<div class="empty-state">No debes nada por ahora. 🎉</div>'; }
    porPagar.forEach(function(p){ out += deudaCardHtml(p); });
    out += '</div>';

    out += '<div class="card"><div class="card-head">' + '<h3>' + escapeHtml(tituloDe('deudasCobrar')) + '</h3>' + '<button class="add-btn accent" id="btn-add-pendiente-cobrar">+ Cobro</button></div>';
    if (porCobrar.length) {
      out += '<div class="mini-stats"><div class="stat-tile good"><div class="label">Total por cobrar</div><div class="value num">' + fmt(totalCobrar) + '</div></div></div>';
    }
    if (!porCobrar.length) { out += '<div class="empty-state">Nadie te debe nada por ahora.</div>'; }
    porCobrar.forEach(function(p){ out += deudaCardHtml(p); });
    out += '</div>';

    if (resueltos.length) {
      out += '<div class="card"><div class="card-head"><h3>Saldados (' + resueltos.length + ')</h3><button class="ghost-btn" id="btn-toggle-resueltos">' + (mostrarResueltos ? 'Ocultar' : 'Mostrar') + '</button></div>';
      if (mostrarResueltos) {
        resueltos.forEach(function(p){
          out += '<div class="history-row"><div class="history-left"><span class="history-name">' + escapeHtml(p.nombre) + (p.tipo === 'cobrar' ? ' (cobro)' : '') + '</span></div>' +
            '<span class="history-date">' + fechaCorta(p.fechaResuelto) + '</span>' +
            '<button class="icon-btn danger" data-act="del-pendiente" data-id="' + p.id + '">Eliminar</button></div>';
        });
      }
      out += '</div>';
    }
    document.getElementById('view-pendientes').innerHTML = out;
    document.getElementById('btn-add-pendiente-pagar').onclick = function(){ nuevoPendiente('pagar'); };
    document.getElementById('btn-add-pendiente-cobrar').onclick = function(){ nuevoPendiente('cobrar'); };
    var toggle = document.getElementById('btn-toggle-resueltos');
    if (toggle) toggle.onclick = function(){ mostrarResueltos = !mostrarResueltos; renderPendientes(); };
  }

  /* ---------- render: metas y fondo ---------- */
  function renderMetas(){
    var r = resumen();
    var cta = calcCuenta();
    var apartado = cta.apartado;
    var dedicadoAMetas = cta.dedicadoAMetas;
    var dedicadoAFondos = cta.dedicadoAFondos;
    var disponibleReal = cta.disponibleReal;
    var out = '<div class="card"><div class="card-head">' + '<h3>' + escapeHtml(tituloDe('cuentaBancaria')) + '</h3>' + '</div>';
    out += '<div class="mini-stats">' +
      '<div class="stat-tile"><div class="label">Apartado</div><div class="value num">' + fmt(apartado) + '</div></div>' +
      '<div class="stat-tile"><div class="label">Dedicado a metas</div><div class="value num">' + fmt(dedicadoAMetas) + '</div><div class="sub">ahorro consolidado en todas tus metas</div></div>' +
      '<div class="stat-tile"><div class="label">Dedicado a fondos</div><div class="value num">' + fmt(dedicadoAFondos) + '</div><div class="sub">fondo de seguridad y fondos adicionales, sin contar inversiones</div></div>' +
      '<div class="stat-tile ' + (disponibleReal >= 0 ? 'good' : 'warn') + '"><div class="label">Disponible real</div><div class="value num">' + fmt(disponibleReal) + '</div><div class="sub">apartado menos metas y fondos</div></div>' +
      '</div>' +
      '<div class="goal-actions" style="justify-content:flex-start">' +
      '<button class="icon-btn" id="btn-retirar-apartado">Retirar</button>' +
      '<button class="icon-btn" id="btn-ajustar-apartado">Ajustar apartado</button>' +
      '</div></div>';

    function fechaLinea(iso, completo){
      var t = faltanTexto(iso, completo);
      if (!t) return '';
      var atr = (t.indexOf('atrasada') !== -1);
      return '<div class="goal-fecha' + (atr ? ' atrasada' : '') + '">' + escapeHtml(t) + '</div>';
    }

    out += '<div class="card"><div class="card-head">' + '<h3>' + escapeHtml(tituloDe('fondos')) + '</h3>' + '<button class="add-btn accent" id="btn-add-fondo-adicional">+ Fondo</button></div>';
    var fsCompleto = r.fondoObjetivo > 0 && r.fondoActual >= r.fondoObjetivo;
    out += '<div class="goal-grid"><div class="goal-card' + (fsCompleto ? ' completada' : '') + '">' +
      '<h4>Fondo de seguridad' + h4Pencil('edit-fondo-seguridad') + '</h4><div class="ring-wrap">' + ringSvg(r.fondoPct) + '<div class="ring-center">' + Math.round(r.fondoPct) + '%</div></div>' +
      '<div class="goal-amounts">' + fmt(r.fondoActual) + ' de ' + fmt(r.fondoObjetivo) + '</div>' +
      fechaLinea(state.fondoEmergencia.fechaObjetivo, fsCompleto) +
      '<div class="goal-actions"><button class="icon-btn" id="btn-aportar-fondo">Aportar</button><button class="icon-btn" id="btn-retirar-fondo">Retirar</button><button class="icon-btn" data-act="hist-fondo-seguridad">Historial</button></div>' +
      '</div>';
    state.fondosAdicionales.forEach(function(f){
      var fObjetivo = Number(f.montoObjetivo) || 0;
      var fPct = fObjetivo > 0 ? Math.min(100, Number(f.montoActual) / fObjetivo * 100) : 0;
      var fComp = fObjetivo > 0 && f.montoActual >= fObjetivo;
      var fAmounts = fObjetivo > 0 ? (fmt(f.montoActual) + ' de ' + fmt(fObjetivo)) : (fmt(f.montoActual) + ' — sin objetivo');
      out += '<div class="goal-card' + (fComp ? ' completada' : '') + '"><h4>' + escapeHtml(f.nombre) + h4Pencil('editar-fondo-adicional', f.id) + '</h4>' +
        '<div class="ring-wrap">' + ringSvg(fPct) + '<div class="ring-center">' + Math.round(fPct) + '%</div></div>' +
        '<div class="goal-amounts">' + fAmounts + '</div>' +
        fechaLinea(f.fechaObjetivo, fComp) +
        '<div class="goal-actions">' +
        '<button class="icon-btn" data-act="aportar-fondo-adicional" data-id="' + f.id + '">Aportar</button>' +
        '<button class="icon-btn" data-act="retirar-fondo-adicional" data-id="' + f.id + '">Retirar</button>' +
        '<button class="icon-btn" data-act="hist-fondo-adicional" data-id="' + f.id + '">Historial</button>' +
        '<button class="icon-btn danger" data-act="del-fondo-adicional" data-id="' + f.id + '">Eliminar</button></div></div>';
    });
    out += '</div></div>';

    var faltantePorCompletar = state.metas.filter(function(m){ return !m.completada; })
      .reduce(function(s, m){ return s + Math.max(0, Number(m.montoObjetivo) - Number(m.montoActual)); }, 0);
    out += '<div class="card"><div class="card-head">' + '<h3>' + escapeHtml(tituloDe('metasAhorro')) + '</h3>' + '<button class="add-btn accent" id="btn-add-meta">+ Meta</button></div>';
    if (state.metas.length) {
      out += '<div class="mini-stats"><div class="stat-tile' + (faltantePorCompletar > 0 ? ' warn' : ' good') + '"><div class="label">Falta por completar</div><div class="value num">' + fmt(faltantePorCompletar) + '</div><div class="sub">suma de todas tus metas activas</div></div></div>';
    }
    if (!state.metas.length) { out += '<div class="empty-state">Aún no tienes metas de ahorro.</div>'; }
    else {
      out += '<div class="goal-grid">';
      state.metas.forEach(function(m){
        var pct = m.montoObjetivo > 0 ? Math.min(100, m.montoActual / m.montoObjetivo * 100) : 0;
        out += '<div class="goal-card' + (m.completada ? ' completada' : '') + '"><h4>' + escapeHtml(m.nombre) + h4Pencil('edit-meta', m.id) + '</h4>' +
          '<div class="ring-wrap">' + ringSvg(pct) + '<div class="ring-center">' + Math.round(pct) + '%</div></div>' +
          '<div class="goal-amounts">' + fmt(m.montoActual) + ' de ' + fmt(m.montoObjetivo) + '</div>' +
          fechaLinea(m.fechaObjetivo, m.completada) +
          '<div class="goal-actions">' +
          (m.completada ? '' : '<button class="icon-btn" data-act="aportar-meta" data-id="' + m.id + '">Aportar</button>') +
          '<button class="icon-btn" data-act="hist-meta" data-id="' + m.id + '">Historial</button>' +
          '<button class="icon-btn danger" data-act="del-meta" data-id="' + m.id + '">Eliminar</button></div></div>';
      });
      out += '</div>';
    }
    out += '</div>';

    out += '<div class="card"><div class="card-head">' + '<h3>' + escapeHtml(tituloDe('inversiones')) + '</h3>' + '<button class="add-btn accent" id="btn-add-inversion">+ Inversión</button></div>';
    if (!state.inversiones.length) { out += '<div class="empty-state">Sin inversiones registradas.</div>'; }
    else {
      out += '<div class="table-scroll"><table><thead><tr><th>Nombre</th><th class="num">Tasa anual</th><th class="num">Monto actual</th><th class="num">Rendimiento anual est.</th><th></th></tr></thead><tbody>';
      state.inversiones.forEach(function(i){
        var tasa = Number(i.tasaInteres) || 0;
        var rendimiento = Number(i.montoActual) * (tasa / 100);
        var ft = faltanTexto(i.fechaObjetivo);
        out += '<tr><td>' + escapeHtml(i.nombre) + h4Pencil('edit-inversion', i.id) + (ft ? '<div class="goal-fecha' + (ft.indexOf('atrasada') !== -1 ? ' atrasada' : '') + '">' + escapeHtml(ft) + '</div>' : '') + '</td>' +
          '<td class="num">' + (tasa ? tasa.toFixed(2) + '%' : '—') + '</td>' +
          '<td class="num">' + fmt(i.montoActual) + '</td><td class="num">' + (rendimiento ? fmt(rendimiento) : '—') + '</td>' +
          '<td><div class="row-actions">' +
          (rendimiento > 0 ? '<button class="icon-btn" data-act="reinvertir-inversion" data-id="' + i.id + '">Reinvertir</button>' : '') +
          '<button class="icon-btn" data-act="hist-inversion" data-id="' + i.id + '">Historial</button>' +
          '<button class="icon-btn danger" data-act="del-inversion" data-id="' + i.id + '">Eliminar</button></div></td></tr>';
      });
      out += '</tbody></table></div>';
      out += '<div class="empty-state" style="padding-top:12px;font-size:12px;">El rendimiento anual estimado es el monto actual × la tasa anual — no incluye interés compuesto de reinversiones previas dentro del año.</div>';
    }
    out += '</div>';

    document.getElementById('view-metas').innerHTML = out;
    document.getElementById('btn-retirar-apartado').onclick = retirarApartado;
    document.getElementById('btn-ajustar-apartado').onclick = ajustarApartado;
    document.getElementById('btn-aportar-fondo').onclick = aportarFondo;
    document.getElementById('btn-retirar-fondo').onclick = retirarFondo;
    document.getElementById('btn-add-fondo-adicional').onclick = nuevoFondoAdicional;
    document.getElementById('btn-add-meta').onclick = nuevaMeta;
    document.getElementById('btn-add-inversion').onclick = nuevaInversion;
  }
  function historialFondoSeguridad(){
    openInfoModal('Aportes · Fondo de seguridad', listaMovsHtml(state.fondoEmergencia.aportes));
  }

  /* ---------- render: Registro (gastos) + ¿lo compro? ---------- */
  var mesesAbiertos = {};
  function renderDecide(){
    var out = '';

    out += '<div class="card"><div class="card-head"><h3>Registrar gasto</h3>' +
      '<div class="top-actions"><button class="ghost-btn" id="btn-categorias">Categorías</button>' +
      '<button class="add-btn accent" id="btn-add-mov">+ Gasto</button></div></div>';

    var porMes = {};
    state.movimientos.forEach(function(g){
      var ym = (g.fecha || hoyISO()).slice(0, 7);
      (porMes[ym] = porMes[ym] || []).push(g);
    });
    var mesActual = hoyISO().slice(0, 7);
    var viejos = Object.keys(porMes).filter(function(m){ return m !== mesActual; }).sort().reverse();

    if (viejos.length) {
      out += '<div class="mes-chips">' + viejos.map(function(m){
        return '<button class="mes-chip' + (mesesAbiertos[m] ? ' on' : '') + '" data-act="toggle-mes" data-mes="' + m + '">' + escapeHtml(mesLegible(m)) + '</button>';
      }).join('') + '</div>';
    }

    function bloqueMes(ym, list){
      var arr = (list || []).slice().sort(function(a, b){ return a.fecha < b.fecha ? 1 : -1; });
      var s = '<div class="mov-mes"><div class="group-label">' + escapeHtml(mesLegible(ym)) + '</div>';
      if (!arr.length) { s += '<div class="empty-state">Sin gastos este mes.</div></div>'; return s; }
      arr.forEach(function(g){
        s += '<div class="mov-row"><div class="mov-main"><span class="mov-cat">' + escapeHtml(g.categoria) + '</span>' +
          (g.motivo ? '<span class="mov-motivo">' + escapeHtml(g.motivo) + '</span>' : '') +
          '<span class="mov-fecha">' + escapeHtml(fechaCorta(g.fecha)) + '</span></div>' +
          '<span class="mov-monto num">' + fmt(g.monto) + '</span>' +
          '<div class="mov-acts"><button class="icon-btn" data-act="edit-movimiento" data-id="' + g.id + '">Editar</button>' +
          '<button class="icon-btn danger" data-act="del-movimiento" data-id="' + g.id + '">Eliminar</button></div></div>';
      });
      var total = arr.reduce(function(t, g){ return t + Number(g.monto); }, 0);
      var porCat = {};
      arr.forEach(function(g){ porCat[g.categoria] = (porCat[g.categoria] || 0) + Number(g.monto); });
      s += '<div class="mov-totales">';
      Object.keys(porCat).sort(function(a, b){ return porCat[b] - porCat[a]; }).forEach(function(c){
        s += '<div class="mov-tot-row"><span>' + escapeHtml(c) + '</span><span class="num">' + fmt(porCat[c]) + '</span></div>';
      });
      s += '<div class="mov-tot-row grand"><span>Total del mes</span><span class="num">' + fmt(total) + '</span></div></div></div>';
      return s;
    }

    out += '<div class="card">';
    out += bloqueMes(mesActual, porMes[mesActual]);
    viejos.forEach(function(m){ if (mesesAbiertos[m]) out += bloqueMes(m, porMes[m]); });
    out += '</div>';

    var ultima = state.decisiones[0];
    out += '<div class="decide-grid" style="margin-top:4px">';
    out += '<div class="card decide-form"><div class="card-head"><h3>¿Puedo comprarlo?</h3></div>' +
      '<div class="field"><label for="dec-nombre">¿Qué quieres comprar?</label><input id="dec-nombre" type="text" placeholder="Telescopio, lente…"></div>' +
      '<div class="field"><label for="dec-monto">Monto</label><input id="dec-monto" type="number" step="1" min="0"></div>' +
      '<button class="add-btn accent decide-submit" id="btn-evaluar">Evaluar</button></div>';
    out += '<div class="stamp-card' + (ultima ? ' ' + ultima.color : '') + '">';
    if (ultima) {
      out += '<div class="stamp">' + escapeHtml(ultima.veredicto) + '</div><div class="stamp-detail">' + escapeHtml(ultima.detalle) + '</div>';
    } else {
      out += '<div class="stamp-placeholder">Escribe una compra y presiona "Evaluar" para ver el veredicto aquí.</div>';
    }
    out += '</div></div>';

    out += '<div class="card"><div class="card-head"><h3>Historial de decisiones</h3></div>';
    if (!state.decisiones.length) { out += '<div class="empty-state">Aún no has evaluado ninguna compra.</div>'; }
    else {
      state.decisiones.forEach(function(d){
        out += '<div class="history-row"><div class="history-left"><span class="verdict-pill ' + d.color + '">' + escapeHtml(d.veredicto) + '</span>' +
          '<span class="history-name">' + escapeHtml(d.nombre) + ' · <span class="num">' + fmt(d.monto) + '</span></span></div>' +
          '<span class="history-date">' + fechaCorta(d.fecha) + '</span>' +
          '<button class="icon-btn danger" data-act="del-decision" data-id="' + d.id + '">Eliminar</button></div>';
      });
    }
    out += '</div>';
    document.getElementById('view-decide').innerHTML = out;
    document.getElementById('btn-add-mov').onclick = nuevoMovimiento;
    document.getElementById('btn-categorias').onclick = gestionarCategorias;
    document.getElementById('btn-evaluar').onclick = function(){
      var nombre = document.getElementById('dec-nombre').value.trim();
      var monto = parseFloat(document.getElementById('dec-monto').value);
      if (!nombre || isNaN(monto) || monto <= 0) { toast('Escribe un nombre y un monto válido.'); return; }
      evaluarYRegistrar(nombre, monto);
    };
  }

  /* ---------- render: historial mensual ---------- */
  var historialAnio = new Date(hoyISO()).getFullYear();
  function renderHistorial(){
    var mesActual = hoyISO().slice(0, 7);
    var meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
    var valores = Object.keys(state.historialMensual).map(function(k){ return Number(state.historialMensual[k].ahorro) || 0; });
    var maxAhorro = valores.length ? Math.max.apply(null, valores) : 0;

    var out = '<div class="card"><div class="card-head"><h3>Lo que gasté y ahorré, mes a mes</h3>' +
      '<div class="top-actions"><button class="ghost-btn" id="btn-hist-prev">‹ ' + (historialAnio - 1) + '</button>' +
      '<span class="meta" style="align-self:center">' + historialAnio + '</span>' +
      '<button class="ghost-btn" id="btn-hist-next">' + (historialAnio + 1) + ' ›</button></div></div>';
    out += '<div class="cal-grid">';
    for (var m = 0; m < 12; m++) {
      var key = historialAnio + '-' + String(m + 1).padStart(2, '0');
      var d = state.historialMensual[key];
      var isFuture = key > mesActual;
      var isCurrent = key === mesActual;
      var cls = 'cal-cell' + (isCurrent ? ' current' : '') + (!d ? ' empty' : '');
      var style = '';
      if (d && d.ahorro > 0 && maxAhorro > 0) {
        var pct = Math.round(Math.min(1, d.ahorro / maxAhorro) * 55);
        style = ' style="background:color-mix(in srgb, var(--good) ' + pct + '%, var(--surface))"';
      }
      out += '<div class="' + cls + '"' + style + '><div class="cal-month">' + meses[m] + '</div>';
      if (d) {
        out += '<div class="cal-row"><span>Gasto</span><span class="num">' + fmt(d.gasto) + '</span></div>' +
          '<div class="cal-row"><span>Ahorro</span><span class="num">' + fmt(d.ahorro) + '</span></div>';
      } else {
        out += '<div class="cal-row">' + (isFuture ? 'aún no llega' : 'sin datos') + '</div>';
      }
      out += '</div>';
    }
    out += '</div></div>';
    out += '<div class="card"><div class="empty-state" style="text-align:left">"Ahorro" suma lo que aportaste ese mes a tus metas y al fondo de emergencia. "Gasto" es tu gasto fijo mensual vigente en ese momento. El mes actual se va actualizando solo cada vez que registras algo — los meses anteriores quedan fijos.</div></div>';

    document.getElementById('view-historial').innerHTML = out;
    document.getElementById('btn-hist-prev').onclick = function(){ historialAnio--; renderHistorial(); };
    document.getElementById('btn-hist-next').onclick = function(){ historialAnio++; renderHistorial(); };
  }

  /* ---------- render maestro ---------- */
  function renderAll(){
    renderStatStrip();
    renderFooter();
    renderTabs();
    renderResumen();
    renderFlujo();
    renderPendientes();
    renderMetas();
    renderDecide();
    renderHistorial();
  }

  /* ---------- indicador de sincronización (punto de color, sin texto) ---------- */
  function renderSync(code){
    var dot = document.getElementById('sync-pill');
    var signout = document.getElementById('btn-signout');
    var bannerLocal = document.getElementById('banner-local');
    var bannerNoSave = document.getElementById('banner-nosave');
    var map = {
      connecting:   { cls: '',     txt: 'Conectando…' },
      synced:       { cls: 'ok',   txt: 'Sincronizado' },
      pending:      { cls: 'wait', txt: 'Guardando…' },
      offline:      { cls: 'off',  txt: 'Sin conexión — se guardó en este dispositivo y se subirá al reconectar' },
      'local-only': { cls: '',     txt: 'Solo este dispositivo (sin sincronización configurada)' },
      'signed-out': { cls: '',     txt: '' },
      error:        { cls: 'off',  txt: 'Error de sincronización' },
      nosave:       { cls: 'off',  txt: 'No se pudo guardar' }
    };
    var m = map[code] || map.connecting;

    if (code === 'signed-out') { dot.classList.add('hidden'); }
    else {
      dot.classList.remove('hidden');
      dot.className = 'sync-dot ' + m.cls;
      dot.title = m.txt;
    }

    if (bannerNoSave) bannerNoSave.classList.toggle('hidden', code !== 'nosave');
    if (bannerLocal && code === 'local-only' && RaccoonStore.mode() === 'local') {
      try {
        if (!localStorage.getItem('raccoon_hideLocalBanner')) bannerLocal.classList.remove('hidden');
      } catch (e) { bannerLocal.classList.remove('hidden'); }
    }
    if (signout) signout.classList.toggle('hidden', RaccoonStore.mode() !== 'cloud' || code === 'signed-out');
  }

  /* ---------- pantalla de acceso ---------- */
  function showGate(){ document.getElementById('auth-gate').classList.remove('hidden'); }
  function hideGate(){ document.getElementById('auth-gate').classList.add('hidden'); }

  function authErrorEs(e){
    var c = (e && e.code) || '';
    var t = {
      'auth/invalid-email': 'El correo no tiene un formato válido.',
      'auth/user-disabled': 'Esta cuenta está deshabilitada.',
      'auth/user-not-found': 'No hay una cuenta con ese correo. ¿Quieres crearla?',
      'auth/wrong-password': 'Contraseña incorrecta.',
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/email-already-in-use': 'Ya existe una cuenta con ese correo. Inicia sesión.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/too-many-requests': 'Demasiados intentos. Espera un momento e inténtalo de nuevo.',
      'auth/network-request-failed': 'Sin conexión. Necesitas internet para entrar la primera vez.',
      'auth/operation-not-allowed': 'Falta activar "Correo/Contraseña" en Firebase (Authentication → Sign-in method).'
    };
    return t[c] || ('No se pudo completar (' + (c || 'error') + ').');
  }

  function wireGate(){
    var $ = function(id){ return document.getElementById(id); };
    var modeUp = false;
    function refresh(){
      $('auth-msg').textContent = modeUp
        ? 'Crea tu cuenta para sincronizar tus finanzas entre dispositivos.'
        : 'Inicia sesión para ver y sincronizar tus finanzas.';
      $('auth-submit').textContent = modeUp ? 'Crear cuenta' : 'Entrar';
      $('auth-toggle').textContent = modeUp ? 'Ya tengo cuenta' : 'Crear una cuenta';
      $('auth-pass').setAttribute('autocomplete', modeUp ? 'new-password' : 'current-password');
      var err = $('auth-err'); err.style.color = ''; err.textContent = '';
    }
    $('auth-toggle').onclick = function(){ modeUp = !modeUp; refresh(); };
    $('auth-submit').onclick = function(){
      var email = $('auth-email').value.trim();
      var pw = $('auth-pass').value;
      var err = $('auth-err'); err.style.color = ''; err.textContent = '';
      if (!/.+@.+\..+/.test(email)) { err.textContent = 'Escribe un correo válido.'; return; }
      if (pw.length < 6) { err.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
      $('auth-submit').disabled = true;
      var p = modeUp ? RaccoonStore.signUp(email, pw) : RaccoonStore.signIn(email, pw);
      p['catch'](function(e){ err.textContent = authErrorEs(e); })
       .then(function(){ $('auth-submit').disabled = false; });
    };
    $('auth-forgot').onclick = function(){
      var email = $('auth-email').value.trim();
      var err = $('auth-err'); err.style.color = '';
      if (!/.+@.+\..+/.test(email)) { err.textContent = 'Escribe tu correo arriba y vuelve a tocar "Olvidé mi contraseña".'; return; }
      RaccoonStore.resetPassword(email).then(function(){
        err.style.color = 'var(--good)';
        err.textContent = 'Te enviamos un correo para restablecer la contraseña.';
      })['catch'](function(e){ err.textContent = authErrorEs(e); });
    };
    $('auth-pass').addEventListener('keydown', function(e){ if (e.key === 'Enter') $('auth-submit').click(); });
    refresh();
  }

  /* ---------- delegación de eventos para acciones con data-act ---------- */
  document.addEventListener('click', function(e){
    var btn = e.target.closest('[data-act]');
    if (!btn) return;
    var id = btn.dataset.id;
    var act = btn.dataset.act;
    if (act.indexOf('del-') === 0) {
      if (btn.dataset.armed !== '1') {
        btn.dataset.armed = '1'; var orig = btn.textContent; btn.dataset.orig = orig; btn.textContent = '¿Seguro?'; btn.classList.add('confirm');
        setTimeout(function(){ if (btn.isConnected) { btn.dataset.armed = ''; btn.textContent = btn.dataset.orig; btn.classList.remove('confirm'); } }, 3000);
        return;
      }
    }
    switch (act) {
      case 'edit-ingreso': editarIngreso(id); break;
      case 'del-ingreso': eliminarIngreso(id); break;
      case 'edit-gasto': editarGasto(id); break;
      case 'del-gasto': eliminarGasto(id); break;
      case 'aportar-pendiente': aportarPendiente(id); break;
      case 'hist-pendiente': historialPendiente(id); break;
      case 'edit-pendiente': editarPendiente(id); break;
      case 'del-pendiente': eliminarPendiente(id); break;
      case 'aportar-meta': aportarMeta(id); break;
      case 'hist-meta': historialMeta(id); break;
      case 'edit-meta': editarMeta(id); break;
      case 'del-meta': eliminarMeta(id); break;
      case 'reinvertir-inversion': reinvertirInversion(id); break;
      case 'hist-inversion': historialInversion(id); break;
      case 'edit-inversion': editarInversion(id); break;
      case 'del-inversion': eliminarInversion(id); break;
      case 'del-decision': eliminarDecision(id); break;
      case 'aportar-fondo-adicional': aportarFondoAdicional(id); break;
      case 'retirar-fondo-adicional': retirarFondoAdicional(id); break;
      case 'editar-fondo-adicional': editarFondoAdicional(id); break;
      case 'hist-fondo-adicional': historialFondoAdicional(id); break;
      case 'del-fondo-adicional': eliminarFondoAdicional(id); break;
      case 'hist-fondo-seguridad': historialFondoSeguridad(); break;
      case 'edit-movimiento': editarMovimiento(id); break;
      case 'del-movimiento': eliminarMovimiento(id); break;
      case 'edit-fondo-seguridad': editarFondoSeguridad(); break;
      case 'toggle-mes': mesesAbiertos[btn.dataset.mes] = !mesesAbiertos[btn.dataset.mes]; renderDecide(); break;
    }
  });
  document.getElementById('tabs').addEventListener('click', function(e){
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    activeTab = b.dataset.tab;
    try { localStorage.setItem(TAB_KEY, activeTab); } catch (err) { /* */ }
    renderTabs();
  });
  document.getElementById('banner-dismiss').onclick = function(){ document.getElementById('banner-nosave').classList.add('hidden'); };
  document.getElementById('banner-local-dismiss').onclick = function(){
    document.getElementById('banner-local').classList.add('hidden');
    try { localStorage.setItem('raccoon_hideLocalBanner', '1'); } catch (e) { /* */ }
  };

  /* ---------- exportar / importar respaldo ---------- */
  document.getElementById('btn-export').onclick = function(){
    var data = JSON.stringify(state, null, 2);
    var filename = 'raccoon-finances-' + hoyISO() + '_' + ahoraHM() + '.json';
    var blob = new Blob([data], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    toast('Respaldo descargado.');
  };
  document.getElementById('btn-import').onclick = function(){ document.getElementById('file-import').click(); };
  document.getElementById('file-import').addEventListener('change', function(e){
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      try {
        var data = JSON.parse(reader.result);
        state = Object.assign(estadoVacio(), data);
        normalizarEstado();
        dataLoaded = true;
        persist();
        toast('Respaldo importado.');
      } catch (err) {
        toast('Ese archivo no es un respaldo válido.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  document.getElementById('btn-export-csv').onclick = exportCSV;
  document.getElementById('btn-signout').onclick = function(){
    if (RaccoonStore.mode() === 'cloud') RaccoonStore.signOut();
  };
  document.getElementById('fab-gasto').onclick = nuevoMovimiento;

  /* ---------- inicio ---------- */
  wireGate();
  renderAll();
  renderSync(RaccoonStore.mode() === 'cloud' ? 'connecting' : 'local-only');

  RaccoonStore.init({
    seed: SEED_STATE,
    onData: function(incoming, meta){ applyIncomingState(incoming, meta); },
    onStatus: renderSync,
    onAuthNeeded: showGate,
    onReady: function(){ hideGate(); }
  });
})();
