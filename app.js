(function() {

/* ==========================================================================
   CONFIGURACIÓN Y DATOS DE SUPABASE Y EL RESTAURANTE
   ========================================================================== */

const SUPABASE_URL = 'https://todcmniumymwnloujcgb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_q2mRmPcKxNj0ZKxGp15jYg_8NOcWvSo'; // Su Publishable key de Supabase

// IMPORTANTE: si esta inicialización fallara (ej. la librería de Supabase no
// cargó a tiempo), antes se detenía TODO el archivo y por eso ningún botón
// funcionaba. Ahora lo aislamos en un try/catch para que la página siga
// funcionando (botones, carrito, categorías) aunque Supabase falle.
let supabase = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    console.error('La librería de Supabase no está disponible (revisa que el script se haya cargado).');
  }
} catch (err) {
  console.error('Error al inicializar Supabase:', err);
}

const WHATSAPP_PHONE = "573118243908";
const MASTER_PASSWORD = "baccardi2026";

let products = [];
let cart = [];
let selectedProductForCustom = null;

/* ==========================================================================
   INICIALIZACIÓN
   ========================================================================== */
document.addEventListener('DOMContentLoaded', async () => {
  cargarMenuSupabase();
  escucharCambiosEnVivo();
  setupEventListeners();

  await sincronizarHoraServidor();
  actualizarBannerEstado();

  // Revisa el horario cada minuto (usando el offset ya sincronizado) por si
  // alguien deja la página abierta justo cuando cruza la hora de apertura
  // o cierre.
  setInterval(actualizarBannerEstado, 60 * 1000);

  // Resincroniza con el servidor cada 15 minutos para evitar que el offset
  // se desactualice en sesiones largas.
  setInterval(sincronizarHoraServidor, 15 * 60 * 1000);
});

/* ==========================================================================
   HORARIO Y ESTADO DEL RESTAURANTE (ABIERTO / CERRADO)
   ========================================================================== */
// IMPORTANTE: estos horarios deben coincidir siempre con los que aparecen
// en el footer de index.html ("Horarios"). Si cambia el horario del
// restaurante, actualícelo aquí Y en el footer.
// open/close en formato 24h (17 = 5:00 pm, 24 = medianoche).
// 0 = domingo, 1 = lunes, ..., 6 = sábado
const HORARIOS = {
  0: { open: 17, close: 24 }, // Domingo
  1: { open: 17, close: 23 }, // Lunes
  2: { open: 17, close: 23 }, // Martes
  3: { open: 17, close: 23 }, // Miércoles
  4: { open: 17, close: 23 }, // Jueves
  5: { open: 17, close: 24 }, // Viernes
  6: { open: 17, close: 24 }, // Sábado
};

// Diferencia (en milisegundos) entre la hora real del servidor y el reloj
// del dispositivo del cliente. No confiamos en new Date() a secas, porque
// si el celular del cliente tiene la hora mal configurada, mostraría el
// restaurante abierto/cerrado incorrectamente.
let offsetServidorMs = 0;
let horaSincronizada = false;

async function sincronizarHoraServidor() {
  try {
    const antes = Date.now();
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/menu?select=id&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const despues = Date.now();
    const fechaServidor = resp.headers.get('date');

    if (fechaServidor) {
      // Corrige la latencia de ida y vuelta de la petición (estimada a la mitad)
      const latenciaEstimadaMs = (despues - antes) / 2;
      const horaServidorMs = new Date(fechaServidor).getTime() + latenciaEstimadaMs;
      offsetServidorMs = horaServidorMs - despues;
      horaSincronizada = true;
    }
  } catch (err) {
    console.warn('No se pudo sincronizar la hora con el servidor; se usará el reloj del dispositivo como respaldo.', err);
  }
}

function obtenerAhoraConfiable() {
  // Si no logramos sincronizar (ej. sin internet), offsetServidorMs queda en 0
  // y simplemente usamos el reloj del dispositivo como respaldo.
  return new Date(Date.now() + offsetServidorMs);
}

function formatearHora(hora24) {
  const h = hora24 % 24;
  if (h === 0) return '12:00 AM';
  if (h === 12) return '12:00 PM';
  return h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`;
}

function obtenerEstadoRestaurante() {
  const ahora = obtenerAhoraConfiable();
  const dia = ahora.getDay();
  const horaActual = ahora.getHours() + ahora.getMinutes() / 60;
  const horarioHoy = HORARIOS[dia];

  const abierto = horaActual >= horarioHoy.open && horaActual < horarioHoy.close;

  let mensaje;
  if (abierto) {
    mensaje = `Abierto hasta las ${formatearHora(horarioHoy.close)}`;
  } else if (horaActual < horarioHoy.open) {
    mensaje = `Abrimos hoy a las ${formatearHora(horarioHoy.open)}`;
  } else {
    const diaSiguiente = (dia + 1) % 7;
    mensaje = `Abrimos mañana a las ${formatearHora(HORARIOS[diaSiguiente].open)}`;
  }

  return { abierto, mensaje };
}

function actualizarBannerEstado() {
  const banner = document.getElementById('estadoRestaurante');
  if (!banner) return;

  const estado = obtenerEstadoRestaurante();
  banner.classList.remove('abierto', 'cerrado');

  if (estado.abierto) {
    banner.classList.add('abierto');
    banner.innerHTML = `Estamos Abiertos — ${estado.mensaje}`;
  } else {
    banner.classList.add('cerrado');
    banner.innerHTML = `Cerrados ahora — ${estado.mensaje}`;
  }
}

/* ==========================================================================
   ESCUCHAR CAMBIOS EN TIEMPO REAL (SUPABASE REALTIME)
   ========================================================================== */
function escucharCambiosEnVivo() {
  if (!supabase) return;

  supabase
    .channel('public:menu')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menu' }, payload => {
      console.log('¡Cambio detectado en la base de datos!', payload);
      // Recarga el menú automáticamente cuando hay inserciones, actualizaciones o borrados
      cargarMenuSupabase();
    })
    .subscribe();
}

/* ==========================================================================
   CARGAR MENÚ DESDE SUPABASE
   ========================================================================== */
async function cargarMenuSupabase() {
  if (!supabase) {
    console.error('No se puede cargar el menú: Supabase no está inicializado.');
    const container = document.getElementById('menuContainer');
    if (container) {
      container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No se pudo conectar con la base de datos. Intenta recargar la página.</p>`;
    }
    return;
  }
  try {
    const { data, error } = await supabase
      .from('menu')
      .select('*');

    if (error) {
      console.error('Error al cargar el menú desde Supabase:', error);
      return;
    }

    products = (data || []).map(item => ({
      id: item.id,
      name: item.nombre,
      category: item.categoria,
      price: Number(item.precio),
      desc: item.descripcion || '',
      image: item.imagen || 'https://via.placeholder.com/300x200?text=Baccardi'
    }));

    const activeCat = document.querySelector('.cat-btn.active')?.dataset.category || 'todos';
    const searchTerm = document.getElementById('searchInput')?.value || '';
    renderMenu(activeCat, searchTerm);

  } catch (err) {
    console.error('Hubo un error de conexión con Supabase:', err);
  }
}

/* ==========================================================================
   RENDERIZAR EL MENÚ Y FILTROS
   ========================================================================== */
function renderMenu(filterCategory = 'todos', searchTerm = '') {
  const container = document.getElementById('menuContainer');
  if (!container) return;
  container.innerHTML = '';

  const filtered = products.filter(prod => {
    const matchesCat = filterCategory === 'todos' || prod.category === filterCategory;
    const matchesSearch = prod.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          prod.desc.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesCat && matchesSearch;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: var(--text-muted);">No se encontraron productos.</p>`;
    return;
  }

  filtered.forEach(prod => {
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <button class="btn-delete-prod" onclick="deleteProduct(${prod.id})" title="Eliminar producto">
        <i class="fas fa-trash"></i>
      </button>
      <img src="${prod.image}" alt="${prod.name}" class="product-img" onerror="this.src='https://via.placeholder.com/300x200?text=Baccardi'">
      <div class="product-info">
        <h3 class="product-title">${prod.name}</h3>
        <p class="product-desc">${prod.desc}</p>
        <div class="product-bottom">
          <span class="product-price">$${prod.price.toLocaleString('es-CO')}</span>
          <button class="btn-add-cart" onclick="handleAddToCartClick(${prod.id})">Agregar</button>
        </div>
      </div>
    `;
    container.appendChild(card);
  });
}

/* ==========================================================================
   GUEST CUSTOMIZATION MODAL (PAPAS Y ADICIONALES)
   ========================================================================== */
function handleAddToCartClick(id) {
  const prod = products.find(p => p.id === id);
  if (!prod) return;

  selectedProductForCustom = prod;

  if (prod.category === 'hamburguesas' || prod.category === 'doggies') {
    document.getElementById('customProdTitle').textContent = prod.name;
    document.getElementById('customProdDesc').textContent = prod.desc;
    
    document.getElementById('friesSection').style.display = 'block';
    const firstRadio = document.querySelector('input[name="friesOption"]');
    if (firstRadio) firstRadio.checked = true;

    document.querySelectorAll('.extra-item').forEach(cb => cb.checked = false);
    document.getElementById('customizeModal').style.display = 'flex';
  } else {
    addDirectToCart(prod, null, []);
  }
}

document.getElementById('btnConfirmAddToCart')?.addEventListener('click', () => {
  if (!selectedProductForCustom) return;

  let chosenFries = null;
  if (selectedProductForCustom.category === 'hamburguesas' || selectedProductForCustom.category === 'doggies') {
    const checkedFries = document.querySelector('input[name="friesOption"]:checked');
    if (checkedFries) {
      chosenFries = checkedFries.value;
    }
  }

  const chosenExtras = [];
  document.querySelectorAll('.extra-item:checked').forEach(cb => {
    chosenExtras.push({
      name: cb.dataset.name,
      price: parseFloat(cb.dataset.price)
    });
  });

  addDirectToCart(selectedProductForCustom, chosenFries, chosenExtras);
  document.getElementById('customizeModal').style.display = 'none';
});

function addDirectToCart(baseProd, fries, extras) {
  let extraCost = extras.reduce((acc, item) => acc + item.price, 0);
  let finalUnitPrice = baseProd.price + extraCost;

  const extrasString = extras.map(e => e.name).sort().join(',');
  const cartItemId = `${baseProd.id}-${fries || 'none'}-${extrasString}`;

  const existing = cart.find(item => item.cartItemId === cartItemId);

  if (existing) {
    existing.qty++;
  } else {
    cart.push({
      cartItemId,
      id: baseProd.id,
      name: baseProd.name,
      price: finalUnitPrice,
      basePrice: baseProd.price,
      fries: fries,
      extras: extras,
      qty: 1
    });
  }

  updateCartUI();
}

/* ==========================================================================
   ELIMINAR PRODUCTO (ADMIN - SUPABASE)
   ========================================================================== */
// NOTA: estas 3 funciones se usan en onclick="..." generados dinámicamente
// en el HTML, así que deben quedar expuestas en window para poder llamarse
// desde afuera de esta función aislada.
window.deleteProduct = deleteProduct;
window.handleAddToCartClick = handleAddToCartClick;
window.changeQty = changeQty;

async function deleteProduct(id) {
  if (!supabase) {
    alert('No hay conexión con la base de datos. Recarga la página e intenta de nuevo.');
    return;
  }
  const pass = prompt('Ingrese la contraseña para eliminar este producto:');
  if (pass === MASTER_PASSWORD) {
    if (confirm('¿Seguro que deseas eliminar este producto de la carta?')) {
      const { error } = await supabase
        .from('menu')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error al eliminar en Supabase:', error);
        alert('Hubo un error al eliminar el producto.');
        return;
      }

      await cargarMenuSupabase();
      alert('Producto eliminado correctamente.');
    }
  } else if (pass !== null) {
    alert('Contraseña incorrecta.');
  }
}

/* ==========================================================================
   LÓGICA DEL CARRITO DE COMPRAS Y WHATSAPP
   ========================================================================== */
function updateCartUI() {
  const cartCount = document.getElementById('cartCount');
  const cartContainer = document.getElementById('cartItemsContainer');
  const cartTotal = document.getElementById('cartTotal');

  if (!cartCount || !cartContainer || !cartTotal) return;

  const totalItems = cart.reduce((acc, item) => acc + item.qty, 0);
  const totalPrice = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);

  cartCount.textContent = totalItems;
  cartTotal.textContent = `$${totalPrice.toLocaleString('es-CO')}`;

  cartContainer.innerHTML = '';
  cart.forEach(item => {
    const row = document.createElement('div');
    row.style.cssText = "margin-bottom:12px; border-bottom:1px solid #333; padding-bottom:10px;";

    let customDetailsHTML = "";
    if (item.fries) {
      customDetailsHTML += `<div style="font-size: 0.8rem; color: var(--accent-gold);">🍟 ${item.fries}</div>`;
    }
    if (item.extras && item.extras.length > 0) {
      const extrasText = item.extras.map(e => `${e.name} (+$${e.price.toLocaleString('es-CO')})`).join(', ');
      customDetailsHTML += `<div style="font-size: 0.8rem; color: #aaa;">➕ ${extrasText}</div>`;
    }

    row.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start;">
        <div>
          <strong>${item.name}</strong><br>
          ${customDetailsHTML}
          <small>$${item.price.toLocaleString('es-CO')} x ${item.qty}</small>
        </div>
        <div style="display:flex; align-items:center;">
          <button onclick="changeQty('${item.cartItemId}', -1)" style="padding:2px 8px; cursor:pointer;">-</button>
          <span style="margin: 0 8px;">${item.qty}</span>
          <button onclick="changeQty('${item.cartItemId}', 1)" style="padding:2px 8px; cursor:pointer;">+</button>
        </div>
      </div>
    `;
    cartContainer.appendChild(row);
  });
}

function changeQty(cartItemId, delta) {
  const item = cart.find(i => i.cartItemId === cartItemId);
  if (item) {
    item.qty += delta;
    if (item.qty <= 0) {
      cart = cart.filter(i => i.cartItemId !== cartItemId);
    }
  }
  updateCartUI();
}

document.getElementById('btnSendWhatsApp')?.addEventListener('click', () => {
  if (cart.length === 0) {
    alert('El carrito está vacío.');
    return;
  }

  const estado = obtenerEstadoRestaurante();
  if (!estado.abierto) {
    alert(`🔴 En este momento estamos cerrados.\n${estado.mensaje}\n\nPor favor intenta enviarnos tu pedido cuando estemos abiertos.`);
    return;
  }

  const serviceType = document.querySelector('input[name="serviceType"]:checked').value;
  let serviceDetail = "";

  if (serviceType === 'Domicilio') {
    const address = document.getElementById('deliveryAddress').value.trim();
    if (!address) {
      alert('Por favor, ingresa la dirección de entrega para el domicilio.');
      return;
    }
    serviceDetail = `🛵 *Tipo de Servicio:* Domicilio\n📍 *Dirección:* ${address}`;
  } else {
    const table = document.getElementById('tableNumber').value.trim();
    if (!table) {
      alert('Por favor, ingresa el número de mesa.');
      return;
    }
    serviceDetail = `🍽️ *Tipo de Servicio:* Comer en Restaurante\n🪑 *Número de Mesa:* Mesa ${table}`;
  }

  let msg = "¡Hola BACCARDI! Quisiera realizar el siguiente pedido:\n\n";
  
  cart.forEach(item => {
    msg += `• *${item.name}* x${item.qty} - $${(item.price * item.qty).toLocaleString('es-CO')}\n`;
    if (item.fries) {
      msg += `   └ Acompañamiento: ${item.fries}\n`;
    }
    if (item.extras && item.extras.length > 0) {
      const list = item.extras.map(e => e.name).join(', ');
      msg += `   └ Adicionales: ${list}\n`;
    }
  });

  const total = cart.reduce((acc, item) => acc + (item.price * item.qty), 0);
  msg += `\n*Total a Pagar:* $${total.toLocaleString('es-CO')}\n\n`;
  msg += `${serviceDetail}\n`;

  const url = `https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
});

/* ==========================================================================
   MODO ADMINISTRADOR (AGREGAR NUEVOS PRODUCTOS - SUPABASE)
   ========================================================================== */
document.getElementById('addProductForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nombre = document.getElementById('prodName').value;
  const categoria = document.getElementById('prodCategory').value;
  const descripcion = document.getElementById('prodDesc').value;
  const precio = parseFloat(document.getElementById('prodPrice').value);

  const imgSource = document.querySelector('input[name="imgSource"]:checked').value;

  if (imgSource === 'url') {
    const imagen = document.getElementById('prodImgUrl').value || 'https://via.placeholder.com/300x200?text=Baccardi';
    guardarProductoSupabase(nombre, categoria, descripcion, precio, imagen);
  } else {
    const fileInput = document.getElementById('prodImgFile');
    if (fileInput.files && fileInput.files[0]) {
      const submitBtn = document.querySelector('#addProductForm .btn-submit');
      const textoOriginal = submitBtn ? submitBtn.textContent : null;
      try {
        if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Optimizando imagen...'; }
        const imagenComprimida = await comprimirImagen(fileInput.files[0]);
        guardarProductoSupabase(nombre, categoria, descripcion, precio, imagenComprimida);
      } catch (err) {
        console.error('Error al comprimir la imagen:', err);
        alert('No se pudo procesar la imagen. Intenta con otra foto.');
      } finally {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = textoOriginal; }
      }
    } else {
      guardarProductoSupabase(nombre, categoria, descripcion, precio, 'https://via.placeholder.com/300x200?text=Baccardi');
    }
  }
});

/**
 * Redimensiona y comprime una imagen en el navegador antes de guardarla,
 * para que una foto de celular (5-15MB) quede en un archivo liviano
 * (normalmente menos de 200-300KB) sin que el admin tenga que hacer nada.
 * Devuelve un string base64 en formato WebP.
 */
function comprimirImagen(file, maxAncho = 800, calidad = 0.72) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('El archivo seleccionado no es una imagen.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('No se pudo leer el archivo.'));
    reader.onload = (e) => {
      const img = new Image();
      img.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
      img.onload = () => {
        let ancho = img.width;
        let alto = img.height;

        // Si la imagen es más ancha que maxAncho, la reducimos manteniendo proporción
        if (ancho > maxAncho) {
          alto = Math.round((alto * maxAncho) / ancho);
          ancho = maxAncho;
        }

        const canvas = document.createElement('canvas');
        canvas.width = ancho;
        canvas.height = alto;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, ancho, alto);

        // Intentamos WebP primero (mucho más liviano); si el navegador no lo soporta, cae a JPEG
        let dataUrl = canvas.toDataURL('image/webp', calidad);
        if (!dataUrl || dataUrl.indexOf('data:image/webp') !== 0) {
          dataUrl = canvas.toDataURL('image/jpeg', calidad);
        }
        resolve(dataUrl);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function guardarProductoSupabase(nombre, categoria, descripcion, precio, imagen) {
  if (!supabase) {
    alert('No hay conexión con la base de datos. Recarga la página e intenta de nuevo.');
    return;
  }
  const { error } = await supabase
    .from('menu')
    .insert([{ nombre, categoria, descripcion, precio, imagen }]);

  if (error) {
    console.error('Error al guardar en Supabase:', error);
    alert('Hubo un error al guardar el producto en la base de datos.');
    return;
  }

  await cargarMenuSupabase();

  document.getElementById('addProductForm').reset();
  document.getElementById('adminModal').style.display = 'none';
  alert('Producto agregado con éxito a Supabase.');
}

/* ==========================================================================
   EVENTOS DE MODALES, BÚSQUEDA Y CAMBIO DE SERVICIO
   ========================================================================== */
function setupEventListeners() {
  // Botón del Carrito
  const btnOpenCart = document.getElementById('btnOpenCart');
  if (btnOpenCart) {
    btnOpenCart.addEventListener('click', () => {
      const cartModal = document.getElementById('cartModal');
      if (cartModal) cartModal.style.display = 'flex';
    });
  }

  // Botón del Candado (Administrador)
  const btnAdminLogin = document.getElementById('btnAdminLogin');
  if (btnAdminLogin) {
    btnAdminLogin.addEventListener('click', () => {
      const pass = prompt('Ingrese la clave de administrador para agregar productos:');
      if (pass === MASTER_PASSWORD) {
        const adminModal = document.getElementById('adminModal');
        if (adminModal) adminModal.style.display = 'flex';
      } else if (pass !== null) {
        alert('Clave incorrecta.');
      }
    });
  }

  // Cerrar Carrito
  const closeCartModal = document.getElementById('closeCartModal');
  if (closeCartModal) {
    closeCartModal.addEventListener('click', () => {
      document.getElementById('cartModal').style.display = 'none';
    });
  }

  // Cerrar Modal Personalización
  const closeCustomizeModal = document.getElementById('closeCustomizeModal');
  if (closeCustomizeModal) {
    closeCustomizeModal.addEventListener('click', () => {
      document.getElementById('customizeModal').style.display = 'none';
    });
  }

  // Cerrar Modal Admin
  const closeAdminModal = document.getElementById('closeAdminModal');
  if (closeAdminModal) {
    closeAdminModal.addEventListener('click', () => {
      document.getElementById('adminModal').style.display = 'none';
    });
  }

  // Alternar Domicilio vs Mesa en Carrito
  const radioDomicilio = document.getElementById('radioDomicilio');
  if (radioDomicilio) {
    radioDomicilio.addEventListener('change', () => {
      document.getElementById('groupDomicilio').style.display = 'block';
      document.getElementById('groupMesa').style.display = 'none';
    });
  }

  const radioMesa = document.getElementById('radioMesa');
  if (radioMesa) {
    radioMesa.addEventListener('change', () => {
      document.getElementById('groupDomicilio').style.display = 'none';
      document.getElementById('groupMesa').style.display = 'block';
    });
  }

  // Buscador en tiempo real
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const activeCat = document.querySelector('.cat-btn.active')?.dataset.category || 'todos';
      renderMenu(activeCat, e.target.value);
    });
  }

  // Evento para los botones de categorías
  const catButtons = document.querySelectorAll('.cat-btn');
  catButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      catButtons.forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      const selectedCategory = e.target.dataset.category;
      const searchTerm = document.getElementById('searchInput')?.value || '';
      renderMenu(selectedCategory, searchTerm);
    });
  });

  // Cambio de fuente de imagen (URL o Archivo local)
  document.querySelectorAll('input[name="imgSource"]').forEach(radio => {
    radio.addEventListener('change', (e) => {
      if (e.target.value === 'url') {
        document.getElementById('prodImgUrl').style.display = 'block';
        document.getElementById('prodImgFile').style.display = 'none';
      } else {
        document.getElementById('prodImgUrl').style.display = 'none';
        document.getElementById('prodImgFile').style.display = 'block';
      }
    });
  });
}

})();
