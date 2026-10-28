import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../../shared/api.js';
import { useAuth } from '../../../shared/auth.jsx';
import { Banner, Button, EmptyState, ErrorBanner, Field, PageHeader, Spinner } from '../../../shared/ui.jsx';
import { useLoad, ProductCard, Pagination } from './components.jsx';
import { addToCart } from './cartStore.js';
import './Storefront.css';

const values = (params) => Object.fromEntries(['search', 'categoryId', 'condition', 'minPrice', 'maxPrice', 'inStock'].map((key) => [key, params.get(key) || '']));

export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const query = params.toString();
  const [form, setForm] = useState(() => values(params));
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState(null);
  useEffect(() => { setForm(values(params)); }, [query]);
  const resource = useLoad(async () => {
    const [catalog, categories] = await Promise.all([api.get('/api/products', Object.fromEntries(params)), api.get('/api/products/categories')]);
    return { ...catalog, categories: categories.categories };
  }, [query]);

  function apply(event) {
    event.preventDefault();
    setParams(Object.fromEntries(Object.entries({ ...form, sort: params.get('sort') || 'name', discountId: params.get('discountId') || '' }).filter(([, value]) => value !== '')));
  }

  function change(key, value) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, String(value)); else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  }

  async function add(product) {
    setBusy(product.id); setActionError(null); setNotice('');
    try { await addToCart(product, 1, user); setNotice(`${product.name} added to your cart.`); }
    catch (error) { setActionError(error); }
    finally { setBusy(null); }
  }

  return <div className="sf-page">
    <PageHeader title="Shop" subtitle="Find your next game, console, or collectible." />
    {notice && <Banner kind="success">{notice} <Link to="/cart">View cart</Link></Banner>}
    <ErrorBanner error={actionError} />
    <div className="sf-catalog-layout">
      <aside className="card sf-filters" aria-label="Product filters">
        <h2>Find a product</h2>
        <form onSubmit={apply}>
          <Field label="Search" type="search" placeholder="Name or SKU" maxLength={100} value={form.search} onChange={(e) => setForm({ ...form, search: e.target.value })} />
          <Field label="Category" as="select" value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
            <option value="">All categories</option>{resource.data?.categories.map((category) => <option key={category.id} value={category.id}>{category.name} ({category.productCount})</option>)}
          </Field>
          <Field label="Condition" as="select" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
            <option value="">Any condition</option>{['New', 'Used', 'Refurbished'].map((value) => <option key={value}>{value}</option>)}
          </Field>
          <div className="sf-price-fields">
            <Field label="Min price" type="number" min="0" max="99999999.99" step="0.01" value={form.minPrice} onChange={(e) => setForm({ ...form, minPrice: e.target.value })} />
            <Field label="Max price" type="number" min="0" max="99999999.99" step="0.01" value={form.maxPrice} onChange={(e) => setForm({ ...form, maxPrice: e.target.value })} />
          </div>
          <label className="sf-check"><input type="checkbox" checked={form.inStock === 'true'} onChange={(e) => setForm({ ...form, inStock: e.target.checked ? 'true' : '' })} /> In stock only</label>
          <div className="sf-filter-actions"><Button type="submit" block>Apply filters</Button><Button type="button" variant="secondary" block onClick={() => setParams({})}>Clear filters</Button></div>
        </form>
      </aside>
      <section className="sf-results" aria-label="Products">
        <div className="sf-toolbar">
          <p aria-live="polite">{resource.loading ? 'Finding products...' : resource.data ? `${resource.data.total} products` : ''}</p>
          <Field label="Sort by" as="select" value={params.get('sort') || 'name'} onChange={(e) => change('sort', e.target.value)}>
            <option value="name">Name</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="rating">Highest rated</option><option value="newest">Newest added</option>
          </Field>
        </div>
        {params.get('discountId') && <Banner>Showing products with this offer. <button type="button" className="sf-text-button" onClick={() => change('discountId', '')}>Show all offers</button></Banner>}
        {resource.loading ? <Spinner label="Loading products..." /> : resource.error ? <><ErrorBanner error={resource.error} /><Button variant="secondary" onClick={resource.reload}>Try again</Button></>
          : resource.data?.products.length ? <>
            <div className="sf-product-grid">{resource.data.products.map((product) => <ProductCard key={product.id} product={product} add={add} busy={busy === product.id} disabled={authLoading || busy !== null || !!user && user.role !== 'customer'} />)}</div>
            <Pagination page={resource.data.page} pageSize={resource.data.pageSize} total={resource.data.total} change={(page) => change('page', page)} />
          </> : <EmptyState title="No matching products" action={<Button variant="secondary" onClick={() => setParams({})}>Clear filters</Button>}>Try a different search or remove a filter.</EmptyState>}
      </section>
    </div>
  </div>;
}
