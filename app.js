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
  function estadoVacio(){
    return {
      ingresos: [], gastos: [], pendientes: [], metas: [],
      fondoEmergencia: { montoObjetivo: 0, montoActual: 0, aportes: [] },
      fondosAdicionales: [],
      inversiones: [], decisiones: [],
      cuentaBancaria: { apartado: 0, saldoPrincipal: 0, pisoSaldoPrincipal: 3000 },
      historialMensual: {},
      ultimaActualizacion: ""
    };
  }
  function normalizarEstado(){
    state.cuentaBancaria = Object.assign({ apartado: 0, saldoPrincipal: 0, pisoSaldoPrincipal: 3000 }, state.cuentaBancaria || {});
    state.fondoEmergencia = Object.assign({ montoObjetivo: 0, montoActual: 0, aportes: [] }, state.fondoEmergencia || {});
    if (!Array.isArray(state.fondosAdicionales)) state.fondosAdicionales = [];
    state.fondosAdicionales.forEach(function(f){ if (!Array.isArray(f.aportes)) f.aportes = []; if (f.montoActual == null) f.montoActual = 0; if (f.montoObjetivo == null) f.montoObjetivo = 0; });
    if (!state.historialMensual || typeof state.historialMensual !== 'object') state.historialMensual = {};
    if (!Array.isArray(state.ingresos)) state.ingresos = [];
    if (!Array.isArray(state.gastos)) state.gastos = [];
    if (!Array.isArray(state.pendientes)) state.pendientes = [];
    if (!Array.isArray(state.metas)) state.metas = [];
    if (!Array.isArray(state.inversiones)) state.inversiones = [];
    if (!Array.isArray(state.decisiones)) state.decisiones = [];
    state.metas.forEach(function(m){ if (!Array.isArray(m.aportes)) m.aportes = []; });
    state.pendientes.forEach(function(p){
      if (!Array.isArray(p.pagos)) p.pagos = [];
      if (p.tipo !== 'pagar' && p.tipo !== 'cobrar') p.tipo = 'pagar';
      if (p.motivo == null) p.motivo = '';
      if (p.quien == null) p.quien = '';
    });
    state.inversiones.forEach(function(i){ if (i.tasaInteres == null) i.tasaInteres = 0; if (!Array.isArray(i.reinversiones)) i.reinversiones = []; });
  }

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
          html += '<option value="' + o.value + '"' + (o.value === val ? ' selected' : '') + '>' + escapeHtml(o.label) + '</option>';
        });
        html += '</select>';
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
    openModal('Aportar a "' + it.nombre + '"', [
      { key: 'monto', label: esCobrar ? 'Monto que te pagaron' : 'Monto del aporte', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      it.saldoActual = Math.max(0, Number(it.saldoActual) - v.monto);
      if (!Array.isArray(it.pagos)) it.pagos = [];
      it.pagos.push({ fecha: hoyISO(), monto: v.monto });
      if (it.saldoActual === 0) { it.resuelto = true; it.fechaResuelto = hoyISO(); }
      persist(); toast(it.resuelto ? (esCobrar ? '¡Cobrado por completo!' : '¡Deuda saldada!') : 'Aporte registrado.');
    }, { saveLabel: 'Aportar' });
  }
  function eliminarPendiente(id){
    state.pendientes = state.pendientes.filter(function(x){ return x.id !== id; });
    persist(); toast('Pendiente eliminado.');
  }

  /* ---------- acciones: metas, fondo, inversiones ---------- */
  function nuevaMeta(){
    openModal('Nueva meta de ahorro', [
      { key: 'nombre', label: 'Nombre', type: 'text', placeholder: 'Pasaporte, telescopio…' },
      { key: 'montoObjetivo', label: 'Monto objetivo', type: 'number', step: '1', min: 1 }
    ], {}, function(v){
      state.metas.push({ id: uid(), nombre: v.nombre.trim().toUpperCase(), montoObjetivo: v.montoObjetivo,
        montoActual: 0, completada: false, aportes: [] });
      persist(); toast('Meta creada.');
    });
  }
  function aportarMeta(id){
    var it = state.metas.find(function(x){ return x.id === id; });
    if (!it) return;
    openModal('Aportar a "' + it.nombre + '"', [
      { key: 'monto', label: 'Monto del aporte', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      it.montoActual = Number(it.montoActual) + v.monto;
      if (!Array.isArray(it.aportes)) it.aportes = [];
      it.aportes.push({ fecha: hoyISO(), monto: v.monto });
      if (it.montoActual >= it.montoObjetivo) it.completada = true;
      persist(); toast(it.completada ? '¡Meta completada!' : 'Aporte registrado.');
    }, { saveLabel: 'Aportar' });
  }
  function eliminarMeta(id){
    state.metas = state.metas.filter(function(x){ return x.id !== id; });
    persist(); toast('Meta eliminada.');
  }

  function editarFondoObjetivo(){
    openModal('Objetivo del fondo de seguridad', [
      { key: 'montoObjetivo', label: 'Monto objetivo', type: 'number', step: '1', min: 0 }
    ], { montoObjetivo: state.fondoEmergencia.montoObjetivo }, function(v){
      state.fondoEmergencia.montoObjetivo = v.montoObjetivo;
      persist(); toast('Objetivo actualizado.');
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
    openModal('Aportar al fondo de seguridad', [
      { key: 'monto', label: 'Monto del aporte', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      state.fondoEmergencia.montoActual = Number(state.fondoEmergencia.montoActual) + v.monto;
      state.fondoEmergencia.aportes.push({ fecha: hoyISO(), monto: v.monto });
      persist(); toast('Aporte registrado.');
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
    openModal('Nuevo fondo adicional', [
      { key: 'nombre', label: 'Nombre', type: 'text', placeholder: 'Colchón médico, fondo del carro…' },
      { key: 'montoActual', label: 'Monto inicial', type: 'number', step: '1', min: 0 },
      { key: 'montoObjetivo', label: 'Monto objetivo (opcional, 0 = sin objetivo)', type: 'number', step: '1', min: 0 }
    ], { montoActual: 0, montoObjetivo: 0 }, function(v){
      state.fondosAdicionales.push({ id: uid(), nombre: v.nombre.trim(), montoActual: v.montoActual, montoObjetivo: v.montoObjetivo, aportes: [] });
      persist(); toast('Fondo agregado.');
    });
  }
  function aportarFondoAdicional(id){
    var f = state.fondosAdicionales.find(function(x){ return x.id === id; });
    if (!f) return;
    openModal('Aportar a "' + f.nombre + '"', [
      { key: 'monto', label: 'Monto del aporte', type: 'number', step: '1', min: 0.01 }
    ], {}, function(v){
      f.montoActual = Math.round((Number(f.montoActual) + v.monto) * 100) / 100;
      f.aportes.push({ fecha: hoyISO(), monto: v.monto });
      persist(); toast('Aporte registrado.');
    }, { saveLabel: 'Aportar' });
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
      { key: 'montoObjetivo', label: 'Monto objetivo (0 = sin objetivo)', type: 'number', step: '1', min: 0 }
    ], { nombre: f.nombre, montoObjetivo: f.montoObjetivo }, function(v){
      f.nombre = v.nombre.trim();
      f.montoObjetivo = v.montoObjetivo;
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
      { key: 'tasaInteres', label: 'Tasa de interés anual (%)', type: 'number', step: '0.01', min: 0 }
    ], { montoActual: 0, tasaInteres: 0 }, function(v){
      state.inversiones.push({ id: uid(), nombre: v.nombre.trim().toUpperCase(), montoActual: v.montoActual,
        tasaInteres: v.tasaInteres, reinversiones: [] });
      persist(); toast('Inversión agregada.');
    });
  }
  function aportarInversion(id){
    var it = state.inversiones.find(function(x){ return x.id === id; });
    if (!it) return;
    openModal('Actualizar "' + it.nombre + '"', [
      { key: 'monto', label: 'Nuevo monto total', type: 'number', step: '1', min: 0 },
      { key: 'tasaInteres', label: 'Tasa de interés anual (%)', type: 'number', step: '0.01', min: 0 }
    ], { monto: it.montoActual, tasaInteres: it.tasaInteres || 0 }, function(v){
      it.montoActual = v.monto;
      it.tasaInteres = v.tasaInteres;
      persist(); toast('Inversión actualizada.');
    }, { saveLabel: 'Actualizar' });
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
  }

  /* ---------- render: resumen ---------- */
  function ringSvg(pct, colorVar){
    pct = Math.max(0, Math.min(100, pct));
    var r = 46, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return '<svg width="104" height="104" viewBox="0 0 104 104">' +
      '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="var(--line)" stroke-width="10"></circle>' +
      '<circle cx="52" cy="52" r="' + r + '" fill="none" stroke="var(--' + colorVar + ')" stroke-width="10" ' +
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
      return 'width:' + pct + '%;background:' + (pct >= 100 ? 'var(--good)' : 'var(--tile-red)');
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
      '<h4>Fondo de seguridad</h4><div class="ring-wrap">' + ringSvg(r.fondoPct, 'good') + '<div class="ring-center">' + Math.round(r.fondoPct) + '%</div></div>' +
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
    return '<div class="pending-card"><div class="pending-top"><h4>' + escapeHtml(p.nombre) + '</h4>' +
      (p.fechaLimite ? '<span class="pending-due' + (overdue ? '' : ' ok') + '">' + (overdue ? 'venció ' : 'vence ') + fechaCorta(p.fechaLimite) + '</span>' : '') + '</div>' +
      (sub.length ? '<div class="pending-sub" style="font-size:12.5px;color:var(--ink-soft);margin-bottom:6px;">' + sub.join(' · ') + '</div>' : '') +
      '<div class="bar-row" style="margin-bottom:0"><span class="bar-track"><span class="bar-fill" style="width:' + pct + '%"></span></span>' +
      '<span class="bar-value num">' + fmt(p.saldoActual) + ' / ' + fmt(p.montoOriginal) + '</span></div>' +
      '<div class="pending-actions">' +
      '<button class="icon-btn" data-act="aportar-pendiente" data-id="' + p.id + '">Aportar</button>' +
      '<button class="icon-btn danger" data-act="del-pendiente" data-id="' + p.id + '">Eliminar</button></div></div>';
  }
  function renderPendientes(){
    var activos = state.pendientes.filter(function(p){ return !p.resuelto; });
    var resueltos = state.pendientes.filter(function(p){ return p.resuelto; });
    var porPagar = activos.filter(function(p){ return p.tipo !== 'cobrar'; });
    var porCobrar = activos.filter(function(p){ return p.tipo === 'cobrar'; });
    var totalPagar = porPagar.reduce(function(s, p){ return s + Number(p.saldoActual); }, 0);
    var totalCobrar = porCobrar.reduce(function(s, p){ return s + Number(p.saldoActual); }, 0);

    var out = '<div class="card"><div class="card-head"><h3>Deudas por pagar</h3><button class="add-btn accent" id="btn-add-pendiente-pagar">+ Deuda</button></div>';
    if (porPagar.length) {
      out += '<div class="mini-stats"><div class="stat-tile warn"><div class="label">Total por pagar</div><div class="value num">' + fmt(totalPagar) + '</div></div></div>';
    }
    if (!porPagar.length) { out += '<div class="empty-state">No debes nada por ahora. 🎉</div>'; }
    porPagar.forEach(function(p){ out += deudaCardHtml(p); });
    out += '</div>';

    out += '<div class="card"><div class="card-head"><h3>Deudas por cobrar</h3><button class="add-btn accent" id="btn-add-pendiente-cobrar">+ Cobro</button></div>';
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
    var out = '<div class="card"><div class="card-head"><h3>Cuenta bancaria</h3><span class="meta">apartado</span></div>';
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

    out += '<div class="card"><div class="card-head"><h3>Fondos</h3><button class="add-btn accent" id="btn-add-fondo-adicional">+ Fondo</button></div>';
    out += '<div class="goal-grid"><div class="goal-card' + (r.fondoObjetivo > 0 && r.fondoActual >= r.fondoObjetivo ? ' completada' : '') + '">' +
      '<h4>Fondo de seguridad</h4><div class="ring-wrap">' + ringSvg(r.fondoPct, 'good') + '<div class="ring-center">' + Math.round(r.fondoPct) + '%</div></div>' +
      '<div class="goal-amounts">' + fmt(r.fondoActual) + ' de ' + fmt(r.fondoObjetivo) + '</div>' +
      '<div class="goal-actions"><button class="icon-btn" id="btn-aportar-fondo">Aportar</button><button class="icon-btn" id="btn-retirar-fondo">Retirar</button><button class="icon-btn" id="btn-editar-fondo">Objetivo</button></div>' +
      '</div>';
    state.fondosAdicionales.forEach(function(f){
      var fObjetivo = Number(f.montoObjetivo) || 0;
      var fPct = fObjetivo > 0 ? Math.min(100, Number(f.montoActual) / fObjetivo * 100) : 0;
      var fAmounts = fObjetivo > 0 ? (fmt(f.montoActual) + ' de ' + fmt(fObjetivo)) : (fmt(f.montoActual) + ' — sin objetivo');
      out += '<div class="goal-card' + (fObjetivo > 0 && f.montoActual >= fObjetivo ? ' completada' : '') + '"><h4>' + escapeHtml(f.nombre) + '</h4>' +
        '<div class="ring-wrap">' + ringSvg(fPct, 'good') + '<div class="ring-center">' + Math.round(fPct) + '%</div></div>' +
        '<div class="goal-amounts">' + fAmounts + '</div>' +
        '<div class="goal-actions">' +
        '<button class="icon-btn" data-act="aportar-fondo-adicional" data-id="' + f.id + '">Aportar</button>' +
        '<button class="icon-btn" data-act="retirar-fondo-adicional" data-id="' + f.id + '">Retirar</button>' +
        '<button class="icon-btn" data-act="editar-fondo-adicional" data-id="' + f.id + '">Editar</button>' +
        '<button class="icon-btn danger" data-act="del-fondo-adicional" data-id="' + f.id + '">Eliminar</button></div></div>';
    });
    out += '</div></div>';

    var faltantePorCompletar = state.metas.filter(function(m){ return !m.completada; })
      .reduce(function(s, m){ return s + Math.max(0, Number(m.montoObjetivo) - Number(m.montoActual)); }, 0);
    out += '<div class="card"><div class="card-head"><h3>Metas de ahorro</h3><button class="add-btn accent" id="btn-add-meta">+ Meta</button></div>';
    if (state.metas.length) {
      out += '<div class="mini-stats"><div class="stat-tile' + (faltantePorCompletar > 0 ? ' warn' : ' good') + '"><div class="label">Falta por completar</div><div class="value num">' + fmt(faltantePorCompletar) + '</div><div class="sub">suma de todas tus metas activas</div></div></div>';
    }
    if (!state.metas.length) { out += '<div class="empty-state">Aún no tienes metas de ahorro.</div>'; }
    else {
      out += '<div class="goal-grid">';
      state.metas.forEach(function(m){
        var pct = m.montoObjetivo > 0 ? Math.min(100, m.montoActual / m.montoObjetivo * 100) : 0;
        out += '<div class="goal-card' + (m.completada ? ' completada' : '') + '"><h4>' + escapeHtml(m.nombre) + '</h4>' +
          '<div class="ring-wrap">' + ringSvg(pct, 'accent') + '<div class="ring-center">' + Math.round(pct) + '%</div></div>' +
          '<div class="goal-amounts">' + fmt(m.montoActual) + ' de ' + fmt(m.montoObjetivo) + '</div>' +
          '<div class="goal-actions">' +
          (m.completada ? '' : '<button class="icon-btn" data-act="aportar-meta" data-id="' + m.id + '">Aportar</button>') +
          '<button class="icon-btn danger" data-act="del-meta" data-id="' + m.id + '">Eliminar</button></div></div>';
      });
      out += '</div>';
    }
    out += '</div>';

    out += '<div class="card"><div class="card-head"><h3>Inversiones</h3><button class="add-btn accent" id="btn-add-inversion">+ Inversión</button></div>';
    if (!state.inversiones.length) { out += '<div class="empty-state">Sin inversiones registradas.</div>'; }
    else {
      out += '<div class="table-scroll"><table><thead><tr><th>Nombre</th><th class="num">Tasa anual</th><th class="num">Monto actual</th><th class="num">Rendimiento anual est.</th><th></th></tr></thead><tbody>';
      state.inversiones.forEach(function(i){
        var tasa = Number(i.tasaInteres) || 0;
        var rendimiento = Number(i.montoActual) * (tasa / 100);
        out += '<tr><td>' + escapeHtml(i.nombre) + '</td><td class="num">' + (tasa ? tasa.toFixed(2) + '%' : '—') + '</td>' +
          '<td class="num">' + fmt(i.montoActual) + '</td><td class="num">' + (rendimiento ? fmt(rendimiento) : '—') + '</td>' +
          '<td><div class="row-actions">' +
          (rendimiento > 0 ? '<button class="icon-btn" data-act="reinvertir-inversion" data-id="' + i.id + '">Reinvertir</button>' : '') +
          '<button class="icon-btn" data-act="aportar-inversion" data-id="' + i.id + '">Actualizar</button>' +
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
    document.getElementById('btn-editar-fondo').onclick = editarFondoObjetivo;
    document.getElementById('btn-add-fondo-adicional').onclick = nuevoFondoAdicional;
    document.getElementById('btn-add-meta').onclick = nuevaMeta;
    document.getElementById('btn-add-inversion').onclick = nuevaInversion;
  }

  /* ---------- render: ¿lo compro? ---------- */
  function renderDecide(){
    var ultima = state.decisiones[0];
    var out = '<div class="decide-grid">';
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
    if (act === 'del-ingreso' || act === 'del-gasto' || act === 'del-pendiente' || act === 'del-meta' || act === 'del-inversion' || act === 'del-decision' || act === 'del-fondo-adicional') {
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
      case 'del-pendiente': eliminarPendiente(id); break;
      case 'aportar-meta': aportarMeta(id); break;
      case 'del-meta': eliminarMeta(id); break;
      case 'aportar-inversion': aportarInversion(id); break;
      case 'reinvertir-inversion': reinvertirInversion(id); break;
      case 'del-inversion': eliminarInversion(id); break;
      case 'del-decision': eliminarDecision(id); break;
      case 'aportar-fondo-adicional': aportarFondoAdicional(id); break;
      case 'retirar-fondo-adicional': retirarFondoAdicional(id); break;
      case 'editar-fondo-adicional': editarFondoAdicional(id); break;
      case 'del-fondo-adicional': eliminarFondoAdicional(id); break;
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
  document.getElementById('btn-signout').onclick = function(){
    if (RaccoonStore.mode() === 'cloud') RaccoonStore.signOut();
  };

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
