
// ==================== VARIABLES GLOBALES ====================
let cartonesOcupados = [];
let precioPorCarton = 0;
let cantidadPermitida = 0;
let promocionSeleccionada = null;
let modoCartones = "libre";
let cantidadFijaCartones = 1;
let totalCartones = 0;
let adminSession = null;
let sesionActiva = false;
let contador = 0;

const promociones = [
  { id: 1, activa: false, descripcion: '', cantidad: 0, precio: 0 },
  { id: 2, activa: false, descripcion: '', cantidad: 0, precio: 0 },
  { id: 3, activa: false, descripcion: '', cantidad: 0, precio: 0 },
  { id: 4, activa: false, descripcion: '', cantidad: 0, precio: 0 }
];

let usuario = {
  nombre: '',
  telefono: '',
  cedula: '',
  referido: '',
  cartones: [],
};

const SESSION_TIMEOUT = 30 * 60 * 1000;
let inactivityTimer;

// ==================== FUNCIONES DE CONFIGURACIÓN ====================
async function getConfigValue(clave, fallback = null) {
  const { data, error } = await supabase
    .from('configuracion')
    .select('valore, valor')
    .eq('clave', clave)
    .single();

  if (error || !data) return fallback;
  return (data.valore ?? data.valor ?? fallback);
}

async function setConfigValue(clave, value) {
  const { error } = await supabase
    .from('configuracion')
    .upsert([{ clave, valore: value }], { onConflict: 'clave' });
  return !error;
}

// ==================== FUNCIONES PRINCIPALES DE USUARIO ====================
async function obtenerTotalCartones() {
  const { data, error } = await supabase
    .from('configuracion')
    .select('valore')
    .eq('clave', 'total_cartones')
    .single();

  totalCartones = (!error && data) ? parseInt(data.valore, 10) || 0 : 0;
}

async function cargarPrecioPorCarton() {
  const { data, error } = await supabase
    .from('configuracion')
    .select('valore')
    .eq('clave', 'precio_carton')
    .single();

  if (!error && data) {
    precioPorCarton = parseFloat(data.valore);
  } else {
    console.error('Error cargando el precio del cartón', error);
    precioPorCarton = 0;
  }
}

function generarCartones() {
  console.log(`Sistema de bingo inicializado con ${totalCartones} cartones disponibles`);
}

function actualizarPreseleccion() {
  let cant = parseInt(document.getElementById('cantidadCartones').value) || 1;
  const maxDisponibles = totalCartones - cartonesOcupados.length;
  
  if (modoCartones === 'fijo') {
    cant = cantidadFijaCartones;
    document.getElementById('cantidadCartones').value = cantidadFijaCartones;
  } else {
    cant = Math.min(cant, maxDisponibles);
    document.getElementById('cantidadCartones').value = cant;
  }

  document.getElementById('monto-preseleccion').textContent =
    (cant * precioPorCarton).toFixed(2);
}

function limpiarPromoPorCambioCantidad() {
  if (promocionSeleccionada) {
    deseleccionarPromocion();
  }
  actualizarPreseleccion();
}

function isTrue(v) {
  return v === true || v === 'true' || v === 1 || v === '1';
}

async function mostrarVentana(id) {
  if (id === 'admin') {
    await entrarAdmin();
    return;
  }
  
  // 1) Si va a CARTONES, valida ventas_abierta
  if (id === 'cartones') {
    const { data } = await supabase
      .from('configuracion')
      .select('valore, valor')
      .eq('clave', 'ventas_abierta')
      .single();

    const ventasAbierta = data ? (data.valore ?? data.valor ?? 'true') : 'true';
    if (!isTrue(ventasAbierta)) {
      alert('Las ventas están cerradas');
      document.querySelectorAll('section').forEach(s => s.classList.add('oculto'));
      document.getElementById('bienvenida').classList.remove('oculto');
      return;
    }
  }

  // 2) Si va a PAGO, valida cantidad exacta
  if (id === 'pago') {
    const requerido = (modoCartones === 'fijo') ? cantidadFijaCartones : cantidadPermitida;
    if (usuario.cartones.length !== requerido) {
      alert(`Debes elegir exactamente ${requerido} cartones antes de continuar.`);
      return;
    }
  }

  // 3) Mostrar la ventana solicitada
  document.querySelectorAll('section').forEach(s => s.classList.add('oculto'));
  const target = document.getElementById(id);
  if (target) target.classList.remove('oculto');

  if (id === 'cantidad') {
    promocionSeleccionada = null;
    await cargarPromocionesConfig();
    actualizarPreseleccion();
  }
  
  if (id === 'pago') {
    const promo = getPromocionSeleccionada();
    const monto = promo ? promo.precio : (usuario.cartones.length * (precioPorCarton || 0));
    document.getElementById('monto-pago').textContent = monto.toFixed(2);
  }
  
  if (id === 'cartones') {
    await cargarCartones();
  }

  if (id === 'lista-aprobados') {
    await cargarListaAprobadosSeccion();
  }
}

function guardarDatosInscripcion() {
  usuario.nombre = document.getElementById('nombre').value;
  usuario.telefono = document.getElementById('telefono').value;
  usuario.cedula = document.getElementById('cedula').value;
  usuario.referido = document.getElementById('referido').value;
  usuario.cartones = [];
  mostrarVentana('cantidad')
  actualizarPreseleccion(); 
}

function confirmarCantidad() {
  const promo = getPromocionSeleccionada();
  let cant;
  
  if (promo) {
    cant = promo.cantidad;
  } else {
    cant = parseInt(document.getElementById('cantidadCartones').value);
    const maxDisponibles = totalCartones - cartonesOcupados.length;
    
    if (modoCartones === 'fijo') {
      if (cant !== cantidadFijaCartones) {
        document.getElementById('cantidadCartones').value = cantidadFijaCartones;
        cant = cantidadFijaCartones;
      }
    } else {
      if (isNaN(cant) || cant < 1) {
        return alert('Ingresa un número válido');
      }
      if (cant > maxDisponibles) {
        return alert(`Solo quedan ${maxDisponibles} cartones disponibles`);
      }
    }
  }
  
  cantidadPermitida = cant;
  usuario.cartones = [];
  mostrarVentana('cartones');
}

// ==================== FUNCIONES DE CARTONES ====================
async function cargarCartones() {
  cartonesOcupados = await fetchTodosLosOcupados();
  const ocupadosSet = new Set(cartonesOcupados);

  const contenedor = document.getElementById('contenedor-cartones');
  contenedor.innerHTML = '';

  for (let i = 1; i <= totalCartones; i++) {
    const carton = document.createElement('div');
    carton.textContent = i;
    carton.classList.add('carton');

    if (ocupadosSet.has(i)) {
      carton.classList.add('ocupado');
    } else {
      carton.onclick = () => abrirModalCarton(i, carton);
    }
    contenedor.appendChild(carton);
  }

  await contarCartonesVendidos();
  actualizarContadorCartones(
    totalCartones,
    Number(document.getElementById('total-vendidos').textContent) || cartonesOcupados.length,
    usuario.cartones.length
  );
  actualizarMonto();
}

function toggleCarton(num, elem) {
  const index = usuario.cartones.indexOf(num);

  if (index >= 0) {
    usuario.cartones.splice(index, 1);
    elem.classList.remove('seleccionado');

    document.querySelectorAll('.carton.bloqueado').forEach(c => {
      const n = parseInt(c.textContent);
      if (!cartonesOcupados.includes(n) && !usuario.cartones.includes(n)) {
        c.classList.remove('bloqueado');
        c.onclick = () => abrirModalCarton(n, c);
      }
    });
  } else {
    if (usuario.cartones.length >= cantidadPermitida) return;

    usuario.cartones.push(num);
    elem.classList.add('seleccionado');

    if (usuario.cartones.length === cantidadPermitida) {
      document.querySelectorAll('.carton').forEach(c => {
        const n = parseInt(c.textContent);
        const yaSeleccionado = usuario.cartones.includes(n);
        const yaOcupado = cartonesOcupados.includes(n);

        if (!yaSeleccionado && !yaOcupado) {
          c.classList.add('bloqueado');
          c.onclick = null;
        }
      });
    }
  }
  actualizarContadorCartones(totalCartones, cartonesOcupados.length, usuario.cartones.length);
  actualizarMonto();
}

function actualizarMonto() {
  let total;
  const promo = getPromocionSeleccionada();
  
  if (promo && usuario.cartones.length === promo.cantidad) {
    total = promo.precio;
  } else {
    total = (usuario.cartones.length || 0) * (precioPorCarton || 0);
  }
  
  const nodo = document.getElementById('monto-total');
  if (nodo) nodo.textContent = total.toFixed(2);
}

// ==================== FUNCIONES DE PAGO ====================
async function enviarComprobante() {
  const boton = document.getElementById('btnEnviarComprobante');
  const textoOriginal = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Cargando comprobante...';

  try {
    if (!usuario.nombre || !usuario.telefono || !usuario.cedula) {
      throw new Error('Debes completar primero los datos de inscripción');
    }

    const referencia4dig = document.getElementById('referencia4dig').value.trim();
    if (!/^\d{4}$/.test(referencia4dig)) {
      throw new Error('Debes ingresar los últimos 4 dígitos de la referencia bancaria.');
    }

    const archivo = document.getElementById('comprobante').files[0];
    if (!archivo) throw new Error('Debes subir un comprobante');

    const ext = archivo.name.split('.').pop();
    const nombreArchivo = `${usuario.cedula}-${Date.now()}.${ext}`;
    const { error: errorUpload } = await supabase.storage
      .from('comprobantes')
      .upload(nombreArchivo, archivo);
    if (errorUpload) throw new Error('Error subiendo imagen');

    const urlPublica = `${supabaseUrl}/storage/v1/object/public/comprobantes/${nombreArchivo}`;

    const rows = usuario.cartones.map(n => ({ numero: n }));
    const { error: errInsertaCartones } = await supabase
      .from('cartones')
      .insert(rows);

    if (errInsertaCartones) {
      alert('Uno o más cartones ya fueron tomados por otra persona. Elige otros, por favor.');
      usuario.cartones = [];
      mostrarVentana('cartones');
      await cargarCartones();
      return;
    }

    const promo = getPromocionSeleccionada();
    const monto = promo ? promo.precio : (usuario.cartones.length * (precioPorCarton || 0));
    
    const { error: errorInsert } = await supabase.from('inscripciones').insert([{
      nombre: usuario.nombre,
      telefono: usuario.telefono,
      cedula: usuario.cedula,
      referido: usuario.referido,
      cartones: usuario.cartones,
      referencia4dig: referencia4dig,
      comprobante: urlPublica,
      estado: 'pendiente',
      monto_bs: monto,
      usa_promo: !!promo,
      promo_desc: promo ? promo.descripcion : null,
      precio_unitario_bs: promo ? null : (precioPorCarton || 0) 
    }]);

    if (errorInsert) {
      await supabase.from('cartones').delete().in('numero', usuario.cartones);
      throw new Error('Error guardando la inscripción');
    }

    alert('Inscripción y comprobante enviados con éxito');
    location.reload();
  } catch (err) {
    console.error(err);
    alert(err.message || 'Ocurrió un error inesperado');
  } finally {
    boton.disabled = false;
    boton.textContent = textoOriginal;
  }
}

// ==================== FUNCIONES DE MODAL ====================
let cartonSeleccionadoTemporal = null;
let cartonElementoTemporal = null;

function abrirModalCarton(numero, elemento) {
  cartonSeleccionadoTemporal = numero;
  cartonElementoTemporal = elemento;
  const img = document.getElementById('imagen-carton-modal');
  img.src = `${supabaseUrl}/storage/v1/object/public/cartones/SERIAL_BINGOANDINO75_CARTON_${String(numero).padStart(5, '0')}.jpg`;

  document.getElementById('modal-carton').classList.remove('oculto');

  const btn = document.getElementById('btnSeleccionarCarton');
  btn.onclick = () => {
    toggleCarton(cartonSeleccionadoTemporal, cartonElementoTemporal);
    cerrarModalCarton();
  };
}

function cerrarModalCarton() {
  document.getElementById('modal-carton').classList.add('oculto');
  cartonSeleccionadoTemporal = null;
  cartonElementoTemporal = null;
}

function actualizarContadorCartones(total, ocupados, seleccionados) {
  const disponibles = total - ocupados - seleccionados;
  const contador = document.getElementById('contadorCartones');
  contador.textContent = `Cartones disponibles: ${disponibles} de ${total}`;
}

// ==================== FUNCIONES DE PROMOCIONES ====================
async function cargarPromocionesConfig() {
  try {
    for (let i = 0; i < promociones.length; i++) {
      const promo = promociones[i];
      const prefix = `promo${i + 1}`;
      
      promo.activa = (await getConfigValue(`${prefix}_activa`, 'false')) === 'true';
      promo.descripcion = await getConfigValue(`${prefix}_descripcion`, `Promo ${i + 1}`);
      promo.cantidad = parseInt(await getConfigValue(`${prefix}_cantidad`, '0')) || 0;
      promo.precio = parseFloat(await getConfigValue(`${prefix}_precio`, '0')) || 0;
    }
    
    console.log('Promociones cargadas:', promociones);
    renderizarBotonesPromociones();
  } catch (error) {
    console.error('Error cargando promociones:', error);
  }
}

function renderizarBotonesPromociones() {
  const promoBox = document.getElementById('promoBox');
  if (!promoBox) return;

  let algunaActiva = false;
  
  promociones.forEach((promo, index) => {
    const boton = document.querySelector(`[data-promo="${index + 1}"]`);
    const descElement = document.getElementById(`promo-desc-${index + 1}`);
    const precioElement = document.getElementById(`promo-precio-${index + 1}`);
    
    if (boton && descElement && precioElement) {
      if (promo.activa && promo.cantidad > 0 && promo.precio > 0) {
        descElement.textContent = promo.descripcion;
        precioElement.textContent = `${promo.precio.toFixed(2)} Bs`;
        boton.classList.remove('desactivado');
        algunaActiva = true;
        boton.title = `${promo.cantidad} cartones por ${promo.precio.toFixed(2)} Bs`;
        
        boton.onclick = () => seleccionarPromocion(index + 1);
      } else {
        descElement.textContent = `Promo ${index + 1} (No disponible)`;
        precioElement.textContent = 'No disponible';
        boton.classList.add('desactivado');
        boton.onclick = null;
      }
      
      boton.classList.remove('seleccionado');
    }
  });
  
  promoBox.classList.toggle('oculto', !algunaActiva);
}

function seleccionarPromocion(numero) {
  const promo = promociones[numero - 1];
  
  if (!promo.activa || promo.cantidad <= 0 || promo.precio <= 0) {
    alert('Esta promoción no está disponible en este momento.');
    return;
  }
  
  const maxDisponibles = totalCartones - cartonesOcupados.length;
  if (promo.cantidad > maxDisponibles) {
    alert(`No hay suficientes cartones disponibles para esta promoción. Disponibles: ${maxDisponibles}`);
    return;
  }
  
  if (promocionSeleccionada === numero) {
    deseleccionarPromocion();
    return;
  }
  
  promocionSeleccionada = numero;
  
  document.querySelectorAll('.btn-promo').forEach(btn => {
    btn.classList.remove('seleccionado');
  });
  
  const botonSeleccionado = document.querySelector(`[data-promo="${numero}"]`);
  if (botonSeleccionado) {
    botonSeleccionado.classList.add('seleccionado');
  }
  
  document.getElementById('cantidadCartones').value = promo.cantidad;
  actualizarPreseleccion();
}

function deseleccionarPromocion() {
  promocionSeleccionada = null;
  document.querySelectorAll('.btn-promo').forEach(btn => {
    btn.classList.remove('seleccionado');
  });
  document.getElementById('cantidadCartones').value = 1;
  actualizarPreseleccion();
}

function getPromocionSeleccionada() {
  return promocionSeleccionada ? promociones[promocionSeleccionada - 1] : null;
}

// ==================== FUNCIONES AUXILIARES ====================
async function fetchTodosLosOcupados() {
  const pageSize = 1000;
  let from = 0;
  let todos = [];

  const { count, error: countErr } = await supabase
    .from('cartones')
    .select('numero', { count: 'exact', head: true });

  if (countErr) {
    console.error('Error contando cartones:', countErr);
    return [];
  }

  const total = count || 0;
  while (from < total) {
    const to = Math.min(from + pageSize - 1, total - 1);
    const { data, error } = await supabase
      .from('cartones')
      .select('numero')
      .order('numero', { ascending: true })
      .range(from, to);

    if (error) {
      console.error('Error paginando cartones:', error);
      break;
    }

    todos = todos.concat(data || []);
    from += pageSize;
  }

  return todos.map(r => Number(r.numero));
}

async function contarCartonesVendidos() {
  const { count, error } = await supabase
    .from('cartones')
    .select('numero', { count: 'exact', head: true });

  if (error) {
    console.error('Error al contar cartones:', error);
    return;
  }
  
  const totalVendidosElement = document.getElementById('total-vendidos');
  if (totalVendidosElement) {
    totalVendidosElement.textContent = count || 0;
  }
  
  return count || 0;
}

async function cargarConfiguracionModoCartones() {
  const { data: modoData, error: modoError } = await supabase
    .from('configuracion')
    .select('valore')
    .eq('clave', 'modo_cartones')
    .single();

  if (!modoError && modoData) {
    modoCartones = modoData.valore;
  }

  if (modoCartones === "fijo") {
    const { data: cantData, error: cantError } = await supabase
      .from('configuracion')
      .select('valore')
      .eq('clave', 'cartones_obligatorios')
      .single();

    if (!cantError && cantData) {
      cantidadFijaCartones = parseInt(cantData.valore) || 1;
      document.getElementById('cantidadCartones').value = cantidadFijaCartones;
      document.getElementById('btnMas').disabled = true;
      document.getElementById('btnMenos').disabled = true;
      document.getElementById('cantidadCartones').readOnly = true;
    }
  } else {
    document.getElementById('btnMas').disabled = false;
    document.getElementById('btnMenos').disabled = false;
    document.getElementById('cantidadCartones').readOnly = false;
  }
}

async function cargarListaAprobadosSeccion() {
  const { data, error } = await supabase
    .from('inscripciones')
    .select('*')
    .eq('estado', 'aprobado');

  const contenedor = document.getElementById('contenedor-aprobados');
  contenedor.innerHTML = '';

  if (error || !data.length) {
    contenedor.innerHTML = '<p>No hay aprobados aún.</p>';
    return;
  }

  const tabla = document.createElement('table');
  tabla.style.width = '100%';
  tabla.style.borderCollapse = 'collapse';
  tabla.innerHTML = `
    <thead>
      <tr>
        <th>Cartón</th>
        <th>Nombre</th>
        <th>Cédula</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;

  const tbody = tabla.querySelector('tbody');
  let filas = [];

  data.forEach(item => {
    item.cartones.forEach(carton => {
      filas.push({
        carton,
        nombre: item.nombre,
        cedula: item.cedula
      });
    });
  });

  filas.sort((a, b) => a.carton - b.carton);

  filas.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${item.carton}</td>
      <td>${item.nombre}</td>
      <td>${item.cedula}</td>
    `;
    tbody.appendChild(tr);
  });

  contenedor.appendChild(tabla);
}

// ==================== FUNCIONES DE ADMIN (SIMPLIFICADAS) ====================
async function entrarAdmin() {
  mostrarVentana('admin-login');
  document.getElementById('admin-email').value = '';
  document.getElementById('admin-password').value = '';
  document.getElementById('admin-error').textContent = '';
}

function cerrarTerminos() {
  document.getElementById('modal-terminos').classList.add('oculto');
}

// ==================== INICIALIZACIÓN ====================
window.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 Inicializando sistema...');
  
  await obtenerTotalCartones();
  await cargarPrecioPorCarton();
  await cargarConfiguracionModoCartones();
  generarCartones();
  await cargarPromocionesConfig();
  
  // Configurar botones + y -
  document.getElementById('btnMas').onclick = () => {
    if (modoCartones === 'fijo') return;
    document.getElementById('cantidadCartones').stepUp();
    limpiarPromoPorCambioCantidad();
  };

  document.getElementById('btnMenos').onclick = () => {
    if (modoCartones === 'fijo') return;
    document.getElementById('cantidadCartones').stepDown();
    limpiarPromoPorCambioCantidad();
  };

  document.getElementById('cantidadCartones').addEventListener('input', function() {
    if (modoCartones === 'fijo') {
      this.value = cantidadFijaCartones;
    }
    limpiarPromoPorCambioCantidad();
  });

  // Configurar clics en el logo para admin oculto
  setTimeout(() => {
    const logo = document.querySelector('#bienvenida img, .logo, h1');
    
    if (logo) {
      logo.addEventListener('click', () => {
        contador++;
        
        setTimeout(() => { contador = 0; }, 3000);
        
        if (contador === 7) {
          contador = 0;
          const botonAdmin = document.getElementById('boton-admin-oculto');
          if (botonAdmin) {
            botonAdmin.style.display = 'inline-block';
            alert('🔓 Botón Admin activado');
          }
        }
      });
    }
  }, 1000);

  // Mostrar términos
  document.getElementById('modal-terminos').classList.remove('oculto');
  
  console.log('✅ Sistema inicializado correctamente');
});

// ==================== EXPORTAR FUNCIONES AL GLOBAL ====================
window.mostrarVentana = mostrarVentana;
window.guardarDatosInscripcion = guardarDatosInscripcion;
window.confirmarCantidad = confirmarCantidad;
window.enviarComprobante = enviarComprobante;
window.toggleCarton = toggleCarton;
window.abrirModalCarton = abrirModalCarton;
window.cerrarModalCarton = cerrarModalCarton;
window.seleccionarPromocion = seleccionarPromocion;
window.deseleccionarPromocion = deseleccionarPromocion;
window.cerrarTerminos = cerrarTerminos;
window.entrarAdmin = entrarAdmin;

console.log('✅ Sistema simplificado configurado correctamente');
