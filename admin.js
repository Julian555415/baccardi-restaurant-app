(function() {

/* ==========================================================================
   CONFIGURACIÓN DE SUPABASE
   ========================================================================== */
const SUPABASE_URL = 'https://todcmniumymwnloujcgb.supabase.co';
const SUPABASE_KEY = 'sb_publishable_q2mRmPcKxNj0ZKxGp15jYg_8NOcWvSo'; // Su Publishable key de Supabase
const MASTER_PASSWORD = "baccardi2026";

let supabase = null;
try {
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    console.error('La librería de Supabase no está disponible.');
  }
} catch (err) {
  console.error('Error al inicializar Supabase:', err);
}

/* ==========================================================================
   CANDADO DE ACCESO (CONTRASEÑA OBLIGATORIA)
   ========================================================================== */
// IMPORTANTE: esto es un candado a nivel de interfaz (evita que un curioso
// que abra el link del panel vea el formulario). NO es seguridad real de
// backend: cualquiera que sepa programar podría ver el código de esta
// página o llamar directo a la API de Supabase con la misma llave pública
// que usa la web. Para bloquear el borrado/inserción de verdad a nivel de
// base de datos, lo correcto a futuro es usar autenticación real de
// Supabase (Supabase Auth) + políticas de RLS que exijan un usuario
// autenticado para insertar/borrar en la tabla "menu". Por ahora, esto
// cumple con mantener alejados a los clientes curiosos del panel.
function verificarAcceso() {
  const respuesta = prompt('Panel de administrador de BACCARDI\nIngrese la clave de acceso:');
  const clave = (respuesta || '').trim();

  console.log('Clave ingresada:', JSON.stringify(clave));

  if (clave === MASTER_PASSWORD) {
    console.log('Clave correcta, mostrando el panel.');
    document.getElementById('adminApp').style.display = 'block';
    document.getElementById('adminBloqueado').style.display = 'none';
    iniciarPanelAdmin();
  } else {
    console.log('Clave incorrecta o cancelada.');
    mostrarPantallaBloqueada();
  }
}

function mostrarPantallaBloqueada() {
  document.getElementById('adminApp').style.display = 'none';
  const bloqueo = document.getElementById('adminBloqueado');
  if (bloqueo) bloqueo.style.display = 'flex';
}

/* ==========================================================================
   INICIALIZACIÓN DEL PANEL (solo corre si la clave fue correcta)
   ========================================================================== */
function iniciarPanelAdmin() {
  cargarListaProductos();
  setupEventListenersAdmin();
}

document.addEventListener('DOMContentLoaded', verificarAcceso);

/* ==========================================================================
   CARGAR Y MOSTRAR LA LISTA DE PRODUCTOS ACTUALES (CON BOTÓN ELIMINAR)
   ========================================================================== */
async function cargarListaProductos() {
  const container = document.getElementById('adminProductList');
  if (!container) return;

  if (!supabase) {
    container.innerHTML = `<p style="color: var(--text-muted);">No se pudo conectar con la base de datos.</p>`;
    return;
  }

  container.innerHTML = `<p style="color: var(--text-muted);">Cargando productos...</p>`;

  const { data, error } = await supabase.from('menu').select('*').order('categoria', { ascending: true });

  if (error) {
    console.error('Error al cargar productos:', error);
    container.innerHTML = `<p style="color: var(--text-muted);">Error al cargar los productos.</p>`;
    return;
  }

  const productos = data || [];

  if (productos.length === 0) {
    container.innerHTML = `<p style="color: var(--text-muted);">Todavía no hay productos en la carta.</p>`;
    return;
  }

  container.innerHTML = productos.map(prod => `
    <div class="admin-product-row">
      <img src="${prod.imagen}" alt="${prod.nombre}" class="admin-product-thumb" onerror="this.src='https://via.placeholder.com/60?text=%20'">
      <div class="admin-product-info">
        <strong>${prod.nombre}</strong>
        <span class="admin-product-cat">${prod.categoria}</span>
      </div>
      <span class="admin-product-price">$${Number(prod.precio).toLocaleString('es-CO')}</span>
      <button class="btn-delete-prod-admin" data-id="${prod.id}" title="Eliminar producto">
        <i class="fas fa-trash"></i>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-delete-prod-admin').forEach(btn => {
    btn.addEventListener('click', () => eliminarProducto(Number(btn.dataset.id)));
  });
}

async function eliminarProducto(id) {
  if (!supabase) {
    alert('No hay conexión con la base de datos.');
    return;
  }
  if (!confirm('¿Seguro que deseas eliminar este producto de la carta?')) return;

  const { error } = await supabase.from('menu').delete().eq('id', id);

  if (error) {
    console.error('Error al eliminar en Supabase:', error);
    alert('Hubo un error al eliminar el producto.');
    return;
  }

  await cargarListaProductos();
}

/* ==========================================================================
   FORMULARIO: AGREGAR PRODUCTO NUEVO (CON COMPRESIÓN DE IMAGEN)
   ========================================================================== */
function setupEventListenersAdmin() {
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
          await guardarProductoSupabase(nombre, categoria, descripcion, precio, imagenComprimida);
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

        if (ancho > maxAncho) {
          alto = Math.round((alto * maxAncho) / ancho);
          ancho = maxAncho;
        }

        const canvas = document.createElement('canvas');
        canvas.width = ancho;
        canvas.height = alto;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, ancho, alto);

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

  await cargarListaProductos();
  document.getElementById('addProductForm').reset();
  alert('Producto agregado con éxito a la carta.');
}

})();