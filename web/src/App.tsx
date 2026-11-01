import { lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Shop from './features/shop/Shop';
import OrderPage from './features/shop/OrderPage';

// Heavy pages (AG Grid / AG Charts) load only when visited.
const Battle = lazy(() => import('./features/battle/Battle'));
const Seller = lazy(() => import('./features/seller/Seller'));
const AgentsDocs = lazy(() => import('./features/agents/AgentsDocs'));
const Embed = lazy(() => import('./features/embed/Embed'));

function Loading() { return <div className="h-40 animate-pulse rounded-2xl border border-line bg-card" aria-label="Loading" />; }

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="embed" element={<Embed />} />
        <Route element={<Layout />}>
          <Route index element={<Shop />} />
          <Route path="order/:id" element={<OrderPage />} />
          <Route path="battle" element={<Battle />} />
          <Route path="seller" element={<Seller />} />
          <Route path="agents" element={<AgentsDocs />} />
          <Route path="*" element={<div className="py-20 text-center text-mute">Page not found.</div>} />
        </Route>
      </Routes>
    </Suspense>
  );
}
