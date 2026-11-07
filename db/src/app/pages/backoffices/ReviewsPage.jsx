// Reviews (managers): find customer reviews and remove the ones that do not belong in the shop.
// Remove flags the review (nothing is deleted); it disappears from the product page and from its rating.
import { useState } from 'react';
import { RemoveCard, useLoad } from '../../../shared/manage.jsx';
import { Banner, Button, ErrorBanner, PageHeader, Spinner, Table } from '../../../shared/ui.jsx';

export default function ReviewsPage() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, error, reload } = useLoad('/api/manager/reviews' + (search ? '?q=' + encodeURIComponent(search) : ''));
  const [removing, setRemoving] = useState(null);
  const [notice, setNotice] = useState('');
  return (
    <>
      <PageHeader title="Reviews" subtitle="Find customer reviews and remove the ones that do not belong." />
      {notice && <Banner kind="success">{notice}</Banner>}
      <form className="row" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); setRemoving(null); setSearch(q); }}>
        <div className="field" style={{ margin: 0, minWidth: 340 }}>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search reviews" placeholder="Product, SKU, customer, email or words in the review" />
        </div>
        <Button type="submit" variant="secondary">Search</Button>
      </form>
      {removing && (
        <div style={{ marginBottom: 16 }}>
          <RemoveCard
            key={removing.reviewId}
            title={'Remove the review by ' + removing.author}
            label={'Remove this ' + removing.rating + '-star review of ' + removing.product + '?'}
            message="It disappears from the product page and the rating is recalculated. The customer keeps their account."
            url={'/api/manager/reviews?id=' + removing.reviewId}
            done="Review removed."
            onRemoved={(m) => { setNotice(m); setRemoving(null); reload(); }}
            onCancel={() => setRemoving(null)} />
        </div>
      )}
      <ErrorBanner>{error}</ErrorBanner>
      {!data && !error ? <Spinner /> : (
        <Table
          columns={[
            { key: 'reviewDate', label: 'Date' },
            { key: 'product', label: 'Product' },
            { key: 'author', label: 'Customer', render: (r) => r.author + ' (' + r.email + ')' },
            { key: 'rating', label: 'Stars', numeric: true },
            { key: 'comment', label: 'Review', render: (r) => r.comment || '' },
            { key: 'actions', label: '', render: (r) => <Button type="button" variant="secondary" onClick={() => { setNotice(''); setRemoving(r); }}>Remove</Button> },
          ]}
          rows={data ? data.reviews : []} rowKey="reviewId" empty="No reviews found."
        />
      )}
      <p className="card-muted" style={{ marginTop: 8 }}>Shows up to 100 results, newest first.</p>
    </>
  );
}
