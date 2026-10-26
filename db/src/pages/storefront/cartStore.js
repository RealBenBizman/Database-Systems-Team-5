import { api } from '../../shared/api.js';

const KEY = 'pixel-vault-cart';
const EVENT = 'pixel-vault-cart-change';

export function readGuestCart() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(data)) return [];
    const seen = new Set();
    return data.filter((item) => {
      if (!item || !Number.isInteger(item.productId) || item.productId < 1000000 || item.productId > 9999999
        || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 2147483647 || seen.has(item.productId)) return false;
      seen.add(item.productId);
      return true;
    }).slice(0, 100).map(({ productId, quantity }) => ({ productId, quantity }));
  } catch { return []; }
}

export function saveGuestCart(items) {
  try { localStorage.setItem(KEY, JSON.stringify(items)); }
  catch { throw new Error('Your browser could not save the cart. Enable browser storage and try again.'); }
  window.dispatchEvent(new Event(EVENT));
}

export function watchGuestCart(callback) {
  const storage = (event) => { if (event.key === KEY || event.key === null) callback(); };
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', storage);
  return () => { window.removeEventListener(EVENT, callback); window.removeEventListener('storage', storage); };
}

export async function addToCart(product, quantity, user) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new Error('Choose a whole-number quantity of at least one.');
  if (user) {
    if (user.role !== 'customer') throw new Error('Use a customer account to shop.');
    return api.post('/api/cart', { productId: product.id, quantity });
  }
  const items = readGuestCart();
  const item = items.find((entry) => entry.productId === product.id);
  if (!item && items.length >= 100) throw new Error('Your cart has reached 100 different products.');
  const next = (item?.quantity || 0) + quantity;
  if (next > product.stock) throw new Error(`Only ${product.stock} are in stock.`);
  saveGuestCart(item ? items.map((entry) => entry.productId === product.id ? { ...entry, quantity: next } : entry)
    : [...items, { productId: product.id, quantity }]);
}
