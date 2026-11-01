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

import MyOrders from './features/buyer/MyOrders';
import { NotFound, Skeleton } from './components/states';

export default function App() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-[1120px] p-4"><Skeleton /></div>}>
      <Routes>
        <Route path="embed" element={<Embed />} />
        <Route element={<Layout />}>
          <Route index element={<Shop />} />
          <Route path="order/:id" element={<OrderPage />} />
          <Route path="orders" element={<MyOrders />} />
          <Route path="battle" element={<Battle />} />
          <Route path="seller" element={<Seller />} />
          <Route path="agents" element={<AgentsDocs />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  );
}
